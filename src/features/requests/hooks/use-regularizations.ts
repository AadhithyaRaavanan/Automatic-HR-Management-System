"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  RegularizationRequestItem,
  RegularizationFormData,
} from "@/features/requests/types";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredRegularizations,
  addStoredRegularization,
  updateStoredRegularization,
} from "@/lib/storage/demo-store";

export function useRegularizations() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useQuery<RegularizationRequestItem[]>({
    queryKey: ["regularizations"],
    queryFn: async () => {
      const stored = getStoredRegularizations();

      if (isDemoModeEnabled()) {
        return stored.map((row) => ({
          id: row.id,
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          work_date: row.work_date,
          requested_in: row.requested_in,
          requested_out: row.requested_out,
          reason: row.reason,
          status: row.status,
          reviewed_by: row.reviewed_by || null,
          reviewed_at: row.reviewed_at || null,
          review_note: row.review_note || null,
          created_at: row.created_at,
        }));
      }

      const { data, error } = await supabase
        .from("regularization_requests")
        .select(`
          *,
          employees:employee_id (full_name)
        `)
        .order("created_at", { ascending: false });

      if (error) {
        return stored.map((row) => ({
          id: row.id,
          employee_id: row.employee_id,
          employee_name: row.employee_name,
          work_date: row.work_date,
          requested_in: row.requested_in,
          requested_out: row.requested_out,
          reason: row.reason,
          status: row.status,
          reviewed_by: row.reviewed_by || null,
          reviewed_at: row.reviewed_at || null,
          review_note: row.review_note || null,
          created_at: row.created_at,
        }));
      }

      return (data || []).map((row: any) => ({
        id: row.id,
        employee_id: row.employee_id,
        employee_name: row.employees?.full_name || undefined,
        work_date: row.work_date,
        requested_in: row.requested_in,
        requested_out: row.requested_out,
        reason: row.reason,
        status: row.status,
        reviewed_by: row.reviewed_by,
        reviewed_at: row.reviewed_at,
        review_note: row.review_note,
        created_at: row.created_at,
      }));
    },
  });
}

export function useSubmitRegularization() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async (formData: RegularizationFormData) => {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? (await supabase.auth.getUser()).data.user;

      const requestedInIso = `${formData.workDate}T${formData.requestedInTime}:00Z`;
      const requestedOutIso = `${formData.workDate}T${formData.requestedOutTime}:00Z`;

      let currentRole = "employee";
      let currentName = "Employee";
      if (typeof window !== "undefined") {
        currentRole = localStorage.getItem("remotehr_cached_role") || "employee";
        currentName = localStorage.getItem("remotehr_cached_name") || (currentRole === "employee" ? "James Sullivan" : "Active User");
      }

      if (user?.id) {
        const { data: existing } = await (supabase.from("regularization_requests") as any)
          .select("id")
          .eq("employee_id", user.id)
          .eq("work_date", formData.workDate)
          .in("status", ["pending", "approved"])
          .maybeSingle();

        if (existing) {
          throw new Error("A regularization request already exists for this date.");
        }
      }

      const newStored = addStoredRegularization({
        employee_id: user?.id || `emp-${currentRole}`,
        employee_name: currentName,
        work_date: formData.workDate,
        requested_in: requestedInIso,
        requested_out: requestedOutIso,
        reason: formData.reason,
        status: "pending",
      });

      if (!user && isDemoModeEnabled()) {
        return newStored;
      }

      try {
        const { data } = await (supabase.from("regularization_requests") as any)
          .insert({
            employee_id: user?.id || newStored.employee_id,
            work_date: formData.workDate,
            requested_in: requestedInIso,
            requested_out: requestedOutIso,
            reason: formData.reason,
            status: "pending",
          })
          .select()
          .single();
        return data || newStored;
      } catch {
        return newStored;
      }
    },
    onSuccess: (data: any, vars: any) => {
      toast.success("Regularization request submitted!");
      queryClient.invalidateQueries({ queryKey: ["regularizations"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });

      fetch("/api/requests/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "submitted",
          requestId: data?.id,
          workDate: vars.workDate,
          reason: vars.reason,
        }),
      }).catch(() => {});
    },
  });
}

export function useApproveRegularization() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      reviewNote,
    }: {
      requestId: string;
      reviewNote: string;
    }) => {
      const res = await fetch("/api/requests/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          action: "approve",
          reviewNote,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to approve regularization request.");
      }

      updateStoredRegularization(requestId, {
        status: "approved",
        review_note: reviewNote,
        reviewed_at: new Date().toISOString(),
      });

      return { success: true };
    },
    onSuccess: () => {
      toast.success("Request approved! Attendance day has been recalculated.");
      queryClient.invalidateQueries({ queryKey: ["regularizations"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to approve request");
    },
  });
}

export function useRejectRegularization() {
  const queryClient = useQueryClient();
  const supabase = createClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      reviewNote,
    }: {
      requestId: string;
      reviewNote: string;
    }) => {
      const res = await fetch("/api/requests/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestId,
          action: "reject",
          reviewNote,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to reject regularization request.");
      }

      updateStoredRegularization(requestId, {
        status: "rejected",
        review_note: reviewNote,
        reviewed_at: new Date().toISOString(),
      });

      return { success: true };
    },
    onSuccess: () => {
      toast.info("Request rejected");
      queryClient.invalidateQueries({ queryKey: ["regularizations"] });
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to reject request");
    },
  });
}
