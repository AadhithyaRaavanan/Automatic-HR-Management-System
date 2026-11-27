"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/features/ems/components/ems-navigation-header";
import {
  Network,
  Plus,
  Users,
  Building2,
  Shield,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function EmsTeamsPage() {
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

  const loadData = React.useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, dRes, eRes] = await Promise.all([
        fetch("/api/ems/teams"),
        fetch("/api/admin/departments"),
        fetch("/api/employees"),
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
    } catch (err: any) {
      toast.error(err.message || "Failed to create team");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <EmsNavigationHeader />

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-text-primary">Team Management & Team Leads</h2>
            <p className="text-xs text-text-secondary">
              Organize employees and interns into operational teams headed by appointed Team Leads.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-brand-purple text-white hover:bg-brand-purple/90 flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Team
          </button>
        </div>

        {/* Teams Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-3xl bg-card/40 border border-border-light animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {teams.map((team) => (
              <div
                key={team.id}
                className="p-5 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light hover:border-brand-purple/30 transition-all shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-brand-cyan/10 border border-brand-cyan/20 flex items-center justify-center text-brand-cyan">
                      <Network className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-text-primary">{team.name}</h3>
                      <p className="text-[11px] font-mono text-brand-cyan font-medium">{team.code || "TEAM"}</p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-brand-purple/10 text-brand-purple border border-brand-purple/20">
                    {team.departments?.name || "General"}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-card-subtle text-xs space-y-2 border border-border-light/40">
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Appointed Team Lead:</span>
                    <span className="font-semibold text-text-primary">
                      {team.team_lead?.full_name || "Vacant"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-text-muted">Assigned Members:</span>
                    <span className="font-mono font-bold text-brand-purple">
                      {team.team_members?.length || 0} Members
                    </span>
                  </div>
                </div>
              </div>
            ))}
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
      </div>
    </AppShell>
  );
}
