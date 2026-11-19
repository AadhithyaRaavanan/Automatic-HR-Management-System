"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { ShieldCheck, KeyRound, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = sanitizeRedirectPath(searchParams.get("redirect"), "/");

  const [totpCode, setTotpCode] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [factorId, setFactorId] = React.useState<string | null>(null);

  const isDemoMode = isDemoModeEnabled();
  const supabase = createClient();

  // Load user's enrolled TOTP factor
  React.useEffect(() => {
    async function loadFactors() {
      try {
        const { data, error } = await supabase.auth.mfa.listFactors();
        if (error) throw error;
        
        const totpFactor = data.totp.find((f) => f.status === "verified");
        if (totpFactor) {
          setFactorId(totpFactor.id);
        } else {
          // No verified factor: clean up any stale unverified attempts so the user is never trapped
          for (const f of data.totp || []) {
            if ((f.status as string) !== "verified") {
              await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
            }
          }
          window.location.href = redirectPath || "/";
        }
      } catch (err: any) {
        toast.error("Failed to load two-factor credentials.");
      }
    }
    loadFactors();
  }, [supabase, redirectPath, router]);

  const handleVerifyTotp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!factorId) {
      toast.error("No authenticator factor found. Please sign in again.");
      return;
    }

    const cleanCode = totpCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) {
      toast.error("Please enter a valid 6-digit code.");
      return;
    }

    setIsLoading(true);

    try {
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: cleanCode,
      });

      if (error) {
        toast.error(error.message || "Invalid authenticator code.");
        return;
      }

      toast.success("Two-Factor Authentication verified successfully!");
      window.location.href = redirectPath;
    } catch {
      toast.error("Verification failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAutoFillDemo = async () => {
    if (!factorId) {
      toast.error("No authenticator factor found.");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/demo-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ factorId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to process 1-click sign in");
      }

      if (data.bypassed) {
        toast.success("Two-Factor Authentication verified successfully!");
        window.location.href = redirectPath;
        return;
      }

      if (data.code) {
        setTotpCode(data.code);
        const { error } = await supabase.auth.mfa.challengeAndVerify({
          factorId,
          code: data.code,
        });
        if (error) throw error;
        toast.success("Two-Factor Authentication verified successfully!");
        window.location.href = redirectPath;
        return;
      }

      throw new Error("Unable to complete one-click verification");
    } catch (err: any) {
      toast.error(err.message || "Auto-verification failed.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  return (
    <div className="w-full max-w-md bg-white rounded-[14px] border border-[#E6E6E6] p-8 relative overflow-hidden shadow-none">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center text-white font-bold text-sm shadow-xs">
            <KeyRound className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-black tracking-tight">
              Two-factor challenge
            </h2>
            <span className="text-xs text-[#808080]">
              Authentication required
            </span>
          </div>
        </div>
      </div>

      <div className="mb-6">
        <h1 className="text-xl font-bold text-black tracking-tight">
          Enter authenticator code
        </h1>
        <p className="text-xs text-[#4D4D4D] mt-1">
          Open your authenticator app (Google Authenticator, Authy, etc.) and enter the 6-digit security code for your Pulse account.
        </p>
      </div>

      <form onSubmit={handleVerifyTotp} className="space-y-4">
        {isDemoMode && (
          <div className="p-3.5 bg-[#F5F5F5] border border-[#E6E6E6] rounded-xl flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-black flex items-center gap-1">
                <span>⚡ Demo Mode</span>
              </p>
              <p className="text-[11px] text-[#4D4D4D]">Skip manual authenticator app code</p>
            </div>
            <button
              type="button"
              onClick={handleAutoFillDemo}
              disabled={isLoading || !factorId}
              className="py-1.5 px-3 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-all shadow-xs flex items-center gap-1.5 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <span>1-Click Sign In</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div>
          <label className="text-xs font-semibold text-black block mb-1.5">
            6-Digit Security Code
          </label>
          <input
            type="text"
            required
            autoFocus
            maxLength={6}
            pattern="[0-9]*"
            inputMode="numeric"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            placeholder="000 000"
            className="w-full text-center tracking-[0.35em] text-lg font-mono py-2.5 px-4 rounded-lg bg-white border border-[#E6E6E6] text-black placeholder:text-[#808080] focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-all"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading || totpCode.length < 6}
          className="w-full mt-2 py-2.5 px-4 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
        >
          <span>{isLoading ? "Verifying..." : "Verify & Continue"}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        <div className="text-center pt-2 space-y-2">
          <button
            type="button"
            onClick={() => router.push(`/mfa-setup?redirect=${encodeURIComponent(redirectPath)}`)}
            className="text-xs font-medium text-[#808080] hover:text-black hover:underline block mx-auto transition-colors"
          >
            Lost access to authenticator? Set up a new device
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs font-medium text-[#808080] hover:text-black flex items-center justify-center gap-1 mx-auto transition-colors hover:underline"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>Cancel and sign in with a different account</span>
          </button>
        </div>
      </form>

      <div className="mt-8 pt-4 border-t border-[#E6E6E6] flex items-center justify-center gap-1 text-[11px] text-[#808080]">
        <ShieldCheck className="w-3.5 h-3.5 text-black" />
        <span>Hardware & App-Based TOTP (RFC 6238)</span>
      </div>
    </div>
  );
}

export default function MfaChallengePage() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-4 select-none">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-white rounded-[14px] border border-[#E6E6E6] p-8 animate-pulse text-center text-xs text-[#808080]">
            Loading two-factor challenge...
          </div>
        }
      >
        <MfaChallengeForm />
      </Suspense>
    </div>
  );
}
