"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { KPI_CONFIG } from "@/lib/kpi/config";
import { toast } from "sonner";
import {
  Sliders,
  ArrowLeft,
  Save,
  Clock,
  CheckCircle2,
  AlertTriangle,
  History,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function AdminKpiSettingsPage() {
  const { userRole, isLoaded } = useAppSession();
  const isAdminOrHr = userRole === "admin" || userRole === "hr";

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [activeConfig, setActiveConfig] = React.useState<any>(KPI_CONFIG);
  const [versions, setVersions] = React.useState<any[]>([]);
  const [effectiveFrom, setEffectiveFrom] = React.useState(
    new Date().toISOString().slice(0, 10)
  );
  const [reason, setReason] = React.useState("");

  // Editable form state for weights (displayed in percentages 0..100)
  const [weights, setWeights] = React.useState({
    on_time_check_in_rate: 20,
    days_worked_vs_expected: 20,
    worked_hours_vs_target: 25,
    tasks_completed_vs_assigned: 20,
    task_on_time_rate: 15,
  });

  // Editable per-type targets
  const [ftTargets, setFtTargets] = React.useState({
    onTime: 95,
    daysWorked: 100,
    hours: 100,
    taskCompletion: 90,
    taskOnTime: 90,
  });

  const [sampleRaw, setSampleRaw] = React.useState({
    onTime: 90,
    daysWorked: 100,
    hours: 95,
    taskCompletion: 80,
    taskOnTime: 85,
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
          on_time_check_in_rate: Math.round((w.on_time_check_in_rate || 0.2) * 100),
          days_worked_vs_expected: Math.round((w.days_worked_vs_expected || 0.2) * 100),
          worked_hours_vs_target: Math.round((w.worked_hours_vs_target || 0.25) * 100),
          tasks_completed_vs_assigned: Math.round((w.tasks_completed_vs_assigned || 0.2) * 100),
          task_on_time_rate: Math.round((w.task_on_time_rate || 0.15) * 100),
        });

        const ft = data.activeConfig.employeeTypes?.full_time;
        if (ft) {
          setFtTargets({
            onTime: ft.onTimeTargetRate || 95,
            daysWorked: ft.daysWorkedTargetRate || 100,
            hours: ft.hoursTargetRate || 100,
            taskCompletion: ft.taskCompletionTargetRate || 90,
            taskOnTime: ft.taskOnTimeTargetRate || 90,
          });
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

  // Live calculation of weights total
  const totalWeight =
    weights.on_time_check_in_rate +
    weights.days_worked_vs_expected +
    weights.worked_hours_vs_target +
    weights.tasks_completed_vs_assigned +
    weights.task_on_time_rate;

  // Live sample score preview
  const liveSampleScore =
    totalWeight === 100
      ? Math.round(
          (sampleRaw.onTime * weights.on_time_check_in_rate +
            sampleRaw.daysWorked * weights.days_worked_vs_expected +
            sampleRaw.hours * weights.worked_hours_vs_target +
            sampleRaw.taskCompletion * weights.tasks_completed_vs_assigned +
            sampleRaw.taskOnTime * weights.task_on_time_rate) /
            100
        )
      : null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (totalWeight !== 100) {
      toast.error(`Weights must total 100%. Current total is ${totalWeight}%.`);
      return;
    }
    if (reason.trim().length < 5) {
      toast.error("Please enter a version reason (minimum 5 characters).");
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
          full_time: {
            ...activeConfig.employeeTypes?.full_time,
            onTimeTargetRate: ftTargets.onTime,
            daysWorkedTargetRate: ftTargets.daysWorked,
            hoursTargetRate: ftTargets.hours,
            taskCompletionTargetRate: ftTargets.taskCompletion,
            taskOnTimeTargetRate: ftTargets.taskOnTime,
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

      toast.success("New KPI benchmark version saved successfully!");
      setReason("");
      await loadSettings();
    } catch (err: any) {
      toast.error(err.message || "Failed to save KPI configuration");
    } finally {
      setSaving(false);
    }
  };

  if (isLoaded && !isAdminOrHr) {
    return (
      <AppShell>
        <div className="p-8 max-w-xl mx-auto text-center space-y-4">
          <AlertTriangle className="w-10 h-10 text-rose-600 mx-auto" />
          <h1 className="text-xl font-bold text-black">Access Denied</h1>
          <p className="text-xs text-[#808080]">
            KPI benchmark settings are restricted strictly to Administrators and HR managers.
          </p>
          <Link
            href="/admin/settings"
            className="inline-flex items-center px-4 py-2 text-xs font-semibold text-white bg-black rounded-lg hover:bg-black/90"
          >
            Back to Admin Settings
          </Link>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto pb-16">
        {/* Navigation Breadcrumb */}
        <div className="flex items-center gap-2 text-xs text-[#808080]">
          <Link href="/admin/settings" className="hover:text-black transition-colors flex items-center gap-1 font-semibold">
            <ArrowLeft className="w-3.5 h-3.5" />
            <span>Admin Settings</span>
          </Link>
          <span>/</span>
          <span className="text-black font-bold">KPI Benchmarks & Weights</span>
        </div>

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[#E6E6E6] pb-4">
          <div>
            <h1 className="text-2xl font-bold text-black tracking-tight flex items-center gap-2">
              <Sliders className="w-6 h-6 text-black" />
              <span>KPI Performance Benchmarks</span>
            </h1>
            <p className="text-xs text-[#808080] mt-1">
              Configure metric weights, role targets, and versioned calculation policies. Historical periods retain their archived benchmarks.
            </p>
          </div>
        </div>

        {/* Main Settings Form & Live Preview */}
        <form onSubmit={handleSave} className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Form: Weights & Targets (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            {/* 1. Component Weights */}
            <div className="p-5 rounded-2xl bg-white border border-[#E6E6E6] shadow-sm space-y-4">
              <div className="flex items-center justify-between border-b border-[#E6E6E6] pb-3">
                <div>
                  <h3 className="text-sm font-bold text-black">Overall Index Weights</h3>
                  <p className="text-xs text-[#808080]">Must total exactly 100%.</p>
                </div>
                <span
                  className={cn(
                    "px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums",
                    totalWeight === 100 ? "bg-[#B7FF00]/20 text-black border border-[#B7FF00]/40" : "bg-rose-50 text-rose-700 border border-rose-200"
                  )}
                >
                  Total: {totalWeight}%
                </span>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold text-black">On-Time Check-In Rate</span>
                    <span className="font-bold tabular-nums">{weights.on_time_check_in_rate}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={weights.on_time_check_in_rate}
                    onChange={(e) => setWeights({ ...weights, on_time_check_in_rate: Number(e.target.value) })}
                    className="w-full accent-black cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold text-black">Days Worked vs Expected</span>
                    <span className="font-bold tabular-nums">{weights.days_worked_vs_expected}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={weights.days_worked_vs_expected}
                    onChange={(e) => setWeights({ ...weights, days_worked_vs_expected: Number(e.target.value) })}
                    className="w-full accent-black cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold text-black">Worked Hours vs Target</span>
                    <span className="font-bold tabular-nums">{weights.worked_hours_vs_target}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={weights.worked_hours_vs_target}
                    onChange={(e) => setWeights({ ...weights, worked_hours_vs_target: Number(e.target.value) })}
                    className="w-full accent-black cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold text-black">Tasks Completed vs Assigned</span>
                    <span className="font-bold tabular-nums">{weights.tasks_completed_vs_assigned}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={weights.tasks_completed_vs_assigned}
                    onChange={(e) => setWeights({ ...weights, tasks_completed_vs_assigned: Number(e.target.value) })}
                    className="w-full accent-black cursor-pointer"
                  />
                </div>

                <div>
                  <div className="flex justify-between mb-1">
                    <span className="font-semibold text-black">Task On-Time Rate</span>
                    <span className="font-bold tabular-nums">{weights.task_on_time_rate}%</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={50}
                    value={weights.task_on_time_rate}
                    onChange={(e) => setWeights({ ...weights, task_on_time_rate: Number(e.target.value) })}
                    className="w-full accent-black cursor-pointer"
                  />
                </div>
              </div>
            </div>

            {/* 2. Full-Time Role Target Rates */}
            <div className="p-5 rounded-2xl bg-white border border-[#E6E6E6] shadow-sm space-y-4">
              <div className="border-b border-[#E6E6E6] pb-3">
                <h3 className="text-sm font-bold text-black">Full-Time Employee Target Rates (%)</h3>
                <p className="text-xs text-[#808080]">Benchmark expectations evaluated against 100%.</p>
              </div>

              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <label className="font-semibold text-black block mb-1">On-Time Punch Target (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={ftTargets.onTime}
                    onChange={(e) => setFtTargets({ ...ftTargets, onTime: Number(e.target.value) })}
                    className="w-full p-2 rounded-lg border border-[#E6E6E6] text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="font-semibold text-black block mb-1">Shift Hours Target (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={120}
                    value={ftTargets.hours}
                    onChange={(e) => setFtTargets({ ...ftTargets, hours: Number(e.target.value) })}
                    className="w-full p-2 rounded-lg border border-[#E6E6E6] text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="font-semibold text-black block mb-1">Task Completion Target (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={ftTargets.taskCompletion}
                    onChange={(e) => setFtTargets({ ...ftTargets, taskCompletion: Number(e.target.value) })}
                    className="w-full p-2 rounded-lg border border-[#E6E6E6] text-xs font-bold"
                  />
                </div>

                <div>
                  <label className="font-semibold text-black block mb-1">Task On-Time Target (%)</label>
                  <input
                    type="number"
                    min={50}
                    max={100}
                    value={ftTargets.taskOnTime}
                    onChange={(e) => setFtTargets({ ...ftTargets, taskOnTime: Number(e.target.value) })}
                    className="w-full p-2 rounded-lg border border-[#E6E6E6] text-xs font-bold"
                  />
                </div>
              </div>
            </div>

            {/* 3. Version Effective Date & Justification Reason */}
            <div className="p-5 rounded-2xl bg-white border border-[#E6E6E6] shadow-sm space-y-4">
              <div className="border-b border-[#E6E6E6] pb-3">
                <h3 className="text-sm font-bold text-black">New Policy Version Details</h3>
                <p className="text-xs text-[#808080]">Effective date cannot be in the past to preserve historical audits.</p>
              </div>

              <div className="space-y-3 text-xs">
                <div>
                  <label className="font-semibold text-black block mb-1">Effective From Date</label>
                  <input
                    type="date"
                    min={new Date().toISOString().slice(0, 10)}
                    value={effectiveFrom}
                    onChange={(e) => setEffectiveFrom(e.target.value)}
                    className="w-full p-2 rounded-lg border border-[#E6E6E6] text-xs font-bold"
                    required
                  />
                </div>

                <div>
                  <label className="font-semibold text-black block mb-1">Change Reason / Policy Notes (Min 5 chars)</label>
                  <textarea
                    rows={2}
                    placeholder="e.g. Q4 Sprint alignment: increase task on-time weight from 15% to 20%..."
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="w-full p-2.5 rounded-lg border border-[#E6E6E6] text-xs"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={saving || totalWeight !== 100 || reason.trim().length < 5}
                  className="w-full py-2.5 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-bold flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Save className="w-4 h-4" />
                  <span>{saving ? "Publishing Version..." : "Publish Benchmark Version"}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: Live Preview & Version History (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Live Sample Score Preview */}
            <div className="p-5 rounded-2xl bg-white border border-[#E6E6E6] shadow-sm space-y-4">
              <div className="flex items-center gap-2 border-b border-[#E6E6E6] pb-3">
                <TrendingUp className="w-4 h-4 text-black" />
                <h3 className="text-sm font-bold text-black">Live Score Preview</h3>
              </div>

              <p className="text-xs text-[#808080]">
                See how a sample employee&apos;s overall score recalculates dynamically under your proposed weights:
              </p>

              <div className="p-4 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] text-center space-y-1">
                <span className="text-[10px] font-bold uppercase tracking-wider text-[#808080] block">
                  Simulated Score
                </span>
                <span className="text-3xl font-bold text-black tabular-nums">
                  {liveSampleScore != null ? `${liveSampleScore}%` : "Invalid weights"}
                </span>
                <span className="text-xs text-[#4D4D4D] block font-medium">
                  Sample: 90% punctuality, 100% days, 95% hours, 80% tasks, 85% task on-time
                </span>
              </div>
            </div>

            {/* Version History Table */}
            <div className="p-5 rounded-2xl bg-white border border-[#E6E6E6] shadow-sm space-y-3">
              <div className="flex items-center gap-2 border-b border-[#E6E6E6] pb-3">
                <History className="w-4 h-4 text-black" />
                <h3 className="text-sm font-bold text-black">Version History ({versions.length})</h3>
              </div>

              {versions.length > 0 ? (
                <div className="divide-y divide-[#E6E6E6] text-xs">
                  {versions.map((v: any) => (
                    <div key={v.id} className="py-2.5 first:pt-0 last:pb-0 space-y-0.5">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-black">
                          Effective: {v.effective_from}
                        </span>
                        <span className="text-[10px] text-[#808080]">
                          {v.created_at ? v.created_at.slice(0, 10) : ""}
                        </span>
                      </div>
                      <p className="text-xs text-[#4D4D4D] leading-snug">
                        {v.reason}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-[#808080]">
                  No custom policy versions yet. The default system configuration applies.
                </p>
              )}
            </div>
          </div>
        </form>
      </div>
    </AppShell>
  );
}
