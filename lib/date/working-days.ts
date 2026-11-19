/**
 * Working-day due date calculation for Asia/Kolkata timezone.
 * Skips Saturday/Sunday and active holidays.
 */

export interface SuggestedDueInfo {
  dateStr: string; // YYYY-MM-DD
  displayLabel: string; // e.g. "24 Nov (2 working days)"
  shortDate: string; // e.g. "24 Nov"
}

export function calculateWorkingDaysAhead(
  workingDays: number,
  holidays: Array<{ date: string }> = [],
  startDate?: Date | string,
  timeZone: string = "Asia/Kolkata"
): SuggestedDueInfo {
  const holidaySet = new Set(holidays.map((h) => h.date.slice(0, 10)));

  // Resolve current date in Asia/Kolkata
  let current: Date;
  if (typeof startDate === "string") {
    const [y, m, d] = startDate.slice(0, 10).split("-").map(Number);
    current = new Date(Date.UTC(y, m - 1, d));
  } else if (startDate instanceof Date) {
    current = new Date(startDate.getTime());
  } else {
    const now = new Date();
    const kolkataStr = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(now);
    const [y, m, d] = kolkataStr.split("-").map(Number);
    current = new Date(Date.UTC(y, m - 1, d));
  }

  if (workingDays <= 0) {
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, "0");
    const d = String(current.getUTCDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    const shortDate = `${current.getUTCDate()} ${months[current.getUTCMonth()]}`;
    return {
      dateStr,
      shortDate,
      displayLabel: `${shortDate} (today)`,
    };
  }

  let added = 0;
  // Step forward day by day
  while (added < workingDays) {
    current.setUTCDate(current.getUTCDate() + 1);
    const dayOfWeek = current.getUTCDay(); // 0 = Sun, 6 = Sat

    if (dayOfWeek === 0 || dayOfWeek === 6) {
      continue;
    }

    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, "0");
    const d = String(current.getUTCDate()).padStart(2, "0");
    const dateStr = `${y}-${m}-${d}`;

    if (holidaySet.has(dateStr)) {
      continue;
    }

    added++;
  }

  const y = current.getUTCFullYear();
  const m = String(current.getUTCMonth() + 1).padStart(2, "0");
  const d = String(current.getUTCDate()).padStart(2, "0");
  const dateStr = `${y}-${m}-${d}`;

  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const shortDate = `${current.getUTCDate()} ${months[current.getUTCMonth()]}`;
  const dayWord = workingDays === 1 ? "working day" : "working days";
  const displayLabel = `${shortDate} (${workingDays} ${dayWord})`;

  return {
    dateStr,
    shortDate,
    displayLabel,
  };
}

/**
 * Counts working days between two date strings (inclusive),
 * skipping Saturday, Sunday, and holidays.
 */
export function countWorkingDaysBetween(
  startDateStr: string,
  endDateStr: string,
  holidays: Array<{ date: string }> = []
): number {
  if (!startDateStr || !endDateStr || startDateStr > endDateStr) return 0;
  const holidaySet = new Set(holidays.map((h) => h.date.slice(0, 10)));
  const [sy, sm, sd] = startDateStr.slice(0, 10).split("-").map(Number);
  const [ey, em, ed] = endDateStr.slice(0, 10).split("-").map(Number);
  const current = new Date(Date.UTC(sy, sm - 1, sd));
  const end = new Date(Date.UTC(ey, em - 1, ed));

  let count = 0;
  while (current <= end) {
    const dow = current.getUTCDay();
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, "0");
    const d = String(current.getUTCDate()).padStart(2, "0");
    const dStr = `${y}-${m}-${d}`;

    if (dow !== 0 && dow !== 6 && !holidaySet.has(dStr)) {
      count++;
    }
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return count;
}
