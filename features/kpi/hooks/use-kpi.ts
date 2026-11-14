"use client";

import * as React from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import {
  KpiDirection,
  KpiPeriodType,
  KpiSourceMetric,
} from "@/types/database.types";
import { KpiPeriodRecord } from "@/lib/kpi/helpers";
import { toast } from "sonner";

export interface KpiDefinitionRecord {
  id: string;
  organization_id: string;
  name: string;
  description: string | null;
  source_metric: KpiSourceMetric;
  target_value: number;
  direction: KpiDirection;
  weight: number;
  applies_to_role: "employee" | "manager" | "hr" | "admin" | null;
  applies_to_department_id: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface KpiScoreRecord {
  id: string;
  organization_id: string;
  period_id: string;
  employee_id: string;
  kpi_definition_id: string;
  actual_value: number | null;
  target_value: number;
  score: number | null;
  computed_at: string;
}

export interface KpiReviewRecord {
  id: string;
  organization_id: string;
  period_id: string;
  employee_id: string;
  reviewer_id: string;
  rating: number;
  comment: string;
  created_at: string;
  updated_at: string;
}

export interface KpiEmployeeOption {
  id: string;
  full_name: string | null;
  email: string;
  manager_id: string | null;
  department_id: string | null;
  status: string;
}

export interface KpiDepartmentOption {
  id: string;
  name: string;
  code: string | null;
}

export function useKpiData(enabled = true) {
  const supabase = React.useMemo(() => createClient(), []);

  return useQuery<{
    definitions: KpiDefinitionRecord[];
    periods: KpiPeriodRecord[];
    scores: KpiScoreRecord[];
    reviews: KpiReviewRecord[];
    employees: KpiEmployeeOption[];
    departments: KpiDepartmentOption[];
  }>({
    queryKey: ["kpi-workspace"],
    enabled,
    queryFn: async () => {
      const [defsRes, periodsRes, scoresRes, reviewsRes, employeesRes, deptsRes] =
        await Promise.all([
          supabase
            .from("kpi_definitions")
            .select(
              "id, organization_id, name, description, source_metric, target_value, direction, weight, applies_to_role, applies_to_department_id, is_active, created_by, created_at, updated_at"
            )
            .order("name", { ascending: true }),
          supabase
            .from("kpi_periods")
            .select(
              "id, organization_id, name, period_type, start_date, end_date, status, closed_at, closed_by, created_by, created_at"
            )
            .order("start_date", { ascending: false }),
          supabase
            .from("kpi_scores")
            .select(
              "id, organization_id, period_id, employee_id, kpi_definition_id, actual_value, target_value, score, computed_at"
            )
            .order("computed_at", { ascending: false }),
          supabase
            .from("kpi_reviews")
            .select(
              "id, organization_id, period_id, employee_id, reviewer_id, rating, comment, created_at, updated_at"
            )
            .order("updated_at", { ascending: false }),
          supabase
            .from("employees")
            .select("id, full_name, email, manager_id, department_id, status")
            .eq("status", "active")
            .order("full_name", { ascending: true }),
          supabase
            .from("departments")
            .select("id, name, code")
            .order("name", { ascending: true }),
        ]);

      if (defsRes.error) throw defsRes.error;
      if (periodsRes.error) throw periodsRes.error;
      if (scoresRes.error) throw scoresRes.error;
      if (reviewsRes.error) throw reviewsRes.error;

      return {
        definitions: (defsRes.data || []).map((d: any) => ({
          ...d,
          target_value: Number(d.target_value),
          weight: Number(d.weight),
        })) as KpiDefinitionRecord[],
        periods: (periodsRes.data || []) as KpiPeriodRecord[],
        scores: (scoresRes.data || []).map((s: any) => ({
          ...s,
          actual_value: s.actual_value === null || s.actual_value === undefined ? null : Number(s.actual_value),
          target_value: Number(s.target_value),
          score: s.score === null || s.score === undefined ? null : Number(s.score),
        })) as KpiScoreRecord[],
        reviews: (reviewsRes.data || []).map((r: any) => ({
          ...r,
          rating: Number(r.rating),
        })) as KpiReviewRecord[],
        employees: (employeesRes.data || []) as KpiEmployeeOption[],
        departments: (deptsRes.data || []) as KpiDepartmentOption[],
      };
    },
  });
}

export function useKpiMutations() {
  const supabase = React.useMemo(() => createClient(), []);
  const queryClient = useQueryClient();

  const invalidateAll = () => {
    queryClient.invalidateQueries({ queryKey: ["kpi-workspace"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const rpcCall = async (fn: string, args: Record<string, unknown>) => {
    const clientWithRpc = supabase as unknown as {
      rpc: (
        name: string,
        params: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const { data, error } = await clientWithRpc.rpc(fn, args);
    if (error) {
      throw new Error(error.message || `RPC ${fn} failed`);
    }
    return data;
  };

  const upsertDefinition = useMutation({
    mutationFn: async (input: {
      definitionId?: string | null;
      name: string;
      description?: string | null;
      sourceMetric: KpiSourceMetric;
      targetValue: number;
      direction: KpiDirection;
      weight: number;
      appliesToRole?: "employee" | "manager" | "hr" | "admin" | null;
      appliesToDepartmentId?: string | null;
      isActive?: boolean;
    }) => {
      return rpcCall("upsert_kpi_definition", {
        p_name: input.name,
        p_source_metric: input.sourceMetric,
        p_target_value: input.targetValue,
        p_direction: input.direction,
        p_weight: input.weight,
        p_description: input.description || null,
        p_applies_to_role: input.appliesToRole || null,
        p_applies_to_department_id: input.appliesToDepartmentId || null,
        p_is_active: input.isActive ?? true,
        p_definition_id: input.definitionId || null,
      });
    },
    onSuccess: (_, vars) => {
      toast.success(vars.definitionId ? "KPI definition updated" : "KPI definition created");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to save KPI definition");
    },
  });

  const deleteDefinition = useMutation({
    mutationFn: async (definitionId: string) => {
      return rpcCall("delete_kpi_definition", {
        p_definition_id: definitionId,
      });
    },
    onSuccess: () => {
      toast.success("KPI definition deleted");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to delete KPI definition");
    },
  });

  const createPeriod = useMutation({
    mutationFn: async (input: {
      name: string;
      periodType: KpiPeriodType;
      startDate: string;
      endDate: string;
    }) => {
      return rpcCall("create_kpi_period", {
        p_name: input.name,
        p_period_type: input.periodType,
        p_start_date: input.startDate,
        p_end_date: input.endDate,
      });
    },
    onSuccess: (res: any) => {
      if (res?.period) {
        queryClient.setQueryData(["kpi-workspace"], (old: any) => {
          if (!old || !Array.isArray(old.periods)) return old;
          const exists = old.periods.some((p: any) => p.id === res.period.id);
          return exists ? old : { ...old, periods: [res.period, ...old.periods] };
        });
      }
      toast.success("KPI period created");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to create KPI period");
    },
  });

  const computeScores = useMutation({
    mutationFn: async (periodId: string) => {
      return rpcCall("compute_kpi_scores", {
        p_period_id: periodId,
      });
    },
    onSuccess: (res: any) => {
      const count = res?.scores_written ?? 0;
      toast.success(`KPI scores computed (${count} snapshots written)`);
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to compute KPI scores");
    },
  });

  const closePeriod = useMutation({
    mutationFn: async (periodId: string) => {
      return rpcCall("close_kpi_period", {
        p_period_id: periodId,
      });
    },
    onSuccess: () => {
      toast.success("KPI period closed and locked");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to close KPI period");
    },
  });

  const submitReview = useMutation({
    mutationFn: async (input: {
      periodId: string;
      employeeId: string;
      rating: number;
      comment: string;
    }) => {
      return rpcCall("submit_kpi_review", {
        p_period_id: input.periodId,
        p_employee_id: input.employeeId,
        p_rating: input.rating,
        p_comment: input.comment,
      });
    },
    onSuccess: () => {
      toast.success("KPI review saved and employee notified");
      invalidateAll();
    },
    onError: (err: Error) => {
      toast.error(err.message || "Failed to submit KPI review");
    },
  });

  return {
    upsertDefinition,
    deleteDefinition,
    createPeriod,
    computeScores,
    closePeriod,
    submitReview,
  };
}

