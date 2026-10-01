import { createWorker } from "tesseract.js";

// Reads a UPI/bank payment screenshot and pulls out amount, transaction
// type, and a merchant/recipient note. Uses the npm-installed tesseract.js
// (bundled by Vite) — NOT a CDN script — so the version actually running
// always matches what's in package.json and works reliably.
export async function parsePaymentReceipt(imageFile) {
  const worker = await createWorker("eng");
  try {
    const { data } = await worker.recognize(imageFile);
    const text = data.text || "";

    // 1. Amount — ₹/Rs/INR prefix, or "paid/sent/debited/credited <amount>",
    //    or a bare decimal amount as a last resort.
    let amount = "";
    const amtMatch =
      text.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
      text.match(/(?:paid|sent|debited|credited|transferred)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i) ||
      text.match(/([\d,]+\.\d{2})/);
    if (amtMatch) amount = amtMatch[1].replace(/,/g, "");

    // 2. Income vs expense
    let type = "expense";
    if (/received|credited to|cashback|refund|money added|top[\s-]?up successful/i.test(text)) {
      type = "income";
    }

    // 3. Merchant / recipient note
    let note = "";
    const noteMatch = text.match(/(?:paid to|to:?|transferred to|sent to)\s+([A-Za-z0-9&@. -]+)/i);
    if (noteMatch) note = noteMatch[1].split("\n")[0].trim().slice(0, 30);

    return { amount, type, note, rawText: text };
  } finally {
    await worker.terminate();
  }
}
