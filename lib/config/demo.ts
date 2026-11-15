/**
 * Demo Mode Guard Utility
 *
 * Strictly ensures demo/mock behavior is ONLY active when explicitly opted-in
 * via NEXT_PUBLIC_DEMO_MODE=true in local development or deployed demo environments (e.g. Vercel).
 */
export function isDemoModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}

