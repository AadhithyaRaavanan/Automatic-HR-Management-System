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
    <div className="w-full max-w-md bg-card rounded-xl border border-border-light p-8 relative overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-brand-navy flex items-center justify-center text-white font-semibold text-sm">
            P
          </div>
          <div>
            <h2 className="text-sm font-semibold text-text-primary tracking-tight">
              Pulse
            </h2>
            <span className="text-xs text-text-tertiary">
              Account recovery
            </span>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {step === "request" ? (
        <>
          {/* Step 1: Request OTP Form */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-text-primary tracking-tight">
              Forgot password
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              Enter your registered work email to receive a secure one-time verification code.
            </p>
          </div>

          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label
                htmlFor="recovery-email"
                className="block text-xs font-medium text-text-primary mb-1.5"
              >
                Work email address
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
                  className="w-full pl-10 pr-4 py-2 rounded-lg bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-1 focus:ring-brand-purple/20 transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>{loading ? "Sending code..." : "Send code"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </>
      ) : (
        <>
          {/* Step 2: Verify OTP Form */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-text-primary tracking-tight">
              Verify email code
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              We sent a 6-digit code to <strong className="text-text-primary font-mono">{email}</strong>. Enter it below to sign in and set your new password.
            </p>
          </div>

          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label
                htmlFor="otp-code"
                className="block text-xs font-medium text-text-primary mb-1.5"
              >
                6-digit verification code
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
                  className="w-full pl-10 pr-4 py-2 rounded-lg bg-card-subtle border border-border-light text-center font-mono tracking-widest text-base font-semibold text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-1 focus:ring-brand-purple/20 transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || otpCode.length < 6}
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
            >
              <span>{loading ? "Verifying..." : "Verify and sign in"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center justify-between text-xs pt-2">
              <button
                type="button"
                onClick={() => setStep("request")}
                className="text-text-secondary hover:text-text-primary font-medium flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Change email</span>
              </button>

              <button
                type="button"
                disabled={resending}
                onClick={handleResendOtp}
                className="text-brand-purple font-medium hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${resending ? "animate-spin" : ""}`} />
                <span>Resend code</span>
              </button>
            </div>
          </form>
        </>
      )}

      {/* Back to Sign In Link */}
      <div className="mt-6 pt-5 border-t border-border-light/60 text-center">
        <Link
          href="/login"
          className="text-xs font-medium text-text-secondary hover:text-brand-purple transition-colors inline-flex items-center gap-1.5"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          <span>Back to sign in</span>
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
