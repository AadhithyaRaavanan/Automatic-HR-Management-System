"use client";

import * as React from "react";
import { AlertCircle, RefreshCw, Home, RotateCcw, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [clearing, setClearing] = React.useState(false);

  React.useEffect(() => {
    console.error("[Pulse Application Error]:", error);
  }, [error]);

  const handleClearCacheAndReload = () => {
    setClearing(true);
    try {
      if (typeof window !== "undefined") {
        sessionStorage.clear();
        localStorage.removeItem("remotehr_cached_session");
        localStorage.removeItem("remotehr_cached_role");
        localStorage.removeItem("pulse_tutorial_active");
        localStorage.removeItem("pulse_tutorial_step_index");
      }
    } catch {}
    window.location.href = "/";
  };

  const handleSignOut = async () => {
    try {
      if (typeof window !== "undefined") {
        sessionStorage.clear();
        localStorage.clear();
      }
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch {}
    window.location.href = "/login";
  };

  return (
    <div className="min-h-screen w-full bg-[#F5F5F5] flex items-center justify-center p-6 text-black select-none">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-[#E6E6E6] shadow-xl p-8 text-center flex flex-col items-center">
        {/* Error icon with magenta accent */}
        <div className="w-14 h-14 rounded-2xl bg-[#FF1493]/10 border border-[#FF1493]/30 flex items-center justify-center text-[#FF1493] mb-5 shadow-inner">
          <AlertCircle className="w-7 h-7" />
        </div>

        <h1 className="text-xl font-bold text-black tracking-tight mb-2">
          Something went wrong
        </h1>

        <p className="text-xs text-[#4D4D4D] max-w-sm mb-4 leading-relaxed">
          An unexpected interface issue occurred. Your data and progress are safe.
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
            disabled={clearing}
            onClick={handleClearCacheAndReload}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#B7FF00] hover:bg-[#a3e600] text-black text-xs font-bold shadow-xs cursor-pointer transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{clearing ? "Reloading..." : "Clear Cache & Reload"}</span>
          </button>

          <button
            type="button"
            onClick={() => { window.location.href = "/"; }}
            className="flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-black text-xs font-semibold shadow-xs transition-colors cursor-pointer"
          >
            <Home className="w-3.5 h-3.5" />
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            onClick={handleSignOut}
            className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[#808080] hover:text-[#FF1493] text-xs font-medium transition-colors cursor-pointer"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Sign out</span>
          </button>
        </div>
      </div>
    </div>
  );
}
