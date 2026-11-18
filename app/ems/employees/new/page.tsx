"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/components/ems/ems-navigation-header";
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
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function NewEmployeeWizardPage() {
  const router = useRouter();
  const [currentStep, setCurrentStep] = React.useState(1);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [departments, setDepartments] = React.useState<any[]>([]);
  const [jobTitles, setJobTitles] = React.useState<any[]>([]);

  // Step 1: Personal
  const [fullName, setFullName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [phone, setPhone] = React.useState("");

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

  // Step 4: Category Specific (Intern)
  const [internshipDuration, setInternshipDuration] = React.useState(3);
  const [trainingPlan, setTrainingPlan] = React.useState("");

  // Created Credentials State
  const [createdResult, setCreatedResult] = React.useState<any>(null);
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

  const handleNext = () => {
    if (currentStep === 1) {
      if (!fullName.trim() || !email.trim()) {
        toast.error("Please fill in full name and email");
        return;
      }
    }
    if (currentStep === 2) {
      if (!departmentId) {
        toast.error("Please select a department");
        return;
      }
    }
    setCurrentStep((prev) => Math.min(prev + 1, 5));
  };

  const handlePrev = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 1));
  };

  const handleCreateEmployee = async () => {
    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          fullName,
          role: systemRole,
          employmentCategory,
          workMode,
          timezone,
          departmentId,
          jobTitleId,
          shiftStartTime: shiftStart,
          shiftEndTime: shiftEnd,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create employee");

      toast.success(`Account provisioned successfully for ${fullName}!`);
      setCreatedResult(data);
    } catch (err: any) {
      toast.error(err.message || "Failed to provision employee");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = () => {
    if (!createdResult) return;
    const text = `ZEN XEA HRMS Login Credentials\nEmail: ${email}\nPassword: ${createdResult.temporaryPassword || "Welcome2026!"}\nLink: ${window.location.origin}/auth/login`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success("Credentials copied to clipboard!");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
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
                      ? "bg-emerald-500"
                      : "bg-card-subtle border border-border-light"
                  )}
                />
              ))}
            </div>
          </div>

          {/* Form Content */}
          {createdResult ? (
            <div className="text-center py-8 space-y-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 text-emerald-500 flex items-center justify-center mx-auto border border-emerald-500/20">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-xl font-bold text-text-primary">Employee Provisioned!</h3>
              <p className="text-xs text-text-secondary max-w-md mx-auto">
                {fullName} has been created and assigned the business ID and temporary access credentials below.
              </p>

              <div className="p-5 rounded-2xl bg-card-subtle border border-border-light max-w-md mx-auto text-left text-xs space-y-2">
                <div className="flex justify-between">
                  <span className="text-text-muted">Official Email:</span>
                  <span className="font-bold text-text-primary">{email}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-text-muted">Temporary Password:</span>
                  <span className="font-mono font-bold text-brand-purple">
                    {createdResult.temporaryPassword || "Welcome2026!"}
                  </span>
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
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
                  Copy Credentials
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
                      onChange={(e) => setFullName(e.target.value)}
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
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Contact Phone</label>
                      <input
                        type="text"
                        placeholder="e.g. +91 98765 43210"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Step 2: Org Assignment */}
              {currentStep === 2 && (
                <div className="space-y-4 text-xs">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Department *</label>
                      <select
                        value={departmentId}
                        onChange={(e) => {
                          setDepartmentId(e.target.value);
                          setJobTitleId("");
                        }}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                      >
                        <option value="">Select Department...</option>
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
                      <label className="block font-semibold text-text-secondary mb-1">Shift Start Time</label>
                      <input
                        type="time"
                        value={shiftStart}
                        onChange={(e) => setShiftStart(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                      />
                    </div>
                    <div>
                      <label className="block font-semibold text-text-secondary mb-1">Shift End Time</label>
                      <input
                        type="time"
                        value={shiftEnd}
                        onChange={(e) => setShiftEnd(e.target.value)}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                      />
                    </div>
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
                  </div>
                  <p className="text-[11px] text-text-muted pt-2 border-t border-border-light">
                    Clicking &quot;Confirm &amp; Provision Account&quot; creates the Supabase Auth user, generates a unique business ID
                    (`ZX-EMP-XXX` or `ZX-INT-XXX`), and sets up their initial onboarding profile.
                  </p>
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
                    className="px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-md transition-all"
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
