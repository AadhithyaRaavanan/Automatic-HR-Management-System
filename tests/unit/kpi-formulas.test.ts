import { describe, it, expect } from "vitest";
import {
  KPI_SOURCE_METRICS,
  computeWeightedKpiScore,
  buildEmployeeKpiTrend,
  formatKpiValue,
  getKpiBandLabel,
  getKpiMetricMeta,
  KpiPeriodRecord,
} from "@/features/kpi/helpers";
import {
  getScoreSummaryInfo,
  formatScoredMetricRow,
  getNextActionSuggestions,
} from "@/features/kpi/plain-language";
import { formatKpiPeriodLabel } from "@/features/kpi/date-helper";

describe("Section 4 KPI Helper & Weighting Formulas", () => {
  it("exposes all 8 canonical KPI source metrics", () => {
    expect(KPI_SOURCE_METRICS.map((m) => m.key)).toEqual([
      "attendance_on_time_rate",
      "hours_vs_target",
      "absence_days",
      "leave_days_taken",
      "tasks_completed",
      "tasks_on_time_rate",
      "tasks_overdue",
      "avg_task_cycle_days",
    ]);
    expect(getKpiMetricMeta("attendance_on_time_rate").unit).toBe("%");
    expect(getKpiMetricMeta("absence_days").defaultDirection).toBe("lower_is_better");
  });

  it("computes weighted average KPI scores for standard equal and custom positive weights", () => {
    expect(computeWeightedKpiScore([])).toBeNull();

    // Equal weights: (80 + 100) / 2 = 90
    expect(
      computeWeightedKpiScore([
        { score: 80, weight: 1 },
        { score: 100, weight: 1 },
      ])
    ).toBe(90);

    // Weighted: (100 * 3 + 50 * 1) / 4 = 87.5
    expect(
      computeWeightedKpiScore([
        { score: 100, weight: 3 },
        { score: 50, weight: 1 },
      ])
    ).toBe(87.5);
  });

  it("returns null when all weights are zero (NULLIF guard on weight sum)", () => {
    // All-zero weights: weight sum is 0, so NULLIF logic returns null ("not scored")
    expect(
      computeWeightedKpiScore([
        { score: 90, weight: 0 },
        { score: 80, weight: 0 },
      ])
    ).toBeNull();
  });

  it("excludes zero-weight items without diluting positive weights", () => {
    // Partial zero weights: zero-weight items do not contribute to total weight
    expect(
      computeWeightedKpiScore([
        { score: 150, weight: 0 },
        { score: 70, weight: 2 },
      ])
    ).toBe(70);
  });

  it("excludes unscored (null/NaN) metrics from both numerator and weight denominator", () => {
    expect(
      computeWeightedKpiScore([
        { score: null, weight: 3 },
        { score: Number.NaN, weight: 2 },
        { score: 80, weight: 2 },
      ])
    ).toBe(80);
  });

  it("returns null when all metrics are unscored", () => {
    expect(
      computeWeightedKpiScore([
        { score: null, weight: 1 },
        { score: null, weight: 2 },
      ])
    ).toBeNull();
  });

  it("formats KPI values and computes performance bands accurately", () => {
    expect(formatKpiValue(95.5, "%")).toBe("95.5%");
    expect(formatKpiValue(100, "%")).toBe("100%");
    expect(formatKpiValue(3, "tasks")).toBe("3 tasks");
    expect(formatKpiValue(null, "days")).toBe("No data");
    expect(formatKpiValue(undefined, "%")).toBe("No data");

    expect(getKpiBandLabel(null).label).toBe("Not Scored");
    expect(getKpiBandLabel(92).tone).toBe("success");
    expect(getKpiBandLabel(72).tone).toBe("warning");
    expect(getKpiBandLabel(42).tone).toBe("danger");
  });

  it("builds chronological multi-period employee score trends excluding empty periods", () => {
    const periods: KpiPeriodRecord[] = [
      {
        id: "p2",
        organization_id: "org1",
        name: "Feb 2026",
        period_type: "monthly",
        start_date: "2026-02-01",
        end_date: "2026-02-28",
        status: "open",
        closed_at: null,
        closed_by: null,
        created_by: "adm",
        created_at: "2026-02-01T00:00:00Z",
      },
      {
        id: "p1",
        organization_id: "org1",
        name: "Jan 2026",
        period_type: "monthly",
        start_date: "2026-01-01",
        end_date: "2026-01-31",
        status: "closed",
        closed_at: "2026-02-02T00:00:00Z",
        closed_by: "adm",
        created_by: "adm",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "p3",
        organization_id: "org1",
        name: "Mar 2026",
        period_type: "monthly",
        start_date: "2026-03-01",
        end_date: "2026-03-31",
        status: "open",
        closed_at: null,
        closed_by: null,
        created_by: "adm",
        created_at: "2026-03-01T00:00:00Z",
      },
    ];

    const scores = [
      { period_id: "p2", employee_id: "emp1", score: 90, weight: 2 },
      { period_id: "p2", employee_id: "emp1", score: 60, weight: 1 },
      { period_id: "p1", employee_id: "emp1", score: 75, weight: 1 },
      { period_id: "p3", employee_id: "other-emp", score: 95, weight: 1 },
    ];

    const trend = buildEmployeeKpiTrend(periods, scores, "emp1");
    expect(trend).toHaveLength(2);
    expect(trend[0].periodId).toBe("p1");
    expect(trend[0].overallScore).toBe(75);
    expect(trend[1].periodId).toBe("p2");
    expect(trend[1].overallScore).toBe(80); // (90*2 + 60*1)/3 = 80
  });

  it("explains score vs target accurately from real weighted metrics and distinguishes zero completed vs no tasks", () => {
    const metricsSample = {
      on_time_check_in_rate: {
        key: "on_time_check_in_rate",
        label: "On-Time Check-In Rate",
        value: 93,
        target: 95,
        status: "at_risk",
        displayValue: "93% (13/14 attended days)",
        breakdown: "13 on-time / 14 attended days",
      },
      days_worked_vs_expected: {
        key: "days_worked_vs_expected",
        label: "Days Worked vs Expected",
        value: 70,
        target: 100,
        status: "behind",
        displayValue: "14 of 20 scheduled days (70%)",
      },
      worked_hours_vs_target: {
        key: "worked_hours_vs_target",
        label: "Worked Hours vs Target",
        value: 73,
        target: 100,
        status: "behind",
        displayValue: "116.0h / 160.0h (73%)",
      },
      tasks_completed_vs_assigned: {
        key: "tasks_completed_vs_assigned",
        label: "Tasks Completed vs Assigned",
        value: 0,
        target: 90,
        status: "behind",
        displayValue: "0 / 4 (0%)",
      },
      task_on_time_rate: {
        key: "task_on_time_rate",
        label: "Task On-Time Completion Rate",
        value: null,
        target: 90,
        status: "no_data",
        displayValue: "No data",
      },
    };

    const summary = getScoreSummaryInfo({
      overallScore: 60,
      target: 90,
      currentMetrics: metricsSample,
      isSelfView: true,
    });
    expect(summary.comparisonLine).toBe("60% · Target 90% · 30 percentage points below target");
    expect(summary.explanationLine).toBe("You completed 0 of 4 assigned tasks this period.");
    expect(summary.primaryDragKey).toBe("tasks_completed_vs_assigned");

    expect(formatScoredMetricRow("on_time_check_in_rate", metricsSample.on_time_check_in_rate).actualText).toBe(
      "13 of 14 check-ins on time · 93%"
    );
    expect(
      formatScoredMetricRow("tasks_completed_vs_assigned", metricsSample.tasks_completed_vs_assigned, metricsSample).actualText
    ).toBe("0 of 4 tasks completed · 0%");
    expect(
      formatScoredMetricRow("task_on_time_rate", metricsSample.task_on_time_rate, metricsSample).actualText
    ).toBe("No completed tasks available to assess on-time delivery");

    // Zero assigned tasks is distinctly labeled instead of claiming 0 of N completed
    const noTasksMetrics = {
      ...metricsSample,
      tasks_completed_vs_assigned: { ...metricsSample.tasks_completed_vs_assigned, value: null, status: "no_data", displayValue: "No data" },
    };
    expect(
      formatScoredMetricRow("tasks_completed_vs_assigned", noTasksMetrics.tasks_completed_vs_assigned, noTasksMetrics).actualText
    ).toBe("No tasks assigned this period · Not counted");
    expect(
      formatScoredMetricRow("task_on_time_rate", noTasksMetrics.task_on_time_rate, noTasksMetrics).actualText
    ).toBe("No assigned tasks to assess");

    // Readable month-to-date period string
    expect(formatKpiPeriodLabel("month", "2026-11-01", "2026-11-27")).toBe("1–27 November · Month to date");
    expect(formatKpiPeriodLabel("month", "2026-10-01", "2026-10-31")).toBe("October 2026");

    // Next actions tailor actions by viewer role & summarize dates behind "View dates"
    const selfActions = getNextActionSuggestions({
      isSelfView: true,
      missingDates: ["2026-11-03", "2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"],
      hasPendingSelfReview: true,
    });
    expect(selfActions[0].actionText).toBe("Review 6 missing check-ins");
    expect(selfActions[0].dates).toHaveLength(6);
    expect(selfActions[1].actionText).toBe("Write self-review");

    const managerActions = getNextActionSuggestions({
      isSelfView: false,
      isManagerOrAdmin: true,
      employeeName: "Aanya Kapoor",
      hasSubmittedSelfReview: true,
      hasManagerReview: false,
      missingDates: ["2026-11-03", "2026-11-16"],
    });
    expect(managerActions[0].actionText).toBe("Write review");
    expect(managerActions[1].actionText).toBe("Inspect 2 missing check-ins");
  });
});

