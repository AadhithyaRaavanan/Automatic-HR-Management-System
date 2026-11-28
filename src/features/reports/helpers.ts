export interface MonthCloseChecklistState {
  year: number;
  month: number;
  period_start: string;
  period_end: string;
  open_sessions_count: number;
  pending_regularizations_count: number;
  pending_leaves_count: number;
  locked_days_count: number;
  unlocked_days_count: number;
  total_days_count: number;
  is_month_locked: boolean;
  ready_to_lock: boolean;
}

export function getPendingChecklistBlockers(
  checklist: MonthCloseChecklistState | null | undefined
): string[] {
  if (!checklist) return [];
  const blockers: string[] = [];
  if ((checklist.open_sessions_count || 0) > 0) {
    blockers.push(
      `${checklist.open_sessions_count} open shift session${checklist.open_sessions_count === 1 ? "" : "s"}`
    );
  }
  if ((checklist.pending_regularizations_count || 0) > 0) {
    blockers.push(
      `${checklist.pending_regularizations_count} pending attendance correction${checklist.pending_regularizations_count === 1 ? "" : "s"}`
    );
  }
  if ((checklist.pending_leaves_count || 0) > 0) {
    blockers.push(
      `${checklist.pending_leaves_count} pending leave request${checklist.pending_leaves_count === 1 ? "" : "s"}`
    );
  }
  return blockers;
}

export function canLockPayrollMonth(params: {
  checklist: MonthCloseChecklistState | null;
  checklistLoading: boolean;
  checklistError: string | null;
  reportsLoading: boolean;
  reportsError: string | null;
  lockingMonth: boolean;
}): boolean {
  const {
    checklist,
    checklistLoading,
    checklistError,
    reportsLoading,
    reportsError,
    lockingMonth,
  } = params;

  if (lockingMonth || checklistLoading || Boolean(checklistError)) return false;
  if (reportsLoading || Boolean(reportsError)) return false;
  if (!checklist || checklist.is_month_locked || !checklist.ready_to_lock) return false;
  return true;
}

export function paginateReportRows<T>(rows: T[], page: number, pageSize = 50) {
  const safeSize = Math.max(1, pageSize);
  const totalCount = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalCount / safeSize));
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const startIndex = (currentPage - 1) * safeSize;
  const endIndex = Math.min(startIndex + safeSize, totalCount);
  return {
    items: rows.slice(startIndex, endIndex),
    currentPage,
    totalPages,
    totalCount,
    startDisplay: totalCount === 0 ? 0 : startIndex + 1,
    endDisplay: endIndex,
  };
}
