"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  LeaveType,
  LeavePolicy,
  LeaveBalance,
  LeaveRequest,
  LeaveAdjustment,
  CompanyDayOff,
} from "../types";
import { toast } from "sonner";

export function useLeaveTypes() {
  const supabase = createClient();
  return useQuery<LeaveType[]>({
    queryKey: ["leave-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_types")
        .select("*")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      return (data || []) as LeaveType[];
    },
  });
}

export function useLeavePolicies() {
  const supabase = createClient();
  return useQuery<LeavePolicy[]>({
    queryKey: ["leave-policies"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("leave_policies")
        .select(`
          *,
          leave_types:leave_type_id (*)
        `)
        .order("created_at");
      if (error) throw error;
      return (data || []) as LeavePolicy[];
    },
  });
}

export function useLeaveBalances(employeeId?: string) {
  const supabase = createClient();
  return useQuery<LeaveBalance[]>({
    queryKey: ["leave-balances", employeeId],
    queryFn: async () => {
      let query = supabase
        .from("leave_balances")
        .select(`
          *,
          leave_types:leave_type_id (*)
        `);

      if (employeeId) {
        query = query.eq("employee_id", employeeId);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as LeaveBalance[];
    },
  });
}

export function useLeaveRequests(status?: string) {
  const supabase = createClient();
  return useQuery<LeaveRequest[]>({
    queryKey: ["leave-requests", status],
    queryFn: async () => {
      let query = supabase
        .from("leave_requests")
        .select(`
          *,
          leave_types:leave_type_id (*),
          employees:employee_id (id, full_name, email, department_id)
        `)
        .order("created_at", { ascending: false });

      if (status && status !== "all") {
        query = query.eq("status", status);
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as LeaveRequest[];
    },
  });
}

export function useCompanyDaysOff() {
  const supabase = createClient();
  return useQuery<CompanyDayOff[]>({
    queryKey: ["company-days-off"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("company_days_off")
        .select(`
          *,
          departments:department_id (name)
        `)
        .order("date", { ascending: false });
      if (error) throw error;
      return (data || []) as CompanyDayOff[];
    },
  });
}

export function useRequestLeave() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      leaveTypeId,
      startDate,
      endDate,
      dayPart = "full",
      reason,
    }: {
      leaveTypeId: string;
      startDate: string;
      endDate: string;
      dayPart?: "full" | "first_half" | "second_half";
      reason: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)("request_leave", {
        p_leave_type_id: leaveTypeId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_day_part: dayPart,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave request submitted successfully");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to submit leave request");
    },
  });
}

export function useApproveLeave() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      reviewNote,
    }: {
      requestId: string;
      reviewNote?: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)("approve_leave", {
        p_request_id: requestId,
        p_review_note: reviewNote,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave approved successfully");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to approve leave");
    },
  });
}

export function useRejectLeave() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      reviewNote,
    }: {
      requestId: string;
      reviewNote: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)("reject_leave", {
        p_request_id: requestId,
        p_review_note: reviewNote,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave request rejected");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to reject leave");
    },
  });
}

export function useCancelLeave() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      requestId,
      reason,
    }: {
      requestId: string;
      reason?: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)("cancel_leave", {
        p_request_id: requestId,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave cancelled successfully");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to cancel leave");
    },
  });
}

export function useHRAssignLeave() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      employeeIds,
      leaveTypeId,
      startDate,
      endDate,
      dayPart = "full",
      reason = "",
      overrideBalance = false,
    }: {
      employeeIds: string[];
      leaveTypeId: string;
      startDate: string;
      endDate: string;
      dayPart?: "full" | "first_half" | "second_half";
      reason?: string;
      overrideBalance?: boolean;
    }) => {
      const { data, error } = await (supabase.rpc as any)("hr_assign_leave", {
        p_employee_ids: employeeIds,
        p_leave_type_id: leaveTypeId,
        p_start_date: startDate,
        p_end_date: endDate,
        p_day_part: dayPart,
        p_reason: reason,
        p_override_balance: overrideBalance,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave assigned successfully");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to assign leave");
    },
  });
}

export function useHRAdjustBalance() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      employeeId,
      leaveTypeId,
      amount,
      reason,
    }: {
      employeeId: string;
      leaveTypeId: string;
      amount: number;
      reason: string;
    }) => {
      const { data, error } = await (supabase.rpc as any)("hr_adjust_balance", {
        p_employee_id: employeeId,
        p_leave_type_id: leaveTypeId,
        p_amount: amount,
        p_reason: reason,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      toast.success("Leave balance adjusted successfully");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to adjust balance");
    },
  });
}

export function useDeclareCompanyDayOff() {
  const supabase = createClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      date,
      title,
      departmentId,
    }: {
      date: string;
      title: string;
      departmentId?: string | null;
    }) => {
      const { data, error } = await (supabase.rpc as any)("declare_company_day_off", {
        p_date: date,
        p_title: title,
        p_department_id: departmentId || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["company-days-off"] });
      queryClient.invalidateQueries({ queryKey: ["holidays"] });
      toast.success("Company day off declared successfully");
    },
    onError: (err: any) => {
      toast.error(err.message || "Failed to declare company day off");
    },
  });
}
