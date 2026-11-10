/**
 * Demo Mode Guard Utility
 *
 * Strictly ensures demo/mock behavior is ONLY active when explicitly opted-in
 * via NEXT_PUBLIC_DEMO_MODE=true AND never in production builds/environments.
 */
export function isDemoModeEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_DEMO_MODE === "true" &&
    process.env.NODE_ENV !== "production"
  );
}

