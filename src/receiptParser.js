import { createWorker } from "tesseract.js";

// Finds the payment amount in OCR'd receipt text. Deliberately does NOT
// require a decimal point (most UPI amounts are whole rupees — ₹28, ₹323,
// ₹3,600) and does NOT rely solely on the ₹ symbol being read correctly,
// since Tesseract's default English model frequently garbles or drops it.
export function extractAmount(text) {
  const candidates = [];

  // Pass 1: explicit "₹ / Rs / INR <number>" anywhere in the text — the
  // strongest signal, when the currency mark actually survives OCR.
  const currencyRe = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/gi;
  let m;
  while ((m = currencyRe.exec(text))) {
    const value = parseFloat(m[1].replace(/,/g, ""));
    if (!isNaN(value) && value > 0) {
      candidates.push({ raw: m[1].replace(/,/g, ""), value, hasCurrencyMark: true, digits: m[1].replace(/[,.]/g, "").length });
    }
  }

  // Pass 2: a line that's essentially JUST a number. Every payment app
  // puts the headline amount alone on its own line in the biggest font —
  // this still finds it even when the ₹ glyph gets mangled or dropped.
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (/\d{1,2}\s*:\s*\d{2}/.test(line)) continue; // clock time
    if (/%/.test(line)) continue; // battery / signal
    if (/jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(line)) continue; // date line
    const bare = line.replace(/^(?:₹|rs\.?|inr)\s*/i, "").replace(/[^\d.,]+$/, "").trim();
    if (/^[\d,]+(?:\.\d{1,2})?$/.test(bare)) {
      const value = parseFloat(bare.replace(/,/g, ""));
      if (!isNaN(value) && value > 0) {
        candidates.push({
          raw: bare.replace(/,/g, ""),
          value,
          hasCurrencyMark: /(?:₹|rs\.?|inr)/i.test(line),
          digits: bare.replace(/[,.]/g, "").length,
        });
      }
    }
  }

  if (candidates.length === 0) return "";

  // Prefer candidates with an explicit currency mark; among those (or if
  // none had one), prefer realistic amount lengths (≤7 digits rules out
  // reference/txn IDs and phone numbers); then take the largest value,
  // since the headline amount is normally the most prominent number.
  const withMark = candidates.filter((c) => c.hasCurrencyMark);
  let pool = withMark.length > 0 ? withMark : candidates;
  const reasonable = pool.filter((c) => c.digits <= 7);
  pool = reasonable.length > 0 ? reasonable : pool;
  pool.sort((a, b) => b.value - a.value);
  return pool[0].raw;
}

// Reads a UPI/bank payment screenshot and pulls out amount, transaction
// type, and a merchant/recipient note. Uses the npm-installed tesseract.js
// (bundled by Vite) — NOT a CDN script — so the version actually running
// always matches what's in package.json and works reliably.
export async function parsePaymentReceipt(imageFile) {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(imageFile);
    const text = data.text || "";

    const amount = extractAmount(text);

    // Income vs expense
    let type = "expense";
    if (/received|credited to|cashback|refund|money added|top[\s-]?up successful/i.test(text)) {
      type = "income";
    }

    // Merchant / recipient note
    let note = "";
    const noteMatch = text.match(/(?:paid to|to:?|transferred to|sent to)\s+([A-Za-z0-9&@. -]+)/i);
    if (noteMatch) note = noteMatch[1].split("\n")[0].trim().slice(0, 30);

    return { amount, type, note, rawText: text };
  } finally {
    await worker.terminate();
  }
}
