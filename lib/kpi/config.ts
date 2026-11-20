// ============================================================================
// KPI Configuration: Weights and Per-Employee-Type Targets
// ============================================================================

export interface EmployeeTypeKpiTargets {
  hoursPerDay: number;
  onTimeTargetRate: number; // % (e.g., 95)
  daysWorkedTargetRate: number; // % (e.g., 100)
  hoursTargetRate: number; // % (e.g., 100)
  taskCompletionTargetRate: number; // % (e.g., 90)
  taskOnTimeTargetRate: number; // % (e.g., 90)
}

export const KPI_CONFIG = {
  // Overall performance benchmark target (e.g. 90%)
  overallTarget: 90,

  // Weights for computing the optional overall score (must sum to 1.0)
  weights: {
    on_time_check_in_rate: 0.20,
    days_worked_vs_expected: 0.20,
    worked_hours_vs_target: 0.25,
    tasks_completed_vs_assigned: 0.20,
    task_on_time_rate: 0.15,
  } as Record<string, number>,

  // Performance Rating Bands (0-100 scale)
  bands: [
    { min: 95, label: "Exceptional", badgeClass: "bg-[#B7FF00]/20 text-black border-[#B7FF00]/40" },
    { min: 85, label: "Exceeds Expectations", badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200" },
    { min: 70, label: "Meets Expectations", badgeClass: "bg-blue-50 text-blue-800 border-blue-200" },
    { min: 0, label: "Needs Improvement", badgeClass: "bg-amber-50 text-amber-800 border-amber-200" },
  ],

  // Status Threshold Rules
  thresholds: {
    on_track: {
      label: "On Track",
      description: "At or above target",
      rule: "score >= target",
    },
    at_risk: {
      label: "At Risk",
      description: "Within 10% below target",
      rule: "target - 10 <= score < target",
    },
    behind: {
      label: "Behind",
      description: "More than 10% below target",
      rule: "score < target - 10",
    },
  },

  // Core Categories & Weights
  categories: {
    attendance: {
      label: "Attendance",
      metrics: ["on_time_check_in_rate", "days_worked_vs_expected"],
      weight: 0.40,
    },
    hours: {
      label: "Hours",
      metrics: ["worked_hours_vs_target"],
      weight: 0.25,
    },
    tasks: {
      label: "Tasks",
      metrics: ["tasks_completed_vs_assigned", "task_on_time_rate"],
      weight: 0.35,
    },
  },

  // Per-employee-type targets
  employeeTypes: {
    full_time: {
      hoursPerDay: 8,
      onTimeTargetRate: 95,
      daysWorkedTargetRate: 100,
      hoursTargetRate: 100,
      taskCompletionTargetRate: 90,
      taskOnTimeTargetRate: 90,
    },
    part_time: {
      hoursPerDay: 4,
      onTimeTargetRate: 90,
      daysWorkedTargetRate: 100,
      hoursTargetRate: 100,
      taskCompletionTargetRate: 85,
      taskOnTimeTargetRate: 85,
    },
    intern: {
      hoursPerDay: 8,
      onTimeTargetRate: 90,
      daysWorkedTargetRate: 100,
      hoursTargetRate: 100,
      taskCompletionTargetRate: 80,
      taskOnTimeTargetRate: 80,
    },
    contract: {
      hoursPerDay: 8,
      onTimeTargetRate: 95,
      daysWorkedTargetRate: 100,
      hoursTargetRate: 100,
      taskCompletionTargetRate: 90,
      taskOnTimeTargetRate: 90,
    },
  } as Record<string, EmployeeTypeKpiTargets>,

  // Fallback defaults
  defaultType: "full_time" as const,
};

export function getKpiBand(score: number | null) {
  if (score === null || isNaN(score)) return null;
  for (const b of KPI_CONFIG.bands) {
    if (score >= b.min) return b;
  }
  return KPI_CONFIG.bands[KPI_CONFIG.bands.length - 1];
}

export function getActiveCategoryWeightNotice(metrics: {
  on_time_check_in_rate?: { value: number | null };
  days_worked_vs_expected?: { value: number | null };
  worked_hours_vs_target?: { value: number | null };
  tasks_completed_vs_assigned?: { value: number | null };
  task_on_time_rate?: { value: number | null };
}): { notice: string | null; percent: number; activeLabels: string[] } {
  const hasAttendance =
    metrics.on_time_check_in_rate?.value != null ||
    metrics.days_worked_vs_expected?.value != null;
  const hasHours = metrics.worked_hours_vs_target?.value != null;
  const hasTasks =
    metrics.tasks_completed_vs_assigned?.value != null ||
    metrics.task_on_time_rate?.value != null;

  const activeLabels: string[] = [];
  let totalWeight = 0;

  if (hasAttendance) {
    activeLabels.push("Attendance");
    totalWeight += KPI_CONFIG.categories.attendance.weight;
  }
  if (hasHours) {
    activeLabels.push("Hours");
    totalWeight += KPI_CONFIG.categories.hours.weight;
  }
  if (hasTasks) {
    activeLabels.push("Tasks");
    totalWeight += KPI_CONFIG.categories.tasks.weight;
  }

  const percent = Math.round(totalWeight * 100);

  // If a category has no data, show notice:
  if (activeLabels.length > 0 && activeLabels.length < 3) {
    const categoriesStr =
      activeLabels.length === 2
        ? `${activeLabels[0]} and ${activeLabels[1]}`
        : activeLabels[0];
    return {
      notice: `Based on ${categoriesStr} (${percent}% of the full weight)`,
      percent,
      activeLabels,
    };
  }

  return { notice: null, percent: 100, activeLabels };
}

/**
 * Computes category-level weights by summing metric weights.
 * Attendance: on_time_check_in_rate + days_worked_vs_expected (e.g. 40%)
 * Hours: worked_hours_vs_target (e.g. 25%)
 * Tasks: tasks_completed_vs_assigned + task_on_time_rate (e.g. 35%)
 */
export function getCategoryWeights(metricWeights?: Record<string, number>): {
  attendance: number;
  hours: number;
  tasks: number;
} {
  const w = metricWeights || KPI_CONFIG.weights;
  const attendance = Math.round(
    ((Number(w.on_time_check_in_rate) || 0.20) + (Number(w.days_worked_vs_expected) || 0.20)) * 100
  );
  const hours = Math.round((Number(w.worked_hours_vs_target) || 0.25) * 100);
  const tasks = Math.round(
    ((Number(w.tasks_completed_vs_assigned) || 0.20) + (Number(w.task_on_time_rate) || 0.15)) * 100
  );

  return { attendance, hours, tasks };
}
