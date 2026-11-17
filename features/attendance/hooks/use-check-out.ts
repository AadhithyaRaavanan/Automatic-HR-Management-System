"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDurationMinutes } from "@/lib/date/timezone";
import { isDemoModeEnabled } from "@/lib/config/demo";

export interface CheckOutParams {
  confirm_early?: boolean;
  reason?: string;
}

export interface EarlyCheckOutPayload {
  error: string;
  code: string;
  shift_end_time: string;
  minutes_early: number;
  formatted_early: string;
  message: string;
}

export function useCheckOut(options?: {
  onEarlyCheckOutRequired?: (payload: EarlyCheckOutPayload) => void;
}) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (params?: CheckOutParams) => {
      const res = await fetch("/api/attendance/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(params || {}),
      });

      const data = await res.json();

      if (res.status === 409 && data.code === "EARLY_CHECKOUT") {
        const err: any = new Error(data.message || "Early checkout confirmation required");
        err.code = "EARLY_CHECKOUT";
        err.payload = data;
        throw err;
      }

      if (!res.ok) {
        if (isDemoModeEnabled()) {
          return {
            duration_minutes: 480,
            work_date: new Date().toISOString().slice(0, 10),
          };
        }
        throw new Error(data.error || "Failed to check out");
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
    onError: (err: any) => {
      if (err.code === "EARLY_CHECKOUT") {
        if (options?.onEarlyCheckOutRequired) {
          options.onEarlyCheckOutRequired(err.payload);
          return;
        }
      }
      toast.error(err.message || "Failed to check out");
    },
  });
}
