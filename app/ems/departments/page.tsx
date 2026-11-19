"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/components/ems/ems-navigation-header";
import {
  Building2,
  Plus,
  Edit,
  Trash2,
  Users,
  GitPullRequest,
  CheckCircle2,
  AlertCircle,
  Briefcase,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function EmsDepartmentsPage() {
  const [departments, setDepartments] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Modal State
  const [modalOpen, setModalOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const loadDepartments = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/departments");
      const json = await res.json();
      if (json.departments) {
        setDepartments(json.departments);
      }
    } catch {
      toast.error("Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/departments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          code: code.trim() || name.slice(0, 3).toUpperCase(),
          parentId: parentId || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create department");

      toast.success("Department created successfully!");
      setModalOpen(false);
      setName("");
      setCode("");
      setParentId("");
      await loadDepartments();
    } catch (err: any) {
      toast.error(err.message || "Failed to create department");
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
            <h2 className="text-base font-bold text-text-primary">Department Hierarchy Management</h2>
            <p className="text-xs text-text-secondary">
              Configure main departments (Sales, Tech, HR Consultancy, Digital Marketing) and child departments (SEO).
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-brand-purple text-white hover:bg-brand-purple/90 flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Department
          </button>
        </div>

        {/* Departments Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-40 rounded-3xl bg-card/40 border border-border-light animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((dept) => (
              <div
                key={dept.id}
                className="p-5 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light hover:border-brand-purple/30 transition-all shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-brand-purple/10 border border-brand-purple/20 flex items-center justify-center text-brand-purple">
                      <Building2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-text-primary">{dept.name}</h3>
                      <p className="text-[11px] font-mono text-brand-purple font-medium">{dept.code}</p>
                    </div>
                  </div>
                  {dept.parent_department_id ? (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-500 border border-cyan-500/20">
                      Child Subdept
                    </span>
                  ) : (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                      Main Dept
                    </span>
                  )}
                </div>

                <div className="p-3 rounded-2xl bg-card-subtle text-xs space-y-1.5 border border-border-light/40">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Department Head:</span>
                    <span className="font-semibold text-text-primary">
                      {dept.head?.full_name || (dept.name === "HR Consultancy" ? "Internal HR Manager" : "Vacant")}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Parent Tree:</span>
                    <span className="font-semibold text-text-primary">
                      {dept.parent?.name || "ZEN XEA Root"}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Modal */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl bg-card border border-border-light p-6 shadow-2xl space-y-4">
              <h3 className="text-base font-bold text-text-primary">Create New Department</h3>
              <form onSubmit={handleCreate} className="space-y-3 text-xs">
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Department Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Quality Assurance"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                    required
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Department Code</label>
                  <input
                    type="text"
                    placeholder="e.g. QA"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary uppercase"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Parent Department (Optional)</label>
                  <select
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary"
                  >
                    <option value="">None (Top-Level Main Department)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
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
                    {submitting ? "Saving..." : "Create Department"}
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
