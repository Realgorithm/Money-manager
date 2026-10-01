import { createWorker } from "tesseract.js";

// ---------------------------------------------------------------------------
// Amount helpers
// ---------------------------------------------------------------------------

const AMOUNT_RE = /^(?:\d{1,3}(?:,\d{2,3})+|\d+)(?:\.\d{1,2})?$/;

// Cleans an OCR'd numeric string ("3,600", " ,600.", "3.600") into a plain
// number string ("3600") — or "" if it doesn't look like a real amount.
function normaliseAmount(s) {
  if (!s) return "";
  let t = String(s).replace(/[^\d.,]/g, "").replace(/^[.,]+|[.,]+$/g, "");
  if (!AMOUNT_RE.test(t)) return "";
  t = t.replace(/,/g, "");
  const v = parseFloat(t);
  if (isNaN(v) || v <= 0 || v > 10000000) return "";
  return t;
}

// Fallback: finds the payment amount in plain OCR text. Used only when the
// headline-isolation pass (below) can't locate the big amount on screen.
//
// Tesseract very often misreads the ₹ glyph as "~", "%", "€", "¥", "Z", "2",
// "3"... and glues it onto the number ("~35,600" for ₹3,600). So a line that is
// "a few junk chars + a number" is accepted, but ranked below lines where the
// currency mark was read properly.
export function extractAmount(text) {
  const candidates = [];

  // Pass 1: explicit "₹ / Rs / INR <number>"
  const currencyRe = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  let m;
  while ((m = currencyRe.exec(text))) {
    const raw = normaliseAmount(m[1]);
    if (raw) candidates.push({ raw, value: parseFloat(raw), rank: 3, digits: raw.replace(/\./, "").length });
  }

  // Pass 2: a line that is essentially JUST a number (the headline amount).
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/\d{1,2}\s*:\s*\d{2}/.test(line)) continue; // clock time
    if (/%/.test(line) && /^\d{1,3}\s*%/.test(line)) continue; // battery
    if (/@/.test(line)) continue; // UPI ids
    if (/\*{2,}/.test(line)) continue; // masked account numbers
    if (/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(line)) continue; // dates

    const hasMark = /^(?:₹|rs\.?|inr)\s*\d/i.test(line);
    // allow up to 2 junk characters (a mangled ₹) before the number
    const bare = line.replace(/^(?:₹|rs\.?|inr)\s*/i, "").replace(/^[^\d]{1,2}(?=\d)/, "").replace(/[^\d.,]+$/, "").trim();
    const raw = normaliseAmount(bare);
    if (!raw) continue;
    const mangledPrefix = !hasMark && bare !== line.replace(/[^\d.,]+$/, "").trim();
    candidates.push({ raw, value: parseFloat(raw), rank: hasMark ? 3 : mangledPrefix ? 1 : 2, digits: raw.replace(/\./, "").length });
  }

  if (candidates.length === 0) return "";

  // ≤7 digits rules out reference/txn IDs and phone numbers
  let pool = candidates.filter((c) => c.digits <= 7);
  if (pool.length === 0) pool = candidates;
  const best = Math.max(...pool.map((c) => c.rank));
  pool = pool.filter((c) => c.rank === best);
  pool.sort((a, b) => b.value - a.value);
  return pool[0].raw;
}

// ---------------------------------------------------------------------------
// Headline-amount isolation (the real fix for the ₹ glyph problem)
//
// Every payment app prints the amount in the biggest font on the screen. We
// find that word's bounding box from the first OCR pass, crop it out, upscale +
// binarise it, split it into glyphs, discard the leading ₹ glyph, and re-read
// ONLY the digits with a digits-only whitelist. That makes it impossible for the
// ₹ symbol to leak into the number.
// ---------------------------------------------------------------------------

function otsuThreshold(gray) {
  const hist = new Array(256).fill(0);
  for (let i = 0; i < gray.length; i++) hist[gray[i]]++;
  const total = gray.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = 0, thr = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > max) { max = between; thr = t; }
  }
  return thr;
}

function collectWords(data) {
  const out = [];
  for (const b of data.blocks || []) {
    for (const p of b.paragraphs || []) {
      for (const l of p.lines || []) {
        for (const w of l.words || []) out.push(w);
      }
    }
  }
  if (out.length === 0 && Array.isArray(data.words)) out.push(...data.words);
  return out;
}

function findHeadlineWord(words, imgH) {
  const heights = words.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
  const median = heights.length ? heights[Math.floor(heights.length / 2)] : 0;
  let best = null;
  for (const w of words) {
    const t = (w.text || "").replace(/\s/g, "");
    if (t.length < 2 || t.length > 14) continue;
    const digits = (t.match(/\d/g) || []).length;
    if (digits < 1 || digits / t.length < 0.5) continue;
    if (!/^[^\d]{0,2}[\d,.]+[^\d]?$/.test(t)) continue; // "₹3,600" or a mangled "~35,600"
    const y0 = w.bbox.y0;
    if (y0 < imgH * 0.07 || y0 > imgH * 0.75) continue; // skip status bar & footer icons
    const h = w.bbox.y1 - w.bbox.y0;
    if (median && h < median * 1.3) continue; // must be visibly bigger than normal text
    if (!best || h > best.bbox.y1 - best.bbox.y0) best = w;
  }
  return best;
}

async function readHeadlineAmount(bitmap, word, digitWorker) {
  const bw = word.bbox.x1 - word.bbox.x0;
  const bh = word.bbox.y1 - word.bbox.y0;
  const padY = Math.round(bh * 0.2);
  const sx = Math.max(0, Math.round(word.bbox.x0 - bh * 0.6)); // catch a ₹ the first pass split off
  const sy = Math.max(0, word.bbox.y0 - padY);
  const sw = Math.min(bitmap.width - sx, Math.round(bw + bh * 0.6 + bh * 0.3));
  const sh = Math.min(bitmap.height - sy, bh + padY * 2);
  if (sw < 4 || sh < 4) return "";

  const scale = Math.max(1, Math.round(150 / sh));
  const W = sw * scale, H = sh * scale;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, W, H);
  const { data: px } = ctx.getImageData(0, 0, W, H);
  const gray = new Uint8Array(W * H);
  for (let i = 0; i < gray.length; i++) {
    gray[i] = (px[i * 4] * 299 + px[i * 4 + 1] * 587 + px[i * 4 + 2] * 114) / 1000;
  }
  const thr = otsuThreshold(gray);
  const ink = new Uint8Array(W * H); // 1 = text pixel
  let white = 0;
  for (let i = 0; i < gray.length; i++) { if (gray[i] > thr) white++; }
  const darkText = white >= gray.length / 2; // background is the majority colour
  for (let i = 0; i < gray.length; i++) ink[i] = (gray[i] > thr) === darkText ? 0 : 1;

  // Split into glyphs wherever a full column has no ink.
  const colInk = new Uint8Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (ink[y * W + x]) colInk[x] = 1;
  const segs = [];
  let s = -1;
  for (let x = 0; x <= W; x++) {
    const on = x < W && colInk[x];
    if (on && s < 0) s = x;
    if (!on && s >= 0) { if (x - s >= 2) segs.push([s, x]); s = -1; }
  }
  if (segs.length === 0) return "";

  const render = (x0, x1) => {
    const margin = 20;
    const out = document.createElement("canvas");
    out.width = x1 - x0 + margin * 2;
    out.height = H + margin * 2;
    const octx = out.getContext("2d");
    octx.fillStyle = "#fff";
    octx.fillRect(0, 0, out.width, out.height);
    const img = octx.createImageData(x1 - x0, H);
    for (let y = 0; y < H; y++) {
      for (let x = x0; x < x1; x++) {
        const v = ink[y * W + x] ? 0 : 255;
        const o = (y * (x1 - x0) + (x - x0)) * 4;
        img.data[o] = img.data[o + 1] = img.data[o + 2] = v;
        img.data[o + 3] = 255;
      }
    }
    octx.putImageData(img, margin, margin);
    return out;
  };

  const readDigits = async (canvas) => {
    const { data } = await digitWorker.recognize(canvas);
    return normaliseAmount(data.text || "");
  };

  const lastEnd = segs[segs.length - 1][1];
  const full = await readDigits(render(Math.max(0, segs[0][0] - 8), Math.min(W, lastEnd + 8)));

  // Is there a leading currency glyph? Yes if the first-pass reading started
  // with a non-digit (mangled ₹), or if there are more glyphs than digits read.
  const firstPass = (word.text || "").replace(/\s/g, "");
  const startsWithJunk = /^[^\d]/.test(firstPass);
  const glyphCount = segs.length;
  const hasSymbol = segs.length >= 2 && (startsWithJunk || glyphCount > full.length);

  if (hasSymbol) {
    const dropped = await readDigits(render(Math.max(0, segs[1][0] - 8), Math.min(W, lastEnd + 8)));
    if (dropped) return dropped;
  }
  return full;
}

// ---------------------------------------------------------------------------
// Type / note / category / account helpers
// ---------------------------------------------------------------------------

export function detectType(text) {
  const income = /received|credited|cashback|refund|money added|top[\s-]?up successful|added to wallet/i;
  const expense = /paid to|sent to|money sent|debited from|you paid|payment (?:successful|to|of)|transferred to|paid\s*\n/i;
  const iIdx = text.search(income);
  const eIdx = text.search(expense);
  if (iIdx >= 0 && eIdx < 0) return "income";
  if (eIdx >= 0 && iIdx < 0) return "expense";
  if (iIdx >= 0 && eIdx >= 0) return iIdx < eIdx ? "income" : "expense"; // whichever status appears first
  return "expense";
}

function titleCaseIfShouting(s) {
  if (s.length > 2 && s === s.toUpperCase() && /[A-Z]/.test(s)) {
    return s.toLowerCase().replace(/(^|[\s.'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  }
  return s;
}

// Pulls the counter-party name: "Received from <X>" for income,
// "Paid to <X>" / "Sent to <X>" for expenses. Handles the name being on the
// next line (as in Amazon Pay / GPay / PhonePe layouts). Deliberately ignores
// "Credited to ..." / "Debited from ..." which describe OUR account.
export function extractNote(text, type) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const head = type === "income"
    ? /^(?:money\s+)?received\s+from\b|^from\b/i
    : /^(?:paid|sent|transferred|payment)\s+to\b|^to\b/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(head);
    if (!m) continue;
    let rest = lines[i].slice(m[0].length).replace(/^[\s:.-]+/, "");
    if (!rest && lines[i + 1]) rest = lines[i + 1];
    rest = rest.replace(/[^A-Za-z0-9&@. '-]/g, " ").replace(/\s+/g, " ").trim();
    if (rest.length >= 2 && !/^(?:bank|upi|amazon pay|credited|debited)\b/i.test(rest)) {
      return titleCaseIfShouting(rest).slice(0, 30);
    }
  }
  return "";
}

export function suggestCategory(type, note, rawText) {
  // The "Amazon Pay" app name appears on every receipt — don't let it make
  // everything "Shopping".
  const hay = `${note} ${rawText}`.toLowerCase().replace(/amazon pay( upi| balance| wallet)?/g, " ");
  if (type === "income") {
    if (/top[\s-]?up|money added|added to wallet/.test(hay)) return "Top-Up";
    if (/salary/.test(hay)) return "Salary";
    if (/interest/.test(hay)) return "Interest";
    return "Other";
  }
  if (/swiggy|zomato|chai|tea\b|restaurant|baker|cafe|dhaba|food/.test(hay)) return "Food";
  if (/uber|ola\b|rapido|metro|petrol|diesel|fuel|fastag/.test(hay)) return "Transport";
  if (/blinkit|zepto|instamart|dmart|amazon|flipkart|myntra|shopping/.test(hay)) return "Shopping";
  if (/recharge|bill|electricity|broadband|wifi/.test(hay)) return "Utilities";
  return null; // no confident guess — leave the user's choice alone
}

const BANK_ALIASES = [
  ["bob", ["bank of baroda", "baroda"]],
  ["sbi", ["state bank of india", "state bank"]],
  ["hdfc", ["hdfc bank", "hdfc"]],
  ["icici", ["icici bank", "icici"]],
  ["axis", ["axis bank", "axis"]],
  ["pnb", ["punjab national bank", "punjab national"]],
  ["kotak", ["kotak mahindra", "kotak"]],
  ["canara", ["canara bank", "canara"]],
  ["union", ["union bank of india", "union bank"]],
  ["idfc", ["idfc first", "idfc"]],
  ["yes", ["yes bank"]],
  ["indusind", ["indusind bank", "indusind"]],
  ["boi", ["bank of india"]],
  ["iob", ["indian overseas bank"]],
  ["indian", ["indian bank"]],
  ["central", ["central bank of india"]],
  ["federal", ["federal bank"]],
  ["airtel", ["airtel payments bank"]],
  ["paytm", ["paytm payments bank"]],
];

// Picks the user's account that this receipt belongs to.
// Order: last-4 digits of a masked account no. → bank name / alias → account
// name appearing in the text → real wallet. NOTE: "Amazon Pay UPI" is a UPI
// handle backed by a bank account, NOT the Amazon Pay wallet balance.
export function matchAccount(accounts, rawText) {
  if (!rawText || !accounts?.length) return null;
  const lower = rawText.toLowerCase();
  const names = accounts.map((a) => ({ a, n: (a.name || "").toLowerCase().trim() }));
  const wordIn = (hay, needle) => new RegExp(`(?:^|[^a-z0-9])${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:$|[^a-z0-9])`).test(hay);

  const last4 = lower.match(/\*{2,}\s*(\d{4})/);
  if (last4) {
    const hit = names.find(({ n }) => n.includes(last4[1]));
    if (hit) return hit.a;
  }

  for (const [key, aliases] of BANK_ALIASES) {
    if (!aliases.some((al) => lower.includes(al))) continue;
    const hit = names.find(({ n }) => wordIn(n, key) || aliases.some((al) => n.includes(al)));
    if (hit) return hit.a;
  }

  const direct = names.find(({ n }) => n.length >= 3 && wordIn(lower, n));
  if (direct) return direct.a;

  if (/(?:paytm|phonepe|amazon pay|metro card)\s+(?:wallet|balance)|wallet balance|top[\s-]?up/.test(lower)) {
    const w = accounts.find((a) => a.type === "wallet" || /wallet|metro/i.test(a.name));
    if (w) return w;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

// Reads a UPI/bank payment screenshot and pulls out amount, transaction type,
// counter-party note, suggested category and raw text. Uses the npm-installed
// tesseract.js (bundled by Vite), not a CDN script.
export async function parsePaymentReceipt(imageFile) {
  const worker = await createWorker("eng");
  let digitWorker = null;
  try {
    const { data } = await worker.recognize(imageFile, {}, { text: true, blocks: true });
    const text = data.text || "";

    let amount = "";
    try {
      const bitmap = await createImageBitmap(imageFile);
      const word = findHeadlineWord(collectWords(data), bitmap.height);
      if (word) {
        digitWorker = await createWorker("eng");
        await digitWorker.setParameters({
          tessedit_char_whitelist: "0123456789,.",
          tessedit_pageseg_mode: "7", // single text line
        });
        amount = await readHeadlineAmount(bitmap, word, digitWorker);
      }
      if (bitmap.close) bitmap.close();
    } catch (err) {
      console.warn("Headline amount isolation failed, using text fallback:", err);
    }
    if (!amount) amount = extractAmount(text);

    const type = detectType(text);
    const note = extractNote(text, type);
    const category = suggestCategory(type, note, text);

    return { amount, type, note, category, rawText: text };
  } finally {
    await worker.terminate();
    if (digitWorker) await digitWorker.terminate();
  }
}
