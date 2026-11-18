"use client";

import * as React from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  ROLE_TUTORIAL_STEPS,
  TutorialStep,
  TUTORIAL_VERSION,
  getTutorialStepsForUser,
} from "@/lib/tutorial/tutorial-config";
import { ChevronRight, ChevronLeft, Check, X, Compass } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";

interface OnboardingTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userRole: "employee" | "team_lead" | "manager" | "hr" | "admin";
  fullName?: string | null;
  userTutorialVersion?: number;
  isExistingUser?: boolean;
  onCompleted?: () => void;
}

const STEP_STORAGE_KEY = "pulse_tutorial_step_index";

function getSmartCardPlacement(
  targetRect: DOMRect | null,
  cardWidth: number,
  cardHeight: number
): { style: React.CSSProperties; placement: "right" | "left" | "bottom" | "top" | "docked" } {
  if (!targetRect || typeof window === "undefined") {
    return {
      style: {
        position: "fixed",
        bottom: "28px",
        right: "28px",
        width: `${cardWidth}px`,
        maxHeight: "calc(100vh - 56px)",
      },
      placement: "docked",
    };
  }

  const vpW = window.innerWidth;
  const vpH = window.innerHeight;
  const margin = 20;
  const edgePadding = 20;

  // If the target is massive (e.g. covers > 75% width & height), dock to corner
  if (targetRect.width > vpW * 0.75 && targetRect.height > vpH * 0.7) {
    return {
      style: {
        position: "fixed",
        bottom: "28px",
        right: "28px",
        width: `${cardWidth}px`,
        maxHeight: "calc(100vh - 56px)",
      },
      placement: "docked",
    };
  }

  // 1. Try RIGHT of target (best for sidebar, left-docked cards, punch timer)
  if (targetRect.right + margin + cardWidth + edgePadding <= vpW) {
    const left = targetRect.right + margin;
    const idealTop = targetRect.top + (targetRect.height - cardHeight) / 2;
    const top = Math.max(edgePadding, Math.min(idealTop, vpH - cardHeight - edgePadding));
    return {
      style: {
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: `${cardWidth}px`,
        maxHeight: `calc(100vh - ${top + edgePadding}px)`,
      },
      placement: "right",
    };
  }

  // 2. Try BELOW target (best for headers, hero banners, top-aligned cards)
  if (targetRect.bottom + margin + cardHeight + edgePadding <= vpH) {
    const top = targetRect.bottom + margin;
    const idealLeft = targetRect.left + (targetRect.width - cardWidth) / 2;
    const left = Math.max(edgePadding, Math.min(idealLeft, vpW - cardWidth - edgePadding));
    return {
      style: {
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: `${cardWidth}px`,
        maxHeight: `calc(100vh - ${top + edgePadding}px)`,
      },
      placement: "bottom",
    };
  }

  // 3. Try LEFT of target (best for elements in the right half of the screen, e.g. top-nav bell, export button)
  if (targetRect.left - margin - cardWidth >= edgePadding) {
    const left = targetRect.left - margin - cardWidth;
    const idealTop = targetRect.top + (targetRect.height - cardHeight) / 2;
    const top = Math.max(edgePadding, Math.min(idealTop, vpH - cardHeight - edgePadding));
    return {
      style: {
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: `${cardWidth}px`,
        maxHeight: `calc(100vh - ${top + edgePadding}px)`,
      },
      placement: "left",
    };
  }

  // 4. Try ABOVE target (best for bottom-docked elements)
  if (targetRect.top - margin - cardHeight >= edgePadding) {
    const top = targetRect.top - margin - cardHeight;
    const idealLeft = targetRect.left + (targetRect.width - cardWidth) / 2;
    const left = Math.max(edgePadding, Math.min(idealLeft, vpW - cardWidth - edgePadding));
    return {
      style: {
        position: "fixed",
        top: `${top}px`,
        left: `${left}px`,
        width: `${cardWidth}px`,
        maxHeight: `calc(100vh - ${top + edgePadding}px)`,
      },
      placement: "top",
    };
  }

  // 5. Smart corner fallback (never overlap the center of the target)
  const isLeftHalf = targetRect.left + targetRect.width / 2 < vpW / 2;
  return {
    style: {
      position: "fixed",
      bottom: "24px",
      right: isLeftHalf ? "24px" : "auto",
      left: isLeftHalf ? "auto" : "24px",
      width: `${cardWidth}px`,
      maxHeight: "calc(100vh - 48px)",
    },
    placement: "docked",
  };
}

export function OnboardingTour({
  open,
  onOpenChange,
  userRole = "employee",
  userTutorialVersion = 0,
  isExistingUser = false,
  onCompleted,
}: OnboardingTourProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [submitting, setSubmitting] = React.useState(false);
  const [targetRect, setTargetRect] = React.useState<DOMRect | null>(null);

  const roleKey = (userRole || "employee").toLowerCase();
  const steps: TutorialStep[] = React.useMemo(() => {
    return getTutorialStepsForUser(roleKey, userTutorialVersion, isExistingUser);
  }, [roleKey, userTutorialVersion, isExistingUser]);

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

  // Pre-fetch all tour routes immediately on open for instant tab transitions
  React.useEffect(() => {
    if (open && typeof window !== "undefined") {
      steps.forEach((s) => {
        if (s.route) {
          try {
            router.prefetch(s.route);
          } catch {}
        }
      });
    }
  }, [open, steps, router]);

  // Navigate to target route if needed (do not navigate on final step to avoid glitching)
  React.useEffect(() => {
    if (!open || !currentStep) return;
    if (isLast) return;
    if (currentStep.route && pathname !== currentStep.route) {
      router.push(currentStep.route);
    }
  }, [open, currentStep, pathname, router, isLast]);

  // Calculate target element rect for spotlight with continuous smooth detection
  React.useEffect(() => {
    if (!open || !currentStep) {
      setTargetRect(null);
      return;
    }

    let cancelled = false;
    let attempts = 0;
    const maxAttempts = 20;

    const checkTarget = () => {
      if (cancelled) return;
      if (!currentStep.selector) {
        setTargetRect(null);
        return;
      }
      const el = document.querySelector(currentStep.selector);
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          setTargetRect(rect);
          // Only scroll if element is not already visible in the viewport
          const isInViewport =
            rect.top >= 40 &&
            rect.bottom <= window.innerHeight - 40 &&
            rect.left >= 0 &&
            rect.right <= window.innerWidth;

          if (!isInViewport) {
            try {
              el.scrollIntoView({ behavior: "auto", block: "nearest", inline: "nearest" });
              const updatedRect = el.getBoundingClientRect();
              setTargetRect(updatedRect);
            } catch {}
          }
          return;
        }
      }
      attempts++;
      if (attempts < maxAttempts) {
        setTimeout(checkTarget, 75);
      }
    };

    checkTarget();

    let rafId: number | null = null;
    const handleWindowChange = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        if (!currentStep.selector) return;
        const el = document.querySelector(currentStep.selector);
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            setTargetRect(rect);
          }
        }
      });
    };

    window.addEventListener("resize", handleWindowChange);
    window.addEventListener("scroll", handleWindowChange, true);

    return () => {
      cancelled = true;
      if (rafId) cancelAnimationFrame(rafId);
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
        sessionStorage.removeItem("pulse_tutorial_active");
        sessionStorage.setItem("pulse_tutorial_completed", "true");
        localStorage.setItem("pulse_tutorial_completed", "true");
      }

      onOpenChange(false);
      onCompleted?.();

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
        body: JSON.stringify({ reset: false, tutorial_version: TUTORIAL_VERSION }),
      });

      toast.success("Walkthrough completed. Welcome to Pulse!");
      if (pathname !== "/") {
        router.push("/");
      }
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

  // Collision-free positioning: guarantees explanation card never covers or obstructs the highlighted target
  const cardWidth = typeof window !== "undefined" ? Math.min(440, window.innerWidth - 32) : 440;
  const cardHeight = 320;
  const { style: cardPositionStyle, placement } = getSmartCardPlacement(
    targetRect,
    cardWidth,
    cardHeight
  );

  const progressPercent = Math.round(((stepIndex + 1) / steps.length) * 100);
  const isNavigating = Boolean(currentStep?.route && pathname !== currentStep.route);

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
                className="transition-all duration-200 ease-out"
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
            className="animate-pulse transition-all duration-200 ease-out"
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
        className="z-[9999] bg-card border border-border-light shadow-2xl rounded-2xl p-5 md:p-6 transition-all duration-200 ease-out overflow-y-auto"
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
            {isNavigating && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-brand-purple/10 text-brand-purple border border-brand-purple/20 animate-pulse">
                <Compass className="w-3 h-3 animate-spin" />
                <span>Loading view...</span>
              </span>
            )}
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
            <Compass className="w-4 h-4 text-brand-purple shrink-0 mt-0.5" />
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
