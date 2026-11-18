import * as React from "react";
import { cn } from "@/lib/utils";
import { AppShell } from "@/components/shell/app-shell";

export function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse motion-reduce:animate-none rounded-xl bg-card-subtle/80 border border-border-light/40", className)}
      {...props}
    />
  );
}

/**
 * Delayed show helper: prevents flash of skeletons when queries resolve in < 300ms
 */
export function useDelayedLoading(isLoading: boolean, delayMs = 300): boolean {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    if (!isLoading) {
      setShow(false);
      return;
    }
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [isLoading, delayMs]);

  return isLoading && show;
}

export function DelayedSkeleton({
  children,
  delayMs = 300,
}: {
  children: React.ReactNode;
  delayMs?: number;
}) {
  const [show, setShow] = React.useState(false);

  React.useEffect(() => {
    const timer = setTimeout(() => setShow(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  if (!show) return null;
  return <>{children}</>;
}

export function DashboardSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        {/* Top greeting skeleton */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-72" />
          </div>
          <Skeleton className="h-10 w-36 rounded-full" />
        </div>

        {/* Hero Check-in card skeleton */}
        <div className="p-6 rounded-[28px] bg-card border border-border-light shadow-card space-y-4">
          <div className="flex items-center justify-between">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-6 w-24 rounded-full" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-2">
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
            <Skeleton className="h-20 rounded-2xl" />
          </div>
        </div>

        {/* Bento grid skeleton */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Skeleton className="h-32 rounded-[24px]" />
          <Skeleton className="h-32 rounded-[24px]" />
          <Skeleton className="h-32 rounded-[24px]" />
          <Skeleton className="h-32 rounded-[24px]" />
        </div>
      </div>
    </AppShell>
  );
}

export function TablePageSkeleton({ title }: { title?: string }) {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <div className="h-8 w-44 bg-card-subtle rounded-xl animate-pulse" />
            <div className="h-4 w-64 bg-card-subtle rounded-lg animate-pulse" />
          </div>
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>

        {/* Filter bar */}
        <div className="p-3.5 rounded-2xl bg-card border border-border-light shadow-card flex items-center justify-between gap-4">
          <Skeleton className="h-9 w-64 rounded-xl" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-xl" />
          </div>
        </div>

        {/* Table skeleton */}
        <div className="rounded-[24px] bg-card border border-border-light shadow-card p-4 space-y-3">
          <Skeleton className="h-10 w-full rounded-xl" />
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-14 w-full rounded-xl" />
          ))}
        </div>
      </div>
    </AppShell>
  );
}

export function KanbanPageSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1.5">
            <Skeleton className="h-8 w-40" />
            <Skeleton className="h-4 w-56" />
          </div>
          <div className="flex items-center gap-2">
            <Skeleton className="h-10 w-28 rounded-full" />
            <Skeleton className="h-10 w-28 rounded-full" />
          </div>
        </div>

        {/* Filter Bar */}
        <div className="p-3.5 rounded-2xl bg-card border border-border-light shadow-card flex items-center justify-between gap-4">
          <Skeleton className="h-9 w-72 rounded-xl" />
          <div className="flex items-center gap-2">
            <Skeleton className="h-9 w-24 rounded-xl" />
            <Skeleton className="h-9 w-24 rounded-xl" />
          </div>
        </div>

        {/* Kanban columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((col) => (
            <div key={col} className="p-3.5 rounded-[24px] bg-card-subtle/70 border border-border-light space-y-3">
              <Skeleton className="h-6 w-24 rounded-md" />
              <Skeleton className="h-28 w-full rounded-2xl" />
              <Skeleton className="h-28 w-full rounded-2xl" />
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}

export function ProfilePageSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-5xl mx-auto pb-12">
        <div className="p-6 rounded-[28px] bg-card border border-border-light shadow-card flex items-center gap-4">
          <Skeleton className="w-16 h-16 rounded-full shrink-0" />
          <div className="space-y-2 flex-1">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-32" />
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Skeleton className="h-48 rounded-[24px]" />
          <Skeleton className="h-48 rounded-[24px]" />
        </div>
      </div>
    </AppShell>
  );
}

export function KpiPageSkeleton() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-[1280px] mx-auto pb-16">
        {/* Header Skeleton */}
        <div className="flex items-center justify-between pt-1 pb-4">
          <div className="space-y-2">
            <Skeleton className="h-8 w-64 rounded-xl" />
            <Skeleton className="h-4 w-96 rounded-lg" />
          </div>
          <Skeleton className="h-10 w-28 rounded-xl" />
        </div>

        {/* Sticky Toolbar Skeleton */}
        <Skeleton className="h-14 rounded-2xl" />

        {/* Hero Row: 2 columns (40% + 60%) */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <Skeleton className="lg:col-span-5 h-56 rounded-[24px]" />
          <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-3.5">
            <Skeleton className="h-56 rounded-[22px]" />
            <Skeleton className="h-56 rounded-[22px]" />
            <Skeleton className="h-56 rounded-[22px]" />
          </div>
        </div>

        {/* Category Sections */}
        <div className="space-y-6 pt-2">
          {[1, 2].map((sec) => (
            <div key={sec} className="space-y-3">
              <Skeleton className="h-6 w-48 rounded-lg" />
              <div className="grid grid-cols-[repeat(auto-fit,minmax(280px,1fr))] gap-4">
                {[1, 2, 3, 4].map((i) => (
                  <Skeleton key={i} className="h-36 rounded-2xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
