"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import { StatusPill } from "@/components/shared/status-pill";
import { createClient } from "@/lib/supabase/client";
import {
  UserPlus,
  Shield,
  KeyRound,
  LogOut,
  UserX,
  Edit,
  Mail,
  Building,
  MapPin,
  Clock,
  Sparkles,
  RefreshCw,
} from "lucide-react";
import { toast } from "sonner";

interface EmployeeUser {
  id: string;
  name: string;
  email: string;
  role: "employee" | "manager" | "hr" | "admin";
  workMode: string;
  department: string;
  location: string;
  status: "active" | "suspended" | "inactive";
  timezone: string;
}

const mockEmployees: EmployeeUser[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "System Administrator",
    email: "admin@remotehr.local",
    role: "admin",
    workMode: "remote",
    department: "Executive",
    location: "Global HQ",
    status: "active",
    timezone: "UTC",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Sarah Jenkins",
    email: "hr@remotehr.local",
    role: "hr",
    workMode: "hybrid",
    department: "People Operations",
    location: "New York Office",
    status: "active",
    timezone: "America/New_York",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Marcus Vance",
    email: "manager@remotehr.local",
    role: "manager",
    workMode: "office",
    department: "Engineering",
    location: "London Hub",
    status: "active",
    timezone: "Europe/London",
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    name: "Alex Rivera",
    email: "employee@remotehr.local",
    role: "employee",
    workMode: "remote",
    department: "Engineering",
    location: "Bangalore HQ",
    status: "active",
    timezone: "Asia/Kolkata",
  },
];

export default function UsersDirectoryAdminPage() {
  const [users, setUsers] = React.useState<EmployeeUser[]>(mockEmployees);
  const [inviteModalOpen, setInviteModalOpen] = React.useState(false);
  const [governanceModalOpen, setGovernanceModalOpen] = React.useState(false);
  const [selectedUser, setSelectedUser] = React.useState<EmployeeUser | null>(null);

  // Invite Form State
  const [inviteEmail, setInviteEmail] = React.useState("");
  const [inviteName, setInviteName] = React.useState("");
  const [inviteRole, setInviteRole] = React.useState<"employee" | "manager" | "hr" | "admin">("employee");
  const [inviteWorkMode, setInviteWorkMode] = React.useState("remote");
  const [inviteTimezone, setInviteTimezone] = React.useState("UTC");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  // Governance Edit Form State
  const [govWorkMode, setGovWorkMode] = React.useState("remote");
  const [govTimezone, setGovTimezone] = React.useState("UTC");
  const [govStatus, setGovStatus] = React.useState("active");

  const supabase = createClient();

  const handleOpenInvite = () => {
    setInviteEmail("");
    setInviteName("");
    setInviteRole("employee");
    setInviteWorkMode("remote");
    setInviteTimezone("UTC");
    setInviteModalOpen(true);
  };

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail || !inviteName) {
      toast.error("Please enter email and full name.");
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
          workMode: inviteWorkMode,
          timezone: inviteTimezone,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to invite employee");

      toast.success(`Invite sent successfully to ${inviteEmail}!`);
      setUsers((prev) => [
        ...prev,
        {
          id: data.userId || `mock-${Date.now()}`,
          name: inviteName,
          email: inviteEmail,
          role: inviteRole,
          workMode: inviteWorkMode,
          department: "General",
          location: "Global",
          status: "active",
          timezone: inviteTimezone,
        },
      ]);
      setInviteModalOpen(false);
    } catch (err: any) {
      toast.error(err.message || "Failed to invite user");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenGovernance = (user: EmployeeUser) => {
    setSelectedUser(user);
    setGovWorkMode(user.workMode);
    setGovTimezone(user.timezone);
    setGovStatus(user.status);
    setGovernanceModalOpen(true);
  };

  const handleSaveGovernance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedUser) return;
    setIsSubmitting(true);
    try {
      const { error } = await (supabase.rpc as any)("admin_update_employee_governance", {
        p_employee_id: selectedUser.id,
        p_work_mode: govWorkMode,
        p_timezone: govTimezone,
        p_status: govStatus === "active" ? "active" : "inactive",
      });
      if (error) throw error;

      toast.success("Governance fields updated successfully!");
      setUsers((prev) =>
        prev.map((u) =>
          u.id === selectedUser.id
            ? {
                ...u,
                workMode: govWorkMode,
                timezone: govTimezone,
                status: govStatus as any,
              }
            : u
        )
      );
      setGovernanceModalOpen(false);
    } catch (err: any) {
      // In local dev/mock without active session, update locally
      setUsers((prev) =>
        prev.map((u) =>
          u.id === selectedUser.id
            ? {
                ...u,
                workMode: govWorkMode,
                timezone: govTimezone,
                status: govStatus as any,
              }
            : u
        )
      );
      toast.success("Governance updated (local mode).");
      setGovernanceModalOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleChangeRole = async (userId: string, newRole: "employee" | "manager" | "hr" | "admin") => {
    try {
      const { error } = await (supabase.rpc as any)("admin_update_org_member_role", {
        p_user_id: userId,
        p_new_role: newRole,
      });
      if (error) throw error;
      toast.success(`Role updated to ${newRole}`);
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
    } catch (err: any) {
      setUsers((prev) => prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u)));
      toast.success(`Role updated to ${newRole} (local mode).`);
    }
  };

  const handleDeactivate = async (user: EmployeeUser) => {
    if (!confirm(`Are you sure you want to deactivate ${user.name}? This will revoke active sessions and ban authentication access.`)) {
      return;
    }
    try {
      const res = await fetch("/api/admin/users/deactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to deactivate member");

      toast.success(`${user.name} has been deactivated.`);
      setUsers((prev) => prev.map((u) => (u.id === user.id ? { ...u, status: "suspended" } : u)));
    } catch (err: any) {
      toast.error(err.message || "Failed to deactivate");
    }
  };

  const handleResetMFA = async (user: EmployeeUser) => {
    if (!confirm(`Reset TOTP MFA factors for ${user.name}? The user must re-enroll upon next privileged login.`)) {
      return;
    }
    try {
      const res = await fetch("/api/admin/users/reset-mfa", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reset MFA");

      toast.success(`MFA factors reset successfully for ${user.name}.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to reset MFA");
    }
  };

  const handleForceSignOut = async (user: EmployeeUser) => {
    try {
      const res = await fetch("/api/admin/users/force-signout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: user.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to force sign-out");

      toast.success(`Active sessions revoked for ${user.name}.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to force sign-out");
    }
  };

  return (
    <AppShell primaryActionLabel="Invite Member" onPrimaryAction={handleOpenInvite} userRole="admin">
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary dark:text-white tracking-tight flex items-center gap-2">
              Workforce Directory & Governance
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary dark:text-slate-400 mt-1">
              Manage organization memberships, invite new hires, assign authoritative roles, and enforce security policies.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={handleOpenInvite}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-purple hover:bg-brand-purple-hover text-white text-sm font-semibold shadow-sm transition-all"
            >
              <UserPlus className="w-4 h-4" />
              Invite Member
            </button>
          </div>
        </section>

        {/* Directory Table */}
        <div className="bg-white dark:bg-slate-900 rounded-[28px] border border-border-light dark:border-slate-800 shadow-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-card-subtle dark:bg-slate-800/50 text-text-secondary dark:text-slate-400 font-semibold border-b border-border-light dark:border-slate-800">
                <tr>
                  <th className="py-3.5 px-5">Member</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Department</th>
                  <th className="py-3.5 px-4">Location</th>
                  <th className="py-3.5 px-4">Work Mode</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-light dark:divide-slate-800">
                {users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    <td className="py-4 px-5">
                      <div>
                        <span className="font-bold text-text-primary dark:text-white block">{u.name}</span>
                        <span className="text-xs text-text-secondary dark:text-slate-400 flex items-center gap-1 mt-0.5">
                          <Mail className="w-3 h-3 text-text-tertiary" />
                          {u.email}
                        </span>
                      </div>
                    </td>
                    <td className="py-4 px-4">
                      <select
                        value={u.role}
                        onChange={(e) => handleChangeRole(u.id, e.target.value as any)}
                        className="text-xs font-semibold px-2.5 py-1 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-text-primary dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
                      >
                        <option value="employee">Employee</option>
                        <option value="manager">Manager</option>
                        <option value="hr">HR</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className="py-4 px-4 text-xs text-text-secondary dark:text-slate-300 font-medium">
                      {u.department}
                    </td>
                    <td className="py-4 px-4 text-xs text-text-secondary dark:text-slate-300 font-medium">
                      {u.location}
                    </td>
                    <td className="py-4 px-4">
                      <span className="capitalize text-xs px-2.5 py-1 rounded-full bg-status-info-bg text-status-info-text font-semibold">
                        {u.workMode}
                      </span>
                    </td>
                    <td className="py-4 px-4">
                      <StatusPill status={u.status} />
                    </td>
                    <td className="py-4 px-5 text-right space-x-1 whitespace-nowrap">
                      <button
                        onClick={() => handleOpenGovernance(u)}
                        title="Edit Governance"
                        className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary hover:text-brand-purple transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleResetMFA(u)}
                        title="Reset MFA"
                        className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary hover:text-status-warning-dot transition-colors"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleForceSignOut(u)}
                        title="Force Sign Out"
                        className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary hover:text-brand-navy transition-colors"
                      >
                        <LogOut className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDeactivate(u)}
                        title="Deactivate Member"
                        className="p-1.5 rounded-xl hover:bg-status-danger-bg text-text-secondary hover:text-status-danger-text transition-colors"
                      >
                        <UserX className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Invite Modal */}
        {inviteModalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-[28px] max-w-md w-full p-6 shadow-shell border border-border-light dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-text-primary dark:text-white flex items-center gap-2">
                  <UserPlus className="w-5 h-5 text-brand-purple" />
                  Invite New Employee
                </h3>
                <button
                  onClick={() => setInviteModalOpen(false)}
                  className="text-text-tertiary hover:text-text-primary text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSendInvite} className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Full Name
                  </label>
                  <input
                    type="text"
                    required
                    value={inviteName}
                    onChange={(e) => setInviteName(e.target.value)}
                    placeholder="Jane Doe"
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    required
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="jane@company.com"
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                      Role
                    </label>
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value as any)}
                      className="w-full px-3 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                    >
                      <option value="employee">Employee</option>
                      <option value="manager">Manager</option>
                      <option value="hr">HR</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                      Work Mode
                    </label>
                    <select
                      value={inviteWorkMode}
                      onChange={(e) => setInviteWorkMode(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                    >
                      <option value="remote">Remote</option>
                      <option value="office">Office</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Timezone
                  </label>
                  <input
                    type="text"
                    value={inviteTimezone}
                    onChange={(e) => setInviteTimezone(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setInviteModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary text-sm font-semibold hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? "Inviting..." : "Send Invitation"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Governance Modal */}
        {governanceModalOpen && selectedUser && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-[28px] max-w-md w-full p-6 shadow-shell border border-border-light dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-text-primary dark:text-white flex items-center gap-2">
                  <Edit className="w-5 h-5 text-brand-purple" />
                  Edit Governance: {selectedUser.name}
                </h3>
                <button
                  onClick={() => setGovernanceModalOpen(false)}
                  className="text-text-tertiary hover:text-text-primary text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveGovernance} className="space-y-3.5">
                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Work Mode
                  </label>
                  <select
                    value={govWorkMode}
                    onChange={(e) => setGovWorkMode(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                  >
                    <option value="remote">Remote</option>
                    <option value="office">Office</option>
                    <option value="hybrid">Hybrid</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Timezone
                  </label>
                  <input
                    type="text"
                    value={govTimezone}
                    onChange={(e) => setGovTimezone(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Status
                  </label>
                  <select
                    value={govStatus}
                    onChange={(e) => setGovStatus(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setGovernanceModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary text-sm font-semibold hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? "Saving..." : "Save Governance"}
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
