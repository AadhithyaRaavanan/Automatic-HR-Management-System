"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { FEATURES } from "@/lib/features";
import { KPI_CONFIG } from "@/lib/kpi/config";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  TrendingUp,
  TrendingDown,
  Calendar,
  Download,
  Filter,
  CheckCircle2,
  Clock,
  AlertTriangle,
  Award,
  Edit3,
  Plus,
  X,
  Target,
  MessageSquare,
  HelpCircle,
  BarChart3,
  Layers,
  ArrowRight,
  UserCheck,
} from "lucide-react";

type PeriodPreset = "week" | "month" | "quarter" | "custom";
type KpiTab = "metrics" | "reviews" | "goals";

function getPresetDates(preset: PeriodPreset): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const now = new Date();

  if (preset === "week") {
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    return { from: weekAgo.toISOString().slice(0, 10), to: today };
  }
  if (preset === "quarter") {
    const quarterAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
    return { from: quarterAgo.toISOString().slice(0, 10), to: today };
  }
  // month (default)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    .toISOString()
    .slice(0, 10);
  return { from: startOfMonth, to: today };
}

function KpiContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { userId, userRole } = useAppSession();

  // Redirect if feature is disabled
  React.useEffect(() => {
    if (!FEATURES.KPI) {
      router.replace("/dashboard");
    }
  }, [router]);

  const targetFromParam = searchParams.get("employee_id");
  const [activeTab, setActiveTab] = React.useState<KpiTab>("metrics");
  const [preset, setPreset] = React.useState<PeriodPreset>("month");
  const [dateRange, setDateRange] = React.useState(() => getPresetDates("month"));
  const [selectedEmpId, setSelectedEmpId] = React.useState<string>("");
  const [empType, setEmpType] = React.useState<string>("full_time");
  const [deptFilter, setDeptFilter] = React.useState<string>("");

  // Modals state
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [adjustMetricKey, setAdjustMetricKey] = React.useState<string | null>(null);
  const [adjustValue, setAdjustValue] = React.useState<string>("");
  const [adjustReason, setAdjustReason] = React.useState<string>("");
  const [createReviewOpen, setCreateReviewOpen] = React.useState(false);
  const [createGoalOpen, setCreateGoalOpen] = React.useState(false);

  // Review form state
  const [reviewPeriodType, setReviewPeriodType] = React.useState<"monthly" | "quarterly">("monthly");
  const [reviewNote, setReviewNote] = React.useState("");
  const [reviewRatings, setReviewRatings] = React.useState({
    quality: 4,
    communication: 4,
    initiative: 4,
    teamwork: 4,
  });

  // Goal form state
  const [goalTitle, setGoalTitle] = React.useState("");
  const [goalNote, setGoalNote] = React.useState("");

  // Default target employee to searchParam or current user
  React.useEffect(() => {
    if (targetFromParam) {
      setSelectedEmpId(targetFromParam);
    } else if (userId && !selectedEmpId) {
      setSelectedEmpId(userId);
    }
  }, [targetFromParam, userId, selectedEmpId]);

  const effectiveEmpId = selectedEmpId || userId || "";

  // 1. Fetch Main KPI Data
  const { data: kpiData, isLoading: kpiLoading, refetch: refetchKpi } = useQuery({
    queryKey: ["kpi-dashboard", effectiveEmpId, dateRange.from, dateRange.to, empType, deptFilter],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const params = new URLSearchParams({
        employee_id: effectiveEmpId,
        from: dateRange.from,
        to: dateRange.to,
        employee_type: empType,
      });
      if (deptFilter) params.append("department", deptFilter);

      const res = await fetch(`/api/kpi?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 403) toast.error("Access denied to target employee KPI");
        return null;
      }
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && FEATURES.KPI),
  });

  // 2. Fetch Reviews Data
  const { data: reviewsData, isLoading: reviewsLoading, refetch: refetchReviews } = useQuery({
    queryKey: ["kpi-reviews", effectiveEmpId],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const res = await fetch(`/api/kpi/reviews?employee_id=${encodeURIComponent(effectiveEmpId)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && activeTab === "reviews" && FEATURES.KPI),
  });

  // 3. Fetch Goals Data
  const { data: goalsData, isLoading: goalsLoading, refetch: refetchGoals } = useQuery({
    queryKey: ["kpi-goals", effectiveEmpId],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const res = await fetch(`/api/kpi/goals?employee_id=${encodeURIComponent(effectiveEmpId)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && activeTab === "goals" && FEATURES.KPI),
  });

  // Mutations
  const submitAdjustment = useMutation({
    mutationFn: async () => {
      if (!adjustMetricKey || !adjustValue || adjustReason.trim().length < 5) {
        throw new Error("Override value and a reason of at least 5 characters are required");
      }
      const res = await fetch("/api/kpi/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: effectiveEmpId,
          metric: adjustMetricKey,
          period_start: dateRange.from,
          period_end: dateRange.to,
          override_value: Number(adjustValue),
          reason: adjustReason.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit adjustment");
      return data;
    },
    onSuccess: () => {
      toast.success("Metric adjusted and recorded");
      setAdjustMetricKey(null);
      setAdjustValue("");
      setAdjustReason("");
      refetchKpi();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const submitReview = useMutation({
    mutationFn: async () => {
      if (reviewNote.trim().length < 5) {
        throw new Error("Review note must be at least 5 characters");
      }
      const res = await fetch("/api/kpi/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: effectiveEmpId,
          period_type: reviewPeriodType,
          period_start: dateRange.from,
          period_end: dateRange.to,
          ratings: reviewRatings,
          note: reviewNote.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit review");
      return data;
    },
    onSuccess: () => {
      toast.success("Review submitted successfully");
      setCreateReviewOpen(false);
      setReviewNote("");
      refetchReviews();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const submitGoal = useMutation({
    mutationFn: async () => {
      if (!goalTitle.trim()) throw new Error("Goal title is required");
      const res = await fetch("/api/kpi/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: effectiveEmpId,
          period_start: dateRange.from,
          period_end: dateRange.to,
          title: goalTitle.trim(),
          note: goalNote.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create goal");
      return data;
    },
    onSuccess: () => {
      toast.success("Goal added");
      setCreateGoalOpen(false);
      setGoalTitle("");
      setGoalNote("");
      refetchGoals();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const updateGoalStatus = useMutation({
    mutationFn: async ({ id, status, note }: { id: string; status?: string; note?: string }) => {
      const res = await fetch("/api/kpi/goals", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update goal");
      return data;
    },
    onSuccess: () => {
      toast.success("Goal updated");
      refetchGoals();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  const handleExportCsv = () => {
    if (!effectiveEmpId) return;
    const params = new URLSearchParams({
      employee_id: effectiveEmpId,
      from: dateRange.from,
      to: dateRange.to,
      employee_type: empType,
    });
    window.location.href = `/api/kpi/export?${params.toString()}`;
  };

  const isManagerOrAdmin = userRole === "manager" || userRole === "hr" || userRole === "admin";
  const currentMetrics = kpiData?.current?.metrics;
  const overallScore = kpiData?.current?.overallScore;
  const trend = kpiData?.trend?.overallScore;
  const teamAverage = kpiData?.teamAverage;
  const scopedEmployees = kpiData?.scopedEmployees || [];

  if (!FEATURES.KPI) {
    return null;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-text-primary flex items-center gap-2.5">
            <BarChart3 className="w-6 h-6 text-brand-purple" />
            Performance & KPI Analytics
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Data-grounded performance metrics, manager reviews, and goal tracking.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={kpiLoading || !kpiData}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-card border border-border-light text-xs font-bold text-text-primary hover:bg-card-subtle transition-colors shadow-xs cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-brand-purple" />
            Export CSV
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-border-light pb-2">
        <button
          type="button"
          onClick={() => setActiveTab("metrics")}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2",
            activeTab === "metrics"
              ? "bg-brand-purple text-white shadow-xs"
              : "text-text-secondary hover:text-text-primary hover:bg-card-subtle"
          )}
        >
          <BarChart3 className="w-4 h-4" />
          Metrics & Score
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("reviews")}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2",
            activeTab === "reviews"
              ? "bg-brand-purple text-white shadow-xs"
              : "text-text-secondary hover:text-text-primary hover:bg-card-subtle"
          )}
        >
          <MessageSquare className="w-4 h-4" />
          Manager Reviews ({reviewsData?.reviews?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("goals")}
          className={cn(
            "px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2",
            activeTab === "goals"
              ? "bg-brand-purple text-white shadow-xs"
              : "text-text-secondary hover:text-text-primary hover:bg-card-subtle"
          )}
        >
          <Target className="w-4 h-4" />
          Goals ({goalsData?.goals?.length || 0})
        </button>
      </div>

      {/* Filter Bar */}
      <div className="p-4 rounded-2xl bg-card border border-border-light shadow-card space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Person selector for managers/HR/admin */}
            {isManagerOrAdmin && scopedEmployees.length > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] font-bold uppercase text-text-tertiary">Employee:</span>
                <select
                  aria-label="Select Employee"
                  value={effectiveEmpId}
                  onChange={(e) => setSelectedEmpId(e.target.value)}
                  className="px-3 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                >
                  {scopedEmployees.map((emp: any) => (
                    <option key={emp.id} value={emp.id}>
                      {emp.full_name || emp.email} {emp.id === userId ? "(You)" : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Employee Type filter */}
            <div className="flex items-center gap-1.5">
              <span className="text-[11px] font-bold uppercase text-text-tertiary">Type:</span>
              <select
                aria-label="Employee Type"
                value={empType}
                onChange={(e) => setEmpType(e.target.value)}
                className="px-3 py-1.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
              >
                <option value="full_time">Full-Time (8h)</option>
                <option value="part_time">Part-Time (4h)</option>
                <option value="intern">Intern (6h)</option>
                <option value="contract">Contract (8h)</option>
              </select>
            </div>
          </div>

          {/* Date Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(["week", "month", "quarter", "custom"] as PeriodPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => {
                  setPreset(p);
                  if (p !== "custom") setDateRange(getPresetDates(p));
                }}
                className={cn(
                  "px-3 py-1 rounded-xl text-xs font-bold transition-colors cursor-pointer",
                  preset === p
                    ? "bg-brand-navy text-white"
                    : "bg-card-subtle text-text-secondary hover:text-text-primary"
                )}
              >
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </button>
            ))}
          </div>
        </div>

        {/* Custom date range inputs */}
        {preset === "custom" && (
          <div className="flex items-center gap-2 pt-2 border-t border-border-light text-xs">
            <span className="font-bold text-text-secondary">Range:</span>
            <input
              type="date"
              value={dateRange.from}
              onChange={(e) => setDateRange((prev) => ({ ...prev, from: e.target.value }))}
              className="px-2.5 py-1 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary"
            />
            <span className="text-text-tertiary">to</span>
            <input
              type="date"
              value={dateRange.to}
              onChange={(e) => setDateRange((prev) => ({ ...prev, to: e.target.value }))}
              className="px-2.5 py-1 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary"
            />
          </div>
        )}
      </div>

      {/* TAB 1: METRICS & SCORE */}
      {activeTab === "metrics" && (
        <div className="space-y-6">
          {/* Overall Performance Card */}
          <div className="p-6 rounded-[28px] bg-gradient-to-br from-card to-card-subtle border border-border-light shadow-card flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs font-extrabold uppercase tracking-wider text-text-tertiary">
                  Overall Performance Index
                </span>
                <button
                  type="button"
                  onClick={() => setBreakdownOpen(true)}
                  className="text-brand-purple hover:underline text-xs font-bold flex items-center gap-1 cursor-pointer"
                >
                  <HelpCircle className="w-3.5 h-3.5" />
                  View Weight Breakdown
                </button>
              </div>

              <div className="flex items-baseline gap-3">
                <span className="text-4xl font-black text-text-primary">
                  {overallScore != null ? `${overallScore}%` : "No data"}
                </span>

                {trend != null && (
                  <span
                    className={cn(
                      "inline-flex items-center gap-0.5 text-xs font-bold px-2 py-0.5 rounded-full",
                      trend > 0
                        ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                        : trend < 0
                        ? "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
                        : "bg-card-subtle text-text-secondary"
                    )}
                  >
                    {trend > 0 ? <TrendingUp className="w-3 h-3" /> : trend < 0 ? <TrendingDown className="w-3 h-3" /> : null}
                    {trend > 0 ? `+${trend}%` : `${trend}%`} vs previous period
                  </span>
                )}
              </div>

              <p className="text-xs text-text-tertiary">
                Target: 90%+ • Computed across Attendance, Hours, and Task delivery
              </p>
            </div>

            {/* Team Average comparison (for managers/HR/admin only) */}
            {teamAverage && teamAverage.overallScore != null && (
              <div className="p-4 rounded-2xl bg-card border border-border-light text-xs space-y-1">
                <span className="text-[11px] font-bold uppercase text-text-tertiary">Team Benchmark</span>
                <div className="text-lg font-black text-text-primary">
                  {teamAverage.overallScore}% average
                </div>
                <div className="text-[11px] text-text-secondary">
                  On-Time: {teamAverage.onTimeRate ?? "—"}% • Tasks: {teamAverage.completionRate ?? "—"}%
                </div>
              </div>
            )}
          </div>

          {/* Metric Cards Grid */}
          {currentMetrics ? (
            <div className="space-y-6">
              {/* Category: Attendance */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-text-secondary mb-3 flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-brand-purple" />
                  Attendance & Reliability
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    currentMetrics.on_time_check_in_rate,
                    currentMetrics.days_worked_vs_expected,
                    currentMetrics.early_check_outs,
                    currentMetrics.auto_closed_check_outs,
                    currentMetrics.regularization_requests,
                  ].map((m) => (
                    <MetricCard
                      key={m.key}
                      metric={m}
                      isManagerOrAdmin={isManagerOrAdmin}
                      onAdjust={() => {
                        setAdjustMetricKey(m.key);
                        setAdjustValue(m.value != null ? String(m.value) : "");
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Category: Hours */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-text-secondary mb-3 flex items-center gap-1.5">
                  <Calendar className="w-4 h-4 text-brand-purple" />
                  Hours & Shift Completion
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[currentMetrics.worked_hours_vs_target].map((m) => (
                    <MetricCard
                      key={m.key}
                      metric={m}
                      isManagerOrAdmin={isManagerOrAdmin}
                      onAdjust={() => {
                        setAdjustMetricKey(m.key);
                        setAdjustValue(m.value != null ? String(m.value) : "");
                      }}
                    />
                  ))}
                </div>
              </div>

              {/* Category: Tasks */}
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-text-secondary mb-3 flex items-center gap-1.5">
                  <CheckCircle2 className="w-4 h-4 text-brand-purple" />
                  Task Execution & Delivery
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {[
                    currentMetrics.tasks_completed_vs_assigned,
                    currentMetrics.task_on_time_rate,
                    currentMetrics.task_average_cycle_time,
                    currentMetrics.task_overdue_count,
                  ].map((m) => (
                    <MetricCard
                      key={m.key}
                      metric={m}
                      isManagerOrAdmin={isManagerOrAdmin}
                      onAdjust={() => {
                        setAdjustMetricKey(m.key);
                        setAdjustValue(m.value != null ? String(m.value) : "");
                      }}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-text-tertiary">
              {kpiLoading ? "Calculating live performance metrics..." : "No performance records found for this period."}
            </div>
          )}
        </div>
      )}

      {/* TAB 2: REVIEWS */}
      {activeTab === "reviews" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-text-primary">Performance Reviews</h2>
              <p className="text-xs text-text-secondary">Manager reviews with qualitative feedback and notes.</p>
            </div>
            {isManagerOrAdmin && effectiveEmpId !== userId && (
              <button
                type="button"
                onClick={() => setCreateReviewOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Review
              </button>
            )}
          </div>

          <div className="space-y-3">
            {(reviewsData?.reviews || []).length > 0 ? (
              reviewsData!.reviews.map((rev: any) => (
                <div
                  key={rev.id}
                  className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-3"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-xs font-extrabold text-text-primary">
                        {rev.reviewer_name}
                      </span>
                      <span className="text-[11px] text-text-tertiary ml-2">
                        {rev.period_type.toUpperCase()} • {rev.period_start} to {rev.period_end}
                      </span>
                    </div>
                    <span className="text-[11px] font-mono text-text-tertiary">
                      {new Date(rev.created_at).toLocaleDateString()}
                    </span>
                  </div>

                  {/* Ratings grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-border-light/60">
                    {Object.entries(rev.ratings || {}).map(([key, val]) => (
                      <div key={key} className="p-2 rounded-xl bg-card-subtle text-xs">
                        <span className="text-[10px] font-bold uppercase text-text-tertiary block capitalize">
                          {key}
                        </span>
                        <span className="text-xs font-black text-brand-purple">
                          {"★".repeat(Number(val) || 0)}
                          {"☆".repeat(5 - (Number(val) || 0))}
                          <span className="ml-1 text-[11px] text-text-secondary">({Number(val)}/5)</span>
                        </span>
                      </div>
                    ))}
                  </div>

                  {/* Review Note */}
                  <div className="p-3 rounded-xl bg-card-subtle/70 border border-border-light text-xs text-text-primary leading-relaxed whitespace-pre-wrap">
                    <strong className="text-text-secondary block text-[10px] uppercase font-bold mb-0.5">Feedback Note:</strong>
                    {rev.note}
                  </div>
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-text-tertiary rounded-2xl border border-dashed border-border-light">
                {reviewsLoading ? "Loading reviews..." : "No performance reviews recorded yet."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: GOALS */}
      {activeTab === "goals" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-text-primary">Performance Goals</h2>
              <p className="text-xs text-text-secondary">Strategic milestones and personal targets for this cycle.</p>
            </div>
            {isManagerOrAdmin && (
              <button
                type="button"
                onClick={() => setCreateGoalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-colors cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                Add Goal
              </button>
            )}
          </div>

          <div className="space-y-3">
            {(goalsData?.goals || []).length > 0 ? (
              goalsData!.goals.map((g: any) => (
                <div
                  key={g.id}
                  className="p-4 rounded-2xl bg-card border border-border-light shadow-card space-y-2.5"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div className="space-y-0.5">
                      <h4 className="text-xs font-bold text-text-primary">{g.title}</h4>
                      <p className="text-[11px] text-text-tertiary">
                        Target Period: {g.period_start} to {g.period_end}
                      </p>
                    </div>

                    {/* Status updater */}
                    <div className="flex items-center gap-2">
                      <select
                        aria-label="Goal status"
                        value={g.status}
                        onChange={(e) => updateGoalStatus.mutate({ id: g.id, status: e.target.value })}
                        className="px-2.5 py-1 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary cursor-pointer"
                      >
                        <option value="not_started">Not Started</option>
                        <option value="on_track">On Track</option>
                        <option value="at_risk">At Risk</option>
                        <option value="done">Done</option>
                      </select>
                    </div>
                  </div>

                  {g.note && (
                    <p className="text-xs text-text-secondary bg-card-subtle p-2.5 rounded-xl border border-border-light">
                      {g.note}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <div className="py-12 text-center text-xs text-text-tertiary rounded-2xl border border-dashed border-border-light">
                {goalsLoading ? "Loading goals..." : "No performance goals assigned for this period."}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: Score Breakdown */}
      {breakdownOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setBreakdownOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-card rounded-[28px] border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 className="text-sm font-extrabold text-text-primary flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-brand-purple" />
                Overall Score Weight Breakdown
              </h3>
              <button
                type="button"
                onClick={() => setBreakdownOpen(false)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-secondary leading-relaxed">
              The overall performance score is a weighted index across available operational data. Metrics with no recorded activity are marked <strong>No data</strong> and excluded from penalizing the score.
            </p>

            <div className="space-y-2">
              {[
                { label: "On-Time Check-In Rate", weight: "20%", key: "on_time_check_in_rate" },
                { label: "Days Worked vs Expected", weight: "20%", key: "days_worked_vs_expected" },
                { label: "Worked Hours vs Target", weight: "25%", key: "worked_hours_vs_target" },
                { label: "Tasks Completed vs Assigned", weight: "20%", key: "tasks_completed_vs_assigned" },
                { label: "Task On-Time Delivery Rate", weight: "15%", key: "task_on_time_rate" },
              ].map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between p-3 rounded-xl bg-card-subtle text-xs"
                >
                  <span className="font-semibold text-text-primary">{item.label}</span>
                  <span className="font-mono font-bold text-brand-purple">{item.weight}</span>
                </div>
              ))}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => setBreakdownOpen(false)}
                className="w-full py-2 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Adjust Metric */}
      {adjustMetricKey && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAdjustMetricKey(null);
          }}
        >
          <div className="w-full max-w-md bg-card rounded-[28px] border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 className="text-sm font-extrabold text-text-primary flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-brand-purple" />
                Adjust Metric Override
              </h3>
              <button
                type="button"
                onClick={() => setAdjustMetricKey(null)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-secondary">
              Metric: <strong className="text-text-primary">{adjustMetricKey}</strong>. All adjustments are logged and displayed with your justification.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitAdjustment.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Override Value
                </label>
                <input
                  type="number"
                  step="any"
                  required
                  value={adjustValue}
                  onChange={(e) => setAdjustValue(e.target.value)}
                  placeholder="e.g., 95"
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Justification Reason * (Min 5 chars)
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Explain why this metric is being adjusted (e.g. system clock drift, verified client emergency)..."
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustMetricKey(null)}
                  className="px-4 py-2 rounded-full bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitAdjustment.isPending}
                  className="px-5 py-2 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  Save Adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Create Review */}
      {createReviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateReviewOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-card rounded-[28px] border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 className="text-sm font-extrabold text-text-primary flex items-center gap-2">
                <MessageSquare className="w-4 h-4 text-brand-purple" />
                Write Manager Review
              </h3>
              <button
                type="button"
                onClick={() => setCreateReviewOpen(false)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitReview.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Review Period Type
                </label>
                <select
                  value={reviewPeriodType}
                  onChange={(e) => setReviewPeriodType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                >
                  <option value="monthly">Monthly Cycle</option>
                  <option value="quarterly">Quarterly Cycle</option>
                </select>
              </div>

              {/* Ratings */}
              <div className="grid grid-cols-2 gap-3">
                {(["quality", "communication", "initiative", "teamwork"] as const).map((key) => (
                  <div key={key}>
                    <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1 capitalize">
                      {key} (1-5)
                    </label>
                    <select
                      value={reviewRatings[key]}
                      onChange={(e) =>
                        setReviewRatings((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                      }
                      className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                    >
                      {[1, 2, 3, 4, 5].map((num) => (
                        <option key={num} value={num}>
                          {num} - {num === 5 ? "Exceptional" : num === 4 ? "Exceeds" : num === 3 ? "Meets" : num === 2 ? "Developing" : "Needs Attention"}
                        </option>
                      ))}
                    </select>
                  </div>
                ))}
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Manager Feedback & Note * (Min 5 chars)
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Provide qualitative feedback on performance, achievements, and improvement areas..."
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateReviewOpen(false)}
                  className="px-4 py-2 rounded-full bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitReview.isPending}
                  className="px-5 py-2 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  Submit Review
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Create Goal */}
      {createGoalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setCreateGoalOpen(false);
          }}
        >
          <div className="w-full max-w-md bg-card rounded-[28px] border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 className="text-sm font-extrabold text-text-primary flex items-center gap-2">
                <Target className="w-4 h-4 text-brand-purple" />
                Assign Performance Goal
              </h3>
              <button
                type="button"
                onClick={() => setCreateGoalOpen(false)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitGoal.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Goal Title *
                </label>
                <input
                  required
                  value={goalTitle}
                  onChange={(e) => setGoalTitle(e.target.value)}
                  placeholder="e.g., Complete AWS Security certification"
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold uppercase text-text-secondary mb-1">
                  Target Criteria & Note
                </label>
                <textarea
                  rows={2}
                  value={goalNote}
                  onChange={(e) => setGoalNote(e.target.value)}
                  placeholder="Acceptance conditions or milestones..."
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setCreateGoalOpen(false)}
                  className="px-4 py-2 rounded-full bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitGoal.isPending}
                  className="px-5 py-2 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  Set Goal
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  metric,
  isManagerOrAdmin,
  onAdjust,
}: {
  metric: any;
  isManagerOrAdmin: boolean;
  onAdjust: () => void;
}) {
  const isNoData = metric.value == null || metric.status === "no_data";

  return (
    <div className="p-4 rounded-2xl bg-card border border-border-light shadow-card space-y-2 flex flex-col justify-between">
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-bold text-text-primary truncate">{metric.label}</span>
          <span
            className={cn(
              "px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase shrink-0",
              isNoData
                ? "bg-card-subtle text-text-tertiary"
                : metric.status === "on_track"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : metric.status === "at_risk"
                ? "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400"
                : "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-400"
            )}
          >
            {isNoData ? "No data" : metric.status.replace("_", " ")}
          </span>
        </div>

        <div className="flex items-baseline justify-between pt-1">
          <span className="text-xl font-black text-text-primary">
            {metric.displayValue}
          </span>
          {metric.target != null && (
            <span className="text-[11px] font-mono text-text-tertiary">
              Target: {metric.target}{metric.unit ? " " + metric.unit : ""}
            </span>
          )}
        </div>

        {/* Adjusted indicator */}
        {metric.adjusted && (
          <div className="p-2 rounded-xl bg-brand-purple/10 border border-brand-purple/20 text-[10px] text-brand-purple font-medium">
            <span className="font-bold">Adjusted:</span> {metric.adjustmentReason}
          </div>
        )}
      </div>

      {/* Adjust Button for Manager/HR/Admin */}
      {isManagerOrAdmin && (
        <div className="pt-2 border-t border-border-light/60 flex justify-end">
          <button
            type="button"
            onClick={onAdjust}
            className="text-[11px] font-bold text-brand-purple hover:underline flex items-center gap-1 cursor-pointer"
          >
            <Edit3 className="w-3 h-3" />
            Adjust
          </button>
        </div>
      )}
    </div>
  );
}

export default function KpiPage() {
  return (
    <AppShell>
      <KpiContent />
    </AppShell>
  );
}
