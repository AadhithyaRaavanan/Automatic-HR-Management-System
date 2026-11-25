"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { playNotificationTone } from "@/features/notifications/sound";

export interface NotificationItemRecord {
  id: string;
  user_id: string;
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
  const [userId, setUserId] = React.useState<string | null>(null);

  // Initialize active user ID outside queryFn to prevent render-cycle state updates
  React.useEffect(() => {
    let active = true;
    async function initUser() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user ?? (await supabase.auth.getUser()).data.user;
        if (active && user?.id) {
          setUserId(user.id);
        }
      } catch {}
    }
    initUser();
    return () => {
      active = false;
    };
  }, [supabase]);

  // 1. Fetch user notifications with 60-second fallback polling
  const query = useQuery<NotificationItemRecord[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user ?? (await supabase.auth.getUser()).data.user;
        if (!user) {
          return [];
        }

        const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
        if (res.ok) {
          const json = await res.json();
          const list: NotificationItemRecord[] = Array.isArray(json?.notifications) ? json.notifications : [];
          return list.filter(
            (n) =>
              Boolean(n && (!n.body || !n.body.toLowerCase().includes("example notification")) && !(n as any).metadata?.isExample)
          );
        }

        // Supabase fallback query if API route is unreachable
        const { data, error } = await supabase
          .from("notifications")
          .select("*")
          .eq("user_id", user.id)
          .not("body", "ilike", "%Example Notification%")
          .order("created_at", { ascending: false })
          .limit(30);

        if (error) return [];
        const fallbackList = (Array.isArray(data) ? data : []) as NotificationItemRecord[];
        return fallbackList.filter(
          (n) =>
            Boolean(n && (!n.body || !n.body.toLowerCase().includes("example notification")) && !(n as any).metadata?.isExample)
        );
      } catch (err) {
        console.error("[useNotifications] Query error:", err);
        return [];
      }
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchInterval: 15000, // 15s fallback poll
  });

  // Track known notification IDs to detect newly arrived notifications via polling or refetch
  const knownNotificationIds = React.useRef<Set<string> | null>(null);

  React.useEffect(() => {
    if (!query.data || !Array.isArray(query.data)) return;

    const currentIds = new Set(query.data.map((n) => n?.id).filter(Boolean));

    // On initial load (user login / session start):
    if (knownNotificationIds.current === null) {
      knownNotificationIds.current = currentIds;

      // Check if user has active unread / non-viewed notifications on login
      const unreadNotifications = query.data.filter((n) => Boolean(n && !n.read_at));
      if (unreadNotifications.length > 0) {
        const chimeSessionKey = userId ? `notif_login_chime_${userId}` : "notif_login_chime_user";
        const hasPlayedForSession = typeof sessionStorage !== "undefined" && sessionStorage.getItem(chimeSessionKey);

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

    // Check if any NEW unread notification appeared in this query cycle
    const newItems = query.data.filter(
      (n) => n && !n.read_at && !knownNotificationIds.current!.has(n.id)
    );

    if (newItems.length > 0) {
      const latest = newItems[0];
      const nType = (latest?.type || "").toLowerCase();
      playNotificationTone(
        nType.includes("warning") || nType.includes("overdue") ? "warning" : "default",
        latest.id
      );

      // Trigger subtle toast only if tab is currently focused / visible
      if (typeof document !== "undefined" && !document.hidden && latest?.title) {
        toast.info(latest.title, {
          description: latest.body,
          id: `notif-${latest.id}`,
          duration: 5000,
        });
      }
    }

    knownNotificationIds.current = currentIds;
  }, [query.data]);

  // 2. Realtime Subscription to `notifications` table for live updates
  React.useEffect(() => {
    if (!userId) return;
    let active = true;

    // Use a unique channel name per hook instance to prevent 'cannot add callbacks after subscribe' collision
    const channelName = `notifs_${userId}_${Math.random().toString(36).slice(2, 9)}`;
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
            filter: `user_id=eq.${userId}`,
          },
          (payload) => {
            if (!active) return;
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            queryClient.invalidateQueries({ queryKey: ["notifications-all"] });

            const newNotif = payload.new as NotificationItemRecord;
            // Play notification "ting" sound safely
            const nType = (newNotif?.type || "").toLowerCase();
            playNotificationTone(
              nType.includes("warning") || nType.includes("overdue") ? "warning" : "default",
              newNotif?.id
            );

            // Trigger subtle toast only if tab is currently focused / visible
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
            filter: `user_id=eq.${userId}`,
          },
          () => {
            if (!active) return;
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
  }, [userId, supabase, queryClient]);

  // 3. Mark single notification as read
  const markSingleRead = useMutation({
    mutationFn: async (notificationId: string) => {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: [notificationId] }),
      });
    },
    onMutate: async (notificationId) => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previous = queryClient.getQueryData<NotificationItemRecord[]>(["notifications"]);
      if (Array.isArray(previous)) {
        queryClient.setQueryData<NotificationItemRecord[]>(
          ["notifications"],
          previous.map((n) =>
            n && n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n
          )
        );
      }
      return { previous };
    },
    onError: (_err, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["notifications"], context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
    },
  });

  // 4. Mark all notifications as read
  const markAllRead = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      if (!res.ok) {
        throw new Error("Failed to mark all as read");
      }
      return res.json().catch(() => ({}));
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previous = queryClient.getQueryData<NotificationItemRecord[]>(["notifications"]);
      if (Array.isArray(previous)) {
        const nowIso = new Date().toISOString();
        queryClient.setQueryData<NotificationItemRecord[]>(
          ["notifications"],
          previous.map((n) => (n ? { ...n, read_at: n.read_at || nowIso } : n))
        );
      }
      return { previous };
    },
    onSuccess: () => {
      toast.success("All notifications marked as read");
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) {
        queryClient.setQueryData(["notifications"], context.previous);
      }
      toast.error("Failed to mark all as read");
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
    },
  });

  const notifications = Array.isArray(query.data) ? query.data : [];
  const unreadCount = notifications.filter((n) => Boolean(n && !n.read_at)).length;

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
