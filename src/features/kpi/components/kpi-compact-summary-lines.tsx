"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { MessageSquare, Target, ChevronRight } from "lucide-react";

interface KpiCompactSummaryLinesProps {
  latestReview?: any;
  goals?: any[];
  onOpenReviewsAndGoals: () => void;
  className?: string;
}

export function KpiCompactSummaryLines({
  latestReview,
  goals = [],
  onOpenReviewsAndGoals,
  className,
}: KpiCompactSummaryLinesProps) {
  let reviewText = "No performance reviews recorded for this period.";
  if (latestReview) {
    const ratings = latestReview.ratings ? Object.values(latestReview.ratings).map(Number) : [];
    const avg = ratings.length > 0 ? (ratings.reduce((a, b) => a + b, 0) / ratings.length).toFixed(1) : null;
    const reviewer = latestReview.reviewer_name || "Manager";
    const dateStr = latestReview.created_at ? new Date(latestReview.created_at).toLocaleDateString() : "";
    const noteSnippet = latestReview.note ? ` · "${latestReview.note.slice(0, 70)}${latestReview.note.length > 70 ? "..." : ""}"` : "";

    reviewText = avg
      ? `Rated ${avg}/5 by ${reviewer} on ${dateStr}${noteSnippet}`
      : `Reviewed by ${reviewer} on ${dateStr}${noteSnippet}`;
  }

  let goalsText = "No goals set for this period.";
  if (goals.length > 0) {
    const total = goals.length;
    const done = goals.filter((g) => g.status === "done").length;
    const onTrack = goals.filter((g) => g.status === "on_track").length;
    const atRisk = goals.filter((g) => g.status === "at_risk").length;

    goalsText = `${done} of ${total} completed · ${onTrack} on track${atRisk > 0 ? ` · ${atRisk} at risk` : ""}`;
  }

  return (
    <button
      type="button"
      onClick={onOpenReviewsAndGoals}
      className={cn(
        "w-full p-3.5 rounded-2xl bg-card border border-border-light shadow-card hover:border-black/30 transition-all cursor-pointer space-y-2 text-left group",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-black",
        className
      )}
    >
      <div className="flex items-center justify-between text-xs gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <MessageSquare className="w-3.5 h-3.5 text-text-tertiary shrink-0" aria-hidden="true" />
          <span className="font-semibold text-text-secondary shrink-0">Latest review:</span>
          <span className="text-text-primary truncate font-medium">
            {reviewText}
          </span>
        </div>

        <ChevronRight className="w-3.5 h-3.5 text-text-tertiary group-hover:text-black transition-colors shrink-0" aria-hidden="true" />
      </div>

      <div className="flex items-center justify-between text-xs gap-3 pt-2 border-t border-border-light/60">
        <div className="flex items-center gap-2 min-w-0">
          <Target className="w-3.5 h-3.5 text-text-tertiary shrink-0" aria-hidden="true" />
          <span className="font-semibold text-text-secondary shrink-0">Goals:</span>
          <span className="text-text-primary truncate font-medium">
            {goalsText}
          </span>
        </div>

        <ChevronRight className="w-3.5 h-3.5 text-text-tertiary group-hover:text-black transition-colors shrink-0" aria-hidden="true" />
      </div>
    </button>
  );
}
