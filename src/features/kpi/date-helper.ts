// ============================================================================
// Asia/Kolkata Date Helper for KPI Module
// Guaranteed zero-UTC-shift calendar calculations for period ranges and presets
// ============================================================================

export type KpiPeriodPreset = "week" | "month" | "quarter" | "custom";

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/**
 * Returns today's YYYY-MM-DD date in Asia/Kolkata timezone.
 */
export function getKolkataToday(): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());

  const year = parts.find((p) => p.type === "year")?.value || "2026";
  const month = parts.find((p) => p.type === "month")?.value || "11";
  const day = parts.find((p) => p.type === "day")?.value || "20";

  return `${year}-${pad2(Number(month))}-${pad2(Number(day))}`;
}

/**
 * Returns { year, month, day } of today in Asia/Kolkata timezone. (month is 1..12)
 */
export function getKolkataTodayParts(): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(new Date());

  const year = Number(parts.find((p) => p.type === "year")?.value || 2026);
  const month = Number(parts.find((p) => p.type === "month")?.value || 11);
  const day = Number(parts.find((p) => p.type === "day")?.value || 20);

  return { year, month, day };
}

/**
 * Computes exact Asia/Kolkata date ranges for period presets.
 * Default period: current month to date (e.g. 2026-11-01 to 2026-11-20).
 */
export function getKolkataPresetDates(
  preset: KpiPeriodPreset,
  baseYear?: number,
  baseMonth?: number // 1-based (1..12)
): { from: string; to: string } {
  const { year: nowYear, month: nowMonth, day: nowDay } = getKolkataTodayParts();
  const todayStr = `${nowYear}-${pad2(nowMonth)}-${pad2(nowDay)}`;

  const y = baseYear !== undefined ? baseYear : nowYear;
  const m = baseMonth !== undefined ? baseMonth : nowMonth;

  if (preset === "month") {
    const from = `${y}-${pad2(m)}-01`;
    const lastDayOfMonth = new Date(y, m, 0).getDate();
    const endOfMonth = `${y}-${pad2(m)}-${pad2(lastDayOfMonth)}`;
    // If viewing the active current month, default 'to' is current date in Kolkata
    const to = y === nowYear && m === nowMonth && todayStr < endOfMonth ? todayStr : endOfMonth;
    return { from, to };
  }

  if (preset === "week") {
    // 7 days ending today or on the target date
    const anchor = new Date(Date.UTC(y, m - 1, nowDay));
    const start = new Date(anchor.getTime() - 6 * 24 * 60 * 60 * 1000);
    const from = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-${pad2(start.getUTCDate())}`;
    return { from, to: todayStr };
  }

  if (preset === "quarter") {
    const q = Math.floor((m - 1) / 3); // 0..3
    const qStartMonth = q * 3 + 1;
    const qEndMonth = (q + 1) * 3;
    const from = `${y}-${pad2(qStartMonth)}-01`;
    const lastDayOfQ = new Date(y, qEndMonth, 0).getDate();
    const endOfQ = `${y}-${pad2(qEndMonth)}-${pad2(lastDayOfQ)}`;
    const to =
      y === nowYear && nowMonth >= qStartMonth && nowMonth <= qEndMonth && todayStr < endOfQ
        ? todayStr
        : endOfQ;
    return { from, to };
  }

  // Custom fallback
  return { from: `${y}-${pad2(m)}-01`, to: todayStr };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

/**
 * Builds the period label from the exact local start date without UTC conversion.
 * Format for month-to-date: "November 2026 (to 20 Nov)"
 */
export function formatKpiPeriodLabel(
  preset: KpiPeriodPreset,
  from: string,
  to: string
): string {
  if (!from || !to) return "";

  const [y, m, d] = from.split("-").map(Number);
  const [toY, toM, toD] = to.split("-").map(Number);

  if (preset === "month") {
    const monthName = MONTH_NAMES[m - 1] || "Month";
    const lastDay = new Date(y, m, 0).getDate();
    if (toD < lastDay) {
      return `${monthName} ${y} (to ${toD} ${MONTH_SHORT[toM - 1] || ""})`;
    }
    return `${monthName} ${y}`;
  }

  if (preset === "week") {
    return `${d} ${MONTH_SHORT[m - 1]} – ${toD} ${MONTH_SHORT[toM - 1]} ${toY}`;
  }

  if (preset === "quarter") {
    const q = Math.floor((m - 1) / 3) + 1;
    const qEndMonth = q * 3;
    const lastDay = new Date(y, qEndMonth, 0).getDate();
    if (toM < qEndMonth || toD < lastDay) {
      return `Q${q} ${y} (to ${toD} ${MONTH_SHORT[toM - 1]})`;
    }
    return `Q${q} ${y}`;
  }

  return `${from} to ${to}`;
}
