"use client";

import * as React from "react";
import Link from "next/link";
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
} from "lucide-react";
import { toast } from "sonner";

function SettingsPageContent() {
  const { userId, userRole } = useAppSession();
  const supabase = React.useMemo(() => createClient(), []);
  const [timezone, setTimezone] = React.useState("Asia/Kolkata");
  const [workTargetMinutes, setWorkTargetMinutes] = React.useState(480);
  const [emailAlerts, setEmailAlerts] = React.useState(true);
  const [slackAlerts, setSlackAlerts] = React.useState(true);

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

      {/* Bento Grid */}
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
          subtitle="RFC 6238 TOTP hardware & mobile authenticator enforcement (Required for HR & Admin)"
          className="lg:col-span-12 p-6"
        >
          <TotpMfaManager />
        </BentoCard>

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
      </BentoGrid>
    </div>
  );
}

export default function SettingsAndPrivacyPage() {
  return (
    <AppShell>
      <SettingsPageContent />
    </AppShell>
  );
}
