// ============================================================================
// KPI Plain Language Helpers
// Turns raw metrics and numbers into everyday human sentences backed by
// real weights, counts, and targets.
// ============================================================================

import { KPI_CONFIG } from "@/features/kpi/config";

export interface StatusDisplayInfo {
  label: "On track" | "Slightly behind" | "Behind" | "No data yet";
  dotColor: string;
  textColor: string;
  badgeBg: string;
}

export function getStatusDisplay(
  status: "on_track" | "at_risk" | "behind" | "no_data" | string | null | undefined
): StatusDisplayInfo {
  switch (status) {
    case "on_track":
      return {
        label: "On track",
        dotColor: "bg-[#B7FF00]",
        textColor: "text-text-primary font-bold",
        badgeBg: "bg-[#B7FF00]/20 border-[#B7FF00]/60 text-black",
      };
    case "at_risk":
      return {
        label: "Slightly behind",
        dotColor: "bg-amber-500",
        textColor: "text-amber-900 font-bold",
        badgeBg: "bg-amber-50 border-amber-200 text-amber-900",
      };
    case "behind":
      return {
        label: "Behind",
        dotColor: "bg-[#FF007A]",
        textColor: "text-[#FF007A] font-bold",
        badgeBg: "bg-rose-50 border-rose-200 text-[#FF007A]",
      };
    case "no_data":
    default:
      return {
        label: "No data yet",
        dotColor: "bg-[#808080]",
        textColor: "text-text-tertiary font-medium",
        badgeBg: "bg-card-subtle border-border-light text-text-tertiary",
      };
  }
}

export interface HeadlineInfo {
  headline: string;
  statusKey: "on_track" | "at_risk" | "behind" | "no_data";
}

/**
 * Legacy helper kept for compatibility; prefers real metric data.
 */
export function getHeadlineInfo(
  score: number | null,
  currentMetrics?: any,
  periodType: string = "month",
  target: number = 90
): HeadlineInfo {
  const periodWord = periodType === "quarter" ? "this quarter" : periodType === "week" ? "this week" : "this period";

  if (score == null) {
    return {
      headline: "Not enough data yet. Keep checking in and your score will appear.",
      statusKey: "no_data",
    };
  }

  const metricList = [
    { label: "Hours", key: "worked_hours_vs_target", data: currentMetrics?.worked_hours_vs_target },
    { label: "Check-in days", key: "days_worked_vs_expected", data: currentMetrics?.days_worked_vs_expected },
    { label: "Punctuality", key: "on_time_check_in_rate", data: currentMetrics?.on_time_check_in_rate },
    { label: "Tasks", key: "tasks_completed_vs_assigned", data: currentMetrics?.tasks_completed_vs_assigned },
    { label: "Task delivery", key: "task_on_time_rate", data: currentMetrics?.task_on_time_rate },
  ].filter((m) => m.data && m.data.value != null && m.data.status !== "no_data");

  const behindMetrics = metricList.filter((m) => m.data?.status === "behind");
  const atRiskMetrics = metricList.filter((m) => m.data?.status === "at_risk");

  let weakestMetric: { label: string; data: any } | null = null;
  if (behindMetrics.length > 0) {
    behindMetrics.sort((a, b) => (a.data?.value ?? 0) - (b.data?.value ?? 0));
    weakestMetric = behindMetrics[0];
  } else if (atRiskMetrics.length > 0) {
    atRiskMetrics.sort((a, b) => (a.data?.value ?? 0) - (b.data?.value ?? 0));
    weakestMetric = atRiskMetrics[0];
  }

  const isOverallOnTrack = score >= target;
  const isOverallBehind = score < target - 10;

  if (isOverallBehind) {
    const extra = weakestMetric ? ` ${weakestMetric.label} is behind.` : "";
    return {
      headline: `Behind ${periodWord}.${extra}`,
      statusKey: "behind",
    };
  }

  if (!isOverallOnTrack) {
    const extra = weakestMetric ? ` ${weakestMetric.label} is slightly behind.` : "";
    return {
      headline: `Slightly behind ${periodWord}.${extra}`,
      statusKey: "at_risk",
    };
  }

  if (weakestMetric) {
    return {
      headline: `On track overall. ${weakestMetric.label} is slightly behind.`,
      statusKey: "on_track",
    };
  }

  return {
    headline: `On track ${periodWord}.`,
    statusKey: "on_track",
  };
}

export function getHeadlineSentence(
  score: number | null,
  currentMetrics?: any,
  periodType: string = "month",
  target: number = 90
): string {
  return getHeadlineInfo(score, currentMetrics, periodType, target).headline;
}

export function getScoreTrendSentence(
  trend: number | null | undefined,
  previousPeriodName?: string
): string {
  if (trend == null) return "";
  const prevLabel = previousPeriodName || "prior period";
  if (trend > 0) return `+${trend} pts vs ${prevLabel}`;
  if (trend < 0) return `${trend} pts vs ${prevLabel}`;
  return `Unchanged vs ${prevLabel}`;
}

export interface ScoreSummaryInfo {
  statusKey: "on_track" | "at_risk" | "behind" | "no_data";
  comparisonLine: string;
  explanationLine: string;
  primaryDragKey: string | null;
}

/**
 * Computes a truthful compact score summary grounded strictly in real
 * counts, targets, and scoring weights. Never fabricates a "biggest contributor"
 * when weights don't back it up or when data is missing.
 */
export function getScoreSummaryInfo(params: {
  overallScore: number | null;
  target?: number;
  currentMetrics?: Record<string, any> | null;
  customWeights?: Record<string, number> | null;
  isSelfView?: boolean;
  subjectName?: string;
  hasElapsedEligibleDays?: boolean;
  joinedOn?: string | null;
}): ScoreSummaryInfo {
  const {
    overallScore,
    target = KPI_CONFIG.overallTarget || 90,
    currentMetrics,
    customWeights,
    isSelfView = true,
    subjectName = "Employee",
    hasElapsedEligibleDays = true,
    joinedOn = null,
  } = params;

  const actor = isSelfView ? "You" : subjectName;
  const actorLower = isSelfView ? "your" : `${subjectName}'s`;

  if (overallScore == null) {
    const hasDays = currentMetrics?.days_worked_vs_expected?.value != null;
    const hasTasks = currentMetrics?.tasks_completed_vs_assigned?.value != null;
    let explanationLine =
      "Not enough check-in or task activity in this period to calculate a weighted score yet.";
    if (!hasElapsedEligibleDays && !hasDays && !hasTasks) {
      explanationLine = joinedOn
        ? `No eligible workdays have elapsed yet in this period (joined ${joinedOn}). Scheduled tracking starts on the first workday on or after ${joinedOn}.`
        : "No eligible workdays have elapsed yet in this period.";
    } else if (hasDays && !hasTasks) {
      explanationLine =
        "Only partial attendance data is logged so far; at least two active measures are required for a score.";
    } else if (!hasDays && hasTasks) {
      const m = currentMetrics?.tasks_completed_vs_assigned?.displayValue?.match(/(\d+)\s*\/\s*(\d+)/);
      explanationLine = m
        ? `${actor} have ${m[1]} of ${m[2]} assigned tasks completed with no check-ins logged yet.`
        : "Tasks are assigned, but no attendance check-ins are logged yet in this period.";
    }

    return {
      statusKey: "no_data",
      comparisonLine: `No score yet · Target ${target}%`,
      explanationLine,
      primaryDragKey: null,
    };
  }

  const statusKey: ScoreSummaryInfo["statusKey"] =
    overallScore >= target
      ? "on_track"
      : overallScore >= target - 10
      ? "at_risk"
      : "behind";

  const diff = overallScore - target;
  const absDiff = Math.abs(diff);
  const ptsUnit = absDiff === 1 ? "percentage point" : "percentage points";
  const comparisonLine =
    diff < 0
      ? `${overallScore}% · Target ${target}% · ${absDiff} ${ptsUnit} below target`
      : diff > 0
      ? `${overallScore}% · Target ${target}% · ${absDiff} ${ptsUnit} above target`
      : `${overallScore}% · Target ${target}% · On target`;

  // Compute exact weighted shortfall across active scored metrics to find the genuine top drag
  const weights = customWeights || KPI_CONFIG.weights;
  const scoredKeys = [
    "on_time_check_in_rate",
    "days_worked_vs_expected",
    "worked_hours_vs_target",
    "tasks_completed_vs_assigned",
    "task_on_time_rate",
  ] as const;

  const activeItems = scoredKeys
    .map((key) => {
      const item = currentMetrics?.[key];
      const w = Number(weights[key] ?? KPI_CONFIG.weights[key] ?? 0);
      if (!item || typeof item.value !== "number" || isNaN(item.value) || w <= 0) {
        return null;
      }
      const cappedVal = Math.min(100, Math.max(0, item.value));
      const itemTarget = Number(item.target ?? target);
      const shortfall = Math.max(0, itemTarget - cappedVal);
      return { key, item, weight: w, shortfall, weightedDrag: shortfall * w };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const activeWeightSum = activeItems.reduce((sum, x) => sum + x.weight, 0);
  const sortedByDrag = [...activeItems]
    .filter((x) => x.weightedDrag > 0)
    .sort((a, b) => b.weightedDrag - a.weightedDrag);

  const topDrag = sortedByDrag[0] || null;
  const secondDrag = sortedByDrag[1] || null;
  const tasksAssigned = currentMetrics?.tasks_completed_vs_assigned;
  const noTasksAssigned =
    !tasksAssigned || tasksAssigned.value == null || tasksAssigned.status === "no_data";

  const formatDragExplanation = (key: string, metric: any): string => {
    if (key === "tasks_completed_vs_assigned") {
      const m = metric.displayValue?.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) return `${actor} completed ${m[1]} of ${m[2]} assigned tasks this period.`;
    }
    if (key === "task_on_time_rate") {
      const m = metric.displayValue?.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) return `${actor} delivered ${m[1]} of ${m[2]} completed tasks on time this period.`;
    }
    if (key === "days_worked_vs_expected") {
      const m = metric.displayValue?.match(/([\d.]+)\s+of\s+([\d.]+)/);
      if (m) return `${actor} checked in on ${m[1]} of ${m[2]} scheduled workdays this period.`;
    }
    if (key === "worked_hours_vs_target") {
      const m = metric.displayValue?.match(/([\d.]+)h\s*\/\s*([\d.]+)h/);
      if (m) return `${actor} logged ${m[1]}h of ${m[2]}h expected hours this period.`;
    }
    if (key === "on_time_check_in_rate") {
      const m = (metric.breakdown || metric.displayValue || "").match(/(\d+)\s*(?:on-time\s*)?\/\s*(\d+)/);
      if (m) return `${actor} arrived on time on ${m[1]} of ${m[2]} finalized workdays this period.`;
    }
    return `${metric.label} is at ${metric.value}% against a ${metric.target ?? target}% target.`;
  };

  let explanationLine: string;
  if (topDrag) {
    // Share clear factual sentence; mention whether it clearly drives the gap only if mathematically top drag
    const baseSentence = formatDragExplanation(topDrag.key, topDrag.item);
    const activeWeightPct = Math.round(activeWeightSum * 100);
    if (noTasksAssigned && activeWeightPct < 100) {
      explanationLine = `${baseSentence} Tasks aren't included because none were assigned.`;
    } else if (
      secondDrag &&
      Math.abs(topDrag.weightedDrag - secondDrag.weightedDrag) < 1 &&
      topDrag.key === "days_worked_vs_expected" &&
      secondDrag.key === "worked_hours_vs_target"
    ) {
      const daysMatch = topDrag.item.displayValue?.match(/([\d.]+)\s+of\s+([\d.]+)/);
      const hrsMatch = secondDrag.item.displayValue?.match(/([\d.]+)h\s*\/\s*([\d.]+)h/);
      explanationLine =
        daysMatch && hrsMatch
          ? `${actor} checked in on ${daysMatch[1]} of ${daysMatch[2]} scheduled workdays (${hrsMatch[1]}h of ${hrsMatch[2]}h logged).`
          : baseSentence;
    } else {
      explanationLine = baseSentence;
    }
  } else if (noTasksAssigned) {
    explanationLine = `Attendance and hours are meeting target for ${actorLower} schedule. No tasks were assigned this period.`;
  } else {
    explanationLine = "All scored attendance, hours, and task measures are meeting target this period.";
  }

  return {
    statusKey,
    comparisonLine,
    explanationLine,
    primaryDragKey: topDrag?.key || null,
  };
}

export interface FormattedMetricRow {
  key: string;
  label: string;
  actualText: string;
  targetText: string;
  status: StatusDisplayInfo;
  hasData: boolean;
  adjusted?: boolean;
  adjustmentReason?: string;
}

/**
 * Formats each scored metric row in human-readable language.
 * Clearly distinguishes `0 of N completed` from `no completed tasks available`.
 */
export function formatScoredMetricRow(
  key: string,
  metric: any,
  allMetrics?: Record<string, any>
): FormattedMetricRow {
  const status = getStatusDisplay(metric?.status);
  const hasData = metric?.value != null && metric?.status !== "no_data";
  const targetText = metric?.target != null ? `Target ${metric.target}%` : "Tracked";

  if (key === "on_time_check_in_rate") {
    let actualText = "No check-ins recorded";
    if (metric?.adjusted && metric?.value != null) {
      actualText = `${metric.value}% (adjusted)`;
    } else if (hasData) {
      const m = (metric.breakdown || metric.displayValue || "").match(/(\d+)\s*(?:on-time\s*)?\/\s*(\d+)/);
      actualText = m
        ? `${m[1]} of ${m[2]} check-ins on time · ${metric.value}%`
        : `${metric.value}%`;
    }
    return {
      key,
      label: "On-time check-ins",
      actualText,
      targetText,
      status,
      hasData,
      adjusted: metric?.adjusted,
      adjustmentReason: metric?.adjustmentReason,
    };
  }

  if (key === "days_worked_vs_expected") {
    let actualText = "No check-ins recorded";
    if (metric?.adjusted && metric?.value != null) {
      actualText = `${metric.value}% (adjusted)`;
    } else if (hasData) {
      const m = (metric.displayValue || "").match(/([\d.]+)\s+of\s+([\d.]+)/);
      actualText = m
        ? `${m[1]} of ${m[2]} scheduled days · ${metric.value}%`
        : metric.displayValue;
    }
    return {
      key,
      label: "Days present",
      actualText,
      targetText,
      status,
      hasData,
      adjusted: metric?.adjusted,
      adjustmentReason: metric?.adjustmentReason,
    };
  }

  if (key === "worked_hours_vs_target") {
    let actualText = "No hours logged";
    if (metric?.adjusted && metric?.value != null) {
      actualText = `${metric.value}% (adjusted)`;
    } else if (hasData) {
      const m = (metric.displayValue || "").match(/([\d.]+)h\s*\/\s*([\d.]+)h/);
      actualText = m
        ? `${m[1]}h of ${m[2]}h logged · ${metric.value}%`
        : metric.displayValue;
    }
    return {
      key,
      label: "Hours logged",
      actualText,
      targetText,
      status,
      hasData,
      adjusted: metric?.adjusted,
      adjustmentReason: metric?.adjustmentReason,
    };
  }

  if (key === "tasks_completed_vs_assigned") {
    let actualText = "No tasks assigned this period · Not counted";
    if (metric?.adjusted && metric?.value != null) {
      actualText = `${metric.value}% (adjusted)`;
    } else if (hasData) {
      const m = (metric.displayValue || "").match(/(\d+)\s*\/\s*(\d+)/);
      actualText = m
        ? `${m[1]} of ${m[2]} tasks completed · ${metric.value}%`
        : metric.displayValue;
    }
    return {
      key,
      label: "Tasks completed",
      actualText,
      targetText,
      status,
      hasData,
      adjusted: metric?.adjusted,
      adjustmentReason: metric?.adjustmentReason,
    };
  }

  // task_on_time_rate
  const compMetric = allMetrics?.tasks_completed_vs_assigned;
  const compMatch = compMetric?.displayValue?.match(/(\d+)\s*\/\s*(\d+)/);
  const completedCount = compMatch ? parseInt(compMatch[1], 10) : 0;
  const assignedCount = compMatch ? parseInt(compMatch[2], 10) : 0;

  let actualText = "No assigned tasks to assess";
  if (metric?.adjusted && metric?.value != null) {
    actualText = `${metric.value}% (adjusted)`;
  } else if (hasData) {
    const m = (metric.displayValue || "").match(/(\d+)\s*\/\s*(\d+)/);
    actualText = m
      ? `${m[1]} of ${m[2]} completed tasks on time · ${metric.value}%`
      : `${metric.value}%`;
  } else if (assignedCount > 0 && completedCount === 0) {
    actualText = "No completed tasks available to assess on-time delivery";
  } else if (completedCount > 0) {
    actualText = "Completed tasks had no due dates set";
  }

  return {
    key,
    label: "Task on-time delivery",
    actualText,
    targetText,
    status,
    hasData,
    adjusted: metric?.adjusted,
    adjustmentReason: metric?.adjustmentReason,
  };
}

export function getAttendanceReasonSentence(
  daysWorkedMetric?: any,
  onTimeMetric?: any
): string {
  if (!daysWorkedMetric || daysWorkedMetric.value == null) {
    return "No check-in punches recorded for this period.";
  }

  const onTimeBreakdown = onTimeMetric?.breakdown || "";
  const onTimeMatch = onTimeBreakdown.match(/(\d+)\s+on-time\s*\/\s*(\d+)/);
  const onTimeDays = onTimeMatch ? parseInt(onTimeMatch[1], 10) : null;
  const totalAttended = onTimeMatch ? parseInt(onTimeMatch[2], 10) : null;

  const daysMatch = daysWorkedMetric.displayValue?.match(/(\d+)\s+of\s+(\d+)/);
  const worked = daysMatch ? daysMatch[1] : totalAttended ? String(totalAttended) : null;
  const expected = daysMatch ? daysMatch[2] : null;

  if (worked && expected) {
    if (onTimeDays != null && totalAttended != null && onTimeDays === totalAttended) {
      return `Present ${worked} of ${expected} working days, on time every day.`;
    }
    if (onTimeDays != null && onTimeDays < (totalAttended || 0)) {
      return `Present ${worked} of ${expected} working days, ${onTimeDays} on time.`;
    }
    return `Present ${worked} of ${expected} scheduled working days.`;
  }

  if (worked) {
    return `Present for ${worked} working days in this period.`;
  }

  return "Punches and hours recorded for this period.";
}

export function getTasksReasonSentence(
  taskCompMetric?: any,
  _taskOnTimeMetric?: any
): string {
  if (!taskCompMetric || taskCompMetric.value == null || taskCompMetric.status === "no_data") {
    return "Tasks aren't included because none were assigned.";
  }

  const compMatch = taskCompMetric.displayValue?.match(/(\d+)\s*\/\s*(\d+)/);
  const done = compMatch ? compMatch[1] : null;
  const total = compMatch ? compMatch[2] : null;

  if (done && total) {
    if (done === total) {
      return `All ${total} assigned tasks completed.`;
    }
    return `Completed ${done} of ${total} assigned tasks.`;
  }

  return `${taskCompMetric.displayValue} completed for this period.`;
}

export interface NextActionItem {
  id: string;
  label: string;
  actionText: string;
  href?: string;
  tabTarget?: "overview" | "reviews_and_goals" | "team";
  trigger?: "self_review" | "write_review" | "inspect_days" | "inspect_overdue_tasks";
  dates?: string[];
  primary?: boolean;
}

export function formatShortDateList(dates: string[]): string[] {
  return (dates || []).map((d) => {
    const dt = new Date(`${d}T00:00:00Z`);
    const day = dt.getUTCDate();
    const month = dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return `${day} ${month}`;
  });
}

export function formatMissingDates(dates: string[]): string {
  if (!dates || dates.length === 0) return "";
  const formatted = formatShortDateList(dates);
  if (formatted.length === 1) return `Missing check-in on ${formatted[0]}`;
  if (formatted.length === 2) return `Missing check-in on ${formatted[0]} and ${formatted[1]}`;
  return `Missing check-in on ${formatted.slice(0, -1).join(", ")} and ${formatted[formatted.length - 1]}`;
}

export function getNextActionSuggestions(params: {
  isSelfView?: boolean;
  isManagerOrAdmin?: boolean;
  employeeName?: string;
  daysWorkedMetric?: any;
  hasUnloggedDays?: boolean;
  unloggedCount?: number;
  missingDates?: string[];
  hasPendingSelfReview?: boolean;
  hasSubmittedSelfReview?: boolean;
  hasManagerReview?: boolean;
  atRiskGoals?: Array<{ id: string; title: string }>;
  overdueTasksCount?: number;
}): NextActionItem[] {
  const {
    isSelfView = true,
    isManagerOrAdmin = false,
    employeeName = "this employee",
    unloggedCount = 0,
    missingDates = [],
    hasPendingSelfReview = false,
    hasSubmittedSelfReview = false,
    hasManagerReview = false,
    atRiskGoals = [],
    overdueTasksCount = 0,
  } = params;

  const actions: NextActionItem[] = [];
  const missingCount = missingDates.length > 0 ? missingDates.length : unloggedCount;

  if (!isSelfView && isManagerOrAdmin) {
    // Manager viewing another team member
    if (!hasManagerReview) {
      actions.push({
        id: "manager_review",
        label: hasSubmittedSelfReview
          ? `${employeeName} submitted a self-review ready for your evaluation.`
          : `Performance review is pending for ${employeeName}.`,
        actionText: "Write review",
        trigger: "write_review",
        primary: true,
      });
    }

    if (missingCount > 0) {
      actions.push({
        id: "unlogged_days",
        label:
          missingCount === 1
            ? `${employeeName} has 1 missing check-in this period.`
            : `${employeeName} has ${missingCount} missing check-ins this period.`,
        actionText:
          missingCount === 1 ? "Inspect missing check-in" : `Inspect ${missingCount} missing check-ins`,
        trigger: "inspect_days",
        dates: missingDates.length > 0 ? formatShortDateList(missingDates) : undefined,
        primary: actions.length === 0,
      });
    }

    if (atRiskGoals.length > 0) {
      const g = atRiskGoals[0];
      actions.push({
        id: `goal_${g.id}`,
        label: `Goal "${g.title}" is marked at risk.`,
        actionText: "Review goals",
        tabTarget: "reviews_and_goals",
      });
    }

    if (overdueTasksCount > 0 && actions.length < 3) {
      actions.push({
        id: "overdue_tasks",
        label: `${employeeName} has ${overdueTasksCount} overdue task${overdueTasksCount > 1 ? "s" : ""}.`,
        actionText: "Inspect overdue tasks",
        trigger: "inspect_overdue_tasks",
      });
    }

    return actions.slice(0, 3);
  }

  // Self view (employee viewing their own KPI)
  if (missingCount > 0) {
    const firstDate = missingDates[0];
    actions.push({
      id: "unlogged_days",
      label:
        missingCount === 1
          ? "1 scheduled workday is missing a check-in."
          : `${missingCount} scheduled workdays are missing check-ins.`,
      actionText:
        missingCount === 1 ? "Review 1 missing check-in" : `Review ${missingCount} missing check-ins`,
      href: firstDate ? `/requests?date=${firstDate}` : "/requests",
      dates: missingDates.length > 0 ? formatShortDateList(missingDates) : undefined,
      primary: true,
    });
  }

  if (hasPendingSelfReview) {
    actions.push({
      id: "self_review",
      label: "Your self-review reflection is open for this cycle.",
      actionText: "Write self-review",
      trigger: "self_review",
      primary: actions.length === 0,
    });
  }

  if (atRiskGoals.length > 0) {
    const g = atRiskGoals[0];
    actions.push({
      id: `goal_${g.id}`,
      label: `Goal "${g.title}" is marked at risk.`,
      actionText: "Update goal",
      tabTarget: "reviews_and_goals",
    });
  }

  if (overdueTasksCount > 0 && actions.length < 3) {
    actions.push({
      id: "overdue_tasks",
      label: `${overdueTasksCount} assigned task${overdueTasksCount > 1 ? "s are" : " is"} past due date.`,
      actionText: "Open tasks",
      href: "/tasks",
    });
  }

  return actions.slice(0, 3);
}
