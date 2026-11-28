/**
 * Demo Mode Guard Utility
 *
 * Strictly opt-in: demo mode is enabled ONLY when NEXT_PUBLIC_DEMO_MODE === "true"
 * in explicitly configured disposable environments.
 */
export function isDemoModeEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEMO_MODE === "true";
}
