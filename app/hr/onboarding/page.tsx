"use client";

import * as React from "react";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/shared/empty-state";
import {
  Users,
  Search,
  ExternalLink,
  FolderOpen,
  FileText,
  Download,
  Calendar,
  Building,
  GraduationCap,
  Briefcase,
  CheckCircle2,
  Clock,
  AlertCircle,
  FileCheck,
  Check,
  X,
  AlertTriangle,
  Eye,
  EyeOff,
  ShieldCheck,
  Building2,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface EnhancedCandidate {
  id: string;
  user_id: string;
  full_name: string;
  email: string;
  employee_id: string;
  department: string;
  designation: string;
  candidate_role?: string;
  status?: string;
  onboarding_status: string;
  approval_email_sent_at?: string | null;
  approved_at?: string | null;
  highest_qualification: string;
  has_experience: boolean;
  submission_date: string;
  completion_percentage: number;
  drive_folder_url: string | null;
  storage_folder: string | null;
  documents: Array<{
    id: string;
    doc_type: string;
    document_name: string;
    file_name: string;
    storage_path: string;
    file_size: number;
    document_status: "pending" | "approved" | "rejected";
    rejection_reason: string | null;
    uploaded_at: string;
    signedUrl: string;
    salary_month?: string | null;
    salary_year?: string | null;
  }>;
  approved_docs_count: number;
  total_docs_count: number;
  personal_details: {
    dob?: string;
    gender?: string;
    phone?: string;
    current_address?: string;
    permanent_address?: string;
    emergency_contact_name?: string;
    emergency_contact_relationship?: string;
    emergency_contact_phone?: string;
    blood_group?: string;
  };
  employment_details: {
    has_experience: boolean;
    previous_company_name?: string;
    previous_designation?: string;
    previous_start_date?: string;
    previous_end_date?: string;
    previous_hr_email?: string;
    previous_hr_phone?: string;
    experience_explanation?: string;
  };
  bank_details: {
    bank_account_holder?: string;
    bank_account_number?: string;
    bank_ifsc?: string;
    bank_name?: string;
    bank_branch?: string;
    uan_number?: string;
    pan_number?: string;
    aadhaar_number?: string;
  };
}

export default function HROnboardingPage() {
  return (
    <AppShell>
      <HrOnboardingContent />
    </AppShell>
  );
}

function HrOnboardingContent() {
  const { userRole } = useAppSession();
  const [mounted, setMounted] = React.useState(false);
  const [candidates, setCandidates] = React.useState<EnhancedCandidate[]>([]);
  const [summary, setSummary] = React.useState({
    total: 0,
    pending: 0,
    under_review: 0,
    correction_required: 0,
    approved: 0,
    completed: 0,
  });
  const [loading, setLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  // Document review modal state
  const [selectedCandidate, setSelectedCandidate] = React.useState<EnhancedCandidate | null>(null);
  const [reviewingDocId, setReviewingDocId] = React.useState<string | null>(null);
  const [rejectionReasons, setRejectionReasons] = React.useState<Record<string, string>>({});
  const [showRejectInput, setShowRejectInput] = React.useState<Record<string, boolean>>({});
  const [approvingOnboarding, setApprovingOnboarding] = React.useState(false);
  const [requestChangesOpen, setRequestChangesOpen] = React.useState(false);
  const [requestChangesNote, setRequestChangesNote] = React.useState("");
  const [requestingChanges, setRequestingChanges] = React.useState(false);
  const [resendingEmail, setResendingEmail] = React.useState(false);
  const [showFullAccount, setShowFullAccount] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  // Load candidates and summary from API
  const loadCandidates = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/hr/onboarding/candidates?_t=${Date.now()}`, {
        cache: "no-store",
        headers: {
          "Cache-Control": "no-cache",
        },
      });
      if (!res.ok) {
        throw new Error("Failed to load candidates data.");
      }
      const data = await res.json();
      setCandidates(data.candidates || []);
      if (data.summary) {
        setSummary(data.summary);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load onboarding candidates.");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Document-level action (Approve or Reject)
  const handleVerifyDoc = async (documentId: string, action: "approve" | "reject") => {
    if (action === "reject") {
      const reason = rejectionReasons[documentId]?.trim();
      if (!reason) {
        toast.error("Please enter a mandatory rejection reason for this document.");
        return;
      }
    }

    setReviewingDocId(documentId);
    try {
      const res = await fetch("/api/hr/onboarding/verify-doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          action,
          rejectionReason: rejectionReasons[documentId] || "",
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Action failed.");
      }

      toast.success(
        action === "approve"
          ? "Document marked as APPROVED."
          : "Document marked as REJECTED. Employee notified for correction."
      );

      // Refresh data and keep current candidate open
      await loadCandidates();
      if (selectedCandidate) {
        setSelectedCandidate((prev) => {
          if (!prev) return null;
          const updatedDocs = prev.documents.map((d) => {
            if (d.id === documentId) {
              return {
                ...d,
                document_status: action === "approve" ? "approved" : "rejected",
                rejection_reason: action === "reject" ? rejectionReasons[documentId] : null,
              } as const;
            }
            return d;
          });
          const currentApproved = updatedDocs.filter((d) => d.document_status === "approved").length;
          return {
            ...prev,
            documents: updatedDocs,
            approved_docs_count: currentApproved,
            onboarding_status: action === "reject" ? "CORRECTION_REQUIRED" : "UNDER_REVIEW",
          };
        });
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to verify document.");
    } finally {
      setReviewingDocId(null);
    }
  };

  // Final HR Approval for Onboarding
  const handleFinalApproval = async () => {
    if (!selectedCandidate) return;

    const isHrCandidate = (selectedCandidate?.candidate_role || "").toLowerCase() === "hr";
    if (isHrCandidate && userRole !== "admin") {
      toast.error("HR onboarding profiles can only be approved by a Super Admin.");
      return;
    }

    setApprovingOnboarding(true);
    const candidateUserId = selectedCandidate.user_id;

    // Optimistic UI update so modal and background table feel instant (< 16ms)
    setSelectedCandidate((prev) =>
      prev
        ? {
            ...prev,
            status: "approved",
            onboarding_status: "COMPLETED",
            approval_email_sent_at: new Date().toISOString(),
          }
        : null
    );
    setCandidates((prev) =>
      prev.map((c) =>
        c.user_id === candidateUserId
          ? {
              ...c,
              status: "approved",
              onboarding_status: "COMPLETED",
              approval_email_sent_at: new Date().toISOString(),
            }
          : c
      )
    );
    setSummary((prev) => ({
      ...prev,
      pending: Math.max(0, prev.pending - 1),
      approved: prev.approved + 1,
      completed: prev.completed + 1,
    }));

    try {
      const res = await fetch("/api/hr/onboarding/approve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedCandidate.user_id }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to approve onboarding.");
      }

      toast.success(
        `Onboarding approved for ${selectedCandidate.full_name}! Employee profile is now active.`
      );
      await loadCandidates();
    } catch (err: any) {
      toast.error(err.message || "Approval failed.");
      await loadCandidates();
    } finally {
      setApprovingOnboarding(false);
    }
  };

  // Request changes on onboarding
  const handleRequestChanges = async () => {
    if (!selectedCandidate) return;
    const trimmed = requestChangesNote.trim();
    if (trimmed.length < 5) {
      toast.error("Please enter a feedback note (min 5 characters) explaining what needs to be changed.");
      return;
    }

    setRequestingChanges(true);
    try {
      const res = await fetch("/api/hr/onboarding/request-changes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedCandidate.user_id,
          note: trimmed,
        }),
      });

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        throw new Error(errJson.error || "Failed to request changes.");
      }

      toast.success(`Changes requested for ${selectedCandidate.full_name}. Candidate notified.`);
      setRequestChangesOpen(false);
      setRequestChangesNote("");
      setSelectedCandidate(null);
      await loadCandidates();
    } catch (err: any) {
      toast.error(err.message || "Failed to request changes.");
    } finally {
      setRequestingChanges(false);
    }
  };

  // Resend approval welcome email
  const handleResendApprovalEmail = async () => {
    if (!selectedCandidate) return;
    setResendingEmail(true);
    try {
      const res = await fetch("/api/hr/onboarding/resend-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: selectedCandidate.user_id }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to resend approval email.");
      }

      toast.success(data.message || "Approval email resent successfully.");
      setSelectedCandidate((prev) =>
        prev
          ? {
              ...prev,
              approval_email_sent_at: data.sentAt || new Date().toISOString(),
            }
          : null
      );
      await loadCandidates();
    } catch (err: any) {
      toast.error(err.message || "Failed to resend approval email.");
    } finally {
      setResendingEmail(false);
    }
  };

  // Filter candidates
  const filteredCandidates = React.useMemo(() => {
    return candidates.filter((c) => {
      const matchesSearch =
        c.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.employee_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.department.toLowerCase().includes(searchQuery.toLowerCase());

      if (!matchesSearch) return false;

      if (statusFilter === "all") return true;
      if (statusFilter === "pending") return c.status === "submitted" || c.onboarding_status === "SUBMITTED";
      if (statusFilter === "under_review") return c.onboarding_status === "UNDER_REVIEW";
      if (statusFilter === "correction_required") return c.status === "changes_requested" || c.onboarding_status === "CORRECTION_REQUIRED";
      if (statusFilter === "completed") return c.status === "approved" || ["VERIFIED", "COMPLETED"].includes(c.onboarding_status);

      return true;
    });
  }, [candidates, searchQuery, statusFilter]);

  const isCandidateHr = (selectedCandidate?.candidate_role || "").toLowerCase() === "hr";
  const requiresAdminApproval = isCandidateHr && userRole !== "admin";

  const canFinalApprove =
    selectedCandidate &&
    !requiresAdminApproval &&
    selectedCandidate.documents.length > 0 &&
    selectedCandidate.documents.every((d) => d.document_status === "approved") &&
    selectedCandidate.status !== "approved";

  return (
    <div className="space-y-6">
        {/* Page Header */}
        <section data-tour="onboarding-hub" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-text-primary tracking-tight">
              Onboarding reviews
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">
              Review candidate documents, request corrections, and approve employee profile activations.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <a
              href="https://drive.google.com/drive/folders/1lDOzwBbZa4FG1M3pRzQDj7cNt8RJ-mdZ?usp=sharing"
              target="_blank"
              rel="noopener noreferrer"
              className="px-3.5 py-1.5 rounded-lg bg-card border border-border-light hover:bg-card-subtle text-xs font-medium text-text-primary transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <FolderOpen className="w-3.5 h-3.5 text-text-secondary" />
              <span>Google Drive</span>
              <ExternalLink className="w-3 h-3 text-text-tertiary" />
            </a>

            <button
              type="button"
              onClick={loadCandidates}
              className="px-3.5 py-1.5 rounded-lg bg-card border border-border-light hover:bg-card-subtle text-xs font-medium text-text-primary transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 text-text-secondary" />
              <span>Refresh</span>
            </button>
          </div>
        </section>

        {/* Summary Metric Cards */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3.5 rounded-xl bg-card border border-border-light">
            <p className="text-xs font-medium text-text-secondary">Total</p>
            <p className="text-2xl font-semibold text-text-primary tabular-nums mt-1">{summary.total}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border-light">
            <p className="text-xs font-medium text-text-secondary">Pending</p>
            <p className="text-2xl font-semibold text-brand-purple tabular-nums mt-1">{summary.pending}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border-light">
            <p className="text-xs font-medium text-text-secondary">Under review</p>
            <p className="text-2xl font-semibold text-text-primary tabular-nums mt-1">{summary.under_review}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border-light">
            <p className="text-xs font-medium text-text-secondary">Corrections</p>
            <p className="text-2xl font-semibold text-status-danger-text tabular-nums mt-1">{summary.correction_required}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border-light">
            <p className="text-xs font-medium text-text-secondary">Approved</p>
            <p className="text-2xl font-semibold text-status-success-text tabular-nums mt-1">{summary.approved}</p>
          </div>

          <div className="p-3.5 rounded-xl bg-card border border-border-light">
            <p className="text-xs font-medium text-text-secondary">Completed</p>
            <p className="text-2xl font-semibold text-text-primary tabular-nums mt-1">{summary.completed}</p>
          </div>
        </section>

        {/* Filters and Search Bar */}
        <section className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          <div className="relative flex-1 max-w-md">
            <Search className="w-4 h-4 text-text-tertiary absolute left-3 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by candidate name, employee ID, or department..."
              className="w-full pl-9 pr-4 py-2 rounded-lg bg-card border border-border-light text-xs font-medium text-text-primary focus:outline-none focus:border-brand-purple"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0">
            {[
              { id: "all", label: "All" },
              { id: "pending", label: "Pending" },
              { id: "under_review", label: "Under Review" },
              { id: "correction_required", label: "Corrections" },
              { id: "completed", label: "Completed" },
            ].map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={cn(
                  "px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer",
                  statusFilter === f.id
                    ? "bg-brand-navy text-white shadow-sm"
                    : "bg-card border border-border-light text-text-secondary hover:bg-card-subtle"
                )}
              >
                {f.label}
              </button>
            ))}
          </div>
        </section>

        {/* Candidates Table */}
        <section className="bg-card rounded-2xl border border-border-light shadow-sm overflow-hidden">
          {!mounted || loading ? (
            <div className="p-12 text-center text-xs font-bold text-text-tertiary">
              Loading candidates table...
            </div>
          ) : filteredCandidates.length === 0 ? (
            <EmptyState
              icon={<Users className="w-8 h-8 text-text-tertiary" />}
              title="No candidates found"
              description="No onboarding submissions match the current search or status filter."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border-light bg-card-subtle/50 text-text-secondary uppercase font-bold text-[10px] tracking-wider">
                    <th className="py-3 px-4">Employee ID</th>
                    <th className="py-3 px-4">Candidate Name</th>
                    <th className="py-3 px-4">Department / Role</th>
                    <th className="py-3 px-4">Submission Date</th>
                    <th className="py-3 px-4">Doc Progress</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {filteredCandidates.map((c) => {
                    const statusBadgeClass =
                      c.onboarding_status === "COMPLETED" || c.onboarding_status === "VERIFIED"
                        ? "bg-status-success/15 text-status-success border-status-success/20"
                        : c.onboarding_status === "CORRECTION_REQUIRED"
                        ? "bg-status-danger/15 text-status-danger border-status-danger/20"
                        : c.onboarding_status === "UNDER_REVIEW"
                        ? "bg-status-warning/15 text-status-warning border-status-warning/20"
                        : "bg-brand-purple/15 text-brand-purple border-brand-purple/20";

                    return (
                      <tr key={c.id} className="hover:bg-card-subtle/40 transition-colors">
                        <td className="py-3 px-4 font-mono font-bold text-text-primary">
                          {c.employee_id}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-extrabold text-text-primary">{c.full_name}</p>
                          <p className="text-[11px] text-text-tertiary truncate max-w-xs">{c.email}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-bold text-text-primary">{c.department}</p>
                          <p className="text-[11px] text-text-tertiary">{c.designation}</p>
                        </td>
                        <td className="py-3 px-4 text-text-secondary whitespace-nowrap">
                          {c.submission_date ? new Date(c.submission_date).toLocaleDateString() : "—"}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-2">
                            <div className="w-16 h-2 bg-card-subtle rounded-full overflow-hidden border border-border-light">
                              <div
                                className="h-full bg-brand-purple rounded-full"
                                style={{ width: `${c.completion_percentage}%` }}
                              />
                            </div>
                            <span className="font-mono text-[11px] text-text-tertiary font-bold">
                              {c.completion_percentage}%
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span
                            className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-extrabold uppercase tracking-wider border",
                              statusBadgeClass
                            )}
                          >
                            {c.onboarding_status.replace(/_/g, " ")}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCandidate(c);
                              setShowFullAccount(false);
                              setRejectionReasons({});
                              setShowRejectInput({});
                            }}
                            className="px-3.5 py-1.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm cursor-pointer"
                          >
                            Review Onboarding
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Detailed Verification Modal */}
        {selectedCandidate && (
          <Modal
            open={Boolean(selectedCandidate)}
            onOpenChange={(open) => !open && setSelectedCandidate(null)}
            title={`Review Onboarding: ${selectedCandidate.full_name} (${selectedCandidate.employee_id})`}
            description={`Department: ${selectedCandidate.department} • Designation: ${selectedCandidate.designation}`}
            className="max-w-4xl"
          >
            <div className="space-y-6 max-h-[75vh] overflow-y-auto pr-1">
              {/* Google Drive Parent Folder Quick Link if available */}
              {selectedCandidate.drive_folder_url && (
                <div className="p-3 bg-brand-purple/10 border border-brand-purple/20 rounded-xl flex items-center justify-between text-xs font-bold text-brand-purple">
                  <div className="flex items-center gap-2">
                    <FolderOpen className="w-4 h-4" />
                    <span>Google Drive Team Storage: {selectedCandidate.storage_folder || "Designated Folder"}</span>
                  </div>
                  <a
                    href={selectedCandidate.drive_folder_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 underline hover:opacity-80"
                  >
                    Open Drive <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              )}

              {/* Candidate Info Overview Tabs */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-card-subtle border border-border-light text-xs space-y-1">
                  <span className="font-extrabold text-[10px] uppercase text-brand-purple">Personal Info</span>
                  <p><strong>DOB:</strong> {selectedCandidate.personal_details.dob || "—"}</p>
                  <p><strong>Phone:</strong> {selectedCandidate.personal_details.phone || "—"}</p>
                  <p>
                    <strong>Emergency:</strong>{" "}
                    {selectedCandidate.personal_details.emergency_contact_name || selectedCandidate.personal_details.emergency_contact_phone ? (
                      <>
                        {selectedCandidate.personal_details.emergency_contact_name || "Emergency Contact"}
                        {selectedCandidate.personal_details.emergency_contact_relationship ? ` (${selectedCandidate.personal_details.emergency_contact_relationship})` : ""}
                        {selectedCandidate.personal_details.emergency_contact_phone ? ` • ${selectedCandidate.personal_details.emergency_contact_phone}` : ""}
                      </>
                    ) : (
                      "—"
                    )}
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-card-subtle border border-border-light text-xs space-y-1">
                  <span className="font-extrabold text-[10px] uppercase text-brand-purple">Education & Past Role</span>
                  <p><strong>Highest Qual:</strong> {selectedCandidate.highest_qualification}</p>
                  <p><strong>Experience:</strong> {selectedCandidate.has_experience ? "Experienced" : "Fresher"}</p>
                  {selectedCandidate.has_experience && (
                    <p><strong>Prev Co:</strong> {selectedCandidate.employment_details.previous_company_name}</p>
                  )}
                </div>

                <div className="p-3 rounded-xl bg-card-subtle border border-border-light text-xs space-y-1">
                  <span className="font-extrabold text-[10px] uppercase text-brand-purple">Bank & Payroll</span>
                  <p><strong>Bank:</strong> {selectedCandidate.bank_details.bank_name}</p>
                  <div className="flex items-center justify-between">
                    <p>
                      <strong>A/C:</strong>{" "}
                      {selectedCandidate.bank_details.bank_account_number
                        ? showFullAccount
                          ? selectedCandidate.bank_details.bank_account_number
                          : `•••• ${selectedCandidate.bank_details.bank_account_number.slice(-4)}`
                        : "—"}
                    </p>
                    {selectedCandidate.bank_details.bank_account_number && (
                      <button
                        type="button"
                        onClick={() => setShowFullAccount(!showFullAccount)}
                        className="text-text-muted hover:text-brand-purple p-0.5 rounded transition-colors"
                        title={showFullAccount ? "Hide Account Number" : "Show Full Account Number"}
                      >
                        {showFullAccount ? (
                          <EyeOff className="w-3.5 h-3.5" />
                        ) : (
                          <Eye className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  <p><strong>IFSC:</strong> {selectedCandidate.bank_details.bank_ifsc}</p>
                  <p><strong>PAN:</strong> {selectedCandidate.bank_details.pan_number}</p>
                  {selectedCandidate.bank_details.aadhaar_number && (
                    <p><strong>Aadhaar:</strong> {`•••• •••• ${selectedCandidate.bank_details.aadhaar_number.slice(-4)}`}</p>
                  )}
                </div>
              </div>

              {/* Document-by-Document Verification Section */}
              <div className="space-y-4">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary flex items-center justify-between">
                  <span>Submitted Documents ({selectedCandidate.documents.length})</span>
                  <span className="text-[11px] font-bold text-text-tertiary">
                    {selectedCandidate.documents.filter(d => d.document_status === "approved").length} of {selectedCandidate.documents.length} Approved
                  </span>
                </h4>

                {selectedCandidate.documents.length === 0 ? (
                  <p className="text-xs text-text-tertiary italic p-4 bg-card-subtle rounded-xl">
                    No documents uploaded by candidate yet.
                  </p>
                ) : (
                  <div className="space-y-3">
                    {selectedCandidate.documents.map((doc) => {
                      const isApproved = doc.document_status === "approved";
                      const isRejected = doc.document_status === "rejected";
                      const isPending = doc.document_status === "pending";

                      return (
                        <div
                          key={doc.id}
                          className={cn(
                            "p-4 rounded-2xl border transition-all space-y-3",
                            isApproved
                              ? "bg-status-success/5 border-status-success/30"
                              : isRejected
                              ? "bg-status-danger/5 border-status-danger/30"
                              : "bg-card border-border-light"
                          )}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <div className="space-y-0.5">
                              <div className="flex items-center gap-2">
                                <FileText className="w-4 h-4 text-brand-purple" />
                                <span className="font-bold text-xs text-text-primary">
                                  {doc.document_name}
                                </span>
                                <span
                                  className={cn(
                                    "px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider",
                                    isApproved
                                      ? "bg-status-success/15 text-status-success"
                                      : isRejected
                                      ? "bg-status-danger/15 text-status-danger"
                                      : "bg-brand-purple/15 text-brand-purple"
                                  )}
                                >
                                  {doc.document_status}
                                </span>
                              </div>
                              <p className="font-mono text-[11px] text-text-tertiary pl-6 truncate max-w-md">
                                {doc.file_name} • {(doc.file_size / 1024).toFixed(0)} KB
                              </p>
                            </div>

                            {/* Actions: Preview & Download */}
                            <div className="flex items-center gap-2 pl-6 sm:pl-0">
                              {doc.signedUrl && (
                                <a
                                  href={doc.signedUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="px-3 py-1.5 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary flex items-center gap-1 shadow-sm"
                                >
                                  <Eye className="w-3.5 h-3.5 text-brand-purple" />
                                  <span>Preview PDF</span>
                                </a>
                              )}

                              {/* Approve Button */}
                              <button
                                type="button"
                                disabled={reviewingDocId === doc.id || isApproved}
                                onClick={() => handleVerifyDoc(doc.id, "approve")}
                                className={cn(
                                  "px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-sm",
                                  isApproved
                                    ? "bg-lime text-black cursor-default"
                                    : "bg-lime/20 text-black hover:bg-lime hover:text-black cursor-pointer border border-lime/40"
                                )}
                              >
                                <Check className="w-3.5 h-3.5" />
                                <span>{isApproved ? "Approved" : "Approve"}</span>
                              </button>

                              {/* Reject Button Toggle */}
                              <button
                                type="button"
                                disabled={reviewingDocId === doc.id}
                                onClick={() =>
                                  setShowRejectInput((prev) => ({
                                    ...prev,
                                    [doc.id]: !prev[doc.id],
                                  }))
                                }
                                className={cn(
                                  "px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer shadow-sm",
                                  isRejected
                                    ? "bg-rose-600 text-white cursor-default"
                                    : "bg-rose-50 text-rose-700 hover:bg-rose-600 hover:text-white border border-rose-200"
                                )}
                              >
                                <X className="w-3.5 h-3.5" />
                                <span>{isRejected ? "Rejected" : "Reject"}</span>
                              </button>
                            </div>
                          </div>

                          {/* Existing rejection remark */}
                          {doc.rejection_reason && (
                            <div className="p-2.5 rounded-xl bg-status-danger/10 text-status-danger text-xs font-semibold">
                              <strong>Rejection reason:</strong> {doc.rejection_reason}
                            </div>
                          )}

                          {/* Rejection reason input form if toggled */}
                          {showRejectInput[doc.id] && (
                            <div className="pt-2 border-t border-border-light space-y-2">
                              <label className="block text-[11px] font-bold text-text-primary uppercase tracking-wider">
                                Mandatory Rejection Reason <span className="text-status-danger">*</span>
                              </label>
                              <div className="flex items-center gap-2">
                                <input
                                  type="text"
                                  value={rejectionReasons[doc.id] || ""}
                                  onChange={(e) =>
                                    setRejectionReasons((prev) => ({
                                      ...prev,
                                      [doc.id]: e.target.value,
                                    }))
                                  }
                                  placeholder="e.g. Blurry scan, certificate name mismatch, wrong document uploaded..."
                                  className="flex-1 px-3 py-2 rounded-xl bg-card border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-status-danger"
                                />
                                <button
                                  type="button"
                                  disabled={reviewingDocId === doc.id}
                                  onClick={() => handleVerifyDoc(doc.id, "reject")}
                                  className="px-4 py-2 rounded-xl bg-status-danger text-white text-xs font-bold shadow-sm cursor-pointer hover:bg-status-danger/90"
                                >
                                  Submit Rejection
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Final HR Approval Footer */}
              <div className="pt-4 border-t border-border-light space-y-3">
                {/* Changes Request Input Form if toggled */}
                {requestChangesOpen && (
                  <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 space-y-2">
                    <label className="block text-xs font-bold text-text-primary">
                      Feedback note to candidate <span className="text-status-danger">*</span> (min 5 characters)
                    </label>
                    <textarea
                      rows={2}
                      value={requestChangesNote}
                      onChange={(e) => setRequestChangesNote(e.target.value)}
                      placeholder="Explain what needs correction (e.g. Please upload clear scans of your degree certificate and PAN card)..."
                      className="w-full px-3 py-2 rounded-xl bg-card border border-border-light text-xs font-medium text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => {
                          setRequestChangesOpen(false);
                          setRequestChangesNote("");
                        }}
                        className="px-3 py-1.5 rounded-lg bg-card border border-border-light text-xs font-bold text-text-secondary cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        disabled={requestingChanges || requestChangesNote.trim().length < 5}
                        onClick={handleRequestChanges}
                        className="px-4 py-1.5 rounded-lg bg-status-danger text-white text-xs font-bold cursor-pointer disabled:opacity-40"
                      >
                        {requestingChanges ? "Submitting..." : "Send Changes Request"}
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div>
                    {selectedCandidate.status === "approved" ? (
                      <div className="space-y-1">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold text-black">
                          <Check className="w-3.5 h-3.5" />
                          <span>Onboarding Approved & Profile Active</span>
                        </span>
                        <div className="flex items-center gap-2 text-[11px] text-text-secondary">
                          {selectedCandidate.approval_email_sent_at ? (
                            <span>
                              Approval email sent to <strong>{selectedCandidate.email}</strong>
                            </span>
                          ) : (
                            <span className="text-amber-600 font-semibold">
                              Email could not be sent
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={resendingEmail}
                            onClick={handleResendApprovalEmail}
                            className="underline text-brand-purple hover:opacity-80 font-bold ml-1 cursor-pointer disabled:opacity-50"
                          >
                            {resendingEmail ? "Sending..." : "Resend email"}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <p className="text-xs font-bold text-text-primary">
                          Final Onboarding Approval & Profile Activation
                        </p>
                        {requiresAdminApproval ? (
                          <p className="text-[11px] font-bold text-amber-600 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20 mt-1 inline-block">
                            Candidate is HR: Approval restricted to Super Admins
                          </p>
                        ) : (
                          <p className="text-[11px] text-text-tertiary">
                            {canFinalApprove
                              ? "All uploaded documents are individually approved. Ready to activate."
                              : "All documents must be individually approved before final activation."}
                          </p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedCandidate(null);
                        setRequestChangesOpen(false);
                      }}
                      className="px-4 py-2.5 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary cursor-pointer shadow-sm"
                    >
                      Close
                    </button>

                    {selectedCandidate.status === "approved" ? (
                      <button
                        type="button"
                        disabled
                        className="px-6 py-2.5 rounded-xl bg-lime text-black text-xs font-extrabold uppercase tracking-wider shadow-md flex items-center gap-1.5 cursor-default opacity-95"
                      >
                        <CheckCircle2 className="w-4 h-4 text-white" />
                        <span>Approved</span>
                      </button>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => setRequestChangesOpen((prev) => !prev)}
                          className="px-4 py-2.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-700 text-xs font-bold cursor-pointer transition-colors"
                        >
                          Request Changes
                        </button>

                        <button
                          type="button"
                          disabled={approvingOnboarding || !canFinalApprove}
                          onClick={handleFinalApproval}
                          className="px-6 py-2.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-extrabold uppercase tracking-wider transition-all shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          <ShieldCheck className="w-4 h-4 text-brand-purple" />
                          <span>
                            {approvingOnboarding ? "Activating..." : "Approve & Activate Employee"}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Modal>
        )}
      </div>
  );
}
