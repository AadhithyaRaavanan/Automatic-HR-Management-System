"use client";

import * as React from "react";
import { Briefcase, Plus, Edit2, Trash2, Check, X, Loader2, Building2, Filter } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import {
  getStoredJobTitles,
  saveStoredJobTitles,
  addStoredJobTitle,
  deleteStoredJobTitle,
  getStoredDepartments,
  type DemoJobTitle,
} from "@/lib/storage/demo-store";

export type JobTitleItem = DemoJobTitle;

interface DepartmentSummary {
  id: string;
  name: string;
  code: string;
}

interface JobTitlesManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTitlesUpdated?: () => void;
  defaultDepartmentId?: string;
}

export function JobTitlesManager({
  open,
  onOpenChange,
  onTitlesUpdated,
  defaultDepartmentId,
}: JobTitlesManagerProps) {
  const [titles, setTitles] = React.useState<JobTitleItem[]>(() => getStoredJobTitles());
  const [departments, setDepartments] = React.useState<DepartmentSummary[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // Form states for new title
  const [newTitleName, setNewTitleName] = React.useState("");
  const [newDescription, setNewDescription] = React.useState("");
  const [newDepartmentId, setNewDepartmentId] = React.useState<string>(defaultDepartmentId || "");

  // Filter state
  const [selectedDeptFilter, setSelectedDeptFilter] = React.useState<string>(defaultDepartmentId || "ALL");

  // Edit states
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitleName, setEditTitleName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");
  const [editDepartmentId, setEditDepartmentId] = React.useState<string>("");

  React.useEffect(() => {
    if (defaultDepartmentId) {
      setNewDepartmentId(defaultDepartmentId);
      setSelectedDeptFilter(defaultDepartmentId);
    }
  }, [defaultDepartmentId]);

  const loadDepartments = React.useCallback(async () => {
    try {
      const res = await fetch("/api/admin/departments");
      const data = await res.json();
      if (res.ok && data.departments && data.departments.length > 0) {
        setDepartments(data.departments);
      } else {
        const stored = getStoredDepartments();
        setDepartments(stored.map((d) => ({ id: d.id, name: d.name, code: d.code })));
      }
    } catch {
      const stored = getStoredDepartments();
      setDepartments(stored.map((d) => ({ id: d.id, name: d.name, code: d.code })));
    }
  }, []);

  const loadTitles = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/job-titles");
      const data = await res.json();
      if (res.ok && data.titles && data.titles.length > 0) {
        const mapped = data.titles.map((t: any) => ({
          id: t.id,
          title_name: t.title_name,
          description: t.description || null,
          department_id: t.department_id || null,
          department_name: t.departments?.name || null,
          created_at: t.created_at,
        }));
        setTitles(mapped);
        saveStoredJobTitles(mapped);
      } else {
        setTitles(getStoredJobTitles());
      }
    } catch {
      setTitles(getStoredJobTitles());
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      loadDepartments();
      loadTitles();
    }
  }, [open, loadDepartments, loadTitles]);

  const handleCreateTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitleName.trim()) {
      toast.error("Please enter a title name.");
      return;
    }

    const trimmedName = newTitleName.trim();
    const trimmedDesc = newDescription.trim() || null;
    const selectedDept = departments.find((d) => d.id === newDepartmentId);

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/job-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleName: trimmedName,
          description: trimmedDesc,
          departmentId: newDepartmentId || null,
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to create job title");
      }

      const created: JobTitleItem = {
        id: data.jobTitle?.id || `jt-${Date.now()}`,
        title_name: trimmedName,
        description: trimmedDesc,
        department_id: newDepartmentId || null,
        department_name: selectedDept ? selectedDept.name : null,
        created_at: new Date().toISOString(),
      };

      setTitles((prev) => [created, ...prev.filter((t) => t.id !== created.id)]);
      if (newDepartmentId) {
        setSelectedDeptFilter(newDepartmentId);
      }
      addStoredJobTitle(trimmedName, trimmedDesc, newDepartmentId || null, selectedDept ? selectedDept.name : null, created.id);
      toast.success(`Role '${trimmedName}' added successfully under ${selectedDept ? selectedDept.name : "Company"}.`);
      setNewTitleName("");
      setNewDescription("");
      onTitlesUpdated?.();
    } catch (err: any) {
      toast.error(err.message || "Failed to create role");
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (t: JobTitleItem) => {
    setEditingId(t.id);
    setEditTitleName(t.title_name);
    setEditDescription(t.description || "");
    setEditDepartmentId(t.department_id || "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitleName("");
    setEditDescription("");
    setEditDepartmentId("");
  };

  const handleSaveEdit = async (id: string) => {
    if (!editTitleName.trim()) {
      toast.error("Title name cannot be empty.");
      return;
    }

    const trimmedName = editTitleName.trim();
    const trimmedDesc = editDescription.trim() || null;
    const selectedDept = departments.find((d) => d.id === editDepartmentId);

    const nextList = titles.map((t) =>
      t.id === id
        ? {
            ...t,
            title_name: trimmedName,
            description: trimmedDesc,
            department_id: editDepartmentId || null,
            department_name: selectedDept ? selectedDept.name : null,
          }
        : t
    );
    setTitles(nextList);
    saveStoredJobTitles(nextList);
    toast.success("Job title updated successfully.");
    handleCancelEdit();
    onTitlesUpdated?.();

    try {
      await fetch("/api/admin/job-titles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          titleName: trimmedName,
          description: trimmedDesc,
          departmentId: editDepartmentId || null,
        }),
      });
    } catch {}
  };

  const handleDelete = async (t: JobTitleItem) => {
    if (!confirm(`Are you sure you want to delete the job title '${t.title_name}'?`)) {
      return;
    }

    deleteStoredJobTitle(t.id);
    setTitles((prev) => prev.filter((item) => item.id !== t.id));
    toast.success(`Job title '${t.title_name}' deleted.`);
    onTitlesUpdated?.();

    try {
      await fetch(`/api/admin/job-titles?id=${t.id}`, {
        method: "DELETE",
      });
    } catch {}
  };

  const filteredTitles = React.useMemo(() => {
    if (selectedDeptFilter === "ALL") return titles;
    return titles.filter((t) => t.department_id === selectedDeptFilter);
  }, [titles, selectedDeptFilter]);

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Department Roles & Job Titles Hierarchy"
      description="Create and assign custom roles directly inside departments (e.g., Engineering → Full Stack Developer, Marketing → SEO Analyst) to maintain clear organizational hierarchy."
    >
      <div className="space-y-6">
        {/* Create Title Form */}
        <form onSubmit={handleCreateTitle} className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-text-primary uppercase tracking-wider">
            <Briefcase className="w-4 h-4 text-brand-purple" />
            <span>Create Role Inside Department</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label htmlFor="job-title-dept" className="text-xs font-semibold text-text-secondary block mb-1">
                Parent Department <span className="text-status-danger">*</span>
              </label>
              <select
                id="job-title-dept"
                value={newDepartmentId}
                onChange={(e) => {
                  setNewDepartmentId(e.target.value);
                  if (selectedDeptFilter !== "ALL") setSelectedDeptFilter(e.target.value || "ALL");
                }}
                className="w-full px-3 py-2 rounded-xl bg-card border border-border-light text-xs text-text-primary focus:outline-none focus:ring-1 focus:ring-brand-purple"
              >
                <option value="">General / Company-Wide</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="job-title-name" className="text-xs font-semibold text-text-secondary block mb-1">
                Role / Title Name <span className="text-status-danger">*</span>
              </label>
              <input
                id="job-title-name"
                type="text"
                required
                placeholder="e.g. Frontend Developer, QA Specialist"
                value={newTitleName}
                onChange={(e) => setNewTitleName(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card border border-border-light text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand-purple"
              />
            </div>

            <div>
              <label htmlFor="job-title-desc" className="text-xs font-semibold text-text-secondary block mb-1">
                Description (Optional)
              </label>
              <input
                id="job-title-desc"
                type="text"
                placeholder="Role responsibilities"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl bg-card border border-border-light text-xs text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-1 focus:ring-brand-purple"
              />
            </div>
          </div>

          <div className="flex justify-end pt-1">
            <button
              type="submit"
              disabled={submitting || !newTitleName.trim()}
              className="px-4 py-2 rounded-xl bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Creating Role...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Role to Department</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Existing Job Titles Table */}
        <div>
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-2 px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Defined Roles ({filteredTitles.length})
            </span>

            {/* Department Filter Selector */}
            <div className="flex items-center gap-2">
              <Filter className="w-3.5 h-3.5 text-text-tertiary" />
              <select
                value={selectedDeptFilter}
                onChange={(e) => setSelectedDeptFilter(e.target.value)}
                className="px-2.5 py-1 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus:outline-none"
              >
                <option value="ALL">All Departments ({titles.length})</option>
                {departments.map((d) => {
                  const cnt = titles.filter((t) => t.department_id === d.id).length;
                  return (
                    <option key={d.id} value={d.id}>
                      {d.name} ({cnt})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          <div className="border border-border-light rounded-2xl overflow-hidden bg-card max-h-[300px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-xs text-text-tertiary flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-purple" />
                <span>Loading company roles...</span>
              </div>
            ) : filteredTitles.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-secondary">
                No roles found for the selected department. Use the form above to add one.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-card-subtle text-text-secondary font-semibold border-b border-border-light sticky top-0">
                  <tr>
                    <th className="py-2.5 px-4">Role / Title</th>
                    <th className="py-2.5 px-4">Department</th>
                    <th className="py-2.5 px-4">Description</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {filteredTitles.map((t) => {
                    const isEditing = editingId === t.id;
                    const deptObj = departments.find((d) => d.id === (isEditing ? editDepartmentId : t.department_id));

                    return (
                      <tr key={t.id} className="hover:bg-card-subtle/50 transition-colors">
                        <td className="py-2.5 px-4 font-semibold text-text-primary">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editTitleName}
                              onChange={(e) => setEditTitleName(e.target.value)}
                              className="px-2 py-1 rounded-lg bg-card-subtle border border-brand-purple text-xs text-text-primary w-full"
                              autoFocus
                            />
                          ) : (
                            <div className="flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-brand-purple" />
                              <span>{t.title_name}</span>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-4">
                          {isEditing ? (
                            <select
                              value={editDepartmentId}
                              onChange={(e) => setEditDepartmentId(e.target.value)}
                              className="px-2 py-1 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary w-full"
                            >
                              <option value="">Company-Wide</option>
                              {departments.map((d) => (
                                <option key={d.id} value={d.id}>
                                  {d.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-brand-purple/10 text-brand-purple font-medium text-[11px]">
                              <Building2 className="w-3 h-3" />
                              {deptObj?.name || t.department_name || "Company-Wide"}
                            </span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-text-secondary">
                          {isEditing ? (
                            <input
                              type="text"
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              placeholder="Description"
                              className="px-2 py-1 rounded-lg bg-card-subtle border border-border-light text-xs text-text-primary w-full"
                            />
                          ) : (
                            t.description || "—"
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right">
                          {isEditing ? (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(t.id)}
                                className="p-1 rounded-md text-status-success hover:bg-status-success-bg transition-colors"
                                title="Save"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                className="p-1 rounded-md text-text-tertiary hover:bg-card-subtle transition-colors"
                                title="Cancel"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center justify-end gap-1">
                              <button
                                type="button"
                                onClick={() => handleStartEdit(t)}
                                className="p-1 rounded-md text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors"
                                title="Edit"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(t)}
                                className="p-1 rounded-md text-text-tertiary hover:text-status-danger hover:bg-status-danger-bg transition-colors"
                                title="Delete"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
