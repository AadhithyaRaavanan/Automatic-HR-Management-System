"use client";

import * as React from "react";
import { ShieldCheck, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface HighlightCardProps {
  title?: string;
  description?: string;
  buttonText?: string;
  onAction?: () => void;
  className?: string;
}

export function HighlightCard({
  title = "Attendance Policy",
  description = "Remember: Daily check-in grace period is 15 mins. Regularize any missed punches within 3 days.",
  buttonText = "View Full Policy",
  onAction,
  className,
}: HighlightCardProps) {
  return (
    <div
      className={cn(
        "p-6 rounded-[14px] bg-white border border-[#E6E6E6] flex flex-col justify-between shadow-none relative overflow-hidden",
        className
      )}
    >
      <div>
        <div className="w-10 h-10 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] flex items-center justify-center text-black mb-3">
          <ShieldCheck className="w-5 h-5 text-black" />
        </div>

        <h3 className="text-base font-bold text-black tracking-tight mb-1.5">
          {title}
        </h3>

        <p className="text-xs text-[#4D4D4D] leading-relaxed max-w-md">
          {description}
        </p>
      </div>

      <div className="mt-6">
        <button
          type="button"
          onClick={onAction}
          className="w-full py-2.5 px-4 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
        >
          <span>{buttonText}</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );
}

