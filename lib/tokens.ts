/**
 * Design Tokens for Pulse HRMS Desktop Experience
 * Supported widths: 1024px min, 1280px & 1536px main
 */

export const DESIGN_TOKENS = {
  radius: {
    card: "rounded-[24px]",
    cardLarge: "rounded-[28px]",
    button: "rounded-xl",
    pill: "rounded-full",
    badge: "rounded-full",
  },
  shadow: {
    card: "shadow-card",
    elevated: "shadow-shell",
    subtle: "shadow-xs",
  },
  border: {
    default: "border border-border-light",
    subtle: "border border-border-light/60",
    focus: "focus-visible:ring-2 focus-visible:ring-brand-purple focus-visible:outline-none",
  },
  colors: {
    brandPurple: "#6366F1",
    brandNavy: "#0B0E14",
    cardBg: "bg-card",
    cardSubtle: "bg-card-subtle",
    canvas: "bg-canvas",
  },
  status: {
    on_track: {
      bg: "bg-emerald-500/10",
      text: "text-emerald-700 dark:text-emerald-400",
      border: "border-emerald-500/20",
      dot: "bg-emerald-500",
      label: "On Track",
    },
    at_risk: {
      bg: "bg-amber-500/10",
      text: "text-amber-700 dark:text-amber-400",
      border: "border-amber-500/20",
      dot: "bg-amber-500",
      label: "At Risk",
    },
    behind: {
      bg: "bg-rose-500/10",
      text: "text-rose-700 dark:text-rose-400",
      border: "border-rose-500/20",
      dot: "bg-rose-500",
      label: "Behind",
    },
    no_data: {
      bg: "bg-slate-500/10",
      text: "text-slate-600 dark:text-slate-400",
      border: "border-slate-500/20",
      dot: "bg-slate-400",
      label: "No Data",
    },
  },
} as const;
