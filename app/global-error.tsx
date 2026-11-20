"use client";

import * as React from "react";
import { AlertCircle, RefreshCw, Home, RotateCcw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[Pulse Global Root Error]:", error);
  }, [error]);

  const handleClearCacheAndReload = () => {
    try {
      if (typeof window !== "undefined") {
        sessionStorage.clear();
        localStorage.clear();
      }
    } catch {}
    window.location.href = "/";
  };

  return (
    <html lang="en">
      <body className="min-h-screen w-full bg-[#F5F5F5] flex items-center justify-center p-6 text-black select-none font-sans">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-8 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-[#FF1493]/10 border border-[#FF1493]/30 flex items-center justify-center text-[#FF1493] mb-5 shadow-inner">
            <AlertCircle className="w-7 h-7" />
          </div>

          <h1 className="text-xl font-bold text-black tracking-tight mb-2">
            Application Error
          </h1>

          <p className="text-xs text-[#4D4D4D] max-w-sm mb-4 leading-relaxed">
            A critical system issue was encountered. Resetting the session cache will restore normal access.
          </p>

          {error?.message && (
            <div className="mb-4 w-full p-3.5 rounded-xl bg-red-50 border border-red-200 text-[11px] font-mono text-red-700 text-left break-all max-h-36 overflow-y-auto">
              {error.message}
            </div>
          )}

          {error?.digest && (
            <div className="mb-5 px-3 py-1.5 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-[10px] font-mono text-[#808080]">
              Reference: {error.digest}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2.5 w-full justify-center">
            <button
              type="button"
              onClick={() => reset()}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Try again</span>
            </button>

            <button
              type="button"
              onClick={handleClearCacheAndReload}
              className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#B7FF00] hover:bg-[#a3e600] text-black text-xs font-bold shadow-xs cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Clear Cache & Reload</span>
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
