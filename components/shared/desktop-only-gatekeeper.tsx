"use client";

import * as React from "react";
import { Monitor, Smartphone, ShieldAlert } from "lucide-react";

/**
 * Checks whether the current device is a mobile device or tablet.
 * Detects standard mobile browsers as well as "Desktop Mode" on mobile devices
 * by inspecting touch capabilities, hardware concurrency, orientation, and screen dimensions.
 */
function isMobileDevice(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  const userAgent = (navigator.userAgent || navigator.vendor || (window as any).opera || "").toLowerCase();

  // 1. Direct User-Agent matching for mobile and tablet identifiers
  const mobileUaKeywords = [
    "android",
    "webos",
    "iphone",
    "ipad",
    "ipod",
    "blackberry",
    "iemobile",
    "opera mini",
    "mobile",
    "tablet",
    "silk",
    "kindle",
  ];
  if (mobileUaKeywords.some((keyword) => userAgent.includes(keyword))) {
    return true;
  }

  // 2. iPadOS / iOS in "Desktop Mode" (reports as Macintosh Intel Mac OS X but has touch points)
  const isIpadDesktopMode =
    navigator.platform === "MacIntel" &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 1;
  if (isIpadDesktopMode) {
    return true;
  }

  // 3. Android Chrome in "Desktop Site" mode:
  // When Android toggles "Desktop Site", it keeps Linux in UA, maxTouchPoints > 0,
  // and has coarse pointer or orientation characteristics.
  const isLinuxWithTouch =
    userAgent.includes("linux") &&
    typeof navigator.maxTouchPoints === "number" &&
    navigator.maxTouchPoints > 0;
  if (isLinuxWithTouch) {
    return true;
  }

  // 4. Touchscreen + Pointer media query checks
  // True desktops (even with touch monitors) have fine hover pointers, whereas mobile devices have coarse pointers.
  const hasCoarsePointer =
    typeof window.matchMedia === "function" &&
    (window.matchMedia("(pointer: coarse)").matches ||
      window.matchMedia("(hover: none)").matches);

  const hasMaxTouchPoints =
    typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1;

  // 5. Physical screen dimension check (screen.width or screen.height in portrait/landscape)
  const screenMinDim = Math.min(window.screen.width, window.screen.height);

  // If a device has coarse touch and phone/tablet physical screen dimensions (min dim <= 820px)
  if (hasCoarsePointer && screenMinDim <= 820) {
    return true;
  }

  // Mobile desktop site overrides viewport CSS pixels, but window.screen still exposes the device physical bounds
  if (hasMaxTouchPoints && screenMinDim <= 768) {
    return true;
  }

  return false;
}

export function DesktopOnlyGatekeeper({ children }: { children: React.ReactNode }) {
  const [isMobile, setIsMobile] = React.useState<boolean | null>(null);

  React.useEffect(() => {
    const check = () => {
      setIsMobile(isMobileDevice());
    };

    check();
    window.addEventListener("resize", check);
    window.addEventListener("orientationchange", check);
    return () => {
      window.removeEventListener("resize", check);
      window.removeEventListener("orientationchange", check);
    };
  }, []);

  // During SSR or initial hydration check, render children to avoid layout flash
  if (isMobile === null) {
    return <>{children}</>;
  }

  if (isMobile) {
    return (
      <div
        className="fixed inset-0 z-[99999] bg-[#0A0D14] text-white flex flex-col items-center justify-center p-6 text-center select-none overflow-y-auto"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="mobile-restricted-title"
      >
        <div className="w-full max-w-md bg-[#121824] border border-white/10 rounded-[28px] p-8 sm:p-10 shadow-2xl flex flex-col items-center animate-in fade-in zoom-in-95 duration-200">
          {/* Animated Hardware Icons */}
          <div className="relative mb-6">
            <div className="w-20 h-20 rounded-2xl bg-brand-purple/15 border border-brand-purple/30 flex items-center justify-center text-brand-purple shadow-inner">
              <Monitor className="w-10 h-10 animate-pulse text-purple-400" />
            </div>
            <div className="absolute -bottom-2 -right-2 w-9 h-9 rounded-xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-red-400 shadow-md">
              <Smartphone className="w-5 h-5" />
            </div>
          </div>

          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-500/15 border border-red-500/30 text-red-400 text-xs font-bold tracking-wide uppercase mb-3">
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Desktop Workspace Only</span>
          </div>

          <h1
            id="mobile-restricted-title"
            className="text-xl sm:text-2xl font-extrabold tracking-tight text-white mb-3"
          >
            Mobile Access Restricted
          </h1>

          <p className="text-sm text-gray-300 leading-relaxed mb-6 font-normal">
            RemoteHR is an enterprise workplace management portal engineered exclusively for desktop and workstation environments.
          </p>

          <div className="w-full bg-[#1A2234] border border-white/5 rounded-2xl p-4 text-left text-xs text-gray-400 space-y-2 mb-6">
            <div className="flex items-center gap-2 text-gray-300 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span>Mobile phones &amp; tablets are disabled</span>
            </div>
            <div className="flex items-center gap-2 text-gray-300 font-semibold">
              <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
              <span>Mobile &quot;Desktop Mode&quot; is restricted</span>
            </div>
            <p className="text-[11px] text-gray-400 pt-1 border-t border-white/5">
              Please open this portal on a desktop or laptop computer using Chrome, Safari, Edge, or Brave.
            </p>
          </div>

          <div className="text-[11px] text-gray-500 font-mono">
            Device Policy Enforced • RemoteHR Security
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

