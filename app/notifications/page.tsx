"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Bell,
  CheckCheck,
  Calendar,
  Clock,
  UserCheck,
  Target,
  ShieldAlert,
  Sparkles,
  AlertCircle,
  ExternalLink,
  Filter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NotificationItemRecord,
  formatRelativeTime,
} from "@/features/notifications/hooks/use-notifications";
import { toast } from "sonner";

function getNotificationIcon(type: string) {
  if (type.startsWith("leave")) return <Calendar className="w-4 h-4 text-brand-purple shrink-0" />;
  if (type.startsWith("request") || type.startsWith("regularization"))
    return <Clock className="w-4 h-4 text-amber-500 shrink-0" />;
  if (type.startsWith("task")) return <UserCheck className="w-4 h-4 text-blue-500 shrink-0" />;
  if (type.startsWith("kpi")) return <Target className="w-4 h-4 text-indigo-500 shrink-0" />;
  if (type.startsWith("security") || type.startsWith("password") || type.startsWith("mfa"))
    return <ShieldAlert className="w-4 h-4 text-red-500 shrink-0" />;
  if (type.startsWith("holiday")) return <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />;
  if (type.startsWith("reminder") || type.includes("overdue") || type.includes("missed"))
    return <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />;
  return <Bell className="w-4 h-4 text-brand-purple shrink-0" />;
}

export default function NotificationsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [filter, setFilter] = React.useState<"all" | "unread">("all");

  const { data: notifications = [], isLoading } = useQuery<NotificationItemRecord[]>({
    queryKey: ["notifications-all", filter],
    queryFn: async () => {
      const url = filter === "unread" ? "/api/notifications?unread_only=true&limit=50" : "/api/notifications?limit=50";
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      return json.notifications || [];
    },
    staleTime: 15000,
  });

  const markSingleRead = useMutation({
    mutationFn: async (id: string) => {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [id] }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    },
    onSuccess: () => {
      toast.success("All notifications marked as read");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
    },
  });

  const unreadCount = notifications.filter((n) => !n.read_at).length;

  const handleItemClick = async (item: NotificationItemRecord) => {
    if (!item.read_at) {
      await markSingleRead.mutateAsync(item.id).catch(() => {});
    }
    if (item.link) {
      router.push(item.link);
    }
  };

  // Group notifications by relative date
  const grouped = React.useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const yesterdayDate = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

    const groups: { [key: string]: NotificationItemRecord[] } = {
      Today: [],
      Yesterday: [],
      Earlier: [],
    };

    notifications.forEach((item) => {
      const itemDate = item.created_at.slice(0, 10);
      if (itemDate === today) {
        groups.Today.push(item);
      } else if (itemDate === yesterdayDate) {
        groups.Yesterday.push(item);
      } else {
        groups.Earlier.push(item);
      }
    });

    return Object.entries(groups).filter(([, items]) => items.length > 0);
  }, [notifications]);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto space-y-6 pb-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border-light">
          <div>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight flex items-center gap-2.5">
              <Bell className="w-6 h-6 text-brand-purple" />
              <span>Notifications</span>
              {unreadCount > 0 && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-brand-purple text-white">
                  {unreadCount} unread
                </span>
              )}
            </h1>
            <p className="text-xs text-text-secondary mt-1">
              Real-time alerts, review updates, assignments, and reminders.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {/* Filter buttons */}
            <div className="inline-flex items-center p-1 rounded-xl bg-card border border-border-light shadow-sm">
              <button
                type="button"
                onClick={() => setFilter("all")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                  filter === "all"
                    ? "bg-brand-purple text-white shadow-xs"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                All
              </button>
              <button
                type="button"
                onClick={() => setFilter("unread")}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                  filter === "unread"
                    ? "bg-brand-purple text-white shadow-xs"
                    : "text-text-secondary hover:text-text-primary"
                )}
              >
                Unread
              </button>
            </div>

            {unreadCount > 0 && (
              <button
                type="button"
                disabled={markAllRead.isPending}
                onClick={() => markAllRead.mutate()}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-card hover:bg-card-subtle border border-border-light text-xs font-semibold text-text-primary transition-colors cursor-pointer shadow-sm disabled:opacity-50"
              >
                <CheckCheck className="w-4 h-4 text-brand-purple" />
                <span>Mark all read</span>
              </button>
            )}
          </div>
        </div>

        {/* Content */}
        {isLoading ? (
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-20 rounded-2xl bg-card border border-border-light/60 animate-pulse"
              />
            ))}
          </div>
        ) : grouped.length > 0 ? (
          <div className="space-y-6">
            {grouped.map(([groupTitle, items]) => (
              <div key={groupTitle} className="space-y-2.5">
                <h3 className="text-xs font-bold text-text-tertiary uppercase tracking-wider px-1">
                  {groupTitle}
                </h3>
                <div className="space-y-2">
                  {items.map((n) => {
                    const isUnread = !n.read_at;
                    const relTime = formatRelativeTime(n.created_at);

                    return (
                      <div
                        key={n.id}
                        onClick={() => handleItemClick(n)}
                        className={cn(
                          "p-4 rounded-2xl border transition-all cursor-pointer flex items-start justify-between gap-4 group",
                          isUnread
                            ? "bg-brand-purple-light/15 border-brand-purple/30 hover:bg-brand-purple-light/25 shadow-xs"
                            : "bg-card border-border-light hover:bg-card-subtle"
                        )}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <div className="p-2 rounded-xl bg-card border border-border-light/80 shadow-xs mt-0.5">
                            {getNotificationIcon(n.type)}
                          </div>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <h4 className="text-sm font-bold text-text-primary">
                                {n.title}
                              </h4>
                              {isUnread && (
                                <span className="w-2 h-2 rounded-full bg-brand-purple shrink-0" />
                              )}
                            </div>
                            <p className="text-xs text-text-secondary mt-1 leading-relaxed">
                              {n.body}
                            </p>
                            <span className="text-[10px] text-text-tertiary font-mono mt-2 block">
                              {relTime}
                            </span>
                          </div>
                        </div>

                        {n.link && (
                          <div className="shrink-0 pt-1 text-text-tertiary group-hover:text-brand-purple transition-colors">
                            <ExternalLink className="w-4 h-4" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            className="py-16 border-dashed"
            icon={<Bell className="w-8 h-8 text-text-tertiary" />}
            title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
            description={
              filter === "unread"
                ? "You have caught up with all your updates. Check 'All' to review previous items."
                : "You don't have any notifications at the moment. System events and assignments will arrive here."
            }
          />
        )}
      </div>
    </AppShell>
  );
}
