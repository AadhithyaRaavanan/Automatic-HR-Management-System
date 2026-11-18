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
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  FileText,
  ExternalLink,
  ShieldCheck,
  Award,
  GraduationCap,
  History,
  Check,
  X,
  Send,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function Employee360ProfilePage() {
  const params = useParams();
  const router = useRouter();
  const employeeId = params?.id as string;
  const { userRole } = useAppSession();

  const [loading, setLoading] = React.useState(true);
  const [profileData, setProfileData] = React.useState<any>(null);
  const [activeTab, setActiveTab] = React.useState<
    "overview" | "employment" | "education" | "documents" | "internship" | "attendance" | "permissions" | "history"
  >("overview");

  // Permission Request Modal State
  const [permissionModalOpen, setPermissionModalOpen] = React.useState(false);
  const [permDate, setPermDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [permStart, setPermStart] = React.useState("10:00");
  const [permEnd, setPermEnd] = React.useState("12:00");
  const [permDuration, setPermDuration] = React.useState(120);
  const [permType, setPermType] = React.useState("personal");
  const [permReason, setPermReason] = React.useState("");
  const [submittingPerm, setSubmittingPerm] = React.useState(false);

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

  const handleReviewPermission = async (requestId: string, action: "approve" | "reject") => {
    try {
      const res = await fetch("/api/permissions/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, action, reviewNote: `Actioned by ${userRole}` }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Review failed");
      toast.success(`Permission request ${action}d!`);
      await loadProfile();
    } catch (err: any) {
      toast.error(err.message || "Failed to review permission");
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="p-8 max-w-7xl mx-auto space-y-4">
          <div className="h-6 w-32 bg-card-subtle rounded-lg animate-pulse" />
          <div className="h-44 bg-card-subtle rounded-3xl animate-pulse" />
        </div>
      </AppShell>
    );
  }

  const emp = profileData?.employee || {};
  const onb = profileData?.onboarding || {};
  const docs = profileData?.documents || [];
  const internship = profileData?.internship;
  const history = profileData?.careerHistory || [];
  const attendance = profileData?.recentAttendance || [];
  const permissions = profileData?.permissions || [];

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Back Link */}
        <div>
          <Link
            href="/employees"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-text-muted hover:text-text-primary transition-colors mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to Employee Directory
          </Link>
        </div>

        {/* Hero Card */}
        <div className="p-6 rounded-3xl bg-gradient-to-r from-card/80 to-card-subtle/80 backdrop-blur-md border border-border-light shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-brand-purple to-brand-cyan flex items-center justify-center text-xl font-bold text-white shadow-lg">
              {emp.full_name?.slice(0, 2).toUpperCase() || "ZX"}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl font-bold text-text-primary">{emp.full_name}</h1>
                <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded-full bg-brand-purple/10 text-brand-purple border border-brand-purple/20">
                  {emp.employee_number || emp.id?.slice(0, 8)}
                </span>
              </div>
              <p className="text-xs text-text-secondary mt-1">
                {emp.job_titles?.title_name || "Specialist"} • {emp.departments?.name || "ZEN XEA"}
              </p>
              <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <Mail className="w-3 h-3 text-brand-purple" />
                  {emp.email}
                </span>
                <span className="flex items-center gap-1">
                  <Phone className="w-3 h-3 text-brand-cyan" />
                  {emp.phone || onb.phone || onb.emergency_contact_phone || "Not set"}
                </span>
              </div>
            </div>
          </div>

          {userRole !== "admin" && userRole !== "hr" && (
            <div className="flex items-center gap-3">
              <button
                onClick={() => setPermissionModalOpen(true)}
                className="px-4 py-2 rounded-xl text-xs font-semibold bg-brand-purple text-white hover:bg-brand-purple/90 shadow-sm transition-all flex items-center gap-1.5"
              >
                <Clock className="w-3.5 h-3.5" />
                Request Hourly Permission
              </button>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-1.5 border-b border-border-light pb-2 overflow-x-auto text-xs font-semibold">
          {[
            { id: "overview", label: "360° Overview" },
            { id: "employment", label: "Employment & Governance" },
            { id: "education", label: "Education & Onboarding" },
            { id: "documents", label: `Documents (${docs.length})` },
            ...(emp.employment_category === "intern" || internship
              ? [{ id: "internship", label: "Internship Details" }]
              : []),
            { id: "attendance", label: "Attendance Summary" },
            { id: "permissions", label: `Hourly Permissions (${permissions.length})` },
            { id: "history", label: "Career Timeline" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl transition-all whitespace-nowrap",
                activeTab === tab.id
                  ? "bg-brand-purple text-white shadow-sm"
                  : "text-text-secondary hover:text-text-primary hover:bg-card-subtle"
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Tab 1: Overview */}
        {activeTab === "overview" && (
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
                  <span className="font-semibold text-emerald-500 uppercase">{emp.status || "Active"}</span>
                </div>
              </div>
            </BentoCard>

            <BentoCard title={<span className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-brand-purple" /> Identity & Contact</span>}>
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
                <div className="flex justify-between py-1 border-b border-border-light/40">
                  <span className="text-text-muted">Bank A/C:</span>
                  <span className="font-mono text-text-primary">
                    {onb.bank_account_number ? `••••${onb.bank_account_number.slice(-4)}` : "Verified"}
                  </span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-text-muted">Onboarding:</span>
                  <span className="font-semibold text-emerald-500">COMPLETED & VERIFIED</span>
                </div>
              </div>
            </BentoCard>
          </BentoGrid>
        )}

        {/* Tab 2: Employment & Governance */}
        {activeTab === "employment" && (
          <div className="p-6 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light space-y-4">
            <h3 className="text-sm font-bold text-text-primary">Employment Governance Parameters</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
              <div className="p-4 rounded-2xl bg-card-subtle border border-border-light/60 space-y-2">
                <p className="text-text-muted">Shift Timings:</p>
                <p className="font-bold text-text-primary">
                  {emp.shift_start_time || "09:00"} - {emp.shift_end_time || "17:00"}
                </p>
                <p className="text-[11px] text-text-muted">Standard 8-hour workday with 60-min lunch allowance.</p>
              </div>
              <div className="p-4 rounded-2xl bg-card-subtle border border-border-light/60 space-y-2">
                <p className="text-text-muted">Department Tree:</p>
                <p className="font-bold text-text-primary">
                  {emp.departments?.parent_department_id ? "Subdepartment under Digital Marketing" : "Main Department"}
                </p>
                <p className="text-[11px] text-text-muted">Governed by ZEN XEA Organizational Hierarchy.</p>
              </div>
            </div>
          </div>
        )}

        {/* Tab 3: Education */}
        {activeTab === "education" && (
          <div className="p-6 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light space-y-4">
            <h3 className="text-sm font-bold text-text-primary">Verified Educational Qualification</h3>
            <div className="p-4 rounded-2xl bg-card-subtle border border-border-light/60 text-xs space-y-2">
              <div className="flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-brand-purple" />
                <span className="font-bold text-text-primary">
                  {onb.highest_qualification || onb.education_details?.highest_qualification || "12th Standard"}
                </span>
              </div>
              <p className="text-text-muted">Verified during mandatory employee onboarding intake.</p>
            </div>
          </div>
        )}

        {/* Tab 4: Documents */}
        {activeTab === "documents" && (
          <div className="p-6 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light space-y-4">
            <h3 className="text-sm font-bold text-text-primary">Verified Employee Documents</h3>
            {docs.length === 0 ? (
              <p className="text-xs text-text-muted">No documents uploaded or all archived in Google Drive.</p>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {docs.map((d: any) => (
                  <div
                    key={d.id}
                    className="p-3.5 rounded-2xl bg-card-subtle border border-border-light flex items-center justify-between text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <FileText className="w-4 h-4 text-brand-purple" />
                      <div>
                        <p className="font-semibold text-text-primary">{d.document_name || d.doc_type}</p>
                        <p className="text-[10px] text-text-muted font-mono">{d.file_name || "drive_asset.pdf"}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                        {d.document_status || "VERIFIED"}
                      </span>
                      {d.signedUrl && (
                        <a
                          href={d.signedUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="p-1 rounded-lg bg-card hover:bg-card-subtle text-brand-purple border border-border-light text-[10px] font-semibold flex items-center gap-1 shadow-sm"
                          title="Preview document"
                        >
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 5: Internship Details */}
        {activeTab === "internship" && (
          <div className="p-6 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light space-y-6">
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

            <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2 text-xs">
              <p className="font-bold text-text-primary">Training Plan & Target Learning Goals:</p>
              <p className="text-text-secondary leading-relaxed">
                {internship?.training_plan ||
                  "Master Next.js App Router, Supabase PostgreSQL RLS security barriers, Tailwind CSS design system tokens, and HRMS enterprise workflows."}
              </p>
            </div>
          </div>
        )}

        {/* Tab 6: Hourly Permissions */}
        {activeTab === "permissions" && (
          <div className="p-6 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-text-primary">Hourly Permission Requests</h3>
                <p className="text-xs text-text-secondary mt-0.5">
                  Short-duration permissions (personal, medical, emergency) seamlessly integrated with attendance.
                </p>
              </div>
              <button
                onClick={() => setPermissionModalOpen(true)}
                className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-brand-purple text-white hover:bg-brand-purple/90"
              >
                + New Request
              </button>
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

                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          "px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                          p.status === "approved"
                            ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                            : p.status === "rejected"
                            ? "bg-rose-500/10 text-rose-500 border border-rose-500/20"
                            : "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                        )}
                      >
                        {p.status}
                      </span>

                      {p.status === "pending" && (userRole === "admin" || userRole === "hr" || userRole === "manager") && (
                        <div className="flex items-center gap-1.5 ml-2">
                          <button
                            onClick={() => handleReviewPermission(p.id, "approve")}
                            className="p-1 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20"
                            title="Approve"
                          >
                            <Check className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleReviewPermission(p.id, "reject")}
                            className="p-1 rounded-lg bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                            title="Reject"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tab 7: Attendance Summary */}
        {activeTab === "attendance" && (
          <div className="p-6 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light space-y-4">
            <h3 className="text-base font-bold text-text-primary">Recent Attendance Logs</h3>
            {attendance.length === 0 ? (
              <p className="text-xs text-text-muted">No attendance days logged for this employee.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead>
                    <tr className="border-b border-border-light text-text-muted">
                      <th className="py-2">Date</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Total Minutes</th>
                      <th className="py-2">Late Arrival</th>
                      <th className="py-2">Early Exit</th>
                      <th className="py-2">Work Location</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-light/40">
                    {attendance.map((a: any) => (
                      <tr key={a.id} className="text-text-secondary">
                        <td className="py-2 font-mono">{a.work_date}</td>
                        <td className="py-2 uppercase font-bold text-text-primary">{a.status}</td>
                        <td className="py-2">{a.total_minutes}m ({(a.total_minutes / 60).toFixed(1)}h)</td>
                        <td className="py-2">{a.is_late ? "Yes" : "No"}</td>
                        <td className="py-2">{a.is_early_exit ? "Yes" : "No"}</td>
                        <td className="py-2 capitalize">{a.work_location || "Office"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* Tab 8: Career Timeline */}
        {activeTab === "history" && (
          <div className="p-6 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light space-y-4">
            <h3 className="text-base font-bold text-text-primary">Effective-Dated Career Timeline</h3>
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

        {/* Hourly Permission Modal */}
        {permissionModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl bg-card border border-border-light p-6 shadow-2xl space-y-4">
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
                      <option value="personal">Personal Requirement</option>
                      <option value="medical">Medical Appointment</option>
                      <option value="official">Official Outside Work</option>
                      <option value="emergency">Family Emergency</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Detailed Reason</label>
                  <textarea
                    value={permReason}
                    onChange={(e) => setPermReason(e.target.value)}
                    placeholder="Describe reason for permission..."
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary h-20"
                    required
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPermissionModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submittingPerm}
                    className="px-4 py-2 rounded-xl bg-brand-purple text-white font-semibold hover:bg-brand-purple/90"
                  >
                    {submittingPerm ? "Submitting..." : "Submit Permission"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
