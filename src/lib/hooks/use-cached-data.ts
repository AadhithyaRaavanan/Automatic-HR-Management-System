// ============================================================================
// Stale-While-Revalidate Client-Side Cached Data Hook
// ============================================================================

import { useQuery, useQueryClient } from "@tanstack/react-query";

export interface CacheDurationConfig {
  staleTime: number;
  gcTime: number;
}

export const CACHE_DURATIONS = {
  // Frequently changing live data (attendance timers, active tasks, check-in status)
  short: { staleTime: 30_000, gcTime: 5 * 60_000 }, // 30 seconds stale, 5 min cache
  // Standard overview lists (leaves, requests, kpi)
  medium: { staleTime: 2 * 60_000, gcTime: 10 * 60_000 }, // 2 minutes stale, 10 min cache
  // Rarely changing structural data (holidays, departments, job titles, settings)
  long: { staleTime: 15 * 60_000, gcTime: 60 * 60_000 }, // 15 minutes stale, 60 min cache
};

export function useCachedData<T>(
  key: string | (string | number | undefined | null | boolean)[],
  fetcher: () => Promise<T>,
  options?: {
    duration?: keyof typeof CACHE_DURATIONS | CacheDurationConfig;
    enabled?: boolean;
    initialData?: T;
  }
) {
  const durationConfig: CacheDurationConfig =
    typeof options?.duration === "string"
      ? CACHE_DURATIONS[options.duration]
      : options?.duration || CACHE_DURATIONS.medium;

  const queryKey = Array.isArray(key) ? key : [key];

  return useQuery<T>({
    queryKey,
    queryFn: fetcher,
    staleTime: durationConfig.staleTime,
    gcTime: durationConfig.gcTime,
    enabled: options?.enabled ?? true,
    initialData: options?.initialData,
    refetchOnWindowFocus: false,
  });
}

/**
 * Pre-warms or refreshes a query key in the client cache
 */
export async function prefetchEndpointData(
  queryClient: ReturnType<typeof useQueryClient>,
  key: string | (string | number | undefined | null | boolean)[],
  fetcher: () => Promise<any>
) {
  const queryKey = Array.isArray(key) ? key : [key];
  return queryClient.prefetchQuery({
    queryKey,
    queryFn: fetcher,
    staleTime: CACHE_DURATIONS.medium.staleTime,
  });
}
