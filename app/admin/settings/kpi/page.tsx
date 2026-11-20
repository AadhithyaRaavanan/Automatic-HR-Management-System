"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { KPI_CONFIG } from "@/lib/kpi/config";
import { toast } from "sonner";
import {
  ArrowLeft,
  Save,
  CheckCircle2,
  AlertTriangle,
  History,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

function getFirstDayOfNextMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-based
  const nextMonth = month === 11 ? 0 : month + 1;
  const nextYear = month === 11 ? year + 1 : year;
  return `${nextYear}-${String(nextMonth + 1).padStart(2, "0")}-01`;
}

type WeightsType = {
  on_time_check_in_rate: number;
  days_worked_vs_expected: number;
  worked_hours_vs_target: number;
  tasks_completed_vs_assigned: number;
  task_on_time_rate: number;
};

const PRESETS: Record<"balanced" | "attendance" | "delivery", { label: string; weights: WeightsType }> = {
  balanced: {
    label: "Balanced",
    weights: {
      on_time_check_in_rate: 20,
      days_worked_vs_expected: 20,
      worked_hours_vs_target: 25,
      tasks_completed_vs_assigned: 20,
      task_on_time_rate: 15,
    },
  },
  attendance: {
    label: "Attendance first",
    weights: {
      on_time_check_in_rate: 25,
      days_worked_vs_expected: 25,
      worked_hours_vs_target: 30,
      tasks_completed_vs_assigned: 10,
      task_on_time_rate: 10,
    },
  },
  delivery: {
    label: "Delivery first",
    weights: {
      on_time_check_in_rate: 10,
      days_worked_vs_expected: 10,
      worked_hours_vs_target: 15,
      tasks_completed_vs_assigned: 35,
      task_on_time_rate: 30,
    },
  },
};

export default function AdminKpiSettingsPage() {
  const { userRole, isLoaded } = useAppSession();
  const isAdminOrHr = userRole === "admin" || userRole === "hr";

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [activeConfig, setActiveConfig] = React.useState<any>(KPI_CONFIG);
  const [versions, setVersions] = React.useState<any[]>([]);
  const [effectiveFrom, setEffectiveFrom] = React.useState(getFirstDayOfNextMonth);
  const [reason, setReason] = React.useState("");
  const [reasonTouched, setReasonTouched] = React.useState(false);

  // Number inputs for weights (0..100)
  const [weights, setWeights] = React.useState<WeightsType>(PRESETS.balanced.weights);

  // Employee type tabs for "What good looks like"
  const [selectedTypeTab, setSelectedTypeTab] = React.useState<"full_time" | "part_time" | "intern" | "contract">("full_time");

  // Editable per-type targets
  const [targetsByType, setTargetsByType] = React.useState({
    full_time: { onTime: 95, daysWorked: 100, hours: 100, taskCompletion: 90, taskOnTime: 90, hoursPerDay: 8 },
    part_time: { onTime: 90, daysWorked: 100, hours: 100, taskCompletion: 85, taskOnTime: 85, hoursPerDay: 4 },
    intern: { onTime: 90, daysWorked: 100, hours: 100, taskCompletion: 80, taskOnTime: 80, hoursPerDay: 8 },
    contract: { onTime: 90, daysWorked: 100, hours: 100, taskCompletion: 80, taskOnTime: 80, hoursPerDay: 8 },
  });

  const loadSettings = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch("/api/kpi/settings");
      if (!res.ok) throw new Error("Failed to load settings");
      const data = await res.json();
      if (data.activeConfig) {
        setActiveConfig(data.activeConfig);
        const w = data.activeConfig.weights || KPI_CONFIG.weights;
        setWeights({
          on_time_check_in_rate: Math.round((w.on_time_check_in_rate ?? 0.2) * 100),
          days_worked_vs_expected: Math.round((w.days_worked_vs_expected ?? 0.2) * 100),
          worked_hours_vs_target: Math.round((w.worked_hours_vs_target ?? 0.25) * 100),
          tasks_completed_vs_assigned: Math.round((w.tasks_completed_vs_assigned ?? 0.2) * 100),
          task_on_time_rate: Math.round((w.task_on_time_rate ?? 0.15) * 100),
        });

        if (data.activeConfig.employeeTypes) {
          const et = data.activeConfig.employeeTypes;
          setTargetsByType((prev) => ({
            full_time: { ...prev.full_time, ...(et.full_time ? { onTime: et.full_time.onTimeTargetRate, daysWorked: et.full_time.daysWorkedTargetRate, hours: et.full_time.hoursTargetRate, taskCompletion: et.full_time.taskCompletionTargetRate, taskOnTime: et.full_time.taskOnTimeTargetRate } : {}) },
            part_time: { ...prev.part_time, ...(et.part_time ? { onTime: et.part_time.onTimeTargetRate, daysWorked: et.part_time.daysWorkedTargetRate, hours: et.part_time.hoursTargetRate, taskCompletion: et.part_time.taskCompletionTargetRate, taskOnTime: et.part_time.taskOnTimeTargetRate } : {}) },
            intern: { ...prev.intern, ...(et.intern ? { onTime: et.intern.onTimeTargetRate, daysWorked: et.intern.daysWorkedTargetRate, hours: et.intern.hoursTargetRate, taskCompletion: et.intern.taskCompletionTargetRate, taskOnTime: et.intern.taskOnTimeTargetRate } : {}) },
            contract: { ...prev.contract, ...(et.contract ? { onTime: et.contract.onTimeTargetRate, daysWorked: et.contract.daysWorkedTargetRate, hours: et.contract.hoursTargetRate, taskCompletion: et.contract.taskCompletionTargetRate, taskOnTime: et.contract.taskOnTimeTargetRate } : {}) },
          }));
        }
      }
      setVersions(data.versions || []);
    } catch (err: any) {
      toast.error(err.message || "Failed to load KPI configuration");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Live total weight calculation
  const totalWeight =
    (weights.on_time_check_in_rate || 0) +
    (weights.days_worked_vs_expected || 0) +
    (weights.worked_hours_vs_target || 0) +
    (weights.tasks_completed_vs_assigned || 0) +
    (weights.task_on_time_rate || 0);

  // Active config weights (converted to 0..100)
  const activeW = React.useMemo(() => {
    const raw = activeConfig?.weights || KPI_CONFIG.weights;
    return {
      on_time_check_in_rate: Math.round((raw.on_time_check_in_rate ?? 0.2) * 100),
      days_worked_vs_expected: Math.round((raw.days_worked_vs_expected ?? 0.2) * 100),
      worked_hours_vs_target: Math.round((raw.worked_hours_vs_target ?? 0.25) * 100),
      tasks_completed_vs_assigned: Math.round((raw.tasks_completed_vs_assigned ?? 0.2) * 100),
      task_on_time_rate: Math.round((raw.task_on_time_rate ?? 0.15) * 100),
    };
  }, [activeConfig]);

  // Result preview calculation: computed with the SAME sample inputs and SAME function
  // Sample typical performance inputs: onTime: 90, daysWorked: 100, hours: 95, tasks: 80, taskOnTime: 85
  const computeSampleScore = (w: WeightsType): number => {
    return Math.round(
      (90 * (w.on_time_check_in_rate || 0) +
        100 * (w.days_worked_vs_expected || 0) +
        95 * (w.worked_hours_vs_target || 0) +
        80 * (w.tasks_completed_vs_assigned || 0) +
        85 * (w.task_on_time_rate || 0)) /
        100
    );
  };

  const beforeSampleScore = computeSampleScore(activeW);
  const afterSampleScore = totalWeight === 100 ? computeSampleScore(weights) : null;

  // Check if anything has changed from active settings
  const hasChanged = React.useMemo(() => {
    if (!activeConfig) return false;
    if (
      weights.on_time_check_in_rate !== activeW.on_time_check_in_rate ||
      weights.days_worked_vs_expected !== activeW.days_worked_vs_expected ||
      weights.worked_hours_vs_target !== activeW.worked_hours_vs_target ||
      weights.tasks_completed_vs_assigned !== activeW.tasks_completed_vs_assigned ||
      weights.task_on_time_rate !== activeW.task_on_time_rate
    ) {
      return true;
    }
    const curTargets = targetsByType[selectedTypeTab];
    const actType =
      activeConfig.employeeTypes?.[selectedTypeTab] ||
      KPI_CONFIG.employeeTypes[selectedTypeTab] ||
      KPI_CONFIG.employeeTypes.full_time;
    if (
      curTargets.onTime !== actType.onTimeTargetRate ||
      curTargets.daysWorked !== actType.daysWorkedTargetRate ||
      curTargets.hours !== actType.hoursTargetRate ||
      curTargets.taskCompletion !== actType.taskCompletionTargetRate ||
      curTargets.taskOnTime !== actType.taskOnTimeTargetRate
    ) {
      return true;
    }
    return false;
  }, [activeConfig, weights, activeW, targetsByType, selectedTypeTab]);

  let saveDisabledReason = "";
  if (totalWeight !== 100) {
    saveDisabledReason = `Weights must add up to 100% (currently ${totalWeight}%).`;
  } else if (!hasChanged) {
    saveDisabledReason = "No changes to save.";
  } else if (reason.trim().length < 5) {
    saveDisabledReason = "Please enter a reason with at least 5 characters.";
  }

  const isSaveDisabled = saving || Boolean(saveDisabledReason);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalWeight !== 100) {
      if (totalWeight > 100) {
        toast.error(`Weights add up to ${totalWeight}%. Reduce by ${totalWeight - 100}.`);
      } else {
        toast.error(`Weights add up to ${totalWeight}%. Add ${100 - totalWeight}.`);
      }
      return;
    }
    if (reason.trim().length < 5) {
      toast.error("Please enter a reason for the change (minimum 5 characters).");
      return;
    }

    try {
      setSaving(true);
      const newConfig = {
        ...activeConfig,
        weights: {
          on_time_check_in_rate: weights.on_time_check_in_rate / 100,
          days_worked_vs_expected: weights.days_worked_vs_expected / 100,
          worked_hours_vs_target: weights.worked_hours_vs_target / 100,
          tasks_completed_vs_assigned: weights.tasks_completed_vs_assigned / 100,
          task_on_time_rate: weights.task_on_time_rate / 100,
        },
        employeeTypes: {
          ...activeConfig.employeeTypes,
          [selectedTypeTab]: {
            ...activeConfig.employeeTypes?.[selectedTypeTab],
            onTimeTargetRate: targetsByType[selectedTypeTab].onTime,
            daysWorkedTargetRate: targetsByType[selectedTypeTab].daysWorked,
            hoursTargetRate: targetsByType[selectedTypeTab].hours,
            taskCompletionTargetRate: targetsByType[selectedTypeTab].taskCompletion,
            taskOnTimeTargetRate: targetsByType[selectedTypeTab].taskOnTime,
          },
        },
      };

      const res = await fetch("/api/kpi/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          config: newConfig,
          effective_from: effectiveFrom,
          reason: reason.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to save configuration");

      toast.success("Changes saved successfully!");
      setReason("");
      await loadSettings();
    } catch (err: any) {
      toast.error(err.message || "Failed to save configuration");
    } finally {
      setSaving(false);
    }
  };

  if (isLoaded && !isAdminOrHr) {
    return (
      <AppShell>
        <div className="p-8 max-w-xl mx-auto text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-rose-600 mx-auto" />
          <h1 className="text-xl font-bold text-black">Access denied</h1>
          <p className="text-xs text-text-secondary">
            Settings are restricted strictly to Administrators and HR managers.
          </p>
          <Link
            href="/admin/settings"
            className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-black rounded-xl hover:bg-black/90 cursor-pointer"
          >
            Back to admin settings
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-4xl mx-auto pb-16">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-text-tertiary">
          <Link href="/admin/settings" className="hover:text-black transition-colors flex items-center gap-1 font-semibold">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Admin settings</span>
          </Link>
          <span>/</span>
          <span className="text-text-primary font-bold">Performance settings</span>
        </div>

        {/* Page Header */}
        <div className="border-b border-border-light pb-4">
          <h1 className="text-2xl font-extrabold text-text-primary tracking-tight">
            Performance settings
          </h1>
          <p className="text-xs text-text-secondary mt-1">
            Choose what counts toward performance results, set target levels, and schedule policy updates.
          </p>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          {/* GROUP 1: What counts (weights with number inputs + 3 presets) */}
          <section className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-border-light pb-3">
              <div>
                <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                  What counts
                </h2>
                <p className="text-xs text-text-secondary">
                  How much each operational area contributes to the overall result.
                </p>
              </div>

              {/* Total indicator with plain message */}
              <div
                className={cn(
                  "px-3 py-1 rounded-full text-xs font-bold inline-flex items-center gap-1.5 self-start sm:self-auto",
                  totalWeight === 100
                    ? "bg-[#B7FF00]/20 text-black border border-[#B7FF00]/50"
                    : "bg-rose-50 text-rose-700 border border-rose-200"
                )}
              >
                {totalWeight === 100 ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Weights add up to 100%.</span>
                  </>
                ) : totalWeight > 100 ? (
                  <span>Weights add up to {totalWeight}%. Reduce by {totalWeight - 100}.</span>
                ) : (
                  <span>Weights add up to {totalWeight}%. Add {100 - totalWeight}.</span>
                )}
              </div>
            </div>

            {/* Presets */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs font-semibold text-text-tertiary">Presets:</span>
              {(["balanced", "attendance", "delivery"] as const).map((key) => {
                const preset = PRESETS[key];
                const isMatching =
                  preset.weights.on_time_check_in_rate === weights.on_time_check_in_rate &&
                  preset.weights.days_worked_vs_expected === weights.days_worked_vs_expected &&
                  preset.weights.worked_hours_vs_target === weights.worked_hours_vs_target &&
                  preset.weights.tasks_completed_vs_assigned === weights.tasks_completed_vs_assigned &&
                  preset.weights.task_on_time_rate === weights.task_on_time_rate;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setWeights(preset.weights)}
                    className={cn(
                      "px-3 py-1 rounded-xl text-xs font-bold transition-all cursor-pointer",
                      isMatching
                        ? "bg-black text-white border border-black shadow-xs"
                        : "bg-card-subtle border border-border-light text-text-primary hover:border-black"
                    )}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Five Number Inputs (0 to 100) with One Plain Line Underneath */}
            <div className="space-y-3 pt-2">
              {/* 1. On-Time Check-In Rate */}
              <div className="p-3 rounded-xl bg-card-subtle border border-border-light/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-xs text-text-primary block">
                    Punctuality (on-time check-ins)
                  </span>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    How much punctuality counts toward the overall result.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weights.on_time_check_in_rate}
                    onChange={(e) =>
                      setWeights({ ...weights, on_time_check_in_rate: Number(e.target.value) })
                    }
                    className="w-20 px-2.5 py-1 rounded-lg bg-card border border-border-light text-xs font-bold text-text-primary text-right"
                  />
                  <span className="text-xs font-bold text-text-tertiary">%</span>
                </div>
              </div>

              {/* 2. Days Worked vs Expected */}
              <div className="p-3 rounded-xl bg-card-subtle border border-border-light/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-xs text-text-primary block">
                    Days present (scheduled workdays)
                  </span>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    How much being present on scheduled workdays counts.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weights.days_worked_vs_expected}
                    onChange={(e) =>
                      setWeights({ ...weights, days_worked_vs_expected: Number(e.target.value) })
                    }
                    className="w-20 px-2.5 py-1 rounded-lg bg-card border border-border-light text-xs font-bold text-text-primary text-right"
                  />
                  <span className="text-xs font-bold text-text-tertiary">%</span>
                </div>
              </div>

              {/* 3. Worked Hours vs Target */}
              <div className="p-3 rounded-xl bg-card-subtle border border-border-light/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-xs text-text-primary block">
                    Hours logged (vs shift target)
                  </span>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    How much logged shift hours count toward the target.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weights.worked_hours_vs_target}
                    onChange={(e) =>
                      setWeights({ ...weights, worked_hours_vs_target: Number(e.target.value) })
                    }
                    className="w-20 px-2.5 py-1 rounded-lg bg-card border border-border-light text-xs font-bold text-text-primary text-right"
                  />
                  <span className="text-xs font-bold text-text-tertiary">%</span>
                </div>
              </div>

              {/* 4. Tasks Completed vs Assigned */}
              <div className="p-3 rounded-xl bg-card-subtle border border-border-light/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-xs text-text-primary block">
                    Tasks completed
                  </span>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    How much finishing assigned deliverables counts.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weights.tasks_completed_vs_assigned}
                    onChange={(e) =>
                      setWeights({ ...weights, tasks_completed_vs_assigned: Number(e.target.value) })
                    }
                    className="w-20 px-2.5 py-1 rounded-lg bg-card border border-border-light text-xs font-bold text-text-primary text-right"
                  />
                  <span className="text-xs font-bold text-text-tertiary">%</span>
                </div>
              </div>

              {/* 5. Task On-Time Rate */}
              <div className="p-3 rounded-xl bg-card-subtle border border-border-light/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <span className="font-bold text-xs text-text-primary block">
                    Tasks delivered on time
                  </span>
                  <p className="text-[11px] text-text-secondary mt-0.5">
                    How much delivering deliverables by their due date counts.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={weights.task_on_time_rate}
                    onChange={(e) =>
                      setWeights({ ...weights, task_on_time_rate: Number(e.target.value) })
                    }
                    className="w-20 px-2.5 py-1 rounded-lg bg-card border border-border-light text-xs font-bold text-text-primary text-right"
                  />
                  <span className="text-xs font-bold text-text-tertiary">%</span>
                </div>
              </div>
            </div>

            {/* Result preview as plain text */}
            <div className="p-3.5 rounded-xl bg-card-subtle/80 border border-border-light text-xs flex items-center justify-between gap-2">
              <span className="text-text-secondary font-medium">Result preview:</span>
              <span className="font-bold text-text-primary">
                {totalWeight !== 100
                  ? "Fix weights to equal 100% to calculate preview."
                  : afterSampleScore === beforeSampleScore
                  ? "No change from the current settings."
                  : `A typical employee would score ${afterSampleScore} instead of ${beforeSampleScore}.`}
              </span>
            </div>
          </section>

          {/* GROUP 2: What good looks like (Targets with employee type tabs) */}
          <section className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-4">
            <div className="border-b border-border-light pb-3">
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                What good looks like
              </h2>
              <p className="text-xs text-text-secondary">
                Target expectations per contract type.
              </p>
            </div>

            {/* Type tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl bg-card-subtle border border-border-light/70 w-fit">
              {(["full_time", "part_time", "intern", "contract"] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setSelectedTypeTab(t)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer capitalize",
                    selectedTypeTab === t
                      ? "bg-black text-white shadow-xs"
                      : "text-text-secondary hover:text-text-primary"
                  )}
                >
                  {t.replace("_", "-")}
                </button>
              ))}
            </div>

            {/* Target inputs for selected type */}
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3 text-xs pt-1">
              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Punctuality target (%)
                </label>
                <input
                  type="number"
                  min={50}
                  max={100}
                  value={targetsByType[selectedTypeTab].onTime}
                  onChange={(e) =>
                    setTargetsByType({
                      ...targetsByType,
                      [selectedTypeTab]: { ...targetsByType[selectedTypeTab], onTime: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Days present target (%)
                </label>
                <input
                  type="number"
                  min={50}
                  max={100}
                  value={targetsByType[selectedTypeTab].daysWorked}
                  onChange={(e) =>
                    setTargetsByType({
                      ...targetsByType,
                      [selectedTypeTab]: { ...targetsByType[selectedTypeTab], daysWorked: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Daily target hours
                </label>
                <input
                  type="number"
                  min={1}
                  max={12}
                  value={targetsByType[selectedTypeTab].hoursPerDay}
                  onChange={(e) =>
                    setTargetsByType({
                      ...targetsByType,
                      [selectedTypeTab]: { ...targetsByType[selectedTypeTab], hoursPerDay: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Task completion target (%)
                </label>
                <input
                  type="number"
                  min={50}
                  max={100}
                  value={targetsByType[selectedTypeTab].taskCompletion}
                  onChange={(e) =>
                    setTargetsByType({
                      ...targetsByType,
                      [selectedTypeTab]: { ...targetsByType[selectedTypeTab], taskCompletion: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary"
                />
              </div>

              <div>
                <label className="font-bold text-text-primary block mb-1">
                  Task on-time target (%)
                </label>
                <input
                  type="number"
                  min={50}
                  max={100}
                  value={targetsByType[selectedTypeTab].taskOnTime}
                  onChange={(e) =>
                    setTargetsByType({
                      ...targetsByType,
                      [selectedTypeTab]: { ...targetsByType[selectedTypeTab], taskOnTime: Number(e.target.value) },
                    })
                  }
                  className="w-full p-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary"
                />
              </div>
            </div>
          </section>

          {/* GROUP 3: When it starts */}
          <section className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-3">
            <div className="border-b border-border-light pb-3">
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                When it starts
              </h2>
              <p className="text-xs text-text-secondary">
                Changes apply to evaluation periods starting on or after this date. Past periods keep their original settings.
              </p>
            </div>

            <div className="max-w-xs space-y-1">
              <label htmlFor="effective-from-date" className="text-xs font-bold text-text-primary block">
                Starts on
              </label>
              <input
                id="effective-from-date"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
                className="w-full p-2 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary"
                required
              />
            </div>
          </section>

          {/* GROUP 4: Why you're changing it */}
          <section className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-3">
            <div className="border-b border-border-light pb-3">
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                Why you&apos;re changing it
              </h2>
              <p className="text-xs text-text-secondary">
                Add a short note for the audit log explaining this update.
              </p>
            </div>

            <div className="space-y-1.5">
              <textarea
                rows={2}
                placeholder="e.g. Updating task delivery weighting for the new quarterly cycle..."
                value={reason}
                onBlur={() => setReasonTouched(true)}
                onChange={(e) => {
                  setReason(e.target.value);
                  if (!reasonTouched) setReasonTouched(true);
                }}
                className="w-full p-3 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                required
                minLength={5}
              />
              <div className="flex justify-between items-center text-[11px] text-text-tertiary">
                <span>Minimum 5 characters required</span>
                <span
                  className={cn(
                    !reasonTouched
                      ? "text-text-tertiary"
                      : reason.trim().length < 5
                      ? "text-[#FF007A] font-semibold"
                      : "text-text-primary font-bold"
                  )}
                >
                  {reason.trim().length} characters
                </span>
              </div>
            </div>

            <div className="pt-2 space-y-2">
              <button
                type="submit"
                disabled={isSaveDisabled}
                className="px-6 py-2.5 rounded-xl bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold flex items-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{saving ? "Saving..." : "Save changes"}</span>
              </button>
              {saveDisabledReason && (
                <p className="text-xs text-text-tertiary font-medium">
                  {saveDisabledReason}
                </p>
              )}
            </div>
          </section>

          {/* Version History: Simple list */}
          <section className="p-5 rounded-2xl bg-card border border-border-light shadow-card space-y-3">
            <div className="flex items-center gap-2 border-b border-border-light pb-3">
              <History className="w-4 h-4 text-black" />
              <h2 className="text-sm font-extrabold text-text-primary tracking-tight">
                Version history ({versions.length})
              </h2>
            </div>

            {versions.length > 0 ? (
              <div className="divide-y divide-border-light text-xs">
                {versions.map((v: any) => (
                  <div key={v.id} className="py-2.5 first:pt-0 last:pb-0 text-text-secondary">
                    <span>
                      Changed on {v.effective_from || (v.created_at ? v.created_at.slice(0, 10) : "")} by {v.created_by_name || "Admin"}:{" "}
                      <strong className="text-text-primary font-semibold">{v.reason}</strong>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-text-tertiary">
                No custom versions recorded yet. Default settings are active.
              </p>
            )}
          </section>
        </form>
      </div>
    </AppShell>
  );
}
