"use client";

import * as React from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Award, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/features";

interface KpiBadgeProps {
  employeeId?: string;
  className?: string;
  showIcon?: boolean;
  linkable?: boolean;
}

export function KpiBadge({
  employeeId,
  className,
  showIcon = true,
  linkable = true,
}: KpiBadgeProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["kpi-summary-badge", employeeId],
    queryFn: async () => {
      if (!employeeId) return null;
      const res = await fetch(`/api/kpi/summary?employeeId=${encodeURIComponent(employeeId)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: Boolean(employeeId && FEATURES.KPI),
    staleTime: 60_000,
  });

  if (!FEATURES.KPI) {
    return null;
  }

  if (!employeeId || isLoading || !data) {
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-card-subtle text-text-tertiary border border-border-light",
          className
        )}
      >
        KPI --
      </span>
    );
  }

  const { overallScore, hasActivity, overallScoreRaw } = data;

  if (!hasActivity || overallScoreRaw == null) {
    const badgeContent = (
      <span
        title="No sufficient KPI data recorded yet"
        className={cn(
          "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-card-subtle text-text-tertiary border border-border-light hover:border-brand-purple/40 transition-colors",
          className
        )}
      >
        KPI No data
      </span>
    );

    if (linkable && employeeId) {
      return (
        <Link href={`/kpi?employee_id=${encodeURIComponent(employeeId)}`} onClick={(e) => e.stopPropagation()}>
          {badgeContent}
        </Link>
      );
    }
    return badgeContent;
  }

  let colorClasses = "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800";
  let icon = <AlertCircle className="w-2.5 h-2.5" />;

  if (overallScore >= 85) {
    colorClasses = "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-400 dark:border-emerald-800";
    icon = <Award className="w-2.5 h-2.5" />;
  } else if (overallScore >= 65) {
    colorClasses = "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800";
    icon = <TrendingUp className="w-2.5 h-2.5" />;
  }

  const badgeElement = (
    <span
      title={`Performance Index: ${overallScore}% - Click to view detailed KPI metrics`}
      className={cn(
        "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border shadow-xs transition-colors hover:opacity-90 cursor-pointer",
        colorClasses,
        className
      )}
    >
      {showIcon && icon}
      <span>{overallScore}% KPI</span>
    </span>
  );

  if (linkable && employeeId) {
    return (
      <Link href={`/kpi?employee_id=${encodeURIComponent(employeeId)}`} onClick={(e) => e.stopPropagation()}>
        {badgeElement}
      </Link>
    );
  }

  return badgeElement;
}
