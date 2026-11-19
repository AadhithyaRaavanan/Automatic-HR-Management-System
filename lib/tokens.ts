/**
 * Design Tokens for Pulse HRMS Desktop Experience
 * Supported widths: 1024px min, 1280px & 1536px main
 */

export const DESIGN_TOKENS = {
  radius: {
    card: "rounded-xl",
    cardLarge: "rounded-xl",
    button: "rounded-lg",
    pill: "rounded-md",
    badge: "rounded-md",
  },
  shadow: {
    card: "",
    elevated: "shadow-float",
    subtle: "",
  },
  border: {
    default: "border border-border-light",
    subtle: "border border-border-light/60",
    focus: "focus-visible:ring-2 focus-visible:ring-black focus-visible:ring-offset-2 focus-visible:outline-none",
  },
  colors: {
    black: "#000000",
    white: "#FFFFFF",
    lime: "#A6F000",
    magenta: "#F00091",
    grey900: "#1A1A1A",
    grey700: "#4D4D4D",
    grey500: "#808080",
    grey300: "#B3B3B3",
    grey100: "#E6E6E6",
    cardBg: "bg-card",
    cardSubtle: "bg-card-subtle",
    canvas: "bg-canvas",
  },
  status: {
    on_track: {
      bg: "bg-card-subtle",
      text: "text-text-primary",
      border: "border-border-light",
      dot: "bg-lime",
      label: "On track",
    },
    at_risk: {
      bg: "bg-card-subtle",
      text: "text-text-primary",
      border: "border-border-light",
      dot: "bg-amber-500",
      label: "At risk",
    },
    behind: {
      bg: "bg-card-subtle",
      text: "text-text-primary",
      border: "border-border-light",
      dot: "bg-magenta",
      label: "Behind",
    },
    no_data: {
      bg: "bg-card-subtle",
      text: "text-text-tertiary",
      border: "border-border-light",
      dot: "bg-grey-500",
      label: "No data",
    },
  },
} as const;
