"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, ShieldAlert, KeyRound, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export function TotpMfaManager() {
  const [factors, setFactors] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isEnrolling, setIsEnrolling] = React.useState(false);
  const [enrollData, setEnrollData] = React.useState<{
    factorId: string;
    secret: string;
  } | null>(null);
  const [verifyCode, setVerifyCode] = React.useState("");
  const [isVerifying, setIsVerifying] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const supabase = createClient();

  const fetchFactors = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      setFactors(data.totp || []);
    } catch {
      // In offline / mock dev mode, gracefully fail
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    fetchFactors();
  }, [fetchFactors]);

  const handleStartEnrollment = async () => {
    setIsEnrolling(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        issuer: "RemoteHR",
      });

      if (error) throw error;

      setEnrollData({
        factorId: data.id,
        secret: data.totp.secret,
      });
      toast.info("Setup key generated! Copy the key into your authenticator app.");
    } catch (err: any) {
      toast.error(err.message || "Failed to initiate MFA enrollment.");
      setIsEnrolling(false);
    }
  };

  const handleVerifyEnrollment = async (e: React.FormEvent) => {
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
        toast.error("Invalid code. Please ensure your device clock is synchronized and try again.");
        return;
      }

      toast.success("Two-Factor Authentication activated and verified successfully!");
      setEnrollData(null);
      setVerifyCode("");
      setIsEnrolling(false);
      await fetchFactors();
    } catch {
      toast.error("Failed to verify two-factor authentication.");
    } finally {
      setIsVerifying(false);
    }
  };

  const handleUnenroll = async (factorId: string) => {
    if (!confirm("Are you sure you want to disable two-factor authentication? Your account will use single-factor login.")) {
      return;
    }

    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast.success("Two-Factor Authentication disabled.");
      await fetchFactors();
    } catch (err: any) {
      toast.error(err.message || "Failed to disable MFA.");
    }
  };

  const handleCopySecret = () => {
    if (!enrollData?.secret) return;
    navigator.clipboard.writeText(enrollData.secret);
    setCopied(true);
    toast.success("Setup key copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  const verifiedFactor = factors.find((f) => f.status === "verified");

  if (isLoading) {
    return (
      <div className="p-4 rounded-2xl bg-card-subtle text-xs text-text-tertiary animate-pulse flex items-center justify-center">
        Checking Two-Factor Authentication status...
      </div>
    );
  }

  const formattedSecret = enrollData?.secret
    ? enrollData.secret.replace(/\s+/g, "").match(/.{1,4}/g)?.join(" ") || enrollData.secret
    : "";

  return (
    <div className="space-y-4">
      {verifiedFactor ? (
        <div className="p-5 rounded-2xl bg-card border border-border-light shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-status-success-dot/15 text-status-success-text flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5 text-status-success-dot" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-text-primary">
                  Two-Factor Authentication (2FA)
                </h4>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-status-success-dot/20 text-status-success-text">
                  Active (AAL2)
                </span>
              </div>
              <p className="text-[11px] text-text-secondary mt-1">
                Your account is protected by TOTP authenticator security. Authenticator codes are required at privileged login.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={true}
              onClick={() => handleUnenroll(verifiedFactor.id)}
              className="relative inline-flex h-6 w-11 items-center rounded-full bg-status-success-dot transition-colors cursor-pointer"
              title="Click to disable 2FA"
            >
              <span className="inline-block h-4 w-4 transform rounded-full bg-white transition-transform translate-x-6 shadow-sm" />
            </button>
            <button
              type="button"
              onClick={() => handleUnenroll(verifiedFactor.id)}
              className="text-xs font-semibold text-status-danger-text hover:underline cursor-pointer"
            >
              Disable 2FA
            </button>
          </div>
        </div>
      ) : isEnrolling && enrollData ? (
        <div className="p-5 rounded-2xl bg-card border border-brand-purple/30 shadow-md space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-purple" />
            <h4 className="text-xs font-extrabold text-text-primary">
              Two-Factor Authentication Setup Key
            </h4>
          </div>

          <p className="text-[11px] text-text-secondary">
            Enter the setup key below directly into Google Authenticator, Authy, or 1Password. (QR code removed per security policy).
          </p>

          <div className="flex flex-col items-center bg-card-subtle p-5 rounded-xl border border-border-light text-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block mb-2">
              Setup Key
            </span>
            <div className="w-full bg-card p-3 rounded-lg border border-border-light font-mono text-sm sm:text-base font-extrabold tracking-widest text-text-primary select-all text-center break-all mb-3 shadow-inner">
              <span data-testid="mfa-secret">{formattedSecret}</span>
            </div>

            <button
              type="button"
              onClick={handleCopySecret}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Setup Key Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>Copy Setup Key</span>
                </>
              )}
            </button>
            <p className="text-[10px] text-text-tertiary mt-2">
              Account: RemoteHR • Key Type: Time-based (TOTP)
            </p>
          </div>

          <form onSubmit={handleVerifyEnrollment} className="space-y-3 pt-1">
            <label className="block text-xs font-bold text-text-primary">
              Enter 6-digit confirmation code from your authenticator app:
            </label>
            <div className="flex items-center gap-2 max-w-xs">
              <input
                type="text"
                required
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                autoComplete="one-time-code"
                value={verifyCode}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, "").slice(0, 6);
                  setVerifyCode(val);
                  if (val.length === 6 && !isVerifying) {
                    setTimeout(() => {
                      (e.target.form as HTMLFormElement)?.requestSubmit();
                    }, 60);
                  }
                }}
                placeholder="123456"
                className="w-full text-center tracking-widest font-mono text-sm py-2 px-3 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:outline-none focus:border-brand-purple"
              />
              <button
                type="submit"
                disabled={isVerifying || verifyCode.length < 6}
                className="px-4 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm disabled:opacity-50 cursor-pointer shrink-0"
              >
                {isVerifying ? "Verifying..." : "Activate"}
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsEnrolling(false);
                setEnrollData(null);
              }}
              className="text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
            >
              Cancel enrollment
            </button>
          </form>
        </div>
      ) : (
        <div className="p-5 rounded-2xl bg-card border border-border-light shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-xl bg-card-subtle border border-border-light text-text-tertiary flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-status-warning-dot" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-text-primary">
                  Two-Factor Authentication (2FA)
                </h4>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-card-subtle text-text-tertiary border border-border-light">
                  Disabled (Opt-In)
                </span>
              </div>
              <p className="text-[11px] text-text-tertiary mt-1">
                2FA is optional. When enabled, you will be prompted for an authenticator code during login.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <button
              type="button"
              role="switch"
              aria-checked={false}
              onClick={handleStartEnrollment}
              className="relative inline-flex h-6 w-11 items-center rounded-full bg-card-subtle border border-border-light transition-colors cursor-pointer"
              title="Click to enable 2FA"
            >
              <span className="inline-block h-4 w-4 transform rounded-full bg-text-tertiary transition-transform translate-x-1 shadow-sm" />
            </button>
            <button
              type="button"
              onClick={handleStartEnrollment}
              className="px-3.5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer shrink-0 active:scale-95"
            >
              Enable 2FA
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
