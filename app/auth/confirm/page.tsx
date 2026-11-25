"use client";

import * as React from "react";
import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import type { EmailOtpType } from "@supabase/supabase-js";

function AuthConfirmHandler() {
  const searchParams = useSearchParams();
  const handledRef = React.useRef(false);
  const [statusMessage, setStatusMessage] = React.useState("Verifying your sign-in link...");

  React.useEffect(() => {
    if (handledRef.current) return;
    handledRef.current = true;

    async function completeAuth() {
      const rawRedirect = searchParams.get("redirect") || searchParams.get("next");
      const safeRedirect = sanitizeRedirectPath(rawRedirect, "/");
      const code = searchParams.get("code");
      const tokenHash = searchParams.get("token_hash");
      const queryType = searchParams.get("type") as EmailOtpType | null;

      try {
        // Handle implicit/hash-fragment tokens (#access_token=...&refresh_token=...)
        if (typeof window !== "undefined" && window.location.hash) {
          const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
          const accessToken = hashParams.get("access_token");
          const refreshToken = hashParams.get("refresh_token");
          const hashType = hashParams.get("type");

          if (accessToken && refreshToken) {
            const { error } = await createClient().auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            });
            if (!error) {
              const target =
                hashType === "recovery" ? "/settings?must_change_password=true" : safeRedirect;
              window.location.replace(target);
              return;
            }
          }
        }

        if (code || (tokenHash && queryType)) {
          const callback = new URL("/auth/callback", window.location.origin);
          if (code) callback.searchParams.set("code", code);
          if (tokenHash && queryType) {
            callback.searchParams.set("token_hash", tokenHash);
            callback.searchParams.set("type", queryType);
          }
          callback.searchParams.set("redirect", queryType === "recovery" ? "/settings?must_change_password=true" : safeRedirect);
          window.location.replace(callback.href);
          return;
        }
      } catch {
        // Fall through to login error redirect
      }

      setStatusMessage("Link expired or invalid. Redirecting to sign in...");
      window.location.replace("/login?error=auth_callback_failed");
    }

    completeAuth();
  }, [searchParams]);

  return (
    <div className="min-h-screen w-full bg-[#F5F5F5] flex items-center justify-center p-4">
      <div className="w-full max-w-sm bg-white rounded-[14px] border border-[#E6E6E6] p-8 text-center">
        <div className="w-8 h-8 rounded-full border-2 border-[#E6E6E6] border-t-black animate-spin mx-auto mb-4" />
        <p className="text-sm font-semibold text-black">{statusMessage}</p>
      </div>
    </div>
  );
}

export default function AuthConfirmPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen w-full bg-[#F5F5F5] flex items-center justify-center p-4 text-xs text-[#808080]">
          Verifying your sign-in link...
        </div>
      }
    >
      <AuthConfirmHandler />
    </Suspense>
  );
}
