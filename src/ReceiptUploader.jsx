import React, { useState, useRef } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { parsePaymentReceipt } from "./receiptParser";

export default function ReceiptUploader({ onParsedData }) {
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  const processFile = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const data = await parsePaymentReceipt(file);
      onParsedData(data);
    } catch (err) {
      alert("Could not read screenshot text. Please type manually.");
    } finally {
      setLoading(false);
    }
  };

  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) processFile(file);
        break;
      }
    }
  };

  return (
    <div
      onPaste={handlePaste}
      tabIndex={0}
      onClick={() => inputRef.current?.click()}
      className="border-2 border-dashed border-emerald-300 rounded-xl p-3.5 text-center bg-emerald-50/50 hover:bg-emerald-50 transition-all cursor-pointer focus:outline-none"
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) processFile(e.target.files[0]);
        }}
      />
      <div className="flex flex-col items-center gap-1">
        {loading ? (
          <div className="flex items-center gap-2 py-2 text-emerald-800 font-semibold text-xs">
            <Loader2 className="animate-spin text-emerald-600" size={18} />
            <span>Scanning receipt via OCR…</span>
          </div>
        ) : (
          <>
            <div className="flex items-center gap-1.5 text-emerald-800 bg-emerald-100 px-3 py-1 rounded-full text-xs font-bold">
              <Sparkles size={13} />
              <span>Smart Screenshot OCR</span>
            </div>
            <p className="text-xs text-slate-700 font-medium mt-1">
              Tap to pick or <strong>Paste (Ctrl+V)</strong> payment screenshot
            </p>
            <span className="text-[11px] text-slate-500">
              Auto-detects Amount, Mode, Category & Account/Wallet
            </span>
          </>
        )}
      </div>
    </div>
  );
}
