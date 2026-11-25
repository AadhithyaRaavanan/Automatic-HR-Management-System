"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface KpiRadialGaugeProps {
  score: number | null;
  target?: number;
  size?: number;
  strokeWidth?: number;
  className?: string;
}

/**
 * 270° SVG Radial Gauge for Performance Scores
 * Respects prefers-reduced-motion and displays score, goal marker, and status color.
 */
export function KpiRadialGauge({
  score,
  target = 90,
  size = 120,
  strokeWidth = 9,
  className,
}: KpiRadialGaugeProps) {
  const center = size / 2;
  const radius = center - strokeWidth - 2;
  // 270 degrees is 0.75 of total circumference
  const circumference = 2 * Math.PI * radius * 0.75;

  const validScore = score != null ? Math.min(100, Math.max(0, score)) : null;
  const strokeDashoffset =
    validScore != null
      ? circumference - (validScore / 100) * circumference
      : circumference;

  const strokeColor =
    validScore == null
      ? "#E6E6E6"
      : "#B7FF00"; // Neon Lime brand accent

  return (
    <div
      className={cn("relative flex items-center justify-center shrink-0", className)}
      style={{ width: size, height: size }}
    >
      <svg
        className="w-full h-full -rotate-[135deg]"
        viewBox={`0 0 ${size} ${size}`}
        aria-hidden="true"
      >
        {/* Background Track Arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="#E6E6E6"
          strokeWidth={strokeWidth}
          strokeDasharray={`${circumference} ${circumference}`}
          strokeLinecap="round"
        />

        {/* Foreground Progress Arc */}
        {validScore != null ? (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={`${circumference} ${circumference}`}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out motion-reduce:transition-none"
          />
        ) : (
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="#E6E6E6"
            strokeWidth={strokeWidth}
            strokeDasharray="4 6"
            strokeLinecap="round"
            className="opacity-40"
          />
        )}
      </svg>

      {/* Center Display: score only, large, comfortably fitted inside ring */}
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center select-none">
        {validScore != null ? (
          <span className="text-2xl sm:text-3xl font-black text-text-primary tabular-nums tracking-tight leading-none">
            {validScore}%
          </span>
        ) : (
          <span className="text-2xl font-bold text-text-tertiary leading-none">
            —
          </span>
        )}
      </div>
    </div>
  );
}
