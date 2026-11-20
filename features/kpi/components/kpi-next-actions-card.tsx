"use client";

import * as React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { CheckCircle2, ArrowRight, AlertCircle } from "lucide-react";
import { NextActionItem } from "@/lib/kpi/plain-language";

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
  return (
    <div
      data-tour="kpi-next-actions"
      className={cn(
        "p-4 rounded-2xl bg-card border border-border-light shadow-card space-y-3",
        className
      )}
    >
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-text-primary tracking-tight">
          What to do next
        </h3>
        <span className="text-[11px] text-text-tertiary">
          {actions.length > 0 ? `${actions.length} action${actions.length > 1 ? "s" : ""}` : "All clear"}
        </span>
      </div>

      {actions.length > 0 ? (
        <div className="space-y-2">
          {actions.map((act) => (
            <div
              key={act.id}
              className="p-3 rounded-xl bg-card-subtle/80 border border-border-light/70 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                <span className="font-medium text-text-primary leading-snug">
                  {act.label}
                </span>
              </div>

              {act.href ? (
                <Link
                  href={act.href}
                  className="inline-flex items-center gap-1 font-bold text-black hover:underline shrink-0 text-[11px] self-start sm:self-auto cursor-pointer"
                >
                  <span>{act.actionText}</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              ) : act.trigger ? (
                <button
                  type="button"
                  onClick={() => onTriggerAction?.(act.trigger!)}
                  className="inline-flex items-center gap-1 font-bold text-black hover:underline shrink-0 text-[11px] self-start sm:self-auto cursor-pointer"
                >
                  <span>{act.actionText}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              ) : act.tabTarget ? (
                <button
                  type="button"
                  onClick={() => onNavigateTab?.(act.tabTarget!)}
                  className="inline-flex items-center gap-1 font-bold text-black hover:underline shrink-0 text-[11px] self-start sm:self-auto cursor-pointer"
                >
                  <span>{act.actionText}</span>
                  <ArrowRight className="w-3 h-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      ) : (
        <div className="p-3 rounded-xl bg-card-subtle/50 flex items-center gap-2.5 text-xs text-text-secondary">
          <CheckCircle2 className="w-4 h-4 text-[#B7FF00] shrink-0 fill-black/90" />
          <span className="font-medium text-text-primary">
            Nothing needed right now.
          </span>
        </div>
      )}
    </div>
  );
}
