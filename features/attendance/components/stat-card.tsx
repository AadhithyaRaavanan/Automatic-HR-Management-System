"use client";

import * as React from "react";
import { BentoCard } from "@/components/bento/bento-card";
import { cn } from "@/lib/utils";
import { TrendingUp, TrendingDown } from "lucide-react";

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon?: React.ReactNode;
  trend?: {
    value: string;
    isPositive?: boolean;
    label?: string;
  };
  progress?: number;
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  progress,
  className,
}: StatCardProps) {
  return (
    <BentoCard
      className={cn(
        "p-5 justify-between h-full min-h-[148px] flex flex-col transition-all",
        className
      )}
    >
      {/* Header: Title and Icon */}
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider truncate min-w-0 select-none">
          {title}
        </span>
        {icon && (
          <div className="w-8 h-8 rounded-full bg-brand-purple-light flex items-center justify-center text-brand-purple shrink-0">
            {icon}
          </div>
        )}
      </div>

      {/* Metric value and subtitle */}
      <div className="my-1 min-w-0">
        <div className="text-2xl font-extrabold text-text-primary tracking-tight tabular-nums truncate">
          {value}
        </div>
        {subtitle && (
          <p className="text-xs text-text-tertiary mt-1 font-medium truncate">{subtitle}</p>
        )}
      </div>

      {/* Matching Progress / Metric Footer Line */}
      <div className="mt-3 pt-1">
        <div className="w-full bg-card-subtle h-2 rounded-full overflow-hidden">
          <div
            className={cn(
              "h-full rounded-full transition-all duration-500",
              progress !== undefined ? "bg-brand-purple" : "bg-status-warning-dot"
            )}
            style={{
              width: `${
                progress !== undefined
                  ? Math.min(Math.max(progress, 0), 100)
                  : 100
              }%`,
            }}
          />
        </div>
      </div>

      {trend && (
        <div className="mt-2 flex items-center gap-1.5 text-xs font-semibold">
          <span
            className={cn(
              "inline-flex items-center gap-0.5",
              trend.isPositive ? "text-status-success-text" : "text-status-danger-text"
            )}
          >
            {trend.isPositive ? (
              <TrendingUp className="w-3.5 h-3.5" />
            ) : (
              <TrendingDown className="w-3.5 h-3.5" />
            )}
            {trend.value}
          </span>
          {trend.label && (
            <span className="text-text-tertiary font-normal">{trend.label}</span>
          )}
        </div>
      )}
    </BentoCard>
  );
}
