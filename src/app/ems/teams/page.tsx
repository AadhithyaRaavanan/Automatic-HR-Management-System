"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/features/ems/components/ems-navigation-header";
import { ConfirmDeleteModal } from "@/components/shared/confirm-delete-modal";
import {
  Network,
  Plus,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";

export default function EmsTeamsPage() {
  const router = useRouter();
  const { userRole, isLoaded } = useAppSession();
  const isAdmin = isLoaded && userRole === "admin";
  const [teams, setTeams] = React.useState<any[]>([]);
  const [departments, setDepartments] = React.useState<any[]>([]);
  const [employees, setEmployees] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [deptId, setDeptId] = React.useState("");
  const [teamLeadId, setTeamLeadId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Delete Team Modal State
  const [deleteTeamTarget, setDeleteTeamTarget] = React.useState<any | null>(null);
  const [deletingTeam, setDeletingTeam] = React.useState(false);

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, dRes, eRes] = await Promise.all([
        fetch("/api/ems/teams", { cache: "no-store" }),
        fetch("/api/admin/departments", { cache: "no-store" }),
        fetch("/api/employees", { cache: "no-store" }),
      ]);
      const tJson = await tRes.json();
      const dJson = await dRes.json();
      const eJson = await eRes.json();
      if (tJson.teams) setTeams(tJson.teams);
      if (dJson.departments) setDepartments(dJson.departments);
      if (eJson.employees) setEmployees(eJson.employees);
    } catch {
      toast.error("Failed to load team data");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/ems/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim() || name.slice(0, 3).toUpperCase(),
          departmentId: deptId || null,
          teamLeadId: teamLeadId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create team");
      toast.success("Team created successfully!");
      setModalOpen(false);
      setName("");
      setCode("");
      setDeptId("");
      setTeamLeadId("");
      await loadData();
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || "Failed to create team");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 w-full max-w-full min-w-0 overflow-x-hidden pb-12">
        <EmsNavigationHeader />

        {/* Toolbar */}
        <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-4 min-w-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-text-primary truncate">Team Management &amp; Team Leads</h2>
            <p className="text-xs text-text-secondary">
              Organize employees and interns into operational teams headed by appointed Team Leads.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-brand-purple text-white hover:bg-brand-purple/90 flex items-center gap-1.5 shadow-sm shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            New Team
          </button>
        </div>

        {/* Teams Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 min-w-0">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-3xl bg-card/40 border border-border-light animate-pulse min-w-0" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 min-w-0">
            {teams.map((team) => {
              const memberCount = team.team_members?.length || 0;
              return (
                <div
                  key={team.id}
                  className="p-5 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light hover:border-brand-purple/30 transition-all shadow-sm space-y-3 min-w-0 flex flex-col justify-between"
                >
                  <div className="space-y-3 min-w-0">
                    <div className="flex items-start justify-between gap-2 min-w-0">
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <div className="w-10 h-10 rounded-2xl bg-brand-cyan/10 border border-brand-cyan/20 flex items-center justify-center text-brand-cyan shrink-0">
                          <Network className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <h3 className="font-bold text-sm text-text-primary truncate" title={team.name}>
                            {team.name}
                          </h3>
                          <p className="text-[11px] font-mono text-brand-cyan font-medium truncate">
                            {team.code || "TEAM"}
                          </p>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-purple/10 text-brand-purple border border-brand-purple/20 shrink-0 truncate max-w-[120px]">
                        {team.departments?.name || "General"}
                      </span>
                    </div>

                    <div className="p-3.5 rounded-2xl bg-card-subtle text-xs space-y-2 border border-border-light/40 min-w-0">
                      <div className="flex justify-between items-center gap-2 min-w-0">
                        <span className="text-text-muted shrink-0">Appointed Team Lead:</span>
                        <span className="font-semibold text-text-primary truncate">
                          {team.team_lead?.full_name || "Vacant"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-text-muted">Assigned Members:</span>
                        <span className="font-mono font-bold text-brand-purple">
                          {memberCount} {memberCount === 1 ? "Member" : "Members"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {isAdmin && (
                    <div className="pt-2 border-t border-border-light/30 flex justify-end">
                      <button
                        type="button"
                        onClick={() => setDeleteTeamTarget(team)}
                        aria-label={`Delete team ${team.name}`}
                        className="px-3 py-1.5 rounded-xl bg-card border border-rose-200 hover:bg-rose-500/10 text-rose-600 text-[11px] font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Create Modal */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl bg-card border border-border-light p-6 shadow-2xl space-y-4">
              <h3 className="text-base font-bold text-text-primary">Create New Operational Team</h3>
              <form onSubmit={handleCreateTeam} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Team Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. SEO Core Engineering"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Team Code</label>
                  <input
                    type="text"
                    placeholder="e.g. SEO-ENG"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Assigned Department</label>
                  <select
                    value={deptId}
                    onChange={(e) => setDeptId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="">Select Department...</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Appointed Team Lead (Optional)</label>
                  <select
                    value={teamLeadId}
                    onChange={(e) => setTeamLeadId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="">Vacant (Assign Later)</option>
                    {employees.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.full_name} ({e.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary hover:text-text-primary"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-xl bg-brand-purple text-white font-semibold hover:bg-brand-purple/90"
                  >
                    {submitting ? "Saving..." : "Create Team"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <ConfirmDeleteModal
          open={Boolean(deleteTeamTarget)}
          title="Delete Team"
          itemName={deleteTeamTarget?.name || ""}
          itemMeta={
            deleteTeamTarget
              ? `${deleteTeamTarget.team_members?.length || 0} ${
                  (deleteTeamTarget.team_members?.length || 0) === 1 ? "member" : "members"
                } • ${deleteTeamTarget.departments?.name || "General"}`
              : null
          }
          description="Deleting this team permanently removes the team and clears its team membership links without deleting employee profiles."
          confirmLabel="Delete Team"
          deleting={deletingTeam}
          onClose={() => {
            if (!deletingTeam) setDeleteTeamTarget(null);
          }}
          onConfirm={async () => {
            if (!deleteTeamTarget) return;
            setDeletingTeam(true);
            try {
              const res = await fetch(
                `/api/ems/teams?id=${encodeURIComponent(deleteTeamTarget.id)}`,
                { method: "DELETE" }
              );
              const json = await res.json().catch(() => ({}));
              if (!res.ok || !json?.success) {
                throw new Error(json?.error || "Failed to delete team.");
              }
              toast.success(`Team '${deleteTeamTarget.name}' deleted.`);
              setTeams((prev) => prev.filter((t) => t.id !== deleteTeamTarget.id));
              setDeleteTeamTarget(null);
              await loadData();
              router.refresh();
            } catch (err: any) {
              toast.error(err?.message || "Failed to delete team.");
            } finally {
              setDeletingTeam(false);
            }
          }}
        />
      </div>
    </AppShell>
  );
}
