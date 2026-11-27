"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { sanitizeRedirectPath } from "@/features/auth/redirect";
import { KeyRound, ShieldCheck, Copy, Check, ArrowRight, ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

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
        const { data: factorData, error: listError } = await supabase.auth.mfa.listFactors();
        if (!active) return;
        if (!listError && factorData) {
          const verified = factorData.totp?.find((f) => f.status === "verified");
          if (verified) {
            router.push(`/mfa-challenge?redirect=${encodeURIComponent(redirectPath)}&reset=true`);
            return;
          }

          if (factorData.all && factorData.all.length > 0) {
            for (const f of factorData.all) {
              if (f.status === "unverified") {
                await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
              }
            }
          }
        }

        const friendlySuffix = `${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;
        const { data, error } = await supabase.auth.mfa.enroll({
          factorType: "totp",
          issuer: "Pulse",
          friendlyName: `Pulse-${friendlySuffix}`,
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
      <div className="w-full max-w-md bg-white rounded-[14px] border border-[#E6E6E6] p-8 text-center text-xs text-[#808080] animate-pulse">
        Initializing authenticator enrollment...
      </div>
    );
  }

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
              Two-Factor Setup
            </h2>
            <span className="text-xs text-[#808080]">
              Account Protection
            </span>
          </div>
        </div>
      </div>

      <div className="mb-4">
        <h1 className="text-xl font-bold text-black tracking-tight">
          Protect Your Workplace Account
        </h1>
        <p className="text-xs text-[#4D4D4D] mt-1 leading-relaxed">
          Add an extra layer of security. Enter the setup key below into Google Authenticator, Authy, or 1Password to activate Two-Factor Authentication.
        </p>
      </div>

      {enrollData && (
        <div className="space-y-4">
          <div className="flex flex-col items-center bg-[#F5F5F5] p-5 rounded-xl border border-[#E6E6E6] text-center">
            <span className="text-[11px] font-bold uppercase tracking-wider text-[#808080] block mb-2">
              Two-Factor Setup Key
            </span>
            <div className="w-full bg-white p-3 rounded-lg border border-[#E6E6E6] font-mono text-sm sm:text-base font-bold tracking-widest text-black select-all text-center break-all mb-3 shadow-inner">
              <span data-testid="mfa-secret">
                {enrollData.secret.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") || enrollData.secret}
              </span>
            </div>

            <button
              type="button"
              onClick={handleCopySecret}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-all shadow-xs cursor-pointer"
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
            <p className="text-[11px] text-[#808080] mt-2">
              Paste this key into your authenticator app to generate 6-digit confirmation codes.
            </p>
          </div>

          <form onSubmit={handleVerify} className="space-y-3">
            {isDemoMode && (
              <div className="p-3 bg-[#F5F5F5] border border-[#E6E6E6] rounded-xl flex items-center justify-between gap-2 mb-2">
                <div>
                  <p className="text-xs font-bold text-black flex items-center gap-1">
                    <span>⚡ Demo Mode</span>
                  </p>
                  <p className="text-[11px] text-[#4D4D4D]">Skip manual setup key entry</p>
                </div>
                <button
                  type="button"
                  onClick={handleDemoAutoVerify}
                  disabled={isVerifying}
                  className="py-1.5 px-3 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-all shadow-xs flex items-center gap-1 active:scale-95 disabled:opacity-50 cursor-pointer shrink-0"
                >
                  <span>1-Click Complete</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-black block mb-1">
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
                className="w-full text-center tracking-[0.35em] text-lg font-mono py-2.5 px-4 rounded-lg bg-white border border-[#E6E6E6] text-black placeholder:text-[#808080] focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-all"
              />
            </div>

            <button
              type="submit"
              disabled={isVerifying || verifyCode.length < 6}
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>{isVerifying ? "Activating..." : "Confirm & Enable 2FA"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={handleSignOut}
              className="text-xs font-medium text-[#808080] hover:text-black flex items-center justify-center gap-1 mx-auto transition-colors hover:underline"
            >
              <ArrowLeft className="w-3 h-3" />
              <span>Cancel and sign out</span>
            </button>
          </div>
        </div>
      )}

      <div className="mt-8 pt-4 border-t border-[#E6E6E6] flex items-center justify-center gap-1 text-[11px] text-[#808080]">
        <ShieldCheck className="w-3.5 h-3.5 text-black" />
        <span>Hardware & App-Based TOTP (RFC 6238)</span>
      </div>
    </div>
  );
}

export default function MfaSetupPage() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-4 select-none">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-white rounded-[14px] border border-[#E6E6E6] p-8 animate-pulse text-center text-xs text-[#808080]">
            Loading two-factor enrollment...
          </div>
        }
      >
        <MfaSetupForm />
      </Suspense>
    </div>
  );
}
