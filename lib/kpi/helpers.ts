import {
  KpiDirection,
  KpiPeriodStatus,
  KpiPeriodType,
  KpiSourceMetric,
} from "@/types/database.types";

export interface KpiMetricMeta {
  key: KpiSourceMetric;
  label: string;
  unit: string;
  defaultDirection: KpiDirection;
  defaultTarget: number;
  description: string;
  category: "Attendance" | "Leave" | "Tasks";
}

export const KPI_SOURCE_METRICS: readonly KpiMetricMeta[] = [
  {
    key: "attendance_on_time_rate",
    label: "Attendance On-Time Rate",
    unit: "%",
    defaultDirection: "higher_is_better",
    defaultTarget: 95,
    description: "Percentage of attended workdays checked in within grace period.",
    category: "Attendance",
  },
  {
    key: "hours_vs_target",
    label: "Worked Hours vs Target",
    unit: "%",
    defaultDirection: "higher_is_better",
    defaultTarget: 100,
    description: "Total worked minutes divided by scheduled shift target minutes (%).",
    category: "Attendance",
  },
  {
    key: "absence_days",
    label: "Unexcused Absence Days",
    unit: "days",
    defaultDirection: "lower_is_better",
    defaultTarget: 1,
    description: "Number of workdays marked absent during the KPI period.",
    category: "Attendance",
  },
  {
    key: "leave_days_taken",
    label: "Approved Leave Days Taken",
    unit: "days",
    defaultDirection: "lower_is_better",
    defaultTarget: 2,
    description:
      "Working days of approved countable leave overlapping the KPI period (excludes sick/statutory by default).",
    category: "Leave",
  },
  {
    key: "tasks_completed",
    label: "Tasks Completed",
    unit: "tasks",
    defaultDirection: "higher_is_better",
    defaultTarget: 5,
    description: "Count of assigned tasks completed during the KPI period.",
    category: "Tasks",
  },
  {
    key: "tasks_on_time_rate",
    label: "Tasks Completed On Time",
    unit: "%",
    defaultDirection: "higher_is_better",
    defaultTarget: 90,
    description: "Percentage of completed tasks finished on or before due date.",
    category: "Tasks",
  },
  {
    key: "tasks_overdue",
    label: "Overdue Tasks",
    unit: "tasks",
    defaultDirection: "lower_is_better",
    defaultTarget: 0,
    description:
      "Open tasks due within the period that are past due, plus tasks completed late in the period.",
    category: "Tasks",
  },
  {
    key: "avg_task_cycle_days",
    label: "Avg Task Cycle Time",
    unit: "days",
    defaultDirection: "lower_is_better",
    defaultTarget: 3,
    description: "Mean elapsed days from start/creation to completion.",
    category: "Tasks",
  },
] as const;

export function getKpiMetricMeta(metric: KpiSourceMetric | string): KpiMetricMeta {
  return (
    KPI_SOURCE_METRICS.find((m) => m.key === metric) || {
      key: metric as KpiSourceMetric,
      label: metric,
      unit: "",
      defaultDirection: "higher_is_better",
      defaultTarget: 100,
      description: "",
      category: "Tasks",
    }
  );
}

export interface WeightedScoreInput {
  score: number | null | undefined;
  weight?: number | null;
}

/**
 * Computes normalized weighted average KPI score on a 0..100 scale.
 * Unscored metrics (`null` / no underlying data) are excluded from both
 * numerator and denominator weights. Returns null if no scored rows remain.
 */
export function computeWeightedKpiScore(
  items: WeightedScoreInput[]
): number | null {
  if (!items || items.length === 0) return null;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const item of items) {
    if (item.score === null || item.score === undefined || !Number.isFinite(item.score)) {
      continue;
    }
    const clampedScore = Math.max(0, Math.min(100, item.score));
    const w =
      typeof item.weight === "number" && Number.isFinite(item.weight) && item.weight > 0
        ? item.weight
        : 1;
    weightedSum += clampedScore * w;
    totalWeight += w;
  }

  if (totalWeight <= 0) return null;
  return Math.round((weightedSum / totalWeight) * 100) / 100;
}

export function formatKpiValue(value: number | null | undefined, unit: string): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return "No data";
  }
  const rounded = Math.round(value * 100) / 100;
  const formatted = String(rounded);
  if (unit === "%") return `${formatted}%`;
  return unit ? `${formatted} ${unit}` : formatted;
}

export function getKpiBandLabel(score: number | null): {
  label: string;
  tone: "success" | "warning" | "danger" | "neutral";
} {
  if (score === null || !Number.isFinite(score)) {
    return { label: "Not Scored", tone: "neutral" };
  }
  if (score >= 85) return { label: "Exceeding Target", tone: "success" };
  if (score >= 65) return { label: "On Track", tone: "warning" };
  return { label: "Needs Attention", tone: "danger" };
}

export interface KpiPeriodRecord {
  id: string;
  organization_id: string;
  name: string;
  period_type: KpiPeriodType;
  start_date: string;
  end_date: string;
  status: KpiPeriodStatus;
  closed_at: string | null;
  closed_by: string | null;
  created_by: string;
  created_at: string;
}

export interface KpiScoreWithDef {
  period_id: string;
  employee_id: string;
  score: number | null;
  weight?: number | null;
}

export interface KpiTrendPoint {
  periodId: string;
  periodName: string;
  startDate: string;
  status: KpiPeriodStatus;
  overallScore: number;
  metricCount: number;
}

/**
 * Builds chronological multi-period trend points for a given employee.
 * Periods where all KPI rows lack underlying data (`score === null`) are omitted.
 */
export function buildEmployeeKpiTrend(
  periods: KpiPeriodRecord[],
  scores: KpiScoreWithDef[],
  employeeId: string
): KpiTrendPoint[] {
  const sorted = [...periods].sort((a, b) => a.start_date.localeCompare(b.start_date));
  const points: KpiTrendPoint[] = [];

  for (const period of sorted) {
    const scoredRows = scores.filter(
      (s) =>
        s.period_id === period.id &&
        s.employee_id === employeeId &&
        s.score !== null &&
        Number.isFinite(s.score)
    );
    if (scoredRows.length === 0) continue;
    const weighted = computeWeightedKpiScore(scoredRows);
    if (weighted === null) continue;
    points.push({
      periodId: period.id,
      periodName: period.name,
      startDate: period.start_date,
      status: period.status,
      overallScore: weighted,
      metricCount: scoredRows.length,
    });
  }

  return points;
}

