"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CheckCheck,
  X,
  Clock,
  AlertCircle,
  ExternalLink,
  Calendar,
  UserCheck,
  ShieldAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useNotifications, NotificationItemRecord } from "@/features/notifications/hooks/use-notifications";
import { EmptyState } from "@/components/shared/empty-state";

interface NotificationCenterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getNotificationIcon(type: NotificationItemRecord["type"]) {
  switch (type) {
    case "missed_checkout":
    case "task_overdue":
      return <AlertCircle className="w-3.5 h-3.5 text-status-warning-dot shrink-0" />;
    case "leave_requested":
    case "leave_status":
      return <Calendar className="w-3.5 h-3.5 text-brand-purple shrink-0" />;
    case "attendance_corrected":
    case "delegation":
      return <UserCheck className="w-3.5 h-3.5 text-brand-purple shrink-0" />;
    case "policy_update":
      return <ShieldAlert className="w-3.5 h-3.5 text-brand-purple shrink-0" />;
    default:
      return <Clock className="w-3.5 h-3.5 text-brand-purple shrink-0" />;
  }
}

export function NotificationCenter({
  open,
  onOpenChange,
}: NotificationCenterProps) {
  const router = useRouter();
  const {
    notifications,
    unreadCount,
    isLoading,
    markSingleRead,
    markAllRead,
    isMarkingAll,
  } = useNotifications();

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onOpenChange]);

  if (!open) return null;

  const handleNotificationClick = async (item: NotificationItemRecord) => {
    if (!item.read_at) {
      await markSingleRead(item.id).catch(() => {});
    }
    if (item.link) {
      onOpenChange(false);
      router.push(item.link);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end p-4 sm:p-6 bg-black/25 backdrop-blur-xs animate-in fade-in-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="w-full max-w-sm bg-card rounded-[28px] shadow-shell border border-border-light p-5 relative overflow-hidden mt-12"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-dialog-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border-light/60 mb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-brand-purple" />
            <h2
              id="notifications-dialog-title"
              className="text-sm font-extrabold text-text-primary"
            >
              Notifications
            </h2>
            <span className="sr-only" aria-live="polite">
              {unreadCount} unread notifications
            </span>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-purple text-white">
                {unreadCount}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {unreadCount > 0 && (
              <button
                type="button"
                disabled={isMarkingAll}
                onClick={() => markAllRead().catch(() => {})}
                title="Mark all as read"
                aria-label="Mark all notifications as read"
                className="px-2 py-1 rounded-lg text-text-secondary hover:text-brand-purple hover:bg-card-subtle text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close notifications"
              className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="space-y-2.5 max-h-[420px] overflow-y-auto pr-1">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-2xl bg-card-subtle animate-pulse border border-border-light/50"
                />
              ))}
            </div>
          ) : notifications.length > 0 ? (
            notifications.map((n) => {
              const isUnread = !n.read_at;
              const relDate = new Date(n.created_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              });

              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNotificationClick(n)}
                  className={cn(
                    "w-full text-left p-3 rounded-2xl border transition-all cursor-pointer relative block",
                    isUnread
                      ? "bg-brand-purple-light/25 border-brand-purple/30"
                      : "bg-card-subtle/70 border-border-light/60 opacity-85 hover:opacity-100"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-text-primary flex items-center gap-1.5">
                      {getNotificationIcon(n.type)}
                      <span>{n.title}</span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {n.link && (
                        <ExternalLink className="w-3 h-3 text-text-tertiary" />
                      )}
                      {isUnread && (
                        <span
                          className="w-2 h-2 rounded-full bg-brand-purple shrink-0"
                          aria-label="Unread"
                        />
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-text-secondary mt-1 leading-snug">
                    {n.body}
                  </p>
                  <span className="text-[10px] text-text-tertiary mt-1.5 block font-mono">
                    {relDate}
                  </span>
                </button>
              );
            })
          ) : (
            <EmptyState
              className="py-8 border-dashed shadow-none bg-card-subtle/40"
              icon={<Bell className="w-5 h-5" />}
              title="You're all caught up"
              description="Attendance alerts, leave decisions, and approvals will appear here."
            />
          )}
        </div>
      </div>
    </div>
  );
}
