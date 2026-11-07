"use client";

import * as React from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { TurnstileCaptcha } from "@/components/shared/turnstile-captcha";
import {
  Clock,
  Mail,
  Lock,
  ArrowRight,
  ShieldCheck,
  Sparkles,
  Users,
  Briefcase,
  UserCheck,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectPath = searchParams.get("redirect") || "/";

  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [isMagicLink, setIsMagicLink] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(false);
  const [captchaToken, setCaptchaToken] = React.useState<string | null>(null);
  const [lockoutMessage, setLockoutMessage] = React.useState<string | null>(null);

  // Security: Demo role switcher is only accessible when explicitly enabled via environment variable
  const isDemoMode = process.env.NEXT_PUBLIC_DEMO_MODE === "true";

  const supabase = createClient();

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLockoutMessage(null);
    setIsLoading(true);

    try {
      if (isMagicLink) {
        // Magic link flow via Supabase client
        const { error } = await supabase.auth.signInWithOtp({
          email,
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
      } else {
        // Authoritative Server-Side Login via /api/auth/login
        // Enforces server-side IP + email sliding-window rate limiting & CAPTCHA validation
        const res = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            email,
            password,
            captchaToken: captchaToken || undefined,
          }),
        });

        const data = await res.json();

        if (res.status === 429) {
          // Account / IP rate limit locked out
          setLockoutMessage(data.error || "Too many failed attempts. Login locked for 15 minutes.");
          toast.error(data.error || "Account locked due to multiple failed attempts.");
          return;
        }

        if (!res.ok) {
          // Generic auth error (status 400 or 401)
          throw new Error(data.error || "Invalid email or password. Please verify your credentials and try again.");
        }

        // Handle Privileged MFA Routing:
        // Privileged roles (HR/Admin) must complete MFA.
        // If no factor is enrolled, routes seamlessly to /mfa-setup to prevent lockout.
        // If a verified factor exists, routes to /mfa-challenge.
        if (data.requireMfa && data.mfaDestination) {
          if (data.mfaDestination === "/mfa-setup") {
            toast.info("Security Policy: Privileged accounts require Two-Factor Authentication. Please set up your authenticator.");
          } else {
            toast.info("Two-Factor Authentication required. Please enter your authenticator code.");
          }
          router.push(`${data.mfaDestination}?redirect=${encodeURIComponent(redirectPath)}`);
          return;
        }

        toast.success("Signed in successfully!");
        router.push(redirectPath);
        router.refresh();
      }
    } catch (err: any) {
      toast.error(err.message || "Invalid credentials. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleQuickDemoRole = (role: string, emailPreset: string) => {
    setEmail(emailPreset);
    setPassword("DemoPassword123!");
    toast.info(`Filled credentials for ${role} demo (${emailPreset})`);
  };

  return (
    <div className="w-full max-w-md bg-shell rounded-[32px] shadow-shell border border-border-light/60 p-8 sm:p-10 relative overflow-hidden">
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
          Sign In to Workplace
        </h1>
        <p className="text-xs text-text-secondary mt-1">
          Log your daily sessions, review attendance, and manage team schedules.
        </p>
      </div>

      {/* Lockout Warning Banner */}
      {lockoutMessage && (
        <div className="mb-4 p-3 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs font-medium flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{lockoutMessage}</span>
        </div>
      )}

      {/* Login Form */}
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all"
            />
          </div>
        </div>

        {!isMagicLink && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-bold text-text-primary uppercase tracking-wider">
                Password
              </label>
              <button
                type="button"
                onClick={() => setIsMagicLink(true)}
                className="text-xs text-brand-purple font-semibold hover:underline"
              >
                Use Magic Link
              </button>
            </div>
            <div className="relative">
              <Lock className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all"
              />
            </div>
          </div>
        )}

        {isMagicLink && (
          <div className="text-right">
            <button
              type="button"
              onClick={() => setIsMagicLink(false)}
              className="text-xs text-brand-purple font-semibold hover:underline"
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
          disabled={isLoading}
          className="w-full mt-2 py-3 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50"
        >
          <span>
            {isLoading ? "Signing in..." : isMagicLink ? "Send Magic Link" : "Sign In"}
          </span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </form>

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
              onClick={() => handleQuickDemoRole("Employee", "employee@remotehr.io")}
              className="py-1.5 px-2 rounded-lg bg-card-subtle hover:bg-brand-purple-light/50 text-text-primary hover:text-brand-purple text-[11px] font-semibold border border-border-light flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Users className="w-3 h-3 text-brand-purple" />
              <span>Employee</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickDemoRole("Manager", "manager@remotehr.io")}
              className="py-1.5 px-2 rounded-lg bg-card-subtle hover:bg-brand-purple-light/50 text-text-primary hover:text-brand-purple text-[11px] font-semibold border border-border-light flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <UserCheck className="w-3 h-3 text-brand-purple" />
              <span>Manager</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickDemoRole("HR Ops", "hr@remotehr.io")}
              className="py-1.5 px-2 rounded-lg bg-card-subtle hover:bg-brand-purple-light/50 text-text-primary hover:text-brand-purple text-[11px] font-semibold border border-border-light flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <Briefcase className="w-3 h-3 text-brand-purple" />
              <span>HR Admin</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickDemoRole("System Admin", "admin@remotehr.io")}
              className="py-1.5 px-2 rounded-lg bg-card-subtle hover:bg-brand-purple-light/50 text-text-primary hover:text-brand-purple text-[11px] font-semibold border border-border-light flex items-center gap-1.5 transition-colors cursor-pointer"
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
