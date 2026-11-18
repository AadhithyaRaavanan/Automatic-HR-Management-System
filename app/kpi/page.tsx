"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { PageHeader } from "@/components/shared/page-header";
import { EmptyState } from "@/components/shared/empty-state";
import { StatusBadge } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/shared/skeleton";
import { FEATURES } from "@/lib/features";
import { KPI_CONFIG } from "@/lib/kpi/config";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  BarChart3,
  Download,
  Plus,
  X,
  Target,
  MessageSquare,
  Clock,
  Calendar,
  CheckCircle2,
  Edit3,
} from "lucide-react";

import { KpiToolbar, KpiTab, PeriodPreset } from "@/features/kpi/components/kpi-toolbar";
import { KpiHeroCard } from "@/features/kpi/components/kpi-hero-card";
import { KpiHighlightTiles } from "@/features/kpi/components/kpi-highlight-tiles";
import {
  KpiCategorySection,
  MetricItemData,
} from "@/features/kpi/components/kpi-category-section";
import { KpiCalculationFooter } from "@/features/kpi/components/kpi-calculation-footer";

// Helper: Compute initial date range for presets
function getPresetDates(preset: PeriodPreset, baseDate = new Date()): { from: string; to: string } {
  const todayIso = new Date().toISOString().slice(0, 10);
  const year = baseDate.getFullYear();
  const month = baseDate.getMonth();

  if (preset === "week") {
    const end = new Date(baseDate.getTime());
    const start = new Date(baseDate.getTime() - 6 * 24 * 60 * 60 * 1000);
    return {
      from: start.toISOString().slice(0, 10),
      to: end.toISOString().slice(0, 10),
    };
  }

  if (preset === "quarter") {
    const qIndex = Math.floor(month / 3);
    const qStart = new Date(year, qIndex * 3, 1).toISOString().slice(0, 10);
    const qEnd = new Date(year, (qIndex + 1) * 3, 0).toISOString().slice(0, 10);
    return { from: qStart, to: qEnd > todayIso ? todayIso : qEnd };
  }

  // month (default)
  const startOfMonth = new Date(year, month, 1).toISOString().slice(0, 10);
  const endOfMonth = new Date(year, month + 1, 0).toISOString().slice(0, 10);
  return { from: startOfMonth, to: endOfMonth > todayIso ? todayIso : endOfMonth };
}

// Helper: Format period label
function formatPeriodLabel(preset: PeriodPreset, from: string, to: string): string {
  if (preset === "month") {
    const d = new Date(`${from}T00:00:00Z`);
    return d.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  }

  if (preset === "week") {
    const d1 = new Date(`${from}T00:00:00Z`);
    const d2 = new Date(`${to}T00:00:00Z`);
    const d1Str = d1.toLocaleDateString("en-US", { day: "numeric", month: "short", timeZone: "UTC" });
    const d2Str = d2.toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    return `${d1Str} – ${d2Str}`;
  }

  if (preset === "quarter") {
    const d = new Date(`${from}T00:00:00Z`);
    const q = Math.floor(d.getUTCMonth() / 3) + 1;
    return `Q${q} ${d.getUTCFullYear()}`;
  }

  // Custom
  return `${from} to ${to}`;
}

function KpiContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId, userRole } = useAppSession();

  // Redirect if feature flag is off
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
  const [adjustMetric, setAdjustMetric] = React.useState<MetricItemData | null>(null);
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

  // Default target employee to param or current user
  React.useEffect(() => {
    if (targetFromParam) {
      setSelectedEmpId(targetFromParam);
    } else if (userId && !selectedEmpId) {
      setSelectedEmpId(userId);
    }
  }, [targetFromParam, userId, selectedEmpId]);

  const effectiveEmpId = selectedEmpId || userId || "";
  const isManagerOrAdmin = userRole === "manager" || userRole === "hr" || userRole === "admin";

  // 1. Fetch Main KPI Data
  const {
    data: kpiData,
    isLoading: kpiLoading,
    refetch: refetchKpi,
  } = useQuery({
    queryKey: [
      "kpi-dashboard",
      effectiveEmpId,
      dateRange.from,
      dateRange.to,
      empType,
      deptFilter,
    ],
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

  // Delayed skeleton loading flag (>300ms)
  const [showSkeleton, setShowSkeleton] = React.useState(false);
  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    if (kpiLoading) {
      timer = setTimeout(() => setShowSkeleton(true), 300);
    } else {
      setShowSkeleton(false);
    }
    return () => clearTimeout(timer);
  }, [kpiLoading]);

  // Sync employment category from data
  React.useEffect(() => {
    if (kpiData?.employee?.employment_category) {
      setEmpType(kpiData.employee.employment_category);
    }
  }, [kpiData?.employee?.employment_category]);

  // 2. Fetch Reviews Data
  const {
    data: reviewsData,
    isLoading: reviewsLoading,
    refetch: refetchReviews,
  } = useQuery({
    queryKey: ["kpi-reviews", effectiveEmpId],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const res = await fetch(
        `/api/kpi/reviews?employee_id=${encodeURIComponent(effectiveEmpId)}`
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && activeTab === "reviews" && FEATURES.KPI),
  });

  // 3. Fetch Goals Data
  const {
    data: goalsData,
    isLoading: goalsLoading,
    refetch: refetchGoals,
  } = useQuery({
    queryKey: ["kpi-goals", effectiveEmpId],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const res = await fetch(
        `/api/kpi/goals?employee_id=${encodeURIComponent(effectiveEmpId)}`
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && activeTab === "goals" && FEATURES.KPI),
  });

  // Period shifting handlers
  const handlePrevPeriod = () => {
    const curFrom = new Date(`${dateRange.from}T00:00:00Z`);

    if (preset === "month") {
      curFrom.setUTCMonth(curFrom.getUTCMonth() - 1);
      const y = curFrom.getUTCFullYear();
      const m = curFrom.getUTCMonth();
      const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
      setDateRange({ from: start, to: end });
    } else if (preset === "week") {
      const start = new Date(curFrom.getTime() - 7 * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      setDateRange({
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
      });
    } else if (preset === "quarter") {
      curFrom.setUTCMonth(curFrom.getUTCMonth() - 3);
      const y = curFrom.getUTCFullYear();
      const q = Math.floor(curFrom.getUTCMonth() / 3);
      const start = new Date(Date.UTC(y, q * 3, 1)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(y, (q + 1) * 3, 0)).toISOString().slice(0, 10);
      setDateRange({ from: start, to: end });
    }
  };

  const handleNextPeriod = () => {
    const curFrom = new Date(`${dateRange.from}T00:00:00Z`);
    const todayIso = new Date().toISOString().slice(0, 10);

    if (preset === "month") {
      curFrom.setUTCMonth(curFrom.getUTCMonth() + 1);
      const y = curFrom.getUTCFullYear();
      const m = curFrom.getUTCMonth();
      const start = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(y, m + 1, 0)).toISOString().slice(0, 10);
      setDateRange({ from: start, to: end > todayIso ? todayIso : end });
    } else if (preset === "week") {
      const start = new Date(curFrom.getTime() + 7 * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      const endIso = end.toISOString().slice(0, 10);
      setDateRange({
        from: start.toISOString().slice(0, 10),
        to: endIso > todayIso ? todayIso : endIso,
      });
    } else if (preset === "quarter") {
      curFrom.setUTCMonth(curFrom.getUTCMonth() + 3);
      const y = curFrom.getUTCFullYear();
      const q = Math.floor(curFrom.getUTCMonth() / 3);
      const start = new Date(Date.UTC(y, q * 3, 1)).toISOString().slice(0, 10);
      const end = new Date(Date.UTC(y, (q + 1) * 3, 0)).toISOString().slice(0, 10);
      setDateRange({ from: start, to: end > todayIso ? todayIso : end });
    }
  };

  // Preset selector
  const handlePresetChange = (newPreset: PeriodPreset) => {
    setPreset(newPreset);
    if (newPreset !== "custom") {
      setDateRange(getPresetDates(newPreset));
    }
  };

  // Adjustment Mutation
  const submitAdjustment = useMutation({
    mutationFn: async () => {
      if (!adjustMetric || !adjustValue || adjustReason.trim().length < 5) {
        throw new Error("Override value and a reason of at least 5 characters are required");
      }
      const res = await fetch("/api/kpi/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: effectiveEmpId,
          metric: adjustMetric.key,
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
      setAdjustMetric(null);
      setAdjustValue("");
      setAdjustReason("");
      refetchKpi();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  // Review Mutation
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

  // Goal Mutation
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
      toast.success("Goal status updated");
      refetchGoals();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  // Export CSV
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

  const currentMetrics = kpiData?.current?.metrics;
  const previousMetrics = kpiData?.previous?.metrics;
  const overallScore = kpiData?.current?.overallScore;
  const trend = kpiData?.trend?.overallScore;
  const scopedEmployees = kpiData?.scopedEmployees || [];

  const periodLabel = formatPeriodLabel(preset, dateRange.from, dateRange.to);

  if (!FEATURES.KPI) {
    return null;
  }

  // Goals progress summary
  const goalsList = goalsData?.goals || [];
  const notStartedGoals = goalsList.filter((g: any) => g.status === "not_started").length;
  const onTrackGoals = goalsList.filter((g: any) => g.status === "on_track").length;
  const atRiskGoals = goalsList.filter((g: any) => g.status === "at_risk").length;
  const doneGoals = goalsList.filter((g: any) => g.status === "done").length;

  return (
    <div className="w-full space-y-6 pb-24">
      {/* 1. Page Header matching Tasks and Attendance */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight flex items-center gap-2.5">
            <BarChart3 className="w-7 h-7 text-brand-purple" />
            <span>Performance &amp; KPI Analytics</span>
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Data-grounded performance metrics, manager reviews, and goal tracking.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={kpiLoading || !kpiData}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border-light text-xs font-bold text-text-primary hover:bg-card-subtle transition-colors shadow-xs cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-brand-purple" />
            <span>Export CSV</span>
          </button>
        </div>
      </section>

      {/* 2. Unified Sticky Toolbar spanning full width */}
      <KpiToolbar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        reviewCount={reviewsData?.reviews?.length || 0}
        goalCount={goalsData?.goals?.length || 0}
        periodLabel={periodLabel}
        preset={preset}
        onPresetChange={handlePresetChange}
        onPrevPeriod={handlePrevPeriod}
        onNextPeriod={handleNextPeriod}
        customRange={dateRange}
        onCustomRangeChange={setDateRange}
        isManagerOrAdmin={isManagerOrAdmin}
        scopedEmployees={scopedEmployees}
        selectedEmpId={effectiveEmpId}
        onSelectEmployee={setSelectedEmpId}
        currentUserId={userId}
        empType={empType}
        onEmpTypeChange={setEmpType}
        deptFilter={deptFilter}
        onDeptFilterChange={setDeptFilter}
      />

      {/* 3. TAB CONTENT */}
      {showSkeleton ? (
        /* Delayed skeleton loader for instant layout stability */
        <div className="space-y-6 pt-2">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <Skeleton className="lg:col-span-5 h-56 rounded-[24px]" />
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
              <Skeleton className="h-56 rounded-[22px]" />
              <Skeleton className="h-56 rounded-[22px]" />
              <Skeleton className="h-56 rounded-[22px]" />
            </div>
          </div>
          <div className="space-y-3 pt-3">
            <Skeleton className="h-6 w-48 rounded-lg" />
            <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-36 rounded-2xl" />
              ))}
            </div>
          </div>
        </div>
      ) : activeTab === "metrics" ? (
        /* TAB 1: METRICS & SCORE */
        <div className="space-y-7">
          {/* Hero Row: Two Columns (40% Left + 60% Right) */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            {/* Left: Overall Performance Index Card (~40%) */}
            <div className="lg:col-span-5 flex flex-col">
              <KpiHeroCard
                overallScore={overallScore}
                trend={trend}
                target={90}
                currentMetrics={currentMetrics}
                onOpenBreakdown={() => setBreakdownOpen(true)}
                className="h-full"
              />
            </div>

            {/* Right: Three Highlight Tiles (~60%) */}
            <div className="lg:col-span-7 flex flex-col">
              <KpiHighlightTiles
                currentMetrics={currentMetrics}
                previousMetrics={previousMetrics}
              />
            </div>
          </div>

          {/* Metric Sections */}
          {currentMetrics && (
            <div data-tour="kpi-metrics-grid" className="space-y-7">
              {/* Category 1: Attendance & Reliability */}
              <KpiCategorySection
                title="Attendance & Reliability"
                description="Punctuality, shift attendance frequency, early departures, and correction volume."
                icon={<Clock className="w-4 h-4 text-brand-purple" />}
                categoryHint="Punctuality targets: 95% on-time punches and 100% expected workdays."
                metrics={[
                  currentMetrics.on_time_check_in_rate,
                  currentMetrics.days_worked_vs_expected,
                  currentMetrics.early_check_outs,
                  currentMetrics.auto_closed_check_outs,
                  currentMetrics.regularization_requests,
                ]}
                previousMetricsMap={previousMetrics}
                isManagerOrAdmin={isManagerOrAdmin}
                onAdjustMetric={(m) => {
                  setAdjustMetric(m);
                  setAdjustValue(m.value != null ? String(m.value) : "");
                }}
              />

              {/* Category 2: Hours & Shift Completion */}
              <KpiCategorySection
                title="Hours & Shift Completion"
                description="Total productive work hours vs shift target expectations."
                icon={<Calendar className="w-4 h-4 text-brand-purple" />}
                categoryHint="Standard daily target is 8h per full working shift."
                metrics={[currentMetrics.worked_hours_vs_target]}
                previousMetricsMap={previousMetrics}
                isManagerOrAdmin={isManagerOrAdmin}
                onAdjustMetric={(m) => {
                  setAdjustMetric(m);
                  setAdjustValue(m.value != null ? String(m.value) : "");
                }}
              />

              {/* Category 3: Task Delivery & Execution */}
              <KpiCategorySection
                title="Task Delivery & Execution"
                description="Sprint deliverables, sprint completion rate, on-time delivery, and cycle time."
                icon={<CheckCircle2 className="w-4 h-4 text-brand-purple" />}
                categoryHint="Sprint deliverables: 90% completion and 90% on-time delivery."
                metrics={[
                  currentMetrics.tasks_completed_vs_assigned,
                  currentMetrics.task_on_time_rate,
                  currentMetrics.task_average_cycle_time,
                  currentMetrics.task_overdue_count,
                ]}
                previousMetricsMap={previousMetrics}
                isManagerOrAdmin={isManagerOrAdmin}
                onAdjustMetric={(m) => {
                  setAdjustMetric(m);
                  setAdjustValue(m.value != null ? String(m.value) : "");
                }}
              />
            </div>
          )}

          {/* Collapsible Explanatory Footer */}
          <KpiCalculationFooter employeeType={empType} />
        </div>
      ) : activeTab === "reviews" ? (
        /* TAB 2: MANAGER REVIEWS */
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-1">
            <div>
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                Manager Performance Reviews
              </h2>
              <p className="text-xs text-text-secondary font-medium">
                Structured evaluations covering quality, communication, initiative, and teamwork.
              </p>
            </div>

            {isManagerOrAdmin && effectiveEmpId !== userId && (
              <button
                type="button"
                data-tour="kpi-add-review"
                onClick={() => setCreateReviewOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Write Review</span>
              </button>
            )}
          </div>

          <div className="space-y-3.5">
            {(reviewsData?.reviews || []).length > 0 ? (
              reviewsData!.reviews.map((rev: any) => {
                const reviewerInitials = (rev.reviewer_name || "Manager")
                  .trim()
                  .split(/\s+/)
                  .map((w: string) => w[0])
                  .join("")
                  .slice(0, 2)
                  .toUpperCase();

                return (
                  <div
                    key={rev.id}
                    className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-4"
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-full bg-brand-purple/10 text-brand-purple font-bold text-xs flex items-center justify-center shrink-0">
                          {reviewerInitials}
                        </div>
                        <div>
                          <span className="text-xs font-extrabold text-text-primary block">
                            {rev.reviewer_name}
                          </span>
                          <span className="text-[11px] text-text-tertiary">
                            {rev.period_type.toUpperCase()} CYCLE • {rev.period_start} to {rev.period_end}
                          </span>
                        </div>
                      </div>

                      <span className="text-[11px] font-mono text-text-tertiary">
                        {new Date(rev.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Compact Rating Bars */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-border-light/60">
                      {Object.entries(rev.ratings || {}).map(([key, val]) => {
                        const score = Number(val) || 0;
                        const pct = Math.min(100, (score / 5) * 100);
                        return (
                          <div key={key} className="p-3 rounded-xl bg-card-subtle space-y-1.5">
                            <div className="flex items-center justify-between text-[11px]">
                              <span className="font-bold text-text-secondary capitalize">
                                {key}
                              </span>
                              <span className="font-mono font-black text-brand-purple">
                                {score}/5
                              </span>
                            </div>
                            <div className="h-1.5 w-full bg-card rounded-full overflow-hidden">
                              <div
                                style={{ width: `${pct}%` }}
                                className="h-full bg-brand-purple rounded-full"
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Qualitative Note */}
                    <div className="p-3.5 rounded-xl bg-card-subtle/80 border border-border-light text-xs text-text-primary leading-relaxed whitespace-pre-wrap">
                      <strong className="text-text-secondary block text-[10px] uppercase font-extrabold mb-1">
                        Supervisor Feedback:
                      </strong>
                      {rev.note}
                    </div>
                  </div>
                );
              })
            ) : (
              <EmptyState
                className="py-12 border-dashed shadow-none"
                icon={<MessageSquare className="w-6 h-6" />}
                title="No reviews recorded yet"
                description={
                  isManagerOrAdmin && effectiveEmpId !== userId
                    ? "Conduct a formal performance evaluation on quality, communication, initiative, and teamwork."
                    : "Your manager hasn't written a review yet for this period."
                }
                action={
                  isManagerOrAdmin && effectiveEmpId !== userId ? (
                    <button
                      type="button"
                      onClick={() => setCreateReviewOpen(true)}
                      className="px-4 py-2 rounded-xl bg-brand-purple text-white text-xs font-bold cursor-pointer"
                    >
                      Write a Review
                    </button>
                  ) : null
                }
              />
            )}
          </div>
        </div>
      ) : (
        /* TAB 3: GOALS */
        <div className="space-y-4">
          <div className="flex items-center justify-between pb-1">
            <div>
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                Performance Goals & Strategic Milestones
              </h2>
              <p className="text-xs text-text-secondary font-medium">
                Track deliverable milestones and professional objectives for this cycle.
              </p>
            </div>

            {isManagerOrAdmin && (
              <button
                type="button"
                onClick={() => setCreateGoalOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Goal</span>
              </button>
            )}
          </div>

          {/* Goals Progress Summary Strip */}
          {goalsList.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-xl bg-card border border-border-light shadow-xs flex items-center justify-between">
                <span className="text-xs font-bold text-text-secondary">Not Started</span>
                <span className="text-base font-black text-text-tertiary tabular-nums">
                  {notStartedGoals}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-border-light shadow-xs flex items-center justify-between">
                <span className="text-xs font-bold text-text-secondary">On Track</span>
                <span className="text-base font-black text-emerald-600 tabular-nums">
                  {onTrackGoals}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-border-light shadow-xs flex items-center justify-between">
                <span className="text-xs font-bold text-text-secondary">At Risk</span>
                <span className="text-base font-black text-rose-600 tabular-nums">
                  {atRiskGoals}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-card border border-border-light shadow-xs flex items-center justify-between">
                <span className="text-xs font-bold text-text-secondary">Done</span>
                <span className="text-base font-black text-brand-purple tabular-nums">
                  {doneGoals}
                </span>
              </div>
            </div>
          )}

          {/* Goal Cards List */}
          <div className="space-y-3">
            {goalsList.length > 0 ? (
              goalsList.map((g: any) => (
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

                    <div className="flex items-center gap-2">
                      <StatusBadge status={g.status} />

                      {/* Status selector for manager/admin or employee owner */}
                      <select
                        aria-label="Update Goal Status"
                        value={g.status}
                        onChange={(e) =>
                          updateGoalStatus.mutate({ id: g.id, status: e.target.value })
                        }
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
                    <p className="text-xs text-text-secondary bg-card-subtle p-2.5 rounded-xl border border-border-light leading-relaxed">
                      {g.note}
                    </p>
                  )}
                </div>
              ))
            ) : (
              <EmptyState
                className="py-12 border-dashed shadow-none"
                icon={<Target className="w-6 h-6" />}
                title="No goals assigned yet"
                description="Define key milestones, strategic deliverables, or personal targets for this evaluation period."
                action={
                  isManagerOrAdmin ? (
                    <button
                      type="button"
                      onClick={() => setCreateGoalOpen(true)}
                      className="px-4 py-2 rounded-xl bg-brand-purple text-white text-xs font-bold cursor-pointer"
                    >
                      Set a Goal
                    </button>
                  ) : null
                }
              />
            )}
          </div>
        </div>
      )}

      {/* MODAL: Score Weight Breakdown */}
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
                <span>Overall Score Weight Breakdown</span>
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
              The overall performance score is a weighted index across operational data. Metrics with no recorded activity are marked <strong>No data</strong> and excluded from penalizing your score.
            </p>

            <div className="space-y-2">
              {[
                { label: "On-Time Check-In Rate", weight: `${Math.round(KPI_CONFIG.weights.on_time_check_in_rate * 100)}%`, key: "on_time_check_in_rate" },
                { label: "Days Worked vs Expected", weight: `${Math.round(KPI_CONFIG.weights.days_worked_vs_expected * 100)}%`, key: "days_worked_vs_expected" },
                { label: "Worked Hours vs Target", weight: `${Math.round(KPI_CONFIG.weights.worked_hours_vs_target * 100)}%`, key: "worked_hours_vs_target" },
                { label: "Tasks Completed vs Assigned", weight: `${Math.round(KPI_CONFIG.weights.tasks_completed_vs_assigned * 100)}%`, key: "tasks_completed_vs_assigned" },
                { label: "Task On-Time Delivery Rate", weight: `${Math.round(KPI_CONFIG.weights.task_on_time_rate * 100)}%`, key: "task_on_time_rate" },
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
                className="w-full py-2.5 rounded-full bg-brand-purple text-white text-xs font-bold cursor-pointer hover:bg-brand-purple-hover transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Adjust Metric Override */}
      {adjustMetric && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAdjustMetric(null);
          }}
        >
          <div className="w-full max-w-md bg-card rounded-[28px] border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 className="text-sm font-extrabold text-text-primary flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-brand-purple" />
                <span>Adjust Metric Override</span>
              </h3>
              <button
                type="button"
                onClick={() => setAdjustMetric(null)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-secondary">
              Metric: <strong className="text-text-primary">{adjustMetric.label}</strong>. All adjustments are logged and displayed with your justification.
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
                  placeholder="Explain why this metric is being adjusted (e.g. verified technical emergency, clock drift)..."
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustMetric(null)}
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
                <span>Write Manager Review</span>
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
                <span>Assign Performance Goal</span>
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

export default function KpiPage() {
  return (
    <AppShell>
      <KpiContent />
    </AppShell>
  );
}
