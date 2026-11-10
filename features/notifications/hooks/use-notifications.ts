"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { NotificationType } from "@/types/database.types";
import { toast } from "sonner";

export interface NotificationItemRecord {
  id: string;
  organization_id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function useNotifications() {
  const supabase = React.useMemo(() => createClient(), []);
  const queryClient = useQueryClient();
  const [userId, setUserId] = React.useState<string | null>(null);

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

      const { data, error } = await supabase
        .from("notifications")
        .select("id, organization_id, user_id, type, title, body, link, read_at, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(40);

      if (error) throw error;
      return (data || []) as NotificationItemRecord[];
    },
  });

  // Subscribe to private per-user Realtime channel (`notifications:user:<userId>`)
  React.useEffect(() => {
    if (!userId) return;
    let active = true;
    let channelRef: ReturnType<typeof supabase.channel> | null = null;

    async function subscribePrivateChannel() {
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!active || !session?.access_token) return;

        await supabase.realtime.setAuth(session.access_token);
        const channel = supabase.channel(`notifications:user:${userId}`, {
          config: { private: true },
        });

        channel
          .on("broadcast", { event: "notification_created" }, (payload) => {
            queryClient.invalidateQueries({ queryKey: ["notifications"] });
            const incoming = payload?.payload as Partial<NotificationItemRecord> | undefined;
            if (incoming?.title) {
              toast.info(incoming.title, {
                description: incoming.body,
              });
            }
          })
          .subscribe();

        channelRef = channel;
      } catch {
        // Fallback to manual / query refetch if Realtime unavailable
      }
    }

    subscribePrivateChannel();

    return () => {
      active = false;
      if (channelRef) {
        supabase.removeChannel(channelRef);
      }
    };
  }, [userId, supabase, queryClient]);

  const markSingleRead = useMutation({
    mutationFn: async (notificationId: string) => {
      if (!userId) return;
      const nowIso = new Date().toISOString();
      const { error } = await (supabase.from("notifications") as any)
        .update({ read_at: nowIso })
        .eq("id", notificationId)
        .eq("user_id", userId)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      if (!userId) return;
      const nowIso = new Date().toISOString();
      const { error } = await (supabase.from("notifications") as any)
        .update({ read_at: nowIso })
        .eq("user_id", userId)
        .is("read_at", null);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("All notifications marked as read");
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
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

