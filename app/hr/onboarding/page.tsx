"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface CandidateRecord {
  id: string;
  user_id: string;
  candidate_type: "STUDENT_INTERN" | "GRADUATE_FRESHER" | "EXPERIENCED";
  full_name: string;
  personal_email: string;
  phone: string;
  pan_number: string;
  aadhaar_number: string;
  status: "draft" | "submitted" | "approved" | "rejected";
  submitted_at: string | null;
  storage_folder: string | null;
  created_at: string;
  employees?: {
    full_name: string;
    email: string;
    status: string;
    department_id: string;
  };
}

interface CandidateDoc {
  id: string;
  doc_type: string;
  file_name: string;
  storage_path: string;
  file_size: number;
  uploaded_at: string;
  signedUrl: string;
}

export default function HROnboardingPage() {
  const [candidates, setCandidates] = React.useState<CandidateRecord[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<string>("all");

  // Drive link state
  const [driveConfig, setDriveConfig] = React.useState<{ configured: boolean; url: string | null }>({
    configured: false,
    url: null,
  });

  // Document preview modal
  const [selectedCandidate, setSelectedCandidate] = React.useState<CandidateRecord | null>(null);
  const [candidateDocs, setCandidateDocs] = React.useState<CandidateDoc[]>([]);
  const [loadingDocs, setLoadingDocs] = React.useState(false);

  // Load drive link
  React.useEffect(() => {
    async function loadDriveLink() {
      try {
        const res = await fetch("/api/hr/onboarding/drive-link");
        if (res.ok) {
          const data = await res.json();
          setDriveConfig(data);
        }
      } catch {}
    }
    loadDriveLink();
  }, []);

  // Load candidates
  const loadCandidates = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/hr/onboarding/candidates");
      if (res.ok) {
        const data = await res.json();
        setCandidates(data.candidates || []);
      }
    } catch (err: any) {
      toast.error(err.message || "Failed to load candidates");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadCandidates();
  }, [loadCandidates]);

  // Open documents modal
  const handleViewDocs = async (candidate: CandidateRecord) => {
    setSelectedCandidate(candidate);
    setLoadingDocs(true);
    try {
      const res = await fetch(`/api/onboarding/documents?userId=${candidate.user_id}`);
      if (res.ok) {
        const data = await res.json();
        setCandidateDocs(data.documents || []);
      }
    } catch {
      toast.error("Failed to load candidate documents");
    } finally {
      setLoadingDocs(false);
    }
  };

  const filteredCandidates = candidates.filter((c) => {
    const matchesFilter = statusFilter === "all" || c.status === statusFilter;
    const name = c.full_name || c.employees?.full_name || "";
    const email = c.personal_email || c.employees?.email || "";
    const matchesSearch =
      name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      email.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <AppShell>
      <div className="space-y-6">
        {/* Header with Drive Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-text-primary tracking-tight">
              Candidate Onboarding Portal
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary mt-1">
              Review candidate submission files, verify identity and academic credentials, and manage onboarding tracks.
            </p>
          </div>

          <div className="flex items-center gap-3">
            {driveConfig.configured && driveConfig.url ? (
              <a
                href={driveConfig.url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold shadow-sm transition-all"
              >
                <FolderOpen className="w-4 h-4" />
                <span>Open Drive Folder</span>
                <ExternalLink className="w-3.5 h-3.5 opacity-80" />
              </a>
            ) : (
              <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card border border-border-light text-[11px] font-medium text-text-tertiary">
                <FolderOpen className="w-3.5 h-3.5" />
                <span>Drive link not configured</span>
              </div>
            )}
          </div>
        </div>

        {/* Filters Toolbar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-card border border-border-light rounded-2xl p-3 shadow-xs">
          <div className="relative flex-1 max-w-sm">
            <Search className="w-3.5 h-3.5 text-text-tertiary absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by candidate name or email..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-card-subtle text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand-purple"
            />
          </div>

          <div className="flex items-center gap-1.5">
            {["all", "submitted", "draft", "approved"].map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setStatusFilter(tab)}
                className={cn(
                  "px-3 py-1 rounded-xl text-xs font-bold capitalize transition-colors cursor-pointer",
                  statusFilter === tab
                    ? "bg-brand-purple text-white shadow-xs"
                    : "text-text-secondary hover:text-text-primary bg-card-subtle hover:bg-card border border-border-light"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        {/* Candidates Table */}
        <div className="bg-card border border-border-light rounded-2xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-border-light/60 bg-card-subtle text-[11px] font-bold text-text-tertiary uppercase tracking-wider">
                  <th className="py-3 px-4">Candidate</th>
                  <th className="py-3 px-4">Track</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Submitted Date</th>
                  <th className="py-3 px-4">Folder Slug</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light/40">
                {loading ? (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-text-tertiary">
                      Loading onboarding records...
                    </td>
                  </tr>
                ) : filteredCandidates.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-4">
                      <EmptyState
                        icon={<Users className="w-6 h-6" />}
                        title="No onboarding candidates found"
                        description="Candidates who complete their onboarding forms will appear here."
                        className="border-none shadow-none"
                      />
                    </td>
                  </tr>
                ) : (
                  filteredCandidates.map((c) => {
                    const candidateName = c.full_name || c.employees?.full_name || "New Candidate";
                    const candidateEmail = c.personal_email || c.employees?.email || "";
                    const trackLabel = c.candidate_type.replace(/_/g, " ");

                    return (
                      <tr key={c.id} className="hover:bg-card-subtle/50 transition-colors">
                        <td className="py-3.5 px-4">
                          <span className="font-bold text-text-primary block text-sm">
                            {candidateName}
                          </span>
                          <span className="text-[11px] text-text-tertiary font-mono">
                            {candidateEmail}
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <span className="inline-flex items-center gap-1 font-bold text-xs text-brand-purple">
                            {c.candidate_type === "STUDENT_INTERN" && <GraduationCap className="w-3.5 h-3.5" />}
                            {c.candidate_type === "GRADUATE_FRESHER" && <Building className="w-3.5 h-3.5" />}
                            {c.candidate_type === "EXPERIENCED" && <Briefcase className="w-3.5 h-3.5" />}
                            <span>{trackLabel}</span>
                          </span>
                        </td>

                        <td className="py-3.5 px-4">
                          <span
                            className={cn(
                              "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase",
                              c.status === "submitted" && "bg-emerald-50 text-emerald-600 border border-emerald-200",
                              c.status === "draft" && "bg-amber-50 text-amber-600 border border-amber-200",
                              c.status === "approved" && "bg-blue-50 text-blue-600 border border-blue-200"
                            )}
                          >
                            {c.status}
                          </span>
                        </td>

                        <td className="py-3.5 px-4 text-text-secondary font-mono text-[11px]">
                          {c.submitted_at ? new Date(c.submitted_at).toLocaleDateString() : "In Progress"}
                        </td>

                        <td className="py-3.5 px-4 text-text-tertiary font-mono text-[11px]">
                          {c.storage_folder || "Pending"}
                        </td>

                        <td className="py-3.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleViewDocs(c)}
                            className="px-3 py-1.5 rounded-xl bg-card-subtle hover:bg-card border border-border-light text-brand-purple text-xs font-bold transition-all cursor-pointer inline-flex items-center gap-1.5"
                          >
                            <FileText className="w-3.5 h-3.5" />
                            <span>View Documents</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Candidate Documents Modal */}
        <Modal
          open={!!selectedCandidate}
          onOpenChange={(open) => !open && setSelectedCandidate(null)}
          title={`Documents: ${selectedCandidate?.full_name || "Candidate"}`}
          description={`Verified uploaded documents for ${selectedCandidate?.personal_email || ""}. Signed secure URLs are time-bounded.`}
        >
          <div className="space-y-4 pt-2">
            {loadingDocs ? (
              <div className="py-8 text-center text-text-tertiary text-xs">
                Generating secure signed URLs...
              </div>
            ) : candidateDocs.length === 0 ? (
              <div className="py-8 text-center text-text-tertiary text-xs">
                No documents uploaded yet by this candidate.
              </div>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                {candidateDocs.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3 bg-card-subtle rounded-xl border border-border-light flex items-center justify-between gap-3"
                  >
                    <div className="flex items-center gap-2.5 overflow-hidden">
                      <FileCheck className="w-4 h-4 text-brand-purple shrink-0" />
                      <div className="overflow-hidden">
                        <span className="text-xs font-bold text-text-primary block truncate">
                          {doc.doc_type.replace(/_/g, " ").toUpperCase()}
                        </span>
                        <span className="text-[11px] text-text-tertiary font-mono block truncate">
                          {doc.file_name} ({Math.round(doc.file_size / 1024)} KB)
                        </span>
                      </div>
                    </div>

                    <a
                      href={doc.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="px-3 py-1.5 rounded-lg bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold shrink-0 inline-flex items-center gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Download</span>
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </Modal>
      </div>
    </AppShell>
  );
}
