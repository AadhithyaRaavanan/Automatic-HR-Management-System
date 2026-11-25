"use client";

import * as React from "react";
import Link from "next/link";
import { X, AlertCircle, CheckCircle2, HelpCircle, ExternalLink, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiDetailDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  employeeId: string;
  metricKey: string | null;
  metricLabel: string | null;
  from: string;
  to: string;
  isSelfView?: boolean;
  isManagerOrAdmin?: boolean;
  onAdjustMetric?: (metric: any) => void;
  metricData?: any;
}

export function KpiDetailDrawer({
  isOpen,
  onClose,
  employeeId,
  metricKey,
  metricLabel,
  from,
  to,
  isSelfView = true,
  isManagerOrAdmin = false,
  onAdjustMetric,
  metricData,
}: KpiDetailDrawerProps) {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(false);
  const [showSkeleton, setShowSkeleton] = React.useState(false);

  // Keyboard accessibility: ESC closes drawer
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  // Delayed skeleton loader (shows skeleton after 300ms if fetch takes longer)
  React.useEffect(() => {
    if (!isOpen || !metricKey || !employeeId) {
      setData(null);
      return;
    }

    setLoading(true);
    setShowSkeleton(false);

    const skeletonTimer = setTimeout(() => {
      setShowSkeleton(true);
    }, 300);

    const params = new URLSearchParams({
      employee_id: employeeId,
      metric: metricKey,
      from,
      to,
    });

    fetch(`/api/kpi/detail?${params.toString()}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        setData(json);
      })
      .catch(() => setData(null))
      .finally(() => {
        clearTimeout(skeletonTimer);
        setLoading(false);
        setShowSkeleton(false);
      });

    return () => clearTimeout(skeletonTimer);
  }, [isOpen, employeeId, metricKey, from, to]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div className="fixed inset-y-0 right-0 max-w-full flex pl-10">
        <div className="w-screen max-w-md bg-card border-l border-border-light shadow-2xl flex flex-col justify-between animate-in slide-in-from-right duration-200">
          {/* Header */}
          <div className="p-5 border-b border-border-light flex items-start justify-between gap-3">
            <div>
              <span className="text-[11px] font-bold text-text-tertiary">
                Calculation detail
              </span>
              <h2 className="text-lg font-bold text-text-primary tracking-tight mt-0.5">
                {metricLabel || metricKey}
              </h2>
              <p className="text-xs text-text-tertiary font-medium mt-0.5">
                {from} – {to}
              </p>
            </div>

            <div className="flex items-center gap-2">
              {/* Manager/HR: Adjust Score button in drawer */}
              {isManagerOrAdmin && !isSelfView && onAdjustMetric && (
                <button
                  type="button"
                  onClick={() => {
                    onAdjustMetric(metricData || { key: metricKey, label: metricLabel });
                    onClose();
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-card-subtle border border-border-light text-xs font-bold text-text-primary hover:bg-black hover:text-white transition-colors flex items-center gap-1 cursor-pointer"
                  title="Adjust score for this metric"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  <span>Adjust</span>
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                aria-label="Close panel"
                className="p-1.5 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Drawer Body */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {loading && showSkeleton ? (
              <div className="space-y-3">
                <div className="h-16 rounded-xl bg-card-subtle animate-pulse" />
                <div className="h-12 rounded-xl bg-card-subtle animate-pulse" />
                <div className="space-y-2 pt-2">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div key={i} className="h-10 rounded-lg bg-card-subtle animate-pulse" />
                  ))}
                </div>
              </div>
            ) : data ? (
              <>
                {/* 1. Adjusted Note if applicable */}
                {data.adjustment?.isAdjusted && (
                  <div className="p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 space-y-1">
                    <div className="flex items-center gap-1.5 font-bold text-xs">
                      <AlertCircle className="w-4 h-4 text-amber-700" />
                      <span>Adjusted by supervisor</span>
                    </div>
                    <p className="text-xs">
                      <strong>Reason:</strong> {data.adjustment.reason}
                    </p>
                  </div>
                )}

                {/* 2. Plain Explanation */}
                <div className="p-3.5 rounded-xl bg-card-subtle border border-border-light space-y-2">
                  <div className="flex items-center gap-1.5 text-text-primary font-bold text-xs">
                    <HelpCircle className="w-4 h-4 text-black" />
                    <span>How it is evaluated</span>
                  </div>
                  <p className="text-xs text-text-secondary leading-relaxed">
                    {data.explanation}
                  </p>
                </div>

                {/* 3. Formula with real numbers */}
                {data.formula && (
                  <div className="p-3 rounded-xl bg-card border border-border-light space-y-1">
                    <span className="text-[10px] font-bold text-text-tertiary block">
                      Formula calculation
                    </span>
                    <span className="font-semibold text-xs text-text-primary block">
                      {data.formula}
                    </span>
                  </div>
                )}

                {/* 4. Underlying Activity Records Table */}
                <div className="space-y-2">
                  <span className="text-[11px] font-bold text-text-primary block">
                    Underlying activity records ({data.rows?.length || 0})
                  </span>

                  {data.rows?.length > 0 ? (
                    <div className="border border-border-light rounded-xl overflow-hidden divide-y divide-border-light">
                      {data.rows.map((row: any) => {
                        const isLate = row.statusType === "late" || row.statusType === "missing";
                        const isSuccess = row.statusType === "on_time" || row.statusType === "worked";

                        return (
                          <div
                            key={row.id}
                            className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-card-subtle transition-colors"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-text-primary">
                                  {row.date}
                                </span>
                                {row.checkIn && (
                                  <span className="text-[11px] text-text-tertiary">
                                    {row.checkIn}
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-text-secondary truncate mt-0.5">
                                {row.title || row.details}
                              </p>
                            </div>

                            {/* Status label with text + dot (never color alone) */}
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span
                                className={cn(
                                  "w-2 h-2 rounded-full",
                                  isSuccess
                                    ? "bg-[#B7FF00]"
                                    : isLate
                                    ? "bg-[#FF007A]"
                                    : "bg-[#808080]"
                                )}
                                aria-hidden="true"
                              />
                              <span
                                className={cn(
                                  "text-[11px] font-bold",
                                  isSuccess
                                    ? "text-text-primary"
                                    : isLate
                                    ? "text-[#FF007A]"
                                    : "text-text-tertiary"
                                )}
                              >
                                {row.statusText}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="p-6 text-center text-xs text-text-tertiary border border-dashed border-border-light rounded-xl">
                      No records logged for this metric in this evaluation window.
                    </div>
                  )}
                </div>

                {/* 5. Also Tracked Section (formerly Diagnostics) */}
                <div className="p-3.5 rounded-xl bg-card-subtle/80 border border-border-light space-y-2">
                  <span className="text-[11px] font-bold text-text-primary block">
                    Also tracked
                  </span>
                  <div className="space-y-1 text-xs text-text-secondary">
                    <p>• <strong>Forgot to check out:</strong> Forgotten punches auto-closed at midnight.</p>
                    <p>• <strong>Correction requests:</strong> Submitted punch adjustment requests.</p>
                    <p>• <strong>Early check-outs:</strong> Departures before shift completion.</p>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-8 text-center text-xs text-text-tertiary">
                Unable to load metric calculation details.
              </div>
            )}
          </div>

          {/* Footer note for employees */}
          {isSelfView && (
            <div className="p-4 border-t border-border-light bg-card-subtle text-xs text-text-secondary space-y-1">
              <p>
                If something looks wrong, ask your manager to adjust it or submit an attendance correction.
              </p>
              <Link
                href="/requests"
                className="text-black font-bold hover:underline inline-flex items-center gap-1 mt-0.5 cursor-pointer"
              >
                <span>Go to requests</span>
                <ExternalLink className="w-3 h-3" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
