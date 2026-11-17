"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  tag?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export function PageHeader({
  title,
  subtitle,
  tag,
  action,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex items-center justify-between gap-4 pt-1 pb-4", className)}>
      <div className="space-y-1 min-w-0">
        <div className="flex items-center gap-2.5 flex-wrap">
          <h1 className="text-2xl lg:text-3xl font-extrabold text-text-primary tracking-tight">
            {title}
          </h1>
          {tag && (
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-brand-purple-light text-brand-purple text-[11px] font-bold border border-brand-purple/20">
              {tag}
            </span>
          )}
        </div>
        {subtitle && (
          <p className="text-xs sm:text-sm text-text-secondary font-medium">
            {subtitle}
          </p>
        )}
      </div>

      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </header>
  );
}
