"use client";

import * as React from "react";
import { FEATURES } from "@/lib/features";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoCard } from "@/components/bento/bento-card";
import { StatusPill } from "@/components/shared/status-pill";
import { EmptyState } from "@/components/shared/empty-state";
import { AnimatedProgressRing } from "@/features/attendance/components/animated-progress-ring";
import {
  useKpiData,
  useKpiMutations,
  KpiDefinitionRecord,
  KpiEmployeeOption,
} from "@/features/kpi/hooks/use-kpi";
import {
  KPI_SOURCE_METRICS,
  buildEmployeeKpiTrend,
  computeWeightedKpiScore,
  formatKpiValue,
  getKpiBandLabel,
  getKpiMetricMeta,
} from "@/lib/kpi/helpers";
import { KpiDirection, KpiPeriodType, KpiSourceMetric } from "@/types/database.types";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Target,
  TrendingUp,
  Award,
  Plus,
  Calculator,
  Lock,
  FileSpreadsheet,
  Users,
  SlidersHorizontal,
  Edit3,
  Trash2,
  Star,
  Calendar,
  X,
  CheckCircle2,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import { AutomaticKpiView } from "@/features/kpi/components/automatic-kpi-view";

type KpiTab = "auto" | "scorecard" | "team" | "governance";

function KpiWorkspaceContent() {
  const { userId, userRole } = useAppSession();
  const { data, isLoading } = useKpiData(Boolean(userId));
  const mutations = useKpiMutations();

  const isHrOrAdmin = userRole === "hr" || userRole === "admin";
  const isManagerOrAbove = userRole === "manager" || isHrOrAdmin;

  const [activeTab, setActiveTab] = React.useState<KpiTab>("auto");
  const [selectedPeriodId, setSelectedPeriodId] = React.useState<string>("");

  // Modals
  const [periodModalOpen, setPeriodModalOpen] = React.useState(false);
  const [defModalOpen, setDefModalOpen] = React.useState(false);
  const [editingDef, setEditingDef] = React.useState<KpiDefinitionRecord | null>(null);
  const [reviewTarget, setReviewTarget] = React.useState<{
    employeeId: string;
    employeeName: string;
    rating: string;
    comment: string;
  } | null>(null);
  const [closeConfirmOpen, setCloseConfirmOpen] = React.useState(false);

  // New Period form
  const [periodName, setPeriodName] = React.useState("");
  const [periodType, setPeriodType] = React.useState<KpiPeriodType>("monthly");
  const [periodStart, setPeriodStart] = React.useState(() => {
    const now = new Date();
    return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
  const [periodEnd, setPeriodEnd] = React.useState(() => {
    const now = new Date();
    const last = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0));
    return last.toISOString().slice(0, 10);
  });

  // Definition form
  const [defName, setDefName] = React.useState("");
  const [defDescription, setDefDescription] = React.useState("");
  const [defMetric, setDefMetric] = React.useState<KpiSourceMetric>("tasks_completed");
  const [defTarget, setDefTarget] = React.useState("5");
  const [defDirection, setDefDirection] = React.useState<KpiDirection>("higher_is_better");
  const [defWeight, setDefWeight] = React.useState("1");
  const [defRole, setDefRole] = React.useState<string>("");
  const [defDeptId, setDefDeptId] = React.useState<string>("");
  const [defActive, setDefActive] = React.useState(true);

  const periods = React.useMemo(() => data?.periods || [], [data?.periods]);
  const definitions = React.useMemo(() => data?.definitions || [], [data?.definitions]);
  const scores = React.useMemo(() => data?.scores || [], [data?.scores]);
  const reviews = React.useMemo(() => data?.reviews || [], [data?.reviews]);
  const employees = React.useMemo(() => data?.employees || [], [data?.employees]);
  const departments = React.useMemo(() => data?.departments || [], [data?.departments]);

  const defById = React.useMemo(() => {
    const m = new Map<string, KpiDefinitionRecord>();
    definitions.forEach((d) => m.set(d.id, d));
    return m;
  }, [definitions]);

  const empById = React.useMemo(() => {
    const m = new Map<string, KpiEmployeeOption>();
    employees.forEach((e) => m.set(e.id, e));
    return m;
  }, [employees]);

  const deptById = React.useMemo(() => {
    const m = new Map<string, string>();
    departments.forEach((d) => m.set(d.id, d.name));
    return m;
  }, [departments]);

  // Deep link `?period=<uuid>` support and default selection
  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const paramPeriod = new URLSearchParams(window.location.search).get("period");
      if (paramPeriod && periods.some((p) => p.id === paramPeriod)) {
        setSelectedPeriodId(paramPeriod);
        return;
      }
    }
    if (periods.length === 0) return;
    setSelectedPeriodId((prev) => {
      if (prev && periods.some((p) => p.id === prev)) return prev;
      return periods[0].id;
    });
  }, [periods]);

  const selectedPeriod = React.useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) || null,
    [periods, selectedPeriodId]
  );

  // All scores enriched with definition weight
  const scoresWithWeights = React.useMemo(
    () =>
      scores.map((s) => ({
        ...s,
        weight: defById.get(s.kpi_definition_id)?.weight ?? 1,
      })),
    [scores, defById]
  );

  // My Scorecard rows for selected period
  const myPeriodScores = React.useMemo(() => {
    if (!userId || !selectedPeriod) return [];
    return scores
      .filter((s) => s.period_id === selectedPeriod.id && s.employee_id === userId)
      .map((s) => ({
        ...s,
        def: defById.get(s.kpi_definition_id) || null,
      }))
      .sort((a, b) => (a.def?.name || "").localeCompare(b.def?.name || ""));
  }, [scores, userId, selectedPeriod, defById]);

  const myWeightedScore = React.useMemo(() => {
    if (myPeriodScores.length === 0) return null;
    return computeWeightedKpiScore(
      myPeriodScores.map((s) => ({
        score: s.score,
        weight: s.def?.weight ?? 1,
      }))
    );
  }, [myPeriodScores]);

  const myReview = React.useMemo(() => {
    if (!userId || !selectedPeriod) return null;
    return (
      reviews.find(
        (r) => r.period_id === selectedPeriod.id && r.employee_id === userId
      ) || null
    );
  }, [reviews, userId, selectedPeriod]);

  const myTrend = React.useMemo(() => {
    if (!userId) return [];
    return buildEmployeeKpiTrend(periods, scoresWithWeights, userId);
  }, [periods, scoresWithWeights, userId]);

  // Team rows (Manager sees direct reports; HR/Admin sees all active org employees)
  const teamSummaries = React.useMemo(() => {
    if (!selectedPeriod) return [];
    const candidateIds = new Set<string>();

    for (const emp of employees) {
      if (userRole === "manager") {
        if (emp.manager_id === userId) candidateIds.add(emp.id);
      } else {
        candidateIds.add(emp.id);
      }
    }
    for (const s of scores) {
      if (s.period_id === selectedPeriod.id && (s.employee_id !== userId || isHrOrAdmin)) {
        candidateIds.add(s.employee_id);
      }
    }

    return Array.from(candidateIds)
      .map((empId) => {
        const emp = empById.get(empId);
        const empScores = scores.filter(
          (s) => s.period_id === selectedPeriod.id && s.employee_id === empId
        );
        const scoredCount = empScores.filter(
          (s) => s.score !== null && Number.isFinite(s.score)
        ).length;
        const weighted = computeWeightedKpiScore(
          empScores.map((s) => ({
            score: s.score,
            weight: defById.get(s.kpi_definition_id)?.weight ?? 1,
          }))
        );
        const review = reviews.find(
          (r) => r.period_id === selectedPeriod.id && r.employee_id === empId
        );
        return {
          employeeId: empId,
          fullName: emp?.full_name || (empId === userId ? "You" : "Employee"),
          email: emp?.email || "",
          metricCount: empScores.length,
          scoredCount,
          weightedScore: weighted,
          review: review || null,
          isSelf: empId === userId,
        };
      })
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [selectedPeriod, employees, scores, reviews, userRole, userId, isHrOrAdmin, empById, defById]);

  const openCreateDefinition = () => {
    setEditingDef(null);
    const meta = getKpiMetricMeta("tasks_completed");
    setDefName("");
    setDefDescription("");
    setDefMetric("tasks_completed");
    setDefTarget(String(meta.defaultTarget));
    setDefDirection(meta.defaultDirection);
    setDefWeight("1");
    setDefRole("");
    setDefDeptId("");
    setDefActive(true);
    setDefModalOpen(true);
  };

  const openEditDefinition = (def: KpiDefinitionRecord) => {
    setEditingDef(def);
    setDefName(def.name);
    setDefDescription(def.description || "");
    setDefMetric(def.source_metric);
    setDefTarget(String(def.target_value));
    setDefDirection(def.direction);
    setDefWeight(String(def.weight));
    setDefRole(def.applies_to_role || "");
    setDefDeptId(def.applies_to_department_id || "");
    setDefActive(def.is_active);
    setDefModalOpen(true);
  };

  const handleMetricChange = (nextMetric: KpiSourceMetric) => {
    setDefMetric(nextMetric);
    if (!editingDef) {
      const meta = getKpiMetricMeta(nextMetric);
      setDefTarget(String(meta.defaultTarget));
      setDefDirection(meta.defaultDirection);
    }
  };

  const handleSaveDefinition = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await mutations.upsertDefinition.mutateAsync({
        definitionId: editingDef?.id || null,
        name: defName,
        description: defDescription || null,
        sourceMetric: defMetric,
        targetValue: Number(defTarget),
        direction: defDirection,
        weight: Number(defWeight),
        appliesToRole: defRole
          ? (defRole as "employee" | "manager" | "hr" | "admin")
          : null,
        appliesToDepartmentId: defDeptId || null,
        isActive: defActive,
      });
      setDefModalOpen(false);
    } catch {
      // Handled via mutation onError toast
    }
  };

  const handleCreatePeriod = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res: any = await mutations.createPeriod.mutateAsync({
        name: periodName,
        periodType,
        startDate: periodStart,
        endDate: periodEnd,
      });
      if (res?.period?.id) {
        setSelectedPeriodId(res.period.id);
      }
      setPeriodName("");
      setPeriodModalOpen(false);
    } catch {
      // Handled via mutation onError toast
    }
  };

  const handleComputeScores = async () => {
    if (!selectedPeriod) return;
    try {
      await mutations.computeScores.mutateAsync(selectedPeriod.id);
    } catch {
      // Handled via toast
    }
  };

  const handleClosePeriod = async () => {
    if (!selectedPeriod) return;
    try {
      await mutations.closePeriod.mutateAsync(selectedPeriod.id);
      setCloseConfirmOpen(false);
    } catch {
      // Handled via toast
    }
  };

  const handleSaveReview = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPeriod || !reviewTarget) return;
    try {
      await mutations.submitReview.mutateAsync({
        periodId: selectedPeriod.id,
        employeeId: reviewTarget.employeeId,
        rating: Number(reviewTarget.rating),
        comment: reviewTarget.comment,
      });
      setReviewTarget(null);
    } catch {
      // Handled via toast
    }
  };

  const handleExportExcel = () => {
    toast.success("Preparing KPI scorecard Excel (.xlsx)...", {
      description: "Formula injection sanitization (CWE-1236) active on all text cells.",
    });
    const url = selectedPeriod
      ? `/api/kpi/export?periodId=${encodeURIComponent(selectedPeriod.id)}`
      : "/api/kpi/export";
    window.open(url, "_blank");
  };

  const myBand = getKpiBandLabel(myWeightedScore);
  const myScoreRingColor =
    myBand.tone === "success"
      ? "var(--status-success-dot)"
      : myBand.tone === "warning"
      ? "var(--status-warning-dot)"
      : myBand.tone === "danger"
      ? "var(--status-danger-dot)"
      : "var(--brand-purple)";

  return (
    <div className="space-y-6">
      {/* Header & Period Controls */}
      <section className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 pt-1">
        <div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-purple-light text-brand-purple text-xs font-bold mb-2">
            <Target className="w-3.5 h-3.5" />
            Performance & KPIs
          </div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
            KPI Scorecards & Performance
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Period-snapshotted scorecards computed from attendance, leave, and task execution.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {periods.length > 0 && (
            <div className="flex items-center gap-2 bg-card border border-border-light rounded-2xl px-3 py-2 shadow-sm">
              <Calendar className="w-4 h-4 text-brand-purple shrink-0" />
              <label htmlFor="kpi-period-select" className="sr-only">
                KPI Period
              </label>
              <select
                id="kpi-period-select"
                aria-label="KPI Period"
                value={selectedPeriodId}
                onChange={(e) => setSelectedPeriodId(e.target.value)}
                className="bg-transparent text-xs font-bold text-text-primary focus:outline-none cursor-pointer"
              >
                {periods.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} ({p.period_type})
                  </option>
                ))}
              </select>
              {selectedPeriod && <StatusPill status={selectedPeriod.status} />}
            </div>
          )}

          {isHrOrAdmin && (
            <>
              <button
                type="button"
                onClick={() => setPeriodModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-brand-purple" />
                New Period
              </button>

              {selectedPeriod && (
                <>
                  <button
                    type="button"
                    disabled={
                      selectedPeriod.status === "closed" ||
                      mutations.computeScores.isPending
                    }
                    onClick={handleComputeScores}
                    className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-brand-purple hover:bg-brand-purple-hover disabled:opacity-50 text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
                  >
                    <Calculator className="w-3.5 h-3.5" />
                    {mutations.computeScores.isPending ? "Computing..." : "Compute Scores"}
                  </button>

                  {selectedPeriod.status === "open" && (
                    <button
                      type="button"
                      onClick={() => setCloseConfirmOpen(true)}
                      className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
                    >
                      <Lock className="w-3.5 h-3.5" />
                      Close Period
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleExportExcel}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-colors cursor-pointer"
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5 text-status-success-dot" />
                    Export Excel (.xlsx)
                  </button>
                </>
              )}
            </>
          )}
        </div>
      </section>

      {/* Role Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex items-center p-1 rounded-2xl bg-card border border-border-light shadow-sm"
          role="tablist"
          aria-label="KPI Views"
        >
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "auto"}
            onClick={() => setActiveTab("auto")}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
              activeTab === "auto"
                ? "bg-brand-purple text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Sparkles className="w-3.5 h-3.5" />
            Automatic KPI
          </button>

          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "scorecard"}
            onClick={() => setActiveTab("scorecard")}
            className={cn(
              "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
              activeTab === "scorecard"
                ? "bg-brand-purple text-white shadow-sm"
                : "text-text-secondary hover:text-text-primary"
            )}
          >
            <Award className="w-3.5 h-3.5" />
            Official Periods (Manual)
          </button>

          {isManagerOrAbove && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "team"}
              onClick={() => setActiveTab("team")}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                activeTab === "team"
                  ? "bg-brand-purple text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              <Users className="w-3.5 h-3.5" />
              Team KPIs
            </button>
          )}

          {isHrOrAdmin && (
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "governance"}
              onClick={() => setActiveTab("governance")}
              className={cn(
                "inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer",
                activeTab === "governance"
                  ? "bg-brand-purple text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary"
              )}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              KPI Definitions ({definitions.length})
            </button>
          )}
        </div>

        {selectedPeriod && (
          <div className="text-xs text-text-secondary font-medium flex items-center gap-2">
            <span>
              Window: <strong className="text-text-primary">{selectedPeriod.start_date}</strong> to{" "}
              <strong className="text-text-primary">{selectedPeriod.end_date}</strong>
            </span>
            {selectedPeriod.status === "closed" && (
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-brand-purple-light text-brand-purple text-[11px] font-bold">
                <Lock className="w-3 h-3" />
                Immutable Snapshot
              </span>
            )}
          </div>
        )}
      </div>

      {/* TAB 0: AUTOMATIC REAL-TIME KPI */}
      {activeTab === "auto" && (
        <AutomaticKpiView
          currentUserId={userId || undefined}
          currentUserRole={userRole || undefined}
          employees={employees}
          onPromoteToPeriod={(range) => {
            setPeriodName(range.name);
            setPeriodStart(range.startDate);
            setPeriodEnd(range.endDate);
            setPeriodModalOpen(true);
          }}
        />
      )}

      {/* TAB 1: EMPLOYEE SCORECARD */}
      {activeTab === "scorecard" && (
        <div className="space-y-6">
          {!selectedPeriod ? (
            <EmptyState
              icon={<Target className="w-6 h-6" />}
              title={isLoading ? "Loading KPI periods..." : "No KPI periods configured yet"}
              description={
                isHrOrAdmin
                  ? "Create a KPI definition and an open KPI period to compute scorecards."
                  : "HR or an administrator has not opened a KPI evaluation period yet."
              }
              action={
                isHrOrAdmin ? (
                  <button
                    type="button"
                    onClick={() => setPeriodModalOpen(true)}
                    className="px-4 py-2 rounded-xl bg-brand-purple text-white text-xs font-bold cursor-pointer"
                  >
                    Create First Period
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              {/* Top Row: Overall Weighted Ring + Multi-Period Trend */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
                <BentoCard
                  title="Overall Weighted KPI Score"
                  subtitle={selectedPeriod.name}
                  className="lg:col-span-5"
                  badge={
                    <span
                      className={cn(
                        "px-2.5 py-0.5 rounded-full text-[11px] font-bold",
                        myBand.tone === "success"
                          ? "bg-status-success-bg text-status-success-text"
                          : myBand.tone === "warning"
                          ? "bg-status-warning-bg text-status-warning-text"
                          : myBand.tone === "danger"
                          ? "bg-status-danger-bg text-status-danger-text"
                          : "bg-card-subtle text-text-secondary"
                      )}
                    >
                      {myBand.label}
                    </span>
                  }
                >
                  <div className="flex flex-col sm:flex-row items-center gap-6 py-2">
                    {(() => {
                      const scoredCount = myPeriodScores.filter(
                        (s) => s.score !== null && Number.isFinite(s.score)
                      ).length;
                      return (
                        <AnimatedProgressRing
                          percentage={myWeightedScore ?? 0}
                          size={132}
                          strokeWidth={11}
                          color={myScoreRingColor}
                          title={myWeightedScore === null ? "No Data" : "Weighted Score"}
                          caption={
                            scoredCount === myPeriodScores.length
                              ? `${scoredCount} active KPI${scoredCount === 1 ? "" : "s"}`
                              : `${scoredCount} / ${myPeriodScores.length} scored`
                          }
                        />
                      );
                    })()}

                    <div className="flex-1 w-full space-y-3">
                      <div className="p-3.5 rounded-2xl bg-card-subtle border border-border-light">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-bold text-text-secondary uppercase tracking-wider">
                            Manager Review
                          </span>
                          {myReview ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-status-warning-bg text-status-warning-text font-extrabold">
                              <Star className="w-3 h-3 fill-current" />
                              {myReview.rating.toFixed(1)} / 5.0
                            </span>
                          ) : (
                            <span className="text-text-tertiary font-semibold">Pending</span>
                          )}
                        </div>
                        <p className="text-xs text-text-primary mt-2 leading-relaxed">
                          {myReview
                            ? myReview.comment
                            : "No manager performance review has been posted for this period yet."}
                        </p>
                      </div>
                    </div>
                  </div>
                </BentoCard>

                <BentoCard
                  title="Period Score Trend"
                  subtitle="Historical weighted KPI trajectory across computed periods"
                  className="lg:col-span-7"
                  action={<TrendingUp className="w-4 h-4 text-brand-purple" />}
                >
                  {myTrend.length === 0 ? (
                    <div className="py-10 text-center text-xs text-text-tertiary">
                      Compute KPI scores across periods to plot your historical performance trend.
                    </div>
                  ) : (
                    <div className="space-y-3 pt-1">
                      {myTrend.map((point) => {
                        const isCurrent = point.periodId === selectedPeriod.id;
                        return (
                          <button
                            key={point.periodId}
                            type="button"
                            onClick={() => setSelectedPeriodId(point.periodId)}
                            className={cn(
                              "w-full text-left p-2.5 rounded-2xl transition-colors cursor-pointer",
                              isCurrent
                                ? "bg-brand-purple-light/40 border border-brand-purple/30"
                                : "hover:bg-card-subtle border border-transparent"
                            )}
                          >
                            <div className="flex items-center justify-between text-xs mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="font-bold text-text-primary truncate">
                                  {point.periodName}
                                </span>
                                <StatusPill status={point.status} className="scale-90 origin-left" />
                              </div>
                              <span className="font-extrabold text-brand-purple tabular-nums">
                                {point.overallScore.toFixed(1)}%
                              </span>
                            </div>
                            <div className="w-full h-2.5 rounded-full bg-card-subtle overflow-hidden">
                              <div
                                className="h-full rounded-full bg-brand-purple transition-all duration-500"
                                style={{ width: `${Math.min(100, Math.max(0, point.overallScore))}%` }}
                              />
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </BentoCard>
              </div>

              {/* Per-KPI Breakdown Grid */}
              {myPeriodScores.length === 0 ? (
                <EmptyState
                  icon={<Calculator className="w-6 h-6" />}
                  title="No scores computed for this period yet"
                  description={
                    isHrOrAdmin
                      ? "Click 'Compute Scores' above to generate snapshots from attendance, leave, and task data."
                      : "Your HR team has not published computed scores for this period yet."
                  }
                />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {myPeriodScores.map((item) => {
                    const meta = getKpiMetricMeta(item.def?.source_metric || "");
                    const direction = item.def?.direction || meta.defaultDirection;
                    const weight = item.def?.weight ?? 1;
                    const isScored = item.score !== null && Number.isFinite(item.score);
                    const numericScore = isScored ? Number(item.score) : 0;
                    const barColor = !isScored
                      ? "bg-border-light"
                      : numericScore >= 85
                      ? "bg-status-success-dot"
                      : numericScore >= 65
                      ? "bg-status-warning-dot"
                      : "bg-status-danger-dot";

                    return (
                      <BentoCard
                        key={item.id}
                        title={item.def?.name || meta.label}
                        subtitle={item.def?.description || meta.description}
                        badge={
                          <span className="px-2 py-0.5 rounded-full bg-brand-purple-light text-brand-purple text-[10px] font-bold">
                            w={weight}
                          </span>
                        }
                      >
                        <div className="space-y-3">
                          <div className="flex items-end justify-between">
                            <div>
                              <span className="text-[11px] font-semibold text-text-tertiary block">
                                Actual vs Target
                              </span>
                              <span className="text-lg font-extrabold text-text-primary tabular-nums">
                                {formatKpiValue(item.actual_value, meta.unit)}
                              </span>
                              <span className="text-xs text-text-secondary ml-1.5">
                                / {formatKpiValue(item.target_value, meta.unit)}
                              </span>
                            </div>
                            {isScored ? (
                              <span className="text-2xl font-black text-brand-purple tabular-nums">
                                {Math.round(numericScore)}%
                              </span>
                            ) : (
                              <span className="px-2.5 py-1 rounded-full bg-card-subtle text-text-tertiary text-xs font-bold">
                                No data
                              </span>
                            )}
                          </div>

                          <div className="w-full h-2.5 rounded-full bg-card-subtle overflow-hidden">
                            <div
                              className={cn("h-full rounded-full transition-all duration-500", barColor)}
                              style={{ width: isScored ? `${Math.min(100, Math.max(0, numericScore))}%` : "0%" }}
                            />
                          </div>

                          <div className="flex items-center justify-between text-[11px] text-text-tertiary">
                            <span>{meta.category}</span>
                            <span>
                              {direction === "higher_is_better"
                                ? "Higher is better"
                                : "Lower is better"}
                            </span>
                          </div>
                        </div>
                      </BentoCard>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* TAB 2: MANAGER / HR TEAM TABLE */}
      {activeTab === "team" && isManagerOrAbove && (
        <BentoCard
          title="Team KPI Performance & Reviews"
          subtitle={
            selectedPeriod
              ? `Snapshot & review matrix for ${selectedPeriod.name}`
              : "Select a KPI period"
          }
        >
          {!selectedPeriod || teamSummaries.length === 0 ? (
            <EmptyState
              icon={<Users className="w-6 h-6" />}
              title="No team members or KPI snapshots available"
              description="Ensure direct reports are assigned and HR has computed KPI scores for this period."
              className="border-none shadow-none"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-card-subtle text-text-secondary font-bold text-xs border-b border-border-light">
                  <tr>
                    <th className="py-3 px-4 rounded-tl-xl">Employee</th>
                    <th className="py-3 px-4">Metrics</th>
                    <th className="py-3 px-4">Weighted Score</th>
                    <th className="py-3 px-4">Manager Review</th>
                    <th className="py-3 px-4 text-right rounded-tr-xl">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {teamSummaries.map((row) => (
                    <tr key={row.employeeId} className="hover:bg-card-subtle/40 transition-colors">
                      <td className="py-3.5 px-4">
                        <div className="font-bold text-text-primary">{row.fullName}</div>
                        <div className="text-xs text-text-tertiary">{row.email}</div>
                      </td>
                      <td className="py-3.5 px-4 text-xs font-semibold text-text-secondary">
                        {row.metricCount === 0
                          ? "0 KPIs"
                          : `${row.scoredCount} / ${row.metricCount} scored`}
                      </td>
                      <td className="py-3.5 px-4">
                        {row.weightedScore !== null ? (
                          <div className="flex items-center gap-2.5 min-w-[140px]">
                            <div className="flex-1 h-2 rounded-full bg-card-subtle overflow-hidden">
                              <div
                                className="h-full rounded-full bg-brand-purple"
                                style={{ width: `${row.weightedScore}%` }}
                              />
                            </div>
                            <span className="text-xs font-extrabold text-text-primary tabular-nums">
                              {row.weightedScore.toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-text-tertiary">No data</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 max-w-xs">
                        {row.review ? (
                          <div>
                            <span className="inline-flex items-center gap-1 text-xs font-extrabold text-status-warning-text">
                              <Star className="w-3 h-3 fill-current" />
                              {row.review.rating.toFixed(1)} / 5
                            </span>
                            <p className="text-xs text-text-secondary truncate mt-0.5">
                              {row.review.comment}
                            </p>
                          </div>
                        ) : (
                          <span className="text-xs text-text-tertiary">No review yet</span>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        {row.isSelf ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-card-subtle text-text-tertiary text-[11px] font-bold">
                            <ShieldAlert className="w-3 h-3" />
                            Self-review blocked
                          </span>
                        ) : (
                          <button
                            type="button"
                            disabled={selectedPeriod.status === "closed"}
                            onClick={() =>
                              setReviewTarget({
                                employeeId: row.employeeId,
                                employeeName: row.fullName,
                                rating: row.review ? String(row.review.rating) : "4.5",
                                comment: row.review?.comment || "",
                              })
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-purple-light hover:bg-brand-purple text-brand-purple hover:text-white disabled:opacity-50 text-xs font-bold transition-colors cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            {row.review ? "Edit Review" : "Submit Review"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </BentoCard>
      )}

      {/* TAB 3: HR / ADMIN DEFINITIONS EDITOR */}
      {activeTab === "governance" && isHrOrAdmin && (
        <BentoCard
          title="KPI Metric Definitions & Weights"
          subtitle="Metrics pull deterministically from attendance_days, leave_requests, and tasks."
          action={
            <button
              type="button"
              onClick={openCreateDefinition}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              Add KPI Definition
            </button>
          }
        >
          {definitions.length === 0 ? (
            <EmptyState
              icon={<SlidersHorizontal className="w-6 h-6" />}
              title="No KPI definitions configured"
              description="Define weighted KPIs mapped to attendance, leave, or task metrics."
              className="border-none shadow-none"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-card-subtle text-text-secondary font-bold text-xs border-b border-border-light">
                  <tr>
                    <th className="py-3 px-4 rounded-tl-xl">Name</th>
                    <th className="py-3 px-4">Source Metric</th>
                    <th className="py-3 px-4">Target & Direction</th>
                    <th className="py-3 px-4">Weight</th>
                    <th className="py-3 px-4">Scope</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right rounded-tr-xl">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {definitions.map((def) => {
                    const meta = getKpiMetricMeta(def.source_metric);
                    return (
                      <tr key={def.id} className="hover:bg-card-subtle/40 transition-colors">
                        <td className="py-3.5 px-4">
                          <div className="font-bold text-text-primary">{def.name}</div>
                          {def.description && (
                            <div className="text-xs text-text-tertiary line-clamp-1">
                              {def.description}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-mono text-text-secondary">
                          {meta.label}
                        </td>
                        <td className="py-3.5 px-4 text-xs">
                          <span className="font-bold text-text-primary">
                            {formatKpiValue(def.target_value, meta.unit)}
                          </span>{" "}
                          <span className="text-text-tertiary">
                            ({def.direction === "higher_is_better" ? "↑ Higher" : "↓ Lower"})
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-xs font-extrabold text-brand-purple">
                          {def.weight}x
                        </td>
                        <td className="py-3.5 px-4 text-xs text-text-secondary">
                          {def.applies_to_role ? `Role: ${def.applies_to_role}` : "All roles"}
                          {def.applies_to_department_id
                            ? ` • ${deptById.get(def.applies_to_department_id) || "Dept"}`
                            : ""}
                        </td>
                        <td className="py-3.5 px-4">
                          <StatusPill status={def.is_active ? "active" : "cancelled"} label={def.is_active ? "Active" : "Inactive"} />
                        </td>
                        <td className="py-3.5 px-4 text-right space-x-2 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => openEditDefinition(def)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-card-subtle hover:bg-brand-purple-light text-xs font-bold text-text-primary hover:text-brand-purple cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Edit
                          </button>
                          <button
                            type="button"
                            onClick={() => mutations.deleteDefinition.mutate(def.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-status-danger-bg text-status-danger-text hover:opacity-80 text-xs font-bold cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </BentoCard>
      )}

      {/* MODAL: NEW KPI PERIOD */}
      {periodModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Create KPI Period"
            className="w-full max-w-md bg-card rounded-3xl border border-border-light shadow-shell p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-text-primary">New KPI Period</h2>
              <button
                type="button"
                onClick={() => setPeriodModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-card-subtle text-text-tertiary cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleCreatePeriod} className="space-y-4">
              <div>
                <label htmlFor="period-name" className="block text-xs font-bold text-text-secondary mb-1">
                  Period Name
                </label>
                <input
                  id="period-name"
                  required
                  value={periodName}
                  onChange={(e) => setPeriodName(e.target.value)}
                  placeholder="e.g., Q4 2026 Performance"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                />
              </div>
              <div>
                <label htmlFor="period-type" className="block text-xs font-bold text-text-secondary mb-1">
                  Period Cadence
                </label>
                <select
                  id="period-type"
                  value={periodType}
                  onChange={(e) => setPeriodType(e.target.value as KpiPeriodType)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                >
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="period-start" className="block text-xs font-bold text-text-secondary mb-1">
                    Start Date
                  </label>
                  <input
                    id="period-start"
                    type="date"
                    required
                    value={periodStart}
                    onChange={(e) => setPeriodStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  />
                </div>
                <div>
                  <label htmlFor="period-end" className="block text-xs font-bold text-text-secondary mb-1">
                    End Date
                  </label>
                  <input
                    id="period-end"
                    type="date"
                    required
                    value={periodEnd}
                    onChange={(e) => setPeriodEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPeriodModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutations.createPeriod.isPending}
                  className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer"
                >
                  {mutations.createPeriod.isPending ? "Creating..." : "Create Period"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: UPSERT KPI DEFINITION */}
      {defModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={editingDef ? "Edit KPI Definition" : "Add KPI Definition"}
            className="w-full max-w-lg bg-card rounded-3xl border border-border-light shadow-shell p-6 space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-text-primary">
                {editingDef ? "Edit KPI Definition" : "Add KPI Definition"}
              </h2>
              <button
                type="button"
                onClick={() => setDefModalOpen(false)}
                className="p-1.5 rounded-full hover:bg-card-subtle text-text-tertiary cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveDefinition} className="space-y-4">
              <div>
                <label htmlFor="kpi-def-name" className="block text-xs font-bold text-text-secondary mb-1">
                  KPI Name
                </label>
                <input
                  id="kpi-def-name"
                  required
                  value={defName}
                  onChange={(e) => setDefName(e.target.value)}
                  placeholder="e.g., Monthly Tasks Completed"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                />
              </div>

              <div>
                <label htmlFor="kpi-def-desc" className="block text-xs font-bold text-text-secondary mb-1">
                  Description (Optional)
                </label>
                <textarea
                  id="kpi-def-desc"
                  rows={2}
                  value={defDescription}
                  onChange={(e) => setDefDescription(e.target.value)}
                  placeholder="How this KPI impacts team goals..."
                  className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="kpi-def-metric" className="block text-xs font-bold text-text-secondary mb-1">
                    Source Metric
                  </label>
                  <select
                    id="kpi-def-metric"
                    value={defMetric}
                    onChange={(e) => handleMetricChange(e.target.value as KpiSourceMetric)}
                    className="w-full px-3 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  >
                    {KPI_SOURCE_METRICS.map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.label} ({m.unit})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label htmlFor="kpi-def-direction" className="block text-xs font-bold text-text-secondary mb-1">
                    Scoring Direction
                  </label>
                  <select
                    id="kpi-def-direction"
                    value={defDirection}
                    onChange={(e) => setDefDirection(e.target.value as KpiDirection)}
                    className="w-full px-3 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  >
                    <option value="higher_is_better">Higher is better</option>
                    <option value="lower_is_better">Lower is better</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="kpi-def-target" className="block text-xs font-bold text-text-secondary mb-1">
                    Target Value
                  </label>
                  <input
                    id="kpi-def-target"
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={defTarget}
                    onChange={(e) => setDefTarget(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  />
                </div>
                <div>
                  <label htmlFor="kpi-def-weight" className="block text-xs font-bold text-text-secondary mb-1">
                    Weight (0.01 - 1000)
                  </label>
                  <input
                    id="kpi-def-weight"
                    type="number"
                    step="0.01"
                    min="0.01"
                    max="1000"
                    required
                    value={defWeight}
                    onChange={(e) => setDefWeight(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="kpi-def-role" className="block text-xs font-bold text-text-secondary mb-1">
                    Applies to Role
                  </label>
                  <select
                    id="kpi-def-role"
                    value={defRole}
                    onChange={(e) => setDefRole(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  >
                    <option value="">All roles</option>
                    <option value="employee">Employee</option>
                    <option value="manager">Manager</option>
                    <option value="hr">HR</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="kpi-def-dept" className="block text-xs font-bold text-text-secondary mb-1">
                    Applies to Department
                  </label>
                  <select
                    id="kpi-def-dept"
                    value={defDeptId}
                    onChange={(e) => setDefDeptId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                  >
                    <option value="">All departments</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="inline-flex items-center gap-2 text-xs font-bold text-text-primary cursor-pointer">
                <input
                  type="checkbox"
                  checked={defActive}
                  onChange={(e) => setDefActive(e.target.checked)}
                  className="rounded border-border-light text-brand-purple"
                />
                Definition active for future KPI calculations
              </label>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setDefModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutations.upsertDefinition.isPending}
                  className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer"
                >
                  {mutations.upsertDefinition.isPending ? "Saving..." : "Save KPI Definition"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: SUBMIT KPI REVIEW */}
      {reviewTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Submit KPI Review"
            className="w-full max-w-md bg-card rounded-3xl border border-border-light shadow-shell p-6 space-y-4"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-extrabold text-text-primary">
                Review: {reviewTarget.employeeName}
              </h2>
              <button
                type="button"
                onClick={() => setReviewTarget(null)}
                className="p-1.5 rounded-full hover:bg-card-subtle text-text-tertiary cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSaveReview} className="space-y-4">
              <div>
                <label htmlFor="kpi-review-rating" className="block text-xs font-bold text-text-secondary mb-1">
                  Manager Rating (1.0 - 5.0)
                </label>
                <input
                  id="kpi-review-rating"
                  type="number"
                  step="0.1"
                  min="1"
                  max="5"
                  required
                  value={reviewTarget.rating}
                  onChange={(e) =>
                    setReviewTarget({ ...reviewTarget, rating: e.target.value })
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary"
                />
              </div>
              <div>
                <label htmlFor="kpi-review-comment" className="block text-xs font-bold text-text-secondary mb-1">
                  Manager Feedback
                </label>
                <textarea
                  id="kpi-review-comment"
                  required
                  rows={3}
                  value={reviewTarget.comment}
                  onChange={(e) =>
                    setReviewTarget({ ...reviewTarget, comment: e.target.value })
                  }
                  placeholder="Provide specific coaching and period feedback..."
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setReviewTarget(null)}
                  className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={mutations.submitReview.isPending}
                  className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer"
                >
                  {mutations.submitReview.isPending ? "Saving..." : "Submit Review"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: CONFIRM CLOSE PERIOD */}
      {closeConfirmOpen && selectedPeriod && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Close KPI Period"
            className="w-full max-w-md bg-card rounded-3xl border border-border-light shadow-shell p-6 space-y-4"
          >
            <div className="flex items-center gap-2 text-brand-purple">
              <CheckCircle2 className="w-5 h-5" />
              <h2 className="text-lg font-extrabold text-text-primary">
                Close KPI Period Permanently?
              </h2>
            </div>
            <p className="text-xs text-text-secondary leading-relaxed">
              Closing <strong>{selectedPeriod.name}</strong> freezes all KPI scores and manager
              reviews for this period. Closed periods are database-immutable and cannot be
              recalculated or edited.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setCloseConfirmOpen(false)}
                className="px-4 py-2 rounded-xl bg-card-subtle text-xs font-bold text-text-secondary cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={mutations.closePeriod.isPending}
                onClick={handleClosePeriod}
                className="px-4 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold cursor-pointer"
              >
                {mutations.closePeriod.isPending ? "Closing..." : "Confirm Close Period"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function KpiPage() {
  if (!FEATURES.KPI) {
    if (typeof window !== "undefined") {
      window.location.href = "/dashboard";
    }
    return null;
  }
  return (
    <AppShell>
      <KpiWorkspaceContent />
    </AppShell>
  );
}

