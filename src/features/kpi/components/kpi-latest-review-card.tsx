"use client";

import * as React from "react";
import { MessageSquare, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

interface KpiLatestReviewCardProps {
  latestReview?: {
    id: string;
    created_at: string;
    reviewer_name?: string;
    ratings: {
      quality?: number;
      communication?: number;
      initiative?: number;
      teamwork?: number;
    };
    note: string;
  } | null;
  className?: string;
}

export function KpiLatestReviewCard({
  latestReview,
  className,
}: KpiLatestReviewCardProps) {
  if (!latestReview) {
    return (
      <div className={cn("p-4 rounded-[18px] bg-card border border-border-light shadow-card flex flex-col justify-between space-y-2", className)}>
        <div className="flex items-center justify-between text-xs font-bold text-text-primary">
          <div className="flex items-center gap-1.5">
            <MessageSquare className="w-3.5 h-3.5 text-black" />
            <span>Latest review</span>
          </div>
          <span className="text-[10px] text-text-tertiary font-normal">Pending</span>
        </div>
        <p className="text-xs text-text-tertiary">
          No formal performance evaluation recorded for this cycle yet.
        </p>
      </div>
    );
  }

  const ratings = latestReview.ratings || {};
  const avg = (
    ((ratings.quality || 4) +
      (ratings.communication || 4) +
      (ratings.initiative || 4) +
      (ratings.teamwork || 4)) /
    4
  ).toFixed(1);

  return (
    <div className={cn("p-4 rounded-[18px] bg-card border border-border-light shadow-card flex flex-col justify-between space-y-3", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-text-primary">
          <MessageSquare className="w-3.5 h-3.5 text-black" />
          <span>Latest review</span>
        </div>
        <div className="flex items-center gap-1 text-[11px] text-text-tertiary">
          <Calendar className="w-3 h-3" />
          <span>{latestReview.created_at.slice(0, 10)}</span>
        </div>
      </div>

      {/* 4 Small Rating Bars */}
      <div className="grid grid-cols-4 gap-2">
        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-text-tertiary font-medium">
            <span>Quality</span>
            <span className="tabular-nums font-bold text-black">{ratings.quality || 4}</span>
          </div>
          <div className="h-1.5 w-full bg-[#E6E6E6] rounded-full overflow-hidden">
            <div
              className="h-full bg-black rounded-full"
              style={{ width: `${((ratings.quality || 4) / 5) * 100}%` }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-text-tertiary font-medium">
            <span>Comm.</span>
            <span className="tabular-nums font-bold text-black">{ratings.communication || 4}</span>
          </div>
          <div className="h-1.5 w-full bg-[#E6E6E6] rounded-full overflow-hidden">
            <div
              className="h-full bg-black rounded-full"
              style={{ width: `${((ratings.communication || 4) / 5) * 100}%` }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-text-tertiary font-medium">
            <span>Init.</span>
            <span className="tabular-nums font-bold text-black">{ratings.initiative || 4}</span>
          </div>
          <div className="h-1.5 w-full bg-[#E6E6E6] rounded-full overflow-hidden">
            <div
              className="h-full bg-black rounded-full"
              style={{ width: `${((ratings.initiative || 4) / 5) * 100}%` }}
            />
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex justify-between text-[10px] text-text-tertiary font-medium">
            <span>Team</span>
            <span className="tabular-nums font-bold text-black">{ratings.teamwork || 4}</span>
          </div>
          <div className="h-1.5 w-full bg-[#E6E6E6] rounded-full overflow-hidden">
            <div
              className="h-full bg-black rounded-full"
              style={{ width: `${((ratings.teamwork || 4) / 5) * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Note preview */}
      <p className="text-[11px] text-[#4D4D4D] line-clamp-2 italic leading-relaxed">
        &ldquo;{latestReview.note}&rdquo;
      </p>
    </div>
  );
}
