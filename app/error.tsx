"use client";

import * as React from "react";
import Link from "next/link";
import { AlertCircle, RefreshCw, Home } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  React.useEffect(() => {
    console.error("[Pulse Application Error]:", error);
  }, [error]);

  return (
    <div className="min-h-screen w-full bg-[#F5F5F5] flex items-center justify-center p-6 text-black">
      <div className="w-full max-w-md bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-8 text-center flex flex-col items-center">
        {/* Error icon with magenta accent */}
        <div className="w-14 h-14 rounded-2xl bg-[#FF1493]/10 border border-[#FF1493]/30 flex items-center justify-center text-[#FF1493] mb-5 shadow-inner">
          <AlertCircle className="w-7 h-7" />
        </div>

        <h1 className="text-xl font-bold text-black tracking-tight mb-2">
          Something went wrong
        </h1>

        <p className="text-xs text-[#4D4D4D] max-w-sm mb-6 leading-relaxed">
          An unexpected interface issue occurred. Your data and progress are safe.
        </p>

        {error?.digest && (
          <div className="mb-6 px-3 py-1.5 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-[10px] font-mono text-[#808080]">
            Reference: {error.digest}
          </div>
        )}

        <div className="flex items-center gap-3 w-full justify-center">
          <button
            type="button"
            onClick={() => reset()}
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold shadow-xs cursor-pointer transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Try again</span>
          </button>

          <Link
            href="/"
            className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-black text-xs font-semibold shadow-xs transition-colors"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
