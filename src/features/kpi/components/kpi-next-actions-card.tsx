"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CheckCircle2, ArrowRight, AlertCircle, Calendar } from "lucide-react";
import { NextActionItem } from "@/features/kpi/plain-language";

interface KpiNextActionsCardProps {
  actions: NextActionItem[];
  onTriggerAction?: (trigger: string) => void;
  onNavigateTab?: (tab: "overview" | "reviews_and_goals" | "team") => void;
  className?: string;
}

export function KpiNextActionsCard({
  actions,
  onTriggerAction,
  onNavigateTab,
  className,
}: KpiNextActionsCardProps) {
  const [expandedDatesId, setExpandedDatesId] = React.useState<string | null>(null);

  if (actions.length === 0) {
    return (
      <div
        data-tour="kpi-next-actions"
        className={cn(
          "px-4 py-3 rounded-2xl bg-card border border-border-light shadow-card flex items-center gap-2.5 text-xs text-text-secondary",
          className
        )}
      >
        <CheckCircle2 className="w-4 h-4 text-[#B7FF00] fill-black shrink-0" aria-hidden="true" />
        <span className="font-medium text-text-primary">
          Nothing needs attention right now.
        </span>
      </div>
    );
  }

  return (
    <section
      data-tour="kpi-next-actions"
      aria-label="Next actions"
      className={cn(
        "p-4 rounded-2xl bg-card border border-border-light shadow-card space-y-2.5",
        className
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
          Next actions
        </h2>
        <span className="text-[11px] font-semibold text-text-tertiary tabular-nums">
          {actions.length} item{actions.length > 1 ? "s" : ""}
        </span>
      </div>

      <div className="space-y-2">
        {actions.map((act, idx) => {
          const isLead = act.primary || idx === 0;
          const hasDates = Boolean(act.dates && act.dates.length > 0);
          const datesExpanded = expandedDatesId === act.id;

          const ctaClass = cn(
            "inline-flex items-center justify-center gap-1.5 min-h-[32px] px-3 py-1.5 rounded-xl text-xs font-bold transition-colors shrink-0 cursor-pointer",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black",
            isLead
              ? "bg-[#B7FF00] hover:bg-[#a6eb00] text-black"
              : "bg-black hover:bg-[#1A1A1A] text-white"
          );

          return (
            <div
              key={act.id}
              className={cn(
                "p-3 rounded-xl border transition-colors",
                isLead
                  ? "bg-card-subtle border-black/15"
                  : "bg-card-subtle/60 border-border-light"
              )}
            >
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div className="flex items-start sm:items-center gap-2 min-w-0">
                  <AlertCircle
                    className={cn(
                      "w-4 h-4 shrink-0 mt-0.5 sm:mt-0",
                      isLead ? "text-black" : "text-amber-600"
                    )}
                    aria-hidden="true"
                  />
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 min-w-0 text-xs">
                    <span className="font-semibold text-text-primary leading-snug">
                      {act.label}
                    </span>

                    {hasDates && (
                      <button
                        type="button"
                        aria-expanded={datesExpanded}
                        onClick={() =>
                          setExpandedDatesId((cur) => (cur === act.id ? null : act.id))
                        }
                        className="inline-flex items-center gap-1 text-[11px] font-bold text-text-secondary hover:text-black underline underline-offset-2 cursor-pointer focus-visible:outline-2 focus-visible:outline-black rounded"
                      >
                        <Calendar className="w-3 h-3" aria-hidden="true" />
                        <span>{datesExpanded ? "Hide dates" : "View dates"}</span>
                      </button>
                    )}
                  </div>
                </div>

                {act.href ? (
                  <Link href={act.href} className={ctaClass}>
                    <span>{act.actionText}</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                ) : act.trigger ? (
                  <button
                    type="button"
                    onClick={() => onTriggerAction?.(act.trigger!)}
                    className={ctaClass}
                  >
                    <span>{act.actionText}</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                ) : act.tabTarget ? (
                  <button
                    type="button"
                    onClick={() => onNavigateTab?.(act.tabTarget!)}
                    className={ctaClass}
                  >
                    <span>{act.actionText}</span>
                    <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                ) : null}
              </div>

              {/* Expandable date pills behind "View dates" */}
              {hasDates && datesExpanded && (
                <div className="mt-2.5 pt-2 border-t border-border-light/70 flex flex-wrap gap-1.5">
                  {act.dates!.map((d) => (
                    <span
                      key={d}
                      className="px-2 py-0.5 rounded-md bg-card border border-border-light text-[11px] font-semibold text-text-primary tabular-nums"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
