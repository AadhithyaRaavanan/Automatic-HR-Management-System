"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  CheckCircle2,
  Upload,
  ArrowRight,
  ArrowLeft,
  Save,
  ShieldCheck,
  Building,
  GraduationCap,
  Briefcase,
  User,
  CreditCard,
  FileText,
  AlertCircle,
  FileCheck,
  Check,
  Building2,
  Clock,
  ExternalLink,
  Info,
  Calendar,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  HighestQualification,
  QUALIFICATION_DOC_MAP,
  MONTH_NAMES,
  OnboardingDocRecord,
  OnboardingWorkflowStatus,
} from "@/lib/onboarding-types";

const QUALIFICATION_OPTIONS: HighestQualification[] = [
  "10th Standard",
  "12th Standard",
  "Diploma",
  "Undergraduate Degree",
  "Postgraduate Degree",
  "Doctorate",
  "Other",
];

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR, CURRENT_YEAR - 1, CURRENT_YEAR - 2];

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [uploadingDocKey, setUploadingDocKey] = React.useState<string | null>(null);

  // Workflow State & Current Step (1 to 5, and 6 for Review)
  const [workflowStatus, setWorkflowStatus] = React.useState<OnboardingWorkflowStatus>("NOT_STARTED");
  const [currentStep, setCurrentStep] = React.useState<number>(1);
  const [declarationAgreed, setDeclarationAgreed] = React.useState(false);

  // Employee Identity Meta
  const [employeeMeta, setEmployeeMeta] = React.useState<{
    fullName: string;
    employeeId: string;
    department: string;
    designation: string;
    email: string;
    role: string;
  }>({
    fullName: "",
    employeeId: "",
    department: "",
    designation: "",
    email: "",
    role: "employee",
  });

  // STEP 1: Personal Information
  const [fullName, setFullName] = React.useState("");
  const [dob, setDob] = React.useState("");
  const [gender, setGender] = React.useState("Prefer not to say");
  const [phone, setPhone] = React.useState("");
  const [personalEmail, setPersonalEmail] = React.useState("");
  const [currentAddress, setCurrentAddress] = React.useState("");
  const [permanentAddress, setPermanentAddress] = React.useState("");
  const [sameAsCurrentAddress, setSameAsCurrentAddress] = React.useState(false);
  const [emergencyContactName, setEmergencyContactName] = React.useState("");
  const [emergencyContactRelationship, setEmergencyContactRelationship] = React.useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = React.useState("");
  const [bloodGroup, setBloodGroup] = React.useState("");

  // STEP 2: Educational Qualification
  const [highestQualification, setHighestQualification] = React.useState<HighestQualification>("Undergraduate Degree");

  // STEP 3: Employment History
  const [hasExperience, setHasExperience] = React.useState<boolean>(false);
  const [prevCompany, setPrevCompany] = React.useState("");
  const [prevDesignation, setPrevDesignation] = React.useState("");
  const [prevStartDate, setPrevStartDate] = React.useState("");
  const [prevEndDate, setPrevEndDate] = React.useState("");
  const [prevHrEmail, setPrevHrEmail] = React.useState("");
  const [prevHrPhone, setPrevHrPhone] = React.useState("");
  const [prevEmployeeId, setPrevEmployeeId] = React.useState("");
  const [experienceExplanation, setExperienceExplanation] = React.useState("");

  // Salary slip upload helper state
  const [selectedSlipMonth, setSelectedSlipMonth] = React.useState(MONTH_NAMES[new Date().getMonth()]);
  const [selectedSlipYear, setSelectedSlipYear] = React.useState(String(CURRENT_YEAR));

  // STEP 4: Identity Documents
  const [panNumber, setPanNumber] = React.useState("");
  const [aadhaarNumber, setAadhaarNumber] = React.useState("");

  // STEP 5: Bank & Payroll Details
  const [bankAccountHolder, setBankAccountHolder] = React.useState("");
  const [bankAccountNumber, setBankAccountNumber] = React.useState("");
  const [confirmBankAccountNumber, setConfirmBankAccountNumber] = React.useState("");
  const [bankIfsc, setBankIfsc] = React.useState("");
  const [bankName, setBankName] = React.useState("");
  const [bankBranch, setBankBranch] = React.useState("");
  const [uanNumber, setUanNumber] = React.useState("");

  // Uploaded Documents List
  const [documents, setDocuments] = React.useState<OnboardingDocRecord[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const cached = sessionStorage.getItem("onboarding_cached_documents");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) return parsed;
        }
      } catch { }
    }
    return [];
  });

  // 1. Load Profile & Existing Progress
  const fetchProfileData = React.useCallback(async () => {
    try {
      // If coming from Supabase invite hash (#access_token=...), wait for session
      let session = null;
      if (typeof window !== "undefined" && window.location.hash.includes("access_token")) {
        try {
          const { data } = await supabase.auth.getSession();
          session = data?.session;
          window.history.replaceState(null, "", window.location.pathname);
        } catch (e) {
          console.warn("[Onboarding] Hash token error:", e);
        }
      }

      if (!session) {
        const { data } = await supabase.auth.getSession();
        session = data?.session;
      }

      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }

      const res = await fetch(`/api/onboarding/profile?t=${Date.now()}`, {
        headers,
        cache: "no-store",
      });
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/login");
          return;
        }
        throw new Error("Failed to load onboarding profile.");
      }

      const data = await res.json();
      if (data.user) {
        setEmployeeMeta({
          fullName: data.user.fullName || "",
          employeeId: data.user.employeeId || "",
          department: data.user.department || "General",
          designation: data.user.designation || "Employee",
          email: data.user.email || "",
          role: data.user.role || "employee",
        });
        setFullName((prev) => prev || data.user.fullName || "");
        setPersonalEmail((prev) => prev || data.user.email || "");
      }

      const p = data.onboardingProfile;
      if (p) {
        const edu = (p.education_details as any) || {};
        const rawStatus = (p.onboarding_status || p.status || "NOT_STARTED").toUpperCase() as OnboardingWorkflowStatus;
        setWorkflowStatus(rawStatus);

        if (p.full_name) setFullName(p.full_name);
        if (p.dob) setDob(p.dob);
        if (p.gender) setGender(p.gender);
        if (p.phone) setPhone(p.phone);
        if (p.personal_email) setPersonalEmail(p.personal_email);
        if (p.current_address) setCurrentAddress(p.current_address);
        if (p.permanent_address) setPermanentAddress(p.permanent_address);

        const emName = p.emergency_contact_name || edu.emergency_contact_name;
        if (emName) setEmergencyContactName(emName);
        const emRel = p.emergency_contact_relationship || edu.emergency_contact_relationship;
        if (emRel) setEmergencyContactRelationship(emRel);
        const emPhone = p.emergency_contact_phone || edu.emergency_contact_phone;
        if (emPhone) setEmergencyContactPhone(emPhone);
        if (p.blood_group) setBloodGroup(p.blood_group);

        const hq = p.highest_qualification || edu.highest_qualification;
        if (hq) setHighestQualification(hq as HighestQualification);

        const hasExp = p.has_experience !== undefined ? Boolean(p.has_experience) : (edu.has_experience !== undefined ? Boolean(edu.has_experience) : undefined);
        if (hasExp !== undefined) setHasExperience(hasExp);

        if (p.previous_company_name) setPrevCompany(p.previous_company_name);
        if (p.previous_designation) setPrevDesignation(p.previous_designation);
        if (p.previous_start_date) setPrevStartDate(p.previous_start_date);
        if (p.previous_end_date) setPrevEndDate(p.previous_end_date);
        if (p.previous_hr_email) setPrevHrEmail(p.previous_hr_email);
        if (p.previous_hr_phone) setPrevHrPhone(p.previous_hr_phone);
        if (p.previous_employee_id) setPrevEmployeeId(p.previous_employee_id);

        const expExpl = p.experience_explanation || edu.experience_explanation;
        if (expExpl) setExperienceExplanation(expExpl);

        if (p.pan_number) setPanNumber(p.pan_number);
        if (p.aadhaar_number) setAadhaarNumber(p.aadhaar_number);

        if (p.bank_account_holder) setBankAccountHolder(p.bank_account_holder);
        if (p.bank_account_number) {
          setBankAccountNumber(p.bank_account_number);
          setConfirmBankAccountNumber(p.bank_account_number);
        }
        if (p.bank_ifsc) setBankIfsc(p.bank_ifsc);
        if (p.bank_name) setBankName(p.bank_name);
        const bBranch = p.bank_branch || edu.bank_branch;
        if (bBranch) setBankBranch(bBranch);
        if (p.uan_number) setUanNumber(p.uan_number);
      }

      if (Array.isArray(data.documents)) {
        setDocuments((prev) => {
          // Merge server docs with any existing uploaded docs so nothing disappears
          const map = new Map<string, OnboardingDocRecord>();
          prev.forEach((d) => map.set(d.doc_type, d));
          data.documents.forEach((d: OnboardingDocRecord) => map.set(d.doc_type, d));
          const merged = Array.from(map.values());
          try {
            sessionStorage.setItem("onboarding_cached_documents", JSON.stringify(merged));
          } catch { }
          return merged;
        });
      }
    } catch (err: any) {
      toast.error(err?.message || "Error initializing onboarding session.");
    } finally {
      setLoading(false);
    }
  }, [router]);

  React.useEffect(() => {
    fetchProfileData();
  }, [fetchProfileData]);

  // Sync permanent address when checked
  const handleToggleSameAddress = (checked: boolean) => {
    setSameAsCurrentAddress(checked);
    if (checked) {
      setPermanentAddress(currentAddress);
    }
  };

  // Helper to find document by type
  const getDoc = (docType: string): OnboardingDocRecord | undefined => {
    return documents.find((d) => d.doc_type === docType);
  };

  const getSalarySlips = (): OnboardingDocRecord[] => {
    return documents.filter((d) => d.doc_type === "salary_slip");
  };

  // Upload handler for document (PDF, JPG, PNG)
  const handleUploadFile = async (
    docType: string,
    file: File,
    salaryMonth?: string,
    salaryYear?: string
  ) => {
    if (!file) return;

    const lowerName = file.name.toLowerCase();
    const isAllowedExt =
      lowerName.endsWith(".pdf") ||
      lowerName.endsWith(".jpg") ||
      lowerName.endsWith(".jpeg") ||
      lowerName.endsWith(".png");

    if (!isAllowedExt) {
      toast.error("Please upload a PDF, JPG, or PNG document.");
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast.error("File exceeds 10MB limit. Please upload a smaller file.");
      return;
    }

    const uploadKey = docType === "salary_slip" ? `salary_slip_${salaryMonth}_${salaryYear}` : docType;
    setUploadingDocKey(uploadKey);

    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = {};
      if (sessionData?.session?.access_token) {
        headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("docType", docType);
      formData.append("fullName", fullName || employeeMeta.fullName || "Candidate");
      formData.append("employeeId", employeeMeta.employeeId || "");
      if (salaryMonth) formData.append("salaryMonth", salaryMonth);
      if (salaryYear) formData.append("salaryYear", salaryYear);

      const res = await fetch("/api/onboarding/upload", {
        method: "POST",
        headers,
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "File upload failed.");
      }

      const resJson = await res.json();
      toast.success("Document uploaded securely.");

      // Instantly reflect in local state so UI updates without waiting
      if (resJson?.data) {
        const newDoc: OnboardingDocRecord = {
          id: resJson.data.fileName || `${docType}-${Date.now()}`,
          doc_type: docType,
          file_name: resJson.data.fileName,
          storage_path: resJson.data.storagePath,
          file_size: file.size,
          signedUrl: resJson.data.signedUrl || "",
          document_status: "pending",
          rejection_reason: null,
          uploaded_at: new Date().toISOString(),
          salary_month: salaryMonth || null,
          salary_year: salaryYear || null,
        };
        setDocuments((prev) => {
          const filtered = prev.filter((d) => d.doc_type !== docType);
          const updated = [...filtered, newDoc];
          try {
            sessionStorage.setItem("onboarding_cached_documents", JSON.stringify(updated));
          } catch { }
          return updated;
        });
      }

      // Refresh documents from backend
      await fetchProfileData();
    } catch (err: any) {
      toast.error(err.message || "Failed to upload document.");
    } finally {
      setUploadingDocKey(null);
    }
  };

  // Save Draft Handler
  const handleSaveDraft = async (silent: boolean = false) => {
    setSavingDraft(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionData?.session?.access_token) {
        headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
      }

      const res = await fetch("/api/onboarding/draft", {
        method: "POST",
        headers,
        body: JSON.stringify({
          full_name: fullName,
          dob,
          gender,
          phone,
          personal_email: personalEmail,
          current_address: currentAddress,
          permanent_address: permanentAddress,
          emergency_contact_name: emergencyContactName,
          emergency_contact_relationship: emergencyContactRelationship,
          emergency_contact_phone: emergencyContactPhone,
          blood_group: bloodGroup,
          highest_qualification: highestQualification,
          has_experience: hasExperience,
          previous_company_name: prevCompany,
          previous_designation: prevDesignation,
          previous_start_date: prevStartDate,
          previous_end_date: prevEndDate,
          previous_hr_email: prevHrEmail,
          previous_hr_phone: prevHrPhone,
          previous_employee_id: prevEmployeeId,
          experience_explanation: experienceExplanation,
          pan_number: panNumber,
          aadhaar_number: aadhaarNumber,
          bank_account_holder: bankAccountHolder,
          bank_account_number: bankAccountNumber,
          bank_ifsc: bankIfsc,
          bank_name: bankName,
          bank_branch: bankBranch,
          uan_number: uanNumber,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save draft.");
      }

      if (!silent) toast.success("Progress saved. You can resume anytime.");
    } catch (err: any) {
      console.warn("[handleSaveDraft] error:", err?.message);
      if (!silent) toast.error(err.message || "Failed to save draft.");
    } finally {
      setSavingDraft(false);
    }
  };

  // Validate step before advancing
  const validateStep = (step: number): boolean => {
    if (step === 1) {
      if (!fullName.trim()) {
        toast.error("Full name is required.");
        return false;
      }
      if (!dob) {
        toast.error("Date of birth is required.");
        return false;
      }
      if (!phone.trim()) {
        toast.error("Personal mobile number is required.");
        return false;
      }
      if (!personalEmail.trim() || !personalEmail.includes("@")) {
        toast.error("A valid personal email address is required.");
        return false;
      }
      if (!currentAddress.trim()) {
        toast.error("Current residential address is required.");
        return false;
      }
      if (!permanentAddress.trim()) {
        toast.error("Permanent residential address is required.");
        return false;
      }
      if (!emergencyContactName.trim() || !emergencyContactRelationship.trim() || !emergencyContactPhone.trim()) {
        toast.error("Emergency contact name, relationship, and phone are mandatory.");
        return false;
      }
      const isUserAdmin = employeeMeta.role === "admin";
      if (!isUserAdmin) {
        if (!getDoc("photo")) {
          toast.error("Passport-size photo (PDF, JPG, or PNG) is required in Step 1.");
          return false;
        }
        if (!getDoc("resume")) {
          toast.error("Candidate Resume / CV (PDF, JPG, or PNG) is required in Step 1.");
          return false;
        }
      }
      return true;
    }

    if (step === 2) {
      if (employeeMeta.role === "admin") return true;
      const requiredQualDocType = QUALIFICATION_DOC_MAP[highestQualification]?.docType;
      if (!getDoc(requiredQualDocType)) {
        toast.error(`Please upload your ${QUALIFICATION_DOC_MAP[highestQualification]?.label || "qualification certificate"} (PDF, JPG, or PNG).`);
        return false;
      }
      return true;
    }

    if (step === 3) {
      if (employeeMeta.role === "admin") return true;
      if (hasExperience) {
        if (!prevCompany.trim()) {
          toast.error("Previous company name is required.");
          return false;
        }
        if (!prevDesignation.trim()) {
          toast.error("Previous designation is required.");
          return false;
        }
        const hasExpCert = Boolean(getDoc("experience_cert"));
        const hasExplanation = Boolean(experienceExplanation.trim());
        if (!hasExpCert && !hasExplanation) {
          toast.error("Please upload your Experience Certificate or provide an explanation note for HR review.");
          return false;
        }
      }
      return true;
    }

    if (step === 4) {
      if (employeeMeta.role === "admin") return true;
      if (!panNumber.trim() || panNumber.trim().length !== 10) {
        toast.error("A valid 10-character PAN number is required.");
        return false;
      }
      if (!getDoc("pan_card")) {
        toast.error("PAN Card document (PDF, JPG, or PNG) is mandatory.");
        return false;
      }
      if (!aadhaarNumber.trim() || aadhaarNumber.trim().length !== 12) {
        toast.error("A valid 12-digit Aadhaar number is mandatory.");
        return false;
      }
      if (!getDoc("aadhaar_card")) {
        toast.error("Aadhaar Card document (PDF, JPG, or PNG) is mandatory.");
        return false;
      }
      return true;
    }

    if (step === 5) {
      if (employeeMeta.role === "admin") return true;
      if (!bankAccountHolder.trim()) {
        toast.error("Bank account holder name is required.");
        return false;
      }
      if (!bankAccountNumber.trim() || bankAccountNumber.length < 8) {
        toast.error("Please enter a valid bank account number.");
        return false;
      }
      if (bankAccountNumber !== confirmBankAccountNumber) {
        toast.error("Bank account numbers do not match.");
        return false;
      }
      const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
      if (!ifscRegex.test(bankIfsc.trim())) {
        toast.error("Please enter a valid 11-character IFSC code (e.g. HDFC0001234).");
        return false;
      }
      if (!bankName.trim()) {
        toast.error("Bank name is required.");
        return false;
      }
      if (!getDoc("bank_proof")) {
        toast.error("Bank proof (PDF, JPG, or PNG) is mandatory.");
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = async () => {
    if (!validateStep(currentStep)) return;
    try {
      await handleSaveDraft(true);
    } catch { }
    setCurrentStep((prev) => Math.min(prev + 1, 6));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  // Final Submit Handler
  const handleSubmitForVerification = async () => {
    if (!declarationAgreed) {
      toast.error("You must check the declaration box before submitting.");
      return;
    }

    setSubmitting(true);
    try {
      // First save all current draft fields
      try {
        await handleSaveDraft(true);
      } catch { }

      const { data: sessionData } = await supabase.auth.getSession();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (sessionData?.session?.access_token) {
        headers["Authorization"] = `Bearer ${sessionData.session.access_token}`;
      }

      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
        headers,
        body: JSON.stringify({
          declaration: true,
          highest_qualification: highestQualification,
          full_name: fullName,
          dob,
          gender,
          phone,
          personal_email: personalEmail,
          current_address: currentAddress,
          permanent_address: permanentAddress,
          emergency_contact_name: emergencyContactName,
          emergency_contact_relationship: emergencyContactRelationship,
          emergency_contact_phone: emergencyContactPhone,
          blood_group: bloodGroup,
          has_experience: hasExperience,
          previous_company_name: prevCompany,
          previous_designation: prevDesignation,
          previous_start_date: prevStartDate,
          previous_end_date: prevEndDate,
          previous_hr_email: prevHrEmail,
          previous_hr_phone: prevHrPhone,
          previous_employee_id: prevEmployeeId,
          experience_explanation: experienceExplanation,
          pan_number: panNumber,
          aadhaar_number: aadhaarNumber,
          bank_account_holder: bankAccountHolder,
          bank_account_number: bankAccountNumber,
          bank_ifsc: bankIfsc,
          bank_name: bankName,
          bank_branch: bankBranch,
          uan_number: uanNumber,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Submission failed.");
      }

      const resData = await res.json();
      toast.success("Onboarding submitted successfully! Your documents are being reviewed by HR.");
      setWorkflowStatus(resData.onboarding_status || "SUBMITTED");
      await fetchProfileData();
      router.push("/onboarding/pending");
    } catch (err: any) {
      toast.error(err.message || "Failed to submit onboarding.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface-ground flex items-center justify-center p-6">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-brand-purple border-t-transparent rounded-full animate-spin" />
          <p className="text-sm font-bold text-text-secondary">Loading onboarding portal...</p>
        </div>
      </div>
    );
  }

  // A. SUBMITTED or UNDER_REVIEW state: Redirect to "Wait Until Approval" screen
  if (["SUBMITTED", "UNDER_REVIEW", "RESUBMITTED"].includes(workflowStatus)) {
    if (typeof window !== "undefined") {
      router.replace("/onboarding/pending");
    }
    return null;
  }

  // B. COMPLETED or VERIFIED state view
  if (["COMPLETED", "VERIFIED"].includes(workflowStatus)) {
    return (
      <div className="min-h-screen bg-surface-ground flex flex-col justify-center items-center p-6">
        <div className="max-w-xl w-full bg-card rounded-3xl border border-status-success/30 shadow-float p-8 sm:p-10 text-center space-y-6">
          <div className="w-16 h-16 rounded-full bg-status-success/10 text-status-success flex items-center justify-center mx-auto shadow-md">
            <CheckCircle2 className="w-8 h-8" />
          </div>

          <div className="space-y-2">
            <span className="px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider bg-status-success/15 text-status-success">
              Profile Verified & Activated
            </span>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-text-primary tracking-tight">
              Welcome to the ZEN XEA Team!
            </h1>
            <p className="text-sm text-text-secondary">
              Your employee onboarding has been verified and approved by HR Admin. Your workspace access is now fully active.
            </p>
          </div>

          <div className="pt-2">
            <button
              type="button"
              onClick={() => {
                window.location.href = "/";
              }}
              className="w-full py-3.5 px-6 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-sm font-bold transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              <span>Enter Employee Dashboard</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // C. FULL ONBOARDING WIZARD INTERFACE (Active, In-Progress, or Correction Required)
  const rejectedDocs = documents.filter((d) => d.document_status === "rejected");
  const isCorrectionMode = workflowStatus === "CORRECTION_REQUIRED" && rejectedDocs.length > 0;

  return (
    <div className="min-h-screen bg-surface-ground flex flex-col text-text-primary">
      {/* Top Professional Header Banner */}
      <header className="sticky top-0 z-30 bg-card/90 backdrop-blur-md border-b border-border-light px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-navy flex items-center justify-center text-white font-extrabold text-base shadow-sm">
            Z
          </div>
          <div>
            <h1 className="text-base font-extrabold tracking-tight text-text-primary">
              ZEN XEA HRMS
            </h1>
            <p className="text-[11px] font-bold text-text-tertiary">
              Employee Onboarding & Document Verification
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={savingDraft}
            onClick={() => handleSaveDraft(false)}
            className="px-4 py-2 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-all flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
          >
            <Save className="w-3.5 h-3.5 text-brand-purple" />
            <span>{savingDraft ? "Saving..." : "Save Progress"}</span>
          </button>
          <button
            type="button"
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
            className="px-3.5 py-2 rounded-xl bg-card-subtle hover:bg-card border border-border-light text-xs font-bold text-text-secondary cursor-pointer"
          >
            Sign Out
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto p-4 sm:p-6 lg:p-8 space-y-6">
        {/* Welcome Callout Banner */}
        <section className="bg-gradient-to-r from-brand-navy via-brand-purple-dark to-brand-navy text-white rounded-3xl p-6 sm:p-8 shadow-float relative overflow-hidden">
          <div className="relative z-10 space-y-3">
            <span className="px-3 py-1 rounded-full text-[11px] font-extrabold uppercase tracking-wider bg-white/15 text-white backdrop-blur-sm border border-white/20">
              Welcome to ZEN XEA!
            </span>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
              Welcome aboard, {fullName || employeeMeta.fullName || "New Team Member"}!
            </h2>
            <p className="text-xs sm:text-sm text-white/80 max-w-2xl leading-relaxed">
              Before accessing your employee dashboard, please complete your employee profile and submit the required documents for verification.
            </p>

            <div className="flex flex-wrap items-center gap-3 pt-2 text-xs font-bold text-white/90">
              <span className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
                ID: {employeeMeta.employeeId || "Pending"}
              </span>
              <span className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
                Dept: {employeeMeta.department}
              </span>
              <span className="bg-white/10 px-3 py-1.5 rounded-lg border border-white/15">
                Role: {employeeMeta.designation}
              </span>
            </div>
          </div>
        </section>

        {/* Correction Required Banner */}
        {isCorrectionMode && (
          <div className="bg-status-danger/10 border-2 border-status-danger/40 rounded-2xl p-5 space-y-2">
            <div className="flex items-center gap-2 text-status-danger font-extrabold text-sm">
              <AlertTriangle className="w-5 h-5" />
              <span>Correction Required by HR Admin</span>
            </div>
            <p className="text-xs text-text-primary">
              HR Admin has reviewed your submission and requested corrections on <strong>{rejectedDocs.length}</strong> document(s). Please review the specific rejection remarks below, re-upload the genuine PDF file, and resubmit for verification.
            </p>
          </div>
        )}

        {/* Multi-Step Stepper Header */}
        <div className="bg-card rounded-2xl border border-border-light p-4 shadow-sm">
          <div className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            {[
              { num: 1, title: "Personal Details" },
              { num: 2, title: "Qualification" },
              { num: 3, title: "Employment" },
              { num: 4, title: "Identity Docs" },
              { num: 5, title: "Bank & Payroll" },
              { num: 6, title: "Review & Submit" },
            ].map((s) => {
              const isPast = currentStep > s.num;
              const isCurrent = currentStep === s.num;
              return (
                <button
                  key={s.num}
                  type="button"
                  onClick={() => {
                    if (s.num <= currentStep || validateStep(currentStep)) {
                      setCurrentStep(s.num);
                    }
                  }}
                  className={cn(
                    "flex flex-col sm:flex-row items-center gap-2 p-2.5 rounded-xl text-left transition-all cursor-pointer",
                    isCurrent
                      ? "bg-brand-purple-light/50 border border-brand-purple/40 text-brand-purple font-extrabold"
                      : isPast
                        ? "text-text-primary font-bold hover:bg-card-subtle"
                        : "text-text-tertiary font-medium opacity-60"
                  )}
                >
                  <div
                    className={cn(
                      "w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0",
                      isCurrent
                        ? "bg-brand-purple text-white font-extrabold"
                        : isPast
                          ? "bg-status-success text-white"
                          : "bg-card-subtle border border-border-light text-text-tertiary"
                    )}
                  >
                    {isPast ? <Check className="w-3.5 h-3.5" /> : s.num}
                  </div>
                  <span className="text-[11px] truncate">{s.title}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* STEP 1: Personal Information */}
        {currentStep === 1 && (
          <div className="bg-card rounded-3xl border border-border-light p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="border-b border-border-light pb-4">
              <h3 className="text-lg font-extrabold text-text-primary flex items-center gap-2">
                <User className="w-5 h-5 text-brand-purple" />
                <span>Step 1: Personal Information</span>
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Verify your personal details and emergency contact points.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Full Name (as per legal identity) <span className="text-status-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Aditya Ravanan"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Date of Birth <span className="text-status-danger">*</span>
                </label>
                <input
                  type="date"
                  required
                  value={dob}
                  onChange={(e) => setDob(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Personal Mobile Number <span className="text-status-danger">*</span>
                </label>
                <input
                  type="tel"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Personal Email Address <span className="text-status-danger">*</span>
                </label>
                <input
                  type="email"
                  required
                  value={personalEmail}
                  onChange={(e) => setPersonalEmail(e.target.value)}
                  placeholder="name@personal.com"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Gender (Optional / Policy)
                </label>
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                >
                  <option value="Male">Male</option>
                  <option value="Female">Female</option>
                  <option value="Non-binary">Non-binary</option>
                  <option value="Prefer not to say">Prefer not to say</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Blood Group (Optional)
                </label>
                <select
                  value={bloodGroup}
                  onChange={(e) => setBloodGroup(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                >
                  <option value="">Select blood group</option>
                  <option value="O+">O+</option>
                  <option value="O-">O-</option>
                  <option value="A+">A+</option>
                  <option value="A-">A-</option>
                  <option value="B+">B+</option>
                  <option value="B-">B-</option>
                  <option value="AB+">AB+</option>
                  <option value="AB-">AB-</option>
                </select>
              </div>
            </div>

            {/* Address fields */}
            <div className="space-y-4 pt-2 border-t border-border-light">
              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Current Residential Address <span className="text-status-danger">*</span>
                </label>
                <textarea
                  rows={2}
                  required
                  value={currentAddress}
                  onChange={(e) => {
                    setCurrentAddress(e.target.value);
                    if (sameAsCurrentAddress) setPermanentAddress(e.target.value);
                  }}
                  placeholder="Street, apartment, city, state, pin code"
                  className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div className="flex items-center gap-2">
                <input
                  id="same-addr-checkbox"
                  type="checkbox"
                  checked={sameAsCurrentAddress}
                  onChange={(e) => handleToggleSameAddress(e.target.checked)}
                  className="rounded border-border-light text-brand-purple focus:ring-brand-purple cursor-pointer"
                />
                <label htmlFor="same-addr-checkbox" className="text-xs font-bold text-text-secondary cursor-pointer">
                  Permanent address is same as current address
                </label>
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Permanent Residential Address <span className="text-status-danger">*</span>
                </label>
                <textarea
                  rows={2}
                  required
                  disabled={sameAsCurrentAddress}
                  value={permanentAddress}
                  onChange={(e) => setPermanentAddress(e.target.value)}
                  placeholder="Street, permanent house/family residence, city, state, pin code"
                  className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple disabled:opacity-60"
                />
              </div>
            </div>

            {/* Emergency Contact */}
            <div className="space-y-4 pt-2 border-t border-border-light">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-brand-purple" />
                <span>Emergency Contact Person Details</span>
              </h4>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                    Contact Name <span className="text-status-danger">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={emergencyContactName}
                    onChange={(e) => setEmergencyContactName(e.target.value)}
                    placeholder="e.g. Ramesh Ravanan"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                    Relationship <span className="text-status-danger">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={emergencyContactRelationship}
                    onChange={(e) => setEmergencyContactRelationship(e.target.value)}
                    placeholder="e.g. Father / Spouse / Guardian"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                    Emergency Phone <span className="text-status-danger">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={emergencyContactPhone}
                    onChange={(e) => setEmergencyContactPhone(e.target.value)}
                    placeholder="+91 98765 00000"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                  />
                </div>
              </div>
            </div>

            {/* Passport Size Photo & Resume Documentation */}
            <div className="space-y-4 pt-4 border-t border-border-light">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary flex items-center gap-2">
                <FileCheck className="w-4 h-4 text-brand-purple" />
                <span>Identification Photo & Resume Documentation</span>
              </h4>

              {/* 1. Passport Size Photo */}
              <div className="p-5 rounded-2xl border border-border-light bg-card-subtle space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                      Passport Size Photo (PDF / JPG / PNG) <span className="text-status-danger">*</span>
                    </h5>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Upload a recent, clear passport-style color photograph (PDF, JPG, or PNG format, max 10MB).
                    </p>
                  </div>
                  {getDoc("photo") && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-success/15 text-status-success flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Uploaded
                    </span>
                  )}
                </div>

                {getDoc("photo")?.document_status === "rejected" && (
                  <div className="p-3 bg-status-danger/10 text-status-danger rounded-xl text-xs font-bold">
                    HR Rejection Reason: {getDoc("photo")?.rejection_reason}
                  </div>
                )}

                {getDoc("photo") && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border-light text-xs">
                    <span className="font-mono text-text-primary truncate">
                      {getDoc("photo")?.file_name}
                    </span>
                    {getDoc("photo")?.signedUrl && (
                      <a
                        href={getDoc("photo")?.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-purple font-bold flex items-center gap-1 ml-2 shrink-0"
                      >
                        Preview <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}

                <div>
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all cursor-pointer shadow-sm">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{getDoc("photo") ? "Replace Photo" : "Upload Passport Photo"}</span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFile("photo", file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              {/* 2. Candidate Resume (Directly under Passport Size Photo) */}
              <div className="p-5 rounded-2xl border border-border-light bg-card-subtle space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                      Candidate Resume / Curriculum Vitae <span className="text-status-danger">*</span>
                    </h5>
                    <p className="text-xs text-text-secondary mt-0.5">
                      Upload your updated professional resume in PDF, JPG, or PNG format (max 10MB).
                    </p>
                  </div>
                  {getDoc("resume") && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-success/15 text-status-success flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Uploaded
                    </span>
                  )}
                </div>

                {getDoc("resume")?.document_status === "rejected" && (
                  <div className="p-3 bg-status-danger/10 text-status-danger rounded-xl text-xs font-bold">
                    HR Rejection Reason: {getDoc("resume")?.rejection_reason}
                  </div>
                )}

                {getDoc("resume") && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border-light text-xs">
                    <span className="font-mono text-text-primary truncate">
                      {getDoc("resume")?.file_name}
                    </span>
                    {getDoc("resume")?.signedUrl && (
                      <a
                        href={getDoc("resume")?.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-purple font-bold flex items-center gap-1 ml-2 shrink-0"
                      >
                        Preview <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}

                <div>
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all cursor-pointer shadow-sm">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{getDoc("resume") ? "Replace Resume" : "Upload Resume"}</span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFile("resume", file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 2: Educational Qualification */}
        {currentStep === 2 && (
          <div className="bg-card rounded-3xl border border-border-light p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="border-b border-border-light pb-4">
              <h3 className="text-lg font-extrabold text-text-primary flex items-center gap-2">
                <GraduationCap className="w-5 h-5 text-brand-purple" />
                <span>Step 2: Educational Qualification</span>
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Select your highest completed educational level. You only need to upload the certificate for your highest completed qualification.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  What is your highest completed educational qualification? <span className="text-status-danger">*</span>
                </label>
                <select
                  value={highestQualification}
                  onChange={(e) => setHighestQualification(e.target.value as HighestQualification)}
                  className="w-full sm:w-1/2 px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-bold text-text-primary focus:outline-none focus:border-brand-purple"
                >
                  {QUALIFICATION_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {opt}
                    </option>
                  ))}
                </select>
              </div>

              {/* Dynamic Mandatory Document Upload Field based on Highest Qualification */}
              <div className="pt-2">
                <div className="p-5 rounded-2xl border-2 border-dashed border-brand-purple/30 bg-brand-purple/5 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-extrabold text-text-primary">
                        Mandatory Upload: {QUALIFICATION_DOC_MAP[highestQualification]?.label} (PDF / JPG / PNG)
                      </h4>
                      <p className="text-xs text-text-secondary mt-0.5">
                        Please upload your genuine {highestQualification} certificate or provisional proof in PDF, JPG, or PNG format (max 10MB).
                      </p>
                    </div>
                    {getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType) && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-success/15 text-status-success flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Uploaded
                      </span>
                    )}
                  </div>

                  {/* Rejected alert if any */}
                  {getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType)?.document_status === "rejected" && (
                    <div className="p-3 bg-status-danger/10 text-status-danger rounded-xl text-xs font-bold">
                      HR Rejection Reason: {getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType)?.rejection_reason}
                    </div>
                  )}

                  {/* Current file link */}
                  {getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType) && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border-light text-xs">
                      <div className="flex items-center gap-2 truncate">
                        <FileText className="w-4 h-4 text-brand-purple shrink-0" />
                        <span className="font-mono text-text-primary truncate">
                          {getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType)?.file_name}
                        </span>
                      </div>
                      {getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType)?.signedUrl && (
                        <a
                          href={getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType)?.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-purple hover:underline font-bold text-xs flex items-center gap-1 shrink-0 ml-2"
                        >
                          <span>Preview</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* File input button */}
                  <div>
                    <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all cursor-pointer shadow-sm">
                      <Upload className="w-3.5 h-3.5" />
                      <span>
                        {uploadingDocKey === QUALIFICATION_DOC_MAP[highestQualification]?.docType
                          ? "Uploading..."
                          : getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType)
                            ? "Replace Certificate"
                            : "Upload Certificate"}
                      </span>
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        disabled={uploadingDocKey !== null}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile(QUALIFICATION_DOC_MAP[highestQualification]?.docType, file);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>
              </div>

              {/* Optional Certifications */}
              <div className="pt-4 border-t border-border-light space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-text-secondary">
                  Additional Professional Certifications / Training (Optional)
                </h4>
                <div className="p-4 rounded-xl bg-card-subtle border border-border-light flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-text-primary">
                      Additional Training or Specialized Certifications
                    </p>
                    <p className="text-[11px] text-text-tertiary">
                      AWS, Google Cloud, PMP, Scrum, or other specialized training proofs.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-card hover:bg-card-subtle border border-border-light text-xs font-bold text-text-primary transition-all cursor-pointer shadow-sm shrink-0">
                    <Upload className="w-3.5 h-3.5 text-brand-purple" />
                    <span>Upload Optional Proof</span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFile("additional_cert", file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* STEP 3: Employment History */}
        {currentStep === 3 && (
          <div className="bg-card rounded-3xl border border-border-light p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="border-b border-border-light pb-4">
              <h3 className="text-lg font-extrabold text-text-primary flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-brand-purple" />
                <span>Step 3: Employment History</span>
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Specify whether you have prior work experience or are joining as a fresher.
              </p>
            </div>

            {/* Experience Selection Toggle */}
            <div className="space-y-3">
              <label className="block text-xs font-bold text-text-primary uppercase tracking-wider">
                Do you have previous work experience? <span className="text-status-danger">*</span>
              </label>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setHasExperience(false)}
                  className={cn(
                    "p-4 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between",
                    !hasExperience
                      ? "border-brand-purple bg-brand-purple/10 text-brand-purple font-extrabold shadow-sm"
                      : "border-border-light bg-card hover:bg-card-subtle text-text-primary font-semibold"
                  )}
                >
                  <div>
                    <span className="text-sm block">Fresher</span>
                    <span className="text-xs font-normal opacity-75">
                      No previous full-time work experience; skip experience certificates.
                    </span>
                  </div>
                  {!hasExperience && <Check className="w-5 h-5" />}
                </button>

                <button
                  type="button"
                  onClick={() => setHasExperience(true)}
                  className={cn(
                    "p-4 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between",
                    hasExperience
                      ? "border-brand-purple bg-brand-purple/10 text-brand-purple font-extrabold shadow-sm"
                      : "border-border-light bg-card hover:bg-card-subtle text-text-primary font-semibold"
                  )}
                >
                  <div>
                    <span className="text-sm block">Experienced</span>
                    <span className="text-xs font-normal opacity-75">
                      Prior corporate experience; experience certificate & pay slips required.
                    </span>
                  </div>
                  {hasExperience && <Check className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* IF EXPERIENCED: Render mandatory fields and uploads */}
            {hasExperience && (
              <div className="space-y-6 pt-4 border-t border-border-light">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Previous Company Name <span className="text-status-danger">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={prevCompany}
                      onChange={(e) => setPrevCompany(e.target.value)}
                      placeholder="e.g. Acme Technologies Pvt Ltd"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Previous Designation <span className="text-status-danger">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={prevDesignation}
                      onChange={(e) => setPrevDesignation(e.target.value)}
                      placeholder="e.g. Senior Software Engineer"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Date of Joining <span className="text-status-danger">*</span>
                    </label>
                    <input
                      type="date"
                      value={prevStartDate}
                      onChange={(e) => setPrevStartDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Last Working Date <span className="text-status-danger">*</span>
                    </label>
                    <input
                      type="date"
                      value={prevEndDate}
                      onChange={(e) => setPrevEndDate(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Previous HR / Verifier Email
                    </label>
                    <input
                      type="email"
                      value={prevHrEmail}
                      onChange={(e) => setPrevHrEmail(e.target.value)}
                      placeholder="hr@previouscompany.com"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Previous Employee ID (Optional)
                    </label>
                    <input
                      type="text"
                      value={prevEmployeeId}
                      onChange={(e) => setPrevEmployeeId(e.target.value)}
                      placeholder="EMP1024"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                  </div>
                </div>

                {/* Upload Experience Certificate */}
                <div className="p-5 rounded-2xl border border-border-light bg-card-subtle space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                        Experience Certificate / Service Letter <span className="text-status-danger">*</span>
                      </h4>
                      <p className="text-xs text-text-secondary">
                        Issued by previous employer on official letterhead (PDF format).
                      </p>
                    </div>
                    {getDoc("experience_cert") && (
                      <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-success/15 text-status-success flex items-center gap-1">
                        <Check className="w-3 h-3" />
                        Uploaded
                      </span>
                    )}
                  </div>

                  {getDoc("experience_cert")?.document_status === "rejected" && (
                    <div className="p-3 bg-status-danger/10 text-status-danger rounded-xl text-xs font-bold border border-status-danger/20">
                      <span className="block font-extrabold uppercase text-[10px] text-status-danger">Correction Required / Admin Note:</span>
                      {getDoc("experience_cert")?.rejection_reason || "File was rejected by Admin. Please re-upload a clear and valid certificate."}
                    </div>
                  )}

                  {getDoc("experience_cert") && (
                    <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border-light text-xs">
                      <span className="font-mono text-text-primary truncate">
                        {getDoc("experience_cert")?.file_name}
                      </span>
                      {getDoc("experience_cert")?.signedUrl && (
                        <a
                          href={getDoc("experience_cert")?.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-brand-purple font-bold flex items-center gap-1 ml-2"
                        >
                          Preview <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}

                  <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all cursor-pointer shadow-sm">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Experience Certificate (PDF / JPG / PNG)</span>
                    <input
                      type="file"
                      accept="application/pdf,image/jpeg,image/png,image/webp"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleUploadFile("experience_cert", file);
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                {/* Last Three Months Salary Slips */}
                <div className="p-5 rounded-2xl border border-border-light bg-card-subtle space-y-4">
                  <div>
                    <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                      Last Three Months&apos; Salary Slips (PDF / JPG / PNG) <span className="text-status-danger">*</span>
                    </h4>
                    <p className="text-xs text-text-secondary">
                      Upload each monthly payslip individually with its corresponding month and year.
                    </p>
                  </div>

                  {/* Upload controls */}
                  <div className="flex flex-wrap items-center gap-3">
                    <select
                      value={selectedSlipMonth}
                      onChange={(e) => setSelectedSlipMonth(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-card border border-border-light text-xs font-bold text-text-primary"
                    >
                      {MONTH_NAMES.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>

                    <select
                      value={selectedSlipYear}
                      onChange={(e) => setSelectedSlipYear(e.target.value)}
                      className="px-3 py-2 rounded-xl bg-card border border-border-light text-xs font-bold text-text-primary"
                    >
                      {YEAR_OPTIONS.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>

                    <label className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all cursor-pointer shadow-sm">
                      <Upload className="w-3.5 h-3.5" />
                      <span>Upload Slip ({selectedSlipMonth} {selectedSlipYear})</span>
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("salary_slip", file, selectedSlipMonth, selectedSlipYear);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>

                  {/* Uploaded Slips List */}
                  {getSalarySlips().length > 0 && (
                    <div className="space-y-2 pt-2">
                      <p className="text-[11px] font-bold text-text-secondary">Uploaded Salary Slips:</p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {getSalarySlips().map((slip) => (
                          <div
                            key={slip.id || slip.file_name}
                            className="p-2.5 rounded-xl bg-card border border-border-light text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-mono text-text-primary truncate">
                                {slip.file_name}
                              </span>
                              {slip.signedUrl && (
                                <a
                                  href={slip.signedUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-brand-purple font-bold text-xs shrink-0 ml-2"
                                >
                                  View
                                </a>
                              )}
                            </div>
                            {slip.document_status === "rejected" && (
                              <div className="p-2 bg-status-danger/10 text-status-danger rounded-lg text-[11px] font-bold">
                                <strong>Admin Note:</strong> {slip.rejection_reason || "Correction required."}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Explanation note for HR if document unavailable */}
                <div className="space-y-2">
                  <label className="block text-xs font-bold text-text-primary uppercase tracking-wider">
                    Unable to provide a required previous employer document?
                  </label>
                  <textarea
                    rows={2}
                    value={experienceExplanation}
                    onChange={(e) => setExperienceExplanation(e.target.value)}
                    placeholder="Submit an explanation for HR review if you are awaiting relieving letters or final settlement slips..."
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                  />
                  <p className="text-[11px] text-text-tertiary">
                    Explanations are reviewed manually by HR Admin. Submitting an explanation does not automatically mark documents as verified.
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* STEP 4: Identity Documents */}
        {currentStep === 4 && (
          <div className="bg-card rounded-3xl border border-border-light p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="border-b border-border-light pb-4">
              <h3 className="text-lg font-extrabold text-text-primary flex items-center gap-2">
                <FileCheck className="w-5 h-5 text-brand-purple" />
                <span>Step 4: Identity Documents</span>
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Upload your mandatory PAN card PDF for tax and payroll processing.
              </p>
            </div>

            <div className="space-y-6">
              {/* PAN Section (Mandatory) */}
              <div className="p-5 rounded-2xl border-2 border-brand-purple/20 bg-brand-purple/5 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                    PAN Card (Permanent Account Number) <span className="text-status-danger">*</span>
                  </h4>
                  {getDoc("pan_card") && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-success/15 text-status-success flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Uploaded
                    </span>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      PAN Number (10 Alphanumeric Characters) <span className="text-status-danger">*</span>
                    </label>
                    <input
                      type="text"
                      maxLength={10}
                      value={panNumber}
                      onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                      placeholder="ABCDE1234F"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card border border-border-light text-xs font-mono font-bold tracking-widest text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Upload PAN Card (PDF / JPG / PNG) <span className="text-status-danger">*</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all cursor-pointer shadow-sm w-full justify-center">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{getDoc("pan_card") ? "Replace PAN Card" : "Upload PAN Card"}</span>
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("pan_card", file);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {getDoc("pan_card")?.document_status === "rejected" && (
                  <div className="p-3 bg-status-danger/10 text-status-danger rounded-xl text-xs font-bold border border-status-danger/20">
                    <span className="block font-extrabold uppercase text-[10px] text-status-danger">Correction Required / Admin Note:</span>
                    {getDoc("pan_card")?.rejection_reason || "File was rejected by Admin. Please re-upload a clear and valid document."}
                  </div>
                )}

                {getDoc("pan_card") && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border-light text-xs">
                    <span className="font-mono text-text-primary truncate">
                      {getDoc("pan_card")?.file_name}
                    </span>
                    {getDoc("pan_card")?.signedUrl && (
                      <a
                        href={getDoc("pan_card")?.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-purple font-bold flex items-center gap-1 ml-2"
                      >
                        Preview <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>

              {/* Aadhaar Section (Mandatory) */}
              <div className="p-5 rounded-2xl border border-border-light bg-card-subtle space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                    Aadhaar Card (Mandatory)
                  </h4>
                  {getDoc("aadhaar_card") ? (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-success/15 text-status-success flex items-center gap-1">
                      <Check className="w-3 h-3" />
                      Uploaded
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-danger/15 text-status-danger">
                      Required
                    </span>
                  )}
                </div>

                {getDoc("aadhaar_card")?.document_status === "rejected" && (
                  <div className="p-3 rounded-xl bg-status-danger/10 border border-status-danger/30 text-status-danger text-xs font-semibold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Aadhaar Document Requires Correction:</p>
                      <p>{getDoc("aadhaar_card")?.rejection_reason || "Please upload a clearer copy of your Aadhaar card."}</p>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Aadhaar Number (12 Digits) <span className="text-status-danger">*</span>
                    </label>
                    <input
                      type="text"
                      maxLength={12}
                      value={aadhaarNumber}
                      onChange={(e) => setAadhaarNumber(e.target.value.replace(/\D/g, ""))}
                      placeholder="123456789012"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card border border-border-light text-xs font-mono font-bold tracking-widest text-text-primary focus:outline-none focus:border-brand-purple"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                      Upload Aadhaar (PDF / JPG / PNG) <span className="text-status-danger">*</span>
                    </label>
                    <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-card hover:bg-card-subtle border border-border-light text-text-primary text-xs font-bold transition-all cursor-pointer shadow-sm w-full justify-center">
                      <Upload className="w-3.5 h-3.5 text-brand-purple" />
                      <span>{getDoc("aadhaar_card") ? "Replace Aadhaar" : "Upload Aadhaar"}</span>
                      <input
                        type="file"
                        accept="application/pdf,image/jpeg,image/png,image/webp"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleUploadFile("aadhaar_card", file);
                        }}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {getDoc("aadhaar_card") && (
                  <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border-light text-xs">
                    <span className="font-mono text-text-primary truncate">
                      {getDoc("aadhaar_card")?.file_name}
                    </span>
                    {getDoc("aadhaar_card")?.signedUrl && (
                      <a
                        href={getDoc("aadhaar_card")?.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-brand-purple font-bold flex items-center gap-1 ml-2"
                      >
                        Preview <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* STEP 5: Bank & Payroll Details */}
        {currentStep === 5 && (
          <div className="bg-card rounded-3xl border border-border-light p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="border-b border-border-light pb-4">
              <h3 className="text-lg font-extrabold text-text-primary flex items-center gap-2">
                <CreditCard className="w-5 h-5 text-brand-purple" />
                <span>Step 5: Bank and Payroll Details</span>
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Enter your salary disbursement bank account details and upload proof. Sensitive numbers will remain masked.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Bank Account Holder Name (as on bank records) <span className="text-status-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={bankAccountHolder}
                  onChange={(e) => setBankAccountHolder(e.target.value)}
                  placeholder="e.g. Aditya Ravanan"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Bank Name <span className="text-status-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="e.g. HDFC Bank"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Bank Account Number <span className="text-status-danger">*</span>
                </label>
                <input
                  type="password"
                  required
                  value={bankAccountNumber}
                  onChange={(e) => setBankAccountNumber(e.target.value.replace(/\D/g, ""))}
                  placeholder="Enter account number"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-mono font-bold tracking-widest text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Confirm Bank Account Number <span className="text-status-danger">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={confirmBankAccountNumber}
                  onChange={(e) => setConfirmBankAccountNumber(e.target.value.replace(/\D/g, ""))}
                  placeholder="Re-enter account number"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-mono font-bold tracking-widest text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  IFSC Code <span className="text-status-danger">*</span>
                </label>
                <input
                  type="text"
                  maxLength={11}
                  required
                  value={bankIfsc}
                  onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                  placeholder="e.g. HDFC0001234"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-mono font-bold tracking-widest text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Branch Name
                </label>
                <input
                  type="text"
                  value={bankBranch}
                  onChange={(e) => setBankBranch(e.target.value)}
                  placeholder="e.g. Indiranagar, Bengaluru"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5">
                  Universal Account Number (UAN) (if registered with EPFO)
                </label>
                <input
                  type="text"
                  maxLength={12}
                  value={uanNumber}
                  onChange={(e) => setUanNumber(e.target.value.replace(/\D/g, ""))}
                  placeholder="100000000000"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-mono font-bold tracking-widest text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>
            </div>

            {/* Mandatory Bank Proof Upload */}
            <div className="pt-4 border-t border-border-light space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                    Bank Proof: Passbook Front Page OR Cancelled Cheque (PDF) <span className="text-status-danger">*</span>
                  </h4>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Document must clearly display your account number, account holder name, and IFSC code.
                  </p>
                </div>
                {getDoc("bank_proof") && (
                  <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-status-success/15 text-status-success flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Uploaded
                  </span>
                )}
              </div>

              {getDoc("bank_proof") && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-card border border-border-light text-xs">
                  <span className="font-mono text-text-primary truncate">
                    {getDoc("bank_proof")?.file_name}
                  </span>
                  {getDoc("bank_proof")?.signedUrl && (
                    <a
                      href={getDoc("bank_proof")?.signedUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="text-brand-purple font-bold flex items-center gap-1 ml-2"
                    >
                      Preview <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              )}

              {getDoc("bank_proof")?.document_status === "rejected" && (
                <div className="p-3 bg-status-danger/10 text-status-danger rounded-xl text-xs font-bold border border-status-danger/20">
                  <span className="block font-extrabold uppercase text-[10px] text-status-danger">Correction Required / Admin Note:</span>
                  {getDoc("bank_proof")?.rejection_reason || "File was rejected by Admin. Please re-upload a clear and valid bank proof."}
                </div>
              )}

              <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all cursor-pointer shadow-sm">
                <Upload className="w-3.5 h-3.5" />
                <span>{getDoc("bank_proof") ? "Replace Bank Proof" : "Upload Bank Proof (PDF / JPG / PNG)"}</span>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUploadFile("bank_proof", file);
                  }}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        )}

        {/* STEP 6: Review and Declaration Screen */}
        {currentStep === 6 && (
          <div className="bg-card rounded-3xl border border-border-light p-6 sm:p-8 space-y-6 shadow-sm">
            <div className="border-b border-border-light pb-4">
              <h3 className="text-lg font-extrabold text-text-primary flex items-center gap-2">
                <ShieldCheck className="w-5 h-5 text-brand-purple" />
                <span>Review & Submit for Verification</span>
              </h3>
              <p className="text-xs text-text-secondary mt-1">
                Please verify all submitted profile details and uploaded PDF documents before sending to HR Admin.
              </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Personal Summary */}
              <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2 text-xs">
                <span className="font-extrabold uppercase text-[10px] tracking-wider text-brand-purple">
                  Personal Information
                </span>
                <p><strong>Name:</strong> {fullName}</p>
                <p><strong>DOB:</strong> {dob}</p>
                <p><strong>Phone:</strong> {phone}</p>
                <p><strong>Email:</strong> {personalEmail}</p>
                <p><strong>Current Address:</strong> {currentAddress}</p>
                <p><strong>Emergency Contact:</strong> {emergencyContactName} ({emergencyContactRelationship}) - {emergencyContactPhone}</p>
              </div>

              {/* Education & Employment */}
              <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2 text-xs">
                <span className="font-extrabold uppercase text-[10px] tracking-wider text-brand-purple">
                  Education & Experience
                </span>
                <p><strong>Highest Qualification:</strong> {highestQualification}</p>
                <p><strong>Employment Status:</strong> {hasExperience ? "Experienced" : "Fresher"}</p>
                {hasExperience && (
                  <>
                    <p><strong>Previous Company:</strong> {prevCompany}</p>
                    <p><strong>Designation:</strong> {prevDesignation}</p>
                  </>
                )}
                <p><strong>PAN Number:</strong> {panNumber || "Not entered"}</p>
              </div>

              {/* Bank Summary */}
              <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2 text-xs md:col-span-2">
                <span className="font-extrabold uppercase text-[10px] tracking-wider text-brand-purple">
                  Bank & Payroll Information
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <p><strong>Holder Name:</strong> {bankAccountHolder}</p>
                  <p>
                    <strong>Account Number:</strong>{" "}
                    {bankAccountNumber ? `•••• •••• ${bankAccountNumber.slice(-4)}` : "—"}
                  </p>
                  <p><strong>IFSC Code:</strong> {bankIfsc}</p>
                  <p><strong>Bank:</strong> {bankName}</p>
                  <p><strong>Branch:</strong> {bankBranch || "—"}</p>
                  <p><strong>UAN:</strong> {uanNumber || "—"}</p>
                </div>
              </div>
            </div>

            {/* Document Checklist & Missing Warning */}
            <div className="space-y-3 pt-2">
              <h4 className="text-xs font-extrabold uppercase tracking-wider text-text-primary">
                Uploaded Document Checklist
              </h4>

              <div className="space-y-2">
                {/* 1. Passport Size Photo */}
                <div className="p-3 rounded-xl bg-card border border-border-light flex items-center justify-between text-xs">
                  <span className="font-bold">Passport-Size Photo (PDF)</span>
                  {getDoc("photo") ? (
                    <span className="text-status-success font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Uploaded
                    </span>
                  ) : (
                    <span className="text-status-danger font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Missing
                    </span>
                  )}
                </div>

                {/* 2. Resume / CV */}
                <div className="p-3 rounded-xl bg-card border border-border-light flex items-center justify-between text-xs">
                  <span className="font-bold">Candidate Resume / CV (PDF)</span>
                  {getDoc("resume") ? (
                    <span className="text-status-success font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Uploaded
                    </span>
                  ) : (
                    <span className="text-status-danger font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Missing
                    </span>
                  )}
                </div>

                {/* 3. PAN */}
                <div className="p-3 rounded-xl bg-card border border-border-light flex items-center justify-between text-xs">
                  <span className="font-bold">PAN Card PDF</span>
                  {getDoc("pan_card") ? (
                    <span className="text-status-success font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Uploaded
                    </span>
                  ) : (
                    <span className="text-status-danger font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Missing
                    </span>
                  )}
                </div>

                {/* 2. Highest Qualification */}
                <div className="p-3 rounded-xl bg-card border border-border-light flex items-center justify-between text-xs">
                  <span className="font-bold">{highestQualification} Certificate</span>
                  {getDoc(QUALIFICATION_DOC_MAP[highestQualification]?.docType) || getDoc("cert_12th") || getDoc("cert_10th") || getDoc("cert_undergraduate") || getDoc("cert_diploma") || getDoc("cert_postgraduate") ? (
                    <span className="text-status-success font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Uploaded
                    </span>
                  ) : (
                    <span className="text-status-danger font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Missing
                    </span>
                  )}
                </div>

                {/* 3. Bank Proof */}
                <div className="p-3 rounded-xl bg-card border border-border-light flex items-center justify-between text-xs">
                  <span className="font-bold">Bank Proof (Passbook / Cheque)</span>
                  {getDoc("bank_proof") ? (
                    <span className="text-status-success font-bold flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" /> Uploaded
                    </span>
                  ) : (
                    <span className="text-status-danger font-bold flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5" /> Missing
                    </span>
                  )}
                </div>

                {/* 4. Experience Cert (if experienced) */}
                {hasExperience && (
                  <div className="p-3 rounded-xl bg-card border border-border-light flex items-center justify-between text-xs">
                    <span className="font-bold">Experience Certificate</span>
                    {getDoc("experience_cert") ? (
                      <span className="text-status-success font-bold flex items-center gap-1">
                        <Check className="w-3.5 h-3.5" /> Uploaded
                      </span>
                    ) : experienceExplanation ? (
                      <span className="text-status-warning font-bold">Explanation Provided</span>
                    ) : (
                      <span className="text-status-danger font-bold flex items-center gap-1">
                        <AlertCircle className="w-3.5 h-3.5" /> Missing
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Mandatory Declaration Checkbox */}
            <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
              <label className="flex items-start gap-3 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={declarationAgreed}
                  onChange={(e) => setDeclarationAgreed(e.target.checked)}
                  className="mt-0.5 rounded border-border-light text-brand-purple focus:ring-brand-purple cursor-pointer"
                />
                <span className="text-xs font-bold text-text-primary leading-relaxed">
                  &ldquo;I confirm that the information and documents submitted by me are accurate and authentic to the best of my knowledge.&rdquo;
                </span>
              </label>
            </div>

            {/* Final Action Button */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
              <button
                type="button"
                onClick={handleBack}
                className="w-full sm:w-auto px-5 py-3 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-all flex items-center justify-center gap-2 cursor-pointer shadow-sm"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back to Edit</span>
              </button>

              <button
                type="button"
                disabled={submitting || !declarationAgreed}
                onClick={handleSubmitForVerification}
                className="w-full sm:w-auto px-8 py-3.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-extrabold uppercase tracking-wider transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <ShieldCheck className="w-4 h-4 text-brand-purple" />
                <span>{submitting ? "Submitting for Verification..." : "Submit for Verification"}</span>
              </button>
            </div>
          </div>
        )}

        {/* Stepper Navigation Buttons (for steps 1-5) */}
        {currentStep < 6 && (
          <div className="flex items-center justify-between pt-2">
            <button
              type="button"
              disabled={currentStep === 1}
              onClick={handleBack}
              className="px-5 py-2.5 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-xs font-bold text-text-primary transition-all flex items-center gap-2 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shadow-sm"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back</span>
            </button>

            <button
              type="button"
              onClick={handleNext}
              className="px-6 py-2.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all flex items-center gap-2 cursor-pointer shadow-md"
            >
              <span>{currentStep === 5 ? "Review Submission" : "Continue"}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
