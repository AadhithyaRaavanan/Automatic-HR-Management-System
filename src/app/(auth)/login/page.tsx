"use client";

import * as React from "react";
import { Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { sanitizeRedirectPath } from "@/features/auth/redirect";
import { TurnstileCaptcha } from "@/features/auth/components/turnstile-captcha";
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
import { cn } from "@/lib/utils";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = sanitizeRedirectPath(searchParams.get("redirect"), "/");

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [authMode, setAuthMode] = React.useState<"password" | "magic-link" | "otp-request" | "otp-verify">("password");
  const [otpSource, setOtpSource] = React.useState<"forgot-password" | "magic-link">("forgot-password");
  const [otpCode, setOtpCode] = React.useState("");
  const [isLoading, setIsLoading] = React.useState(false);
  const [isAuthenticating, setIsAuthenticating] = React.useState(false);
  const [resendingOtp, setResendingOtp] = React.useState(false);
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const [lockoutMessage, setLockoutMessage] = React.useState<string | null>(null);

  // Security: Demo role switcher is only accessible in non-production demo mode
  const isDemoMode = isDemoModeEnabled();

  const supabase = React.useMemo(() => createClient(), []);
  const hashHandledRef = React.useRef(false);

  // Surface callback/expiry error & break-timeout banners when redirected back to /login
  const breakTimeoutToastedRef = React.useRef(false);
  React.useEffect(() => {
    const errParam = searchParams.get("error");
    const reasonParam = searchParams.get("reason");
    if (reasonParam === "break_timeout") {
      const msg =
        "You were automatically logged out because your break time exceeded the allowed limit. Please remember to end your breaks or log out properly next time.";
      setLockoutMessage(msg);
      if (!breakTimeoutToastedRef.current) {
        breakTimeoutToastedRef.current = true;
        toast.warning("Auto Logged Out: Break Time Exceeded", {
          description:
            "Your shift was ended because your break exceeded the allowed limit.",
          duration: 8000,
        });
      }
    } else if (errParam === "auth_callback_failed") {
      setLockoutMessage("Your sign-in link has expired or could not be verified. Please request a new link.");
    } else if (errParam === "expired_temp_password") {
      setLockoutMessage("Your temporary password has expired. Please use Forgot password to reset it.");
    }
  }, [searchParams]);

  // Complete implicit magic-link / recovery redirects if Supabase landed on "/" and bounced to "/login#access_token=..."
  React.useEffect(() => {
    if (hashHandledRef.current) return;
    if (typeof window === "undefined" || !window.location.hash) return;
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hashParams.get("access_token");
    const refreshToken = hashParams.get("refresh_token");
    const hashType = hashParams.get("type");
    if (!accessToken || !refreshToken) return;

    hashHandledRef.current = true;
    setIsAuthenticating(true);

    const timeoutId = window.setTimeout(() => {
      setIsAuthenticating(false);
      setLockoutMessage("Verification timed out. Please try signing in again.");
    }, 12000);

    (async () => {
      try {
        // Wait for browser client URL auto-detection first to avoid duplicate GoTrue lock calls
        const {
          data: { session: existingSession },
        } = await supabase.auth.getSession();

        if (!existingSession) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (error) {
            throw error;
          }
        }

        window.clearTimeout(timeoutId);
        const target =
          hashType === "recovery" ? "/settings?must_change_password=true" : redirectPath;
        window.location.replace(target);
      } catch (err: any) {
        window.clearTimeout(timeoutId);
        setIsAuthenticating(false);
        setLockoutMessage(err?.message || "Your sign-in link could not be verified. Please try again.");
      }
    })();
  }, [redirectPath, supabase]);

  const handleMagicLinkRequest = async (targetEmail: string) => {
    const cleanEmail = targetEmail.trim();
    if (!cleanEmail) {
      toast.error("Please enter your registered work email.");
      return;
    }

    setLockoutMessage(null);
    setIsLoading(true);
    try {
      const res = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: cleanEmail,
          redirectPath,
          turnstileToken: captchaToken || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        const msg =
          data.error || "Unable to send magic link. Please check the email address and try again.";
        if (res.status === 429) {
          setLockoutMessage(msg);
        }
        toast.error(msg);
        return;
      }

      toast.success(
        data.message || "A secure sign-in link and verification code have been dispatched to your email."
      );
      setOtpSource("magic-link");
      setAuthMode("otp-verify");
    } catch (err: any) {
      toast.error(err?.message || "Unable to send magic link. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const performLogin = async (loginEmail: string, loginPassword: string) => {
    setLockoutMessage(null);
    setIsLoading(true);
    setIsAuthenticating(true);

    try {
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
        setLockoutMessage(data.error || "Too many failed attempts. Login locked for 15 minutes.");
        toast.error(data.error || "Account locked due to multiple failed attempts.");
        setIsAuthenticating(false);
        return;
      }

      if (!res.ok) {
        setIsAuthenticating(false);
        throw new Error(
          data.error || "Invalid email or password. Please verify your credentials and try again."
        );
      }

      if (data.requireMfa && data.mfaDestination) {
        toast.info(
          data.mfaDestination === "/mfa-setup"
            ? "Please complete two-factor authentication setup."
            : "Two-Factor Authentication required. Please enter your authenticator code."
        );
        window.location.assign(`${data.mfaDestination}?redirect=${encodeURIComponent(redirectPath)}`);
        return;
      }

      if (typeof window !== "undefined") {
        try {
          if (data.role) localStorage.setItem("remotehr_cached_role", data.role);
          Object.keys(sessionStorage).forEach((key) => {
            if (key.startsWith("notif_login_chime_")) sessionStorage.removeItem(key);
          });
        } catch {}
      }

      if (data.onboardingRequired || data.destination === "/onboarding" || data.mfaDestination === "/onboarding") {
        toast.success("Welcome aboard! Please complete your mandatory employee onboarding.");
        window.location.assign("/onboarding");
        return;
      }

      if (data.destination === "/onboarding/pending" || data.mfaDestination === "/onboarding/pending") {
        toast.info("Your onboarding profile is currently under review.");
        window.location.assign("/onboarding/pending");
        return;
      }

      if (data.destination) {
        toast.success("Signed in successfully!");
        window.location.assign(data.destination);
        return;
      }

      toast.success("Signed in successfully!");
      window.location.assign(redirectPath);
    } catch (err: any) {
      setIsAuthenticating(false);
      toast.error(err.message || "Invalid credentials. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (authMode === "magic-link") {
      await handleMagicLinkRequest(email);
      return;
    }
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
      setOtpSource("forgot-password");
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
    if (cleanCode.length < 6 || cleanCode.length > 8) {
      toast.error("Please enter the 6 to 8 digit code received in your email.");
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
        window.location.assign(data.mfaDestination);
      } else {
        toast.success(data.message || "Logged in successfully. Please set your new password.");
        window.location.assign(data.mfaDestination || "/settings?must_change_password=true");
      }
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
      const endpoint = otpSource === "magic-link" ? "/api/auth/magic-link" : "/api/auth/forgot-password";
      const payload =
        otpSource === "magic-link"
          ? {
              email: email.trim(),
              redirectPath,
              turnstileToken: captchaToken || undefined,
            }
          : {
              email: email.trim(),
              turnstileToken: captchaToken || undefined,
            };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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
    <div className="w-full max-w-md bg-white rounded-[14px] border border-[#E6E6E6] p-8 relative overflow-hidden shadow-none">
      {/* Completely Opaque Authentication Loading Overlay (Zero Background Bleed) */}
      {isAuthenticating && (
        <div className="absolute inset-0 z-50 bg-white flex flex-col items-center justify-center p-8 text-center select-none animate-in fade-in duration-100">
          <div className="w-9 h-9 rounded-full border-2 border-[#E6E6E6] border-t-black animate-spin mb-4" />
          <p className="text-base font-bold text-black tracking-tight">
            Signing in...
          </p>
          <p className="text-xs text-[#4D4D4D] mt-1.5 max-w-[240px] leading-relaxed">
            Please wait while we verify your account.
          </p>
        </div>
      )}

      {/* Main Form Body - completely invisible and non-interactive during loading */}
      <div className={cn("transition-opacity duration-150", isAuthenticating ? "invisible opacity-0 pointer-events-none" : "opacity-100")}>
        {/* Top Header */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-black flex items-center justify-center text-white font-bold text-sm shadow-xs">
              P
            </div>
            <div>
              <h2 className="text-sm font-bold text-black tracking-tight">
                Pulse
              </h2>
              <span className="text-xs text-[#808080]">
                Zenxea workspace
              </span>
            </div>
          </div>
        </div>

        {/* Title */}
        <div className="mb-6">
          <h1 className="text-xl font-bold text-black tracking-tight">
            {authMode === "otp-request"
              ? "Forgot password"
              : authMode === "otp-verify"
              ? "Verify email code"
              : "Sign in to Pulse"}
          </h1>
          <p className="text-xs text-[#4D4D4D] mt-1">
            {authMode === "otp-request"
              ? "Enter your work email to receive a secure one-time login code."
              : authMode === "otp-verify"
              ? `Enter the 6–8 digit code sent to ${email}.`
              : "Enter your credentials to access your account."}
          </p>
        </div>

        {/* Lockout Warning Banner */}
        {lockoutMessage && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-[#FF1493] text-xs font-medium flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{lockoutMessage}</span>
          </div>
        )}

        {/* Mode 1: Forgot Password Request OTP */}
        {authMode === "otp-request" && (
          <form onSubmit={handleSendOtp} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-black mb-1.5">
                Work email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#808080] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  disabled={isFormDisabled}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-medium text-black placeholder:text-[#808080] focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isFormDisabled}
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <span>{isLoading ? "Sending code..." : "Send code"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setAuthMode("password")}
                className="text-xs text-[#808080] hover:text-black font-medium inline-flex items-center gap-1 cursor-pointer hover:underline"
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
              <label className="block text-xs font-semibold text-black mb-1.5">
                Verification code (6–8 digits)
              </label>
              <div className="relative">
                <KeyRound className="w-4 h-4 text-[#808080] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  required
                  maxLength={8}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  disabled={isFormDisabled}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="12345678"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white border border-[#E6E6E6] text-center font-mono tracking-widest text-base font-semibold text-black placeholder:text-[#808080] focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isFormDisabled || otpCode.length < 6}
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
            >
              <span>{isAuthenticating ? "Verifying..." : "Verify and sign in"}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>

            <div className="flex items-center justify-between text-xs pt-2">
              <button
                type="button"
                onClick={() => setAuthMode(otpSource === "magic-link" ? "magic-link" : "otp-request")}
                className="text-[#808080] hover:text-black font-medium flex items-center gap-1 cursor-pointer hover:underline"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Change email</span>
              </button>

              <button
                type="button"
                disabled={resendingOtp}
                onClick={handleResendOtp}
                className="text-black font-semibold hover:underline flex items-center gap-1 cursor-pointer disabled:opacity-50"
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
              <label className="block text-xs font-semibold text-black mb-1.5">
                Work email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-[#808080] absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  disabled={isFormDisabled}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-medium text-black placeholder:text-[#808080] focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors disabled:opacity-50"
                />
              </div>
            </div>

            {authMode === "password" && (
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-black">
                    Password
                  </label>
                  <div className="flex items-center gap-3">
                    <button
                      type="button"
                      disabled={isFormDisabled}
                      onClick={() => setAuthMode("otp-request")}
                      className="text-xs text-[#808080] hover:text-black font-medium hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      Forgot password?
                    </button>
                    <button
                      type="button"
                      disabled={isFormDisabled}
                      onClick={() => setAuthMode("magic-link")}
                      className="text-xs text-black font-semibold hover:underline disabled:opacity-50 cursor-pointer"
                    >
                      Use magic link
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <Lock className="w-4 h-4 text-[#808080] absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    disabled={isFormDisabled}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••••••"
                    className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-white border border-[#E6E6E6] text-xs font-medium text-black placeholder:text-[#808080] focus:outline-none focus:border-black focus:ring-1 focus:ring-black transition-colors disabled:opacity-50"
                  />
                </div>
              </div>
            )}

            {authMode === "magic-link" && (
              <div className="flex items-center justify-between">
                <Link
                  href="/forgot-password"
                  className="text-xs text-[#808080] hover:text-black font-medium hover:underline"
                >
                  Forgot password?
                </Link>
                <button
                  type="button"
                  disabled={isFormDisabled}
                  onClick={() => setAuthMode("password")}
                  className="text-xs text-black font-semibold hover:underline disabled:opacity-50 cursor-pointer"
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
              className="w-full mt-2 py-2.5 px-4 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 shadow-xs"
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
          <div className="mt-6 pt-5 border-t border-[#E6E6E6]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-[#808080]">
                Demo preset:
              </span>
              <span className="text-[10px] font-medium text-[#4D4D4D] bg-[#F5F5F5] border border-[#E6E6E6] px-2 py-0.5 rounded">
                Development
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                aria-label="Admin Preset"
                disabled={isFormDisabled}
                onClick={() => handleQuickDemoRole("Super Admin", "aadhithya.raavanan@gmail.com")}
                className="w-full py-2 px-3 rounded-lg bg-[#F5F5F5] hover:bg-[#E6E6E6] text-black text-xs font-medium border border-[#E6E6E6] flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 shadow-xs"
              >
                <ShieldCheck className="w-3.5 h-3.5 text-black" />
                <span>Fill Super Admin (Aadhithya Raavanan)</span>
              </button>
            </div>
          </div>
        )}

        {/* Security & Privacy Notice Footer */}
        <div className="mt-6 flex items-center justify-between text-xs text-[#808080]">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#808080]" />
            Role-based security
          </span>
          <span>Zenxea</span>
        </div>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-4 select-none">
      <Suspense
        fallback={
          <div className="w-full max-w-md bg-white rounded-[14px] border border-[#E6E6E6] p-8 animate-pulse text-center text-xs text-[#808080]">
            Loading sign-in...
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </div>
  );
}
