"use client";

import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery, useMutation } from "@tanstack/react-query";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { Skeleton } from "@/components/shared/skeleton";
import { EmptyState } from "@/components/shared/empty-state";
import { FEATURES } from "@/lib/features";
import { KPI_CONFIG } from "@/features/kpi/config";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Download,
  Plus,
  X,
  Target,
  ArrowLeft,
  Edit3,
  AlertTriangle,
  RefreshCw,
  ArrowRight,
  MessageSquare,
} from "lucide-react";

import { KpiToolbar, KpiTab, PeriodPreset } from "@/features/kpi/components/kpi-toolbar";
import { KpiHeroCard } from "@/features/kpi/components/kpi-hero-card";
import { KpiCategorySection, MetricItemData } from "@/features/kpi/components/kpi-category-section";
import { KpiNextActionsCard } from "@/features/kpi/components/kpi-next-actions-card";
import { KpiAttendanceCalendar } from "@/features/kpi/components/kpi-attendance-calendar";
import { KpiCompactSummaryLines } from "@/features/kpi/components/kpi-compact-summary-lines";
import { KpiDetailDrawer } from "@/features/kpi/components/kpi-detail-drawer";
import { KpiTeamOverview } from "@/features/kpi/components/kpi-team-overview";
import { KpiCalculationFooter } from "@/features/kpi/components/kpi-calculation-footer";
import { getNextActionSuggestions } from "@/features/kpi/plain-language";
import {
  getKolkataPresetDates,
  formatKpiPeriodLabel,
  formatKpiStepperLabel,
} from "@/features/kpi/date-helper";

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
  const [activeTab, setActiveTab] = React.useState<KpiTab>("overview");
  const [preset, setPreset] = React.useState<PeriodPreset>("month");
  const [dateRange, setDateRange] = React.useState(() => getKolkataPresetDates("month"));
  const [selectedEmpId, setSelectedEmpId] = React.useState<string>("");
  const [cameFromTeam, setCameFromTeam] = React.useState(false);
  const [empType, setEmpType] = React.useState<string>("full_time");
  const [teamEmpTypeFilter, setTeamEmpTypeFilter] = React.useState<string>("all");
  const [deptFilter, setDeptFilter] = React.useState<string>("all");
  const [departmentsList, setDepartmentsList] = React.useState<Array<{ id: string; name: string }>>([]);

  // Track last synced URL param so returning from ?employee_id= works without fighting state
  const lastParamRef = React.useRef<string | null>(null);
  const modalOpenerRef = React.useRef<HTMLElement | null>(null);

  const openModalWithFocusSave = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    modalOpenerRef.current = document.activeElement as HTMLElement | null;
    setter(true);
  };
  const closeModalWithFocusRestore = (setter: React.Dispatch<React.SetStateAction<boolean>>) => {
    setter(false);
    const opener = modalOpenerRef.current;
    modalOpenerRef.current = null;
    requestAnimationFrame(() => {
      if (opener && opener.isConnected) opener.focus();
    });
  };

  // Modals state
  const [breakdownOpen, setBreakdownOpen] = React.useState(false);
  const [adjustMetric, setAdjustMetric] = React.useState<MetricItemData | null>(null);
  const [adjustValue, setAdjustValue] = React.useState<string>("");
  const [adjustReason, setAdjustReason] = React.useState<string>("");
  const [createReviewOpen, setCreateReviewOpen] = React.useState(false);
  const [createGoalOpen, setCreateGoalOpen] = React.useState(false);

  // Detail Drawer state
  const [detailDrawerOpen, setDetailDrawerOpen] = React.useState(false);
  const [selectedMetricKey, setSelectedMetricKey] = React.useState<string | null>(null);
  const [selectedMetricLabel, setSelectedMetricLabel] = React.useState<string | null>(null);

  // Self-Review state
  const [selfReviewOpen, setSelfReviewOpen] = React.useState(false);
  const [selfReviewReflection, setSelfReviewReflection] = React.useState("");

  // Guided Review form state
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
  const [goalAssigneeId, setGoalAssigneeId] = React.useState<string>("");
  const [calcOpen, setCalcOpen] = React.useState<boolean>(false);
  const [showAllTimeHistory, setShowAllTimeHistory] = React.useState<boolean>(false);

  // Default target employee to param (only when param changes) or current user
  React.useEffect(() => {
    if (targetFromParam && targetFromParam !== lastParamRef.current) {
      lastParamRef.current = targetFromParam;
      setSelectedEmpId(targetFromParam);
    } else if (!targetFromParam && userId && !selectedEmpId) {
      setSelectedEmpId(userId);
    }
  }, [targetFromParam, userId, selectedEmpId]);

  const anyModalOpen = Boolean(adjustMetric || createReviewOpen || selfReviewOpen || createGoalOpen);
  React.useEffect(() => {
    if (!anyModalOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (adjustMetric) setAdjustMetric(null);
      else if (createReviewOpen) closeModalWithFocusRestore(setCreateReviewOpen);
      else if (selfReviewOpen) closeModalWithFocusRestore(setSelfReviewOpen);
      else if (createGoalOpen) closeModalWithFocusRestore(setCreateGoalOpen);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [anyModalOpen, adjustMetric, createReviewOpen, selfReviewOpen, createGoalOpen]);

  const effectiveEmpId = selectedEmpId || userId || "";
  const isManagerOrAdmin = userRole === "manager" || userRole === "hr" || userRole === "admin";
  const isSelfView = effectiveEmpId === userId;

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
      if (deptFilter && deptFilter !== "all") params.append("department", deptFilter);

      const res = await fetch(`/api/kpi?${params.toString()}`);
      if (!res.ok) {
        if (res.status === 403) toast.error("Access denied to target employee KPI");
        return null;
      }
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && FEATURES.KPI),
  });

  // 1b. Fetch Historical Trend Data (for category sparklines)
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

  // Delayed skeleton loading flag (>300ms)
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

  // 2. Fetch Period-Overlapping Reviews Data (or all-time when toggled)
  const {
    data: reviewsData,
    refetch: refetchReviews,
  } = useQuery({
    queryKey: ["kpi-reviews", effectiveEmpId, dateRange.from, dateRange.to, showAllTimeHistory],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const params = new URLSearchParams({
        employee_id: effectiveEmpId,
        from: dateRange.from,
        to: dateRange.to,
      });
      if (showAllTimeHistory) params.set("scope", "all");
      const res = await fetch(`/api/kpi/reviews?${params.toString()}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && FEATURES.KPI),
  });

  // 3. Fetch Period-Overlapping Goals Data (or all-time when toggled)
  const {
    data: goalsData,
    refetch: refetchGoals,
  } = useQuery({
    queryKey: ["kpi-goals", effectiveEmpId, dateRange.from, dateRange.to, showAllTimeHistory],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const params = new URLSearchParams({
        employee_id: effectiveEmpId,
        from: dateRange.from,
        to: dateRange.to,
      });
      if (showAllTimeHistory) params.set("scope", "all");
      const res = await fetch(`/api/kpi/goals?${params.toString()}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && FEATURES.KPI),
  });

  // 4. Fetch Self-Review Data
  const {
    data: selfReviewData,
    refetch: refetchSelfReview,
  } = useQuery({
    queryKey: ["kpi-self-review", effectiveEmpId, dateRange.from, dateRange.to],
    queryFn: async () => {
      if (!effectiveEmpId) return null;
      const params = new URLSearchParams({
        employee_id: effectiveEmpId,
        from: dateRange.from,
        to: dateRange.to,
      });
      const res = await fetch(`/api/kpi/self-reviews?${params.toString()}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(effectiveEmpId && FEATURES.KPI),
  });

  // Period navigation helpers
  const handlePresetChange = (newPreset: PeriodPreset) => {
    setPreset(newPreset);
    setDateRange(getKolkataPresetDates(newPreset));
  };

  const handlePrevPeriod = () => {
    const curFrom = new Date(`${dateRange.from}T00:00:00Z`);
    if (preset === "month") {
      curFrom.setUTCMonth(curFrom.getUTCMonth() - 1);
      setDateRange(getKolkataPresetDates("month", curFrom.getUTCFullYear(), curFrom.getUTCMonth() + 1));
    } else if (preset === "quarter") {
      curFrom.setUTCMonth(curFrom.getUTCMonth() - 3);
      setDateRange(getKolkataPresetDates("quarter", curFrom.getUTCFullYear(), curFrom.getUTCMonth() + 1));
    } else if (preset === "week") {
      const start = new Date(curFrom.getTime() - 7 * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      setDateRange({
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
      });
    }
  };

  const handleNextPeriod = () => {
    const curFrom = new Date(`${dateRange.from}T00:00:00Z`);
    if (preset === "month") {
      curFrom.setUTCMonth(curFrom.getUTCMonth() + 1);
      setDateRange(getKolkataPresetDates("month", curFrom.getUTCFullYear(), curFrom.getUTCMonth() + 1));
    } else if (preset === "quarter") {
      curFrom.setUTCMonth(curFrom.getUTCMonth() + 3);
      setDateRange(getKolkataPresetDates("quarter", curFrom.getUTCFullYear(), curFrom.getUTCMonth() + 1));
    } else if (preset === "week") {
      const start = new Date(curFrom.getTime() + 7 * 24 * 60 * 60 * 1000);
      const end = new Date(start.getTime() + 6 * 24 * 60 * 60 * 1000);
      setDateRange({
        from: start.toISOString().slice(0, 10),
        to: end.toISOString().slice(0, 10),
      });
    }
  };

  // Adjust metric mutation
  const submitAdjustment = useMutation({
    mutationFn: async () => {
      if (!adjustMetric) return;
      if (adjustReason.trim().length < 5) {
        throw new Error("Adjustment reason must be at least 5 characters");
      }
      const val = parseFloat(adjustValue);
      if (isNaN(val)) throw new Error("Please enter a valid numeric value");

      const res = await fetch("/api/kpi/adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: effectiveEmpId,
          metric: adjustMetric.key,
          period_start: dateRange.from,
          period_end: dateRange.to,
          override_value: val,
          reason: adjustReason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to adjust metric");
      return data;
    },
    onSuccess: () => {
      toast.success("Metric adjusted successfully");
      setAdjustMetric(null);
      setAdjustValue("");
      setAdjustReason("");
      refetchKpi();
    },
    onError: (err: any) => {
      toast.error(err.message);
    },
  });

  // Guided Review Mutation
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
      const targetEmp = goalAssigneeId || effectiveEmpId || userId;
      const res = await fetch("/api/kpi/goals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employee_id: targetEmp,
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
      const isSelf = (goalAssigneeId || effectiveEmpId) === userId;
      toast.success(isSelf ? "Goal added" : "Goal assigned successfully");
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

  // Self-Review Mutation
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
  const overallScore = kpiData?.current?.overallScore ?? null;
  const overallTarget = kpiData?.current?.overallTarget ?? KPI_CONFIG.overallTarget ?? 90;
  const dataStatus: "ok" | "unavailable" = kpiData?.current?.dataStatus || "ok";
  const sourceErrors: string[] = kpiData?.current?.sourceErrors || [];
  const trend = kpiData?.trend?.overallScore ?? null;
  const previousPeriodComparable = Boolean(
    kpiData?.current?.dataStatus !== "unavailable" &&
      kpiData?.previous?.dataStatus !== "unavailable" &&
      kpiData?.previous?.overallScore != null &&
      (kpiData?.previous?.dataPointsCount ?? 0) >= 2 &&
      overallScore != null
  );
  const scopedEmployees = kpiData?.scopedEmployees || [];
  const periodLabel = formatKpiPeriodLabel(preset, dateRange.from, dateRange.to);
  const stepperLabel = formatKpiStepperLabel(preset, dateRange.from, dateRange.to);
  const adjustedMetricsList = React.useMemo(
    () =>
      Object.values(currentMetrics || {}).filter((m: any) => Boolean(m?.adjusted)) as any[],
    [currentMetrics]
  );

  if (!FEATURES.KPI) {
    return null;
  }

  // Goals progress summary
  const goalsList = goalsData?.goals || [];
  const notStartedGoals = goalsList.filter((g: any) => g.status === "not_started").length;
  const onTrackGoals = goalsList.filter((g: any) => g.status === "on_track").length;
  const atRiskGoals = goalsList.filter((g: any) => g.status === "at_risk").length;
  const doneGoals = goalsList.filter((g: any) => g.status === "done").length;

  // Next actions suggestions powered directly by authoritative server computation
  const missingCheckInDates: string[] = kpiData?.current?.actionableMissingDates || [];
  const pendingCorrectionDates: string[] = kpiData?.current?.pendingCorrectionDates || [];
  const unloggedCount = missingCheckInDates.length;

  // Target employee name for manager view & heading
  const targetEmployeeName =
    kpiData?.employee?.full_name ||
    scopedEmployees.find((e: any) => e.id === effectiveEmpId)?.full_name ||
    "Team member";
  const targetEmployeeEmail =
    kpiData?.employee?.email ||
    scopedEmployees.find((e: any) => e.id === effectiveEmpId)?.email ||
    "";

  const nextActions = getNextActionSuggestions({
    isSelfView,
    isManagerOrAdmin,
    employeeName: targetEmployeeName,
    unloggedCount,
    missingDates: missingCheckInDates,
    hasPendingSelfReview: !selfReviewData?.selfReview,
    hasSubmittedSelfReview: Boolean(selfReviewData?.selfReview),
    hasManagerReview: (reviewsData?.reviews || []).length > 0,
    atRiskGoals: goalsList.filter((g: any) => g.status === "at_risk"),
    overdueTasksCount: currentMetrics?.task_overdue_count?.value || 0,
  });

  // Delayed skeleton loader
  if (isInitialLoading) {
    if (!showSkeleton) {
      return <div className="w-full min-h-[400px]" />;
    }
    return (
      <div className="w-full space-y-5 pb-20">
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1">
          <div className="space-y-2">
            <Skeleton className="h-8 w-44 rounded-xl" />
            <Skeleton className="h-4 w-72 rounded-lg" />
          </div>
          <Skeleton className="h-9 w-28 rounded-full" />
        </section>
        <Skeleton className="h-14 w-full rounded-2xl" />
        <Skeleton className="h-40 w-full rounded-2xl" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      </div>
    );
  }

  const isOverview = activeTab === "overview" || activeTab === "metrics";
  const isReviewsAndGoals = activeTab === "reviews_and_goals" || activeTab === "reviews" || activeTab === "goals";
  const isTeamTab = activeTab === "team";

  const handleBackToTeam = () => {
    setSelectedEmpId(userId || "");
    setCameFromTeam(false);
    setActiveTab("team");
    if (targetFromParam) {
      lastParamRef.current = null;
      router.replace("/kpi", { scroll: false });
    }
  };

  return (
    <div className="w-full space-y-4 pb-20">
      {/* 1. Page Header: Whose performance, readable period, optional Back to team & Export CSV */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
              {isSelfView ? "My performance" : targetEmployeeName}
            </h1>
            <span className="text-xs sm:text-sm font-semibold text-text-secondary tabular-nums">
              {periodLabel}
            </span>
          </div>
          {!isSelfView && (
            <p className="text-xs text-text-tertiary truncate">
              {targetEmployeeEmail ? `${targetEmployeeEmail} · ` : ""}Viewing team member performance
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {isManagerOrAdmin && (!isSelfView || cameFromTeam) && !isTeamTab && (
            <button
              type="button"
              onClick={handleBackToTeam}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full bg-card border border-border-light text-xs font-bold text-text-primary hover:bg-card-subtle transition-colors shadow-xs cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Back to team</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCsv}
            disabled={kpiLoading || !kpiData}
            aria-label="Export performance CSV"
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-full bg-card border border-border-light text-xs font-bold text-text-primary hover:bg-card-subtle transition-colors shadow-xs cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-black"
          >
            <Download className="w-3.5 h-3.5 text-black" aria-hidden="true" />
            <span>Export CSV</span>
          </button>
        </div>
      </section>

      {/* 2. Distinct Navigation Row + All 4 Period Presets (Week, Month, Quarter, Custom) */}
      <KpiToolbar
        activeTab={activeTab}
        onTabChange={(t) => setActiveTab(t)}
        reviewCount={reviewsData?.reviews?.length || 0}
        goalCount={goalsList.length}
        stepperLabel={stepperLabel}
        preset={preset}
        onPresetChange={handlePresetChange}
        onPrevPeriod={handlePrevPeriod}
        onNextPeriod={handleNextPeriod}
        customRange={dateRange}
        onCustomRangeChange={setDateRange}
        isManagerOrAdmin={isManagerOrAdmin}
        scopedEmployees={scopedEmployees}
        selectedEmpId={effectiveEmpId}
        onSelectEmployee={(empId) => {
          setSelectedEmpId(empId);
          setCameFromTeam(false);
        }}
        currentUserId={userId}
      />

      {/* 3. TAB 1: OVERVIEW */}
      {isOverview && (
        <div
          role="tabpanel"
          aria-labelledby="kpi-tab-overview"
          className="space-y-4"
        >
          {dataStatus === "unavailable" && (
            <div
              role="alert"
              className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-rose-950"
            >
              <div className="flex items-start sm:items-center gap-2.5">
                <AlertTriangle className="w-4 h-4 text-[#FF007A] shrink-0 mt-0.5 sm:mt-0" aria-hidden="true" />
                <div>
                  <p className="font-bold">Some source tables were unavailable for this view.</p>
                  <p className="text-rose-800">
                    Affected data: {sourceErrors.join(", ") || "attendance/tasks"}. Scores using unavailable sources are held back rather than shown as zero.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => refetchKpi()}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-black text-white font-bold text-xs hover:bg-[#1A1A1A] cursor-pointer shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Retry</span>
              </button>
            </div>
          )}

          {/* Top Row: Compact Score Summary + Attendance & Task Completion Snapshot Tiles */}
          <KpiHeroCard
            overallScore={overallScore}
            trend={trend}
            previousPeriodComparable={previousPeriodComparable}
            target={overallTarget}
            currentMetrics={currentMetrics}
            previousMetrics={previousMetrics}
            customWeights={kpiData?.current?.weights}
            isSelfView={isSelfView}
            subjectName={targetEmployeeName}
            userRole={userRole}
            previousPeriodLabel={preset === "month" ? "last month" : preset === "quarter" ? "last quarter" : "previous period"}
            periodType={preset}
            hasElapsedEligibleDays={kpiData?.current?.hasElapsedEligibleDays ?? true}
            joinedOn={kpiData?.current?.joinedOn ?? null}
          />

          {/* First-screen Next Actions */}
          <KpiNextActionsCard
            actions={nextActions}
            onTriggerAction={(trigger) => {
              if (trigger === "self_review") {
                setSelfReviewReflection(selfReviewData?.selfReview?.reflection || "");
                openModalWithFocusSave(setSelfReviewOpen);
              } else if (trigger === "write_review") {
                openModalWithFocusSave(setCreateReviewOpen);
              } else if (trigger === "inspect_days") {
                setSelectedMetricKey("days_worked_vs_expected");
                setSelectedMetricLabel("Days present");
                setDetailDrawerOpen(true);
              } else if (trigger === "inspect_overdue_tasks") {
                setSelectedMetricKey("task_overdue_count");
                setSelectedMetricLabel("Overdue tasks");
                setDetailDrawerOpen(true);
              }
            }}
            onNavigateTab={(tab) => setActiveTab(tab)}
          />

          {/* Bento Split Row 1: Performance Breakdown + Attendance Calendar */}
          {currentMetrics && (
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
              <div className="xl:col-span-7 flex flex-col">
                <KpiCategorySection
                  currentMetrics={currentMetrics}
                  customWeights={kpiData?.current?.weights}
                  hoursBreakdown={kpiData?.current?.hoursBreakdown}
                  taskPopulationNote={kpiData?.current?.taskPopulationNote}
                  onOpenMetric={(key, label) => {
                    setSelectedMetricKey(key);
                    setSelectedMetricLabel(label);
                    setDetailDrawerOpen(true);
                  }}
                />
              </div>

              <div className="xl:col-span-5 flex flex-col">
                <KpiAttendanceCalendar
                  className="h-full"
                  calendarDays={kpiData?.current?.calendarDays || []}
                  periodLabel={stepperLabel}
                  actionableMissingDates={missingCheckInDates}
                  pendingCorrectionDates={pendingCorrectionDates}
                  isSelfView={isSelfView}
                  employeeId={effectiveEmpId}
                  onInspectAttendanceDays={() => {
                    setSelectedMetricKey("days_worked_vs_expected");
                    setSelectedMetricLabel("Days present");
                    setDetailDrawerOpen(true);
                  }}
                />
              </div>
            </div>
          )}

          {/* Bento Split Row 2: Self-Review / Reviews & Goals Summary + Score Details Card */}
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-stretch">
            <div className="xl:col-span-7 flex flex-col justify-between gap-3">
              {isSelfView && !selfReviewData?.selfReview && !selfReviewData?.hasManagerReview && (
                <div className="p-5 rounded-2xl bg-[#141414] text-white shadow-card flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-start gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-[#B7FF00] text-black flex items-center justify-center shrink-0">
                      <MessageSquare className="w-5 h-5" aria-hidden="true" />
                    </div>
                    <div>
                      <h2 className="text-base font-extrabold tracking-tight text-white">
                        Your self-review is open
                      </h2>
                      <p className="text-xs text-white/75 mt-0.5">
                        Reflect on your attendance and project work for {periodLabel}.
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelfReviewReflection("");
                      openModalWithFocusSave(setSelfReviewOpen);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-[#B7FF00] hover:bg-[#a6eb00] text-black text-xs font-bold transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-white"
                  >
                    <span>Write reflection</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              )}

              <KpiCompactSummaryLines
                latestReview={reviewsData?.reviews?.[0] || null}
                goals={goalsList}
                onOpenReviewsAndGoals={() => setActiveTab("reviews_and_goals")}
              />
            </div>

            {/* Score Details Summary Card (reference bento corner card) */}
            <div className="xl:col-span-5 p-5 rounded-2xl bg-card border border-border-light shadow-card flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="relative w-16 h-16 shrink-0" aria-hidden="true">
                  <svg viewBox="0 0 36 36" className="w-16 h-16 -rotate-90">
                    <circle
                      cx="18"
                      cy="18"
                      r="15.5"
                      fill="none"
                      stroke="#EFEFEF"
                      strokeWidth="3.5"
                    />
                    {overallScore != null && (
                      <circle
                        cx="18"
                        cy="18"
                        r="15.5"
                        fill="none"
                        stroke="#B7FF00"
                        strokeWidth="3.5"
                        strokeDasharray={`${Math.min(100, Math.max(0, overallScore))}, 100`}
                        strokeLinecap="round"
                      />
                    )}
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-sm font-black text-text-primary tabular-nums">
                    {overallScore != null ? `${overallScore}%` : "—"}
                  </span>
                </div>
                <div>
                  <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                    Score details
                  </h2>
                  <p className="text-xs text-text-secondary tabular-nums mt-0.5">
                    Target {overallTarget}%
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  setCalcOpen(true);
                  requestAnimationFrame(() => {
                    document
                      .getElementById("kpi-calculation-details")
                      ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  });
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold transition-colors cursor-pointer shrink-0 focus-visible:outline-2 focus-visible:outline-black"
              >
                <span>View calculation</span>
                <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          {/* Expandable "How my score is calculated" */}
          <KpiCalculationFooter
            id="kpi-calculation-details"
            open={calcOpen}
            onToggleOpen={setCalcOpen}
            employeeType={empType}
            overallTarget={overallTarget}
            configEffectiveDate={kpiData?.current?.configEffectiveDate}
            configVersionReason={kpiData?.current?.configVersionReason}
            customWeights={kpiData?.current?.weights}
            currentMetrics={currentMetrics}
            adjustedMetrics={adjustedMetricsList}
          />
        </div>
      )}

      {/* 4. TAB 2: REVIEWS & GOALS */}
      {isReviewsAndGoals && (
        <div
          role="tabpanel"
          aria-labelledby="kpi-tab-reviews_and_goals"
          data-tour="kpi-reviews-tab"
          className="space-y-6"
        >
          {/* Current Cycle Summary Bar */}
          <div className="px-4 py-3 rounded-2xl bg-card border border-border-light shadow-xs flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-text-primary">Current cycle:</span>
              <span className="text-text-secondary font-medium">
                {showAllTimeHistory ? "All-time history" : periodLabel}
              </span>
              <span className="px-2 py-0.5 rounded-full bg-card-subtle border border-border-light text-[11px] font-semibold text-text-primary">
                {selfReviewData?.selfReview ? "Self-review submitted" : "Self-review open"}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-[11px] text-text-tertiary tabular-nums">
                {reviewsData?.reviews?.length || 0} manager review{(reviewsData?.reviews?.length || 0) === 1 ? "" : "s"} · {goalsList.length} goal{goalsList.length === 1 ? "" : "s"}
              </span>
              {((reviewsData?.allTimeCount || 0) > (reviewsData?.reviews?.length || 0) ||
                (goalsData?.allTimeCount || 0) > goalsList.length ||
                showAllTimeHistory) && (
                <button
                  type="button"
                  onClick={() => setShowAllTimeHistory((v) => !v)}
                  className="px-2.5 py-1 rounded-lg bg-card-subtle hover:bg-border-light border border-border-light text-[11px] font-bold text-text-primary cursor-pointer"
                >
                  {showAllTimeHistory
                    ? "Show period only"
                    : `View all-time (${(reviewsData?.allTimeCount || 0) + (goalsData?.allTimeCount || 0)})`}
                </button>
              )}
            </div>
          </div>

          {/* SECTION 1: Performance Reviews */}
          <section className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-light pb-3">
              <div>
                <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                  Performance reviews
                </h2>
                <p className="text-xs text-text-secondary">
                  Self-reflection and manager evaluations for {periodLabel}.
                </p>
              </div>

              <div className="flex items-center gap-2">
                {isSelfView && (
                  <button
                    type="button"
                    data-tour="kpi-self-review"
                    onClick={() => {
                      setSelfReviewReflection(selfReviewData?.selfReview?.reflection || "");
                      openModalWithFocusSave(setSelfReviewOpen);
                    }}
                    disabled={selfReviewData?.hasManagerReview}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#B7FF00] hover:bg-[#a6eb00] text-black text-xs font-bold transition-all shadow-xs cursor-pointer disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-black"
                  >
                    <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>
                      {selfReviewData?.selfReview
                        ? selfReviewData.canEdit
                          ? "Edit self-review"
                          : "Self-review (locked)"
                        : "Write self-review"}
                    </span>
                  </button>
                )}

                {isManagerOrAdmin && !isSelfView && (
                  <button
                    type="button"
                    data-tour="kpi-add-review"
                    onClick={() => openModalWithFocusSave(setCreateReviewOpen)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold transition-all shadow-xs cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
                  >
                    <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Write review</span>
                  </button>
                )}
              </div>
            </div>

            {selfReviewData?.selfReview && (
              <div className="p-4 rounded-xl bg-card-subtle border border-border-light space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#B7FF00]" aria-hidden="true" />
                    <h3 className="text-xs font-bold text-text-primary">
                      {isSelfView ? "Your self-review reflection" : "Employee self-review reflection"}
                    </h3>
                  </div>
                  <span className="text-[11px] text-text-tertiary">
                    Submitted: {new Date(selfReviewData.selfReview.created_at).toLocaleDateString()}
                  </span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {selfReviewData.selfReview.reflection}
                </p>
              </div>
            )}

            <div className="space-y-3">
              {(reviewsData?.reviews || []).length > 0 ? (
                reviewsData!.reviews.map((rev: any) => (
                  <div
                    key={rev.id}
                    className="p-4 rounded-xl bg-card-subtle/70 border border-border-light space-y-3"
                  >
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-bold text-text-primary">
                        Reviewed by {rev.reviewer_name || "Manager"}
                      </span>
                      <span className="text-[11px] text-text-tertiary">
                        {new Date(rev.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-1 border-t border-border-light/60 text-xs">
                      {Object.entries(rev.ratings || {}).map(([key, val]) => (
                        <div key={key} className="flex justify-between p-2 rounded-lg bg-card">
                          <span className="text-text-secondary capitalize">{key}</span>
                          <span className="font-bold text-text-primary tabular-nums">{Number(val)}/5</span>
                        </div>
                      ))}
                    </div>

                    {rev.note && (
                      <p className="text-xs text-text-secondary leading-relaxed bg-card p-3 rounded-lg border border-border-light">
                        {rev.note}
                      </p>
                    )}
                  </div>
                ))
              ) : (
                <div className="p-5 rounded-xl bg-card-subtle/50 border border-dashed border-border-light text-center space-y-2.5">
                  <p className="text-xs text-text-secondary font-medium">
                    {isSelfView
                      ? selfReviewData?.selfReview
                        ? "Your self-review is saved. Your manager has not submitted an evaluation for this cycle yet."
                        : "No manager evaluation yet. Start this cycle by submitting your self-review reflection."
                      : `No review submitted yet for ${targetEmployeeName} in this cycle.`}
                  </p>
                  {isSelfView && !selfReviewData?.selfReview && !selfReviewData?.hasManagerReview && (
                    <button
                      type="button"
                      onClick={() => {
                        setSelfReviewReflection("");
                        openModalWithFocusSave(setSelfReviewOpen);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
                    >
                      <Edit3 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Write self-review</span>
                    </button>
                  )}
                  {isManagerOrAdmin && !isSelfView && (
                    <button
                      type="button"
                      onClick={() => openModalWithFocusSave(setCreateReviewOpen)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-[#B7FF00] hover:bg-[#a6eb00] text-black text-xs font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Write review for {targetEmployeeName}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* SECTION 2: Goals & Strategic Milestones */}
          <section data-tour="kpi-goals-tab" className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-border-light pb-3">
              <div>
                <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                  Goals &amp; milestones
                </h2>
                <p className="text-xs text-text-secondary">
                  Track deliverable milestones and objectives for {periodLabel}.
                </p>
              </div>

              {isManagerOrAdmin && (
                <button
                  type="button"
                  onClick={() => {
                    setGoalAssigneeId(effectiveEmpId);
                    openModalWithFocusSave(setCreateGoalOpen);
                  }}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold transition-all shadow-xs cursor-pointer self-start sm:self-auto focus-visible:outline-2 focus-visible:outline-black"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Add goal</span>
                </button>
              )}
            </div>

            {goalsList.length > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="px-3 py-1 rounded-full bg-card-subtle border border-border-light font-medium tabular-nums">
                  Not started: <strong>{notStartedGoals}</strong>
                </span>
                <span className="px-3 py-1 rounded-full bg-card-subtle border border-border-light font-medium tabular-nums">
                  On track: <strong>{onTrackGoals}</strong>
                </span>
                <span className="px-3 py-1 rounded-full bg-card-subtle border border-border-light font-medium tabular-nums">
                  At risk: <strong>{atRiskGoals}</strong>
                </span>
                <span className="px-3 py-1 rounded-full bg-card-subtle border border-border-light font-medium tabular-nums">
                  Completed: <strong>{doneGoals}</strong>
                </span>
              </div>
            )}

            <div className="space-y-3 pt-1">
              {goalsList.length > 0 ? (
                goalsList.map((g: any) => (
                  <div
                    key={g.id}
                    className="p-4 rounded-xl bg-card-subtle/70 border border-border-light space-y-2 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Target className="w-4 h-4 text-black shrink-0" aria-hidden="true" />
                        <h3 className="text-xs font-bold text-text-primary leading-snug truncate">
                          {g.title}
                        </h3>
                      </div>
                      {g.note && (
                        <p className="text-xs text-text-secondary line-clamp-2 pl-6">
                          {g.note}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                      <select
                        aria-label={`Update goal status for ${g.title}`}
                        value={g.status}
                        onChange={(e) => updateGoalStatus.mutate({ id: g.id, status: e.target.value })}
                        className="px-2.5 py-1.5 rounded-lg bg-card border border-border-light text-xs font-bold text-text-primary cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
                      >
                        <option value="not_started">Not started</option>
                        <option value="on_track">On track</option>
                        <option value="at_risk">At risk</option>
                        <option value="done">Completed</option>
                      </select>
                    </div>
                  </div>
                ))
              ) : (
                <div className="p-5 rounded-xl bg-card-subtle/50 border border-dashed border-border-light text-center space-y-2.5">
                  <p className="text-xs text-text-secondary font-medium">
                    {isManagerOrAdmin
                      ? `No goals assigned to ${isSelfView ? "you" : targetEmployeeName} for this period yet.`
                      : "No goals assigned for this period yet. Goals created by your manager or linked from Tasks appear here."}
                  </p>
                  {isManagerOrAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        setGoalAssigneeId(effectiveEmpId);
                        openModalWithFocusSave(setCreateGoalOpen);
                      }}
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
                    >
                      <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Set first goal</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* 5. TAB 3: TEAM (Managers and HR only) */}
      {isTeamTab && isManagerOrAdmin && (
        <div
          role="tabpanel"
          aria-labelledby="kpi-tab-team"
          data-tour="kpi-team-tab"
          className="space-y-4"
        >
          <KpiTeamOverview
            from={dateRange.from}
            to={dateRange.to}
            departmentFilter={deptFilter}
            onDepartmentFilterChange={setDeptFilter}
            departments={departmentsList}
            employeeTypeFilter={teamEmpTypeFilter}
            onEmployeeTypeFilterChange={setTeamEmpTypeFilter}
            onSelectEmployee={(empId) => {
              setSelectedEmpId(empId);
              setCameFromTeam(true);
              setActiveTab("overview");
            }}
            onClearFilters={() => {
              setDeptFilter("all");
              setTeamEmpTypeFilter("all");
            }}
          />
        </div>
      )}

      {/* DETAIL DRAWER */}
      <KpiDetailDrawer
        isOpen={detailDrawerOpen}
        onClose={() => setDetailDrawerOpen(false)}
        employeeId={effectiveEmpId}
        metricKey={selectedMetricKey}
        metricLabel={selectedMetricLabel}
        from={dateRange.from}
        to={dateRange.to}
        isSelfView={isSelfView}
        isManagerOrAdmin={isManagerOrAdmin}
        onAdjustMetric={(m) => {
          setAdjustMetric(m);
          setAdjustValue(m?.value != null ? String(m.value) : "");
        }}
      />

      {/* MODAL: Score Adjustment (Triggered from Detail Drawer) */}
      {adjustMetric && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="adjust-metric-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAdjustMetric(null);
          }}
        >
          <div className="w-full max-w-md bg-card rounded-2xl border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 id="adjust-metric-modal-title" className="text-sm font-bold text-text-primary">
                Adjust score override
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
              Metric: <strong className="text-text-primary">{adjustMetric.label}</strong>. All adjustments are logged and displayed with your reason.
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
                  Reason for adjustment (required)
                </label>
                <textarea
                  rows={3}
                  required
                  minLength={5}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="Explain why this metric is being adjusted..."
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
                <div className="flex justify-between items-center text-[11px] text-text-tertiary mt-1">
                  <span>Minimum 5 characters</span>
                  <span className={cn(adjustReason.trim().length >= 5 ? "text-text-primary font-semibold" : "text-rose-600 font-medium")}>
                    {adjustReason.trim().length} characters
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
                  Save adjustment
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Guided Manager Review (Part 2, rule 4: Guided form + Self-review shown beside) */}
      {createReviewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-review-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModalWithFocusRestore(setCreateReviewOpen);
          }}
        >
          <div className="w-full max-w-3xl bg-card rounded-2xl border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <div>
                <h3 id="create-review-modal-title" className="text-sm font-extrabold text-text-primary">
                  Performance review for {targetEmployeeName}
                </h3>
                <p className="text-xs text-text-secondary">
                  Guided four-point evaluation and qualitative feedback.
                </p>
              </div>
              <button
                type="button"
                aria-label="Close review modal"
                onClick={() => closeModalWithFocusRestore(setCreateReviewOpen)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
              {/* Left Panel: Employee's Self-Review beside it */}
              <div className="md:col-span-5 p-4 rounded-xl bg-card-subtle border border-border-light space-y-2.5 flex flex-col justify-between">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-[#B7FF00]" aria-hidden="true" />
                    <h4 className="text-xs font-bold text-text-primary">
                      Employee self-review
                    </h4>
                  </div>
                  {selfReviewData?.selfReview ? (
                    <div className="space-y-1.5 text-xs text-text-secondary">
                      <span className="text-[10px] text-text-tertiary block">
                        Submitted on {new Date(selfReviewData.selfReview.created_at).toLocaleDateString()}
                      </span>
                      <p className="leading-relaxed whitespace-pre-wrap p-2.5 rounded-lg bg-card border border-border-light">
                        {selfReviewData.selfReview.reflection}
                      </p>
                    </div>
                  ) : (
                    <p className="text-xs text-text-tertiary italic pt-2">
                      No self-review submitted yet for this period.
                    </p>
                  )}
                </div>

                <div className="text-[11px] text-text-tertiary pt-2 border-t border-border-light/60">
                  Reviews are shared with the employee after submission.
                </div>
              </div>

              {/* Right Panel: Guided Form */}
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  submitReview.mutate();
                }}
                className="md:col-span-7 space-y-3.5"
              >
                {/* Four 1 to 5 ratings with one-line description each */}
                <div className="space-y-2.5">
                  {/* 1. Quality */}
                  <div className="p-2.5 rounded-xl bg-card-subtle/80 border border-border-light flex items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-text-primary block">Quality of work</span>
                      <span className="text-[11px] text-text-secondary">Accuracy and quality of deliverables.</span>
                    </div>
                    <select
                      value={reviewRatings.quality}
                      onChange={(e) => setReviewRatings({ ...reviewRatings, quality: Number(e.target.value) })}
                      className="px-2.5 py-1 rounded-lg bg-card border border-border-light font-bold text-xs cursor-pointer"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n} / 5</option>
                      ))}
                    </select>
                  </div>

                  {/* 2. Communication */}
                  <div className="p-2.5 rounded-xl bg-card-subtle/80 border border-border-light flex items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-text-primary block">Communication</span>
                      <span className="text-[11px] text-text-secondary">Clarity and responsiveness with teammates.</span>
                    </div>
                    <select
                      value={reviewRatings.communication}
                      onChange={(e) => setReviewRatings({ ...reviewRatings, communication: Number(e.target.value) })}
                      className="px-2.5 py-1 rounded-lg bg-card border border-border-light font-bold text-xs cursor-pointer"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n} / 5</option>
                      ))}
                    </select>
                  </div>

                  {/* 3. Initiative */}
                  <div className="p-2.5 rounded-xl bg-card-subtle/80 border border-border-light flex items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-text-primary block">Initiative</span>
                      <span className="text-[11px] text-text-secondary">Taking ownership and proactive problem solving.</span>
                    </div>
                    <select
                      value={reviewRatings.initiative}
                      onChange={(e) => setReviewRatings({ ...reviewRatings, initiative: Number(e.target.value) })}
                      className="px-2.5 py-1 rounded-lg bg-card border border-border-light font-bold text-xs cursor-pointer"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n} / 5</option>
                      ))}
                    </select>
                  </div>

                  {/* 4. Teamwork */}
                  <div className="p-2.5 rounded-xl bg-card-subtle/80 border border-border-light flex items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-bold text-text-primary block">Teamwork</span>
                      <span className="text-[11px] text-text-secondary">Reliability, collaboration, and helping others.</span>
                    </div>
                    <select
                      value={reviewRatings.teamwork}
                      onChange={(e) => setReviewRatings({ ...reviewRatings, teamwork: Number(e.target.value) })}
                      className="px-2.5 py-1 rounded-lg bg-card border border-border-light font-bold text-xs cursor-pointer"
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>{n} / 5</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* One note field with visible character counter */}
                <div>
                  <label className="block text-xs font-bold text-text-primary mb-1">
                    Manager feedback note *
                  </label>
                  <textarea
                    rows={3}
                    required
                    minLength={5}
                    value={reviewNote}
                    onChange={(e) => setReviewNote(e.target.value)}
                    placeholder="Provide constructive feedback, key accomplishments, and growth focus..."
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                  />
                  <div className="flex justify-between items-center text-[11px] text-text-tertiary mt-1">
                    <span>Minimum 5 characters required</span>
                    <span className={cn(reviewNote.trim().length >= 5 ? "text-text-primary font-bold" : "text-rose-600 font-semibold")}>
                      {reviewNote.trim().length} characters
                    </span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-border-light">
                  <button
                    type="button"
                    onClick={() => setCreateReviewOpen(false)}
                    className="px-4 py-2 rounded-full bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitReview.isPending || reviewNote.trim().length < 5}
                    className="px-5 py-2 rounded-full bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                  >
                    Submit review
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: Employee Self-Review Reflection */}
      {selfReviewOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="self-review-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModalWithFocusRestore(setSelfReviewOpen);
          }}
        >
          <div className="w-full max-w-lg bg-card rounded-2xl border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 id="self-review-modal-title" className="text-sm font-extrabold text-text-primary">
                Write self-review reflection
              </h3>
              <button
                type="button"
                aria-label="Close self-review modal"
                onClick={() => closeModalWithFocusRestore(setSelfReviewOpen)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-text-secondary">
              Summarize your key achievements, challenges overcome, and focus areas for this cycle.
            </p>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                submitSelfReview.mutate();
              }}
              className="space-y-3"
            >
              <div>
                <textarea
                  rows={5}
                  required
                  minLength={20}
                  value={selfReviewReflection}
                  onChange={(e) => setSelfReviewReflection(e.target.value)}
                  placeholder="In this cycle, I delivered... I overcame... For the next period I will focus on..."
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary leading-relaxed"
                />
                <div className="flex justify-between items-center text-[11px] text-text-tertiary mt-1">
                  <span>Minimum 20 characters</span>
                  <span className={cn(selfReviewReflection.trim().length >= 20 ? "text-text-primary font-bold" : "text-rose-600 font-semibold")}>
                    {selfReviewReflection.trim().length} characters
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
                  Submit reflection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: Create Goal */}
      {createGoalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="create-goal-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-xs"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeModalWithFocusRestore(setCreateGoalOpen);
          }}
        >
          <div className="w-full max-w-md bg-card rounded-2xl border border-border-light shadow-shell p-6 space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-border-light">
              <h3 id="create-goal-modal-title" className="text-sm font-extrabold text-text-primary">
                {(goalAssigneeId || effectiveEmpId) === userId ? "Add goal" : "Assign performance goal"}
              </h3>
              <button
                type="button"
                aria-label="Close add goal modal"
                onClick={() => closeModalWithFocusRestore(setCreateGoalOpen)}
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle cursor-pointer focus-visible:outline-2 focus-visible:outline-black"
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
              {isManagerOrAdmin && scopedEmployees.length > 0 && (
                <div>
                  <label className="block text-[11px] font-bold text-text-secondary mb-1">
                    Assign to employee *
                  </label>
                  <select
                    aria-label="Assign to employee"
                    value={goalAssigneeId || effectiveEmpId}
                    onChange={(e) => setGoalAssigneeId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary cursor-pointer hover:border-black/30 transition-colors"
                  >
                    {scopedEmployees.map((emp: { id: string; full_name?: string | null; email: string }) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name || emp.email} {emp.id === userId ? "(You)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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
                  disabled={submitGoal.isPending || !goalTitle.trim()}
                  className="px-5 py-2 rounded-full bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold cursor-pointer disabled:opacity-60"
                >
                  Add goal
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
      <React.Suspense fallback={<div className="w-full min-h-[400px]" />}>
        <KpiContent />
      </React.Suspense>
    </AppShell>
  );
}
