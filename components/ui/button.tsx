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
          "inline-flex items-center justify-center font-bold rounded-xl transition-all select-none disabled:opacity-50 disabled:pointer-events-none cursor-pointer active:scale-95",
          variant === "default" && "bg-brand-purple hover:bg-brand-purple-hover text-white shadow-sm",
          variant === "destructive" && "bg-rose-600 hover:bg-rose-700 text-white shadow-sm",
          variant === "outline" && "border border-border-light bg-card hover:bg-card-subtle text-text-primary shadow-sm",
          variant === "ghost" && "hover:bg-card-subtle text-text-secondary hover:text-text-primary",
          variant === "secondary" && "bg-card-subtle hover:bg-card border border-border-light text-text-secondary hover:text-text-primary",
          size === "default" && "px-4 py-2 text-xs",
          size === "sm" && "px-3 py-1.5 text-[11px]",
          size === "lg" && "px-6 py-2.5 text-sm",
          size === "icon" && "w-9 h-9 p-0",
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

