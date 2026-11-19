export interface FriendlyDueInfo {
  label: string;
  state: "overdue" | "due_today" | "due_tomorrow" | "due_future" | "completed" | "none";
  colorClass: string;
}

/**
 * Computes a human-friendly due date chip in Asia/Kolkata timezone:
 * - "Overdue by Xd" (red)
 * - "Due today" (amber)
 * - "Due tomorrow" (blue)
 * - "Due 20 Nov" (neutral subtle)
 */
export function formatFriendlyDueState(
  dueDateString: string | null | undefined,
  status?: string,
  timeZone: string = "Asia/Kolkata"
): FriendlyDueInfo {
  if (!dueDateString) {
    return { label: "", state: "none", colorClass: "" };
  }

  const cleanDueStr = dueDateString.slice(0, 10);
  const isCompleted = status === "done" || status === "cancelled";

  const [y, m, d] = cleanDueStr.split("-").map(Number);
  if (!y || !m || !d) {
    return { label: dueDateString, state: "none", colorClass: "bg-[#F5F5F5] text-[#808080] border border-[#E6E6E6]" };
  }

  // Create date object
  const dueDate = new Date(Date.UTC(y, m - 1, d));

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const formattedDayMonth = `${d} ${monthNames[m - 1]}`;

  if (isCompleted) {
    return {
      label: `Due ${formattedDayMonth}`,
      state: "completed",
      colorClass: "bg-[#F5F5F5] text-[#808080] border border-[#E6E6E6]",
    };
  }

  // Get current date string in Asia/Kolkata
  const now = new Date();
  const kolkataNowStr = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now); // "YYYY-MM-DD"

  const [ny, nm, nd] = kolkataNowStr.split("-").map(Number);
  const todayUtc = Date.UTC(ny, nm - 1, nd);
  const dueUtc = Date.UTC(y, m - 1, d);

  const diffDays = Math.round((dueUtc - todayUtc) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) {
    const overdueDays = Math.abs(diffDays);
    const label = overdueDays === 1 ? "Overdue by 1d" : `Overdue by ${overdueDays}d`;
    return {
      label,
      state: "overdue",
      colorClass: "bg-red-50 text-[#FF1493] border border-red-200 font-bold",
    };
  }

  if (diffDays === 0) {
    return {
      label: "Due today",
      state: "due_today",
      colorClass: "bg-amber-50 text-amber-800 border border-amber-200 font-bold",
    };
  }

  if (diffDays === 1) {
    return {
      label: "Due tomorrow",
      state: "due_tomorrow",
      colorClass: "bg-[#F5F5F5] text-black border border-[#E6E6E6] font-semibold",
    };
  }

  return {
    label: `Due ${formattedDayMonth}`,
    state: "due_future",
    colorClass: "bg-[#F5F5F5] text-[#808080] border border-[#E6E6E6]",
  };
}
