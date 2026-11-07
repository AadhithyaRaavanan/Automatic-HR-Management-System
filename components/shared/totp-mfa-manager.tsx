"use client";

import * as React from "react";
import { createClient } from "@/lib/supabase/client";
import { ShieldCheck, ShieldAlert, KeyRound, Copy, Check, RefreshCw } from "lucide-react";
import { toast } from "sonner";

export function TotpMfaManager() {
  const [factors, setFactors] = React.useState<any[]>([]);
  const [isLoading, setIsLoading] = React.useState(true);
  const [isEnrolling, setIsEnrolling] = React.useState(false);
  const [enrollData, setEnrollData] = React.useState<{
    factorId: string;
    qrCode: string;
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
        qrCode: data.totp.qr_code,
        secret: data.totp.secret,
      });
      toast.info("Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.).");
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
      const { data, error } = await supabase.auth.mfa.challengeAndVerify({
        factorId: enrollData.factorId,
        code: cleanCode,
      });

      if (error) {
        toast.error("Invalid code. Please ensure your device clock is synchronized and try again.");
        return;
      }

      toast.success("Two-Factor Authentication activated successfully!");
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
    if (!confirm("Are you sure you want to disable two-factor authentication? Privileged roles (HR & Admin) require MFA to access management tools.")) {
      return;
    }

    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
      toast.success("Two-factor authentication factor removed.");
      await fetchFactors();
    } catch (err: any) {
      toast.error(err.message || "Failed to disable MFA.");
    }
  };

  const handleCopySecret = () => {
    if (!enrollData?.secret) return;
    navigator.clipboard.writeText(enrollData.secret);
    setCopied(true);
    toast.success("Secret key copied to clipboard!");
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

  return (
    <div className="space-y-4">
      {verifiedFactor ? (
        <div className="p-4 rounded-2xl bg-status-success-bg/30 border border-status-success-dot/30 flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-xl bg-status-success-dot text-white flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold text-text-primary">
                  Two-Factor Authentication Active
                </h4>
                <span className="text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full bg-status-success-dot/20 text-status-success-text">
                  AAL2 Enforced
                </span>
              </div>
              <p className="text-[11px] text-text-secondary mt-1">
                Your account is protected by TOTP hardware/app authentication (RFC 6238). HR and Admin privileged actions are authorized.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => handleUnenroll(verifiedFactor.id)}
            className="text-xs font-semibold text-status-danger-text hover:underline cursor-pointer shrink-0"
          >
            Remove Factor
          </button>
        </div>
      ) : isEnrolling && enrollData ? (
        <div className="p-5 rounded-2xl bg-card border border-brand-purple/30 shadow-md space-y-4">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-brand-purple" />
            <h4 className="text-xs font-extrabold text-text-primary">
              Enroll TOTP Authenticator
            </h4>
          </div>

          <p className="text-[11px] text-text-secondary">
            Scan the QR code below using Google Authenticator, Authy, 1Password, or any RFC 6238 compatible app.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 bg-card-subtle p-4 rounded-xl border border-border-light">
            <div className="bg-white p-2 rounded-xl shadow-sm border border-border-light shrink-0">
              {/* QR Code SVG / Data URL */}
              <img
                src={enrollData.qrCode}
                alt="TOTP Authenticator QR Code"
                className="w-32 h-32 block"
              />
            </div>

            <div className="flex-1 space-y-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-text-tertiary block">
                Can't scan? Use manual setup key:
              </span>
              <div className="flex items-center gap-2 bg-card p-2 rounded-lg border border-border-light font-mono text-xs text-text-primary select-all break-all">
                <span>{enrollData.secret}</span>
                <button
                  type="button"
                  onClick={handleCopySecret}
                  className="p-1 hover:text-brand-purple text-text-tertiary transition-colors"
                  title="Copy secret"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-status-success-dot" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
              <p className="text-[10px] text-text-tertiary">
                Account: RemoteHR • Key Type: Time-based (TOTP)
              </p>
            </div>
          </div>

          <form onSubmit={handleVerifyEnrollment} className="space-y-3 pt-1">
            <label className="block text-xs font-bold text-text-primary">
              Enter 6-digit confirmation code from your app:
            </label>
            <div className="flex items-center gap-2 max-w-xs">
              <input
                type="text"
                required
                maxLength={6}
                pattern="[0-9]*"
                inputMode="numeric"
                value={verifyCode}
                onChange={(e) => setVerifyCode(e.target.value)}
                placeholder="000 000"
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
        <div className="p-4 rounded-2xl bg-card-subtle border border-border-light flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-card border border-border-light text-text-tertiary flex items-center justify-center shrink-0">
              <ShieldAlert className="w-5 h-5 text-status-warning-dot" />
            </div>
            <div>
              <h4 className="text-xs font-bold text-text-primary">
                Two-Factor Authentication is Not Enabled
              </h4>
              <p className="text-[11px] text-text-tertiary mt-0.5">
                Protect your account with a hardware or mobile authenticator app. Required for HR and Admin privileges.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleStartEnrollment}
            className="px-3.5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer shrink-0 active:scale-95"
          >
            Enable TOTP MFA
          </button>
        </div>
      )}
    </div>
  );
}

