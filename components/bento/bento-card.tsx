"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export interface BentoCardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  badge?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  variant?: "default" | "purple" | "dashed" | "subtle";
  onClick?: () => void;
}

export function BentoCard({
  title,
  subtitle,
  action,
  badge,
  children,
  className,
  bodyClassName,
  variant = "default",
  onClick,
}: BentoCardProps) {
  const shouldReduceMotion = useReducedMotion();

  const variantStyles = {
    default:
      "bg-card text-text-primary border border-border-light shadow-none",
    purple:
      "bg-card text-text-primary border border-border-light shadow-none",
    dashed:
      "bg-card-subtle/50 border border-dashed border-border-light hover:border-brand-purple/50 text-text-secondary cursor-pointer",
    subtle:
      "bg-card-subtle text-text-primary border border-border-light shadow-none",
  };

  const isInteractive = Boolean(onClick);

  return (
    <section
      onClick={onClick}
      className={cn(
        "relative rounded-xl p-5 flex flex-col justify-between transition-colors duration-150",
        variantStyles[variant],
        isInteractive && "cursor-pointer",
        className
      )}
    >
      {(title || action || badge) && (
        <header className="flex items-center justify-between gap-3 mb-3.5 select-none">
          <div className="flex items-center gap-2 min-w-0">
            {typeof title === "string" ? (
              <h3 className="text-sm sm:text-base font-semibold tracking-tight text-text-primary truncate">
                {title}
              </h3>
            ) : (
              title
            )}
            {badge}
          </div>

          {action && (
            <div className="shrink-0 flex items-center gap-1 text-xs font-semibold">
              {action}
            </div>
          )}
        </header>
      )}

      {subtitle && (
        <p className="text-xs text-text-secondary mb-3 -mt-1.5">
          {subtitle}
        </p>
      )}

      <div className={cn("w-full flex-1", bodyClassName)}>{children}</div>
    </section>
  );
}

