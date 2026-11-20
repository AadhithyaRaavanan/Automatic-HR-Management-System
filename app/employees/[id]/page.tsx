"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import {
  ArrowLeft,
  Building2,
  Briefcase,
  Mail,
  Phone,
  ShieldAlert,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  ExternalLink,
  Eye,
  EyeOff,
  ShieldCheck,
  Award,
  GraduationCap,
  History,
  Check,
  X,
  Send,
  Pencil,
  Plus,
  Loader2,
  Upload,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

const ALL_DOCUMENT_TYPES = [
  // Cloud & DevOps Certifications
  { key: "aws_cloud_practitioner", label: "AWS Certified Cloud Practitioner", category: "Cloud & DevOps Certifications" },
  { key: "aws_solutions_architect", label: "AWS Certified Solutions Architect (Associate / Professional)", category: "Cloud & DevOps Certifications" },
  { key: "aws_developer", label: "AWS Certified Developer / SysOps Administrator", category: "Cloud & DevOps Certifications" },
  { key: "gcp_cloud_engineer", label: "Google Cloud Certified - Associate Cloud Engineer", category: "Cloud & DevOps Certifications" },
  { key: "gcp_cloud_architect", label: "Google Cloud Certified - Professional Cloud Architect", category: "Cloud & DevOps Certifications" },
  { key: "gcp_data_engineer", label: "Google Cloud Certified - Data Engineer / Machine Learning", category: "Cloud & DevOps Certifications" },
  { key: "azure_fundamentals", label: "Microsoft Certified: Azure Fundamentals (AZ-900)", category: "Cloud & DevOps Certifications" },
  { key: "azure_administrator", label: "Microsoft Certified: Azure Administrator (AZ-104)", category: "Cloud & DevOps Certifications" },
  { key: "azure_solutions_architect", label: "Microsoft Certified: Azure Solutions Architect", category: "Cloud & DevOps Certifications" },
  { key: "kubernetes_cert", label: "Kubernetes Certified (CKA / CKAD / CKS)", category: "Cloud & DevOps Certifications" },
  { key: "docker_devops_cert", label: "Docker & DevOps Professional Certification", category: "Cloud & DevOps Certifications" },

  // Technical, Security & Industry Certifications
  { key: "cisco_cert", label: "Cisco Certified (CCNA / CCNP)", category: "Technical & Professional Certifications" },
  { key: "cybersecurity_cert", label: "CompTIA Security+ / CEH / CISSP Cybersecurity", category: "Technical & Professional Certifications" },
  { key: "salesforce_cert", label: "Salesforce Certified Administrator / Developer", category: "Technical & Professional Certifications" },
  { key: "pmp_agile_cert", label: "PMP / Certified ScrumMaster (CSM) / PMI-ACP", category: "Technical & Professional Certifications" },
  { key: "oracle_java_cert", label: "Oracle Certified Professional / Java Developer", category: "Technical & Professional Certifications" },
  { key: "data_science_ai_cert", label: "Data Science & AI / ML Professional Certificate", category: "Technical & Professional Certifications" },
  { key: "fullstack_cert", label: "Full Stack Web Development Professional Certificate", category: "Technical & Professional Certifications" },
  { key: "other_certification", label: "Other Professional Certification / Course", category: "Technical & Professional Certifications" },

  // Higher Education & Academic Degrees
  { key: "cert_undergraduate", label: "Undergraduate Degree (Bachelor's: B.Tech / B.E. / B.Sc / B.Com / BCA / BBA / BA)", category: "Higher Education & Degrees" },
  { key: "cert_postgraduate", label: "Postgraduate Degree (Master's: M.Tech / M.E. / M.Sc / M.Com / MCA / MBA / MA)", category: "Higher Education & Degrees" },
  { key: "cert_doctorate", label: "Doctorate / Ph.D. Degree Certificate", category: "Higher Education & Degrees" },
  { key: "cert_diploma", label: "Diploma / Polytechnic Certificate", category: "Higher Education & Degrees" },
  { key: "cert_12th", label: "Higher Secondary (12th Standard) Certificate", category: "Higher Education & Degrees" },
  { key: "cert_10th", label: "Secondary School (10th Standard) Certificate", category: "Higher Education & Degrees" },

  // Work History & Compliance
  { key: "experience_cert", label: "Experience Certificate", category: "Work History & Documents" },
  { key: "relieving_letter", label: "Relieving Letter", category: "Work History & Documents" },
  { key: "salary_slip", label: "Previous Salary Slip", category: "Work History & Documents" },
  { key: "passport", label: "Passport Copy", category: "Identity & Compliance" },
  { key: "driving_license", label: "Driving License", category: "Identity & Compliance" },
  { key: "voter_id", label: "Voter ID", category: "Identity & Compliance" },
  { key: "address_proof", label: "Address Proof", category: "Identity & Compliance" },
  { key: "medical_cert", label: "Medical Fitness Certificate", category: "Identity & Compliance" },
];

// Identity, Academic & Professional Master Document Labels
const DOCUMENT_LABEL_MAP: Record<string, string> = {
  // Identity & Core Onboarding
  photo: "Passport Size Photograph",
  resume: "Candidate Resume / CV",
  pan_card: "PAN Card (Permanent Account Number)",
  aadhaar_card: "Aadhaar Card Copy",
  bank_proof: "Bank Account Proof (Passbook / Cheque)",
  passport: "Passport Copy",
  driving_license: "Driving License",
  voter_id: "Voter ID Card",
  address_proof: "Address Proof",
  medical_cert: "Medical Fitness Certificate",

  // Academic Qualifications
  cert_10th: "Secondary School (10th Standard) Certificate",
  cert_12th: "Higher Secondary (12th Standard) Certificate",
  cert_undergraduate: "Undergraduate Degree Certificate",
  cert_postgraduate: "Postgraduate Degree Certificate",
  cert_doctorate: "Doctorate / Ph.D. Degree Certificate",
  cert_diploma: "Diploma / Polytechnic Certificate",
  additional_cert: "Additional Certification / Course Certificate",

  // Career & Work Documents
  experience_cert: "Experience Certificate",
  relieving_letter: "Relieving Letter",
  salary_slip: "Previous Salary Slip",

  // Cloud & DevOps Certifications
  aws_cloud_practitioner: "AWS Certified Cloud Practitioner",
  aws_solutions_architect: "AWS Certified Solutions Architect",
  aws_developer: "AWS Certified Developer / SysOps Administrator",
  gcp_cloud_engineer: "Google Cloud Certified - Associate Cloud Engineer",
  gcp_cloud_architect: "Google Cloud Certified - Professional Cloud Architect",
  gcp_data_engineer: "Google Cloud Certified - Data Engineer / ML",
  azure_fundamentals: "Microsoft Certified: Azure Fundamentals (AZ-900)",
  azure_administrator: "Microsoft Certified: Azure Administrator (AZ-104)",
  azure_solutions_architect: "Microsoft Certified: Azure Solutions Architect",
  kubernetes_cert: "Kubernetes Certified (CKA / CKAD / CKS)",
  docker_devops_cert: "Docker & DevOps Professional Certification",

  // Technical & Professional
  cisco_cert: "Cisco Certified (CCNA / CCNP)",
  cybersecurity_cert: "CompTIA Security+ / CEH / CISSP Cybersecurity",
  salesforce_cert: "Salesforce Certified Administrator / Developer",
  pmp_agile_cert: "PMP / Certified ScrumMaster (CSM) / PMI-ACP",
  oracle_java_cert: "Oracle Certified Professional / Java Developer",
  data_science_ai_cert: "Data Science & AI / ML Professional Certificate",
  fullstack_cert: "Full Stack Web Development Professional Certificate",
  other_certification: "Professional Certification / Course",
};

function formatDocLabel(doc: any): string {
  if (!doc) return "Document";

  // Check if doc_label is a known key in DOCUMENT_LABEL_MAP
  if (doc.doc_label && typeof doc.doc_label === "string") {
    const trimmed = doc.doc_label.trim();
    if (DOCUMENT_LABEL_MAP[trimmed]) return DOCUMENT_LABEL_MAP[trimmed];
    // If it's a custom human title entered by user (not a raw database slug with underscores)
    if (!trimmed.includes("_") && trimmed.length > 2) return trimmed;
  }

  // Check doc_type in DOCUMENT_LABEL_MAP
  const docType = (doc.doc_type || "").trim();
  if (DOCUMENT_LABEL_MAP[docType]) return DOCUMENT_LABEL_MAP[docType];

  // Check ALL_DOCUMENT_TYPES
  const matched = ALL_DOCUMENT_TYPES.find((t) => t.key === docType || t.key === doc.doc_label);
  if (matched?.label) return matched.label;

  // Fallback: convert slug to Title Case
  const raw = doc.doc_label || doc.doc_type || doc.file_name || "Document";
  return String(raw)
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export default function Employee360ProfilePage() {
  const params = useParams();
  const rawId = (params?.id as string) || "";
  const employeeId = decodeURIComponent(rawId).trim().replace(/\s+/g, "-");

  return (
    <AppShell>
      <Employee360ProfileContent employeeId={employeeId} />
    </AppShell>
  );
}

function Employee360ProfileContent({ employeeId }: { employeeId: string }) {
  const router = useRouter();
  const { userRole, userId, isLoaded } = useAppSession();

  const [loading, setLoading] = React.useState(true);
  const [profileData, setProfileData] = React.useState<any>(null);
  const [activeTab, setActiveTab] = React.useState<
    "overview" | "employment" | "education" | "documents" | "internship" | "attendance" | "permissions" | "history"
  >("overview");

  // Edit Parameters Modal State
  const [editModalOpen, setEditModalOpen] = React.useState(false);
  const [savingParams, setSavingParams] = React.useState(false);
  const [formData, setFormData] = React.useState<any>({});

  // Additional Document Modal State
  const [docModalOpen, setDocModalOpen] = React.useState(false);
  const [uploadingDoc, setUploadingDoc] = React.useState(false);
  const [selectedDocType, setSelectedDocType] = React.useState("");
  const [customDocTitle, setCustomDocTitle] = React.useState("");
  const [docFile, setDocFile] = React.useState<File | null>(null);

  // Reject Document Modal State
  const [rejectModalOpen, setRejectModalOpen] = React.useState(false);
  const [rejectingDocId, setRejectingDocId] = React.useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = React.useState("");

  // Add Career Milestone Modal State
  const [careerModalOpen, setCareerModalOpen] = React.useState(false);
  const [careerEventType, setCareerEventType] = React.useState("Promotion");
  const [careerEffectiveDate, setCareerEffectiveDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [careerNotes, setCareerNotes] = React.useState("");
  const [savingCareer, setSavingCareer] = React.useState(false);

  // Permission Request Modal State
  const [permissionModalOpen, setPermissionModalOpen] = React.useState(false);
  const [permDate, setPermDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [permStart, setPermStart] = React.useState("10:00");
  const [permEnd, setPermEnd] = React.useState("12:00");
  const [permDuration, setPermDuration] = React.useState(120);
  const [permType, setPermType] = React.useState("personal");
  const [permReason, setPermReason] = React.useState("");
  const [submittingPerm, setSubmittingPerm] = React.useState(false);
  const [showFullAccount, setShowFullAccount] = React.useState(false);

  const isAdminOrHr = userRole === "admin" || userRole === "hr";

  const emergencyContactDisplay = React.useMemo(() => {
    const emp = profileData?.employee || {};
    const onb = profileData?.onboarding || {};
    const edu = onb.education_details || {};

    const name = onb.emergency_contact_name || edu.emergency_contact_name || edu.emergencyName;
    const rel = onb.emergency_contact_relationship || edu.emergency_contact_relationship || edu.emergencyRelationship;
    const phone = onb.emergency_contact_phone || edu.emergency_contact_phone || edu.emergencyPhone;

    // If onboarding holds relationship/name/phone, always prioritize formatted output with relationship
    if (name || phone) {
      if (rel) {
        return `${name || "Emergency Contact"} (${rel}) • ${phone || ""}`.trim();
      }
      return `${name || "Emergency Contact"} • ${phone || ""}`.trim();
    }

    if (emp.emergency_contact) {
      // Check if emp.emergency_contact has "(rel)" or if we can enrich it with onb rel
      if (rel && !emp.emergency_contact.includes("(")) {
        const parts = emp.emergency_contact.split(/[-•]/);
        if (parts.length >= 2) {
          return `${parts[0].trim()} (${rel}) • ${parts.slice(1).join("-").trim()}`;
        }
        return `${emp.emergency_contact} (${rel})`;
      }
      return emp.emergency_contact;
    }

    return "Not set";
  }, [profileData]);

  const loadProfile = React.useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`);
      const data = await res.json();
      if (data.employee) {
        setProfileData(data);
      } else {
        toast.error("Employee not found");
      }
    } catch (err: any) {
      toast.error("Failed to load employee profile");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  React.useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const openEditModal = () => {
    const emp = profileData?.employee || {};
    const onb = profileData?.onboarding || {};
    setFormData({
      full_name: emp.full_name || "",
      employment_category: emp.employment_category || onb.education_details?.employment_category || "full_time",
      department_id: emp.department_id || "",
      job_title_id: emp.job_title_id || "",
      work_mode: emp.work_mode || "remote",
      manager_id: emp.manager_id || "",
      timezone: emp.timezone || "Asia/Kolkata",
      work_target_minutes: emp.work_target_minutes || 480,
      status: emp.status || "active",
      phone: emp.phone || onb.phone || "",
      emergency_contact:
        emp.emergency_contact ||
        (onb.emergency_contact_name
          ? `${onb.emergency_contact_name}${onb.emergency_contact_relationship ? ` (${onb.emergency_contact_relationship})` : ""} - ${onb.emergency_contact_phone || ""}`
          : onb.education_details?.emergency_contact_name
            ? `${onb.education_details.emergency_contact_name}${onb.education_details.emergency_contact_relationship ? ` (${onb.education_details.emergency_contact_relationship})` : ""} - ${onb.education_details.emergency_contact_phone || ""}`
            : ""),
      shift_start_time: emp.shift_start_time ? emp.shift_start_time.slice(0, 5) : "09:00",
      shift_end_time: emp.shift_end_time ? emp.shift_end_time.slice(0, 5) : "18:00",
      highest_qualification: onb.highest_qualification || onb.education_details?.highest_qualification || "12th Standard",
      bank_name: onb.bank_name || "",
      bank_account_number: onb.bank_account_number || "",
      bank_ifsc: onb.bank_ifsc || "",
      pan_number: onb.pan_number || "",
    });
    setEditModalOpen(true);
  };

  const handleSaveParams = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingParams(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(formData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update parameters.");
      toast.success("Profile parameters updated successfully!");
      setEditModalOpen(false);
      await loadProfile();
    } catch (err: any) {
      toast.error(err.message || "Error saving parameters");
    } finally {
      setSavingParams(false);
    }
  };

  const handleAddCareerEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!careerNotes.trim()) {
      toast.error("Please provide brief notes or description.");
      return;
    }
    setSavingCareer(true);
    try {
      const res = await fetch(`/api/employees/${employeeId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_career_event",
          event_type: careerEventType,
          effective_date: careerEffectiveDate,
          notes: careerNotes.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to add career event");
      toast.success("Career event added to timeline!");
      setCareerModalOpen(false);
      setCareerNotes("");
      await loadProfile();
    } catch (err: any) {
      toast.error(err.message || "Failed to add career event");
    } finally {
      setSavingCareer(false);
    }
  };

  const handleUploadAdditionalDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDocType) {
      toast.error("Please select a document type");
      return;
    }
    if (!docFile) {
      toast.error("Please choose a file to upload");
      return;
    }

    setUploadingDoc(true);
    try {
      const selectedMeta = ALL_DOCUMENT_TYPES.find((t) => t.key === selectedDocType);
      const computedLabel = customDocTitle.trim() || selectedMeta?.label || selectedDocType;
      const fd = new FormData();
      fd.append("file", docFile);
      fd.append("docType", selectedDocType);
      fd.append("docLabel", computedLabel);

      const res = await fetch(`/api/employees/${employeeId}/documents`, {
        method: "POST",
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Upload failed");

      toast.success("Document uploaded successfully! Pending HR/Admin verification.");
      setDocModalOpen(false);
      setDocFile(null);
      setSelectedDocType("");
      setCustomDocTitle("");
      await loadProfile();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload document");
    } finally {
      setUploadingDoc(false);
    }
  };

  const handleReviewDocument = async (documentId: string, action: "approve" | "reject", reason?: string) => {
    try {
      const res = await fetch(`/api/employees/${employeeId}/documents`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          documentId,
          action,
          rejectionReason: reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");

      toast.success(`Document ${action === "approve" ? "verified & approved" : "rejected"}!`);
      setRejectModalOpen(false);
      setRejectionReason("");
      setRejectingDocId(null);
      await loadProfile();
    } catch (err: any) {
      toast.error(err.message || "Failed to action document review");
    }
  };

  const handleRequestPermission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!permReason.trim()) {
      toast.error("Please enter a valid reason");
      return;
    }
    setSubmittingPerm(true);
    try {
      const res = await fetch("/api/permissions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          permissionDate: permDate,
          startTime: permStart,
          endTime: permEnd,
          durationMinutes: permDuration,
          permissionType: permType,
          reason: permReason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Submission failed");
      toast.success("Hourly permission request submitted!");
      setPermissionModalOpen(false);
      setPermReason("");
      await loadProfile();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit permission request");
    } finally {
      setSubmittingPerm(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4 max-w-7xl mx-auto">
        <div className="h-6 w-32 bg-card-subtle rounded-lg animate-pulse" />
        <div className="h-44 bg-card-subtle rounded-3xl animate-pulse" />
      </div>
    );
  }

  const emp = profileData?.employee || {};
  const onb = profileData?.onboarding || {};
  const docs = profileData?.documents || [];
  const internship = profileData?.internship;
  const history = profileData?.careerHistory || [];
  const attendance = profileData?.recentAttendance || [];
  const permissions = profileData?.permissions || [];
  const departments = profileData?.departments || [];
  const jobTitles = profileData?.jobTitles || [];
  const managers = profileData?.managers || [];

  // Available document types excluding those already uploaded (keeps generic certification available)
  const existingDocTypes = new Set(docs.map((d: any) => d.doc_type));
  const availableDocTypes = ALL_DOCUMENT_TYPES.filter((t) => t.key === "other_certification" || !existingDocTypes.has(t.key));

  // Qualifications list (including multiple verified levels)
  const allQuals: string[] = Array.isArray(onb.education_details?.all_qualifications) && onb.education_details.all_qualifications.length > 0
    ? onb.education_details.all_qualifications
    : [onb.highest_qualification || onb.education_details?.highest_qualification || "12th Standard"];

  const renderDocumentCard = (d: any) => {
    const label = formatDocLabel(d);
    const isPending =
      d.document_status === "PENDING REVIEW" ||
      d.status === "pending" ||
      d.document_status === "pending";
    const isRejected =
      d.document_status === "REJECTED" ||
      d.status === "rejected" ||
      d.document_status === "rejected";
    const isVerified = !isPending && !isRejected;

    return (
      <div
        key={d.id}
        className="p-3.5 rounded-[14px] bg-[#F5F5F5] border border-[#E6E6E6] flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs hover:border-[#B3B3B3] transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <FileText className="w-4 h-4 text-black shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold text-black truncate">{label}</p>
            <p className="text-[11px] text-[#808080] font-mono truncate">
              {d.file_name || "document.pdf"}
            </p>
            {d.rejection_reason && (
              <p className="text-[10px] text-[#FF1493] mt-0.5 font-medium truncate">
                Reason: {d.rejection_reason}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <span
            className={cn(
              "px-2.5 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1",
              isVerified
                ? "bg-[#B7FF00]/20 text-black border-[#B7FF00]"
                : isRejected
                ? "bg-[#FF1493]/10 text-[#FF1493] border-[#FF1493]/30"
                : "bg-amber-500/10 text-amber-800 border-amber-500/30"
            )}
          >
            <span
              className={cn(
                "w-1.5 h-1.5 rounded-full",
                isVerified
                  ? "bg-[#B7FF00]"
                  : isRejected
                  ? "bg-[#FF1493]"
                  : "bg-amber-500"
              )}
            />
            {isVerified ? "VERIFIED" : isRejected ? "REJECTED" : "PENDING REVIEW"}
          </span>

          {d.signedUrl && (
            <a
              href={d.signedUrl}
              target="_blank"
              rel="noreferrer"
              className="px-2.5 py-1 rounded-md bg-white border border-[#E6E6E6] text-black hover:bg-[#E6E6E6] text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors shadow-2xs"
              title="View document"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>View</span>
            </a>
          )}

          {isAdminOrHr && isPending && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => handleReviewDocument(d.id, "approve")}
                className="px-2.5 py-1 rounded-md bg-black text-white hover:bg-[#1A1A1A] text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                title="Approve document"
              >
                <Check className="w-3 h-3 text-[#B7FF00]" />
                <span className="hidden sm:inline">Approve</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setRejectingDocId(d.id);
                  setRejectionReason("");
                  setRejectModalOpen(true);
                }}
                className="px-2.5 py-1 rounded-md bg-white border border-[#E6E6E6] text-[#FF1493] hover:bg-[#FF1493]/10 text-[11px] font-semibold inline-flex items-center gap-1 transition-colors cursor-pointer"
                title="Reject document"
              >
                <X className="w-3 h-3" />
                <span className="hidden sm:inline">Reject</span>
              </button>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      {/* Back Link */}
      <div className="flex items-center justify-between">
        <Link
          href="/employees"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#808080] hover:text-black transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Employee Directory
        </Link>
      </div>

      {/* Hero Card */}
      <div className="p-6 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] flex items-center justify-center text-base font-semibold text-black">
            {emp.full_name?.slice(0, 2).toUpperCase() || "ZX"}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-black tracking-tight">{emp.full_name}</h1>
              <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-[#F5F5F5] text-[#808080] border border-[#E6E6E6]">
                {emp.employee_number || emp.id?.slice(0, 8)}
              </span>
            </div>
            <p className="text-xs text-[#808080] mt-1">
              {emp.job_titles?.title_name || "Specialist"} • {emp.departments?.name || "Zenxea"}
            </p>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-[#808080]">
              <span className="flex items-center gap-1">
                <Mail className="w-3 h-3 text-black" />
                {emp.email}
              </span>
              <span className="flex items-center gap-1">
                <Phone className="w-3 h-3 text-black" />
                {emp.phone || onb.phone || "Not set"}
              </span>
              <span className="flex items-center gap-1 text-[#FF1493] font-medium" title="Emergency Contact">
                <ShieldAlert className="w-3.5 h-3.5 text-[#FF1493]" />
                <span className="text-[#808080]">Emergency:</span> {emergencyContactDisplay}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          {isLoaded && userRole !== "admin" && userId === emp.id && (
            <button
              onClick={() => setPermissionModalOpen(true)}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-black shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Clock className="w-3.5 h-3.5" />
              Request Hourly Permission
            </button>
          )}

          {isAdminOrHr && (
            <button
              onClick={openEditModal}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-black hover:bg-[#1A1A1A] text-white shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit Parameters
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="flex items-center gap-1.5 border-b border-border-light pb-2 overflow-x-auto text-xs font-semibold">
        {[
          { id: "overview", label: "360° Overview" },
          { id: "employment", label: "Employment & Governance" },
          { id: "education", label: `Education & Onboarding (${allQuals.length})` },
          { id: "documents", label: `Documents (${docs.length})` },
          ...(emp.employment_category === "intern" || internship
            ? [{ id: "internship", label: "Internship Details" }]
            : []),
          { id: "attendance", label: `Attendance Summary (${attendance.length})` },
          { id: "permissions", label: `Hourly Permissions (${permissions.length})` },
          { id: "history", label: `Career Timeline (${history.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={cn(
              "px-3.5 py-1.5 rounded-lg transition-colors whitespace-nowrap",
              activeTab === tab.id
                ? "bg-black text-white font-semibold shadow-xs"
                : "text-[#808080] hover:text-black hover:bg-[#F5F5F5]"
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab 1: Overview */}
      {activeTab === "overview" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-black">Comprehensive 360° Employee Dossier</h3>
          </div>
          <BentoGrid className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <BentoCard title={<span className="flex items-center gap-2"><Briefcase className="w-4 h-4 text-brand-purple" /> Employment Overview</span>}>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Category:</span>
                  <span className="font-semibold text-text-primary uppercase tracking-wider">
                    {emp.employment_category?.replace("_", " ")}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Department:</span>
                  <span className="font-semibold text-text-primary">{emp.departments?.name || "General"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Designation:</span>
                  <span className="font-semibold text-text-primary">{emp.job_titles?.title_name || "Specialist"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Work Mode:</span>
                  <span className="font-semibold text-text-primary capitalize">{emp.work_mode || "Remote"}</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-text-muted">Joined Date:</span>
                  <span className="font-semibold text-text-primary">{emp.joined_on}</span>
                </div>
              </div>
            </BentoCard>

            <BentoCard title={<span className="flex items-center gap-2"><Building2 className="w-4 h-4 text-brand-cyan" /> Reporting Hierarchy</span>}>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Reporting Manager:</span>
                  <span className="font-semibold text-text-primary">
                    {emp.manager?.full_name || "Not Assigned"}
                  </span>
                </div>
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Timezone:</span>
                  <span className="font-mono text-text-primary">{emp.timezone || "Asia/Kolkata"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Target Hours:</span>
                  <span className="font-semibold text-text-primary">{(emp.work_target_minutes || 480) / 60} hrs / day</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-text-muted">Account Status:</span>
                  <span className="font-semibold text-black uppercase">{emp.status || "Active"}</span>
                </div>
              </div>
            </BentoCard>

            <BentoCard title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-brand-purple" /> Identity & Banking</span>}>
              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">PAN Card:</span>
                  <span className="font-mono text-text-primary">{onb.pan_number || "Verified"}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Bank Name:</span>
                  <span className="font-semibold text-text-primary">
                    {onb.bank_name || (onb.bank_ifsc?.startsWith("CNRB") ? "Canara Bank" : null) || "Not Specified"}
                  </span>
                </div>
                <div className="flex justify-between items-center py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Bank A/C:</span>
                  <div className="flex items-center gap-1.5 font-mono text-text-primary">
                    <span>
                      {onb.bank_account_number
                        ? showFullAccount
                          ? onb.bank_account_number
                          : `••••${onb.bank_account_number.slice(-4)}`
                        : "Verified"}
                    </span>
                    {onb.bank_account_number && (
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
                </div>
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Emergency Contact:</span>
                  <span className="font-semibold text-text-primary text-right max-w-[65%] truncate" title={emergencyContactDisplay}>
                    {emergencyContactDisplay}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-text-muted">Onboarding:</span>
                  <span className="font-semibold text-black">COMPLETED & VERIFIED</span>
                </div>
              </div>
            </BentoCard>
          </BentoGrid>
        </div>
      )}

      {/* Tab 2: Employment & Governance */}
      {activeTab === "employment" && (
        <div className="p-6 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-black">Employment Governance Parameters</h3>
              <p className="text-xs text-[#808080] mt-0.5">Shift policies, organizational hierarchy, and working parameters.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="p-4 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] space-y-2">
              <p className="text-[#808080]">Authoritative Shift Timings:</p>
              <p className="font-bold text-black text-sm">
                {emp.shift_start_time ? emp.shift_start_time.slice(0, 5) : "09:00"} - {emp.shift_end_time ? emp.shift_end_time.slice(0, 5) : "18:00"}
              </p>
              <p className="text-[11px] text-[#808080]">Standard daily shift with grace period and meal breaks.</p>
            </div>
            <div className="p-4 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] space-y-2">
              <p className="text-[#808080]">Department Tree & Hierarchy:</p>
              <p className="font-bold text-black text-sm">
                {emp.departments?.parent_department_id ? "Subdepartment Division" : "Main Organizational Department"}
              </p>
              <p className="text-[11px] text-[#808080]">Governed by ZEN XEA Organizational Hierarchy.</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 3: Education & Onboarding */}
      {activeTab === "education" && (
        <div className="space-y-6">
          {/* Section 1: Academic Foundation */}
          <div className="p-6 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none space-y-4">
            <div>
              <h3 className="text-sm font-bold text-black">Verified Educational Qualifications</h3>
              <p className="text-xs text-[#808080] mt-0.5">
                All approved academic credentials verified during employee intake and additional submissions.
              </p>
            </div>

            <div className="space-y-3">
              {allQuals.map((qual, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] text-xs flex items-center justify-between"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-lg bg-white border border-[#E6E6E6] text-black flex items-center justify-center">
                      <GraduationCap className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="font-bold text-black text-sm block">{qual}</span>
                      <span className="text-[11px] text-[#808080]">
                        {idx === 0 && allQuals.length === 1
                          ? "Verified during mandatory employee onboarding intake."
                          : idx === 0
                            ? "Secondary Academic Foundation (Verified)"
                            : "Higher Professional Academic Qualification (Verified & Approved)"}
                      </span>
                    </div>
                  </div>
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-[#B7FF00]/20 text-black border border-[#B7FF00] flex items-center gap-1">
                    <Check className="w-3 h-3 text-black" /> Verified
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Educational Certifications & Additional Certifications (AWS, Google Cloud, Azure, etc.) */}
          <div className="p-6 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-black">
                  Educational Certifications & Additional Certifications
                </h3>
                <p className="text-xs text-[#808080] mt-0.5">
                  Industry credentials (AWS, Google Cloud, Microsoft, Cisco), specialized diplomas, and additional certifications.
                </p>
              </div>

              <button
                type="button"
                onClick={() => {
                  if (availableDocTypes.length === 0) {
                    toast.info("All certification and documentation options have already been submitted!");
                    return;
                  }
                  setSelectedDocType(availableDocTypes[0]?.key || "");
                  setCustomDocTitle("");
                  setDocModalOpen(true);
                }}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white text-xs font-semibold shadow-xs transition-colors shrink-0 cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5 text-[#B7FF00]" />
                <span>Add Certification / Credential</span>
              </button>
            </div>

            {(() => {
              const certDocs = docs.filter((d: any) => {
                const type = d.doc_type || "";
                return (
                  type.startsWith("aws_") ||
                  type.startsWith("gcp_") ||
                  type.startsWith("azure_") ||
                  type.startsWith("cert_") ||
                  type.includes("cert") ||
                  type.includes("cisco") ||
                  type.includes("security") ||
                  type.includes("salesforce") ||
                  type.includes("pmp") ||
                  type.includes("kubernetes") ||
                  type.includes("docker") ||
                  type.includes("diploma")
                );
              });

              if (certDocs.length === 0) {
                return (
                  <div className="py-8 px-4 text-center rounded-lg bg-[#F5F5F5] border border-dashed border-[#E6E6E6] space-y-1">
                    <Award className="w-6 h-6 text-[#808080] mx-auto mb-1" />
                    <p className="text-xs font-semibold text-black">No additional certifications submitted yet</p>
                    <p className="text-[11px] text-[#808080] max-w-md mx-auto">
                      Click &ldquo;Add Certification / Credential&rdquo; to submit AWS, Google Cloud, Azure, or professional qualifications for verification.
                    </p>
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {certDocs.map(renderDocumentCard)}
                </div>
              );
            })()}
          </div>
        </div>
      )}

      {/* Tab 4: Documents */}
      {activeTab === "documents" && (
        <div className="p-6 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-black">Verified Employee Documents</h3>
              <p className="text-xs text-[#808080] mt-0.5">
                Onboarding records, additional verified credentials, and compliance documents.
              </p>
            </div>
          </div>

          {docs.length === 0 ? (
            <p className="text-xs text-[#808080]">No documents uploaded or all archived in Google Drive.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {docs.map(renderDocumentCard)}
            </div>
          )}
        </div>
      )}

      {/* Tab 5: Internship Details */}
      {activeTab === "internship" && (
        <div className="p-6 rounded-xl bg-card border border-border-light space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-text-primary">Internship Management Dossier</h3>
              <p className="text-xs text-text-secondary mt-0.5">
                Dynamic internship lifecycle tracking, mentor evaluations, and certificate status.
              </p>
            </div>
            <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/10 text-amber-500 border border-amber-500/20">
              Status: {internship?.status || "Active"}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-1.5">
              <p className="text-text-muted">Assigned Mentor:</p>
              <p className="font-bold text-text-primary">{internship?.mentor?.full_name || "Not Assigned"}</p>
              <p className="text-[11px] text-text-muted">{internship?.mentor ? "Assigned Mentor" : "Mentor Not Assigned"}</p>
            </div>
            <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-1.5">
              <p className="text-text-muted">Internship Period:</p>
              <p className="font-bold text-text-primary">
                {internship?.start_date || "2026-01-15"} to {internship?.end_date || "2026-04-15"}
              </p>
              <p className="text-[11px] text-text-muted">Duration: {internship?.duration_months || 3} Months</p>
            </div>
            <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-1.5">
              <p className="text-text-muted">Certificate Status:</p>
              <p className="font-bold text-text-primary">
                {internship?.certificate_issued ? "Issued & Certified" : "Pending Evaluation"}
              </p>
              <p className="text-[11px] text-text-muted">Tracked upon final completion</p>
            </div>
          </div>
        </div>
      )}

      {/* Tab 6: Hourly Permissions */}
      {activeTab === "permissions" && (
        <div className="p-6 rounded-xl bg-card border border-border-light space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-text-primary">Hourly permission requests</h3>
              <p className="text-xs text-text-secondary mt-0.5">
                Short-duration permissions (personal, medical, emergency, examination) recorded with attendance.
              </p>
            </div>
            {isLoaded && (
              <button
                onClick={() => setPermissionModalOpen(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-brand-purple text-white hover:bg-brand-purple/90"
              >
                New Request
              </button>
            )}
          </div>

          {permissions.length === 0 ? (
            <p className="text-xs text-text-muted">No permission requests submitted yet.</p>
          ) : (
            <div className="space-y-3">
              {permissions.map((p: any) => (
                <div
                  key={p.id}
                  className="p-4 rounded-2xl bg-card-subtle border border-border-light flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-text-primary">{p.permission_date}</span>
                      <span className="font-mono text-text-muted">
                        ({p.start_time?.slice(0, 5)} - {p.end_time?.slice(0, 5)})
                      </span>
                      <span className="font-semibold text-brand-purple">• {p.duration_minutes} mins</span>
                    </div>
                    <p className="text-text-secondary mt-1">Reason: {p.reason}</p>
                  </div>

                  <span
                    className={cn(
                      "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                      p.status === "approved"
                        ? "bg-lime/20 text-black border border-lime/40"
                        : p.status === "rejected"
                          ? "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                          : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                    )}
                  >
                    {p.status}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 7: Attendance Summary */}
      {activeTab === "attendance" && (
        <div className="p-6 rounded-xl bg-card border border-border-light space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-text-primary">Attendance Logs & Summary</h3>
              <p className="text-xs text-text-muted mt-0.5">Authoritative daily punch records and punctuality audits.</p>
            </div>
            <div className="text-xs font-mono text-text-muted">
              Total Workdays: {attendance.filter((a: any) => a.status === "present").length} Days Present
            </div>
          </div>

          {attendance.length === 0 ? (
            <p className="text-xs text-text-muted">No attendance days logged for this employee.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-border-light text-text-muted">
                    <th className="py-2.5 px-3">Date</th>
                    <th className="py-2.5 px-3">Status</th>
                    <th className="py-2.5 px-3">Logged Hours</th>
                    <th className="py-2.5 px-3">Punctuality</th>
                    <th className="py-2.5 px-3">Lock State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light/40">
                  {attendance.map((a: any) => {
                    const isNonWork = a.status === "weekend" || a.status === "holiday" || a.status === "absent";
                    const hours = !isNonWork && a.total_minutes ? `${(a.total_minutes / 60).toFixed(1)}h` : "--";
                    const punctuality = isNonWork ? "--" : a.is_late ? "Late" : "On Time";

                    return (
                      <tr key={a.id || a.work_date} className="text-text-secondary hover:bg-card-subtle/50 transition-colors">
                        <td className="py-2.5 px-3 font-mono font-bold text-text-primary">{a.work_date}</td>
                        <td className="py-2.5 px-3">
                          <span
                            className={cn(
                              "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                              a.status === "present"
                                ? "bg-lime/20 text-black"
                                : a.status === "absent"
                                  ? "bg-rose-500/10 text-rose-500"
                                  : a.status === "holiday"
                                    ? "bg-purple-500/10 text-purple-500"
                                    : "bg-neutral-500/10 text-neutral-400"
                            )}
                          >
                            • {a.status}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-bold text-text-primary">{hours}</td>
                        <td className="py-2.5 px-3 font-medium">
                          <span className={punctuality === "On Time" ? "text-black font-bold" : ""}>
                            {punctuality}
                          </span>
                        </td>
                        <td className="py-2.5 px-3 font-mono text-text-muted">{a.locked ? "Locked" : "Open"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 8: Career Timeline */}
      {activeTab === "history" && (
        <div className="p-6 rounded-xl bg-card border border-border-light space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-bold text-text-primary">Effective-Dated Career Timeline</h3>
              <p className="text-xs text-text-muted mt-0.5">Chronological record of promotions, role adjustments, and organizational milestones.</p>
            </div>
            {isAdminOrHr && (
              <button
                onClick={() => setCareerModalOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Career Milestone</span>
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="p-4 rounded-2xl bg-card-subtle text-xs text-text-muted">
              Initial employment event recorded upon provisioning.
            </div>
          ) : (
            <div className="space-y-3">
              {history.map((h: any) => (
                <div key={h.id} className="p-4 rounded-2xl bg-card-subtle border border-border-light text-xs space-y-1">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-brand-purple">{h.event_type}</span>
                    <span className="font-mono text-text-muted">{h.effective_date}</span>
                  </div>
                  <p className="text-text-secondary">{h.notes || "Employment lifecycle state updated."}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* EDIT PARAMETERS MODAL */}
      {editModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4 overflow-y-auto">
          <div className="w-full max-w-2xl rounded-xl bg-card border border-border-light p-6 shadow-float space-y-4 my-8 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-border-light pb-3">
              <h3 className="text-base font-bold text-text-primary">Edit Employee Parameters</h3>
              <button onClick={() => setEditModalOpen(false)} className="text-text-muted hover:text-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveParams} className="space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Full Name</label>
                  <input
                    type="text"
                    value={formData.full_name || ""}
                    onChange={(e) => setFormData({ ...formData, full_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                    required
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Employment Category</label>
                  <select
                    value={formData.employment_category || "full_time"}
                    onChange={(e) => setFormData({ ...formData, employment_category: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="full_time">Full Time</option>
                    <option value="intern">Intern</option>
                    <option value="contractor">Contractor</option>
                    <option value="part_time">Part Time</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Department</label>
                  <select
                    value={formData.department_id || ""}
                    onChange={(e) => setFormData({ ...formData, department_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="">-- Select Department --</option>
                    {departments.map((d: any) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Designation / Job Title</label>
                  <select
                    value={formData.job_title_id || ""}
                    onChange={(e) => setFormData({ ...formData, job_title_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="">-- Select Designation --</option>
                    {jobTitles.map((jt: any) => (
                      <option key={jt.id} value={jt.id}>
                        {jt.title_name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Work Mode</label>
                  <select
                    value={formData.work_mode || "remote"}
                    onChange={(e) => setFormData({ ...formData, work_mode: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="remote">Remote</option>
                    <option value="hybrid">Hybrid</option>
                    <option value="office">Office</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Reporting Manager</label>
                  <select
                    value={formData.manager_id || ""}
                    onChange={(e) => setFormData({ ...formData, manager_id: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="">-- None / Direct Report --</option>
                    {managers.map((m: any) => (
                      <option key={m.id} value={m.id}>
                        {m.full_name} ({m.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Shift Start Time</label>
                  <input
                    type="time"
                    value={formData.shift_start_time || "09:00"}
                    onChange={(e) => setFormData({ ...formData, shift_start_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Shift End Time</label>
                  <input
                    type="time"
                    value={formData.shift_end_time || "18:00"}
                    onChange={(e) => setFormData({ ...formData, shift_end_time: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Timezone</label>
                  <input
                    type="text"
                    value={formData.timezone || "Asia/Kolkata"}
                    onChange={(e) => setFormData({ ...formData, timezone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Daily Target Hours</label>
                  <input
                    type="number"
                    value={(formData.work_target_minutes || 480) / 60}
                    onChange={(e) => setFormData({ ...formData, work_target_minutes: Number(e.target.value) * 60 })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                    step="0.5"
                    min="1"
                    max="16"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Highest Qualification</label>
                  <select
                    value={formData.highest_qualification || "12th Standard"}
                    onChange={(e) => setFormData({ ...formData, highest_qualification: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="10th Standard">10th Standard</option>
                    <option value="12th Standard">12th Standard</option>
                    <option value="Diploma">Diploma</option>
                    <option value="Undergraduate Degree">Undergraduate Degree (Bachelor&apos;s)</option>
                    <option value="Postgraduate Degree">Postgraduate Degree (Master&apos;s)</option>
                    <option value="Doctorate / PhD">Doctorate / PhD</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Account Status</label>
                  <select
                    value={formData.status || "active"}
                    onChange={(e) => setFormData({ ...formData, status: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Phone Number</label>
                  <input
                    type="text"
                    value={formData.phone || ""}
                    onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Emergency Contact</label>
                  <input
                    type="text"
                    value={formData.emergency_contact || ""}
                    onChange={(e) => setFormData({ ...formData, emergency_contact: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                    placeholder="Name - Phone"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Bank Name</label>
                  <input
                    type="text"
                    value={formData.bank_name || ""}
                    onChange={(e) => setFormData({ ...formData, bank_name: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Bank Account Number</label>
                  <input
                    type="text"
                    value={formData.bank_account_number || ""}
                    onChange={(e) => setFormData({ ...formData, bank_account_number: e.target.value })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Bank IFSC</label>
                  <input
                    type="text"
                    value={formData.bank_ifsc || ""}
                    onChange={(e) => setFormData({ ...formData, bank_ifsc: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary font-mono"
                  />
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">PAN Card Number</label>
                  <input
                    type="text"
                    value={formData.pan_number || ""}
                    onChange={(e) => setFormData({ ...formData, pan_number: e.target.value.toUpperCase() })}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary font-mono"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-light">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-card-subtle hover:bg-card border border-border-light font-semibold text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingParams}
                  className="px-5 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white font-bold transition-all shadow-sm flex items-center gap-2"
                >
                  {savingParams ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{savingParams ? "Saving Changes..." : "Save Parameters"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SUBMIT ADDITIONAL DOCUMENT / CERTIFICATION MODAL */}
      {docModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg rounded-[14px] bg-white border border-[#E6E6E6] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-[#E6E6E6] pb-3">
              <div>
                <h3 className="text-base font-bold text-black tracking-tight">Submit Certification or Credential</h3>
                <p className="text-xs text-[#808080] mt-0.5">
                  Upload industry certificates (AWS, Google Cloud, Azure, etc.) or educational documents.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDocModalOpen(false)}
                className="text-[#808080] hover:text-black p-1 rounded-md"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUploadAdditionalDoc} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-black mb-1">
                  Certification / Document Type
                </label>
                <select
                  value={selectedDocType}
                  onChange={(e) => setSelectedDocType(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-black focus:outline-none focus:ring-2 focus:ring-black"
                  required
                >
                  {Array.from(new Set(availableDocTypes.map((t) => t.category))).map((category) => (
                    <optgroup key={category} label={category}>
                      {availableDocTypes
                        .filter((t) => t.category === category)
                        .map((t) => (
                          <option key={t.key} value={t.key}>
                            {t.label}
                          </option>
                        ))}
                    </optgroup>
                  ))}
                </select>
                <p className="text-[11px] text-[#808080] mt-1">
                  Excludes documents you have already submitted.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-black mb-1">
                  Specific Credential / Course Title (Optional)
                </label>
                <input
                  type="text"
                  value={customDocTitle}
                  onChange={(e) => setCustomDocTitle(e.target.value)}
                  placeholder="e.g., AWS Certified Solutions Architect - Associate SAA-C03"
                  className="w-full px-3 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-black placeholder:text-[#808080] focus:outline-none focus:ring-2 focus:ring-black"
                />
                <p className="text-[11px] text-[#808080] mt-0.5">
                  Leave blank to use the standard title from the dropdown above.
                </p>
              </div>

              <div>
                <label className="block font-semibold text-black mb-1">Select File (PDF, JPG, PNG)</label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) setDocFile(f);
                  }}
                  className="w-full text-xs text-[#808080] file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-black file:text-white hover:file:bg-[#1A1A1A] cursor-pointer"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-[#E6E6E6]">
                <button
                  type="button"
                  onClick={() => setDocModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] font-semibold text-black text-xs cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={uploadingDoc}
                  className="px-4 py-2 rounded-lg bg-black hover:bg-[#1A1A1A] text-white font-semibold text-xs transition-colors shadow-xs flex items-center gap-2 cursor-pointer"
                >
                  {uploadingDoc ? <Loader2 className="w-4 h-4 animate-spin text-[#B7FF00]" /> : <Upload className="w-4 h-4 text-[#B7FF00]" />}
                  <span>{uploadingDoc ? "Uploading..." : "Submit for Approval"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* REJECT DOCUMENT MODAL */}
      {rejectModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-card border border-border-light p-6 shadow-float space-y-4">
            <h3 className="text-base font-bold text-text-primary">Reject Document</h3>
            <p className="text-xs text-text-secondary">Please enter the reason for rejecting this document:</p>
            <textarea
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
              placeholder="e.g., Illegible scan, name mismatch, or expired certificate."
              className="w-full h-24 p-3 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
              required
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setRejectModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => rejectingDocId && handleReviewDocument(rejectingDocId, "reject", rejectionReason)}
                className="px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white text-xs font-bold"
              >
                Confirm Rejection
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ADD CAREER MILESTONE MODAL */}
      {careerModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-card border border-border-light p-6 shadow-float space-y-4">
            <div className="flex items-center justify-between border-b border-border-light pb-3">
              <h3 className="text-base font-bold text-text-primary">Add Career Milestone</h3>
              <button onClick={() => setCareerModalOpen(false)} className="text-text-muted hover:text-text-primary">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddCareerEvent} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-text-secondary mb-1">Event Type</label>
                <select
                  value={careerEventType}
                  onChange={(e) => setCareerEventType(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                >
                  <option value="Promotion">Promotion</option>
                  <option value="Role Transfer">Role / Job Title Change</option>
                  <option value="Department Transfer">Department Transfer</option>
                  <option value="Merit Increase">Appraisal / Merit Increase</option>
                  <option value="Milestone Achievement">Key Milestone Achievement</option>
                  <option value="Special Commendation">Special Commendation / Award</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-text-secondary mb-1">Effective Date</label>
                <input
                  type="date"
                  value={careerEffectiveDate}
                  onChange={(e) => setCareerEffectiveDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  required
                />
              </div>

              <div>
                <label className="block font-semibold text-text-secondary mb-1">Notes / Description</label>
                <textarea
                  value={careerNotes}
                  onChange={(e) => setCareerNotes(e.target.value)}
                  placeholder="e.g., Promoted to Lead Architect following exceptional H2 performance."
                  className="w-full h-20 p-3 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-border-light">
                <button
                  type="button"
                  onClick={() => setCareerModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-card-subtle hover:bg-card border border-border-light font-semibold text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCareer}
                  className="px-5 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white font-bold transition-all shadow-sm flex items-center gap-2"
                >
                  {savingCareer ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  <span>{savingCareer ? "Saving..." : "Add to Timeline"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* HOURLY PERMISSION REQUEST MODAL */}
      {permissionModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl bg-card border border-border-light p-6 shadow-float space-y-4">
            <h3 className="text-base font-bold text-text-primary">Submit Hourly Permission Request</h3>
            <p className="text-xs text-text-secondary">
              Apply for up to 4 hours of short permission without affecting full-day leave balance.
            </p>

            <form onSubmit={handleRequestPermission} className="space-y-3 text-xs">
              <div>
                <label className="block font-semibold text-text-secondary mb-1">Permission Date</label>
                <input
                  type="date"
                  value={permDate}
                  onChange={(e) => setPermDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Start Time</label>
                  <input
                    type="time"
                    value={permStart}
                    onChange={(e) => setPermStart(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">End Time</label>
                  <input
                    type="time"
                    value={permEnd}
                    onChange={(e) => setPermEnd(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Duration (Mins)</label>
                  <input
                    type="number"
                    value={permDuration}
                    onChange={(e) => setPermDuration(Number(e.target.value))}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                    min={15}
                    max={480}
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Permission Type</label>
                  <select
                    value={permType}
                    onChange={(e) => setPermType(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="personal">Personal / Family</option>
                    <option value="examination">Examination</option>
                    <option value="medical">Medical / Hospital</option>
                    <option value="emergency">Emergency</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-text-secondary mb-1">Reason</label>
                <textarea
                  value={permReason}
                  onChange={(e) => setPermReason(e.target.value)}
                  placeholder="State the reason clearly..."
                  className="w-full h-20 p-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  required
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3">
                <button
                  type="button"
                  onClick={() => setPermissionModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-card-subtle border border-border-light font-semibold text-text-secondary"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingPerm}
                  className="px-5 py-2 rounded-xl bg-brand-purple text-white font-bold transition-all shadow-sm flex items-center gap-2"
                >
                  {submittingPerm ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  <span>{submittingPerm ? "Submitting..." : "Submit Request"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
