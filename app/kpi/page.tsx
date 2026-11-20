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
import { KpiLatestReviewCard } from "@/features/kpi/components/kpi-latest-review-card";
import { KpiGoalsSummaryCard } from "@/features/kpi/components/kpi-goals-summary-card";
import { KpiDetailDrawer } from "@/features/kpi/components/kpi-detail-drawer";
import { KpiTeamOverview } from "@/features/kpi/components/kpi-team-overview";
import {
  KpiCategorySection,
  MetricItemData,
} from "@/features/kpi/components/kpi-category-section";
import { KpiCalculationFooter } from "@/features/kpi/components/kpi-calculation-footer";
import {
  getKolkataPresetDates,
  formatKpiPeriodLabel,
  getKolkataToday,
  pad2,
} from "@/lib/kpi/date-helper";

function KpiContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { userId, userRole, isLoaded: sessionLoaded } = useAppSession();

  // Redirect if feature flag is off
  React.useEffect(() => {
    if (!FEATURES.KPI) {
      router.replace("/dashboard");
    }
  }, [router]);

  const targetFromParam = searchParams.get("employee_id");
  const [activeTab, setActiveTab] = React.useState<KpiTab>("metrics");
  const [preset, setPreset] = React.useState<PeriodPreset>("month");
  const [dateRange, setDateRange] = React.useState(() => getKolkataPresetDates("month"));
  const [selectedEmpId, setSelectedEmpId] = React.useState<string>("");
  const [empType, setEmpType] = React.useState<string>("full_time");
  const [deptFilter, setDeptFilter] = React.useState<string>("");
  const [departmentsList, setDepartmentsList] = React.useState<Array<{ id: string; name: string }>>([]);

  // Modals state
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [adjustMetric, setAdjustMetric] = React.useState<MetricItemData | null>(null);
  const [adjustValue, setAdjustValue] = React.useState<string>("");
  const [adjustReason, setAdjustReason] = React.useState<string>("");
  const [createReviewOpen, setCreateReviewOpen] = React.useState(false);
  const [createGoalOpen, setCreateGoalOpen] = React.useState(false);

  // Detail Drawer state (Phase 3)
  const [detailDrawerOpen, setDetailDrawerOpen] = React.useState(false);
  const [selectedMetricKey, setSelectedMetricKey] = React.useState<string | null>(null);
  const [selectedMetricLabel, setSelectedMetricLabel] = React.useState<string | null>(null);

  // Self-Review state (Phase 5)
  const [selfReviewOpen, setSelfReviewOpen] = React.useState(false);
  const [selfReviewReflection, setSelfReviewReflection] = React.useState("");

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

  // Fetch departments for team/department filtering
  React.useEffect(() => {
    if (isManagerOrAdmin) {
      fetch("/api/admin/departments")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (data?.departments && Array.isArray(data.departments)) {
            setDepartmentsList(
              data.departments.map((d: any) => ({ id: d.id, name: d.name }))
            );
          }
        })
        .catch(() => {});
    }
  }, [isManagerOrAdmin]);

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

  // 1b. Fetch Historical Trend Data (for 6-period category sparklines)
  const { data: historyData } = useQuery({
    queryKey: ["kpi-history", effectiveEmpId, preset],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const res = await fetch(
        `/api/kpi/history?employee_id=${encodeURIComponent(effectiveEmpId)}&period_type=${preset}&periods=6`
      );
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && FEATURES.KPI),
  });

  // Delayed skeleton loading flag (>300ms) until profile, role, and first data response arrive
  const isInitialLoading = !sessionLoaded || kpiLoading || !kpiData;
  const [showSkeleton, setShowSkeleton] = React.useState(false);
  React.useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isInitialLoading) {
      timer = setTimeout(() => setShowSkeleton(true), 300);
    } else {
      setShowSkeleton(false);
    }
    return () => clearTimeout(timer);
  }, [isInitialLoading]);

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

  // 4. Fetch Self-Review Data (Phase 5)
  const {
    data: selfReviewData,
    refetch: refetchSelfReview,
  } = useQuery({
    queryKey: ["kpi-self-review", effectiveEmpId, dateRange.from, dateRange.to],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const params = new URLSearchParams({
        employee_id: effectiveEmpId,
        period_start: dateRange.from,
        period_end: dateRange.to,
        period_type: preset === "quarter" ? "quarterly" : "monthly",
      });
      const res = await fetch(`/api/kpi/self-reviews?${params.toString()}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && activeTab === "reviews" && FEATURES.KPI),
  });

  // Period shifting handlers using exact Asia/Kolkata dates
  const handlePrevPeriod = () => {
    const [y, m, d] = dateRange.from.split("-").map(Number);
    if (preset === "month") {
      let prevM = m - 1;
      let prevY = y;
      if (prevM < 1) {
        prevM = 12;
        prevY -= 1;
      }
      setDateRange(getKolkataPresetDates("month", prevY, prevM));
    } else if (preset === "week") {
      const anchor = new Date(Date.UTC(y, m - 1, d) - 7 * 24 * 60 * 60 * 1000);
      const start = new Date(anchor.getTime() - 6 * 24 * 60 * 60 * 1000);
      const from = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
      const to = `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}-${pad2(anchor.getUTCDate())}`;
      setDateRange({ from, to });
    } else if (preset === "quarter") {
      const q = Math.floor((m - 1) / 3);
      let prevQ = q - 1;
      let prevY = y;
      if (prevQ < 0) {
        prevQ = 3;
        prevY -= 1;
      }
      const prevM = prevQ * 3 + 1;
      setDateRange(getKolkataPresetDates("quarter", prevY, prevM));
    }
  };

  const handleNextPeriod = () => {
    const [y, m, d] = dateRange.from.split("-").map(Number);
    if (preset === "month") {
      let nextM = m + 1;
      let nextY = y;
      if (nextM > 12) {
        nextM = 1;
        nextY += 1;
      }
      setDateRange(getKolkataPresetDates("month", nextY, nextM));
    } else if (preset === "week") {
      const anchor = new Date(Date.UTC(y, m - 1, d) + 7 * 24 * 60 * 60 * 1000);
      const start = new Date(anchor.getTime() - 6 * 24 * 60 * 60 * 1000);
      const from = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
      const to = `${anchor.getUTCFullYear()}-${pad2(anchor.getUTCMonth() + 1)}-${pad2(anchor.getUTCDate())}`;
      setDateRange({ from, to });
    } else if (preset === "quarter") {
      const q = Math.floor((m - 1) / 3);
      let nextQ = q + 1;
      let nextY = y;
      if (nextQ > 3) {
        nextQ = 0;
        nextY += 1;
      }
      const nextM = nextQ * 3 + 1;
      setDateRange(getKolkataPresetDates("quarter", nextY, nextM));
    }
  };

  // Preset selector
  const handlePresetChange = (newPreset: PeriodPreset) => {
    setPreset(newPreset);
    if (newPreset !== "custom") {
      setDateRange(getKolkataPresetDates(newPreset));
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

  // Self-Review Mutation (Phase 5)
  const submitSelfReview = useMutation({
    mutationFn: async () => {
      if (selfReviewReflection.trim().length < 20) {
        throw new Error("Self-review reflection must be at least 20 characters");
      }
      const res = await fetch("/api/kpi/self-reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          period_start: dateRange.from,
          period_end: dateRange.to,
          period_type: preset === "quarter" ? "quarterly" : "monthly",
          reflection: selfReviewReflection.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to submit self-review");
      return data;
    },
    onSuccess: () => {
      toast.success("Self-review submitted successfully");
      setSelfReviewOpen(false);
      setSelfReviewReflection("");
      refetchSelfReview();
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

  const periodLabel = formatKpiPeriodLabel(preset, dateRange.from, dateRange.to);

  if (!FEATURES.KPI) {
    return null;
  }

  // Goals progress summary
  const goalsList = goalsData?.goals || [];
  const notStartedGoals = goalsList.filter((g: any) => g.status === "not_started").length;
  const onTrackGoals = goalsList.filter((g: any) => g.status === "on_track").length;
  const atRiskGoals = goalsList.filter((g: any) => g.status === "at_risk").length;
  const doneGoals = goalsList.filter((g: any) => g.status === "done").length;

  // Delayed skeleton (after 300ms) for the whole /kpi page until profile, role and first data response arrive
  if (isInitialLoading) {
    if (!showSkeleton) {
      return <div className="w-full min-h-[400px]" />;
    }
    return (
      <div className="w-full space-y-6 pb-24">
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
          <div className="space-y-2">
            <div className="h-8 w-44 bg-card border border-border-light rounded-xl animate-pulse" />
            <div className="h-4 w-72 bg-card border border-border-light rounded-lg animate-pulse" />
          </div>
          <div className="h-9 w-28 bg-card border border-border-light rounded-full animate-pulse" />
        </section>
        <div className="h-14 w-full bg-card border border-border-light rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-5 h-64 bg-card border border-border-light rounded-[20px] animate-pulse" />
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="h-64 bg-card border border-border-light rounded-[18px] animate-pulse" />
            <div className="h-64 bg-card border border-border-light rounded-[18px] animate-pulse" />
          </div>
        </div>
        <div className="h-56 w-full bg-card border border-border-light rounded-2xl animate-pulse" />
      </div>
    );
  }

  return (
    <div className="w-full space-y-6 pb-24">
      {/* 1. Page Header: Plain Performance title and factual subtitle */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
            Performance
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Attendance, hours and task results for the selected period.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            disabled={kpiLoading || !kpiData}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-card border border-border-light text-xs font-bold text-text-primary hover:bg-card-subtle transition-colors shadow-xs cursor-pointer disabled:opacity-50"
          >
            <Download className="w-4 h-4 text-black" />
            <span>Export CSV</span>
          </button>
        </div>
      </section>

      {/* 2. Unified Sticky Toolbar spanning full width */}
      <div data-tour="kpi-filters">
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
        departments={departmentsList}
      />
      </div>

      {/* 3. TAB CONTENT */}
      {showSkeleton ? (
        /* Delayed skeleton loader for instant layout stability */
        <div className="space-y-6 pt-2">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
            <Skeleton className="lg:col-span-5 h-56 rounded-[24px]" />
            <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-3.5">
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
            <div data-tour="kpi-overview" className="lg:col-span-5 flex flex-col">
              <KpiHeroCard
                overallScore={overallScore}
                trend={trend}
                target={KPI_CONFIG.overallTarget || 90}
                currentMetrics={currentMetrics}
                previousMetrics={previousMetrics}
                customWeights={kpiData?.current?.weights}
                categoryHistory={historyData?.history || []}
                onOpenBreakdown={() => setBreakdownOpen(true)}
                isSelfView={effectiveEmpId === userId}
                userRole={userRole}
                previousPeriodLabel={preset === "month" ? "last month" : "previous period"}
                className="h-full"
              />
            </div>

            {/* Right: Latest Review & Goals Summary Cards (~60%) */}
            <div className="lg:col-span-7 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
              <KpiLatestReviewCard
                latestReview={reviewsData?.reviews?.[0] || null}
              />
              <KpiGoalsSummaryCard
                goals={goalsList}
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
                isSelfView={effectiveEmpId === userId}
                onSelectMetric={(key, label) => {
                  setSelectedMetricKey(key);
                  setSelectedMetricLabel(label);
                  setDetailDrawerOpen(true);
                }}
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
                isSelfView={effectiveEmpId === userId}
                onSelectMetric={(key, label) => {
                  setSelectedMetricKey(key);
                  setSelectedMetricLabel(label);
                  setDetailDrawerOpen(true);
                }}
                onAdjustMetric={(m) => {
                  setAdjustMetric(m);
                  setAdjustValue(m.value != null ? String(m.value) : "");
                }}
              />

              {/* Category 3: Task Delivery & Execution */}
              <KpiCategorySection
                title="Task Delivery & Execution"
                description="Tasks completed, on-time delivery and cycle time."
                icon={<CheckCircle2 className="w-4 h-4 text-brand-purple" />}
                categoryHint=""
                metrics={[
                  currentMetrics.tasks_completed_vs_assigned,
                  currentMetrics.task_on_time_rate,
                  currentMetrics.task_average_cycle_time,
                  currentMetrics.task_overdue_count,
                ]}
                previousMetricsMap={previousMetrics}
                isManagerOrAdmin={isManagerOrAdmin}
                isSelfView={effectiveEmpId === userId}
                onSelectMetric={(key, label) => {
                  setSelectedMetricKey(key);
                  setSelectedMetricLabel(label);
                  setDetailDrawerOpen(true);
                }}
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
      ) : activeTab === "team" && isManagerOrAdmin ? (
        /* TAB: TEAM OVERVIEW (Phase 4) */
        <div data-tour="kpi-team-tab" className="space-y-4">
          <KpiTeamOverview
            from={dateRange.from}
            to={dateRange.to}
            departmentFilter={deptFilter}
            employeeTypeFilter={empType}
            onSelectEmployee={(empId) => {
              setSelectedEmpId(empId);
              setActiveTab("metrics");
            }}
          />
        </div>
      ) : activeTab === "reviews" ? (
        /* TAB 2: MANAGER REVIEWS */
        <div data-tour="kpi-reviews-tab" className="space-y-4">
          <div className="flex items-center justify-between pb-1">
            <div>
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                Manager Performance Reviews
              </h2>
              <p className="text-xs text-text-secondary font-medium">
                Structured evaluations covering quality, communication, initiative, and teamwork.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Employee Self-Review Button */}
              {effectiveEmpId === userId && (
                <button
                  type="button"
                  data-tour="kpi-self-review"
                  onClick={() => {
                    setSelfReviewReflection(selfReviewData?.selfReview?.reflection || "");
                    setSelfReviewOpen(true);
                  }}
                  disabled={selfReviewData?.hasManagerReview}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50"
                >
                  <Edit3 className="w-4 h-4" />
                  <span>
                    {selfReviewData?.selfReview
                      ? selfReviewData.canEdit
                        ? "Edit Self-Review"
                        : "Self-Review (Locked)"
                      : "Write Self-Review"}
                  </span>
                </button>
              )}

              {/* Manager Write Review Button */}
              {isManagerOrAdmin && effectiveEmpId !== userId && (
                <button
                  type="button"
                  data-tour="kpi-add-review"
                  onClick={() => setCreateReviewOpen(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  <Plus className="w-4 h-4" />
                  <span>Write Review</span>
                </button>
              )}
            </div>
          </div>

          {/* Self-Review Reflection Banner / Card (Phase 5) */}
          {selfReviewData?.selfReview && (
            <div className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-[#B7FF00]" aria-hidden="true" />
                  <h3 className="text-xs font-extrabold text-text-primary uppercase tracking-wider">
                    {effectiveEmpId === userId ? "Your Self-Review Reflection" : "Employee Self-Review Reflection"}
                  </h3>
                </div>
                <div className="flex items-center gap-2 text-[11px] text-text-tertiary">
                  <span>Submitted: {new Date(selfReviewData.selfReview.created_at).toLocaleDateString()}</span>
                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold",
                    selfReviewData.hasManagerReview
                      ? "bg-gray-100 text-gray-700"
                      : "bg-[#B7FF00]/20 text-black"
                  )}>
                    {selfReviewData.hasManagerReview ? "Locked (Evaluated)" : "Editable"}
                  </span>
                </div>
              </div>
              <p className="text-xs text-text-primary leading-relaxed bg-card-subtle p-3.5 rounded-xl border border-border-light whitespace-pre-wrap">
                {selfReviewData.selfReview.reflection}
              </p>
            </div>
          )}

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
        <div data-tour="kpi-goals-tab" className="space-y-4">
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
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add goal</span>
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
                <span className="text-base font-black text-black tabular-nums">
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

                  {/* Linked tasks progress information (Phase 5) */}
                  {g.linked_tasks_total != null && g.linked_tasks_total > 0 && (
                    <div className="pt-1 text-[11px] font-semibold text-text-secondary flex items-center gap-1.5">
                      <CheckCircle2 className="w-3.5 h-3.5 text-black" />
                      <span>
                        {g.linked_tasks_done} of {g.linked_tasks_total} linked tasks completed
                      </span>
                    </div>
                  )}

                  {/* Gentle completion prompt when all linked tasks are done (Phase 5) */}
                  {g.linked_tasks_total > 0 &&
                    g.linked_tasks_done === g.linked_tasks_total &&
                    g.status !== "done" && (
                      <div className="p-3 rounded-xl bg-card-subtle border border-border-light flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 mt-2">
                        <span className="text-xs font-semibold text-text-primary">
                          All linked tasks are done. Mark this goal as done?
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            updateGoalStatus.mutate({ id: g.id, status: "done" })
                          }
                          className="px-3.5 py-1.5 rounded-lg bg-black text-white text-xs font-bold hover:bg-[#1A1A1A] cursor-pointer whitespace-nowrap shadow-xs"
                        >
                          Mark as Done
                        </button>
                      </div>
                    )}
                </div>
              ))
            ) : (
              <EmptyState
                className="py-12 border-dashed shadow-none"
                icon={<Target className="w-6 h-6" />}
                title="No goals for this period."
                description="Key milestones, strategic deliverables, or personal targets for this evaluation period will appear here."
                action={null}
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
              <h3 className="text-sm font-extrabold text-text-primary">
                Overall score weight breakdown
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
              <h3 className="text-sm font-extrabold text-text-primary">
                Adjust metric override
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
                <label className="block text-xs font-semibold text-text-secondary mb-1">
                  Override value
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
                <label className="block text-xs font-semibold text-text-secondary mb-1">
                  Justification reason
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
                <div className="flex justify-between items-center text-[11px] text-text-tertiary mt-1">
                  <span>Minimum 5 characters</span>
                  <span className={cn(adjustReason.trim().length >= 5 ? "text-text-primary font-semibold" : "text-rose-600 font-medium")}>
                    {adjustReason.trim().length} / 5 characters
                  </span>
                </div>
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
                  className="px-5 py-2 rounded-full bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
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
              <h3 className="text-sm font-extrabold text-text-primary">
                Write manager review
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
                <label className="block text-xs font-semibold text-text-secondary mb-1">
                  Review period type
                </label>
                <select
                  value={reviewPeriodType}
                  onChange={(e) => setReviewPeriodType(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                >
                  <option value="monthly">Monthly cycle</option>
                  <option value="quarterly">Quarterly cycle</option>
                </select>
              </div>

              {/* Ratings */}
              <div className="grid grid-cols-2 gap-3">
                {(["quality", "communication", "initiative", "teamwork"] as const).map((key) => (
                  <div key={key}>
                    <label className="block text-xs font-semibold text-text-secondary mb-1 capitalize">
                      {key} (1–5)
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
                <label className="block text-xs font-semibold text-text-secondary mb-1">
                  Manager feedback and note
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
                <div className="flex justify-between items-center text-[11px] text-text-tertiary mt-1">
                  <span>Minimum 5 characters</span>
                  <span className={cn(reviewNote.trim().length >= 5 ? "text-text-primary font-semibold" : "text-rose-600 font-medium")}>
                    {reviewNote.trim().length} / 5 characters
                  </span>
                </div>
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
                  className="px-5 py-2 rounded-full bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
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
              <h3 className="text-sm font-extrabold text-text-primary">
                {effectiveEmpId === userId ? "Add goal" : "Assign performance goal"}
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
                <label className="block text-[11px] font-bold text-text-secondary mb-1">
                  Goal title *
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
                <label className="block text-[11px] font-bold text-text-secondary mb-1">
                  Target criteria and note
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
                  className="px-5 py-2 rounded-full bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {effectiveEmpId === userId ? "Add goal" : "Set goal"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Write Self-Review (Phase 5) */}
      {selfReviewOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSelfReviewOpen(false);
          }}
        >
          <div className="w-full max-w-lg bg-card rounded-[28px] border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 className="text-sm font-extrabold text-text-primary">
                Write self-review reflection
              </h3>
              <button
                type="button"
                onClick={() => setSelfReviewOpen(false)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-secondary leading-relaxed">
              Reflect on your achievements, operational contributions, and challenges during this period. Your reflection will be visible to your supervisor during evaluations.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitSelfReview.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <label className="block text-[11px] font-bold text-text-secondary mb-1">
                  Evaluation reflection *
                </label>
                <textarea
                  rows={4}
                  required
                  minLength={20}
                  value={selfReviewReflection}
                  onChange={(e) => setSelfReviewReflection(e.target.value)}
                  placeholder="Summarize your accomplishments, milestones reached, and areas you focused on during this cycle..."
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
                <div className="flex justify-between items-center text-[11px] text-text-tertiary mt-1">
                  <span>Minimum 20 characters</span>
                  <span className={cn(selfReviewReflection.trim().length >= 20 ? "text-text-primary font-semibold" : "text-rose-600 font-medium")}>
                    {selfReviewReflection.trim().length} / 20 characters
                  </span>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setSelfReviewOpen(false)}
                  className="px-4 py-2 rounded-full bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitSelfReview.isPending || selfReviewReflection.trim().length < 20}
                  className="px-5 py-2 rounded-full bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  {submitSelfReview.isPending ? "Saving..." : "Submit self-review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Metric Calculation Drilldown Drawer (Phase 3) */}
      <KpiDetailDrawer
        isOpen={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        employeeId={effectiveEmpId}
        metricKey={selectedMetricKey}
        metricLabel={selectedMetricLabel}
        from={dateRange.from}
        to={dateRange.to}
        isSelfView={effectiveEmpId === userId}
      />
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
