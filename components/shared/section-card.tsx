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
        "rounded-[24px] bg-card border border-border-light shadow-card p-5 lg:p-6 transition-all",
        className
      )}
      {...props}
    >
      {(title || action) && (
        <div className={cn("flex items-center justify-between gap-3 mb-4", headerClassName)}>
          <div className="flex items-center gap-2.5 min-w-0">
            {icon && (
              <div className="w-8 h-8 rounded-xl bg-brand-purple-light flex items-center justify-center text-brand-purple shrink-0">
                {icon}
              </div>
            )}
            <div className="min-w-0">
              {title && (
                <h2 className="text-sm font-extrabold text-text-primary tracking-tight truncate">
                  {title}
                </h2>
              )}
              {subtitle && (
                <p className="text-[11px] text-text-tertiary font-medium truncate mt-0.5">
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
