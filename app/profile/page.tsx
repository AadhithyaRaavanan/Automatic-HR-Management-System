"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { createClient } from "@/lib/supabase/client";
import { compressAvatarImage } from "@/lib/media/avatar-compress";
import {
  UserCircle,
  Camera,
  Phone,
  ShieldAlert,
  Globe,
  Clock,
  Lock,
  Save,
  CheckCircle2,
  Building2,
  Briefcase,
  Compass,
  GraduationCap,
  CreditCard,
  FileCheck,
  FileText,
  ExternalLink,
  ShieldCheck,
  AlertCircle,
  BadgeCheck,
  MapPin,
} from "lucide-react";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { cn } from "@/lib/utils";

const DOC_TYPE_LABELS: Record<string, string> = {
  photo: "Passport-Size Photo (PDF)",
  resume: "Candidate Resume / CV (PDF)",
  pan_card: "PAN Card PDF",
  cert_10th: "10th Standard Certificate",
  cert_12th: "12th Standard Certificate",
  cert_undergraduate: "Degree Certificate",
  cert_postgraduate: "Postgraduate Certificate",
  bank_proof: "Bank Proof (Passbook / Cheque)",
  aadhaar_card: "Aadhaar Card PDF",
  salary_slip: "Salary Slip",
  experience_cert: "Experience Certificate",
  relieving_letter: "Relieving Letter",
};

function ProfilePageContent() {
  const router = useRouter();
  const { userId, userRole, isLoaded } = useAppSession();
  const supabase = React.useMemo(() => createClient(), []);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);
  const loadedUserIdRef = React.useRef<string | null>(null);

  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [uploadingAvatar, setUploadingAvatar] = React.useState(false);

  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [emergencyContact, setEmergencyContact] = React.useState("");
  const [avatarPath, setAvatarPath] = React.useState<string | null>(null);
  const [avatarSignedUrl, setAvatarSignedUrl] = React.useState<string | null>(null);

  // Governed read-only fields
  const [timezone, setTimezone] = React.useState("UTC");
  const [workMode, setWorkMode] = React.useState("remote");
  const [workTargetMinutes, setWorkTargetMinutes] = React.useState(480);
  const [departmentName, setDepartmentName] = React.useState<string | null>(null);
  const [jobTitleName, setJobTitleName] = React.useState<string | null>(null);
  const [employeeIdFormatted, setEmployeeIdFormatted] = React.useState<string | null>(null);
  const [tourOpen, setTourOpen] = React.useState(false);

  // Onboarding & Verified Details State
  const [onboardingStatus, setOnboardingStatus] = React.useState<string>("NOT_STARTED");
  const [onboardingData, setOnboardingData] = React.useState<{
    dob?: string;
    gender?: string;
    bloodGroup?: string;
    currentAddress?: string;
    permanentAddress?: string;
    emergencyName?: string;
    emergencyRel?: string;
    emergencyPhone?: string;
    highestQualification?: string;
    hasExperience?: boolean;
    previousCompany?: string;
    previousDesignation?: string;
    panNumber?: string;
    bankAccountHolder?: string;
    maskedAccountNumber?: string;
    bankIfsc?: string;
    bankName?: string;
    bankBranch?: string;
    uanNumber?: string;
    submittedAt?: string;
  } | null>(null);

  const [verifiedDocuments, setVerifiedDocuments] = React.useState<
    Array<{
      id: string;
      doc_type: string;
      document_name: string;
      file_name: string;
      document_status: string;
      signedUrl?: string;
    }>
  >([]);

  const handleReplayTutorial = async () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("pulse_tutorial_active", "true");
      sessionStorage.setItem("pulse_tutorial_step_index", "0");
      sessionStorage.removeItem("pulse_tutorial_completed");
      localStorage.removeItem("pulse_tutorial_completed");
    }

    try {
      let headers: Record<string, string> = { "Content-Type": "application/json" };
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        headers["Authorization"] = `Bearer ${session.access_token}`;
      }
      await fetch("/api/tutorial/complete", {
        method: "POST",
        headers,
        body: JSON.stringify({ reset: true }),
      });
    } catch {}

    toast.info("Starting Workplace Walkthrough...");
    router.push("/");
  };

  const resolveAvatarSignedUrl = React.useCallback(
    async (storagePath: string | null) => {
      if (!storagePath) {
        setAvatarSignedUrl(null);
        return;
      }
      if (storagePath.startsWith("http://") || storagePath.startsWith("https://")) {
        setAvatarSignedUrl(storagePath);
        return;
      }
      const { data } = await supabase.storage.from("avatars").createSignedUrl(storagePath, 3600);
      if (data?.signedUrl) {
        setAvatarSignedUrl(data.signedUrl);
      }
    },
    [supabase]
  );

  React.useEffect(() => {
    if (!isLoaded) return;
    let active = true;

    async function loadProfile() {
      try {
        let uid = userId;
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!uid) {
          uid = session?.user?.id || (await supabase.auth.getUser()).data.user?.id || null;
        }
        if (!uid) {
          if (active) setLoading(false);
          return;
        }

        // 1. Fetch from authoritative Onboarding Profile API (with Bearer auth to bypass client RLS)
        const headers: Record<string, string> = { "Cache-Control": "no-cache" };
        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }

        try {
          const onbRes = await fetch(`/api/onboarding/profile?t=${Date.now()}`, {
            headers,
            cache: "no-store",
          });
          if (onbRes.ok) {
            const onbJson = await onbRes.json();
            const p = onbJson.onboardingProfile;
            const u = onbJson.user;
            const prof = onbJson.profile;
            const edu = p?.education_details || {};

            if (u) {
              setFullName(u.fullName || p?.full_name || "");
              setEmail(u.email || p?.personal_email || "");
              if (u.department) setDepartmentName(u.department);
              if (u.designation) setJobTitleName(u.designation);
              if (u.employeeId) setEmployeeIdFormatted(u.employeeId);
              if (u.phone) setPhone(u.phone);
              if (u.emergency_contact) setEmergencyContact(u.emergency_contact);
            }

            // Compute Onboarding Status
            let computedStatus = "NOT_STARTED";
            if (p?.status) {
              computedStatus = p.status.toUpperCase();
            } else if (prof?.onboarding_completed) {
              computedStatus = "SUBMITTED";
            }
            setOnboardingStatus(computedStatus);

            if (p) {
              const accNum = p.bank_account_number || edu.accountNumber || "";
              const maskedAcc = accNum.length > 4 ? `•••• •••• ${accNum.slice(-4)}` : accNum;

              const resEmergencyName = p.emergency_contact_name || edu.emergency_contact_name || edu.emergencyName || "";
              const resEmergencyRel = p.emergency_contact_relationship || edu.emergency_contact_relationship || edu.emergencyRelationship || "";
              const resEmergencyPhone = p.emergency_contact_phone || edu.emergency_contact_phone || edu.emergencyPhone || "";

              if (resEmergencyName || resEmergencyPhone) {
                setEmergencyContact((prev) =>
                  prev || (resEmergencyRel
                    ? `${resEmergencyName} (${resEmergencyRel}) • ${resEmergencyPhone}`
                    : `${resEmergencyName} • ${resEmergencyPhone}`)
                );
              }

              if (p.phone) {
                setPhone((prev) => prev || p.phone);
              }

              setOnboardingData({
                dob: p.dob,
                gender: p.gender,
                bloodGroup: p.blood_group,
                currentAddress: p.current_address,
                permanentAddress: p.permanent_address,
                emergencyName: resEmergencyName,
                emergencyRel: resEmergencyRel,
                emergencyPhone: resEmergencyPhone,
                highestQualification:
                  p.highest_qualification || edu.highest_qualification || edu.qualification || "12th Standard",
                hasExperience: Boolean(p.has_experience),
                previousCompany: p.previous_company_name,
                previousDesignation: p.previous_designation,
                panNumber: p.pan_number,
                bankAccountHolder: p.bank_account_holder || edu.accountHolder || u?.fullName || "",
                maskedAccountNumber: maskedAcc,
                bankIfsc: p.bank_ifsc || edu.ifscCode || "",
                bankName: p.bank_name || edu.bankName || "",
                bankBranch: p.bank_branch || edu.bank_branch || edu.bankBranch || "",
                uanNumber: p.uan_number,
                submittedAt: p.submitted_at,
              });
            }

            if (Array.isArray(onbJson.documents) && onbJson.documents.length > 0) {
              setVerifiedDocuments(onbJson.documents);
            }
          }
        } catch (apiErr) {
          console.warn("[Profile API Load Note]:", apiErr);
        }

        // 2. Fetch Employee Record via Supabase client for additional client state
        const { data, error } = await (supabase as any)
          .from("employees")
          .select(
            "id, full_name, email, phone, emergency_contact, avatar_url, timezone, work_mode, work_target_minutes, departments:department_id(name), job_titles:job_title_id(title_name)"
          )
          .eq("id", uid)
          .maybeSingle();

        if (!active) return;
        if (!error && data) {
          loadedUserIdRef.current = uid;
          if (data.full_name) setFullName(data.full_name);
          if (data.email) setEmail(data.email);
          if (data.phone) setPhone(data.phone);
          if (data.emergency_contact) setEmergencyContact(data.emergency_contact);
          if (data.avatar_url) setAvatarPath(data.avatar_url);
          if (data.timezone) setTimezone(data.timezone);
          if (data.work_mode) setWorkMode(data.work_mode);
          if (data.work_target_minutes) setWorkTargetMinutes(data.work_target_minutes);
          if (data.departments?.name) setDepartmentName(data.departments.name);
          if (data.job_titles?.title_name) setJobTitleName(data.job_titles.title_name);
          setEmployeeIdFormatted(`EMP-${data.id.slice(0, 6).toUpperCase()}`);
          if (data.avatar_url) {
            await resolveAvatarSignedUrl(data.avatar_url);
          }
        }
      } catch (err) {
        console.warn("[Profile Load Error]:", err);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadProfile();
    return () => {
      active = false;
    };
  }, [isLoaded, userId, supabase, resolveAvatarSignedUrl]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      toast.error("Full name is required.");
      return;
    }

    if (isDemoModeEnabled()) {
      toast.success("Profile updated successfully. (demo session)");
      return;
    }

    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token;
    const uid =
      userId ||
      sessionData?.session?.user?.id ||
      (await supabase.auth.getUser()).data.user?.id;

    if (!uid) {
      toast.error("Sign in required to update your profile.");
      return;
    }

    setSaving(true);
    try {
      // 1. Try server PATCH endpoint first (authenticated via Bearer token to cleanly update both tables)
      const res = await fetch("/api/onboarding/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim() || null,
          emergencyContact: emergencyContact.trim() || null,
        }),
      });

      if (!res.ok) {
        const { error } = await (supabase.from("employees") as any)
          .update({
            full_name: fullName.trim(),
            phone: phone.trim() || null,
            emergency_contact: emergencyContact.trim() || null,
          })
          .eq("id", uid);
        if (error) throw error;
      }

      toast.success("Profile updated successfully.");
    } catch (err: any) {
      toast.error(err?.message || "Failed to update profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (isDemoModeEnabled()) {
      const preview = URL.createObjectURL(file);
      setAvatarSignedUrl(preview);
      toast.success("Avatar updated successfully! (demo session)");
      return;
    }

    const uid =
      userId ||
      (await supabase.auth.getSession()).data.session?.user?.id ||
      (await supabase.auth.getUser()).data.user?.id;

    if (!uid) {
      toast.error("Sign in required to upload an avatar.");
      return;
    }

    setUploadingAvatar(true);
    try {
      const { blob, mimeType } = await compressAvatarImage(file);
      const ext = mimeType === "image/webp" ? "webp" : mimeType === "image/png" ? "png" : "jpg";
      const storagePath = `${uid}/avatar.${ext}`;

      const { error: uploadErr } = await supabase.storage.from("avatars").upload(storagePath, blob, {
        contentType: mimeType,
        upsert: true,
      });
      if (uploadErr) throw uploadErr;

      const { error: dbErr } = await (supabase.from("employees") as any)
        .update({ avatar_url: storagePath })
        .eq("id", uid);
      if (dbErr) throw dbErr;

      setAvatarPath(storagePath);
      await resolveAvatarSignedUrl(storagePath);
      toast.success(
        `Avatar compressed (${Math.max(1, Math.round(blob.size / 1024))} KB) and saved securely.`
      );
    } catch (err: any) {
      toast.error(err?.message || "Failed to upload avatar.");
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const initials = (fullName || email || "U")
    .split(/\s+/)
    .map((p) => p[0] || "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

  const isVerified = ["COMPLETED", "VERIFIED", "APPROVED"].includes(onboardingStatus);
  const isSubmitted = ["SUBMITTED", "PENDING_VERIFICATION", "IN_REVIEW"].includes(onboardingStatus);

  return (
    <div className="space-y-6">
      {/* Top Profile Header */}
      <section className="pt-1 pb-2 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
              My Profile
            </h1>
            <span
              className={cn(
                "px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider border flex items-center gap-1.5 shadow-sm",
                isVerified
                  ? "bg-status-success/15 text-status-success border-status-success/30"
                  : isSubmitted
                  ? "bg-brand-purple/15 text-brand-purple border-brand-purple/30"
                  : onboardingStatus === "CORRECTION_REQUIRED"
                  ? "bg-status-danger/15 text-status-danger border-status-danger/30"
                  : "bg-brand-navy/10 text-brand-navy border-brand-navy/20"
              )}
            >
              {isVerified ? (
                <>
                  <BadgeCheck className="w-4 h-4 text-status-success" />
                  <span>Verified Onboarding</span>
                </>
              ) : isSubmitted ? (
                <>
                  <Clock className="w-3.5 h-3.5 text-brand-purple" />
                  <span>Onboarding: Submitted & In Review</span>
                </>
              ) : (
                <>
                  <Clock className="w-3.5 h-3.5" />
                  <span>Onboarding: {onboardingStatus.replace(/_/g, " ")}</span>
                </>
              )}
            </span>
          </div>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            Official employee record, verified onboarding credentials, and payroll details.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {!isVerified && (
            <Link
              href="/onboarding"
              className="px-3.5 py-1.5 rounded-lg bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <span>{isSubmitted ? "Review submission" : "Onboarding"}</span>
            </Link>
          )}
          <Link
            href="/settings"
            className="px-3.5 py-1.5 rounded-lg bg-card border border-border-light text-xs font-medium text-text-primary hover:bg-card-subtle transition-colors"
          >
            Settings
          </Link>
        </div>
      </section>

      <BentoGrid>
        {/* Avatar & Identity Card */}
        <div data-tour="profile-card" className="lg:col-span-4">
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <UserCircle className="w-4 h-4 text-text-secondary" />
              <span>Identity and profile</span>
            </div>
          }
          subtitle="Account profile"
          className="w-full p-6 flex flex-col justify-between space-y-5"
        >
          <div className="flex flex-col items-center text-center space-y-4 py-2">
            <div className="relative">
              {avatarSignedUrl ? (
                <img
                  src={avatarSignedUrl}
                  alt={fullName || "User avatar"}
                  className="w-24 h-24 rounded-full object-cover border border-border-light"
                />
              ) : (
                <div className="w-24 h-24 rounded-full bg-card-subtle text-text-primary font-semibold text-xl flex items-center justify-center border border-border-light">
                  {initials}
                </div>
              )}

              <button
                type="button"
                disabled={uploadingAvatar || loading}
                onClick={() => fileInputRef.current?.click()}
                aria-label="Upload avatar photo"
                className="absolute bottom-0 right-0 w-8 h-8 rounded-full bg-brand-navy hover:bg-brand-navy-hover text-white flex items-center justify-center cursor-pointer transition-colors disabled:opacity-50"
              >
                <Camera className="w-4 h-4" />
              </button>
            </div>

            <input
              ref={fileInputRef}
              id="profile-avatar-input"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatarSelected}
              className="hidden"
            />

            <div>
              <h2 className="text-base font-extrabold text-text-primary">
                {fullName || "Employee"}
              </h2>
              <p className="text-xs text-text-tertiary font-mono mt-0.5">{email}</p>
              {employeeIdFormatted && (
                <p className="text-[11px] font-bold text-brand-purple font-mono mt-0.5">
                  {employeeIdFormatted}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-center gap-2 mt-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase bg-brand-purple-light text-brand-purple">
                  {userRole}
                </span>
                {jobTitleName && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-brand-navy/10 text-brand-navy border border-brand-navy/20 flex items-center gap-1">
                    <Briefcase className="w-3 h-3 text-brand-purple" />
                    {jobTitleName}
                  </span>
                )}
                {departmentName && (
                  <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-card-subtle border border-border-light text-text-secondary flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-brand-purple" />
                    {departmentName}
                  </span>
                )}
              </div>
            </div>

            <button
              type="button"
              disabled={uploadingAvatar || loading}
              onClick={() => fileInputRef.current?.click()}
              className="w-full py-2.5 px-4 rounded-xl bg-card-subtle hover:bg-card border border-border-light text-xs font-bold text-text-primary cursor-pointer transition-colors disabled:opacity-50"
            >
              {uploadingAvatar ? "Compressing & Uploading..." : "Change Profile Photo"}
            </button>

            {userRole !== "admin" && (
              <button
                type="button"
                onClick={handleReplayTutorial}
                className="w-full py-2.5 px-4 rounded-xl bg-card border border-brand-purple/30 hover:bg-brand-purple/5 text-xs font-bold text-brand-purple cursor-pointer transition-colors flex items-center justify-center gap-1.5"
              >
                <Compass className="w-3.5 h-3.5" />
                <span>Replay Workplace Tutorial</span>
              </button>
            )}

            {avatarPath && (
              <p className="text-[11px] text-status-success-text flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Stored privately in encrypted avatars bucket
              </p>
            )}
          </div>
        </BentoCard>
        </div>

        {/* Editable Personal Info Form */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-brand-purple" />
              <span>Contact & Personal Details</span>
            </div>
          }
          subtitle="Directory updates apply immediately"
          className="lg:col-span-8 p-6"
        >
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label
                  htmlFor="profile-full-name"
                  className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
                >
                  Full Name
                </label>
                <input
                  id="profile-full-name"
                  type="text"
                  required
                  disabled={loading}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Your full name"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>

              <div>
                <label
                  htmlFor="profile-phone"
                  className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
                >
                  Phone Number
                </label>
                <input
                  id="profile-phone"
                  type="tel"
                  autoComplete="tel"
                  disabled={loading}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="profile-emergency-contact"
                className="block text-xs font-bold text-text-primary uppercase tracking-wider mb-1.5"
              >
                Emergency Contact (Name, Relationship & Phone)
              </label>
              <div className="relative">
                <ShieldAlert className="w-4 h-4 text-text-tertiary absolute left-3 top-3" />
                <input
                  id="profile-emergency-contact"
                  type="text"
                  disabled={loading}
                  value={
                    emergencyContact ||
                    (onboardingData?.emergencyName
                      ? `${onboardingData.emergencyName} (${onboardingData.emergencyRel}) • ${onboardingData.emergencyPhone}`
                      : "")
                  }
                  onChange={(e) => setEmergencyContact(e.target.value)}
                  placeholder="e.g. Dana Sullivan (Spouse) • +91 98765 00000"
                  className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-xs font-semibold text-text-primary focus:outline-none focus:border-brand-purple"
                />
              </div>
            </div>

            {/* Address Information from Onboarding */}
            {onboardingData?.currentAddress && (
              <div className="p-3.5 rounded-xl bg-card-subtle border border-border-light text-xs space-y-1">
                <div className="flex items-center gap-1.5 font-bold text-text-primary">
                  <MapPin className="w-3.5 h-3.5 text-brand-purple" />
                  <span>Residential Address</span>
                </div>
                <p className="text-text-secondary pl-5">{onboardingData.currentAddress}</p>
              </div>
            )}

            {/* Read-only HR/Admin Governed Section */}
            <div className="pt-4 mt-4 border-t border-border-light space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-extrabold text-text-primary uppercase tracking-wider flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-brand-purple" />
                  Work Schedule Governance
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-card-subtle border border-border-light text-text-tertiary">
                  HR / Admin Only
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label
                    htmlFor="profile-timezone-readonly"
                    className="block text-[11px] font-bold text-text-secondary mb-1 flex items-center gap-1"
                  >
                    <Globe className="w-3 h-3" />
                    Timezone
                  </label>
                  <input
                    id="profile-timezone-readonly"
                    type="text"
                    readOnly
                    disabled
                    value={timezone}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle/60 border border-border-light text-xs font-bold text-text-secondary cursor-not-allowed"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-work-mode-readonly"
                    className="block text-[11px] font-bold text-text-secondary mb-1"
                  >
                    Work Mode
                  </label>
                  <input
                    id="profile-work-mode-readonly"
                    type="text"
                    readOnly
                    disabled
                    value={workMode.toUpperCase()}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle/60 border border-border-light text-xs font-bold text-text-secondary cursor-not-allowed"
                  />
                </div>

                <div>
                  <label
                    htmlFor="profile-target-readonly"
                    className="block text-[11px] font-bold text-text-secondary mb-1 flex items-center gap-1"
                  >
                    <Clock className="w-3 h-3" />
                    Daily Target
                  </label>
                  <input
                    id="profile-target-readonly"
                    type="text"
                    readOnly
                    disabled
                    value={`${workTargetMinutes} mins (${Math.round(workTargetMinutes / 60)}h)`}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle/60 border border-border-light text-xs font-bold text-text-secondary cursor-not-allowed"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="submit"
                disabled={saving || loading}
                className="px-5 py-2.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-md flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{saving ? "Saving..." : "Save Profile"}</span>
              </button>
            </div>
          </form>
        </BentoCard>

        {/* Bank & Payroll Details Card */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-brand-purple" />
              <span>Bank & Payroll Details</span>
            </div>
          }
          subtitle="Masked for security (authorized HR/Payroll managed)"
          className="lg:col-span-6 p-6"
        >
          <div className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="p-3 rounded-xl bg-card-subtle border border-border-light">
                <span className="text-[10px] font-bold uppercase text-text-tertiary block">Account Holder</span>
                <span className="font-extrabold text-text-primary text-sm">
                  {onboardingData?.bankAccountHolder || fullName || "—"}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-card-subtle border border-border-light">
                <span className="text-[10px] font-bold uppercase text-text-tertiary block">Account Number</span>
                <span className="font-mono font-bold text-text-primary text-sm">
                  {onboardingData?.maskedAccountNumber || "•••• •••• ••••"}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-card-subtle border border-border-light">
                <span className="text-[10px] font-bold uppercase text-text-tertiary block">Bank & Branch</span>
                <span className="font-bold text-text-primary">
                  {onboardingData?.bankName ? `${onboardingData.bankName} (${onboardingData.bankBranch || "Main"})` : "—"}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-card-subtle border border-border-light">
                <span className="text-[10px] font-bold uppercase text-text-tertiary block">IFSC Code</span>
                <span className="font-mono font-bold text-brand-purple">
                  {onboardingData?.bankIfsc || "—"}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-card-subtle border border-border-light">
                <span className="text-[10px] font-bold uppercase text-text-tertiary block">PAN Number</span>
                <span className="font-mono font-bold text-text-primary">
                  {onboardingData?.panNumber || "—"}
                </span>
              </div>

              <div className="p-3 rounded-xl bg-card-subtle border border-border-light">
                <span className="text-[10px] font-bold uppercase text-text-tertiary block">UAN Number</span>
                <span className="font-mono font-bold text-text-primary">
                  {onboardingData?.uanNumber || "Not registered"}
                </span>
              </div>
            </div>
          </div>
        </BentoCard>

        {/* Education & Qualifications Card */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <GraduationCap className="w-4 h-4 text-brand-purple" />
              <span>Education & Prior Experience</span>
            </div>
          }
          subtitle="Verified by HR Admin during onboarding"
          className="lg:col-span-6 p-6"
        >
          <div className="space-y-3 text-xs">
            <div className="p-3.5 rounded-xl bg-card-subtle border border-border-light space-y-1">
              <span className="text-[10px] font-bold uppercase text-text-tertiary block">Highest Qualification</span>
              <p className="font-extrabold text-sm text-text-primary">
                {onboardingData?.highestQualification || "12th Standard"}
              </p>
            </div>

            <div className="p-3.5 rounded-xl bg-card-subtle border border-border-light space-y-1">
              <span className="text-[10px] font-bold uppercase text-text-tertiary block">Prior Corporate Experience</span>
              <p className="font-bold text-text-primary">
                {onboardingData?.hasExperience
                  ? `Experienced • ${onboardingData.previousCompany || "Previous Employer"} (${onboardingData.previousDesignation || "Role"})`
                  : "Fresher / Direct Graduate Entry"}
              </p>
            </div>
          </div>
        </BentoCard>

        {/* Verified Onboarding Documents Card */}
        <BentoCard
          title={
            <div className="flex items-center gap-2">
              <FileCheck className="w-4 h-4 text-brand-purple" />
              <span>Verified Onboarding Documents</span>
            </div>
          }
          subtitle="Encrypted Google Drive / Supabase storage archive"
          className="lg:col-span-12 p-6"
        >
          {verifiedDocuments.length === 0 ? (
            <p className="text-xs text-text-tertiary italic p-3">
              No documents linked to this profile. Complete onboarding to attach verified records.
            </p>
          ) : (
            <div className="space-y-4">
              <div className="px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="text-text-secondary flex items-center gap-1.5 font-medium">
                  <ShieldCheck className="w-3.5 h-3.5 text-status-success shrink-0" />
                  <span>
                    Vault Location: <code className="font-mono font-bold text-text-primary">onboarding-docs/{employeeIdFormatted ? employeeIdFormatted.replace("-", "") : "archive"}</code>
                  </span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-brand-purple/10 text-brand-purple">
                  {verifiedDocuments.length} Verified Document{verifiedDocuments.length === 1 ? "" : "s"}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {verifiedDocuments.map((doc) => (
                  <div
                    key={doc.id}
                    className="p-3.5 rounded-2xl bg-card-subtle border border-border-light flex items-center justify-between gap-2 hover:border-brand-purple/30 transition-colors"
                  >
                    <div className="space-y-0.5 truncate">
                      <div className="flex items-center gap-1.5">
                        <FileText className="w-3.5 h-3.5 text-brand-purple shrink-0" />
                        <span className="text-xs font-bold text-text-primary truncate">
                          {doc.document_name || DOC_TYPE_LABELS[doc.doc_type] || doc.doc_type.replace(/_/g, " ")}
                        </span>
                      </div>
                      <p className="text-[11px] font-mono text-text-tertiary pl-5 truncate">
                        {doc.file_name}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <span
                        className={cn(
                          "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                          doc.document_status === "approved"
                            ? "bg-status-success/15 text-status-success"
                            : doc.document_status === "rejected"
                            ? "bg-status-danger/15 text-status-danger"
                            : "bg-brand-purple/15 text-brand-purple"
                        )}
                      >
                        {doc.document_status}
                      </span>

                      {doc.signedUrl && (
                        <a
                          href={doc.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="px-2 py-1 rounded-lg bg-card border border-border-light hover:bg-card-subtle text-brand-purple hover:text-brand-purple-hover text-xs font-bold transition-colors inline-flex items-center gap-1 shadow-xs"
                          title="View PDF"
                        >
                          <span>View</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </BentoCard>
      </BentoGrid>
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AppShell>
      <ProfilePageContent />
    </AppShell>
  );
}
