"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { useAppSession } from "@/components/shell/app-shell";
import { toast } from "sonner";
import { playNotificationTone } from "@/features/notifications/sound";

export interface NotificationItemRecord {
  id: string;
  user_id: string;
  organization_id?: string | null;
  type: string;
  title: string;
  body: string;
  link: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  actor_id?: string | null;
  read_at: string | null;
  created_at: string;
  dedupe_key?: string | null;
}

interface NotificationsFeedData {
  notifications: NotificationItemRecord[];
  unreadCount: number;
}

export function readOrgSelectionCookie(): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)pulse_org_id=([^;]*)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function formatRelativeTime(dateString?: string | null): string {
  if (!dateString) return "Recently";
  try {
    const timestamp = new Date(dateString).getTime();
    if (isNaN(timestamp)) return "Recently";
    const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
    if (diffSec < 45) return "Just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays}d ago`;
    return new Date(dateString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "Recently";
  }
}

export function useNotifications() {
  const supabase = React.useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const sessionContext = typeof useAppSession === "function" ? useAppSession() : null;
  const [userId, setUserId] = React.useState<string | null>(null);
  const activeOrgId = sessionContext?.organizationId || readOrgSelectionCookie();
  const requiresOrgSelection = Boolean(sessionContext?.requiresOrgSelection);

  React.useEffect(() => {
    let active = true;
    async function initUser() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (active && session?.access_token && session?.user?.id) {
          setUserId(session.user.id);
          return;
        }
        const { data: userData } = await supabase.auth.getUser();
        if (active && userData?.user?.id) {
          setUserId(userData.user.id);
        }
      } catch {}
    }
    initUser();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      setUserId(session?.user?.id || null);
    });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, [supabase]);

  const effectiveUserId = userId || sessionContext?.userId || null;
  const notificationsQueryKey = React.useMemo(
    () => ["notifications", effectiveUserId, activeOrgId] as const,
    [effectiveUserId, activeOrgId]
  );

  // 1. Fetch user notifications + true workspace unread count
  const query = useQuery<NotificationsFeedData>({
    queryKey: notificationsQueryKey,
    enabled: Boolean(effectiveUserId) && !requiresOrgSelection,
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user ?? (await supabase.auth.getUser()).data.user;
      if (!user) {
        return { notifications: [], unreadCount: 0 };
      }

      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      if (activeOrgId) {
        headers["x-organization-id"] = activeOrgId;
      }

      const [listRes, countRes] = await Promise.all([
        fetch("/api/notifications?limit=30", { cache: "no-store", headers }),
        fetch("/api/notifications/unread-count", { cache: "no-store", headers }),
      ]);

      if (listRes.ok) {
        const json = await listRes.json();
        const list: NotificationItemRecord[] = Array.isArray(json?.notifications)
          ? json.notifications
          : [];
        let unreadCount = list.filter((n) => Boolean(n && !n.read_at)).length;
        if (countRes.ok) {
          const countJson = await countRes.json().catch(() => null);
          if (typeof countJson?.unreadCount === "number") {
            unreadCount = countJson.unreadCount;
          }
        }
        return { notifications: list, unreadCount };
      }

      // Only attempt browser REST fallback when a valid bearer session token & activeOrgId are present
      if (!session?.access_token || !activeOrgId) {
        return { notifications: [], unreadCount: 0 };
      }

      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .eq("organization_id", activeOrgId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(30);

      if (error) {
        return { notifications: [], unreadCount: 0 };
      }
      const fallbackList = (Array.isArray(data) ? data : []) as NotificationItemRecord[];
      return {
        notifications: fallbackList,
        unreadCount: fallbackList.filter((n) => Boolean(n && !n.read_at)).length,
      };
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 15000,
  });

  // Track known notification IDs per user + organization to detect newly arrived alerts
  const knownNotificationIds = React.useRef<Set<string> | null>(null);
  const scopeKeyRef = React.useRef<string>("");

  React.useEffect(() => {
    const scopeKey = `${effectiveUserId || ""}:${activeOrgId || ""}`;
    if (scopeKeyRef.current !== scopeKey) {
      scopeKeyRef.current = scopeKey;
      knownNotificationIds.current = null;
    }
  }, [effectiveUserId, activeOrgId]);

  const notifications = Array.isArray(query.data?.notifications) ? query.data.notifications : [];
  const unreadCount =
    typeof query.data?.unreadCount === "number"
      ? query.data.unreadCount
      : notifications.filter((n) => Boolean(n && !n.read_at)).length;

  React.useEffect(() => {
    if (!query.data?.notifications) return;

    const currentIds = new Set(query.data.notifications.map((n) => n?.id).filter(Boolean));

    if (knownNotificationIds.current === null) {
      knownNotificationIds.current = currentIds;

      const unreadNotifications = query.data.notifications.filter((n) => Boolean(n && !n.read_at));
      if (unreadNotifications.length > 0) {
        const chimeSessionKey = effectiveUserId
          ? `notif_login_chime_${effectiveUserId}_${activeOrgId || "default"}`
          : "notif_login_chime_user";
        const hasPlayedForSession =
          typeof sessionStorage !== "undefined" && sessionStorage.getItem(chimeSessionKey);

        if (!hasPlayedForSession) {
          try {
            sessionStorage.setItem(chimeSessionKey, "true");
          } catch {}

          const latest = unreadNotifications[0];
          const nType = (latest?.type || "").toLowerCase();
          playNotificationTone(
            nType.includes("warning") || nType.includes("overdue") ? "warning" : "default",
            latest.id
          );
        }
      }
      return;
    }

    const newItems = query.data.notifications.filter(
      (n) => n && !n.read_at && !knownNotificationIds.current!.has(n.id)
    );

    if (newItems.length > 0) {
      const latest = newItems[0];
      const nType = (latest?.type || "").toLowerCase();
      playNotificationTone(
        nType.includes("warning") || nType.includes("overdue") ? "warning" : "default",
        latest.id
      );

      if (typeof document !== "undefined" && !document.hidden && latest?.title) {
        toast.info(latest.title, {
          description: latest.body,
          id: `notif-${latest.id}`,
          duration: 5000,
        });
      }
    }

    knownNotificationIds.current = currentIds;
  }, [query.data, effectiveUserId, activeOrgId]);

  // 2. Realtime Subscription scoped to user & active organization
  React.useEffect(() => {
    if (!effectiveUserId) return;
    let active = true;

    const channelName = `notifs_${effectiveUserId}_${activeOrgId || "all"}_${Math.random().toString(36).slice(2, 9)}`;
    let channel: any = null;

    try {
      channel = supabase
        .channel(channelName)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${effectiveUserId}`,
          },
          (payload) => {
            if (!active) return;
            const newNotif = payload.new as NotificationItemRecord;
            if (activeOrgId && newNotif?.organization_id && newNotif.organization_id !== activeOrgId) {
              return;
            }
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            queryClient.invalidateQueries({ queryKey: ["notifications-all"] });

            const nType = (newNotif?.type || "").toLowerCase();
            playNotificationTone(
              nType.includes("warning") || nType.includes("overdue") ? "warning" : "default",
              newNotif?.id
            );

            if (typeof document !== "undefined" && !document.hidden && newNotif?.title) {
              toast.info(newNotif.title, {
                description: newNotif.body,
                id: `notif-${newNotif.id}`,
                duration: 5000,
              });
            }
          }
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${effectiveUserId}`,
          },
          (payload) => {
            if (!active) return;
            const updated = payload.new as NotificationItemRecord;
            if (activeOrgId && updated?.organization_id && updated.organization_id !== activeOrgId) {
              return;
            }
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
          }
        );

      channel.subscribe();
    } catch (err) {
      console.warn("[useNotifications] Realtime subscription error:", err);
    }

    return () => {
      active = false;
      if (channel) {
        try {
          supabase.removeChannel(channel);
        } catch {}
      }
    };
  }, [effectiveUserId, activeOrgId, supabase, queryClient]);

  // 3. Mark single notification as read
  const markSingleRead = useMutation({
    mutationFn: async (notificationId: string) => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeOrgId) headers["x-organization-id"] = activeOrgId;
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers,
        body: JSON.stringify({ ids: [notificationId] }),
      });
      if (!res.ok) {
        throw new Error("Failed to mark notification as read");
      }
    },
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
      const previous = queryClient.getQueryData<NotificationsFeedData>(notificationsQueryKey);
      if (previous) {
        const targetWasUnread = previous.notifications.some(
          (n) => n && n.id === notificationId && !n.read_at
        );
        queryClient.setQueryData<NotificationsFeedData>(notificationsQueryKey, {
          notifications: previous.notifications.map((n) =>
            n && n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n
          ),
          unreadCount: targetWasUnread ? Math.max(0, previous.unreadCount - 1) : previous.unreadCount,
        });
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notificationsQueryKey, context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
    },
  });

  // 4. Mark all notifications in the active organization as read
  const markAllRead = useMutation({
    mutationFn: async () => {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeOrgId) headers["x-organization-id"] = activeOrgId;
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers,
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) {
        throw new Error("Failed to mark all as read");
      }
      return res.json().catch(() => ({}));
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: notificationsQueryKey });
      const previous = queryClient.getQueryData<NotificationsFeedData>(notificationsQueryKey);
      if (previous) {
        const nowIso = new Date().toISOString();
        queryClient.setQueryData<NotificationsFeedData>(notificationsQueryKey, {
          notifications: previous.notifications.map((n) =>
            n ? { ...n, read_at: n.read_at || nowIso } : n
          ),
          unreadCount: 0,
        });
      }
      return { previous };
    },
    onSuccess: () => {
      toast.success("All notifications marked as read");
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(notificationsQueryKey, context.previous);
      }
      toast.error("Failed to mark all as read");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
    },
  });

  return {
    notifications,
    unreadCount,
    isLoading: query.isLoading,
    refetch: query.refetch,
    markSingleRead: markSingleRead.mutateAsync,
    markAllRead: markAllRead.mutateAsync,
    isMarkingAll: markAllRead.isPending,
  };
}
