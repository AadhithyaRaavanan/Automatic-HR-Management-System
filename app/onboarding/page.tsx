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
  Lock,
  Eye,
  EyeOff,
  AlertCircle,
  FileCheck,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type CandidateType = "STUDENT_INTERN" | "GRADUATE_FRESHER" | "EXPERIENCED";

interface OnboardingDocument {
  id?: string;
  doc_type: string;
  file_name: string;
  storage_path: string;
  signedUrl?: string;
}

export default function OnboardingPage() {
  const router = useRouter();
  const supabase = React.useMemo(() => createClient(), []);

  const [loading, setLoading] = React.useState(true);
  const [savingDraft, setSavingDraft] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);
  const [uploadingDoc, setUploadingDoc] = React.useState<string | null>(null);

  // Current Step (1 to 6)
  const [currentStep, setCurrentStep] = React.useState<number>(1);

  // Form State
  const [candidateType, setCandidateType] = React.useState<CandidateType>("GRADUATE_FRESHER");
  const [fullName, setFullName] = React.useState("");
  const [personalEmail, setPersonalEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [dob, setDob] = React.useState("");
  const [gender, setGender] = React.useState("Prefer not to say");
  const [bloodGroup, setBloodGroup] = React.useState("");
  const [currentAddress, setCurrentAddress] = React.useState("");
  const [permanentAddress, setPermanentAddress] = React.useState("");
  const [panNumber, setPanNumber] = React.useState("");
  const [aadhaarNumber, setAadhaarNumber] = React.useState("");

  // Bank State
  const [bankAccountHolder, setBankAccountHolder] = React.useState("");
  const [bankAccountNumber, setBankAccountNumber] = React.useState("");
  const [bankIfsc, setBankIfsc] = React.useState("");
  const [bankName, setBankName] = React.useState("");
  const [uanNumber, setUanNumber] = React.useState("");

  // Experience State (For EXPERIENCED)
  const [prevCompany, setPrevCompany] = React.useState("");
  const [prevDesignation, setPrevDesignation] = React.useState("");
  const [prevStartDate, setPrevStartDate] = React.useState("");
  const [prevEndDate, setPrevEndDate] = React.useState("");
  const [prevHrEmail, setPrevHrEmail] = React.useState("");
  const [prevHrPhone, setPrevHrPhone] = React.useState("");
  const [prevEmployeeId, setPrevEmployeeId] = React.useState("");

  // Password Setup State
  const [password, setPassword] = React.useState("");
  const [confirmPassword, setConfirmPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);

  // Uploaded Documents Map: doc_type -> OnboardingDocument
  const [documents, setDocuments] = React.useState<Record<string, OnboardingDocument>>({});

  // 1. Session verification & URL hash token handler
  React.useEffect(() => {
    async function initSession() {
      try {
        // Clean URL hash if invite token is present
        if (typeof window !== "undefined" && window.location.hash) {
          // Let Supabase process the hash token
          await supabase.auth.getSession();
          window.history.replaceState(null, "", window.location.pathname);
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session) {
          const userRes = await supabase.auth.getUser();
          if (!userRes.data?.user) {
            router.replace("/login");
            return;
          }
        }

        // Fetch existing onboarding progress
        const res = await fetch("/api/onboarding/profile");
        if (res.ok) {
          const data = await res.json();
          if (data.profile?.onboarding_completed) {
            router.replace("/");
            return;
          }

          if (data.user?.fullName) setFullName(data.user.fullName);
          if (data.user?.email) setPersonalEmail(data.user.email);

          if (data.onboardingProfile) {
            const p = data.onboardingProfile;
            if (p.candidate_type) setCandidateType(p.candidate_type);
            if (p.full_name) setFullName(p.full_name);
            if (p.personal_email) setPersonalEmail(p.personal_email);
            if (p.phone) setPhone(p.phone);
            if (p.dob) setDob(p.dob);
            if (p.gender) setGender(p.gender);
            if (p.blood_group) setBloodGroup(p.blood_group);
            if (p.current_address) setCurrentAddress(p.current_address);
            if (p.permanent_address) setPermanentAddress(p.permanent_address);
            if (p.pan_number) setPanNumber(p.pan_number);
            if (p.aadhaar_number) setAadhaarNumber(p.aadhaar_number);
            if (p.bank_account_holder) setBankAccountHolder(p.bank_account_holder);
            if (p.bank_account_number) setBankAccountNumber(p.bank_account_number);
            if (p.bank_ifsc) setBankIfsc(p.bank_ifsc);
            if (p.bank_name) setBankName(p.bank_name);
            if (p.uan_number) setUanNumber(p.uan_number);
            if (p.previous_company_name) setPrevCompany(p.previous_company_name);
            if (p.previous_designation) setPrevDesignation(p.previous_designation);
            if (p.previous_start_date) setPrevStartDate(p.previous_start_date);
            if (p.previous_end_date) setPrevEndDate(p.previous_end_date);
            if (p.previous_hr_email) setPrevHrEmail(p.previous_hr_email);
            if (p.previous_hr_phone) setPrevHrPhone(p.previous_hr_phone);
            if (p.previous_employee_id) setPrevEmployeeId(p.previous_employee_id);
          }

          if (Array.isArray(data.documents)) {
            const map: Record<string, OnboardingDocument> = {};
            data.documents.forEach((d: any) => {
              map[d.doc_type] = d;
            });
            setDocuments(map);
          }
        }
      } catch (err) {
        console.warn("[Onboarding Init]:", err);
      } finally {
        setLoading(false);
      }
    }

    initSession();
  }, [router, supabase]);

  // Steps definition based on candidate type
  const totalSteps = candidateType === "EXPERIENCED" ? 6 : 5;

  // Save draft helper
  const handleSaveDraft = async (silent: boolean = false) => {
    setSavingDraft(true);
    try {
      const res = await fetch("/api/onboarding/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidate_type: candidateType,
          full_name: fullName,
          phone,
          personal_email: personalEmail,
          dob,
          gender,
          blood_group: bloodGroup,
          current_address: currentAddress,
          permanent_address: permanentAddress,
          pan_number: panNumber,
          aadhaar_number: aadhaarNumber,
          bank_account_holder: bankAccountHolder,
          bank_account_number: bankAccountNumber,
          bank_ifsc: bankIfsc,
          bank_name: bankName,
          uan_number: uanNumber,
          previous_company_name: prevCompany,
          previous_designation: prevDesignation,
          previous_start_date: prevStartDate,
          previous_end_date: prevEndDate,
          previous_hr_email: prevHrEmail,
          previous_hr_phone: prevHrPhone,
          previous_employee_id: prevEmployeeId,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save draft.");
      }

      if (!silent) toast.success("Onboarding draft saved.");
    } catch (err: any) {
      if (!silent) toast.error(err.message || "Failed to save draft.");
    } finally {
      setSavingDraft(false);
    }
  };

  // Upload document handler
  const handleFileUpload = async (docType: string, file: File) => {
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast.error("File size must be under 5MB.");
      return;
    }

    const allowed = ["image/jpeg", "image/png", "application/pdf"];
    if (!allowed.includes(file.type)) {
      toast.error("Only JPG, PNG, and PDF files are supported.");
      return;
    }

    setUploadingDoc(docType);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("docType", docType);
      formData.append("fullName", fullName);

      const res = await fetch("/api/onboarding/upload", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Upload failed.");
      }

      const { data } = await res.json();
      setDocuments((prev) => ({
        ...prev,
        [docType]: {
          doc_type: docType,
          file_name: data.fileName,
          storage_path: data.storagePath,
          signedUrl: data.signedUrl,
        },
      }));

      toast.success(`${docType.replace(/_/g, " ").toUpperCase()} uploaded successfully.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to upload document.");
    } finally {
      setUploadingDoc(null);
    }
  };

  // Validation per step
  const validateCurrentStep = (): boolean => {
    if (currentStep === 1) return true;

    if (currentStep === 2) {
      if (!fullName.trim()) {
        toast.error("Please enter your full legal name.");
        return false;
      }
      if (!documents["photo"]) {
        toast.error("Passport-size photo upload is required.");
        return false;
      }
      if (!panNumber.trim() || !documents["pan_card"]) {
        toast.error("PAN number and PAN card document are required.");
        return false;
      }
      return true;
    }

    if (currentStep === 3) {
      if (!bankAccountHolder.trim() || !bankAccountNumber.trim() || !bankIfsc.trim() || !bankName.trim()) {
        toast.error("Please complete all required bank fields.");
        return false;
      }
      if (!documents["bank_proof"]) {
        toast.error("Bank proof (passbook front page or cancelled cheque) is required.");
        return false;
      }
      return true;
    }

    if (currentStep === 4) {
      if (!documents["cert_10th"]) {
        toast.error("10th mark sheet/certificate is required.");
        return false;
      }
      if (!documents["cert_12th"]) {
        toast.error("12th/Intermediate certificate is required.");
        return false;
      }
      if (candidateType === "STUDENT_INTERN") {
        if (!documents["college_id"] || !documents["bonafide_letter"]) {
          toast.error("College ID Card and Bonafide / College Letter are required for students/interns.");
          return false;
        }
      }
      return true;
    }

    if (currentStep === 5 && candidateType === "EXPERIENCED") {
      if (!prevCompany.trim() || !prevDesignation.trim()) {
        toast.error("Previous company name and designation are required.");
        return false;
      }
      if (!documents["experience_cert"] || !documents["relieving_letter"]) {
        toast.error("Experience certificate and Relieving letter are required.");
        return false;
      }
      return true;
    }

    return true;
  };

  const handleNext = async () => {
    if (!validateCurrentStep()) return;
    await handleSaveDraft(true);
    setCurrentStep((prev) => Math.min(prev + 1, totalSteps));
  };

  const handleBack = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  // Password Strength Calculation
  const passwordCriteria = React.useMemo(() => {
    return {
      length: password.length >= 10,
      uppercase: /[A-Z]/.test(password),
      number: /[0-9]/.test(password),
      symbol: /[^A-Za-z0-9]/.test(password),
    };
  }, [password]);

  const passwordScore = Object.values(passwordCriteria).filter(Boolean).length;
  const isPasswordValid = passwordScore === 4 && password === confirmPassword;

  // Final Onboarding Submit
  const handleFinalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPasswordValid) {
      toast.error("Please ensure your password meets all requirements and matches the confirmation.");
      return;
    }

    setSubmitting(true);
    try {
      // 1. Update user password in Supabase Auth
      const { error: pwdErr } = await supabase.auth.updateUser({
        password: password,
      });

      if (pwdErr) {
        throw new Error(`Password update failed: ${pwdErr.message}`);
      }

      // 2. Mark onboarding complete on server
      const res = await fetch("/api/onboarding/complete", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to finalize onboarding.");
      }

      toast.success("Welcome aboard! Onboarding completed successfully.");
      router.replace("/");
    } catch (err: any) {
      toast.error(err.message || "An error occurred while submitting.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-3 text-text-secondary">
          <div className="w-8 h-8 border-3 border-brand-purple border-t-transparent rounded-full animate-spin" />
          <span className="text-xs font-bold">Verifying secure onboarding link...</span>
        </div>
      </div>
    );
  }

  const progressPercentage = Math.round((currentStep / totalSteps) * 100);

  return (
    <div className="min-h-screen bg-background text-text-primary p-4 sm:p-6 lg:p-10 flex flex-col items-center justify-center">
      <div className="w-full max-w-3xl space-y-6">
        {/* Brand Header */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-brand-purple/10 border border-brand-purple/20 text-brand-purple text-xs font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Official Workplace Onboarding</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Welcome to Pulse
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary">
            Please complete your documentation and configure your account security to get started.
          </p>
        </div>

        {/* Progress Tracker */}
        <div className="bg-card border border-border-light rounded-2xl p-4 shadow-sm space-y-2">
          <div className="flex items-center justify-between text-xs font-bold">
            <span className="text-text-secondary">Step {currentStep} of {totalSteps}</span>
            <span className="text-brand-purple">{progressPercentage}% Complete</span>
          </div>
          <div className="w-full h-2 bg-card-subtle rounded-full overflow-hidden">
            <div
              className="h-full bg-brand-purple transition-all duration-300 rounded-full"
              style={{ width: `${progressPercentage}%` }}
            />
          </div>
        </div>

        {/* Multi-Step Card */}
        <div className="bg-card border border-border-light rounded-3xl p-6 sm:p-8 shadow-card">
          {/* STEP 1: Candidate Track */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Select Your Track</h2>
                <p className="text-xs text-text-secondary mt-1">
                  Choose the candidate profile that best represents your current professional standing.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  {
                    id: "STUDENT_INTERN" as CandidateType,
                    title: "Student / Intern",
                    desc: "Currently enrolled in university/college program.",
                    icon: <GraduationCap className="w-6 h-6" />,
                  },
                  {
                    id: "GRADUATE_FRESHER" as CandidateType,
                    title: "Graduate / Fresher",
                    desc: "Recent college graduate starting professional career.",
                    icon: <Building className="w-6 h-6" />,
                  },
                  {
                    id: "EXPERIENCED" as CandidateType,
                    title: "Experienced",
                    desc: "Professional with prior company/work experience.",
                    icon: <Briefcase className="w-6 h-6" />,
                  },
                ].map((track) => {
                  const isSelected = candidateType === track.id;
                  return (
                    <button
                      key={track.id}
                      type="button"
                      onClick={() => setCandidateType(track.id)}
                      className={cn(
                        "p-5 rounded-2xl border text-left flex flex-col justify-between transition-all cursor-pointer",
                        isSelected
                          ? "border-brand-purple bg-brand-purple/5 shadow-md ring-2 ring-brand-purple/20"
                          : "border-border-light bg-card-subtle hover:bg-card hover:border-brand-purple/40"
                      )}
                    >
                      <div className="text-brand-purple mb-3">{track.icon}</div>
                      <div>
                        <span className="block font-bold text-sm text-text-primary mb-1">
                          {track.title}
                        </span>
                        <span className="text-xs text-text-secondary leading-relaxed">
                          {track.desc}
                        </span>
                      </div>
                      <div className="mt-4 flex items-center justify-between">
                        <span className="text-[11px] font-bold text-brand-purple">
                          {isSelected ? "Selected" : "Select"}
                        </span>
                        {isSelected && <CheckCircle2 className="w-4 h-4 text-brand-purple" />}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* STEP 2: Personal Details & Identity */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Personal Details & Identity</h2>
                <p className="text-xs text-text-secondary mt-1">
                  Upload your photo and provide required government identification details.
                </p>
              </div>

              {/* Passport Photo Upload */}
              <div className="p-4 rounded-2xl bg-card-subtle border border-border-light flex flex-col sm:flex-row items-center gap-4">
                <div className="w-20 h-24 rounded-xl bg-card border border-dashed border-border-light flex items-center justify-center overflow-hidden shrink-0">
                  {documents["photo"]?.signedUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={documents["photo"].signedUrl}
                      alt="Passport Photo Preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <User className="w-8 h-8 text-text-tertiary" />
                  )}
                </div>
                <div className="flex-1 space-y-1 text-center sm:text-left">
                  <span className="text-xs font-bold text-text-primary block">
                    Passport-Size Photograph <span className="text-rose-500">*</span>
                  </span>
                  <span className="text-[11px] text-text-secondary block">
                    Formal front-facing photo on light background (JPG/PNG, Max 5MB).
                  </span>
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer transition-all mt-1">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingDoc === "photo" ? "Uploading..." : "Upload Photo"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("photo", file);
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Personal Fields Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Full Legal Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="As appears on official ID"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Contact Phone Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+91 9876543210"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Personal Email Address <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="email"
                    required
                    value={personalEmail}
                    onChange={(e) => setPersonalEmail(e.target.value)}
                    placeholder="personal@gmail.com"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Date of Birth <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    value={dob}
                    onChange={(e) => setDob(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Gender
                  </label>
                  <select
                    value={gender}
                    onChange={(e) => setGender(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  >
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Non-binary">Non-binary</option>
                    <option value="Prefer not to say">Prefer not to say</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Blood Group
                  </label>
                  <input
                    type="text"
                    value={bloodGroup}
                    onChange={(e) => setBloodGroup(e.target.value)}
                    placeholder="e.g. O+, B+, A-"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>
              </div>

              {/* Address */}
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Current Residential Address <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={currentAddress}
                    onChange={(e) => setCurrentAddress(e.target.value)}
                    placeholder="House/Flat number, Street, City, State, PIN"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Permanent Address <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={2}
                    required
                    value={permanentAddress}
                    onChange={(e) => setPermanentAddress(e.target.value)}
                    placeholder="Permanent family address"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple resize-none"
                  />
                </div>
              </div>

              {/* Identity Cards Upload */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
                {/* PAN Card */}
                <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary">
                      PAN Card <span className="text-rose-500">*</span>
                    </span>
                    {documents["pan_card"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  </div>
                  <input
                    type="text"
                    required
                    value={panNumber}
                    onChange={(e) => setPanNumber(e.target.value.toUpperCase())}
                    placeholder="ABCDE1234F"
                    maxLength={10}
                    className="w-full px-3 py-1.5 text-xs font-mono uppercase bg-card border border-border-light rounded-xl text-text-primary"
                  />
                  <label className="flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5 transition-all">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{documents["pan_card"] ? "Replace PAN PDF/Image" : "Upload PAN Document"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("pan_card", file);
                      }}
                    />
                  </label>
                </div>

                {/* Aadhaar Card */}
                <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary">
                      Aadhaar Card <span className="text-[10px] text-text-tertiary">(Optional)</span>
                    </span>
                    {documents["aadhaar_card"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  </div>
                  <input
                    type="text"
                    value={aadhaarNumber}
                    onChange={(e) => setAadhaarNumber(e.target.value)}
                    placeholder="Where required and appropriate"
                    maxLength={14}
                    className="w-full px-3 py-1.5 text-xs font-mono bg-card border border-border-light rounded-xl text-text-primary"
                  />
                  <label className="flex items-center justify-center gap-1.5 py-1.5 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5 transition-all">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{documents["aadhaar_card"] ? "Replace Aadhaar" : "Upload Aadhaar (Optional)"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("aadhaar_card", file);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Bank Details */}
          {currentStep === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Bank Details for Payroll</h2>
                <p className="text-xs text-text-secondary mt-1">
                  Provide your salary disbursement account information and document proof.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Account Holder Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={bankAccountHolder}
                    onChange={(e) => setBankAccountHolder(e.target.value)}
                    placeholder="Name as per bank records"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Bank Account Number <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={bankAccountNumber}
                    onChange={(e) => setBankAccountNumber(e.target.value)}
                    placeholder="Account number"
                    className="w-full px-3 py-2 text-xs font-mono bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    IFSC Code <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={bankIfsc}
                    onChange={(e) => setBankIfsc(e.target.value.toUpperCase())}
                    placeholder="e.g. HDFC0001234"
                    maxLength={11}
                    className="w-full px-3 py-2 text-xs font-mono uppercase bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Bank & Branch Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={bankName}
                    onChange={(e) => setBankName(e.target.value)}
                    placeholder="e.g. HDFC Bank, Koramangala"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Universal Account Number (UAN) <span className="text-[10px] text-text-tertiary">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={uanNumber}
                    onChange={(e) => setUanNumber(e.target.value)}
                    placeholder="12-digit EPF UAN if applicable"
                    className="w-full px-3 py-2 text-xs font-mono bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>
              </div>

              {/* Passbook / Cancelled Cheque upload */}
              <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold text-text-primary block">
                      Cancelled Cheque / Passbook Front Page <span className="text-rose-500">*</span>
                    </span>
                    <span className="text-[11px] text-text-secondary">
                      Clear scan or photo showing account holder name, number, and IFSC code.
                    </span>
                  </div>
                  {documents["bank_proof"] && <CheckCircle2 className="w-5 h-5 text-emerald-500" />}
                </div>

                <label className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl border border-dashed border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5 transition-all">
                  <Upload className="w-4 h-4" />
                  <span>
                    {documents["bank_proof"]
                      ? `Uploaded: ${documents["bank_proof"].file_name} (Click to Replace)`
                      : "Upload Passbook / Cancelled Cheque (JPG, PNG, PDF)"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload("bank_proof", file);
                    }}
                  />
                </label>
              </div>
            </div>
          )}

          {/* STEP 4: Education Credentials */}
          {currentStep === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Academic Records</h2>
                <p className="text-xs text-text-secondary mt-1">
                  Upload verification documents adapted to your candidate profile.
                </p>
              </div>

              {/* Standard Mandatory Records */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary">
                      10th Mark Sheet / Certificate <span className="text-rose-500">*</span>
                    </span>
                    {documents["cert_10th"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  </div>
                  <label className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{documents["cert_10th"] ? "Replace 10th Certificate" : "Upload 10th Certificate"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("cert_10th", file);
                      }}
                    />
                  </label>
                </div>

                <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary">
                      12th / Intermediate Certificate <span className="text-rose-500">*</span>
                    </span>
                    {documents["cert_12th"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  </div>
                  <label className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{documents["cert_12th"] ? "Replace 12th Certificate" : "Upload 12th Certificate"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("cert_12th", file);
                      }}
                    />
                  </label>
                </div>
              </div>

              {/* Student / Intern Specific Track */}
              {candidateType === "STUDENT_INTERN" && (
                <div className="p-4 rounded-2xl bg-brand-purple/5 border border-brand-purple/20 space-y-3">
                  <span className="text-xs font-bold text-brand-purple block">
                    Student / Intern Verification Documents
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="p-3 bg-card rounded-xl border border-border-light space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text-primary">
                          College ID Card <span className="text-rose-500">*</span>
                        </span>
                        {documents["college_id"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      </div>
                      <label className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border-light text-xs font-bold text-brand-purple cursor-pointer hover:bg-card-subtle">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{documents["college_id"] ? "Replace College ID" : "Upload College ID"}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload("college_id", file);
                          }}
                        />
                      </label>
                    </div>

                    <div className="p-3 bg-card rounded-xl border border-border-light space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-text-primary">
                          Bonafide / College Letter <span className="text-rose-500">*</span>
                        </span>
                        {documents["bonafide_letter"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                      </div>
                      <label className="flex items-center justify-center gap-1.5 py-1.5 rounded-lg border border-border-light text-xs font-bold text-brand-purple cursor-pointer hover:bg-card-subtle">
                        <Upload className="w-3.5 h-3.5" />
                        <span>{documents["bonafide_letter"] ? "Replace Letter" : "Upload Bonafide Letter"}</span>
                        <input
                          type="file"
                          accept="image/jpeg,image/png,application/pdf"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload("bonafide_letter", file);
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {/* Degrees / Diplomas / Certifications (Optional for Graduate / Experienced) */}
              {candidateType !== "STUDENT_INTERN" && (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-primary">
                        Undergraduate / Degree Certificate <span className="text-[10px] text-text-tertiary">(Optional)</span>
                      </span>
                      {documents["cert_ug"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    </div>
                    <label className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{documents["cert_ug"] ? "Replace Degree" : "Upload Degree / Provisional"}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload("cert_ug", file);
                        }}
                      />
                    </label>
                  </div>

                  <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-text-primary">
                        Postgraduate / Certifications <span className="text-[10px] text-text-tertiary">(Optional)</span>
                      </span>
                      {documents["cert_pg"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                    </div>
                    <label className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5">
                      <Upload className="w-3.5 h-3.5" />
                      <span>{documents["cert_pg"] ? "Replace Certificate" : "Upload Additional Certs"}</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,application/pdf"
                        className="hidden"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileUpload("cert_pg", file);
                        }}
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 5: Prior Work Experience (Only for EXPERIENCED) */}
          {currentStep === 5 && candidateType === "EXPERIENCED" && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Prior Employment History</h2>
                <p className="text-xs text-text-secondary mt-1">
                  Upload experience verification and details from your most recent employer.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Previous Organization Name <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={prevCompany}
                    onChange={(e) => setPrevCompany(e.target.value)}
                    placeholder="e.g. Acme Technologies Pvt Ltd"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Designation / Role Held <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={prevDesignation}
                    onChange={(e) => setPrevDesignation(e.target.value)}
                    placeholder="e.g. Senior Software Engineer"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Employment Start Date
                  </label>
                  <input
                    type="date"
                    value={prevStartDate}
                    onChange={(e) => setPrevStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Relieving / End Date
                  </label>
                  <input
                    type="date"
                    value={prevEndDate}
                    onChange={(e) => setPrevEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Previous HR Contact Email
                  </label>
                  <input
                    type="email"
                    value={prevHrEmail}
                    onChange={(e) => setPrevHrEmail(e.target.value)}
                    placeholder="hr@previouscompany.com"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Previous Employee ID <span className="text-[10px] text-text-tertiary">(Optional)</span>
                  </label>
                  <input
                    type="text"
                    value={prevEmployeeId}
                    onChange={(e) => setPrevEmployeeId(e.target.value)}
                    placeholder="EMP-1234"
                    className="w-full px-3 py-2 text-xs font-mono bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>
              </div>

              {/* Experience Documents Upload Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2">
                <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary">
                      Experience Cert <span className="text-rose-500">*</span>
                    </span>
                    {documents["experience_cert"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  </div>
                  <label className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Certificate</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("experience_cert", file);
                      }}
                    />
                  </label>
                </div>

                <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary">
                      Relieving Letter <span className="text-rose-500">*</span>
                    </span>
                    {documents["relieving_letter"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  </div>
                  <label className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Letter</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("relieving_letter", file);
                      }}
                    />
                  </label>
                </div>

                <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-text-primary">
                      Last 3 Salary Slips <span className="text-rose-500">*</span>
                    </span>
                    {documents["salary_slips"] && <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
                  </div>
                  <label className="flex items-center justify-center gap-1.5 py-2 rounded-xl border border-border-light bg-card text-xs font-bold text-brand-purple cursor-pointer hover:bg-brand-purple/5">
                    <Upload className="w-3.5 h-3.5" />
                    <span>Upload Payslips</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,application/pdf"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleFileUpload("salary_slips", file);
                      }}
                    />
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* FINAL STEP: Set Permanent Workplace Password */}
          {((candidateType === "EXPERIENCED" && currentStep === 6) ||
            (candidateType !== "EXPERIENCED" && currentStep === 5)) && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-bold text-text-primary">Account Security & Password</h2>
                <p className="text-xs text-text-secondary mt-1">
                  Configure your permanent workplace password. This will replace the temporary invitation link.
                </p>
              </div>

              <div className="space-y-4 max-w-md mx-auto pt-2">
                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    New Workplace Password <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? "text" : "password"}
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 10 characters"
                      className="w-full px-3 py-2 pr-10 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
                    >
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Password Strength Meter */}
                <div className="space-y-2 bg-card-subtle p-3 rounded-xl border border-border-light text-xs">
                  <div className="flex items-center justify-between text-[11px] font-bold">
                    <span>Password Strength</span>
                    <span
                      className={cn(
                        passwordScore === 4
                          ? "text-emerald-500"
                          : passwordScore >= 2
                          ? "text-amber-500"
                          : "text-rose-500"
                      )}
                    >
                      {passwordScore === 4
                        ? "Strong"
                        : passwordScore >= 2
                        ? "Moderate"
                        : "Weak"}
                    </span>
                  </div>
                  <div className="grid grid-cols-4 gap-1.5 h-1.5">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className={cn(
                          "h-full rounded-full transition-colors",
                          level <= passwordScore
                            ? passwordScore === 4
                              ? "bg-emerald-500"
                              : passwordScore >= 2
                              ? "bg-amber-500"
                              : "bg-rose-500"
                            : "bg-border-light"
                        )}
                      />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-[11px] text-text-tertiary pt-1">
                    <span className={cn("flex items-center gap-1", passwordCriteria.length && "text-emerald-500")}>
                      {passwordCriteria.length ? <Check className="w-3 h-3" /> : "•"} At least 10 chars
                    </span>
                    <span className={cn("flex items-center gap-1", passwordCriteria.uppercase && "text-emerald-500")}>
                      {passwordCriteria.uppercase ? <Check className="w-3 h-3" /> : "•"} Uppercase letter
                    </span>
                    <span className={cn("flex items-center gap-1", passwordCriteria.number && "text-emerald-500")}>
                      {passwordCriteria.number ? <Check className="w-3 h-3" /> : "•"} Numeric digit
                    </span>
                    <span className={cn("flex items-center gap-1", passwordCriteria.symbol && "text-emerald-500")}>
                      {passwordCriteria.symbol ? <Check className="w-3 h-3" /> : "•"} Special symbol
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-text-secondary mb-1">
                    Confirm Password <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    className="w-full px-3 py-2 text-xs bg-card-subtle border border-border-light rounded-xl text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                  {confirmPassword && password !== confirmPassword && (
                    <span className="text-[11px] text-rose-500 mt-1 block">Passwords do not match.</span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Navigation & Actions Toolbar */}
          <div className="flex items-center justify-between pt-8 border-t border-border-light/60 mt-8">
            <div>
              {currentStep > 1 && (
                <button
                  type="button"
                  onClick={handleBack}
                  className="px-4 py-2 rounded-xl border border-border-light text-xs font-bold text-text-secondary hover:text-text-primary hover:bg-card-subtle transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  <span>Back</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => handleSaveDraft(false)}
                disabled={savingDraft}
                className="px-4 py-2 rounded-xl bg-card-subtle hover:bg-card border border-border-light text-xs font-bold text-text-secondary hover:text-text-primary transition-all flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{savingDraft ? "Saving..." : "Save Draft"}</span>
              </button>

              {currentStep < totalSteps ? (
                <button
                  type="button"
                  onClick={handleNext}
                  className="px-5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                >
                  <span>Continue</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleFinalSubmit}
                  disabled={!isPasswordValid || submitting}
                  className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <FileCheck className="w-4 h-4" />
                  <span>{submitting ? "Finalizing Account..." : "Complete & Enter Workplace"}</span>
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
