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
    <div
      className={cn(
        "bg-white rounded-[14px] border border-[#E6E6E6] p-5 justify-between h-full min-h-[148px] flex flex-col shadow-none select-none transition-colors",
        className
      )}
    >
      {/* Header: Title and Icon */}
      <div className="flex items-center justify-between gap-2 mb-2 min-w-0">
        <span className="text-xs font-medium text-[#808080] truncate min-w-0">
          {title}
        </span>
        {icon && (
          <div className="w-7 h-7 rounded-full bg-[#E6E6E6] flex items-center justify-center text-[#1A1A1A] shrink-0 text-xs">
            {icon}
          </div>
        )}
      </div>

      {/* Metric value and subtitle */}
      <div className="my-1 min-w-0">
        <div className="text-2xl md:text-3xl font-bold text-black tracking-tight tabular-nums truncate">
          {value}
        </div>
        {subtitle && (
          <p className="text-xs text-[#808080] mt-0.5 truncate">{subtitle}</p>
        )}
      </div>

      {/* Matching Progress / Metric Footer Line */}
      {progress !== undefined && (
        <div className="mt-2 pt-1">
          <div className="w-full bg-[#E6E6E6] h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 bg-[#B7FF00]"
              style={{
                width: `${Math.min(Math.max(progress, 0), 100)}%`,
              }}
            />
          </div>
        </div>
      )}

      {trend && (
        <div className="mt-2 flex items-center gap-1.5 text-xs">
          <span
            className={cn(
              "w-2 h-2 rounded-full inline-block shrink-0",
              trend.isPositive ? "bg-[#B7FF00]" : "bg-[#FF1493]"
            )}
          />
          <span className="font-medium text-[#4D4D4D] tabular-nums">
            {trend.value}
          </span>
          {trend.label && (
            <span className="text-[#808080] font-normal truncate">{trend.label}</span>
          )}
        </div>
      )}
    </div>
  );
}
