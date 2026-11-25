"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

interface SectionCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  headerClassName?: string;
}

export function SectionCard({
  title,
  subtitle,
  icon,
  action,
  children,
  className,
  headerClassName,
  ...props
}: SectionCardProps) {
  return (
    <section
      className={cn(
        "rounded-xl bg-card border border-border-light p-5 transition-colors",
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className={cn("flex items-center justify-between gap-3 mb-3.5", headerClassName)}>
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <div className="text-text-secondary shrink-0 flex items-center justify-center">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-sm sm:text-base font-semibold text-text-primary tracking-tight truncate">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-xs text-text-secondary truncate mt-0.5">
                  {subtitle}
                </p>
              )}
            </div>
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      {children}
    </section>
  );
}
