"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import {
  Clock,
  Mail,
  KeyRound,
  ArrowRight,
  ArrowLeft,
  CheckCircle2,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

function ForgotPasswordContent() {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);

  const [step, setStep] = React.useState<"request" | "verify">("request");
  const [email, setEmail] = React.useState("");
  const [otpCode, setOtpCode] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [resending, setResending] = React.useState(false);

  // Step 1: Request OTP
  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      toast.error("Please enter your registered workplace email.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: cleanEmail }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send verification code.");
      }

      toast.success(data.message || "Verification OTP dispatched! Please check your email.");
      setStep("verify");
    } catch (err: any) {
      toast.error(err.message || "Failed to send verification code. Please verify your email.");
    } finally {
      setLoading(false);
    }
  };

  // Step 2: Verify OTP and Establish Session
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = otpCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) {
      toast.error("Please enter the 6-digit code received in your email.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          token: cleanCode,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Invalid or expired verification code.");
      }

      if (data.requireMfa && data.mfaDestination) {
        toast.info(data.message || "Please complete Two-Factor Authentication.");
        router.push(data.mfaDestination);
      } else {
        toast.success(data.message || "Logged in successfully. Please set your new password.");
        router.push(data.mfaDestination || "/settings?must_change_password=true");
      }
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Invalid or expired OTP code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResending(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to resend code.");
      toast.success(data.message || "A new verification code has been dispatched to your email.");
    } catch (err: any) {
      toast.error(err.message || "Failed to resend code.");
    } finally {
      setResending(false);
    }
  };

  return (
    <div className="w-full max-w-md bg-shell rounded-[32px] shadow-shell border border-border-light/60 p-8 sm:p-10 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-brand-purple flex items-center justify-center text-white shadow-float">
            <Clock className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-base font-extrabold text-text-primary tracking-tight">
              RemoteHR
            </h2>
            <span className="text-[11px] font-bold uppercase tracking-wider text-brand-purple">
              Account Recovery
            </span>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {step === "request" ? (
        <>
          {/* Step 1: Request OTP Form */}
          <div className="mb-6">
            <h1 className="text-2xl font-extrabold text-text-primary tracking-tight">
              Forgot Password
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              Enter your registered work email to receive a secure one-time verification code (OTP).
            </p>
          </div>

          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label
                htmlFor="recovery-email"
                className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
              >
                Work Email Address
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="recovery-email"
                  type="email"
                  required
                  disabled={loading}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
            >
              <span>{loading ? "Sending OTP..." : "Send OTP"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </>
      ) : (
        <>
          {/* Step 2: Verify OTP Form */}
          <div className="mb-6">
            <h1 className="text-2xl font-extrabold text-text-primary tracking-tight">
              Verify Email OTP
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              We sent a 6-digit code to <strong className="text-text-primary font-mono">{email}</strong>. Enter it below to sign in and set your new password.
            </p>
          </div>

          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label
                htmlFor="otp-code"
                className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
              >
                6-Digit Verification Code
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  id="otp-code"
                  type="text"
                  required
                  maxLength={6}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  disabled={loading}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-center font-mono tracking-widest text-base font-bold text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otpCode.length < 6}
              className="w-full mt-2 py-3 px-4 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
            >
              <span>{loading ? "Verifying..." : "Verify & Login"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center justify-between text-xs pt-2">
              <button
                type="button"
                onClick={() => setStep("request")}
                className="text-text-secondary hover:text-text-primary font-semibold flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Change email</span>
              </button>

              <button
                type="button"
                disabled={resending}
                onClick={handleResendOtp}
                className="text-brand-purple font-semibold hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${resending ? "animate-spin" : ""}`} />
                <span>Resend OTP</span>
              </button>
            </div>
          </form>
        </>
      )}

      {/* Back to Sign In Link */}
      <div className="mt-8 pt-6 border-t border-border-light/60 text-center">
        <Link
          href="/login"
          className="text-xs font-semibold text-text-secondary hover:text-brand-purple transition-colors inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to Sign In</span>
        </Link>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <div className="min-h-screen w-full bg-shell flex flex-col items-center justify-center p-4 sm:p-6 transition-colors duration-300">
      <Suspense fallback={<div className="text-xs text-text-tertiary">Loading recovery portal...</div>}>
        <ForgotPasswordContent />
      </Suspense>
    </div>
  );
}
