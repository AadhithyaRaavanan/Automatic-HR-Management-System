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
import { isDemoModeEnabled } from "@/lib/config/demo";

const mockLeaveTypes: LeaveType[] = [
  { id: "00000000-0000-0000-0000-000000000001", organization_id: "00000000-0000-0000-0000-000000000001", name: "Casual Leave", code: "CL", is_paid: true, is_active: true },
  { id: "00000000-0000-0000-0000-000000000002", organization_id: "00000000-0000-0000-0000-000000000001", name: "Sick Leave", code: "SL", is_paid: true, is_active: true },
  { id: "00000000-0000-0000-0000-000000000003", organization_id: "00000000-0000-0000-0000-000000000001", name: "Privilege Leave", code: "PL", is_paid: true, is_active: true },
];

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
      if (error && isDemoModeEnabled()) return mockLeaveTypes;
      if (error) throw error;
      const list = (data || []) as LeaveType[];
      return list.length > 0 ? list : (isDemoModeEnabled() ? mockLeaveTypes : []);
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
      if (error && isDemoModeEnabled()) {
        const curYear = new Date().getFullYear();
        return mockLeaveTypes.map((lt) => ({
          id: `pol-${lt.id}`,
          organization_id: lt.organization_id,
          leave_type_id: lt.id,
          yearly_quota: 15,
          monthly_cap: 3,
          carry_forward_max: 5,
          probation_allowed: true,
          effective_from: `${curYear}-01-01`,
          leave_types: lt,
        }));
      }
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

      if (isDemoModeEnabled()) {
        const curYear = new Date().getFullYear();
        const storedRequests = getDemoRequests();
        const usedByType = new Map<string, number>();
        for (const req of storedRequests) {
          if (req.status === "approved") {
            usedByType.set(req.leave_type_id, (usedByType.get(req.leave_type_id) || 0) + req.total_days);
          }
        }
        return [
          {
            id: "bal-1",
            organization_id: "00000000-0000-0000-0000-000000000001",
            employee_id: employeeId || "demo-emp",
            leave_type_id: mockLeaveTypes[0].id,
            allocated: 12,
            used: usedByType.get(mockLeaveTypes[0].id) || 0,
            carried_forward: 0,
            adjusted: 0,
            period_start: `${curYear}-01-01`,
            period_end: `${curYear}-12-31`,
            leave_types: mockLeaveTypes[0],
          },
          {
            id: "bal-2",
            organization_id: "00000000-0000-0000-0000-000000000001",
            employee_id: employeeId || "demo-emp",
            leave_type_id: mockLeaveTypes[1].id,
            allocated: 10,
            used: usedByType.get(mockLeaveTypes[1].id) || 0,
            carried_forward: 0,
            adjusted: 0,
            period_start: `${curYear}-01-01`,
            period_end: `${curYear}-12-31`,
            leave_types: mockLeaveTypes[1],
          },
          {
            id: "bal-3",
            organization_id: "00000000-0000-0000-0000-000000000001",
            employee_id: employeeId || "demo-emp",
            leave_type_id: mockLeaveTypes[2].id,
            allocated: 15,
            used: usedByType.get(mockLeaveTypes[2].id) || 0,
            carried_forward: 0,
            adjusted: 0,
            period_start: `${curYear}-01-01`,
            period_end: `${curYear}-12-31`,
            leave_types: mockLeaveTypes[2],
          },
        ] as LeaveBalance[];
      }

      const { data, error } = await query;
      if (error) throw error;
      return (data || []) as LeaveBalance[];
    },
  });
}

const defaultDemoRequests: LeaveRequest[] = [];

function getDemoRequests(): LeaveRequest[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("remotehr_demo_leave_requests");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        // Cleanse legacy hardcoded fake demo requests from earlier session
        const cleaned = parsed.filter(
          (r: any) =>
            !r.id?.startsWith("lr-demo-") &&
            r.reason !== "Family event and personal commitment" &&
            r.reason !== "Doctor appointment in morning"
        );
        if (cleaned.length !== parsed.length) {
          localStorage.setItem("remotehr_demo_leave_requests", JSON.stringify(cleaned));
        }
        return cleaned;
      }
    }
  } catch {}
  return [];
}

function saveDemoRequests(requests: LeaveRequest[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem("remotehr_demo_leave_requests", JSON.stringify(requests));
    window.dispatchEvent(new Event("remotehr_storage_change"));
  } catch {}
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

      if (isDemoModeEnabled()) {
        const stored = getDemoRequests();
        if (status && status !== "all") {
          return stored.filter((r) => r.status === status);
        }
        return stored;
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
      let rpcResult: any = null;
      let rpcError: any = null;
      try {
        const res = await (supabase.rpc as any)("request_leave", {
          p_leave_type_id: leaveTypeId,
          p_start_date: startDate,
          p_end_date: endDate,
          p_day_part: dayPart,
          p_reason: reason,
        });
        rpcResult = res.data;
        rpcError = res.error;
      } catch (e: any) {
        rpcError = e;
      }

      if (isDemoModeEnabled()) {
        const currentList = getDemoRequests();
        const selectedType = mockLeaveTypes.find((lt) => lt.id === leaveTypeId) || mockLeaveTypes[0];
        const currentRole = typeof window !== "undefined" ? localStorage.getItem("remotehr_cached_role") || "employee" : "employee";
        const currentName = typeof window !== "undefined" ? localStorage.getItem("remotehr_cached_name") || "Active User" : "Active User";
        const currentEmail = typeof window !== "undefined" ? localStorage.getItem("remotehr_cached_email") || `${currentRole}@remotehr.io` : `${currentRole}@remotehr.io`;
        const newReq: LeaveRequest = {
          id: rpcResult?.request_id || `lr-${Date.now()}`,
          organization_id: "00000000-0000-0000-0000-000000000001",
          employee_id: `emp-${currentRole}`,
          leave_type_id: leaveTypeId,
          start_date: startDate,
          end_date: endDate,
          total_days: dayPart === "full" ? 1 : 0.5,
          day_part: dayPart,
          reason,
          status: "pending",
          created_at: new Date().toISOString(),
          leave_types: selectedType,
          employees: {
            id: `emp-${currentRole}`,
            full_name: currentName,
            email: currentEmail,
            department_id: "general",
          },
        };
        const updated = [newReq, ...currentList];
        saveDemoRequests(updated);
        return { success: true, request: newReq };
      }

      if (rpcError) throw rpcError;
      return rpcResult;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["regularizations"] });
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
      try {
        await (supabase.rpc as any)("approve_leave", {
          p_request_id: requestId,
          p_review_note: reviewNote,
        });
      } catch {}

      if (isDemoModeEnabled()) {
        const list = getDemoRequests();
        const updated = list.map((r) => (r.id === requestId ? { ...r, status: "approved" as const } : r));
        saveDemoRequests(updated);
        return { success: true };
      }
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
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
      reviewNote?: string;
    }) => {
      try {
        await (supabase.rpc as any)("reject_leave", {
          p_request_id: requestId,
          p_review_note: reviewNote,
        });
      } catch {}

      if (isDemoModeEnabled()) {
        const list = getDemoRequests();
        const updated = list.map((r) => (r.id === requestId ? { ...r, status: "rejected" as const } : r));
        saveDemoRequests(updated);
        return { success: true };
      }
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.info("Leave request rejected");
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
      try {
        await (supabase.rpc as any)("cancel_leave", {
          p_request_id: requestId,
          p_reason: reason,
        });
      } catch {}

      if (isDemoModeEnabled()) {
        const list = getDemoRequests();
        const updated = list.map((r) => (r.id === requestId ? { ...r, status: "cancelled" as const } : r));
        saveDemoRequests(updated);
        return { success: true, message: "Leave cancelled successfully" };
      }
      return { success: true };
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["leave-requests"] });
      queryClient.invalidateQueries({ queryKey: ["leave-balances"] });
      queryClient.invalidateQueries({ queryKey: ["attendance"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
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
      if (error && isDemoModeEnabled()) {
        return { success: true };
      }
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
      if (error && isDemoModeEnabled()) {
        return { success: true };
      }
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
      if (error && isDemoModeEnabled()) {
        return { success: true };
      }
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
