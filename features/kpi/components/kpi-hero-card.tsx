"use client";

import * as React from "react";
import { KpiRadialGauge } from "./kpi-radial-gauge";
import { KPI_CONFIG, getKpiBand } from "@/lib/kpi/config";
import { cn } from "@/lib/utils";
import {
  TrendingUp,
  TrendingDown,
  Info,
} from "lucide-react";
import {
  getHeadlineInfo,
  getScoreTrendSentence,
  getStatusDisplay,
} from "@/lib/kpi/plain-language";

interface KpiHeroCardProps {
  overallScore: number | null;
  trend?: number | null;
  target?: number;
  currentMetrics?: any;
  previousMetrics?: any;
  customWeights?: Record<string, number>;
  onOpenBreakdown?: () => void;
  isSelfView?: boolean;
  userRole?: string;
  previousPeriodLabel?: string;
  periodType?: string;
  className?: string;
}

export function KpiHeroCard({
  overallScore,
  trend,
  target = KPI_CONFIG.overallTarget || 90,
  currentMetrics,
  isSelfView = true,
  userRole = "employee",
  previousPeriodLabel = "last month",
  periodType = "month",
  className,
}: KpiHeroCardProps) {
  const isManagerOrAdmin = userRole === "manager" || userRole === "hr" || userRole === "admin";
  const showBand = !isSelfView && isManagerOrAdmin;
  const band = getKpiBand(overallScore);

  const headlineInfo = getHeadlineInfo(overallScore, currentMetrics, periodType, target);
  const headline = headlineInfo.headline;
  const trendText = getScoreTrendSentence(trend, previousPeriodLabel);

  // Status chip matches the first sentence of the headline
  const statusInfo = getStatusDisplay(headlineInfo.statusKey);

  return (
    <div
      data-tour="kpi-overview"
      className={cn(
        "rounded-2xl bg-card border border-border-light shadow-card p-5 flex flex-col justify-between transition-all",
        className
      )}
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        {/* Left: Headline sentence + Trend */}
        <div className="space-y-2 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            {/* Status dot + text (Always dot plus text) */}
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-card-subtle border border-border-light text-xs">
              <span className={cn("w-2 h-2 rounded-full", statusInfo.dotColor)} aria-hidden="true" />
              <span className={statusInfo.textColor}>{statusInfo.label}</span>
            </div>

            {/* Rating Band shown ONLY to Managers/HR when viewing team members */}
            {showBand && band && (
              <span className={cn("px-2.5 py-0.5 rounded-full text-[11px] font-bold border", band.badgeClass)}>
                {band.label}
              </span>
            )}
          </div>

          <h2 className="text-xl sm:text-2xl font-extrabold text-text-primary tracking-tight leading-snug">
            {headline}
          </h2>

          <div className="flex flex-wrap items-center gap-3 text-xs text-text-secondary">
            {trendText && (
              <span className="inline-flex items-center gap-1 font-semibold text-text-primary">
                {trend != null && trend > 0 ? (
                  <TrendingUp className="w-3.5 h-3.5 text-black" />
                ) : trend != null && trend < 0 ? (
                  <TrendingDown className="w-3.5 h-3.5 text-[#FF007A]" />
                ) : null}
                <span>{trendText}</span>
              </span>
            )}
          </div>
        </div>

        {/* Right: Gauge with score inside ring + Target below it */}
        <div className="flex flex-col items-center shrink-0 self-start sm:self-center">
          <KpiRadialGauge score={overallScore} target={target} size={88} strokeWidth={8} />
          <span className="text-[11px] font-bold text-text-tertiary block mt-1">
            Target {target}%
          </span>
        </div>
      </div>
    </div>
  );
}
