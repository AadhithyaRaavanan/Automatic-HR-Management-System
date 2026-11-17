"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { ROLE_TUTORIAL_STEPS, TutorialStep } from "@/lib/tutorial/tutorial-config";
import {
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
  Compass,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";

interface OnboardingTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userRole: "employee" | "team_lead" | "manager" | "hr" | "admin";
  fullName?: string | null;
  onCompleted?: () => void;
}

export function OnboardingTour({
  open,
  onOpenChange,
  userRole = "employee",
  fullName,
  onCompleted,
}: OnboardingTourProps) {
  const router = useRouter();
  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);

  const roleKey = (userRole || "employee").toLowerCase();
  const steps: TutorialStep[] =
    ROLE_TUTORIAL_STEPS[roleKey] || ROLE_TUTORIAL_STEPS["employee"];

  const current = steps[step] || steps[0];
  const isLast = step === steps.length - 1;

  const finishTour = async () => {
    setSubmitting(true);
    try {
      if (typeof window !== "undefined") {
        localStorage.setItem("pulse_tutorial_dismissed", "true");
      }
      await fetch("/api/tutorial/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reset: false }),
      });
      onOpenChange(false);
      onCompleted?.();
      toast.success("Welcome aboard! Guided tour completed.");
    } catch (err: any) {
      toast.error(err?.message || "Could not mark tutorial complete.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !submitting) {
          finishTour();
        } else {
          onOpenChange(nextOpen);
        }
      }}
      title="Welcome to Pulse"
      description={`Step ${step + 1} of ${steps.length} • Role: ${userRole.toUpperCase()}`}
      className="max-w-lg"
    >
      <div className="space-y-5">
        {/* Progress bar */}
        <div className="flex items-center gap-1.5" aria-hidden="true">
          {steps.map((_, idx) => (
            <div
              key={idx}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-colors",
                idx <= step ? "bg-brand-purple" : "bg-card-subtle border border-border-light"
              )}
            />
          ))}
        </div>

        {/* Step Card */}
        <div className="p-5 rounded-2xl bg-card-subtle border border-border-light space-y-3">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-purple/10 text-brand-purple uppercase">
              <Compass className="w-3 h-3" />
              <span>{current.category}</span>
            </span>
            <span className="text-[11px] font-mono text-text-tertiary">
              {current.path}
            </span>
          </div>

          <div className="space-y-1.5">
            <h3 className="text-base font-extrabold text-text-primary">
              {current.title}
            </h3>
            <p className="text-xs text-text-secondary leading-relaxed">
              {current.description}
            </p>
          </div>

          <div className="pt-2 border-t border-border-light/60 flex items-center justify-between">
            <span className="text-[11px] text-text-tertiary">Direct feature route:</span>
            <button
              type="button"
              onClick={() => {
                router.push(current.path);
                finishTour();
              }}
              className="text-xs font-bold text-brand-purple hover:underline inline-flex items-center gap-1 cursor-pointer"
            >
              <span>Explore page</span>
              <ExternalLink className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={finishTour}
            className="text-xs font-bold text-text-tertiary hover:text-text-primary cursor-pointer disabled:opacity-50"
          >
            Skip tutorial
          </button>

          <div className="flex items-center gap-2">
            {step > 0 && (
              <button
                type="button"
                disabled={submitting}
                onClick={() => setStep((s) => Math.max(0, s - 1))}
                className="px-3.5 py-2 rounded-xl bg-card-subtle hover:bg-card border border-border-light text-xs font-bold text-text-primary flex items-center gap-1 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                disabled={submitting}
                onClick={finishTour}
                className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>{submitting ? "Saving..." : "Finish Tour"}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setStep((s) => Math.min(steps.length - 1, s + 1))}
                className="px-4 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
