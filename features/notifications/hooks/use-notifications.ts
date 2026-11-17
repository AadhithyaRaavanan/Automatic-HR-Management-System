"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";

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

export function formatRelativeTime(dateString: string): string {
  try {
    const diffSec = Math.max(0, Math.floor((Date.now() - new Date(dateString).getTime()) / 1000));
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
    return dateString;
  }
}

export function useNotifications() {
  const supabase = React.useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [userId, setUserId] = React.useState<string | null>(null);

  // 1. Fetch user notifications with 60-second fallback polling
  const query = useQuery<NotificationItemRecord[]>({
    queryKey: ["notifications"],
    queryFn: async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const user = session?.user ?? (await supabase.auth.getUser()).data.user;
      if (!user) {
        setUserId(null);
        return [];
      }
      setUserId(user.id);

      const res = await fetch("/api/notifications?limit=30");
      if (res.ok) {
        const json = await res.json();
        return json.notifications || [];
      }

      // Supabase fallback query if API route is unreachable
      const { data, error } = await supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(30);

      if (error) return [];
      return (data || []) as NotificationItemRecord[];
    },
    staleTime: 15000,
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
      supabase.removeChannel(channel);
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
      if (previous) {
        queryClient.setQueryData<NotificationItemRecord[]>(
          ["notifications"],
          previous.map((n) =>
            n.id === notificationId ? { ...n, read_at: new Date().toISOString() } : n
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
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: ["notifications"] });
      const previous = queryClient.getQueryData<NotificationItemRecord[]>(["notifications"]);
      if (previous) {
        const nowIso = new Date().toISOString();
        queryClient.setQueryData<NotificationItemRecord[]>(
          ["notifications"],
          previous.map((n) => ({ ...n, read_at: n.read_at || nowIso }))
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

  const notifications = query.data || [];
  const unreadCount = notifications.filter((n) => !n.read_at).length;

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
