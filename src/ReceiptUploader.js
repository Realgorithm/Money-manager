import React, { useState } from "react";
import { Camera, Upload, Loader2, Sparkles, X } from "lucide-react";
import { parsePaymentReceipt } from "./receiptParser";

export default function ReceiptUploader({ accounts, onParsedData }) {
    const [loading, setLoading] = useState(false);
    const [preview, setPreview] = useState(null);

    const processImage = async (file) => {
        if (!file) return;
        setPreview(URL.createObjectURL(file));
        setLoading(true);
        try {
            const data = await parsePaymentReceipt(file);
            onParsedData(data);
        } catch (err) {
            console.error("OCR parse failed:", err);
            alert("Could not automatically parse the screenshot. Please input details manually.");
        } finally {
            setLoading(false);
        }
    };

    const handleFileChange = (e) => {
        const file = e.target.files?.[0];
        if (file) processImage(file);
    };

    // Support direct paste from clipboard (Ctrl+V / Cmd+V)
    const handlePaste = (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of items) {
            if (item.type.startsWith("image/")) {
                const file = item.getAsFile();
                processImage(file);
                break;
            }
        }
    };

    return (
        <div
            onPaste={handlePaste}
            tabIndex={0}
            className="border-2 border-dashed border-slate-200 rounded-xl p-4 text-center bg-slate-50 hover:bg-slate-100/60 transition-all focus:outline-none focus:border-emerald-500 cursor-pointer"
        >
            <input
                type="file"
                accept="image/*"
                id="receipt-file-input"
                className="hidden"
                onChange={handleFileChange}
            />
            <label htmlFor="receipt-file-input" className="cursor-pointer flex flex-col items-center gap-1.5">
                {loading ? (
                    <div className="flex flex-col items-center gap-2 py-3">
                        <Loader2 className="animate-spin text-emerald-600" size={24} />
                        <span className="text-xs font-semibold text-slate-600">Reading payment screenshot...</span>
                    </div>
                ) : (
                    <>
                        <div className="flex items-center gap-2 text-emerald-700 bg-emerald-100/70 px-3 py-1 rounded-full text-xs font-bold">
                            <Sparkles size={13} />
                            <span>Smart Receipt Scanner</span>
                        </div>
                        <p className="text-xs text-slate-600 font-medium mt-1">
                            Upload screenshot or paste (Ctrl+V) from UPI / Bank
                        </p>
                        <span className="text-[11px] text-slate-400">Auto-detects Amount, Mode & Recipient</span>
                    </>
                )}
            </label>
        </div>
    );
}
