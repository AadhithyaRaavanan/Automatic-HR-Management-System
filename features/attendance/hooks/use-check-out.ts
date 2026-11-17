"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { toast } from "sonner";
import { formatDurationMinutes } from "@/lib/date/timezone";
import { isDemoModeEnabled } from "@/lib/config/demo";

export function useCheckOut() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase.rpc as any)("check_out");

      if (error) {
        if (isDemoModeEnabled()) {
          return {
            duration_minutes: 480,
            work_date: new Date().toISOString().slice(0, 10),
          };
        }
        throw new Error(error.message);
      }
      return data;
    },
    onSuccess: (data: any) => {
      const duration = formatDurationMinutes(data?.duration_minutes || 0);
      if (typeof window !== "undefined") {
        localStorage.setItem("remotehr_last_checkout_timestamp", String(Date.now()));
      }
      toast.info("Checked out successfully!", {
        description: `Session closed. Logged ${duration} for ${data?.work_date}. Auto logout scheduled after 3 hours.`,
      });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to check out");
    },
  });
}
