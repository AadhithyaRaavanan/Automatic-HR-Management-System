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
      const { data, error } = await (supabase.rpc as any)("check_in", {
        p_note: note || undefined,
      });

      if (error) {
        if (isDemoModeEnabled()) {
          return { check_in_at: new Date().toISOString() };
        }
        throw new Error(error.message);
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
