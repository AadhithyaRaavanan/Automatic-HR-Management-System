"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { ROLE_TUTORIAL_STEPS, TutorialStep } from "@/lib/tutorial/tutorial-config";
import {
  Sparkles,
  ArrowRight,
  ArrowLeft,
  X,
  CheckCircle2,
  ExternalLink,
  Compass,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface GuidedTourOverlayProps {
  userRole?: string;
  forceOpen?: boolean;
  onClose?: () => void;
}

export function GuidedTourOverlay({
  userRole = "employee",
  forceOpen = false,
  onClose,
}: GuidedTourOverlayProps) {
  const router = useRouter();
  const normalizedRole = (userRole || "employee").toLowerCase();
  const steps: TutorialStep[] =
    ROLE_TUTORIAL_STEPS[normalizedRole] || ROLE_TUTORIAL_STEPS["employee"];

  const [isOpen, setIsOpen] = React.useState(forceOpen);
  const [currentStepIndex, setCurrentStepIndex] = React.useState(0);
  const [finishing, setFinishing] = React.useState(false);

  // Check initial tutorial completion status
  React.useEffect(() => {
    if (forceOpen) {
      setIsOpen(true);
      setCurrentStepIndex(0);
      return;
    }

    // Check localStorage cache first
    const dismissed = localStorage.getItem("pulse_tutorial_dismissed");
    if (dismissed === "true") {
      setIsOpen(false);
      return;
    }

    async function checkTutorialStatus() {
      try {
        const res = await fetch("/api/onboarding/profile");
        if (res.ok) {
          const data = await res.json();
          if (data.profile && data.profile.tutorial_completed === false) {
            setIsOpen(true);
          }
        }
      } catch {}
    }

    checkTutorialStatus();
  }, [forceOpen]);

  const handleFinish = async () => {
    setFinishing(true);
    try {
      localStorage.setItem("pulse_tutorial_dismissed", "true");
      await fetch("/api/tutorial/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: false }),
      });
    } catch {}
    setFinishing(false);
    setIsOpen(false);
    onClose?.();
  };

  const handleSkip = async () => {
    await handleFinish();
  };

  const handleNext = () => {
    if (currentStepIndex < steps.length - 1) {
      setCurrentStepIndex((prev) => prev + 1);
    } else {
      handleFinish();
    }
  };

  const handleBack = () => {
    if (currentStepIndex > 0) {
      setCurrentStepIndex((prev) => prev - 1);
    }
  };

  if (!isOpen || steps.length === 0) return null;

  const currentStep = steps[currentStepIndex];
  const isLastStep = currentStepIndex === steps.length - 1;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-card border border-brand-purple/30 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 text-text-primary relative overflow-hidden ring-1 ring-brand-purple/20">
        {/* Glow Accent */}
        <div className="absolute -right-12 -top-12 w-36 h-36 bg-brand-purple/15 rounded-full blur-2xl pointer-events-none" />

        {/* Top Header */}
        <div className="flex items-center justify-between">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-brand-purple/10 border border-brand-purple/20 text-brand-purple text-xs font-bold">
            <Compass className="w-3.5 h-3.5" />
            <span>{currentStep.category}</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-text-tertiary">
              Step {currentStepIndex + 1} of {steps.length}
            </span>
            <button
              type="button"
              onClick={handleSkip}
              className="p-1.5 rounded-full text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors cursor-pointer"
              title="Close tour"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Step Content */}
        <div className="space-y-2">
          <h2 className="text-lg sm:text-xl font-extrabold text-text-primary tracking-tight">
            {currentStep.title}
          </h2>
          <p className="text-xs sm:text-sm text-text-secondary leading-relaxed">
            {currentStep.description}
          </p>
        </div>

        {/* Action Link Preview */}
        <div className="p-3 bg-card-subtle rounded-2xl border border-border-light flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-medium text-text-secondary">
            <Sparkles className="w-4 h-4 text-brand-purple shrink-0" />
            <span>Feature Path: <code className="text-text-primary font-mono">{currentStep.path}</code></span>
          </div>
          <button
            type="button"
            onClick={() => {
              router.push(currentStep.path);
              handleFinish();
            }}
            className="text-xs font-bold text-brand-purple hover:underline inline-flex items-center gap-1 cursor-pointer shrink-0"
          >
            <span>Jump to view</span>
            <ExternalLink className="w-3 h-3" />
          </button>
        </div>

        {/* Bottom Navigation */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs font-bold text-text-tertiary hover:text-text-secondary cursor-pointer"
          >
            Skip Tutorial
          </button>

          <div className="flex items-center gap-2">
            {currentStepIndex > 0 && (
              <button
                type="button"
                onClick={handleBack}
                className="px-3.5 py-1.5 rounded-xl border border-border-light text-xs font-bold text-text-secondary hover:text-text-primary hover:bg-card-subtle transition-all cursor-pointer flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleNext}
              disabled={finishing}
              className="px-4 py-1.5 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <span>{isLastStep ? "Finish Tour" : "Next"}</span>
              {!isLastStep && <ArrowRight className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
