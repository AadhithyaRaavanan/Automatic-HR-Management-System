"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  Clock,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  LogOut,
  FileText,
  ArrowRight,
  ShieldAlert,
  Calendar,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DocumentItem {
  id: string;
  doc_type: string;
  document_name: string;
  file_name: string;
  document_status: "pending" | "approved" | "rejected";
  rejection_reason?: string | null;
  uploaded_at?: string;
  signedUrl?: string;
}

interface ProfileResponse {
  user: {
    id: string;
    email: string;
    fullName: string;
    employeeId: string;
    department: string;
    designation: string;
  };
  profile: {
    onboarding_completed: boolean;
    tutorial_completed: boolean;
  };
  onboardingProfile?: {
    status: string;
    onboarding_status: string;
    submitted_at?: string;
    created_at?: string;
  } | null;
  documents?: DocumentItem[];
}

export default function OnboardingPendingPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);

  const [data, setData] = React.useState<ProfileResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [refreshing, setRefreshing] = React.useState(false);
  const [toastShown, setToastShown] = React.useState(false);

  // Fetch candidate profile & document status
  const loadStatus = React.useCallback(
    async (isManual = false) => {
      if (isManual) setRefreshing(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const headers: Record<string, string> = { "Cache-Control": "no-cache" };
        if (sessionData?.session?.access_token) {
          headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
        }

        const res = await fetch("/api/onboarding/profile", { headers });
        if (res.ok) {
          const json: ProfileResponse = await res.json();
          setData(json);

          // If approved: automatic redirect to dashboard
          const isApproved =
            json.profile?.onboarding_completed === true ||
            json.onboardingProfile?.status?.toLowerCase() === "approved";

          if (isApproved) {
            toast.success("Your onboarding is approved! Welcome to Pulse.");
            router.replace("/dashboard");
            return;
          }

          if (isManual) {
            toast.info("Status updated.");
          }
        }
      } catch (err) {
        console.warn("[OnboardingPending] Load error:", err);
      } finally {
        setLoading(false);
        if (isManual) setRefreshing(false);
      }
    },
    [supabase, router]
  );

  // Initial load + 30s auto-refresh
  React.useEffect(() => {
    loadStatus();

    if (!toastShown) {
      toast.info("Wait until approval", {
        description: "Your documents are currently being reviewed by HR.",
      });
      setToastShown(true);
    }

    const interval = setInterval(() => {
      loadStatus();
    }, 30000); // 30 seconds auto-refresh

    return () => clearInterval(interval);
  }, [loadStatus, toastShown]);

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace("/login");
  };

  const status = (data?.onboardingProfile?.status || "submitted").toLowerCase();
  const docs = data?.documents || [];
  const rejectedDocs = docs.filter((d) => d.document_status === "rejected");
  const isChangesRequested =
    status === "changes_requested" ||
    status === "rejected" ||
    rejectedDocs.length > 0;

  const submittedAtFormatted = React.useMemo(() => {
    const raw =
      data?.onboardingProfile?.submitted_at ||
      data?.onboardingProfile?.created_at;
    if (!raw) return "Recently submitted";
    try {
      const d = new Date(raw);
      return d.toLocaleDateString("en-IN", {
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Asia/Kolkata",
      });
    } catch {
      return raw;
    }
  }, [data?.onboardingProfile]);

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-ground flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-bold text-text-secondary">
            Loading approval status...
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-ground flex flex-col">
      {/* Minimal Header */}
      <header className="w-full bg-card border-b border-border-light px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-brand-navy flex items-center justify-center text-white font-semibold text-sm">
            P
          </div>
          <div>
            <h1 className="text-sm font-semibold text-text-primary tracking-tight">
              Pulse
            </h1>
            <p className="text-xs text-text-tertiary">
              Zenxea workspace onboarding
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card border border-border-light hover:bg-card-subtle text-xs font-medium text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span>Sign out</span>
        </button>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-2xl w-full mx-auto p-4 sm:p-6 lg:p-8 flex flex-col justify-center space-y-6">
        {/* Banner Alert for Pending or Changes Requested */}
        {isChangesRequested ? (
          <div className="rounded-xl bg-card border border-status-danger-dot/40 p-6 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-9 h-9 rounded-lg bg-status-danger-bg text-status-danger-text flex items-center justify-center shrink-0">
                <ShieldAlert className="w-4 h-4" />
              </div>
              <div className="space-y-1">
                <h2 className="text-base font-semibold text-text-primary">
                  Document corrections requested
                </h2>
                <p className="text-xs text-text-secondary leading-relaxed">
                  Corrections were requested for{" "}
                  <strong>
                    {rejectedDocs.length}{" "}
                    {rejectedDocs.length === 1 ? "document" : "documents"}
                  </strong>
                  . Review the feedback below, upload the updated files, and resubmit.
                </p>
              </div>
            </div>

            {/* List of Rejected Documents with Feedback */}
            <div className="space-y-2 pt-1">
              {rejectedDocs.map((doc) => (
                <div
                  key={doc.id}
                  className="p-3 rounded-lg bg-card-subtle border border-border-light space-y-1.5 text-xs"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-text-primary">
                      {doc.document_name || doc.file_name}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-status-danger-bg text-status-danger-text">
                      Requires update
                    </span>
                  </div>
                  {doc.rejection_reason && (
                    <p className="text-text-secondary bg-card p-2 rounded-md border border-border-light text-xs">
                      {doc.rejection_reason}
                    </p>
                  )}
                </div>
              ))}
            </div>

            <div className="pt-2">
              <button
                type="button"
                onClick={() => router.push("/onboarding?step=3&correction=true")}
                className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium transition-colors cursor-pointer"
              >
                <span>Re-upload documents</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl bg-card border border-border-light p-6 sm:p-8 space-y-4 text-center">
            <div className="w-10 h-10 rounded-lg bg-card-subtle border border-border-light text-text-secondary flex items-center justify-center mx-auto">
              <Clock className="w-5 h-5" />
            </div>

            <div className="space-y-1.5">
              <h1 className="text-xl font-semibold text-text-primary tracking-tight">
                Under review
              </h1>
              <p className="text-xs text-text-secondary max-w-md mx-auto leading-relaxed">
                Your onboarding documents were submitted and are being reviewed. You will receive an email once your account is verified.
              </p>
            </div>

            {/* Candidate summary meta chip */}
            <div className="inline-flex flex-wrap items-center justify-center gap-3 p-2.5 rounded-lg bg-card-subtle border border-border-light text-xs text-text-secondary">
              <span className="inline-flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-text-tertiary" />
                Submitted: {submittedAtFormatted}
              </span>
              {data?.user?.department && (
                <span className="border-l border-border-light pl-3">
                  Department: {data.user.department}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Document Checklist Card */}
        <div className="rounded-xl bg-card border border-border-light p-5 space-y-3">
          <div className="flex items-center justify-between border-b border-border-light pb-3">
            <div>
              <h3 className="text-sm font-semibold text-text-primary">
                Submitted documents
              </h3>
              <p className="text-xs text-text-tertiary">
                Verification status for submitted onboarding files
              </p>
            </div>

            <button
              type="button"
              disabled={refreshing}
              onClick={() => loadStatus(true)}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-card border border-border-light hover:bg-card-subtle text-xs font-medium text-text-primary transition-colors cursor-pointer disabled:opacity-50"
            >
              <RotateCcw
                className={cn("w-3.5 h-3.5 text-text-secondary", refreshing && "animate-spin")}
              />
              <span>{refreshing ? "Checking..." : "Refresh"}</span>
            </button>
          </div>

          {docs.length === 0 ? (
            <div className="p-6 text-center text-xs text-text-tertiary italic">
              No documents currently recorded.
            </div>
          ) : (
            <div className="divide-y divide-border-light/60">
              {docs.map((doc) => {
                const isApproved = doc.document_status === "approved";
                const isRejected = doc.document_status === "rejected";

                return (
                  <div
                    key={doc.id}
                    className="py-3 flex items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className={cn(
                          "w-8 h-8 rounded-xl flex items-center justify-center shrink-0",
                          isApproved
                            ? "bg-emerald-500/10 text-emerald-600"
                            : isRejected
                            ? "bg-rose-500/10 text-rose-600"
                            : "bg-brand-purple/10 text-brand-purple"
                        )}
                      >
                        <FileText className="w-4 h-4" />
                      </div>

                      <div className="min-w-0">
                        <p className="font-bold text-text-primary truncate">
                          {doc.document_name || doc.file_name}
                        </p>
                        <p className="text-[11px] text-text-tertiary truncate">
                          {doc.file_name}
                        </p>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center gap-2">
                      {isApproved ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
                          <CheckCircle2 className="w-3 h-3" />
                          <span>Approved</span>
                        </span>
                      ) : isRejected ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-rose-500/10 text-rose-600 border border-rose-500/20">
                          <AlertTriangle className="w-3 h-3" />
                          <span>Rejected</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-brand-purple/10 text-brand-purple border border-brand-purple/20">
                          <Clock className="w-3 h-3" />
                          <span>Pending</span>
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-2 text-center">
            <p className="text-[11px] text-text-tertiary">
              This page automatically refreshes every 30 seconds.
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
