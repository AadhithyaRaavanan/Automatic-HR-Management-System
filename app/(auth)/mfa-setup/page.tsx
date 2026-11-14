"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { KeyRound, ShieldCheck, Copy, Check, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";

function MfaSetupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = sanitizeRedirectPath(searchParams.get("redirect"), "/");

  const [isLoading, setIsLoading] = React.useState(true);
  const [enrollData, setEnrollData] = React.useState<{
    factorId: string;
    secret: string;
  } | null>(null);
  const [verifyCode, setVerifyCode] = React.useState("");
  const [isVerifying, setIsVerifying] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const isDemoMode = isDemoModeEnabled();

  const supabase = React.useMemo(() => createClient(), []);

  React.useEffect(() => {
    let active = true;
    async function initEnrollment() {
      setIsLoading(true);
      try {
        // 1. Check if user already has a verified factor, and clean up unverified stale factors
        const { data: factorData, error: listError } = await supabase.auth.mfa.listFactors();
        if (!active) return;
        if (!listError && factorData) {
          const verified = factorData.totp?.find((f) => f.status === "verified");
          if (verified) {
            // Already enrolled - redirect to challenge
            router.push(`/mfa-challenge?redirect=${encodeURIComponent(redirectPath)}`);
            return;
          }

          // Clean up any stale unverified factors from previous incomplete sessions
          if (factorData.all && factorData.all.length > 0) {
            for (const f of factorData.all) {
              if (f.status === "unverified") {
                await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
              }
            }
          }
        }

        // 2. Initiate TOTP enrollment with unique friendlyName to avoid parallel session collisions
        const friendlySuffix = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
        const { data, error } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          issuer: "RemoteHR",
          friendlyName: `RemoteHR-${friendlySuffix}`,
        });

        if (!active) return;
        if (error) throw error;

        setEnrollData({
          factorId: data.id,
          secret: data.totp.secret,
        });
      } catch (err: any) {
        if (active) {
          toast.error(err.message || "Failed to start two-factor enrollment.");
        }
      } finally {
        if (active) {
          setIsLoading(false);
        }
      }
    }

    initEnrollment();
    return () => {
      active = false;
    };
  }, [supabase, router, redirectPath]);

  const handleVerify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!enrollData) return;

    const cleanCode = verifyCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) {
      toast.error("Please enter a valid 6-digit code.");
      return;
    }

    setIsVerifying(true);
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollData.factorId,
        code: cleanCode,
      });

      if (error) {
        toast.error("Invalid verification code. Please check your authenticator app and try again.");
        return;
      }

      toast.success("Two-Factor Authentication activated and verified!");
      window.location.href = redirectPath;
    } catch {
      toast.error("Verification failed. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleDemoAutoVerify = async () => {
    if (!enrollData?.secret || !enrollData?.factorId) return;
    setIsVerifying(true);
    try {
      const res = await fetch("/api/auth/demo-totp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: enrollData.secret }),
      });
      const data = await res.json();
      if (!res.ok || !data.code) {
        throw new Error(data.error || "Failed to generate demo code");
      }
      setVerifyCode(data.code);

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollData.factorId,
        code: data.code,
      });
      if (error) throw error;
      toast.success("Two-Factor Authentication activated and verified!");
      window.location.href = redirectPath;
    } catch (err: any) {
      toast.error(err.message || "Demo verification failed");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleCopySecret = () => {
    if (!enrollData?.secret) return;
    navigator.clipboard.writeText(enrollData.secret);
    setCopied(true);
    toast.success("Setup key copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
  };

  if (isLoading) {
    return (
      <div className="w-full max-w-md bg-shell rounded-[32px] p-8 text-center text-xs text-text-tertiary animate-pulse">
        Initializing authenticator enrollment...
      </div>
    );
  }

  return (
    <div className="w-full max-w-md bg-shell rounded-[32px] shadow-shell border border-border-light/60 p-8 sm:p-10 relative overflow-hidden">
      {/* Top Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-brand-purple flex items-center justify-center text-white shadow-float">
            <KeyRound className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-text-primary tracking-tight">
              Two-Factor Setup
            </h2>
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-purple">
              Account Protection
            </span>
          </div>
        </div>
        <ThemeToggle />
      </div>

      <div className="mb-4">
        <h1 className="text-xl font-extrabold text-text-primary tracking-tight">
          Protect Your Workplace Account
        </h1>
        <p className="text-xs text-text-secondary mt-1">
          Add an extra layer of security. Enter the setup key below into Google Authenticator, Authy, or 1Password to activate Two-Factor Authentication.
        </p>
      </div>

      {enrollData && (
        <div className="space-y-4">
          {/* Setup Key Display (QR code removed per security spec) */}
          <div className="flex flex-col items-center bg-card-subtle p-5 rounded-2xl border border-border-light text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary block mb-2">
              Two-Factor Setup Key
            </span>
            <div className="w-full bg-card p-3.5 rounded-xl border border-border-light font-mono text-sm sm:text-base font-extrabold tracking-widest text-text-primary select-all text-center break-all mb-3 shadow-inner">
              <span data-testid="mfa-secret">
                {enrollData.secret.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") || enrollData.secret}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopySecret}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-4 h-4 text-white" />
                  <span>Setup Key Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-4 h-4" />
                  <span>Copy Setup Key</span>
                </>
              )}
            </button>
            <p className="text-[11px] text-text-tertiary mt-2">
              Paste this key into your authenticator app to generate 6-digit confirmation codes.
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-3">
            {isDemoMode && (
              <div className="p-3 bg-brand-purple/10 border border-brand-purple/20 rounded-2xl flex items-center justify-between gap-2 mb-2">
                <div>
                  <p className="text-xs font-bold text-brand-purple flex items-center gap-1">
                    <span>⚡ Demo Mode</span>
                  </p>
                  <p className="text-[11px] text-text-secondary">Skip manual setup key entry</p>
                </div>
                <button
                  type="button"
                  onClick={handleDemoAutoVerify}
                  disabled={isVerifying}
                  className="py-1.5 px-3 rounded-xl bg-brand-purple hover:bg-brand-purple/90 text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  <span>1-Click Complete</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div>
              <label className="text-xs font-bold text-text-secondary block mb-1">
                Enter 6-Digit Code from App
              </label>
              <input
                type="text"
                required
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="000 000"
                className="w-full text-center tracking-[0.3em] font-mono text-base py-2.5 px-4 rounded-xl bg-card-subtle border border-border-light text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple"
              />
            </div>

            <button
              type="submit"
              disabled={isVerifying || verifyCode.length < 6}
              className="w-full py-3 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
            >
              <span>{isVerifying ? "Verifying..." : "Confirm & Complete Enrollment"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>
      )}

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={handleSignOut}
          className="text-xs text-text-tertiary hover:text-text-primary flex items-center justify-center gap-1 mx-auto"
        >
          <ArrowLeft className="w-3 h-3" />
          <span>Sign out and return to login</span>
        </button>
      </div>

      <div className="mt-6 pt-3 border-t border-border-light/60 flex items-center justify-center gap-1.5 text-[11px] text-text-tertiary">
        <ShieldCheck className="w-3.5 h-3.5 text-status-success-dot" />
        <span>RFC 6238 Standard Time-Based Authentication</span>
      </div>
    </div>
  );
}

export default function MfaSetupPage() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4 select-none">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-shell rounded-[32px] p-8 text-center text-xs text-text-tertiary animate-pulse">
            Loading setup...
          </div>
        }
      >
        <MfaSetupForm />
      </Suspense>
    </div>
  );
}

