"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Bell,
  CheckCheck,
  Calendar,
  Clock,
  UserCheck,
  Target,
  ShieldAlert,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Volume2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NotificationItemRecord,
  formatRelativeTime,
  readOrgSelectionCookie,
} from "@/features/notifications/hooks/use-notifications";
import { playNotificationTone } from "@/features/notifications/sound";
import { toast } from "sonner";

function getNotificationIcon(type?: string | null, title?: string | null) {
  const safeType = (type || "").toLowerCase();
  const safeTitle = (title || "").toLowerCase();

  if (
    safeType.includes("birthday") ||
    safeTitle.includes("birthday") ||
    safeTitle.includes("🎂") ||
    safeTitle.includes("🎉")
  ) {
    return <span className="text-base shrink-0">🎂</span>;
  }
  if (safeType.startsWith("leave")) return <Calendar className="w-4 h-4 text-black shrink-0" />;
  if (safeType.startsWith("request") || safeType.startsWith("regularization"))
    return <Clock className="w-4 h-4 text-amber-600 shrink-0" />;
  if (safeType.startsWith("task")) return <UserCheck className="w-4 h-4 text-black shrink-0" />;
  if (safeType.startsWith("kpi")) return <Target className="w-4 h-4 text-black shrink-0" />;
  if (safeType.startsWith("security") || safeType.startsWith("password") || safeType.startsWith("mfa"))
    return <ShieldAlert className="w-4 h-4 text-[#FF1493] shrink-0" />;
  if (safeType.startsWith("holiday")) return <Calendar className="w-4 h-4 text-[#B7FF00] shrink-0" />;
  if (safeType.startsWith("reminder") || safeType.includes("overdue") || safeType.includes("missed"))
    return <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />;
  return <Bell className="w-4 h-4 text-black shrink-0" />;
}

interface NotificationPagePayload {
  notifications: NotificationItemRecord[];
  nextCursor: string | null;
}

function NotificationsPageContent() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const session = useAppSession();
  const activeOrgId = session.organizationId || readOrgSelectionCookie();
  const [filter, setFilter] = React.useState<"all" | "unread">("all");

  const headers = React.useMemo(() => {
    const h: Record<string, string> = {};
    if (activeOrgId) h["x-organization-id"] = activeOrgId;
    return h;
  }, [activeOrgId]);

  const {
    data,
    isLoading,
    isError,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<NotificationPagePayload>({
    queryKey: ["notifications-all", session.userId, activeOrgId, filter],
    initialPageParam: null as string | null,
    enabled: !session.requiresOrgSelection,
    queryFn: async ({ pageParam }) => {
      const params = new URLSearchParams({ limit: "25" });
      if (filter === "unread") params.set("unread_only", "true");
      if (typeof pageParam === "string" && pageParam.length > 0) {
        params.set("cursor", pageParam);
      }

      const res = await fetch(`/api/notifications?${params.toString()}`, {
        cache: "no-store",
        headers,
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => null);
        throw new Error(errJson?.error || "Failed to load notifications");
      }
      const json = await res.json();
      return {
        notifications: Array.isArray(json?.notifications) ? json.notifications : [],
        nextCursor: typeof json?.nextCursor === "string" ? json.nextCursor : null,
      };
    },
    getNextPageParam: (lastPage) => lastPage.nextCursor || undefined,
    staleTime: 0,
    refetchOnMount: "always",
  });

  const { data: unreadCountData } = useQuery<number>({
    queryKey: ["notifications-unread-total", session.userId, activeOrgId],
    enabled: !session.requiresOrgSelection,
    queryFn: async () => {
      const res = await fetch("/api/notifications/unread-count", {
        cache: "no-store",
        headers,
      });
      if (!res.ok) return 0;
      const json = await res.json().catch(() => null);
      return typeof json?.unreadCount === "number" ? json.unreadCount : 0;
    },
    staleTime: 0,
  });

  const notifications = React.useMemo(() => {
    if (!data?.pages) return [];
    const seen = new Set<string>();
    const combined: NotificationItemRecord[] = [];
    for (const page of data.pages) {
      for (const item of page.notifications || []) {
        if (item && item.id && !seen.has(item.id)) {
          seen.add(item.id);
          combined.push(item);
        }
      }
    }
    return combined;
  }, [data]);

  const markSingleRead = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ ids: [id] }),
      });
      if (!res.ok) throw new Error("Failed to mark notification as read");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-total"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) throw new Error("Failed to mark all as read");
      return res.json().catch(() => ({}));
    },
    onSuccess: () => {
      toast.success("All notifications marked as read");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-unread-total"] });
    },
    onError: () => {
      toast.error("Failed to mark all as read");
    },
  });

  const unreadCount =
    typeof unreadCountData === "number"
      ? unreadCountData
      : notifications.filter((n) => Boolean(n && !n.read_at)).length;

  const handleItemClick = async (item: NotificationItemRecord) => {
    if (!item.read_at) {
      await markSingleRead.mutateAsync(item.id).catch(() => {});
    }
    if (item.link) {
      router.push(item.link);
    }
  };

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
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-[#E6E6E6]">
        <div>
          <h1 className="text-2xl font-bold text-black tracking-tight flex items-center gap-2.5">
            <Bell className="w-6 h-6 text-black" />
            <span>Notifications</span>
            {unreadCount > 0 && (
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-black text-white">
                {unreadCount} unread
              </span>
            )}
          </h1>
          <p className="text-xs text-[#808080] mt-1">
            Real-time alerts, review updates, assignments, and reminders
            {session.organizationName ? ` · ${session.organizationName}` : ""}.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex items-center p-1 rounded-xl bg-white border border-[#E6E6E6] shadow-xs">
            <button
              type="button"
              onClick={() => setFilter("all")}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer",
                filter === "all"
                  ? "bg-black text-white shadow-xs"
                  : "text-[#808080] hover:text-black hover:bg-[#F5F5F5]"
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
                  ? "bg-black text-white shadow-xs"
                  : "text-[#808080] hover:text-black hover:bg-[#F5F5F5]"
              )}
            >
              Unread
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              playNotificationTone("default");
              toast.info("Ting sound effect played", { duration: 2000 });
            }}
            title="Test ting sound effect"
            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black transition-colors cursor-pointer shadow-xs"
          >
            <Volume2 className="w-4 h-4 text-black" />
            <span>Test sound</span>
          </button>

          {unreadCount > 0 && (
            <button
              type="button"
              disabled={markAllRead.isPending}
              onClick={() => markAllRead.mutate()}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black transition-colors cursor-pointer shadow-xs disabled:opacity-50"
            >
              <CheckCheck className="w-4 h-4 text-black" />
              <span>Mark all read</span>
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {isError ? (
        <div className="p-6 rounded-[14px] bg-white border border-[#E6E6E6] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-sm font-bold text-black">Could not load notifications</p>
            <p className="text-xs text-[#808080] mt-1">
              {error instanceof Error ? error.message : "An unexpected error occurred."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-black text-white text-xs font-bold cursor-pointer hover:bg-[#222222]"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            <span>Retry</span>
          </button>
        </div>
      ) : isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4, 5].map((i) => (
            <div
              key={i}
              className="h-20 rounded-[14px] bg-white border border-[#E6E6E6] animate-pulse"
            />
          ))}
        </div>
      ) : grouped.length > 0 ? (
        <div className="space-y-6">
          {grouped.map(([groupTitle, items]) => (
            <div key={groupTitle} className="space-y-2.5">
              <h3 className="text-xs font-bold text-[#808080] uppercase tracking-wider px-1">
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
                        "p-4 rounded-[14px] border transition-all cursor-pointer flex items-start justify-between gap-4 group",
                        isUnread
                          ? "bg-[#F5F5F5] border-[#E6E6E6] hover:border-[#B3B3B3] shadow-xs"
                          : "bg-white border-[#E6E6E6] hover:bg-[#FAFAFA]"
                      )}
                    >
                      <div className="flex items-start gap-3 min-w-0">
                        <div className="p-2 rounded-xl bg-white border border-[#E6E6E6] shadow-xs mt-0.5">
                          {getNotificationIcon(n.type, n.title)}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="text-sm font-bold text-black">
                              {n.title}
                            </h4>
                            {isUnread && (
                              <span className="w-2 h-2 rounded-full bg-[#FF1493] shrink-0" />
                            )}
                          </div>
                          <p className="text-xs text-[#4D4D4D] mt-1 leading-relaxed">
                            {n.body}
                          </p>
                          <span className="text-[10px] text-[#808080] font-mono mt-2 block">
                            {relTime}
                          </span>
                        </div>
                      </div>

                      {n.link && (
                        <div className="shrink-0 pt-1 text-[#808080] group-hover:text-black transition-colors">
                          <ExternalLink className="w-4 h-4" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          {hasNextPage && (
            <div className="flex justify-center pt-2">
              <button
                type="button"
                disabled={isFetchingNextPage}
                onClick={() => fetchNextPage()}
                className="px-5 py-2.5 rounded-xl bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-bold text-black transition-colors cursor-pointer shadow-xs disabled:opacity-50"
              >
                {isFetchingNextPage ? "Loading older notifications..." : "Load older notifications"}
              </button>
            </div>
          )}
        </div>
      ) : (
        <EmptyState
          className="py-16 border-dashed"
          icon={<Bell className="w-8 h-8 text-[#808080]" />}
          title={filter === "unread" ? "No unread notifications" : "No notifications yet"}
          description={
            filter === "unread"
              ? "You have caught up with all your updates. Check 'All' to review previous items."
              : "You don't have any notifications at the moment. System events and assignments will arrive here."
          }
        />
      )}
    </div>
  );
}

export default function NotificationsPage() {
  return (
    <AppShell>
      <NotificationsPageContent />
    </AppShell>
  );
}
