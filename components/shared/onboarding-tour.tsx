"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import { ROLE_TUTORIAL_STEPS, TutorialStep } from "@/lib/tutorial/tutorial-config";
import { ChevronRight, ChevronLeft, Check, X, Sparkles, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

interface OnboardingTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userRole: "employee" | "team_lead" | "manager" | "hr" | "admin";
  fullName?: string | null;
  onCompleted?: () => void;
}

const STEP_STORAGE_KEY = "pulse_tutorial_step_index";

export function OnboardingTour({
  open,
  onOpenChange,
  userRole = "employee",
  onCompleted,
}: OnboardingTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [submitting, setSubmitting] = React.useState(false);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);

  const roleKey = (userRole || "employee").toLowerCase();
  const steps: TutorialStep[] = ROLE_TUTORIAL_STEPS[roleKey] || [];

  // Resume at saved step index if valid
  const [stepIndex, setStepIndex] = React.useState<number>(() => {
    if (typeof window !== "undefined") {
      const saved = sessionStorage.getItem(STEP_STORAGE_KEY);
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (!isNaN(parsed) && parsed >= 0 && parsed < (steps.length || 1)) {
          return parsed;
        }
      }
    }
    return 0;
  });

  // Admin gets NO tour
  if (roleKey === "admin" || steps.length === 0) {
    return null;
  }

  const currentStep = steps[stepIndex] || steps[0];
  const isLast = stepIndex === steps.length - 1;

  // Persist current step index
  React.useEffect(() => {
    if (open && typeof window !== "undefined") {
      sessionStorage.setItem(STEP_STORAGE_KEY, String(stepIndex));
    }
  }, [open, stepIndex]);

  // Navigate to target route if needed
  React.useEffect(() => {
    if (!open || !currentStep) return;
    if (currentStep.route && pathname !== currentStep.route) {
      router.push(currentStep.route);
    }
  }, [open, currentStep, pathname, router]);

  // Calculate target element rect for spotlight
  React.useEffect(() => {
    if (!open || !currentStep) {
      setTargetRect(null);
      return;
    }

    let timer: NodeJS.Timeout;

    const updateRect = () => {
      if (!currentStep.selector) {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector(currentStep.selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setTargetRect(rect);
          try {
            el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          } catch {}
          return;
        }
      }
      // Fallback: missing element or slow load
      setTargetRect(null);
    };

    updateRect();
    // Re-check shortly after route transitions or animations settle
    timer = setTimeout(updateRect, 300);

    const handleWindowChange = () => updateRect();
    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleWindowChange);
      window.removeEventListener("scroll", handleWindowChange, true);
    };
  }, [open, currentStep, pathname]);

  const finishOrSkipTour = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if (typeof window !== "undefined") {
        sessionStorage.removeItem(STEP_STORAGE_KEY);
      }

      let headers: Record<string, string> = { "Content-Type": "application/json" };
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }
      } catch {}

      await fetch("/api/tutorial/complete", {
        method: "POST",
        headers,
        body: JSON.stringify({ reset: false }),
      });

      onOpenChange(false);
      onCompleted?.();
      toast.success("Walkthrough completed. Welcome to Pulse!");
    } catch (err: any) {
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  const handleNext = () => {
    if (isLast) {
      finishOrSkipTour();
    } else {
      setStepIndex((prev) => Math.min(prev + 1, steps.length - 1));
    }
  };

  const handleBack = () => {
    setStepIndex((prev) => Math.max(prev - 1, 0));
  };

  // Keyboard navigation
  React.useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        finishOrSkipTour();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleNext();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleBack();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, isLast, submitting]);

  if (!open) return null;

  // Positioning calculation
  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  let cardPositionStyle: React.CSSProperties = {};

  if (!isMobile && targetRect) {
    const spaceBelow = window.innerHeight - targetRect.bottom;
    const spaceAbove = targetRect.top;
    const cardHeight = 360;
    const cardWidth = 460;

    let top = targetRect.bottom + 16;
    let left = Math.max(16, Math.min(targetRect.left, window.innerWidth - cardWidth - 24));

    if (spaceBelow < cardHeight && spaceAbove > cardHeight) {
      top = Math.max(16, targetRect.top - cardHeight - 16);
    }

    cardPositionStyle = {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${cardWidth}px`,
      maxHeight: "calc(100vh - 32px)",
    };
  }

  const progressPercent = Math.round(((stepIndex + 1) / steps.length) * 100);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={currentStep.title}
      className="fixed inset-0 z-[9999] pointer-events-auto select-none"
    >
      {/* Dimmed backdrop with spotlight cutout */}
      {targetRect ? (
        <svg
          className="fixed inset-0 w-full h-full pointer-events-none z-[9998]"
          aria-hidden="true"
        >
          <defs>
            <mask id="pulse-tour-mask">
              <rect width="100%" height="100%" fill="white" />
              <rect
                x={targetRect.left - 6}
                y={targetRect.top - 6}
                width={targetRect.width + 12}
                height={targetRect.height + 12}
                rx={10}
                fill="black"
              />
            </mask>
          </defs>
          <rect
            width="100%"
            height="100%"
            fill="rgba(10, 15, 30, 0.78)"
            mask="url(#pulse-tour-mask)"
          />
          {/* Animated glow border around target */}
          <rect
            x={targetRect.left - 6}
            y={targetRect.top - 6}
            width={targetRect.width + 12}
            height={targetRect.height + 12}
            rx={10}
            fill="none"
            stroke="#818cf8"
            strokeWidth="2.5"
            strokeDasharray="6 4"
            className="animate-pulse"
          />
        </svg>
      ) : (
        <div
          className="fixed inset-0 bg-slate-950/75 backdrop-blur-sm z-[9998]"
          aria-hidden="true"
        />
      )}

      {/* Floating Tour Card */}
      <div
        style={cardPositionStyle}
        className={cn(
          "z-[9999] bg-card border border-border-light shadow-2xl rounded-2xl p-5 md:p-6 transition-all duration-200 overflow-y-auto",
          (isMobile || !targetRect) &&
            "fixed inset-x-4 bottom-4 md:bottom-auto md:top-1/2 md:left-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:max-w-lg md:w-full"
        )}
      >
        {/* Card Header & Badges */}
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-brand-purple/15 text-brand-purple border border-brand-purple/20">
              <Compass className="w-3 h-3" />
              Step {stepIndex + 1} of {steps.length}
            </span>
            <span className="uppercase tracking-wider text-[10px] font-extrabold px-2 py-0.5 rounded-md bg-card-subtle border border-border-light text-text-secondary">
              {roleKey}
            </span>
          </div>
          <button
            type="button"
            onClick={finishOrSkipTour}
            disabled={submitting}
            title="Skip Walkthrough (Esc)"
            className="text-text-muted hover:text-text-primary p-1 rounded-lg hover:bg-card-subtle transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Progress Bar */}
        <div className="w-full h-1.5 bg-card-subtle rounded-full overflow-hidden mb-4 border border-border-light">
          <div
            className="h-full bg-gradient-to-r from-brand-purple to-indigo-500 transition-all duration-300"
            style={{ width: `${progressPercent}%` }}
          />
        </div>

        {/* Step Title & Body */}
        <div className="space-y-2 mb-4">
          <h2 className="text-base md:text-lg font-bold text-text-primary tracking-tight">
            {currentStep.title}
          </h2>
          <p className="text-xs md:text-sm text-text-secondary leading-relaxed">
            {currentStep.body}
          </p>
        </div>

        {/* "Good to know" Tip Callout */}
        {currentStep.tip && (
          <div className="p-3 rounded-xl bg-brand-purple/5 border border-brand-purple/15 text-xs text-text-secondary flex items-start gap-2.5 mb-5">
            <Sparkles className="w-4 h-4 text-brand-purple shrink-0 mt-0.5" />
            <div className="space-y-0.5">
              <span className="font-semibold text-brand-purple block text-[11px] uppercase tracking-wide">
                Good to know
              </span>
              <span className="text-[12px] leading-relaxed text-text-secondary">
                {currentStep.tip}
              </span>
            </div>
          </div>
        )}

        {/* Action Controls */}
        <div className="flex items-center justify-between pt-2 border-t border-border-light/60 gap-2">
          <button
            type="button"
            onClick={finishOrSkipTour}
            disabled={submitting}
            className="text-xs text-text-muted hover:text-text-primary px-2.5 py-1.5 rounded-lg transition-colors font-medium hover:bg-card-subtle"
          >
            Skip Walkthrough
          </button>

          <div className="flex items-center gap-2">
            {stepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                disabled={submitting}
                className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-border-light bg-card-subtle hover:bg-card text-xs font-semibold text-text-primary transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              disabled={submitting}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-xl bg-brand-purple hover:bg-brand-purple/90 text-white text-xs font-bold shadow-md shadow-brand-purple/20 transition-all cursor-pointer"
            >
              {isLast ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Finish</span>
                </>
              ) : (
                <>
                  <span>Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
