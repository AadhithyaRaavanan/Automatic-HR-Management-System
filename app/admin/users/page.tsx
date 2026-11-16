"use client";

import * as React from "react";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/shared/status-pill";
import { Modal } from "@/components/ui/modal";
import { EmptyState } from "@/components/shared/empty-state";
import { createClient } from "@/lib/supabase/client";
import {
  UserPlus,
  KeyRound,
  LogOut,
  UserX,
  Edit,
  Mail,
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  Download,
  Users,
  Copy,
  Check,
  Clock,
  Send,
  ShieldCheck,
  Briefcase,
  Building2,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { JobTitlesManager } from "@/features/admin/components/job-titles-manager";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredDepartments,
  getStoredJobTitles,
  getStoredLocations,
  getStoredUsers,
  addStoredUser,
  updateStoredUser,
  deleteStoredUser,
} from "@/lib/storage/demo-store";

interface EmployeeUser {
  id: string;
  name: string;
  email: string;
  role: "employee" | "manager" | "hr" | "admin";
  workMode: string;
  department: string;
  departmentId?: string;
  jobTitle?: string;
  jobTitleId?: string;
  location: string;
  status: "active" | "suspended" | "inactive";
  timezone: string;
  shiftStartTime: string;
  shiftEndTime: string;
}

interface BulkPreviewRow {
  rowNumber: number;
  email: string;
  fullName: string;
  role: string;
  workMode: string;
  timezone: string;
  valid: boolean;
  errors: string[];
}

interface BulkImportPreviewResult {
  dryRun: boolean;
  totalRows: number;
  validCount?: number;
  invalidCount?: number;
  importedCount?: number;
  failedCount?: number;
  rows: BulkPreviewRow[];
  errorCsv: string | null;
}

const SAMPLE_BULK_CSV = `email,full_name,role,work_mode,timezone,work_target_minutes
newhire1@company.test,Aarav Patel,employee,remote,Asia/Kolkata,480
newhire2@company.test,Meera Krishnan,manager,hybrid,Asia/Kolkata,480`;

function UsersDirectoryContent() {
  const { userRole, organizationId, userId } = useAppSession();
  const isAdmin = userRole === "admin";
  const supabase = React.useMemo(() => createClient(), []);

  const [users, setUsers] = React.useState<EmployeeUser[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [inviteModalOpen, setInviteModalOpen] = React.useState(false);
  const [governanceModalOpen, setGovernanceModalOpen] = React.useState(false);
  const [bulkModalOpen, setBulkModalOpen] = React.useState(false);
  const [jobTitlesManagerOpen, setJobTitlesManagerOpen] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<EmployeeUser | null>(null);

  // Job Titles & Departments Lookups
  const [jobTitlesList, setJobTitlesList] = React.useState<{ id: string; title_name: string; department_id?: string | null }[]>([]);
  const [departmentsList, setDepartmentsList] = React.useState<{ id: string; name: string }[]>([]);

  // Invite Form State
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteName, setInviteName] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"employee" | "manager" | "hr" | "admin">(
    "employee"
  );
  const [inviteJobTitleId, setInviteJobTitleId] = React.useState("");
  const [inviteDepartmentId, setInviteDepartmentId] = React.useState("");
  const [inviteWorkMode, setInviteWorkMode] = React.useState("remote");
  const [inviteTimezone, setInviteTimezone] = React.useState("Asia/Kolkata");
  const [inviteShiftStart, setInviteShiftStart] = React.useState("09:00");
  const [inviteShiftEnd, setInviteShiftEnd] = React.useState("17:00");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Governance Edit Form State
  const [govWorkMode, setGovWorkMode] = React.useState("remote");
  const [govTimezone, setGovTimezone] = React.useState("UTC");
  const [govStatus, setGovStatus] = React.useState("active");
  const [govShiftStart, setGovShiftStart] = React.useState("09:00");
  const [govShiftEnd, setGovShiftEnd] = React.useState("17:00");
  const [govDepartmentId, setGovDepartmentId] = React.useState("");
  const [govJobTitleId, setGovJobTitleId] = React.useState("");
  const [govRole, setGovRole] = React.useState<"employee" | "manager" | "hr" | "admin">("employee");

  const filteredInviteTitles = React.useMemo(() => {
    if (!inviteDepartmentId) return jobTitlesList;
    return jobTitlesList.filter(
      (jt) => !jt.department_id || jt.department_id === inviteDepartmentId
    );
  }, [jobTitlesList, inviteDepartmentId]);

  const filteredGovTitles = React.useMemo(() => {
    if (!govDepartmentId) return jobTitlesList;
    return jobTitlesList.filter(
      (jt) => !jt.department_id || jt.department_id === govDepartmentId
    );
  }, [jobTitlesList, govDepartmentId]);

  // Credentials & Resend Delivery Modal State
  const [createdCredentials, setCreatedCredentials] = React.useState<{
    email: string;
    inviteLink?: string;
    tempPassword?: string;
    role: string;
    jobTitle?: string;
    department?: string;
    shift: string;
    emailSent: boolean;
    status?: string;
  } | null>(null);
  const [credentialsModalOpen, setCredentialsModalOpen] = React.useState(false);
  const [hasCopied, setHasCopied] = React.useState(false);

  // Bulk CSV Import State
  const [csvText, setCsvText] = React.useState(SAMPLE_BULK_CSV);
  const [bulkPreview, setBulkPreview] = React.useState<BulkImportPreviewResult | null>(null);
  const [bulkLoading, setBulkLoading] = React.useState(false);

  const loadDirectory = React.useCallback(async () => {
    setLoading(true);
    try {
      const storedTitles = getStoredJobTitles();
      const storedDepts = getStoredDepartments();
      const storedLocations = getStoredLocations();
      const storedUsers = getStoredUsers();

      let emps: any = null;
      let members: any = null;
      let jobTitlesData: any = null;
      let deptsData: any = null;
      let locsData: any = null;

      try {
        const results = await Promise.all([
          (supabase as any)
            .from("employees")
            .select(
              "id, full_name, email, work_mode, status, timezone, shift_start_time, shift_end_time, department_id, job_title_id, primary_location_id, departments:department_id(id, name), job_titles:job_title_id(id, title_name), locations:primary_location_id(id, name)"
            )
            .order("full_name"),
          (supabase as any)
            .from("organization_members")
            .select("user_id, role, status, shift_start_time, shift_end_time, department_id, job_title_id"),
          (supabase as any)
            .from("job_titles")
            .select("id, title_name, department_id")
            .order("title_name"),
          (supabase as any)
            .from("departments")
            .select("id, name")
            .order("name"),
          (supabase as any)
            .from("locations")
            .select("id, name")
            .order("name"),
        ]);
        emps = results[0]?.data;
        members = results[1]?.data;
        jobTitlesData = results[2]?.data;
        deptsData = results[3]?.data;
        locsData = results[4]?.data;
      } catch {
        // Supabase not running, continue with stored
      }

      // Merge stored job titles with database
      const mergedTitles: { id: string; title_name: string; department_id?: string | null }[] = storedTitles.map((t) => ({
        id: t.id,
        title_name: t.title_name,
        department_id: t.department_id || null,
      }));
      for (const jt of jobTitlesData || []) {
        const existingIdx = mergedTitles.findIndex((t) => t.id === jt.id || t.title_name === jt.title_name);
        if (existingIdx === -1) {
          mergedTitles.push({ id: jt.id, title_name: jt.title_name, department_id: jt.department_id || null });
        } else if (jt.department_id && !mergedTitles[existingIdx].department_id) {
          mergedTitles[existingIdx].department_id = jt.department_id;
        }
      }
      setJobTitlesList(mergedTitles);

      // Merge stored departments with database
      const mergedDepts: { id: string; name: string }[] = storedDepts.map((d) => ({
        id: d.id,
        name: d.name,
      }));
      for (const d of deptsData || []) {
        if (!mergedDepts.some((md) => md.id === d.id || md.name === d.name)) {
          mergedDepts.push({ id: d.id, name: d.name });
        }
      }
      setDepartmentsList(mergedDepts);

      // Merge stored locations with database (in demo mode, strictly respect user-created store)
      const mergedLocations: { id: string; name: string }[] = storedLocations.map((l) => ({
        id: l.id,
        name: l.name,
      }));
      if (!isDemoModeEnabled()) {
        for (const l of locsData || []) {
          if (!mergedLocations.some((ml) => ml.id === l.id || ml.name === l.name)) {
            mergedLocations.push({ id: l.id, name: l.name });
          }
        }
      }

      const validDeptNames = new Set(mergedDepts.map((d) => d.name));
      const validDeptIds = new Set(mergedDepts.map((d) => d.id));
      const validTitleNames = new Set(mergedTitles.map((t) => t.title_name));
      const validTitleIds = new Set(mergedTitles.map((t) => t.id));
      const validLocNames = new Set(mergedLocations.map((l) => l.name));
      const validLocIds = new Set(mergedLocations.map((l) => l.id));

      if (emps && emps.length > 0) {
        const memberMap = new Map<
          string,
          {
            role: string;
            status: string;
            shiftStartTime: string;
            shiftEndTime: string;
            departmentId?: string;
            jobTitleId?: string;
          }
        >();
        for (const m of members || []) {
          memberMap.set(m.user_id, {
            role: m.role,
            status: m.status,
            shiftStartTime: (m.shift_start_time || "09:00:00").slice(0, 5),
            shiftEndTime: (m.shift_end_time || "17:00:00").slice(0, 5),
            departmentId: m.department_id,
            jobTitleId: m.job_title_id,
          });
        }
        setUsers(
          emps.map((e: any) => {
            const mem = memberMap.get(e.id);
            const storedU = storedUsers.find((u) => u.id === e.id || u.email === e.email);
            const effectiveStatus =
              mem?.status === "suspended"
                ? "suspended"
                : e.status === "inactive"
                  ? "inactive"
                  : "active";

            // If user has modified governance in demo store, respect their exact assignments
            if (storedU && isDemoModeEnabled()) {
              const hasValidDept =
                storedU.department &&
                storedU.department !== "Unassigned" &&
                validDeptNames.has(storedU.department);
              const hasValidTitle =
                storedU.jobTitle &&
                storedU.jobTitle !== "Unassigned" &&
                validTitleNames.has(storedU.jobTitle);
              const hasValidLoc =
                storedU.location &&
                storedU.location !== "Unassigned" &&
                validLocNames.has(storedU.location);

              return {
                id: e.id,
                name: storedU.name || e.full_name,
                email: e.email,
                role: (storedU.role || mem?.role || "employee") as EmployeeUser["role"],
                workMode: storedU.workMode || e.work_mode || "remote",
                department: hasValidDept ? storedU.department : "Unassigned",
                departmentId: hasValidDept ? (storedU.departmentId || "") : "",
                jobTitle: hasValidTitle ? storedU.jobTitle : "",
                jobTitleId: hasValidTitle ? (storedU.jobTitleId || "") : "",
                location: hasValidLoc ? storedU.location : "Unassigned",
                status: effectiveStatus,
                timezone: storedU.timezone || e.timezone || "UTC",
                shiftStartTime: storedU.shiftStartTime || (e.shift_start_time || "09:00:00").slice(0, 5),
                shiftEndTime: storedU.shiftEndTime || (e.shift_end_time || "17:00:00").slice(0, 5),
              };
            }

            const deptObj = mergedDepts.find((d) => d.id === e.department_id);
            const deptName = deptObj?.name || (Array.isArray(e.departments) ? e.departments[0]?.name : e.departments?.name);
            const hasValidDept = Boolean(
              (e.department_id && (deptObj || validDeptIds.has(e.department_id))) ||
              (deptName && validDeptNames.has(deptName))
            );

            const titleObj = mergedTitles.find((t) => t.id === e.job_title_id);
            const titleName = titleObj?.title_name || (Array.isArray(e.job_titles) ? e.job_titles[0]?.title_name : e.job_titles?.title_name);
            const hasValidTitle = Boolean(
              (e.job_title_id && (titleObj || validTitleIds.has(e.job_title_id))) ||
              (titleName && validTitleNames.has(titleName))
            );

            const locObj = mergedLocations.find((l) => l.id === e.primary_location_id);
            const locName = locObj?.name || (Array.isArray(e.locations) ? e.locations[0]?.name : e.locations?.name);
            const hasValidLoc = Boolean(
              (e.primary_location_id && (locObj || validLocIds.has(e.primary_location_id))) ||
              (locName && validLocNames.has(locName))
            );

            return {
              id: e.id,
              name: e.full_name,
              email: e.email,
              role: (mem?.role || "employee") as EmployeeUser["role"],
              workMode: e.work_mode || "remote",
              department: hasValidDept ? (deptName || "Unassigned") : "Unassigned",
              departmentId: hasValidDept ? (e.department_id || mem?.departmentId || "") : "",
              jobTitle: hasValidTitle ? (titleName || "") : "",
              jobTitleId: hasValidTitle ? (e.job_title_id || mem?.jobTitleId || "") : "",
              location: hasValidLoc ? (locName || "Unassigned") : "Unassigned",
              status: effectiveStatus,
              timezone: e.timezone || "UTC",
              shiftStartTime: mem?.shiftStartTime || (e.shift_start_time || "09:00:00").slice(0, 5),
              shiftEndTime: mem?.shiftEndTime || (e.shift_end_time || "17:00:00").slice(0, 5),
            };
          })
        );
      } else {
        setUsers(
          storedUsers.map((u) => {
            const hasValidDept =
              u.department &&
              u.department !== "Unassigned" &&
              (validDeptNames.has(u.department) || (u.departmentId && validDeptIds.has(u.departmentId)));
            const hasValidTitle =
              u.jobTitle &&
              u.jobTitle !== "Unassigned" &&
              (validTitleNames.has(u.jobTitle) || (u.jobTitleId && validTitleIds.has(u.jobTitleId)));
            const hasValidLoc =
              u.location &&
              u.location !== "Unassigned" &&
              validLocNames.has(u.location);
            return {
              id: u.id,
              name: u.name,
              email: u.email,
              role: u.role,
              workMode: u.workMode || "remote",
              department: hasValidDept ? u.department : "Unassigned",
              departmentId: hasValidDept ? (u.departmentId || "") : "",
              jobTitle: hasValidTitle ? (u.jobTitle || "") : "",
              jobTitleId: hasValidTitle ? (u.jobTitleId || "") : "",
              location: hasValidLoc ? u.location : "Unassigned",
              status: u.status === "inactive" ? ("inactive" as const) : ("active" as const),
              timezone: u.timezone || "UTC",
              shiftStartTime: u.shiftStartTime || "09:00",
              shiftEndTime: u.shiftEndTime || "17:00",
            };
          })
        );
      }
    } catch {
      // Keep UI clean
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    loadDirectory();
    const handleStorageChange = () => loadDirectory();
    window.addEventListener("remotehr_storage_change", handleStorageChange);
    return () => {
      window.removeEventListener("remotehr_storage_change", handleStorageChange);
    };
  }, [loadDirectory]);

  const handleOpenInvite = () => {
    setInviteEmail("");
    setInviteName("");
    setInviteRole("employee");
    setInviteJobTitleId("");
    setInviteDepartmentId("");
    setInviteWorkMode("remote");
    setInviteTimezone("Asia/Kolkata");
    setInviteShiftStart("09:00");
    setInviteShiftEnd("17:00");
    setInviteModalOpen(true);
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) {
      toast.error("Please enter email and full name.");
      return;
    }

    if (isDemoModeEnabled()) {
      const selectedJobTitleObj = jobTitlesList.find((j) => j.id === inviteJobTitleId);
      const selectedDeptObj = departmentsList.find((d) => d.id === inviteDepartmentId);
      const newUser = addStoredUser({
        name: inviteName,
        email: inviteEmail,
        role: inviteRole,
        workMode: inviteWorkMode as any,
        department: selectedDeptObj?.name || "Unassigned",
        departmentId: inviteDepartmentId || "",
        jobTitle: selectedJobTitleObj?.title_name || "Specialist",
        jobTitleId: inviteJobTitleId || "",
        location: "Remote",
        status: "active",
        timezone: inviteTimezone,
        shiftStartTime: inviteShiftStart,
        shiftEndTime: inviteShiftEnd,
      });

      // Also attempt backend invite for database persistence if connected
      fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          fullName: inviteName,
          role: inviteRole,
          jobTitleId: inviteJobTitleId || undefined,
          departmentId: inviteDepartmentId || undefined,
          workMode: inviteWorkMode,
          timezone: inviteTimezone,
          shiftStartTime: inviteShiftStart + ":00",
          shiftEndTime: inviteShiftEnd + ":00",
        }),
      }).catch(() => {});

      setUsers(getStoredUsers() as any);
      toast.success(`User ${inviteEmail} invited successfully! (demo session)`);
      setInviteModalOpen(false);
      setCreatedCredentials({
        email: inviteEmail,
        inviteLink: `${typeof window !== "undefined" ? window.location.origin : ""}/login?demo_invite=${encodeURIComponent(inviteEmail)}`,
        role: inviteRole,
        jobTitle: newUser.jobTitle,
        department: newUser.department,
        shift: `${inviteShiftStart} - ${inviteShiftEnd}`,
        emailSent: true,
        status: "pending",
      });
      setCredentialsModalOpen(true);
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/users/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: inviteEmail,
          fullName: inviteName,
          role: inviteRole,
          jobTitleId: inviteJobTitleId || undefined,
          departmentId: inviteDepartmentId || undefined,
          workMode: inviteWorkMode,
          timezone: inviteTimezone,
          shiftStartTime: inviteShiftStart + ":00",
          shiftEndTime: inviteShiftEnd + ":00",
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to invite employee");

      toast.success(
        data.emailSent
          ? `Invitation email dispatched via Resend!`
          : `User ${inviteEmail} invited successfully!`
      );
      setInviteModalOpen(false);

      if (data.inviteLink) {
        const selectedJobTitleObj = jobTitlesList.find((j) => j.id === inviteJobTitleId);
        const selectedDeptObj = departmentsList.find((d) => d.id === inviteDepartmentId);
        setCreatedCredentials({
          email: inviteEmail,
          inviteLink: data.inviteLink,
          role: inviteRole,
          jobTitle: selectedJobTitleObj?.title_name,
          department: selectedDeptObj?.name,
          shift: `${inviteShiftStart} - ${inviteShiftEnd}`,
          emailSent: Boolean(data.emailSent),
          status: "pending",
        });
        setCredentialsModalOpen(true);
      }

      await loadDirectory();
    } catch (err: any) {
      toast.error(err.message || "Failed to invite user");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenGovernance = (user: EmployeeUser) => {
    setSelectedUser(user);
    setGovRole(user.role || "employee");
    setGovWorkMode(user.workMode);
    setGovTimezone(user.timezone);
    setGovStatus(user.status === "active" ? "active" : "inactive");
    setGovShiftStart(user.shiftStartTime || "09:00");
    setGovShiftEnd(user.shiftEndTime || "17:00");
    setGovDepartmentId(user.departmentId || "");
    setGovJobTitleId(user.jobTitleId || "");
    setGovernanceModalOpen(true);
  };

  const handleSaveGovernance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;

    const selectedJobTitleObj = jobTitlesList.find((j) => j.id === govJobTitleId);
    const selectedDeptObj = departmentsList.find((d) => d.id === govDepartmentId);
    const effectiveDeptName = govDepartmentId && selectedDeptObj ? selectedDeptObj.name : "Unassigned";
    const effectiveJobTitleName = govJobTitleId && selectedJobTitleObj ? selectedJobTitleObj.title_name : "";

    setIsSubmitting(true);
    try {
      // 1. Authoritative server-side update across employees & organization_members
      const res = await fetch("/api/admin/users/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: selectedUser.id,
          departmentId: govDepartmentId || null,
          jobTitleId: govJobTitleId || null,
          role: govRole,
          workMode: govWorkMode,
          timezone: govTimezone,
          status: govStatus === "active" ? "active" : "inactive",
          shiftStartTime: govShiftStart,
          shiftEndTime: govShiftEnd,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update user governance");
      }

      // 2. Synchronize local store for instant reactive UI consistency
      updateStoredUser({
        id: selectedUser.id,
        name: selectedUser.name,
        email: selectedUser.email,
        role: govRole,
        workMode: govWorkMode as any,
        timezone: govTimezone,
        status: govStatus === "active" ? "active" : "inactive",
        shiftStartTime: govShiftStart,
        shiftEndTime: govShiftEnd,
        departmentId: govDepartmentId || "",
        department: effectiveDeptName,
        jobTitleId: govJobTitleId || "",
        jobTitle: effectiveJobTitleName,
        location: selectedUser.location,
      });

      window.dispatchEvent(new Event("remotehr_storage_change"));
      toast.success("Governance & role attributes updated successfully.");
      setGovernanceModalOpen(false);
      await loadDirectory();
    } catch (err: any) {
      toast.error(err.message || "Failed to update governance");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeRole = async (
    targetUserId: string,
    newRole: "employee" | "manager" | "hr" | "admin"
  ) => {
    try {
      const res = await fetch("/api/admin/users/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: targetUserId,
          role: newRole,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to update role");
      }

      const current = getStoredUsers();
      const target = current.find((u) => u.id === targetUserId);
      if (target) {
        updateStoredUser({ ...target, role: newRole });
      }
      window.dispatchEvent(new Event("remotehr_storage_change"));
      toast.success(`Role updated to ${newRole}.`);
      await loadDirectory();
    } catch (err: any) {
      toast.error(err?.message || "Failed to update role.");
    }
  };

  const handleDeactivate = async (user: EmployeeUser) => {
    if (
      !confirm(
        `Are you sure you want to deactivate ${user.name}? This will revoke active sessions and block authentication access.`
      )
    ) {
      return;
    }

    if (isDemoModeEnabled()) {
      const current = getStoredUsers();
      const target = current.find((u) => u.id === user.id);
      if (target) {
        updateStoredUser({
          ...target,
          status: target.status === "active" ? "inactive" : "active",
        });
        setUsers(getStoredUsers() as any);
      }
      toast.success(`${user.name} status updated.`);
      return;
    }

    try {
      const res = await fetch("/api/admin/users/deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to deactivate member");

      toast.success(`${user.name} has been deactivated.`);
      await loadDirectory();
    } catch (err: any) {
      toast.error(err.message || "Failed to deactivate");
    }
  };

  const handleDeleteUser = async (user: EmployeeUser) => {
    if (
      !confirm(
        `Are you sure you want to permanently delete ${user.name}? This will remove all their records from the system.`
      )
    ) {
      return;
    }

    deleteStoredUser(user.id);
    try {
      const res = await fetch("/api/admin/users/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete user from database");

      toast.success(`${user.name} permanently deleted.`);
      await loadDirectory();
    } catch (err: any) {
      toast.error(err.message || "Failed to delete user");
      await loadDirectory();
    }
  };

  const handleResetMFA = async (user: EmployeeUser) => {
    if (
      !confirm(
        `Reset TOTP MFA factors for ${user.name}? The user must re-enroll upon next privileged login.`
      )
    ) {
      return;
    }

    if (isDemoModeEnabled()) {
      toast.success(`MFA factors reset for ${user.name}. (demo session)`);
      return;
    }

    try {
      const res = await fetch("/api/admin/users/reset-mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset MFA");

      toast.success(`MFA factors reset for ${user.name}.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to reset MFA");
    }
  };

  const handleForceSignOut = async (user: EmployeeUser) => {
    if (isDemoModeEnabled()) {
      toast.success(`Active sessions revoked for ${user.name}. (demo session)`);
      return;
    }

    try {
      const res = await fetch("/api/admin/users/force-signout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetUserId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to force sign-out");

      toast.success(`Active sessions revoked for ${user.name}.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to force sign-out");
    }
  };

  const handleBulkPreviewOrCommit = async (dryRun: boolean) => {
    if (!csvText.trim()) {
      toast.error("Provide CSV rows first.");
      return;
    }
    setBulkLoading(true);
    try {
      const res = await fetch("/api/admin/users/bulk-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csvText, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Bulk import request failed");

      setBulkPreview(data as BulkImportPreviewResult);
      if (dryRun) {
        toast.info(
          `Preview ready: ${data.validCount ?? 0} valid, ${data.invalidCount ?? 0} with errors.`
        );
      } else {
        toast.success(
          `Imported ${data.importedCount ?? 0} employee(s)${data.failedCount ? ` (${data.failedCount} failed)` : ""
          }.`
        );
        await loadDirectory();
      }
    } catch (err: any) {
      toast.error(err?.message || "Bulk CSV import failed");
    } finally {
      setBulkLoading(false);
    }
  };

  const handleDownloadErrorCsv = () => {
    if (!bulkPreview?.errorCsv) return;
    const blob = new Blob([bulkPreview.errorCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `bulk-import-errors-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleCsvFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    setCsvText(text);
    setBulkPreview(null);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary tracking-tight">
            Workforce Directory & Governance
          </h1>
          <p className="text-xs sm:text-sm text-text-secondary mt-1">
            View tenant workforce roster{isAdmin ? ", invite new hires individually or via CSV, assign roles, and enforce security governance" : ""}.
          </p>
        </div>

        {isAdmin && (
          <div className="flex flex-wrap items-center gap-2.5">
            <button
              type="button"
              onClick={() => setJobTitlesManagerOpen(true)}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-card border border-border-light hover:bg-card-subtle text-text-primary text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <Briefcase className="w-4 h-4 text-brand-purple" />
              <span>Manage Company Titles</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setBulkPreview(null);
                setBulkModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-card border border-border-light hover:bg-card-subtle text-text-primary text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <FileSpreadsheet className="w-4 h-4 text-brand-purple" />
              <span>Bulk CSV Import</span>
            </button>

            <button
              type="button"
              onClick={handleOpenInvite}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold shadow-sm transition-all cursor-pointer"
            >
              <UserPlus className="w-4 h-4" />
              <span>Invite Member</span>
            </button>
          </div>
        )}
      </section>

      {/* Directory Table */}
      <div className="bg-card rounded-[28px] border border-border-light shadow-card overflow-hidden">
        {loading ? (
          <div className="p-6 space-y-3">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-14 rounded-2xl bg-card-subtle animate-pulse" />
            ))}
          </div>
        ) : users.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-card-subtle text-text-secondary font-semibold border-b border-border-light">
                <tr>
                  <th className="py-3.5 px-5">Member</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Company Title</th>
                  <th className="py-3.5 px-4">Department</th>
                  <th className="py-3.5 px-4">Location</th>
                  <th className="py-3.5 px-4">Timezone</th>
                  <th className="py-3.5 px-4">Shift</th>
                  <th className="py-3.5 px-4">Status</th>
                  {isAdmin && <th className="py-3.5 px-5 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {users.map((u) => {
                  const isSelf = u.id === userId;
                  return (
                    <tr key={u.id} className="hover:bg-card-subtle/50 transition-colors">
                      <td className="py-4 px-5">
                        <div>
                          <span className="font-bold text-text-primary block">{u.name}</span>
                          <span className="text-xs text-text-secondary flex items-center gap-1 mt-0.5">
                            <Mail className="w-3 h-3 text-text-tertiary" />
                            {u.email}
                          </span>
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        {isAdmin && !isSelf ? (
                          <select
                            aria-label={`Role for ${u.name}`}
                            value={u.role}
                            onChange={(e) => handleChangeRole(u.id, e.target.value as any)}
                            className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
                          >
                            <option value="employee">Employee</option>
                            <option value="manager">Manager</option>
                            <option value="hr">HR</option>
                            <option value="admin">Admin</option>
                          </select>
                        ) : (
                          <span className="uppercase text-[11px] font-bold px-2.5 py-1 rounded-full bg-brand-purple-light/40 text-brand-purple">
                            {u.role}
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs font-medium">
                        {u.jobTitle ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-brand-navy/10 text-brand-navy border border-brand-navy/20">
                            <Briefcase className="w-3 h-3 text-brand-purple" />
                            {u.jobTitle}
                          </span>
                        ) : (
                          <span className="text-text-tertiary text-xs italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs font-medium">
                        {u.department && u.department !== "Unassigned" ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-card-subtle border border-border-light text-text-primary">
                            <Building2 className="w-3 h-3 text-brand-purple" />
                            {u.department}
                          </span>
                        ) : (
                          <span className="text-text-tertiary text-xs italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs text-text-secondary font-medium">
                        {u.location && u.location !== "Unassigned" ? (
                          `${u.location} (${u.workMode})`
                        ) : (
                          <span className="text-text-tertiary text-xs italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs font-mono text-text-tertiary">
                        {u.timezone}
                      </td>
                      <td className="py-4 px-4">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold font-mono",
                            u.shiftEndTime < u.shiftStartTime
                              ? "bg-brand-purple/15 text-brand-purple border border-brand-purple/30"
                              : "bg-card-subtle text-text-secondary border border-border-light"
                          )}
                          title={
                            u.shiftEndTime < u.shiftStartTime
                              ? "Night Shift (crosses midnight)"
                              : "Day Shift"
                          }
                        >
                          {u.shiftEndTime < u.shiftStartTime ? "🌙 " : "☀️ "}
                          {u.shiftStartTime} - {u.shiftEndTime}
                        </span>
                      </td>
                      <td className="py-4 px-4">
                        <StatusPill status={u.status} />
                      </td>
                      {isAdmin && (
                        <td className="py-4 px-5 text-right space-x-1 whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenGovernance(u)}
                            title={`Edit governance for ${u.name}`}
                            aria-label={`Edit governance for ${u.name}`}
                            className="p-1.5 rounded-xl hover:bg-card-subtle text-text-secondary hover:text-brand-purple transition-colors cursor-pointer"
                          >
                            <Edit className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleResetMFA(u)}
                            title={`Reset MFA for ${u.name}`}
                            aria-label={`Reset MFA for ${u.name}`}
                            className="p-1.5 rounded-xl hover:bg-card-subtle text-text-secondary hover:text-status-warning-dot transition-colors cursor-pointer"
                          >
                            <KeyRound className="w-4 h-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleForceSignOut(u)}
                            title={`Force sign out ${u.name}`}
                            aria-label={`Force sign out ${u.name}`}
                            className="p-1.5 rounded-xl hover:bg-card-subtle text-text-secondary hover:text-brand-navy transition-colors cursor-pointer"
                          >
                            <LogOut className="w-4 h-4" />
                          </button>
                          {!isSelf && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleDeactivate(u)}
                                title={`Deactivate ${u.name}`}
                                aria-label={`Deactivate ${u.name}`}
                                className="p-1.5 rounded-xl hover:bg-status-danger-bg text-text-secondary hover:text-status-danger-text transition-colors cursor-pointer"
                              >
                                <UserX className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteUser(u)}
                                title={`Delete ${u.name}`}
                                aria-label={`Delete ${u.name}`}
                                className="p-1.5 rounded-xl hover:bg-status-danger-bg text-text-secondary hover:text-red-600 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            className="border-none shadow-none"
            icon={<Users className="w-6 h-6" />}
            title="No workforce members found"
            description="Invite an employee or bulk import a team roster via CSV."
          />
        )}
      </div>

      {/* Invite Modal */}
      <Modal
        open={inviteModalOpen}
        onOpenChange={setInviteModalOpen}
        title="Invite New Employee"
        description="Creates an Auth account and provisions organization membership in a single transaction"
      >
        <form onSubmit={handleSendInvite} className="space-y-3.5">
          <div>
            <label
              htmlFor="invite-full-name"
              className="text-xs font-bold text-text-secondary block mb-1"
            >
              Full Name
            </label>
            <input
              id="invite-full-name"
              type="text"
              required
              value={inviteName}
              onChange={(e) => setInviteName(e.target.value)}
              placeholder="Jane Doe"
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            />
          </div>

          <div>
            <label
              htmlFor="invite-email"
              className="text-xs font-bold text-text-secondary block mb-1"
            >
              Email Address
            </label>
            <input
              id="invite-email"
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="jane@company.com"
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label
                htmlFor="invite-department"
                className="text-xs font-bold text-text-secondary block mb-1"
              >
                1. Department <span className="text-status-danger">*</span>
              </label>
              <select
                id="invite-department"
                value={inviteDepartmentId}
                onChange={(e) => {
                  setInviteDepartmentId(e.target.value);
                  setInviteJobTitleId("");
                }}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus:ring-1 focus:ring-brand-purple"
              >
                <option value="">Select Department...</option>
                {departmentsList.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="invite-job-title"
                className="text-xs font-bold text-text-secondary block mb-1"
              >
                2. Department Role / Title
              </label>
              <select
                id="invite-job-title"
                value={inviteJobTitleId}
                onChange={(e) => setInviteJobTitleId(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus:ring-1 focus:ring-brand-purple"
              >
                <option value="">
                  {!inviteDepartmentId ? "Select Department first..." : "Select Role / Title..."}
                </option>
                {filteredInviteTitles.map((jt) => (
                  <option key={jt.id} value={jt.id}>
                    {jt.title_name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="invite-role"
                className="text-xs font-bold text-text-secondary block mb-1"
              >
                3. System Security Role
              </label>
              <select
                id="invite-role"
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as any)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
              >
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="hr">HR</option>
                <option value="admin">Admin</option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="invite-work-mode"
              className="text-xs font-bold text-text-secondary block mb-1"
            >
              Work Mode
            </label>
            <select
              id="invite-work-mode"
              value={inviteWorkMode}
              onChange={(e) => setInviteWorkMode(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            >
              <option value="remote">Remote</option>
              <option value="office">Office</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="invite-shift-start"
                className="text-xs font-bold text-text-secondary block mb-1 flex items-center gap-1"
              >
                <Clock className="w-3 h-3 text-brand-purple" />
                Shift Start
              </label>
              <input
                id="invite-shift-start"
                type="time"
                required
                value={inviteShiftStart}
                onChange={(e) => setInviteShiftStart(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
              />
            </div>

            <div>
              <label
                htmlFor="invite-shift-end"
                className="text-xs font-bold text-text-secondary block mb-1 flex items-center gap-1"
              >
                <Clock className="w-3 h-3 text-brand-purple" />
                Shift End
              </label>
              <input
                id="invite-shift-end"
                type="time"
                required
                value={inviteShiftEnd}
                onChange={(e) => setInviteShiftEnd(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
              />
            </div>
          </div>
          {inviteShiftEnd < inviteShiftStart && (
            <p className="text-[11px] text-brand-purple font-semibold flex items-center gap-1">
              <span>🌙 Night shift detected (crosses midnight, auto-checkout protected)</span>
            </p>
          )}

          <div>
            <label
              htmlFor="invite-timezone"
              className="text-xs font-bold text-text-secondary block mb-1"
            >
              IANA Timezone
            </label>
            <input
              id="invite-timezone"
              type="text"
              required
              value={inviteTimezone}
              onChange={(e) => setInviteTimezone(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            />
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setInviteModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? "Inviting..." : "Send Invitation"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Governance Modal */}
      <Modal
        open={governanceModalOpen && Boolean(selectedUser)}
        onOpenChange={setGovernanceModalOpen}
        title={selectedUser ? `Edit Governance: ${selectedUser.name}` : "Edit Governance"}
        description="Modifies HR/Admin-controlled schedule and work mode attributes"
      >
        <form onSubmit={handleSaveGovernance} className="space-y-3.5">
          <div>
            <label
              htmlFor="gov-work-mode"
              className="text-xs font-bold text-text-secondary block mb-1"
            >
              Work Mode
            </label>
            <select
              id="gov-work-mode"
              value={govWorkMode}
              onChange={(e) => setGovWorkMode(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            >
              <option value="remote">Remote</option>
              <option value="office">Office</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>

          <div>
            <label
              htmlFor="gov-timezone"
              className="text-xs font-bold text-text-secondary block mb-1"
            >
              IANA Timezone
            </label>
            <input
              id="gov-timezone"
              type="text"
              value={govTimezone}
              onChange={(e) => setGovTimezone(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="gov-shift-start"
                className="text-xs font-bold text-text-secondary block mb-1 flex items-center gap-1"
              >
                <Clock className="w-3 h-3 text-brand-purple" />
                Shift Start Time
              </label>
              <input
                id="gov-shift-start"
                type="time"
                required
                value={govShiftStart}
                onChange={(e) => setGovShiftStart(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
              />
            </div>

            <div>
              <label
                htmlFor="gov-shift-end"
                className="text-xs font-bold text-text-secondary block mb-1 flex items-center gap-1"
              >
                <Clock className="w-3 h-3 text-brand-purple" />
                Shift End Time
              </label>
              <input
                id="gov-shift-end"
                type="time"
                required
                value={govShiftEnd}
                onChange={(e) => setGovShiftEnd(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
              />
            </div>
          </div>
          {govShiftEnd < govShiftStart && (
            <p className="text-[11px] text-brand-purple font-semibold">
              🌙 Night Shift: Crosses midnight. 23:59 auto-checkout is skipped until scheduled morning end time.
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="gov-department"
                className="text-xs font-bold text-text-secondary block mb-1"
              >
                1. Department {isAdmin ? "(Admin Only)" : ""}
              </label>
              <select
                id="gov-department"
                disabled={!isAdmin}
                value={govDepartmentId}
                onChange={(e) => {
                  setGovDepartmentId(e.target.value);
                  setGovJobTitleId("");
                }}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary disabled:opacity-50"
              >
                <option value="">Unassigned</option>
                {departmentsList.map((dept) => (
                  <option key={dept.id} value={dept.id}>
                    {dept.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="gov-job-title"
                className="text-xs font-bold text-text-secondary block mb-1"
              >
                2. Department Role / Title {isAdmin ? "(Admin Only)" : ""}
              </label>
              <select
                id="gov-job-title"
                disabled={!isAdmin}
                value={govJobTitleId}
                onChange={(e) => setGovJobTitleId(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary disabled:opacity-50"
              >
                <option value="">Unassigned</option>
                {filteredGovTitles.map((jt) => (
                  <option key={jt.id} value={jt.id}>
                    {jt.title_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="gov-system-role"
                className="text-xs font-bold text-text-secondary block mb-1"
              >
                System Role {isAdmin ? "(Admin Only)" : ""}
              </label>
              <select
                id="gov-system-role"
                disabled={!isAdmin}
                value={govRole}
                onChange={(e) => setGovRole(e.target.value as any)}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary disabled:opacity-50"
              >
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
                <option value="hr">HR</option>
                <option value="admin">Admin</option>
              </select>
            </div>

            <div>
              <label
                htmlFor="gov-status"
                className="text-xs font-bold text-text-secondary block mb-1"
              >
                Employee Status
              </label>
              <select
                id="gov-status"
                value={govStatus}
                onChange={(e) => setGovStatus(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="pt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setGovernanceModalOpen(false)}
              className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary text-xs font-bold cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold shadow-sm transition-all disabled:opacity-50 cursor-pointer"
            >
              {isSubmitting ? "Saving..." : "Save Governance"}
            </button>
          </div>
        </form>
      </Modal>

      {/* Invitation Link & Resend Dispatch Modal */}
      <Modal
        open={credentialsModalOpen && Boolean(createdCredentials)}
        onOpenChange={(open) => {
          setCredentialsModalOpen(open);
          if (!open) setHasCopied(false);
        }}
        title="Employee Invitation Link Created"
        description="Single-use secure invitation link (24-hour expiry)"
      >
        <div className="space-y-4 pt-1">
          <div className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-text-secondary">Workplace Account:</span>
              <span className="font-bold text-text-primary">{createdCredentials?.email}</span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-text-secondary">Invitation Status:</span>
              <span className="font-bold uppercase text-brand-purple bg-brand-purple-light/40 px-2 py-0.5 rounded-full text-[10px]">
                {createdCredentials?.status || "Pending"}
              </span>
            </div>

            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-text-secondary">Assigned Role:</span>
              <span className="font-bold uppercase text-brand-purple bg-brand-purple-light/40 px-2 py-0.5 rounded-full text-[10px]">
                {createdCredentials?.role}
              </span>
            </div>

            {createdCredentials?.jobTitle && (
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-text-secondary">Company Job Title:</span>
                <span className="font-bold text-text-primary">{createdCredentials.jobTitle}</span>
              </div>
            )}

            {createdCredentials?.department && (
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-text-secondary">Department:</span>
                <span className="font-bold text-text-primary">{createdCredentials.department}</span>
              </div>
            )}

            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-text-secondary">Shift Schedule:</span>
              <span className="font-mono font-bold text-text-primary">{createdCredentials?.shift}</span>
            </div>

            <div className="pt-2 border-t border-border-light/60">
              <span className="block text-xs font-semibold text-text-secondary mb-1">
                Single-Use Invite Link (Expires in 24 hours):
              </span>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-card p-2.5 rounded-xl border border-border-light gap-2">
                <code className="text-xs font-mono font-bold text-brand-navy select-all break-all">
                  {createdCredentials?.inviteLink || (typeof window !== "undefined" ? `${window.location.origin}/login` : "/login")}
                </code>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    data-testid="copy-invite-link"
                    onClick={() => {
                      const link = createdCredentials?.inviteLink || (typeof window !== "undefined" ? `${window.location.origin}/login` : "/login");
                      navigator.clipboard.writeText(link);
                      setHasCopied(true);
                      toast.success("Invite link copied to clipboard!");
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold transition-all cursor-pointer"
                  >
                    {hasCopied ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Invite Link</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!createdCredentials?.email) return;
                      try {
                        const res = await fetch("/api/admin/users/invite", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            email: createdCredentials.email,
                            fullName: createdCredentials.email.split("@")[0],
                            role: createdCredentials.role,
                          }),
                        });
                        const data = await res.json();
                        if (res.ok && data.emailSent) {
                          toast.success("Invitation re-dispatched via Resend!");
                        } else {
                          toast.info("Invite refreshed. Copy the link below.");
                          if (data.inviteLink) {
                            setCreatedCredentials((prev) => prev ? { ...prev, inviteLink: data.inviteLink } : null);
                          }
                        }
                      } catch {
                        toast.error("Failed to resend invite.");
                      }
                    }}
                    className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-card border border-border-light hover:bg-card-subtle text-text-primary text-xs font-bold transition-all cursor-pointer"
                  >
                    <Send className="w-3.5 h-3.5 text-brand-purple" />
                    <span>Resend Invite</span>
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-brand-purple/10 border border-brand-purple/20 text-xs text-brand-purple flex items-start gap-2">
            <Send className="w-4 h-4 shrink-0 mt-0.5 text-brand-purple" />
            <div>
              <span className="font-bold block">Resend Email Status</span>
              <p className="text-[11px] text-text-secondary mt-0.5">
                {createdCredentials?.emailSent
                  ? "An invitation email has been delivered to the employee with secure password setup instructions."
                  : "Email delivery failed via Resend. The invitation link has been generated; please copy the link above and share it directly with the employee."}
              </p>
            </div>
          </div>

          <div className="pt-2 flex justify-end">
            <button
              type="button"
              onClick={() => setCredentialsModalOpen(false)}
              className="px-5 py-2.5 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold cursor-pointer transition-all shadow-sm"
            >
              Done
            </button>
          </div>
        </div>
      </Modal>

    {/* Admin Custom Company Job Titles Manager Modal */ }
    < JobTitlesManager
  open = { jobTitlesManagerOpen }
  onOpenChange = { setJobTitlesManagerOpen }
  onTitlesUpdated = { loadDirectory }
    />

    {/* Bulk CSV Import Modal */ }
    < Modal
  open = { bulkModalOpen }
  onOpenChange = { setBulkModalOpen }
  title = "Bulk CSV Employee Import"
  description = "Validate rows in dry-run preview, download formula-sanitized error reports, and commit valid invites"
  className = "max-w-2xl"
    >
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label
          htmlFor="bulk-csv-file"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-card-subtle hover:bg-card border border-border-light text-xs font-bold text-text-primary cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5 text-brand-purple" />
          <span>Upload .CSV File</span>
          <input
            id="bulk-csv-file"
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvFileUpload}
            className="hidden"
          />
        </label>

        <button
          type="button"
          onClick={() => {
            setCsvText(SAMPLE_BULK_CSV);
            setBulkPreview(null);
          }}
          className="text-xs font-bold text-brand-purple hover:underline cursor-pointer"
        >
          Load Sample CSV
        </button>
      </div>

      <div>
        <label
          htmlFor="bulk-csv-textarea"
          className="block text-xs font-bold text-text-primary mb-1"
        >
          CSV Data
        </label>
        <textarea
          id="bulk-csv-textarea"
          rows={5}
          value={csvText}
          onChange={(e) => {
            setCsvText(e.target.value);
            setBulkPreview(null);
          }}
          className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs font-mono text-text-primary"
        />
      </div>

      {/* Preview Results Table */}
      {bulkPreview && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 rounded-2xl bg-card-subtle border border-border-light text-xs">
            <span className="font-bold text-text-primary">
              {bulkPreview.dryRun ? "Validation Preview:" : "Import Summary:"}{" "}
              {bulkPreview.dryRun
                ? `${bulkPreview.validCount ?? 0} valid, ${bulkPreview.invalidCount ?? 0} error(s)`
                : `${bulkPreview.importedCount ?? 0} imported, ${bulkPreview.failedCount ?? 0} failed`}
            </span>
            {bulkPreview.errorCsv && (
              <button
                type="button"
                onClick={handleDownloadErrorCsv}
                className="inline-flex items-center gap-1 px-3 py-1 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-[11px] font-bold cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>Download Error CSV</span>
              </button>
            )}
          </div>

          <div className="max-h-48 overflow-y-auto border border-border-light rounded-2xl">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-card-subtle border-b border-border-light text-text-tertiary uppercase font-bold">
                <tr>
                  <th className="py-2 px-3">Row</th>
                  <th className="py-2 px-3">Email</th>
                  <th className="py-2 px-3">Name</th>
                  <th className="py-2 px-3">Role</th>
                  <th className="py-2 px-3">Validation</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light">
                {bulkPreview.rows.map((r) => (
                  <tr key={r.rowNumber}>
                    <td className="py-2 px-3 font-mono">{r.rowNumber}</td>
                    <td className="py-2 px-3 font-medium">{r.email || "--"}</td>
                    <td className="py-2 px-3">{r.fullName || "--"}</td>
                    <td className="py-2 px-3 uppercase">{r.role}</td>
                    <td className="py-2 px-3">
                      {r.valid ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600 font-bold">
                          <CheckCircle2 className="w-3 h-3" />
                          Ready
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-rose-600 font-bold">
                          <XCircle className="w-3 h-3 shrink-0" />
                          {r.errors.join("; ")}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="flex flex-wrap justify-end gap-2 pt-2">
        <button
          type="button"
          onClick={() => setBulkModalOpen(false)}
          className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary text-xs font-bold cursor-pointer"
        >
          Close
        </button>
        <button
          type="button"
          disabled={bulkLoading}
          onClick={() => handleBulkPreviewOrCommit(true)}
          className="px-4 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold cursor-pointer disabled:opacity-50"
        >
          {bulkLoading ? "Validating..." : "Validate Preview"}
        </button>
        {bulkPreview?.dryRun && (bulkPreview.validCount ?? 0) > 0 && (
          <button
            type="button"
            disabled={bulkLoading}
            onClick={() => handleBulkPreviewOrCommit(false)}
            className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-bold cursor-pointer disabled:opacity-50"
          >
            Import {bulkPreview.validCount} Employee(s)
          </button>
        )}
      </div>
    </div>
      </Modal >
    </div >
  );
}

export default function UsersDirectoryAdminPage() {
  return (
    <AppShell>
      <UsersDirectoryContent />
    </AppShell>
  );
}
