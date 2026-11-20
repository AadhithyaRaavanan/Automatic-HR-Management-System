"use client";

import * as React from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[Pulse Global Error]:", error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-screen w-full bg-[#F5F5F5] flex items-center justify-center p-6 text-black font-sans antialiased">
        <div className="w-full max-w-md bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-8 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-[#FF1493]/10 border border-[#FF1493]/30 flex items-center justify-center text-[#FF1493] mb-5 shadow-inner">
            <AlertCircle className="w-7 h-7" />
          </div>

          <h1 className="text-xl font-bold text-black tracking-tight mb-2">
            Workspace Error
          </h1>

          <p className="text-xs text-[#4D4D4D] max-w-sm mb-6 leading-relaxed">
            A temporary system issue occurred. Please reload to restore your session.
          </p>

          <button
            type="button"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.location.reload();
              } else {
                reset();
              }
            }}
            className="flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Reload Pulse</span>
          </button>
        </div>
      </body>
    </html>
  );
}
