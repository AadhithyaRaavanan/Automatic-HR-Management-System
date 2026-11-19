"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "default" | "destructive" | "outline" | "ghost" | "secondary";
  size?: "default" | "sm" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "default",
      size = "default",
      isLoading = false,
      children,
      disabled,
      ...props
    },
    ref
  ) => {
    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center font-medium rounded-lg transition-colors select-none disabled:opacity-50 disabled:pointer-events-none cursor-pointer",
          variant === "default" && "bg-brand-purple hover:bg-brand-purple-hover text-white shadow-none",
          variant === "destructive" && "bg-rose-600 hover:bg-rose-700 text-white shadow-none",
          variant === "outline" && "border border-border-light bg-card hover:bg-card-subtle text-text-primary shadow-none",
          variant === "ghost" && "hover:bg-card-subtle text-text-secondary hover:text-text-primary",
          variant === "secondary" && "bg-card-subtle hover:bg-card border border-border-light text-text-secondary hover:text-text-primary",
          size === "default" && "px-3.5 py-2 text-xs",
          size === "sm" && "px-2.5 py-1.5 text-xs",
          size === "lg" && "px-5 py-2.5 text-sm",
          size === "icon" && "w-8 h-8 p-0",
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5 shrink-0" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";

