"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { ShieldCheck, KeyRound, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

function MfaChallengeForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/";

  const [totpCode, setTotpCode] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [factorId, setFactorId] = React.useState<string | null>(null);

  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

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
        } else if (data.totp.length > 0) {
          // If first factor pending verification
          setFactorId(data.totp[0].id);
        } else {
          // No factor enrolled: redirect seamlessly to enrollment page to prevent lockout
          toast.info("No authenticator enrolled yet. Redirecting to setup...");
          router.push(`/mfa-setup?redirect=${encodeURIComponent(redirectPath)}`);
        }
      } catch (err: any) {
        toast.error("Failed to load two-factor credentials.");
      }
    }
    loadFactors();
  }, [supabase]);

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
        toast.error("Invalid verification code. Please check your authenticator app and try again.");
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
      if (!res.ok || !data.code) {
        throw new Error(data.error || "Failed to fetch demo code");
      }
      setTotpCode(data.code);

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: data.code,
      });
      if (error) throw error;
      toast.success("Two-Factor Authentication verified successfully!");
      window.location.href = redirectPath;
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
    <div className="w-full max-w-md bg-shell rounded-[32px] shadow-shell border border-border-light/60 p-8 sm:p-10 relative overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-brand-purple flex items-center justify-center text-white shadow-float">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-text-primary tracking-tight">
              Two-Factor Challenge
            </h2>
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-purple">
              AAL2 Authentication
            </span>
          </div>
        </div>
        <ThemeToggle />
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-text-primary tracking-tight">
          Enter Authenticator Code
        </h1>
        <p className="text-xs text-text-secondary mt-1">
          Open your authenticator app (Google Authenticator, Authy, etc.) and enter the 6-digit security code for your RemoteHR account.
        </p>
      </div>

      <form onSubmit={handleVerifyTotp} className="space-y-4">
        {isDemoMode && (
          <div className="p-3.5 bg-brand-purple/10 border border-brand-purple/20 rounded-2xl flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-brand-purple flex items-center gap-1">
                <span>⚡ Demo Mode</span>
              </p>
              <p className="text-[11px] text-text-secondary">Skip manual authenticator app code</p>
            </div>
            <button
              type="button"
              onClick={handleAutoFillDemo}
              disabled={isLoading || !factorId}
              className="py-2 px-3.5 rounded-xl bg-brand-purple hover:bg-brand-purple/90 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
            >
              <span>1-Click Sign In</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        <div>
          <label className="text-xs font-bold text-text-secondary block mb-1.5">
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
            className="w-full text-center tracking-[0.35em] text-lg font-mono py-3 px-4 rounded-xl bg-card-subtle border border-border-light text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading || totpCode.length < 6}
          className="w-full mt-2 py-3 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
        >
          <span>{isLoading ? "Verifying..." : "Verify & Continue"}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>

        <div className="text-center pt-2 space-y-2">
          <button
            type="button"
            onClick={() => router.push(`/mfa-setup?redirect=${encodeURIComponent(redirectPath)}`)}
            className="text-xs font-semibold text-brand-purple hover:underline block mx-auto transition-colors"
          >
            Lost access to authenticator? Set up a new device
          </button>
          <button
            type="button"
            onClick={handleSignOut}
            className="text-xs font-semibold text-text-tertiary hover:text-brand-purple flex items-center justify-center gap-1 mx-auto transition-colors"
          >
            <ArrowLeft className="w-3 h-3" />
            <span>Cancel and sign in with a different account</span>
          </button>
        </div>
      </form>

      <div className="mt-8 pt-4 border-t border-border-light/60 flex items-center justify-center gap-1 text-[11px] text-text-tertiary">
        <ShieldCheck className="w-3.5 h-3.5 text-status-success-dot" />
        <span>Hardware & App-Based TOTP (RFC 6238)</span>
      </div>
    </div>
  );
}

export default function MfaChallengePage() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4 select-none">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-shell rounded-[32px] p-8 animate-pulse text-center text-xs text-text-tertiary">
            Loading two-factor challenge...
          </div>
        }
      >
        <MfaChallengeForm />
      </Suspense>
    </div>
  );
}

