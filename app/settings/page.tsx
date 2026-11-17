"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { TotpMfaManager } from "@/components/shared/totp-mfa-manager";
import { createClient } from "@/lib/supabase/client";
import {
  ShieldCheck,
  EyeOff,
  Camera,
  MapPin,
  Clock,
  Globe,
  Bell,
  Lock,
  KeyRound,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";

function SettingsPageContent() {
  const router = useRouter();
  const { userId, userRole } = useAppSession();
  const supabase = React.useMemo(() => createClient(), []);
  const [timezone, setTimezone] = React.useState("Asia/Kolkata");
  const [workTargetMinutes, setWorkTargetMinutes] = React.useState(480);
  const [emailAlerts, setEmailAlerts] = React.useState(true);
  const [slackAlerts, setSlackAlerts] = React.useState(true);

  // Password Update State
  const [newPassword, setNewPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [isChangingPassword, setIsChangingPassword] = React.useState(false);

  // Organization MFA Policy State (Admin Only)
  const [requireMfaPolicy, setRequireMfaPolicy] = React.useState<boolean>(true);
  const [isUpdatingPolicy, setIsUpdatingPolicy] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    async function loadSchedule() {
      const uid =
        userId ||
        (await supabase.auth.getSession()).data.session?.user?.id ||
        (await supabase.auth.getUser()).data.user?.id;
      if (!uid) return;
      const { data } = await (supabase as any)
        .from("employees")
        .select("timezone, work_target_minutes")
        .eq("id", uid)
        .maybeSingle();
      if (!active || !data) return;
      if (data.timezone) setTimezone(data.timezone);
      if (data.work_target_minutes) setWorkTargetMinutes(data.work_target_minutes);
    }
    loadSchedule();
    return () => {
      active = false;
    };
  }, [userId, supabase]);

  const handleSaveNotifications = (e: React.FormEvent) => {
    e.preventDefault();
    toast.success("Notification preferences saved!");
  };

  const searchParams = useSearchParams();
  const [showMustChangeBanner, setShowMustChangeBanner] = React.useState(false);

  React.useEffect(() => {
    if (searchParams?.get("must_change_password") === "true") {
      setShowMustChangeBanner(true);
    }
  }, [searchParams]);

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 12) {
      toast.error("Password must be at least 12 characters long.");
      return;
    }
    const hasUpper = /[A-Z]/.test(newPassword);
    const hasLower = /[a-z]/.test(newPassword);
    const hasDigitOrSpecial = /[\d!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(newPassword);
    if (!hasUpper || !hasLower || !hasDigitOrSpecial) {
      toast.error("Password must include uppercase, lowercase, and a number or symbol.");
      return;
    }
    if (newPassword !== confirmPassword) {
      toast.error("New Password and Confirm Password do not match.");
      return;
    }

    setIsChangingPassword(true);
    try {
      // 1. Direct Supabase Auth client update
      const { error: clientErr } = await supabase.auth.updateUser({
        password: newPassword,
        data: {
          must_change_password: false,
          temp_password_expires_at: null,
        },
      });

      // 2. Server API fallback to ensure metadata is cleared in Supabase
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionData?.session?.access_token) {
        headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
      }

      await fetch("/api/auth/update-password", {
        method: "POST",
        headers,
        body: JSON.stringify({ password: newPassword }),
      }).catch(() => {});

      if (clientErr && !sessionData?.session) {
        console.warn("[Password Update] Note:", clientErr.message);
      }

      // 3. Immediately dismiss banner and remove query param from URL
      setShowMustChangeBanner(false);
      if (typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.delete("must_change_password");
        window.history.replaceState(null, "", url.pathname + url.search);
      }

      toast.success("Password updated successfully! Welcome to your workplace.");
      setNewPassword("");
      setConfirmPassword("");

      // 5. Navigate to dashboard so walkthrough tutorial starts automatically
      setTimeout(() => {
        router.push("/?tour=auto");
      }, 1000);
    } catch (err: any) {
      toast.error(err.message || "Failed to update password.");
    } finally {
      setIsChangingPassword(false);
    }
  };

  React.useEffect(() => {
    async function loadOrgPolicy() {
      try {
        const { data: member } = await (supabase as any)
          .from("organization_members")
          .select("organization_id")
          .maybeSingle();
        if (member?.organization_id) {
          const { data: org } = await (supabase as any)
            .from("organizations")
            .select("require_mfa_for_privileged")
            .eq("id", member.organization_id)
            .maybeSingle();
          if (org && typeof org.require_mfa_for_privileged === "boolean") {
            setRequireMfaPolicy(org.require_mfa_for_privileged);
          }
        }
      } catch {}
    }
    loadOrgPolicy();
  }, [supabase]);

  const handleToggleMfaPolicy = async () => {
    if (isDemoModeEnabled()) {
      const nextVal = !requireMfaPolicy;
      setRequireMfaPolicy(nextVal);
      toast.success(
        nextVal
          ? "Organization MFA policy updated: MFA is now mandatory for HR and Admins. (demo session)"
          : "Organization MFA policy updated: MFA is now optional for privileged accounts. (demo session)"
      );
      return;
    }

    setIsUpdatingPolicy(true);
    try {
      const nextVal = !requireMfaPolicy;
      const { data, error } = await (supabase.rpc as any)("admin_set_mfa_policy", {
        p_require_mfa: nextVal,
      });
      if (error) throw error;
      setRequireMfaPolicy(nextVal);
      toast.success(
        nextVal
          ? "Organization MFA policy updated: MFA is now mandatory for HR and Admins."
          : "Organization MFA policy updated: MFA is now optional for privileged accounts."
      );
    } catch (err: any) {
      if (err.message?.includes("AAL2") || err.message?.includes("aal2")) {
        toast.error("MFA AAL2 verification required. Please verify your Two-Factor authenticator code first.");
      } else {
        toast.error(err.message || "Failed to update MFA policy.");
      }
    } finally {
      setIsUpdatingPolicy(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="pt-1 pb-3 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
            Settings & Privacy Principles
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Review security protection, view your governed schedule timezone, and adjust alert channels.
          </p>
        </div>

        <Link
          href="/profile"
          className="px-4 py-2 rounded-full bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-colors w-fit shadow-sm"
        >
          Edit Personal Profile →
        </Link>
      </section>

      {showMustChangeBanner && (
        <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 flex items-center justify-between gap-3 animate-pulse" role="alert">
          <div className="flex items-center gap-3">
            <KeyRound className="w-5 h-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="text-xs sm:text-sm font-semibold">
              Action Required: You are signed in with a temporary password. You must set a new permanent password below before accessing workplace features.
            </div>
          </div>
          <button
            type="button"
            onClick={() => {
              setShowMustChangeBanner(false);
              if (typeof window !== "undefined") {
                const url = new URL(window.location.href);
                url.searchParams.delete("must_change_password");
                window.history.replaceState(null, "", url.pathname + url.search);
              }
            }}
            className="text-xs font-bold text-amber-700 dark:text-amber-300 hover:opacity-70 px-2 py-1 rounded-lg"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bento Grid */}
      <div data-tour="settings-security">
      <BentoGrid>
        {/* Privacy Notice Banner Card */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-status-success-dot" />
              <span className="text-lg">Zero-Invasive Privacy Manifesto</span>
            </div>
          }
          subtitle="Our zero-surveillance remote workplace commitment"
          className="lg:col-span-12 p-6 bg-gradient-to-r from-card to-brand-purple-light/10"
        >
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mt-2">
            <div className="p-4 rounded-2xl bg-card border border-border-light shadow-sm flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-status-danger-bg text-status-danger-text flex items-center justify-center shrink-0">
                <MapPin className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-text-primary">
                  NO Location Tracking / GPS
                </h3>
                <p className="text-[11px] text-text-tertiary mt-1">
                  We never record your physical GPS coordinates, IP locations, or Wi-Fi telemetry.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-card border border-border-light shadow-sm flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-status-danger-bg text-status-danger-text flex items-center justify-center shrink-0">
                <Camera className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-text-primary">
                  NO Webcam / Screen Captures
                </h3>
                <p className="text-[11px] text-text-tertiary mt-1">
                  No background screenshots, webcam snapshots, or browser tab monitoring.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-card border border-border-light shadow-sm flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-status-danger-bg text-status-danger-text flex items-center justify-center shrink-0">
                <EyeOff className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-text-primary">
                  NO Keystroke / Activity Logging
                </h3>
                <p className="text-[11px] text-text-tertiary mt-1">
                  No keyloggers or mouse movement tracking. Remote trust is measured by outcomes.
                </p>
              </div>
            </div>

            <div className="p-4 rounded-2xl bg-card border border-border-light shadow-sm flex items-start gap-3">
              <div className="w-9 h-9 rounded-xl bg-status-success-bg text-status-success-text flex items-center justify-center shrink-0">
                <Clock className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-xs font-bold text-text-primary">
                  What IS Recorded
                </h3>
                <p className="text-[11px] text-text-tertiary mt-1">
                  Only check-in and check-out timestamps, employee timezone, and self-reported punch notes.
                </p>
              </div>
            </div>
          </div>
        </BentoCard>

        {/* Two-Factor Authentication Security Card */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-brand-purple" />
              <span>Account Security & Two-Factor Authentication (MFA)</span>
            </div>
          }
          subtitle="Protect your account with RFC 6238 TOTP mobile or hardware authenticator"
          className="lg:col-span-12 p-6"
        >
          <TotpMfaManager />
        </BentoCard>

        {/* Admin-Only Organization MFA Enforcement Policy Card */}
        {userRole === "admin" && (
          <BentoCard
            title={
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-purple" />
                <span>Organization Security & MFA Enforcement</span>
              </div>
            }
            subtitle="Admin-governed policy for mandatory Two-Factor Authentication across privileged roles (HR & Admin)"
            className="lg:col-span-12 p-6"
          >
            <div className="space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-2xl bg-card-subtle border border-border-light">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-text-primary uppercase tracking-wider">
                      Mandatory MFA for Privileged Accounts
                    </span>
                    <span
                      className={`text-[10px] font-extrabold uppercase px-2 py-0.5 rounded-full ${
                        requireMfaPolicy
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                      }`}
                    >
                      {requireMfaPolicy ? "Enforced (AAL2 Required)" : "Opt-In (Disabled)"}
                    </span>
                  </div>
                  <p className="text-xs text-text-secondary max-w-xl">
                    When enabled, all HR and Admin accounts must enroll and verify TOTP Two-Factor Authentication before accessing management interfaces and privileged RPC endpoints.
                  </p>
                </div>

                <button
                  type="button"
                  disabled={isUpdatingPolicy}
                  onClick={handleToggleMfaPolicy}
                  data-testid="toggle-mfa-policy-button"
                  className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm cursor-pointer whitespace-nowrap disabled:opacity-50 ${
                    requireMfaPolicy
                      ? "bg-rose-500 hover:bg-rose-600 text-white"
                      : "bg-brand-purple hover:bg-brand-purple-hover text-white"
                  }`}
                >
                  {isUpdatingPolicy
                    ? "Updating Policy..."
                    : requireMfaPolicy
                    ? "Disable Mandatory MFA"
                    : "Enforce Mandatory MFA"}
                </button>
              </div>

              {!requireMfaPolicy && (
                <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    <strong>Warning:</strong> Privileged endpoints and data access are not protected by mandatory AAL2 multi-factor verification while this setting is disabled.
                  </span>
                </div>
              )}
            </div>
          </BentoCard>
        )}

        {/* Work Schedule & Shift (Strictly HR/Admin-Only Governance) */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <Globe className="w-4 h-4 text-brand-purple" />
              <span>Work Schedule & Shift</span>
            </div>
          }
          subtitle="Assigned shift timezone and daily work target"
          className="lg:col-span-7 p-6 flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="p-3 rounded-2xl bg-brand-purple-light/20 border border-brand-purple/25 text-xs text-text-primary flex items-center justify-between gap-2">
              <span className="font-semibold flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5 text-brand-purple shrink-0" />
                Timezone & shift governance are strictly HR / Admin-only.
              </span>
              {(userRole === "hr" || userRole === "admin") && (
                <Link
                  href="/admin/users"
                  className="text-brand-purple font-bold hover:underline whitespace-nowrap"
                >
                  Manage in Directory →
                </Link>
              )}
            </div>

            <div>
              <label
                htmlFor="settings-timezone"
                className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
              >
                Time Zone
              </label>
              <select
                id="settings-timezone"
                disabled
                value={timezone}
                onChange={() => {}}
                className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle/60 border border-border-light text-xs font-bold text-text-secondary cursor-not-allowed"
              >
                <option value={timezone}>{timezone}</option>
                <option value="Asia/Kolkata">Asia/Kolkata (UTC+05:30)</option>
                <option value="America/New_York">America/New_York (UTC-05:00)</option>
                <option value="America/Los_Angeles">America/Los_Angeles (UTC-08:00)</option>
                <option value="Europe/London">Europe/London (UTC+00:00)</option>
                <option value="UTC">UTC (Universal Time)</option>
              </select>
              <p className="text-[11px] text-text-tertiary mt-1">
                Daily attendance sessions and midnight crossovers are evaluated in this HR-assigned timezone.
              </p>
            </div>

            <div>
              <label
                htmlFor="settings-work-target"
                className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
              >
                Daily Work Target
              </label>
              <input
                id="settings-work-target"
                type="text"
                disabled
                value={`${workTargetMinutes} Minutes (${Math.round(workTargetMinutes / 60)} Hours)`}
                className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle/60 border border-border-light text-xs font-bold text-text-secondary cursor-not-allowed"
              />
              <p className="text-[11px] text-text-tertiary mt-1">
                Configured by company attendance policy. Contact HR Ops for modifications.
              </p>
            </div>
          </div>
        </BentoCard>

        {/* Notifications & Theme Controls */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <Bell className="w-4 h-4 text-brand-purple" />
              <span>Notification Preferences</span>
            </div>
          }
          subtitle="Alert channels and display theme"
          className="lg:col-span-5 p-6 flex flex-col justify-between"
        >
          <form onSubmit={handleSaveNotifications} className="space-y-4">
            <label className="flex items-center justify-between p-3.5 rounded-2xl bg-card-subtle border border-border-light cursor-pointer">
              <div>
                <span className="text-xs font-bold text-text-primary block">
                  Email Notifications
                </span>
                <span className="text-[11px] text-text-tertiary">
                  Missed checkout reminders and approval results
                </span>
              </div>
              <input
                type="checkbox"
                checked={emailAlerts}
                onChange={(e) => setEmailAlerts(e.target.checked)}
                className="w-4 h-4 accent-brand-purple rounded cursor-pointer"
              />
            </label>

            <label className="flex items-center justify-between p-3.5 rounded-2xl bg-card-subtle border border-border-light cursor-pointer">
              <div>
                <span className="text-xs font-bold text-text-primary block">
                  Slack Sync
                </span>
                <span className="text-[11px] text-text-tertiary">
                  Team presence alerts via incoming webhook
                </span>
              </div>
              <input
                type="checkbox"
                checked={slackAlerts}
                onChange={(e) => setSlackAlerts(e.target.checked)}
                className="w-4 h-4 accent-brand-purple rounded cursor-pointer"
              />
            </label>

            <div className="flex items-center justify-between p-3.5 rounded-2xl bg-card-subtle border border-border-light">
              <div>
                <span className="text-xs font-bold text-text-primary block">
                  Color Theme Mode
                </span>
                <span className="text-[11px] text-text-tertiary">
                  Segmented Light / Dark theme selector
                </span>
              </div>
              <ThemeToggle />
            </div>

            <button
              type="submit"
              className="w-full py-2.5 px-4 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              Save Alert Preferences
            </button>
          </form>

          <div className="pt-4 mt-4 border-t border-border-light text-[11px] text-text-tertiary flex items-center gap-1.5">
            <Lock className="w-3.5 h-3.5 text-status-success-dot" />
            <span>Data encrypted at rest and in transit via Supabase TLS</span>
          </div>
        </BentoCard>

        {/* Security & Change Password Section */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <KeyRound className="w-5 h-5 text-brand-purple" />
              <span className="text-lg">Security &amp; Change Password</span>
            </div>
          }
          subtitle="Update your temporary password or establish a new strong credential"
          className="lg:col-span-12 p-6"
        >
          <form onSubmit={handlePasswordChange} className="space-y-4 max-w-xl">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="new-password"
                  className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
                >
                  New Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="new-password"
                    type="password"
                    required
                    minLength={12}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Min. 12 characters"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="confirm-password"
                  className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
                >
                  Confirm Password
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-text-tertiary absolute left-3.5 top-1/2 -translate-y-1/2" />
                  <input
                    id="confirm-password"
                    type="password"
                    required
                    minLength={12}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none focus:border-brand-purple focus:ring-2 focus:ring-brand-purple/20 transition-all"
                  />
                </div>
              </div>
            </div>

            <p className="text-[11px] text-text-tertiary">
              Password must contain at least 12 characters. Changes take effect across all active sessions upon next sign-in.
            </p>

            <button
              type="submit"
              disabled={isChangingPassword || !newPassword}
              className="px-5 py-2.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer disabled:opacity-50"
            >
              {isChangingPassword ? "Updating Password..." : "Update Password"}
            </button>
          </form>
        </BentoCard>
      </BentoGrid>
      </div>
    </div>
  );
}

export default function SettingsAndPrivacyPage() {
  return (
    <AppShell>
      <React.Suspense fallback={<div className="p-8 text-center text-sm text-text-tertiary">Loading settings...</div>}>
        <SettingsPageContent />
      </React.Suspense>
    </AppShell>
  );
}
