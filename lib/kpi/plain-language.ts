// ============================================================================
// KPI Plain Language Helpers
// Turns raw metrics and numbers into everyday human sentences
// ============================================================================

export interface StatusDisplayInfo {
  label: "On track" | "Slightly behind" | "Behind" | "No data yet";
  dotColor: string;
  textColor: string;
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
      };
    case "at_risk":
      return {
        label: "Slightly behind",
        dotColor: "bg-amber-500",
        textColor: "text-amber-900 font-bold",
      };
    case "behind":
      return {
        label: "Behind",
        dotColor: "bg-[#FF007A]",
        textColor: "text-[#FF007A] font-bold",
      };
    case "no_data":
    default:
      return {
        label: "No data yet",
        dotColor: "bg-[#808080]",
        textColor: "text-text-tertiary font-medium",
      };
  }
}

export interface HeadlineInfo {
  headline: string;
  statusKey: "on_track" | "at_risk" | "behind" | "no_data";
}

/**
 * Headline card information (sentence + status matching the first sentence)
 */
export function getHeadlineInfo(
  score: number | null,
  currentMetrics?: any,
  periodType: string = "month",
  target: number = 90
): HeadlineInfo {
  const periodWord = periodType === "quarter" ? "this quarter" : periodType === "week" ? "this week" : "this month";

  if (score == null) {
    return {
      headline: "Not enough data yet. Keep checking in and your result will appear.",
      statusKey: "no_data",
    };
  }

  // Identify evaluated metrics
  const metricList = [
    { label: "Hours", key: "worked_hours_vs_target", data: currentMetrics?.worked_hours_vs_target },
    { label: "Check-in days", key: "days_worked_vs_expected", data: currentMetrics?.days_worked_vs_expected },
    { label: "Punctuality", key: "on_time_check_in_rate", data: currentMetrics?.on_time_check_in_rate },
    { label: "Tasks", key: "tasks_completed_vs_assigned", data: currentMetrics?.tasks_completed_vs_assigned },
    { label: "Task delivery", key: "task_on_time_rate", data: currentMetrics?.task_on_time_rate },
  ].filter((m) => m.data && m.data.value != null && m.data.status !== "no_data");

  // Find weakest metric: first "behind", then "at_risk" (lowest score)
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

  // Overall is On track
  if (weakestMetric) {
    return {
      headline: `You're on track overall. ${weakestMetric.label} is slightly behind.`,
      statusKey: "on_track",
    };
  }

  // All fine
  return {
    headline: `You're on track ${periodWord}.`,
    statusKey: "on_track",
  };
}

/**
 * Headline card sentence (e.g. "You're on track this month.")
 */
export function getHeadlineSentence(
  score: number | null,
  currentMetrics?: any,
  periodType: string = "month",
  target: number = 90
): string {
  return getHeadlineInfo(score, currentMetrics, periodType, target).headline;
}

/**
 * Trend sentence (e.g. "+4 points since October" or "Same as October")
 */
export function getScoreTrendSentence(
  trend: number | null | undefined,
  previousPeriodName?: string
): string {
  if (trend == null) return "";
  const prevLabel = previousPeriodName || "last period";
  if (trend > 0) return `+${trend} points since ${prevLabel}`;
  if (trend < 0) return `${trend} points since ${prevLabel}`;
  return `Same as ${prevLabel}`;
}

/**
 * Attendance short reason sentence
 * E.g. "Present 13 of 15 working days, on time every day."
 */
export function getAttendanceReasonSentence(
  daysWorkedMetric?: any,
  onTimeMetric?: any
): string {
  if (!daysWorkedMetric || daysWorkedMetric.value == null) {
    return "No check-in punches recorded for this period.";
  }

  const breakdown = daysWorkedMetric.breakdown || "";
  const onTimeBreakdown = onTimeMetric?.breakdown || "";

  // Extract counts if available e.g. "13 on-time / 13 attended days"
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

/**
 * Tasks short reason sentence
 * E.g. "Tasks aren't included because none were assigned."
 */
export function getTasksReasonSentence(
  taskCompMetric?: any,
  taskOnTimeMetric?: any
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

/**
 * What to do next suggestions builder (up to 3 items)
 */
export interface NextActionItem {
  id: string;
  label: string;
  actionText: string;
  href?: string;
  tabTarget?: "overview" | "reviews_and_goals" | "team";
  trigger?: "self_review";
}

export function formatMissingDates(dates: string[]): string {
  if (!dates || dates.length === 0) return "";
  const formatted = dates.map((d) => {
    const dt = new Date(`${d}T00:00:00Z`);
    const day = dt.getUTCDate();
    const month = dt.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
    return `${day} ${month}`;
  });
  if (formatted.length === 1) return `Missing check-in on ${formatted[0]}`;
  if (formatted.length === 2) return `Missing check-in on ${formatted[0]} and ${formatted[1]}`;
  return `Missing check-in on ${formatted.slice(0, -1).join(", ")} and ${formatted[formatted.length - 1]}`;
}

export function getNextActionSuggestions(params: {
  daysWorkedMetric?: any;
  hasUnloggedDays?: boolean;
  unloggedCount?: number;
  missingDates?: string[];
  hasPendingSelfReview?: boolean;
  atRiskGoals?: Array<{ id: string; title: string }>;
  overdueTasksCount?: number;
}): NextActionItem[] {
  const actions: NextActionItem[] = [];

  // 1. Missing check-in days
  if (params.missingDates && params.missingDates.length > 0) {
    const firstDate = params.missingDates[0];
    actions.push({
      id: "unlogged_days",
      label: formatMissingDates(params.missingDates),
      actionText: "Request correction",
      href: `/requests?date=${firstDate}`,
    });
  } else if (params.unloggedCount && params.unloggedCount > 0) {
    actions.push({
      id: "unlogged_days",
      label: `${params.unloggedCount} unlogged workday${params.unloggedCount > 1 ? "s" : ""} in this period.`,
      actionText: "Request correction",
      href: "/requests",
    });
  }

  // 2. Pending self-review
  if (params.hasPendingSelfReview) {
    actions.push({
      id: "self_review",
      label: "Self-review reflection is open for this cycle.",
      actionText: "Write reflection",
      trigger: "self_review",
    });
  }

  // 3. Goal marked at risk
  if (params.atRiskGoals && params.atRiskGoals.length > 0) {
    const g = params.atRiskGoals[0];
    actions.push({
      id: `goal_${g.id}`,
      label: `Goal "${g.title}" is marked at risk.`,
      actionText: "View goals",
      tabTarget: "reviews_and_goals",
    });
  }

  // 4. Overdue tasks
  if (params.overdueTasksCount && params.overdueTasksCount > 0 && actions.length < 3) {
    actions.push({
      id: "overdue_tasks",
      label: `${params.overdueTasksCount} task${params.overdueTasksCount > 1 ? "s are" : " is"} past due date.`,
      actionText: "Open tasks",
      href: "/tasks",
    });
  }

  return actions.slice(0, 3);
}
