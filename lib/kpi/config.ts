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
  // Weights for computing the optional overall score (must sum to 1.0)
  weights: {
    on_time_check_in_rate: 0.20,
    days_worked_vs_expected: 0.20,
    worked_hours_vs_target: 0.25,
    tasks_completed_vs_assigned: 0.20,
    task_on_time_rate: 0.15,
  } as Record<string, number>,

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
      hoursPerDay: 6,
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
