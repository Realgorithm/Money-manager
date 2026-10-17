import { matchAccount, suggestCategory } from "./receiptParser";

// Turns a bank SMS / payment-app notification into a draft transaction.
// Pure text parsing — no network, no OCR. Returns { ignore: true, reason } for
// anything that isn't a completed payment (OTPs, balance alerts, reminders…).

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
const pad = (n) => String(n).padStart(2, "0");
const localISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const CUR = "(?:rs\\.?|inr|₹)";
const NUM = "([\\d,]+(?:\\.\\d{1,2})?)";

function toNumber(s) {
  const v = parseFloat(String(s).replace(/,/g, ""));
  return isFinite(v) && v > 0 && v < 10000000 ? v : 0;
}

export function extractSmsAmount(text) {
  // 1) Currency-marked amounts, skipping balances / limits ("Avl Bal Rs 1,000").
  const re = new RegExp(`${CUR}\\s*${NUM}`, "gi");
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 22), m.index).toLowerCase();
    if (/bal|avl|available|limit|outstanding|total due|min(?:imum)? due/.test(before)) continue;
    const v = toNumber(m[1]);
    if (v) return v;
  }
  // 2) "debited by 120.0" style (no currency symbol)
  const m2 = text.match(new RegExp(`(?:debited|credited|received|paid|sent|spent|withdrawn)\\s+(?:by|with|for|of)?\\s*${CUR}?\\s*${NUM}`, "i"));
  return m2 ? toNumber(m2[1]) : 0;
}

export function detectSmsType(text) {
  const t = text.replace(/credit\s*card|debit\s*card/gi, "card");
  const exp = t.search(/\b(?:debited|debit|dr|spent|paid|sent|withdrawn|purchase|transferred\s+to|payment\s+of)\b/i);
  const inc = t.search(/\b(?:credited|credit|cr|received|refund(?:ed)?|deposited|cashback)\b/i);
  if (exp < 0 && inc < 0) return null;
  if (inc < 0) return "expense";
  if (exp < 0) return "income";
  return exp < inc ? "expense" : "income"; // "Dr. from A/c … and Cr. to …" → whichever comes first
}

function prettify(s) {
  let out = s.replace(/[^A-Za-z0-9&@. '-]/g, " ").replace(/\s+/g, " ").trim().replace(/^(?:vpa|mr|mrs|ms)\.?\s+/i, "");
  if (out.includes("@")) out = out.split("@")[0]; // swiggy@icici → swiggy
  out = out.replace(/[._-]+/g, " ").trim();
  if (out && (out === out.toUpperCase() || out === out.toLowerCase())) {
    out = out.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, a, b) => a + b.toUpperCase());
  }
  return out.slice(0, 30);
}

export function extractSmsNote(text, type) {
  const flat = text.replace(/\s+/g, " ");
  const tries = type === "income"
    ? [
        /\b(?:received|credited)\b[^.]*?\bfrom\s+([A-Za-z0-9@][A-Za-z0-9@ .'&_-]{1,32}?)(?=\s+(?:on|via|ref|upi|to|a\/c|acct?|\(|-)|[.,]|\s*$)/i,
        /\bfrom\s+(?:VPA\s+)?([A-Za-z0-9._-]+@[A-Za-z0-9]+)/i,
        /\bby\s+(?:VPA\s+)?([A-Za-z0-9._-]+@[A-Za-z0-9]+)/i,
        /\bCr\.?\s+to\s+[^.]*?\bfrom\s+([A-Za-z][A-Za-z .'&-]{1,30}?)(?=\s+(?:on|ref)|[.,]|$)/i,
      ]
    : [
        /\b(?:trf|transfer(?:red)?|paid|sent|payment)\s+(?:(?:rs\.?|inr|₹)\s*[\d,]+(?:\.\d{1,2})?\s+)?to\s+(?:VPA\s+)?([A-Za-z0-9@][A-Za-z0-9@ .'&_-]{1,32}?)(?=\s+(?:on|via|ref|upi|from|a\/c|\(|-)|[.,]|\s*$)/i,
        /\bCr\.?\s+to\s+([A-Za-z0-9._-]+@[A-Za-z0-9]+)/i,
        /\bto\s+VPA\s+([A-Za-z0-9._-]+@[A-Za-z0-9]+)/i,
        /\bat\s+([A-Za-z0-9][A-Za-z0-9 &._-]{1,25}?)(?=\s+(?:on|ref|via|using)|[.,]|$)/i,
      ];
  for (const re of tries) {
    const m = flat.match(re);
    if (m) {
      const n = prettify(m[1]);
      if (n.length >= 2 && !/^(?:your|a c|ac|account|bank|upi)\b/i.test(n)) return n;
    }
  }
  return "";
}

export function extractSmsRef(text) {
  const m = text.match(/(?:ref(?:erence)?(?:\s*(?:no|number|id))?\.?|rrn|utr|txn\s*(?:id|no)|upi\s*ref(?:\s*no)?)[\s:.#-]*([A-Za-z0-9]{9,22})/i);
  if (m) return m[1].toUpperCase();
  const twelve = text.match(/\b(\d{12})\b/); // UPI reference numbers are 12 digits
  return twelve ? twelve[1] : "";
}

export function extractSmsDate(text, fallback) {
  const f = text;
  let m = f.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/);
  if (m) {
    let [d, mo, y] = [+m[1], +m[2], +m[3]];
    if (y < 100) y += 2000;
    if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31) return `${y}-${pad(mo)}-${pad(d)}`;
  }
  m = f.match(/\b(\d{1,2})[-\s]?([A-Za-z]{3})[a-z]*[-\s,']*(\d{2,4})\b/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return `${y}-${pad(MONTHS[m[2].toLowerCase()])}-${pad(+m[1])}`;
  }
  return localISO(fallback instanceof Date && !isNaN(fallback) ? fallback : new Date());
}

// Last 4 digits of the account/card the message refers to ("A/c XX5230", "**1234", "X5230").
export function extractLast4(text) {
  const m = text.match(/(?:x{2,}|\*{2,})\s*(\d{4})\b/i) || text.match(/\bx(\d{4})\b/i) || text.match(/(?:a\/c|acct?|account|card)\D{0,14}?(\d{4})\b/i);
  return m ? m[1] : "";
}

export function parseNotification(rawText, accounts = [], receivedAt = new Date()) {
  const text = String(rawText || "").trim();
  if (!text) return { ignore: true, reason: "empty" };
  if (/\botp\b|one[\s-]?time\s+password|verification code/i.test(text)) return { ignore: true, reason: "otp" };
  if (/will be debited|to be debited|due (?:on|by)|reminder|requested?\s+(?:money|₹|rs)|collect request|declined|failed|unsuccessful/i.test(text)) {
    return { ignore: true, reason: "not a completed payment" };
  }
  const type = detectSmsType(text);
  const amount = extractSmsAmount(text);
  if (!type || !amount) return { ignore: true, reason: "no payment found" };

  const note = extractSmsNote(text, type);
  const ref = extractSmsRef(text);
  const date = extractSmsDate(text, new Date(receivedAt));
  const account = matchAccount(accounts, text);
  const category = suggestCategory(type, note, text) || "Other";
  return { ignore: false, type, amount, note, ref, date, last4: extractLast4(text), accountId: account ? account.id : "", category };
}

// Work out which pending items are duplicates of something already added or of
// each other (the same payment often arrives as an SMS AND an app notification).
// items: [{ id, createdAt(ms), parsed }]; transactions: existing tx list.
const WINDOW_MS = 3 * 60 * 1000;
export function findDuplicates(items, transactions) {
  const drop = new Set();
  const flag = new Set();
  const refs = new Set(transactions.map((t) => t.ref).filter(Boolean));
  const recent = transactions.filter((t) => t.srcAt);
  const live = items.filter((i) => !i.parsed.ignore);

  for (const it of live) {
    const p = it.parsed;
    if (p.ref && refs.has(p.ref)) { drop.add(it.id); continue; }
    if (!p.ref && recent.some((t) => t.type === p.type && Math.abs(t.amount - p.amount) < 0.005 && Math.abs(t.srcAt - it.createdAt) <= WINDOW_MS)) {
      drop.add(it.id);
    }
  }
  const rest = live.filter((i) => !drop.has(i.id));
  const richness = (i) => (i.parsed.ref ? 2 : 0) + (i.parsed.accountId ? 1 : 0);
  for (let a = 0; a < rest.length; a++) {
    for (let b = a + 1; b < rest.length; b++) {
      const x = rest[a], y = rest[b];
      if (drop.has(x.id) || drop.has(y.id)) continue;
      const same = x.parsed.type === y.parsed.type && Math.abs(x.parsed.amount - y.parsed.amount) < 0.005;
      if (!same) continue;
      if (x.parsed.ref && y.parsed.ref) { if (x.parsed.ref === y.parsed.ref) drop.add(richness(x) >= richness(y) ? y.id : x.id); continue; }
      if (Math.abs(x.createdAt - y.createdAt) <= WINDOW_MS) {
        if (richness(x) === richness(y)) { flag.add(x.id); flag.add(y.id); }
        else drop.add(richness(x) > richness(y) ? y.id : x.id);
      }
    }
  }
  return { drop, flag };
}
