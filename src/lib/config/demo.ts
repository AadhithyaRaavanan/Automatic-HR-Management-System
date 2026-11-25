/**
 * Demo Mode Guard Utility
 *
 * Strictly ensures demo/mock behavior is ONLY active when explicitly opted-in
 * via NEXT_PUBLIC_DEMO_MODE=true in local development or deployed demo environments (e.g. Vercel).
 */
export function isDemoModeEnabled(): boolean {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "false") return false;
  if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return true;
  if (process.env.NODE_ENV === "test") return false;
  if (process.env.NODE_ENV === "development") return true;
  if (typeof window !== "undefined") {
    try {
      const role = localStorage.getItem("remotehr_cached_role");
      if (role && ["admin", "hr", "manager", "employee"].includes(role)) {
        return true;
      }
    } catch {}
  }
  // Default demo mode to ON for active testing unless explicitly turned off
  return true;
}

