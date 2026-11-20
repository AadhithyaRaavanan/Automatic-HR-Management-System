"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { playNotificationTone } from "@/lib/notifications/sound";

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
    refetchInterval: 60000, // 60s fallback poll
  });

  // 2. Realtime Subscription to `notifications` table for live updates
  React.useEffect(() => {
    if (!userId) return;
    let active = true;

    const channel = supabase
      .channel(`public:notifications:user_id=eq.${userId}`)
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
          // Play notification message chime safely
          const nType = (newNotif?.type || "").toLowerCase();
          playNotificationTone(nType.includes("warning") || nType.includes("overdue") ? "warning" : "default");

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
      )
      .subscribe();

    return () => {
      active = false;
      try {
        supabase.removeChannel(channel);
      } catch {}
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
