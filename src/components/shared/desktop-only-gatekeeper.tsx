"use client";

import * as React from "react";
import { Monitor } from "lucide-react";

/**
 * Pure CSS Media Query Gatekeeper:
 * Enforces Desktop-Only experience strictly below 1024px viewport width.
 * No user-agent sniffing, no runtime data loading, zero app content rendered behind notice.
 */
export function DesktopOnlyGatekeeper({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Full-page blocker visible exclusively below 1024px via pure CSS media query */}
      <div
        className="fixed inset-0 z-[999999] bg-[#0A0D14] text-white flex-col items-center justify-center p-6 text-center select-none hidden max-[1023px]:flex"
        role="alertdialog"
        aria-modal="true"
        aria-label="Desktop Only Notice"
      >
        <div className="w-full max-w-sm bg-[#121824] border border-white/10 rounded-[28px] p-8 shadow-2xl flex flex-col items-center">
          <div className="w-16 h-16 rounded-2xl bg-brand-purple/20 border border-brand-purple/40 flex items-center justify-center text-brand-purple mb-5 shadow-inner">
            <Monitor className="w-8 h-8 text-purple-400" />
          </div>

          <h1 className="text-xl font-extrabold text-white tracking-tight mb-2">
            Desktop Workspace
          </h1>

          <p className="text-sm text-gray-300 leading-relaxed font-medium">
            Pulse is available on desktop only. Please open it on a computer.
          </p>
        </div>
      </div>

      {/* App content rendered only at 1024px and above */}
      <div className="max-[1023px]:hidden contents">
        {children}
      </div>
    </>
  );
}
