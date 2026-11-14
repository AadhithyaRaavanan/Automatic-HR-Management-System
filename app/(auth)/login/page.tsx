"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { sanitizeRedirectPath } from "@/lib/auth/redirect";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { TurnstileCaptcha } from "@/components/shared/turnstile-captcha";
import {
  Clock,
  Mail,
  Lock,
  ArrowRight,
  ArrowLeft,
  KeyRound,
  ShieldCheck,
  Sparkles,
  Users,
  Briefcase,
  UserCheck,
  AlertTriangle,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = sanitizeRedirectPath(searchParams.get("redirect"), "/");

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [authMode, setAuthMode] = React.useState<"password" | "magic-link" | "otp-request" | "otp-verify">("password");
  const [otpCode, setOtpCode] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [resendingOtp, setResendingOtp] = React.useState(false);
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const [lockoutMessage, setLockoutMessage] = React.useState<string | null>(null);

  // Security: Demo role switcher is only accessible in non-production demo mode
  const isDemoMode = isDemoModeEnabled();

  const supabase = createClient();

  const performLogin = async (loginEmail: string, loginPassword: string) => {
    setLockoutMessage(null);
    setIsLoading(true);
    setIsAuthenticating(true);

    try {
      if (authMode === "magic-link") {
        // Magic link flow via Supabase client
        const { error } = await supabase.auth.signInWithOtp({
          email: loginEmail,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(
              redirectPath
            )}`,
          },
        });

        if (error) {
          throw new Error("Unable to send magic link. Please check the email address and try again.");
        }

        toast.success("If an account exists, a secure sign-in link has been sent to your email.");
        setIsAuthenticating(false);
      } else {
        // Authoritative Server-Side Login via /api/auth/login
        // Enforces server-side IP + email sliding-window rate limiting & CAPTCHA validation
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: loginEmail,
            password: loginPassword,
            captchaToken: captchaToken || undefined,
          }),
        });

        const data = await res.json();

        if (res.status === 429) {
          // Account / IP rate limit locked out
          setLockoutMessage(data.error || "Too many failed attempts. Login locked for 15 minutes.");
          toast.error(data.error || "Account locked due to multiple failed attempts.");
          setIsAuthenticating(false);
          return;
        }

        if (!res.ok) {
          // Generic auth error (status 400 or 401)
          setIsAuthenticating(false);
          throw new Error(data.error || "Invalid email or password. Please verify your credentials and try again.");
        }

        // Handle Privileged MFA Routing:
        // Only routes to /mfa-challenge if a verified factor is enrolled
        if (data.requireMfa && data.mfaDestination) {
          toast.info("Two-Factor Authentication required. Please enter your authenticator code.");
          router.push(`${data.mfaDestination}?redirect=${encodeURIComponent(redirectPath)}`);
          return;
        }

        toast.success("Signed in successfully!");
        router.push(redirectPath);
        router.refresh();
      }
    } catch (err: any) {
      setIsAuthenticating(false);
      toast.error(err.message || "Invalid credentials. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    await performLogin(email, password);
  };

  const handleSendOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();
    if (!cleanEmail) {
      toast.error("Please enter your registered workplace email.");
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          turnstileToken: captchaToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to send verification code.");
      }
      toast.success(data.message || "Verification OTP dispatched! Please check your email.");
      setAuthMode("otp-verify");
    } catch (err: any) {
      toast.error(err.message || "Failed to send verification code. Please verify your email.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanCode = otpCode.replace(/\s+/g, "");
    if (cleanCode.length !== 6) {
      toast.error("Please enter the 6-digit code received in your email.");
      return;
    }
    setIsAuthenticating(true);
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/verify-otp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          token: cleanCode,
          turnstileToken: captchaToken || undefined,
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
      setIsAuthenticating(false);
      toast.error(err.message || "Invalid or expired OTP code. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleResendOtp = async () => {
    setResendingOtp(true);
    try {
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          turnstileToken: captchaToken || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to resend code.");
      }
      toast.success(data.message || "A new verification code has been dispatched to your email.");
    } catch (err: any) {
      toast.error(err.message || "Failed to resend code.");
    } finally {
      setResendingOtp(false);
    }
  };

  const handleQuickDemoRole = async (role: string, emailPreset: string) => {
    setEmail(emailPreset);
    setPassword("DemoPassword123!");
    setIsAuthenticating(true);
    toast.info(`Authenticating as ${role} (${emailPreset})...`);
    await performLogin(emailPreset, "DemoPassword123!");
  };

  const isFormDisabled = isLoading || isAuthenticating;

  return (
    <div className="w-full max-w-md bg-shell rounded-[32px] shadow-shell border border-border-light/60 p-8 sm:p-10 relative overflow-hidden">
      {/* Instant Authentication Loading Overlay */}
      {isAuthenticating && (
        <div className="absolute inset-0 z-50 bg-shell/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-200">
          <div className="w-12 h-12 rounded-full border-4 border-brand-purple/20 border-t-brand-purple animate-spin mb-4" />
          <p className="text-sm font-bold text-text-primary tracking-tight">
            Authenticating &amp; Syncing Session...
          </p>
          <p className="text-xs text-text-secondary mt-1 max-w-[240px]">
            Please wait while we verify your credentials and configure your session.
          </p>
        </div>
      )}
      {/* Top Header */}
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
              Attendance Module
            </span>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {/* Title */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-text-primary tracking-tight">
          {authMode === "otp-request"
            ? "Forgot Password"
            : authMode === "otp-verify"
            ? "Verify Email OTP"
            : "Sign In to Workplace"}
        </h1>
        <p className="text-xs text-text-secondary mt-1">
          {authMode === "otp-request"
            ? "Enter your work email to receive a secure one-time login code (OTP)."
            : authMode === "otp-verify"
            ? `Enter the 6-digit OTP code dispatched to ${email}.`
            : "Log your daily sessions, review attendance, and manage team schedules."}
        </p>
      </div>

      {/* Lockout Warning Banner */}
      {lockoutMessage && (
        <div className="mb-4 p-3 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs font-medium flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{lockoutMessage}</span>
        </div>
      )}

      {/* Mode 1: Forgot Password Request OTP */}
      {authMode === "otp-request" && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
              Work Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                disabled={isFormDisabled}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isFormDisabled}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
          >
            <span>{isLoading ? "Sending OTP..." : "Send OTP"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => setAuthMode("password")}
              className="text-xs text-text-secondary hover:text-brand-purple font-semibold inline-flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to password sign in</span>
            </button>
          </div>
        </form>
      )}

      {/* Mode 2: Verify OTP */}
      {authMode === "otp-verify" && (
        <form onSubmit={handleVerifyOtp} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
              6-Digit Verification Code
            </label>
            <div className="relative">
              <KeyRound className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                required
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
                disabled={isFormDisabled}
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-center font-mono tracking-widest text-base font-bold text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isFormDisabled || otpCode.length < 6}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
          >
            <span>{isAuthenticating ? "Verifying..." : "Verify & Login"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center justify-between text-xs pt-2">
            <button
              type="button"
              onClick={() => setAuthMode("otp-request")}
              className="text-text-secondary hover:text-text-primary font-semibold flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Change email</span>
            </button>

            <button
              type="button"
              disabled={resendingOtp}
              onClick={handleResendOtp}
              className="text-brand-purple font-semibold hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${resendingOtp ? "animate-spin" : ""}`} />
              <span>Resend OTP</span>
            </button>
          </div>
        </form>
      )}

      {/* Mode 3: Standard Password & Magic Link Form */}
      {(authMode === "password" || authMode === "magic-link") && (
        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
              Work Email
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="email"
                required
                disabled={isFormDisabled}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all disabled:opacity-50"
              />
            </div>
          </div>

          {authMode === "password" && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-bold text-text-primary uppercase tracking-wider">
                  Password
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={isFormDisabled}
                    onClick={() => setAuthMode("otp-request")}
                    className="text-xs text-text-secondary hover:text-brand-purple font-semibold hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    Forgot Password?
                  </button>
                  <button
                    type="button"
                    disabled={isFormDisabled}
                    onClick={() => setAuthMode("magic-link")}
                    className="text-xs text-brand-purple font-semibold hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    Use Magic Link
                  </button>
                </div>
              </div>
              <div className="relative">
                <Lock className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="password"
                  required
                  disabled={isFormDisabled}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all disabled:opacity-50"
                />
              </div>
            </div>
          )}

          {authMode === "magic-link" && (
            <div className="flex items-center justify-between">
              <Link
                href="/forgot-password"
                className="text-xs text-text-secondary hover:text-brand-purple font-semibold hover:underline"
              >
                Forgot Password?
              </Link>
              <button
                type="button"
                disabled={isFormDisabled}
                onClick={() => setAuthMode("password")}
                className="text-xs text-brand-purple font-semibold hover:underline disabled:opacity-50 cursor-pointer"
              >
                Use Password instead
              </button>
            </div>
          )}

          {/* Cloudflare Turnstile Captcha Widget */}
          <TurnstileCaptcha
            onVerify={(token) => setCaptchaToken(token)}
            onExpire={() => setCaptchaToken(null)}
            onError={() => setCaptchaToken(null)}
          />

          <button
            type="submit"
            disabled={isFormDisabled}
            className="w-full mt-2 py-3 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
          >
            <span>
              {isAuthenticating
                ? "Authenticating..."
                : isLoading
                ? "Signing in..."
                : authMode === "magic-link"
                ? "Send Magic Link"
                : "Sign In"}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      )}

      {/* Demo Roles Quick-Fill Card (Gated behind NEXT_PUBLIC_DEMO_MODE=true) */}
      {isDemoMode && (
        <div className="mt-8 pt-6 border-t border-border-light/60">
          <div className="flex items-center justify-between mb-2.5">
            <span className="text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
              Demo Mode Presets:
            </span>
            <span className="text-[10px] font-bold text-brand-purple bg-brand-purple-light/40 px-2 py-0.5 rounded-full">
              Non-Production
            </span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={isFormDisabled}
              onClick={() => handleQuickDemoRole("Employee", "employee@remotehr.io")}
              className="py-1.5 px-2 rounded-lg bg-card-subtle hover:bg-brand-purple-light/50 text-text-primary hover:text-brand-purple text-[11px] font-semibold border border-border-light flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Users className="w-3 h-3 text-brand-purple" />
              <span>Employee</span>
            </button>

            <button
              type="button"
              disabled={isFormDisabled}
              onClick={() => handleQuickDemoRole("Manager", "manager@remotehr.io")}
              className="py-1.5 px-2 rounded-lg bg-card-subtle hover:bg-brand-purple-light/50 text-text-primary hover:text-brand-purple text-[11px] font-semibold border border-border-light flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <UserCheck className="w-3 h-3 text-brand-purple" />
              <span>Manager</span>
            </button>

            <button
              type="button"
              disabled={isFormDisabled}
              onClick={() => handleQuickDemoRole("HR Ops", "hr@remotehr.io")}
              className="py-1.5 px-2 rounded-lg bg-card-subtle hover:bg-brand-purple-light/50 text-text-primary hover:text-brand-purple text-[11px] font-semibold border border-border-light flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <Briefcase className="w-3 h-3 text-brand-purple" />
              <span>HR Admin</span>
            </button>

            <button
              type="button"
              disabled={isFormDisabled}
              onClick={() => handleQuickDemoRole("System Admin", "admin@remotehr.io")}
              className="py-1.5 px-2 rounded-lg bg-card-subtle hover:bg-brand-purple-light/50 text-text-primary hover:text-brand-purple text-[11px] font-semibold border border-border-light flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="w-3 h-3 text-brand-purple" />
              <span>Super Admin</span>
            </button>
          </div>
        </div>
      )}

      {/* Security & Privacy Notice Footer */}
      <div className="mt-6 flex items-center justify-between text-[11px] text-text-tertiary">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-status-success-dot" />
          Supabase Auth RLS
        </span>
        <span className="flex items-center gap-1">
          <Sparkles className="w-3.5 h-3.5 text-brand-purple" />
          Zero Invasive Monitoring
        </span>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-4 select-none">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-shell rounded-[32px] p-8 animate-pulse text-center text-xs text-text-tertiary">
            Loading sign-in...
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
