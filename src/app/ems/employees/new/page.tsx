"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/features/ems/components/ems-navigation-header";
import {
  UserPlus,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Building2,
  Briefcase,
  ShieldCheck,
  GraduationCap,
  Clock,
  Mail,
  Copy,
  Check,
  ChevronDown,
  Search,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  COUNTRY_DIAL_CODES,
  DEFAULT_COUNTRY_ISO2,
  getCountryByIso2,
  validatePhoneNumber,
} from "@/lib/constants/country-dial-codes";

export default function NewEmployeeWizardPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = React.useState(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [departments, setDepartments] = React.useState<any[]>([]);
  const [jobTitles, setJobTitles] = React.useState<any[]>([]);

  // Step 1: Personal
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [countryIso2, setCountryIso2] = React.useState<string>(DEFAULT_COUNTRY_ISO2);
  const [countryDropdownOpen, setCountryDropdownOpen] = React.useState(false);
  const [countrySearch, setCountrySearch] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [phoneTouched, setPhoneTouched] = React.useState(false);
  const countryDropdownRef = React.useRef<HTMLDivElement>(null);
  const countrySearchInputRef = React.useRef<HTMLInputElement>(null);

  // Step 2: Org Assignment
  const [departmentId, setDepartmentId] = React.useState("");
  const [jobTitleId, setJobTitleId] = React.useState("");
  const [systemRole, setSystemRole] = React.useState<"employee" | "team_lead" | "manager" | "hr" | "admin">("employee");

  // Step 3: Employment Details
  const [employmentCategory, setEmploymentCategory] = React.useState<"full_time" | "part_time" | "contract" | "intern">("full_time");
  const [workMode, setWorkMode] = React.useState("remote");
  const [timezone, setTimezone] = React.useState("Asia/Kolkata");
  const [shiftStart, setShiftStart] = React.useState("09:00");
  const [shiftEnd, setShiftEnd] = React.useState("17:00");
  const [salary, setSalary] = React.useState("");

  // Step 4: Category Specific (Intern)
  const [internshipDuration, setInternshipDuration] = React.useState(3);
  const [trainingPlan, setTrainingPlan] = React.useState("");

  // Created Credentials & Submission Error State
  const [createdResult, setCreatedResult] = React.useState<any>(null);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [copied, setCopied] = React.useState(false);

  React.useEffect(() => {
    async function loadLookups() {
      try {
        const [dRes, jtRes] = await Promise.all([
          fetch("/api/admin/departments"),
          fetch("/api/admin/job-titles"),
        ]);
        const dJson = await dRes.json();
        const jtJson = await jtRes.json();
        if (dJson.departments) setDepartments(dJson.departments);
        const titlesList = jtJson.jobTitles || jtJson.titles || [];
        setJobTitles(titlesList);
      } catch {}
    }
    loadLookups();
  }, []);

  const filteredTitles = React.useMemo(() => {
    if (!departmentId) return jobTitles;
    const filtered = jobTitles.filter((j) => !j.department_id || j.department_id === departmentId);
    return filtered.length > 0 ? filtered : jobTitles;
  }, [departmentId, jobTitles]);

  const selectedCountry = React.useMemo(
    () => getCountryByIso2(countryIso2),
    [countryIso2]
  );

  const filteredCountries = React.useMemo(() => {
    const q = countrySearch.trim().toLowerCase();
    if (!q) return COUNTRY_DIAL_CODES;
    const qDigits = q.replace(/^\+/, "");
    return COUNTRY_DIAL_CODES
      .map((c) => {
        const nameLower = c.name.toLowerCase();
        const isoLower = c.iso2.toLowerCase();
        const dialLower = c.dialCode.toLowerCase();
        const dialDigits = dialLower.replace(/^\+/, "");

        let rank = -1;
        if (isoLower === q || dialLower === q || (qDigits && dialDigits === qDigits)) {
          rank = 0;
        } else if (
          nameLower.startsWith(q) ||
          isoLower.startsWith(q) ||
          (qDigits && dialDigits.startsWith(qDigits))
        ) {
          rank = 1;
        } else if (
          nameLower.includes(q) ||
          isoLower.includes(q) ||
          dialLower.includes(q) ||
          (qDigits && dialDigits.includes(qDigits))
        ) {
          rank = 2;
        }
        return { country: c, rank };
      })
      .filter((entry) => entry.rank !== -1)
      .sort((a, b) => a.rank - b.rank || a.country.name.localeCompare(b.country.name))
      .map((entry) => entry.country);
  }, [countrySearch]);

  React.useEffect(() => {
    if (!countryDropdownOpen) return;
    const timer = window.setTimeout(() => {
      countrySearchInputRef.current?.focus();
    }, 10);

    const handleClickOutside = (event: MouseEvent) => {
      if (
        countryDropdownRef.current &&
        !countryDropdownRef.current.contains(event.target as Node)
      ) {
        setCountryDropdownOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCountryDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [countryDropdownOpen]);

  const phoneValidationError = React.useMemo(
    () => validatePhoneNumber(selectedCountry, phone.trim()),
    [selectedCountry, phone]
  );

  const countryDialDigits = selectedCountry.dialCode.replace(/\D/g, "").length;
  const maxLocalDigitsForTrigger = selectedCountry.maxLength ?? 15 - countryDialDigits;

  const showInlinePhoneError = Boolean(
    phoneValidationError &&
      (phoneTouched || phone.trim().length > maxLocalDigitsForTrigger)
  );

  const combinedPhone = phone.trim() ? `${selectedCountry.dialCode}${phone.trim()}` : undefined;

  const sanitizeLocalPhone = (val: string) => val.replace(/\D/g, "");

  const handleNext = () => {
    if (currentStep === 1) {
      const cleanName = fullName.trim();
      const cleanEmail = email.trim();
      setPhoneTouched(true);

      if (!cleanName) {
        toast.error("Full name is required.");
        return;
      }
      if (!/^[A-Za-z\s]{2,60}$/.test(cleanName)) {
        toast.error("Full name must only contain alphabet letters and spaces.");
        return;
      }
      if (!cleanEmail) {
        toast.error("Email address is required.");
        return;
      }
      if (!/^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/.test(cleanEmail)) {
        toast.error("Email must contain only lowercase letters, numbers, and valid email symbols.");
        return;
      }
      if (phoneValidationError) {
        toast.error(phoneValidationError);
        return;
      }
    }
    if (currentStep === 3) {
      if (!shiftStart || !shiftEnd) {
        toast.error("Please specify both Shift Start (Check-In) and Shift End (Check-Out) times.");
        return;
      }
    }
    setCurrentStep((prev) => Math.min(prev + 1, 5));
  };

  const handlePrev = () => {
    setSubmitError(null);
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleCreateEmployee = async () => {
    setIsSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          fullName: fullName.trim(),
          phone: combinedPhone,
          role: systemRole,
          employmentCategory,
          workMode,
          timezone: timezone || "Asia/Kolkata",
          departmentId: departmentId || null,
          jobTitleId: jobTitleId || null,
          shiftStartTime: shiftStart.length === 5 ? `${shiftStart}:00` : shiftStart,
          shiftEndTime: shiftEnd.length === 5 ? `${shiftEnd}:00` : shiftEnd,
          salary: salary ? Number(salary) : undefined,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.success !== true || !data?.employee?.id) {
        throw new Error(
          data?.error ||
            `Failed to provision employee (HTTP ${res.status}): database record was not confirmed.`
        );
      }

      toast.success(`Account provisioned successfully for ${fullName}!`);
      setCreatedResult(data);
      router.refresh();
    } catch (err: any) {
      const msg = err?.message || "Failed to provision employee";
      setSubmitError(msg);
      toast.error(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (!createdResult) return;
    const text = `Pulse Account Provisioned\nName: ${fullName}\nOfficial Email: ${email}\nRole: ${systemRole.toUpperCase()}\nEmployment Category: ${employmentCategory.replace("_", " ").toUpperCase()}\nPortal: ${window.location.origin}/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Account details copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <EmsNavigationHeader />

        {/* Wizard Card Container */}
        <div className="max-w-4xl mx-auto">
          <div className="p-8 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm space-y-6">
            {/* Header */}
          <div className="flex items-center justify-between border-b border-border-light/60 pb-4">
            <div>
              <span className="text-xs font-bold text-brand-purple uppercase tracking-wider">
                Step {currentStep} of 5
              </span>
              <h2 className="text-lg font-bold text-text-primary">
                {currentStep === 1 && "Personal Information"}
                {currentStep === 2 && "Organizational & Security Assignment"}
                {currentStep === 3 && "Employment Classification & Schedule"}
                {currentStep === 4 && "Category-Specific Learning / Contract Terms"}
                {currentStep === 5 && "Review & Provision Account"}
              </h2>
            </div>

            {/* Stepper Dots */}
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5].map((step) => (
                <div
                  key={step}
                  className={cn(
                    "w-2.5 h-2.5 rounded-full transition-all",
                    currentStep === step
                      ? "bg-brand-purple w-6"
                      : currentStep > step
                      ? "bg-lime"
                      : "bg-card-subtle border border-border-light"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Form Content */}
          {createdResult ? (
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 rounded-full bg-lime/20 text-black flex items-center justify-center mx-auto border border-lime/20">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-text-primary">Employee Provisioned!</h3>
              <p className="text-xs text-text-secondary max-w-md mx-auto">
                {fullName} has been successfully provisioned. An invitation email with secure onboarding access has been sent to their official email.
              </p>

              <div className="p-5 rounded-2xl bg-card-subtle border border-border-light max-w-md mx-auto text-left text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-text-muted">Official Email:</span>
                  <span className="font-bold text-text-primary">{email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">System Role:</span>
                  <span className="font-semibold text-text-primary uppercase">{systemRole}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Employment Category:</span>
                  <span className="font-semibold text-text-primary uppercase">
                    {employmentCategory.replace("_", " ")}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center gap-3 pt-3">
                <button
                  onClick={handleCopy}
                  className="px-4 py-2 rounded-xl text-xs font-semibold bg-card-subtle hover:bg-card-subtle/80 border border-border-light text-text-primary flex items-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-black" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy Details
                </button>
                <Link
                  href="/ems/employees"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-purple text-white hover:bg-brand-purple/90"
                >
                  Return to EMS Directory
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Step 1: Personal */}
              {currentStep === 1 && (
                <div className="space-y-4 text-xs">
                  <div>
                    <label className="block font-semibold text-text-secondary mb-1">Full Name *</label>
                    <input
                      type="text"
                      placeholder="e.g. Priyanshu Sharma"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value.replace(/[^A-Za-z\s]/g, ""))}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Official Email Address *</label>
                      <input
                        type="email"
                        placeholder="e.g. priyanshu@zenxea.test"
                        value={email}
                        onChange={(e) => setEmail(e.target.value.toLowerCase().replace(/[^a-z0-9._%+-@]/g, ""))}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Contact Phone</label>
                      <div className="flex items-stretch gap-2">
                        <div ref={countryDropdownRef} className="relative shrink-0">
                          <button
                            type="button"
                            role="combobox"
                            aria-expanded={countryDropdownOpen}
                            aria-haspopup="listbox"
                            aria-label="Country dialing code"
                            title={`${selectedCountry.name} (${selectedCountry.iso2}) ${selectedCountry.dialCode}`}
                            onClick={() => {
                              setCountryDropdownOpen((prev) => {
                                const next = !prev;
                                if (!next) setCountrySearch("");
                                return next;
                              });
                            }}
                            className="h-full min-w-[104px] px-2.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary font-medium flex items-center justify-between gap-1.5 hover:border-border-focus/40 focus:outline-none focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple transition-colors"
                          >
                            <span className="flex items-center gap-1.5 whitespace-nowrap">
                              <span className="text-[11px] font-bold text-text-muted">{selectedCountry.iso2}</span>
                              <span>{selectedCountry.dialCode}</span>
                            </span>
                            <ChevronDown
                              className={cn(
                                "w-3.5 h-3.5 text-text-muted transition-transform shrink-0",
                                countryDropdownOpen && "rotate-180"
                              )}
                            />
                          </button>

                          {countryDropdownOpen && (
                            <div
                              role="listbox"
                              aria-label="Select country dialing code"
                              className="absolute left-0 top-full mt-1.5 w-80 max-w-[calc(100vw-3rem)] rounded-xl bg-card border border-border-light shadow-xl z-50 overflow-hidden"
                            >
                              <div className="p-2 border-b border-border-light bg-card">
                                <div className="relative flex items-center">
                                  <Search className="w-3.5 h-3.5 text-text-muted absolute left-2.5 pointer-events-none" />
                                  <input
                                    ref={countrySearchInputRef}
                                    type="text"
                                    value={countrySearch}
                                    onChange={(e) => setCountrySearch(e.target.value)}
                                    onKeyDown={(e) => {
                                      if (e.key === "Enter" && filteredCountries.length > 0) {
                                        e.preventDefault();
                                        setCountryIso2(filteredCountries[0].iso2);
                                        setCountryDropdownOpen(false);
                                        setCountrySearch("");
                                        if (phone) setPhoneTouched(true);
                                      }
                                    }}
                                    placeholder="Search country, ISO (IN), or +code..."
                                    className="w-full pl-8 pr-7 py-1.5 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
                                  />
                                  {countrySearch && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCountrySearch("");
                                        countrySearchInputRef.current?.focus();
                                      }}
                                      aria-label="Clear country search"
                                      className="absolute right-2 text-text-muted hover:text-text-primary p-0.5"
                                    >
                                      <X className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                              </div>

                              <div className="max-h-60 overflow-y-auto divide-y divide-border-light/40">
                                {filteredCountries.length === 0 ? (
                                  <div className="px-3 py-5 text-center text-[11px] text-text-muted">
                                    No countries match &ldquo;{countrySearch}&rdquo;
                                  </div>
                                ) : (
                                  filteredCountries.map((country) => {
                                    const isSelected = country.iso2 === selectedCountry.iso2;
                                    return (
                                      <button
                                        key={country.iso2}
                                        type="button"
                                        role="option"
                                        aria-selected={isSelected}
                                        onClick={() => {
                                          setCountryIso2(country.iso2);
                                          setCountryDropdownOpen(false);
                                          setCountrySearch("");
                                          if (phone) setPhoneTouched(true);
                                        }}
                                        className={cn(
                                          "w-full px-3 py-2 text-left text-xs flex items-center justify-between gap-2 hover:bg-card-subtle transition-colors",
                                          isSelected && "bg-card-subtle font-semibold"
                                        )}
                                      >
                                        <span className="truncate text-text-primary">
                                          {country.name}{" "}
                                          <span className="text-text-muted font-medium">({country.iso2})</span>
                                        </span>
                                        <span className="flex items-center gap-1.5 shrink-0 font-mono text-text-secondary">
                                          <span>{country.dialCode}</span>
                                          {isSelected && <Check className="w-3.5 h-3.5 text-brand-purple" />}
                                        </span>
                                      </button>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <input
                          type="tel"
                          inputMode="numeric"
                          aria-invalid={showInlinePhoneError}
                          placeholder={selectedCountry.placeholder || "Enter phone number"}
                          value={phone}
                          onChange={(e) => setPhone(sanitizeLocalPhone(e.target.value))}
                          onBlur={() => {
                            if (phone) setPhoneTouched(true);
                          }}
                          className={cn(
                            "flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-card-subtle border text-text-primary focus:ring-2",
                            showInlinePhoneError
                              ? "border-rose-500 focus:ring-rose-500/20 focus:border-rose-500"
                              : "border-border-light focus:ring-brand-purple/20 focus:border-brand-purple"
                          )}
                        />
                      </div>
                      {showInlinePhoneError ? (
                        <p className="text-[11px] text-rose-500 mt-1 font-medium" role="alert">
                          {phoneValidationError}
                        </p>
                      ) : (
                        <p className="text-[11px] text-text-muted mt-1">
                          {selectedCountry.name} ({selectedCountry.dialCode}):{" "}
                          {selectedCountry.minLength !== undefined && selectedCountry.maxLength !== undefined
                            ? selectedCountry.minLength === selectedCountry.maxLength
                              ? `${selectedCountry.minLength} digits`
                              : `${selectedCountry.minLength}–${selectedCountry.maxLength} digits`
                            : "E.164 (7–15 total digits)"}
                          {combinedPhone ? ` • Will save as ${combinedPhone}` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Org Assignment */}
              {currentStep === 2 && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Department</label>
                      <select
                        value={departmentId}
                        onChange={(e) => {
                          setDepartmentId(e.target.value);
                          setJobTitleId("");
                        }}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                      >
                        <option value="">Select Department (Optional)...</option>
                        {departments.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.name} {d.parent_department_id ? "(Subdepartment)" : ""}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Job Designation</label>
                      <select
                        value={jobTitleId}
                        onChange={(e) => setJobTitleId(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                      >
                        <option value="">Select Designation...</option>
                        {filteredTitles.map((jt) => (
                          <option key={jt.id} value={jt.id}>
                            {jt.title_name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block font-semibold text-text-secondary mb-1">System Security Role *</label>
                    <select
                      value={systemRole}
                      onChange={(e) => setSystemRole(e.target.value as any)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary font-bold"
                    >
                      <option value="employee">Employee (Standard self-service)</option>
                      <option value="team_lead">Team Lead (Team monitor & tasks)</option>
                      <option value="manager">Department Manager (Department authority)</option>
                      <option value="hr">HR Manager (Company-wide HR governance)</option>
                      <option value="admin">Admin (Company-wide system admin)</option>
                    </select>
                  </div>
                </div>
              )}

              {/* Step 3: Employment Details */}
              {currentStep === 3 && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Employment Category *</label>
                      <select
                        value={employmentCategory}
                        onChange={(e) => setEmploymentCategory(e.target.value as any)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary font-semibold"
                      >
                        <option value="full_time">Full-Time Employee</option>
                        <option value="intern">Intern</option>
                        <option value="contract">Contract Employee</option>
                        <option value="part_time">Part-Time Employee</option>
                      </select>
                    </div>

                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Work Mode</label>
                      <select
                        value={workMode}
                        onChange={(e) => setWorkMode(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                      >
                        <option value="remote">Remote</option>
                        <option value="office">Office</option>
                        <option value="hybrid">Hybrid</option>
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Shift Start (Scheduled Check-In) *</label>
                      <input
                        type="time"
                        value={shiftStart}
                        onChange={(e) => setShiftStart(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Shift End (Scheduled Check-Out) *</label>
                      <input
                        type="time"
                        value={shiftEnd}
                        onChange={(e) => setShiftEnd(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                      />
                    </div>
                  </div>
                  {shiftEnd && shiftStart && shiftEnd < shiftStart && (
                    <div className="p-3 rounded-xl bg-brand-purple/10 border border-brand-purple/20 text-brand-purple text-xs font-semibold flex items-center gap-2">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>Overnight Shift: Check-in scheduled for {shiftStart}, check-out scheduled for {shiftEnd} the following day.</span>
                    </div>
                  )}

                  <div>
                    <label className="block font-semibold text-text-secondary mb-1">
                      Monthly Salary / Stipend (₹ INR)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-text-muted font-bold text-xs">
                        ₹
                      </span>
                      <input
                        type="number"
                        placeholder="e.g. 25000"
                        min="0"
                        step="500"
                        value={salary}
                        onChange={(e) => setSalary(e.target.value)}
                        className="w-full pl-8 pr-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary text-xs focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
                      />
                    </div>
                    <span className="text-[11px] text-text-muted mt-0.5 block">
                      Base monthly compensation in Indian Rupees (₹ INR).
                    </span>
                  </div>
                </div>
              )}

              {/* Step 4: Category Specific */}
              {currentStep === 4 && (
                <div className="space-y-4 text-xs">
                  {employmentCategory === "intern" ? (
                    <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/20 space-y-3">
                      <div className="flex items-center gap-2 text-amber-500 font-bold">
                        <GraduationCap className="w-4 h-4" />
                        <span>Internship Program Specifics</span>
                      </div>
                      <div>
                        <label className="block font-semibold text-text-secondary mb-1">
                          Internship Duration (Months)
                        </label>
                        <input
                          type="number"
                          value={internshipDuration}
                          onChange={(e) => setInternshipDuration(Number(e.target.value))}
                          className="w-full px-3.5 py-2 rounded-xl bg-card border border-border-light text-text-primary"
                          min={1}
                          max={12}
                        />
                      </div>
                      <div>
                        <label className="block font-semibold text-text-secondary mb-1">
                          Training Plan & Learning Goals
                        </label>
                        <textarea
                          value={trainingPlan}
                          onChange={(e) => setTrainingPlan(e.target.value)}
                          placeholder="e.g. Focus on SEO keyword research, technical audit, and content strategies..."
                          className="w-full px-3.5 py-2 rounded-xl bg-card border border-border-light text-text-primary h-20 resize-none"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2">
                      <p className="font-bold text-text-primary">Standard Employment Classification</p>
                      <p className="text-text-muted">
                        No additional internship parameters required for {employmentCategory.replace("_", " ")}. Standard
                        probation and performance metrics will apply.
                      </p>
                    </div>
                  )}
                </div>
              )}

              {/* Step 5: Review & Confirm */}
              {currentStep === 5 && (
                <div className="p-5 rounded-2xl bg-card-subtle border border-border-light text-xs space-y-3">
                  <h4 className="font-bold text-text-primary text-sm mb-2">Review Summary Before Provisioning</h4>
                  <div className="grid grid-cols-2 gap-2 text-text-secondary">
                    <p>
                      <span className="text-text-muted">Name:</span> {fullName}
                    </p>
                    <p>
                      <span className="text-text-muted">Email:</span> {email}
                    </p>
                    {combinedPhone && (
                      <p>
                        <span className="text-text-muted">Phone:</span> {combinedPhone}
                      </p>
                    )}
                    <p>
                      <span className="text-text-muted">Department:</span>{" "}
                      {departments.find((d) => d.id === departmentId)?.name || "Unassigned"}
                    </p>
                    <p>
                      <span className="text-text-muted">System Role:</span> {systemRole.toUpperCase()}
                    </p>
                    <p>
                      <span className="text-text-muted">Category:</span> {employmentCategory.toUpperCase()}
                    </p>
                    <p>
                      <span className="text-text-muted">Work Mode:</span> {workMode}
                    </p>
                    <p>
                      <span className="text-text-muted">Shift:</span> {shiftStart} - {shiftEnd}
                    </p>
                    {salary && (
                      <p>
                        <span className="text-text-muted">Monthly Salary:</span> ₹{Number(salary).toLocaleString("en-IN")} INR
                      </p>
                    )}
                  </div>
                  <p className="text-[11px] text-text-muted pt-2 border-t border-border-light">
                    Clicking &quot;Confirm &amp; Provision Account&quot; creates the Supabase Auth user, generates a unique business ID
                    (`ZX-EMP-XXX` or `ZX-INT-XXX`), and sets up their initial onboarding profile.
                  </p>
                  {submitError && (
                    <div
                      role="alert"
                      className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-300 text-xs font-medium"
                    >
                      <strong>Provisioning Failed:</strong> {submitError}
                    </div>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center justify-between pt-4 border-t border-border-light">
                <button
                  type="button"
                  onClick={handlePrev}
                  disabled={currentStep === 1 || isSubmitting}
                  className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary hover:text-text-primary text-xs font-semibold disabled:opacity-40"
                >
                  Back
                </button>

                {currentStep < 5 ? (
                  <button
                    type="button"
                    onClick={handleNext}
                    className="px-5 py-2 rounded-xl bg-brand-purple text-white hover:bg-brand-purple/90 text-xs font-bold flex items-center gap-1.5 shadow-sm"
                  >
                    Next Step
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleCreateEmployee}
                    disabled={isSubmitting}
                    className="px-6 py-2.5 rounded-xl bg-lime hover:bg-lime-hover text-black text-xs font-bold flex items-center gap-1.5 shadow-md transition-all"
                  >
                    {isSubmitting ? "Provisioning..." : "Confirm & Provision Account"}
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>
    </AppShell>
  );
}
