"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";

export function useCheckIn() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (note?: string) => {
      // 1. Call server API which authoritatively enforces shift hours
      const res = await fetch("/api/attendance/check-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: note || undefined }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 403 && data.code === "OUTSIDE_SHIFT_HOURS") {
          throw new Error(data.message || "Check-in is not allowed outside your shift hours.");
        }
        if (isDemoModeEnabled()) {
          return { check_in_at: new Date().toISOString() };
        }
        throw new Error(data.error || data.message || "Failed to check in");
      }

      return data;
    },
    onSuccess: (data: any) => {
      toast.success("Checked in successfully!", {
        description: `Punch recorded authoritatively at ${new Date(
          data?.check_in_at || Date.now()
        ).toLocaleTimeString()}`,
      });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to check in");
    },
  });
}
