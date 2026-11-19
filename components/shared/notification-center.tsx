"use client";

import * as React from "react";
import Link from "next/link";
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
  ArrowRight,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useNotifications,
  NotificationItemRecord,
  formatRelativeTime,
} from "@/features/notifications/hooks/use-notifications";
import { EmptyState } from "@/components/shared/empty-state";

interface NotificationCenterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getNotificationIcon(type: string, title?: string) {
  if (type.includes("birthday") || title?.includes("Birthday") || title?.includes("🎂") || title?.includes("🎉")) {
    return <span className="text-sm shrink-0">🎂</span>;
  }
  if (type.startsWith("leave")) return <Calendar className="w-3.5 h-3.5 text-black shrink-0" />;
  if (type.startsWith("request") || type.startsWith("regularization")) return <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
  if (type.startsWith("task")) return <UserCheck className="w-3.5 h-3.5 text-black shrink-0" />;
  if (type.startsWith("kpi")) return <Target className="w-3.5 h-3.5 text-black shrink-0" />;
  if (type.startsWith("security") || type.startsWith("password") || type.startsWith("mfa"))
    return <ShieldAlert className="w-3.5 h-3.5 text-[#F00091] shrink-0" />;
  if (type.startsWith("holiday")) return <Calendar className="w-3.5 h-3.5 text-[#A6F000] shrink-0" />;
  if (type.startsWith("reminder") || type.includes("overdue") || type.includes("missed"))
    return <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />;
  return <Bell className="w-3.5 h-3.5 text-black shrink-0" />;
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

  const previewItems = notifications.slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-start justify-end p-4 sm:p-6 bg-black/25 backdrop-blur-xs animate-in fade-in-0"
      onClick={(e) => {
        if (e.target === e.currentTarget) onOpenChange(false);
      }}
    >
      <div
        className="w-full max-w-sm bg-white rounded-[16px] shadow-2xl border border-[#E6E6E6] p-4 sm:p-5 relative overflow-hidden mt-12 animate-in slide-in-from-top-2 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="notifications-dialog-title"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-[#E6E6E6] mb-3">
          <div className="flex items-center gap-2">
            <Bell className="w-4 h-4 text-black" />
            <h2
              id="notifications-dialog-title"
              className="text-sm font-bold text-black"
            >
              Notifications
            </h2>
            <span className="sr-only" aria-live="polite">
              {unreadCount} unread notifications
            </span>
            {unreadCount > 0 && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black text-white">
                {unreadCount > 99 ? "99+" : unreadCount}
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
                className="px-2 py-1 rounded-lg text-[#808080] hover:text-black hover:bg-[#F5F5F5] text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50 transition-colors"
              >
                <CheckCheck className="w-3.5 h-3.5" />
                <span>Mark all read</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              aria-label="Close notifications"
              className="p-1.5 rounded-lg text-[#808080] hover:text-black hover:bg-[#F5F5F5] cursor-pointer transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Notifications List */}
        <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-16 rounded-xl bg-[#F5F5F5] animate-pulse border border-[#E6E6E6]"
                />
              ))}
            </div>
          ) : previewItems.length > 0 ? (
            previewItems.map((n) => {
              const isUnread = !n.read_at;
              const relDate = formatRelativeTime(n.created_at);

              return (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleNotificationClick(n)}
                  className={cn(
                    "w-full text-left p-3 rounded-xl border transition-all cursor-pointer relative block",
                    isUnread
                      ? "bg-[#F5F5F5] border-[#E6E6E6] hover:border-[#B3B3B3]"
                      : "bg-white border-[#E6E6E6] opacity-80 hover:opacity-100 hover:bg-[#F5F5F5]"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-xs font-bold text-black flex items-center gap-1.5 line-clamp-1">
                      {getNotificationIcon(n.type, n.title)}
                      <span>{n.title}</span>
                    </span>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {n.link && (
                        <ExternalLink className="w-3 h-3 text-[#808080]" />
                      )}
                      {isUnread && (
                        <span
                          className="w-2 h-2 rounded-full bg-[#F00091] shrink-0"
                          aria-label="Unread"
                        />
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-[#4D4D4D] mt-1 leading-snug line-clamp-2">
                    {n.body}
                  </p>
                  <span className="text-[10px] text-[#808080] mt-1.5 block font-mono">
                    {relDate}
                  </span>
                </button>
              );
            })
          ) : (
            <EmptyState
              className="py-8 border-dashed shadow-none bg-[#F5F5F5]"
              icon={<Bell className="w-5 h-5 text-[#808080]" />}
              title="You're all caught up"
              description="New alerts, task updates, and requests will appear here."
            />
          )}
        </div>

        {/* Footer: View all link */}
        <div className="pt-3 mt-2 border-t border-[#E6E6E6] text-center">
          <Link
            href="/notifications"
            onClick={() => onOpenChange(false)}
            className="text-xs font-bold text-black hover:underline inline-flex items-center gap-1"
          >
            <span>View all notifications</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
