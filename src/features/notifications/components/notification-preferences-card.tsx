"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BentoCard } from "@/components/bento/bento-card";
import {
  Bell,
  Mail,
  Shield,
  Calendar,
  Clock,
  CheckSquare,
  UserCheck,
  Target,
  AlertCircle,
  Lock,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { NotificationTypeGroup } from "@/features/notifications/types";

interface PreferenceItem {
  type_group: NotificationTypeGroup;
  in_app: boolean;
  email: boolean;
  lockRequired?: boolean;
}

const GROUP_METADATA: Record<
  NotificationTypeGroup,
  { label: string; description: string; icon: React.ElementType }
> = {
  leave: {
    label: "Leave Applications",
    description: "Submissions, approvals, rejections, and quota adjustments",
    icon: Calendar,
  },
  requests: {
    label: "Regularization Requests",
    description: "Punch correction reviews and approval decisions",
    icon: Clock,
  },
  tasks: {
    label: "Tasks & Assignments",
    description: "Task assignments, review milestones, and completion alerts",
    icon: CheckSquare,
  },
  onboarding: {
    label: "Employee Onboarding",
    description: "Document verifications, candidate approvals, and invites",
    icon: UserCheck,
  },
  kpi: {
    label: "Performance (KPI)",
    description: "Review publications, goal assignments, and risk alerts",
    icon: Target,
  },
  announcements: {
    label: "Announcements & Holidays",
    description: "Company-wide holidays and workplace broadcasts",
    icon: Calendar,
  },
  security: {
    label: "Security & Credentials",
    description: "Password updates, role governance, and MFA resets",
    icon: Shield,
  },
  reminders: {
    label: "Scheduled Reminders",
    description: "Shift check-in/out prompts and overdue task notices",
    icon: AlertCircle,
  },
};

export function NotificationPreferencesCard({ className }: { className?: string }) {
  const queryClient = useQueryClient();

  const { data: preferences = [], isLoading } = useQuery<PreferenceItem[]>({
    queryKey: ["notification-preferences"],
    queryFn: async () => {
      const res = await fetch("/api/notifications/preferences");
      if (!res.ok) return [];
      const json = await res.json();
      return json.preferences || [];
    },
    staleTime: 60000,
  });

  const updatePreference = useMutation({
    mutationFn: async ({
      group,
      in_app,
      email,
    }: {
      group: NotificationTypeGroup;
      in_app: boolean;
      email: boolean;
    }) => {
      const res = await fetch("/api/notifications/preferences", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type_group: group,
          in_app,
          email,
        }),
      });
      if (!res.ok) throw new Error("Failed to save preference");
      return res.json();
    },
    onMutate: async ({ group, in_app, email }) => {
      await queryClient.cancelQueries({ queryKey: ["notification-preferences"] });
      const previous = queryClient.getQueryData<PreferenceItem[]>(["notification-preferences"]);
      if (previous) {
        queryClient.setQueryData<PreferenceItem[]>(
          ["notification-preferences"],
          previous.map((p) =>
            p.type_group === group ? { ...p, in_app, email } : p
          )
        );
      }
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["notification-preferences"], context.previous);
      }
      toast.error("Failed to update notification settings");
    },
    onSuccess: () => {
      toast.success("Preferences updated");
    },
  });

  const handleToggle = (
    group: NotificationTypeGroup,
    channel: "in_app" | "email",
    currentValue: boolean,
    isLocked?: boolean
  ) => {
    if (isLocked) return;
    const currentItem = preferences.find((p) => p.type_group === group);
    if (!currentItem) return;

    updatePreference.mutate({
      group,
      in_app: channel === "in_app" ? !currentValue : currentItem.in_app,
      email: channel === "email" ? !currentValue : currentItem.email,
    });
  };

  return (
    <BentoCard
      title={
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-brand-purple" />
          <span>Notification Preferences</span>
        </div>
      }
      subtitle="Configure delivery channels per alert group (In-App & Email)"
      className={cn("lg:col-span-12 p-6", className)}
    >
      <div className="space-y-3 mt-4">
        {/* Table Header */}
        <div className="hidden sm:grid grid-cols-12 gap-4 px-3 py-2 text-[11px] font-bold text-text-tertiary uppercase tracking-wider border-b border-border-light">
          <div className="col-span-8">Notification Group</div>
          <div className="col-span-2 text-center flex items-center justify-center gap-1">
            <Bell className="w-3.5 h-3.5" />
            <span>In-App</span>
          </div>
          <div className="col-span-2 text-center flex items-center justify-center gap-1">
            <Mail className="w-3.5 h-3.5" />
            <span>Email</span>
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div
                key={i}
                className="h-14 rounded-2xl bg-card-subtle animate-pulse border border-border-light/50"
              />
            ))}
          </div>
        ) : (
          preferences.map((pref) => {
            const meta = GROUP_METADATA[pref.type_group] || {
              label: pref.type_group,
              description: "System updates",
              icon: Bell,
            };
            const Icon = meta.icon;
            const isSecurity = pref.type_group === "security" || pref.lockRequired;

            return (
              <div
                key={pref.type_group}
                className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 p-3.5 rounded-2xl bg-card-subtle border border-border-light items-center hover:bg-card transition-colors"
              >
                {/* Description */}
                <div className="sm:col-span-8 flex items-start gap-3">
                  <div className="p-2 rounded-xl bg-card border border-border-light/80 shadow-xs mt-0.5 shrink-0">
                    <Icon className="w-4 h-4 text-brand-purple" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-text-primary">
                        {meta.label}
                      </span>
                      {isSecurity && (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                          <Lock className="w-2.5 h-2.5" />
                          <span>Required</span>
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-text-tertiary block mt-0.5 leading-snug">
                      {meta.description}
                    </span>
                  </div>
                </div>

                {/* Toggles Container on Mobile / Columns on Desktop */}
                <div className="flex sm:contents items-center justify-between pt-2 sm:pt-0 border-t sm:border-t-0 border-border-light/50">
                  {/* In-App Toggle */}
                  <div className="sm:col-span-2 flex items-center justify-center gap-2">
                    <span className="sm:hidden text-xs text-text-secondary font-medium">In-App:</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={isSecurity}
                        checked={pref.in_app}
                        onChange={() =>
                          handleToggle(pref.type_group, "in_app", pref.in_app, isSecurity)
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-border-light peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-purple peer-disabled:opacity-60 peer-disabled:cursor-not-allowed shadow-inner" />
                    </label>
                  </div>

                  {/* Email Toggle */}
                  <div className="sm:col-span-2 flex items-center justify-center gap-2">
                    <span className="sm:hidden text-xs text-text-secondary font-medium">Email:</span>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input
                        type="checkbox"
                        disabled={isSecurity}
                        checked={pref.email}
                        onChange={() =>
                          handleToggle(pref.type_group, "email", pref.email, isSecurity)
                        }
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-border-light peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-brand-purple peer-disabled:opacity-60 peer-disabled:cursor-not-allowed shadow-inner" />
                    </label>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </BentoCard>
  );
}
