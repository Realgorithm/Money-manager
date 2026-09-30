import { createWorker } from "tesseract.js";

export async function parsePaymentReceipt(imageFile) {
    const worker = await createWorker("eng");
    const ret = await worker.recognize(imageFile);
    await worker.terminate();

    const text = ret.data.text;

    // 1. Extract Amount: Matches ₹ 150, Rs. 150, INR 150, etc.
    const amountMatch = text.match(/(?:₹|rs\.?|inr)\s*([\d,]+\.?\d{0,2})/i) || text.match(/paid\s*(?:₹|rs\.?|inr)?\s*([\d,]+\.?\d{0,2})/i);
    let amount = "";
    if (amountMatch) {
        amount = amountMatch[1].replace(/,/g, "");
    }

    // 2. Detect Income vs Expense
    let type = "expense";
    if (/received from|credited to|cashback|refund/i.test(text)) {
        type = "income";
    }

    // 3. Extract Merchant / Recipient Note
    let note = "";
    const toMatch = text.match(/(?:paid to|to:?|transfer to)\s+([A-Za-z0-9 ]+)/i);
    if (toMatch) {
        note = toMatch[1].split("\n")[0].trim();
    }

    return { amount, type, note, rawText: text };
}
