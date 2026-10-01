// On-demand CDN loader to avoid build-time crashes
async function getTesseractWorker() {
  if (!window.Tesseract) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src =
        "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
      script.onload = resolve;
      script.onerror = () => reject(new Error("Unable to load OCR engine."));
      document.head.appendChild(script);
    });
  }
  return await window.Tesseract.createWorker("eng");
}

export async function parsePaymentReceipt(imageFile) {
  const worker = await getTesseractWorker();
  const ret = await worker.recognize(imageFile);
  await worker.terminate();

  const text = ret.data.text || "";
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  // 1. Amount Extraction (₹28, ₹47, ₹323, with or without decimals/commas)[span_10](start_span)[span_10](end_span)[span_11](start_span)[span_11](end_span)[span_12](start_span)[span_12](end_span)
  let amount = "";
  const amountMatch =
    text.match(/(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d{1,2})?)/i) ||
    text.match(
      /(?:paid|sent|received)\s*(?:successfully)?\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)/i,
    );
  if (amountMatch) {
    amount = amountMatch[1].replace(/,/g, "");
  } else {
    for (let i = 0; i < lines.length; i++) {
      if (/paid successfully|payment successful/i.test(lines[i])) {
        const candidate = lines[i - 1] || lines[i + 1];
        const num = candidate?.match(/[\d,]+(?:\.\d{1,2})?/);
        if (num) {
          amount = num[0].replace(/,/g, "");
          break;
        }
      }
    }
  }

  // 2. Transaction Type Detection
  let type = "expense";
  if (
    /received from|credited to|refund|cashback|money added|topup successful/i.test(
      text,
    )
  ) {
    type = "income";
  }

  // 3. Name & Note Extraction for Amazon Pay, Paytm, Navi[span_13](start_span)[span_13](end_span)[span_14](start_span)[span_14](end_span)[span_15](start_span)[span_15](end_span)
  let note = "";

  // Format: "to <NAME>" or "Paid to <NAME>"
  const directLine = lines.find((l) => /^(?:paid to|to)\b/i.test(l));
  if (directLine) {
    note = directLine.replace(/^(?:paid to|to)[:\s]*/i, "").trim();
  }

  // Amazon Pay layout: "Paid to" is header, name follows[span_16](start_span)[span_16](end_span)
  if (!note) {
    const paidToIdx = lines.findIndex((l) => /^paid to$/i.test(l));
    if (paidToIdx !== -1 && lines[paidToIdx + 1]) {
      note = lines[paidToIdx + 1].replace(/^(mr|ms|mrs)\.?\s+/i, "");
    }
  }

  // Paytm layout: Recipient is top line right below brand[span_17](start_span)[span_17](end_span)
  if (!note) {
    const paytmIdx = lines.findIndex((l) => /paytm/i.test(l));
    if (
      paytmIdx !== -1 &&
      lines[paytmIdx + 1] &&
      !/paid|rupee|₹/i.test(lines[paytmIdx + 1])
    ) {
      note = lines[paytmIdx + 1];
    }
  }

  // Navi layout: "to RAGHIB HUSSAIN[span_18](start_span)"[span_18](end_span)
  if (!note) {
    const toMatch = text.match(/to\s+([A-Za-z ]{3,30})/i);
    if (toMatch) {
      note = toMatch[1].trim();
    }
  }

  return { amount, type, note: (note || "").slice(0, 35), rawText: text };
}
