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
  CheckCircle2,
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
        // Authoritative server-side magic link via /api/auth/magic-link
        const res = await fetch("/api/auth/magic-link", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email: loginEmail,
            redirectPath,
            turnstileToken: captchaToken || undefined,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || "Unable to send magic link. Please check the email address and try again.");
        }

        toast.success(data.message || "A secure sign-in link and verification code have been dispatched to your email.");
        setAuthMode("otp-verify");
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
          if (isDemoMode) {
            const role =
              loginEmail.includes("admin") ? "admin" :
              loginEmail.includes("hr") ? "hr" :
              loginEmail.includes("manager") ? "manager" : "employee";
            if (typeof window !== "undefined") {
              try {
                localStorage.setItem("remotehr_cached_role", role);
                document.cookie = `remotehr_role=${role}; path=/; max-age=2592000; SameSite=Lax`;
              } catch {}
            }
            toast.success(`Signed in as ${role.toUpperCase()} (Demo Mode)!`);
            router.push(redirectPath);
            router.refresh();
            return;
          }
          // Generic auth error (status 400 or 401)
          setIsAuthenticating(false);
          throw new Error(data.error || "Invalid email or password. Please verify your credentials and try again.");
        }

        // Handle MFA Routing (2FA challenge or setup):
        if (data.requireMfa && data.mfaDestination) {
          toast.info(
            data.mfaDestination === "/mfa-setup"
              ? "Please complete two-factor authentication setup."
              : "Two-Factor Authentication required. Please enter your authenticator code."
          );
          router.push(`${data.mfaDestination}?redirect=${encodeURIComponent(redirectPath)}`);
          return;
        }

        if (typeof window !== "undefined" && data.role) {
          try {
            localStorage.setItem("remotehr_cached_role", data.role);
          } catch {}
        }

        // Onboarding required -> /onboarding
        if (data.onboardingRequired || data.destination === "/onboarding" || data.mfaDestination === "/onboarding") {
          toast.success("Welcome aboard! Please complete your mandatory employee onboarding.");
          router.push("/onboarding");
          router.refresh();
          return;
        }

        // Pending HR approval -> /onboarding/pending
        if (data.destination === "/onboarding/pending" || data.mfaDestination === "/onboarding/pending") {
          toast.info("Your onboarding profile is currently under review.");
          router.push("/onboarding/pending");
          router.refresh();
          return;
        }

        // Must change password or specific destination -> route directly
        if (data.destination) {
          toast.success("Signed in successfully!");
          router.push(data.destination);
          router.refresh();
          return;
        }

        toast.success("Signed in successfully!");
        router.push(redirectPath);
        router.refresh();
      }
    } catch (err: any) {
      if (isDemoMode) {
        const role =
          loginEmail.includes("admin") ? "admin" :
          loginEmail.includes("hr") ? "hr" :
          loginEmail.includes("manager") ? "manager" : "employee";
        if (typeof window !== "undefined") {
          try {
            localStorage.setItem("remotehr_cached_role", role);
            document.cookie = `remotehr_role=${role}; path=/; max-age=2592000; SameSite=Lax`;
          } catch {}
        }
        toast.success(`Signed in as ${role.toUpperCase()} (Demo Mode)!`);
        router.push(redirectPath);
        router.refresh();
        return;
      }
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
    const normalizedRole = role.toLowerCase().replace("system ", "").replace(" ops", "").trim();
    if (typeof window !== "undefined") {
      try {
        localStorage.setItem("remotehr_cached_role", normalizedRole);
      } catch {}
    }
    toast.info(`Authenticating as ${role} (${emailPreset})...`);
    await performLogin(emailPreset, "DemoPassword123!");
  };

  const isFormDisabled = isLoading || isAuthenticating;

  return (
    <div className="w-full max-w-md bg-card rounded-xl border border-border-light p-8 relative overflow-hidden">
      {/* Instant Authentication Loading Overlay */}
      {isAuthenticating && (
        <div className="absolute inset-0 z-50 bg-card/90 flex flex-col items-center justify-center p-6 text-center animate-in fade-in duration-150">
          <div className="w-8 h-8 rounded-full border-2 border-brand-purple/20 border-t-brand-purple animate-spin mb-3" />
          <p className="text-sm font-semibold text-text-primary tracking-tight">
            Signing in...
          </p>
          <p className="text-xs text-text-secondary mt-1 max-w-[240px]">
            Please wait while we verify your account.
          </p>
        </div>
      )}
      {/* Top Header */}
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
              Zenxea workspace
            </span>
          </div>
        </div>
        <ThemeToggle />
      </div>

      {/* Title */}
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary tracking-tight">
          {authMode === "otp-request"
            ? "Forgot password"
            : authMode === "otp-verify"
            ? "Verify email code"
            : "Sign in to Pulse"}
        </h1>
        <p className="text-xs text-text-secondary mt-1">
          {authMode === "otp-request"
            ? "Enter your work email to receive a secure one-time login code."
            : authMode === "otp-verify"
            ? `Enter the 6-digit code sent to ${email}.`
            : "Enter your credentials to access your account."}
        </p>
      </div>

      {/* Lockout Warning Banner */}
      {lockoutMessage && (
        <div className="mb-4 p-3 rounded-lg bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs font-medium flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{lockoutMessage}</span>
        </div>
      )}

      {/* Mode 1: Forgot Password Request OTP */}
      {authMode === "otp-request" && (
        <form onSubmit={handleSendOtp} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-primary mb-1.5">
              Work email
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
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-1 focus:ring-brand-purple/20 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isFormDisabled}
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <span>{isLoading ? "Sending code..." : "Send code"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => setAuthMode("password")}
              className="text-xs text-text-secondary hover:text-brand-purple font-medium inline-flex items-center gap-1 cursor-pointer"
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
            <label className="block text-xs font-medium text-text-primary mb-1.5">
              6-digit verification code
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
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-card-subtle border border-border-light text-center font-mono tracking-widest text-base font-semibold text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-1 focus:ring-brand-purple/20 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={isFormDisabled || otpCode.length < 6}
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <span>{isAuthenticating ? "Verifying..." : "Verify and sign in"}</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>

          <div className="flex items-center justify-between text-xs pt-2">
            <button
              type="button"
              onClick={() => setAuthMode("otp-request")}
              className="text-text-secondary hover:text-text-primary font-medium flex items-center gap-1 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Change email</span>
            </button>

            <button
              type="button"
              disabled={resendingOtp}
              onClick={handleResendOtp}
              className="text-brand-purple font-medium hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-3 h-3 ${resendingOtp ? "animate-spin" : ""}`} />
              <span>Resend code</span>
            </button>
          </div>
        </form>
      )}

      {/* Mode 3: Standard Password & Magic Link Form */}
      {(authMode === "password" || authMode === "magic-link") && (
        <form onSubmit={handleAuth} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-text-primary mb-1.5">
              Work email
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
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-1 focus:ring-brand-purple/20 transition-colors disabled:opacity-50"
              />
            </div>
          </div>

          {authMode === "password" && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-medium text-text-primary">
                  Password
                </label>
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    disabled={isFormDisabled}
                    onClick={() => setAuthMode("otp-request")}
                    className="text-xs text-text-secondary hover:text-brand-purple font-medium hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    Forgot password?
                  </button>
                  <button
                    type="button"
                    disabled={isFormDisabled}
                    onClick={() => setAuthMode("magic-link")}
                    className="text-xs text-brand-purple font-medium hover:underline disabled:opacity-50 cursor-pointer"
                  >
                    Use magic link
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
                  className="w-full pl-10 pr-4 py-2 rounded-lg bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-1 focus:ring-brand-purple/20 transition-colors disabled:opacity-50"
                />
              </div>
            </div>
          )}

          {authMode === "magic-link" && (
            <div className="flex items-center justify-between">
              <Link
                href="/forgot-password"
                className="text-xs text-text-secondary hover:text-brand-purple font-medium hover:underline"
              >
                Forgot password?
              </Link>
              <button
                type="button"
                disabled={isFormDisabled}
                onClick={() => setAuthMode("password")}
                className="text-xs text-brand-purple font-medium hover:underline disabled:opacity-50 cursor-pointer"
              >
                Use password instead
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
            className="w-full mt-2 py-2.5 px-4 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            <span>
              {isAuthenticating
                ? "Signing in..."
                : isLoading
                ? "Signing in..."
                : authMode === "magic-link"
                ? "Send magic link"
                : "Sign in"}
            </span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </form>
      )}

      {/* Demo Roles Quick-Fill Card (Gated behind NEXT_PUBLIC_DEMO_MODE=true) */}
      {isDemoMode && (
        <div className="mt-6 pt-5 border-t border-border-light/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-text-tertiary">
              Demo preset:
            </span>
            <span className="text-[10px] font-medium text-text-tertiary bg-card-subtle border border-border-light px-2 py-0.5 rounded">
              Development
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Admin Preset"
              disabled={isFormDisabled}
              onClick={() => handleQuickDemoRole("Super Admin", "aadhithya.raavanan@gmail.com")}
              className="w-full py-2 px-3 rounded-lg bg-card-subtle hover:bg-card text-text-primary text-xs font-medium border border-border-light flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-text-secondary" />
              <span>Fill Super Admin (Aadhithya Raavanan)</span>
            </button>
          </div>
        </div>
      )}

      {/* Security & Privacy Notice Footer */}
      <div className="mt-6 flex items-center justify-between text-xs text-text-tertiary">
        <span className="flex items-center gap-1">
          <ShieldCheck className="w-3.5 h-3.5 text-text-tertiary" />
          Role-based security
        </span>
        <span>Zenxea</span>
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
