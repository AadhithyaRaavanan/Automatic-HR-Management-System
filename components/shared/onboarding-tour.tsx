"use client";

import * as React from "react";
import { Modal } from "@/components/ui/modal";
import { createClient } from "@/lib/supabase/client";
import {
  Sparkles,
  Clock,
  CalendarDays,
  UserCircle,
  ShieldCheck,
  ChevronRight,
  ChevronLeft,
  CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface OnboardingTourProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userRole: "employee" | "manager" | "hr" | "admin";
  fullName?: string | null;
  onCompleted?: () => void;
}

export function OnboardingTour({
  open,
  onOpenChange,
  userRole,
  fullName,
  onCompleted,
}: OnboardingTourProps) {
  const [step, setStep] = React.useState(0);
  const [submitting, setSubmitting] = React.useState(false);
  const supabase = React.useMemo(() => createClient(), []);

  const steps = React.useMemo(() => {
    const baseSteps = [
      {
        title: `Welcome to RemoteHR${fullName ? `, ${fullName.split(" ")[0]}` : ""}!`,
        subtitle: "Zero-surveillance workforce & attendance workspace",
        icon: Sparkles,
        points: [
          "We never record GPS location, keystrokes, webcams, or background screenshots.",
          "Your attendance is calculated strictly from your explicit check-in and check-out punches.",
          "You are always in control of your profile, leave requests, and notification alerts.",
        ],
      },
      {
        title: "Daily Check-In & Timezone Accuracy",
        subtitle: "Track hours accurately in your assigned work timezone",
        icon: Clock,
        points: [
          "Use Quick Check-in / Check-out from the header bar or dashboard hero card.",
          "Missed a punch? Submit a Regularization request directly from Attendance or Requests.",
          "Your shift timezone is governed by HR/Admin to keep payroll and leave calendars aligned.",
        ],
      },
      {
        title: "Leave, Holidays & Real-Time Alerts",
        subtitle: "Plan time off with instant balance previews",
        icon: CalendarDays,
        points: [
          "Check your Casual & Sick balances and apply for full or half-day leave on the Leave page.",
          "View your organization's public and regional holiday calendar under Holidays.",
          "The bell icon streams instant private notifications on approvals, rejections, and reminders.",
        ],
      },
      {
        title: "Complete Your Profile & Security",
        subtitle: "Add contact info, avatar, and review MFA protection",
        icon: userRole === "hr" || userRole === "admin" ? ShieldCheck : UserCircle,
        points: [
          "Visit My Profile to update your name, phone, emergency contact, and private avatar photo.",
          userRole === "manager" || userRole === "hr" || userRole === "admin"
            ? "As a Manager/HR leader, you can review direct-report requests and configure approval delegations in Requests."
            : "Manage notification preferences and optional two-factor authentication anytime in Settings.",
        ],
      },
    ];
    return baseSteps;
  }, [fullName, userRole]);

  const current = steps[step];
  const Icon = current.icon;
  const isLast = step === steps.length - 1;

  const finishTour = async () => {
    setSubmitting(true);
    try {
      const { error } = await (supabase.rpc as any)("complete_onboarding");
      if (error) throw error;
      onOpenChange(false);
      onCompleted?.();
      toast.success("Welcome aboard! Onboarding tour completed.");
    } catch (err: any) {
      toast.error(err?.message || "Could not mark onboarding complete.");
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
      title="Workspace Onboarding Tour"
      description={`Step ${step + 1} of ${steps.length}`}
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
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-2xl bg-brand-purple text-white flex items-center justify-center shrink-0 shadow-sm">
              <Icon className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-text-primary">
                {current.title}
              </h3>
              <p className="text-xs text-text-secondary">{current.subtitle}</p>
            </div>
          </div>

          <ul className="space-y-2 pt-2">
            {current.points.map((point, idx) => (
              <li
                key={idx}
                className="flex items-start gap-2 text-xs text-text-secondary leading-relaxed"
              >
                <CheckCircle2 className="w-4 h-4 text-status-success-dot shrink-0 mt-0.5" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between pt-2">
          <button
            type="button"
            disabled={submitting}
            onClick={finishTour}
            className="text-xs font-bold text-text-tertiary hover:text-text-primary cursor-pointer disabled:opacity-50"
          >
            Skip tour
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
                <span>{submitting ? "Saving..." : "Finish & Get Started"}</span>
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

