"use client";

import * as React from "react";
import { Briefcase, Plus, Edit2, Trash2, Check, X, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { isDemoModeEnabled } from "@/lib/config/demo";

export interface JobTitleItem {
  id: string;
  title_name: string;
  description: string | null;
  created_at: string;
}

const defaultMockJobTitles: JobTitleItem[] = [
  { id: "jt-1", title_name: "Staff Software Engineer", description: "Technical leader", created_at: "2026-01-01" },
  { id: "jt-2", title_name: "Frontend Engineer", description: "UI/UX implementation", created_at: "2026-01-01" },
  { id: "jt-3", title_name: "HR Operations Specialist", description: "People operations", created_at: "2026-01-01" },
  { id: "jt-4", title_name: "Product Manager", description: "Product roadmap", created_at: "2026-01-01" },
];

interface JobTitlesManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onTitlesUpdated?: () => void;
}

export function JobTitlesManager({
  open,
  onOpenChange,
  onTitlesUpdated,
}: JobTitlesManagerProps) {
  const [titles, setTitles] = React.useState<JobTitleItem[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [submitting, setSubmitting] = React.useState(false);

  // Form states for new title
  const [newTitleName, setNewTitleName] = React.useState("");
  const [newDescription, setNewDescription] = React.useState("");

  // Edit states
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [editTitleName, setEditTitleName] = React.useState("");
  const [editDescription, setEditDescription] = React.useState("");

  const loadTitles = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/job-titles");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load job titles");
      const loaded = data.titles && data.titles.length > 0 ? data.titles : (isDemoModeEnabled() ? defaultMockJobTitles : []);
      setTitles(loaded);
    } catch (err: any) {
      if (isDemoModeEnabled()) {
        const stored = typeof window !== "undefined" ? localStorage.getItem("remotehr_demo_job_titles") : null;
        setTitles(stored ? JSON.parse(stored) : defaultMockJobTitles);
      } else {
        toast.error(err.message || "Failed to load job titles");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    if (open) {
      loadTitles();
    }
  }, [open, loadTitles]);

  const handleCreateTitle = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitleName.trim()) {
      toast.error("Please enter a title name.");
      return;
    }

    if (isDemoModeEnabled()) {
      const newTitle: JobTitleItem = {
        id: `jt-${Date.now()}`,
        title_name: newTitleName.trim(),
        description: newDescription.trim() || null,
        created_at: new Date().toISOString(),
      };
      setTitles((prev) => {
        const next = [newTitle, ...prev];
        if (typeof window !== "undefined") {
          try { localStorage.setItem("remotehr_demo_job_titles", JSON.stringify(next)); } catch {}
        }
        return next;
      });
      toast.success(`Job title '${newTitleName}' created successfully.`);
      setNewTitleName("");
      setNewDescription("");
      onTitlesUpdated?.();
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/job-titles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          titleName: newTitleName.trim(),
          description: newDescription.trim() || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to create job title");

      toast.success(`Job title '${newTitleName}' created successfully.`);
      setNewTitleName("");
      setNewDescription("");
      await loadTitles();
      onTitlesUpdated?.();
    } catch (err: any) {
      if (isDemoModeEnabled()) {
        const newTitle: JobTitleItem = {
          id: `jt-${Date.now()}`,
          title_name: newTitleName.trim(),
          description: newDescription.trim() || null,
          created_at: new Date().toISOString(),
        };
        setTitles((prev) => {
          const next = [newTitle, ...prev];
          if (typeof window !== "undefined") {
            try { localStorage.setItem("remotehr_demo_job_titles", JSON.stringify(next)); } catch {}
          }
          return next;
        });
        toast.success(`Job title '${newTitleName}' created successfully.`);
        setNewTitleName("");
        setNewDescription("");
        onTitlesUpdated?.();
      } else {
        toast.error(err.message || "Failed to create job title");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleStartEdit = (t: JobTitleItem) => {
    setEditingId(t.id);
    setEditTitleName(t.title_name);
    setEditDescription(t.description || "");
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditTitleName("");
    setEditDescription("");
  };

  const handleSaveEdit = async (id: string) => {
    if (!editTitleName.trim()) {
      toast.error("Title name cannot be empty.");
      return;
    }

    if (isDemoModeEnabled()) {
      setTitles((prev) => {
        const next = prev.map((t) => t.id === id ? { ...t, title_name: editTitleName.trim(), description: editDescription.trim() || null } : t);
        if (typeof window !== "undefined") {
          try { localStorage.setItem("remotehr_demo_job_titles", JSON.stringify(next)); } catch {}
        }
        return next;
      });
      toast.success("Job title updated successfully.");
      handleCancelEdit();
      onTitlesUpdated?.();
      return;
    }

    try {
      const res = await fetch("/api/admin/job-titles", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id,
          titleName: editTitleName.trim(),
          description: editDescription.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to update job title");

      toast.success("Job title updated successfully.");
      handleCancelEdit();
      await loadTitles();
      onTitlesUpdated?.();
    } catch (err: any) {
      if (isDemoModeEnabled()) {
        setTitles((prev) => {
          const next = prev.map((t) => t.id === id ? { ...t, title_name: editTitleName.trim(), description: editDescription.trim() || null } : t);
          if (typeof window !== "undefined") {
            try { localStorage.setItem("remotehr_demo_job_titles", JSON.stringify(next)); } catch {}
          }
          return next;
        });
        toast.success("Job title updated successfully.");
        handleCancelEdit();
        onTitlesUpdated?.();
      } else {
        toast.error(err.message || "Failed to update job title");
      }
    }
  };

  const handleDelete = async (t: JobTitleItem) => {
    if (!confirm(`Are you sure you want to delete the job title '${t.title_name}'?`)) {
      return;
    }

    if (isDemoModeEnabled()) {
      setTitles((prev) => {
        const next = prev.filter((item) => item.id !== t.id);
        if (typeof window !== "undefined") {
          try { localStorage.setItem("remotehr_demo_job_titles", JSON.stringify(next)); } catch {}
        }
        return next;
      });
      toast.success(`Job title '${t.title_name}' deleted.`);
      onTitlesUpdated?.();
      return;
    }

    try {
      const res = await fetch(`/api/admin/job-titles?id=${t.id}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to delete job title");

      toast.success(`Job title '${t.title_name}' deleted.`);
      await loadTitles();
      onTitlesUpdated?.();
    } catch (err: any) {
      if (isDemoModeEnabled()) {
        setTitles((prev) => {
          const next = prev.filter((item) => item.id !== t.id);
          if (typeof window !== "undefined") {
            try { localStorage.setItem("remotehr_demo_job_titles", JSON.stringify(next)); } catch {}
          }
          return next;
        });
        toast.success(`Job title '${t.title_name}' deleted.`);
        onTitlesUpdated?.();
      } else {
        toast.error(err.message || "Failed to delete job title");
      }
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Manage Company Roles & Job Titles"
      description="Create, edit, and organize custom company job titles (e.g., Full Stack Developer, SEO Analyst, QA Lead) for workforce provisioning."
    >
      <div className="space-y-6">
        {/* Create Title Form */}
        <form onSubmit={handleCreateTitle} className="p-4 rounded-2xl bg-card-subtle border border-border-light space-y-3">
          <div className="flex items-center gap-2 text-xs font-bold text-text-primary uppercase tracking-wider">
            <Briefcase className="w-4 h-4 text-brand-purple" />
            <span>Add New Custom Title</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="job-title-name" className="text-xs font-semibold text-text-secondary block mb-1">
                Title Name <span className="text-status-danger">*</span>
              </label>
              <input
                id="job-title-name"
                type="text"
                required
                placeholder="e.g. Full Stack Developer, SEO Analyst"
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
                placeholder="Key responsibilities or focus area"
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
                  <span>Creating...</span>
                </>
              ) : (
                <>
                  <Plus className="w-3.5 h-3.5" />
                  <span>Add Job Title</span>
                </>
              )}
            </button>
          </div>
        </form>

        {/* Existing Job Titles Table */}
        <div>
          <div className="flex items-center justify-between mb-2 px-1">
            <span className="text-xs font-bold uppercase tracking-wider text-text-secondary">
              Existing Job Titles ({titles.length})
            </span>
          </div>

          <div className="border border-border-light rounded-2xl overflow-hidden bg-card max-h-[280px] overflow-y-auto">
            {loading ? (
              <div className="p-6 text-center text-xs text-text-tertiary flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-brand-purple" />
                <span>Loading company job titles...</span>
              </div>
            ) : titles.length === 0 ? (
              <div className="p-8 text-center text-xs text-text-secondary">
                No custom job titles defined yet. Add your first role title above.
              </div>
            ) : (
              <table className="w-full text-left text-xs">
                <thead className="bg-card-subtle text-text-secondary font-semibold border-b border-border-light sticky top-0">
                  <tr>
                    <th className="py-2.5 px-4">Title Name</th>
                    <th className="py-2.5 px-4">Description</th>
                    <th className="py-2.5 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {titles.map((t) => {
                    const isEditing = editingId === t.id;
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
                            t.description || <span className="text-text-tertiary italic">No description</span>
                          )}
                        </td>
                        <td className="py-2.5 px-4 text-right space-x-1 whitespace-nowrap">
                          {isEditing ? (
                            <>
                              <button
                                type="button"
                                onClick={() => handleSaveEdit(t.id)}
                                title="Save"
                                className="p-1 rounded-lg bg-status-success-bg text-status-success-text hover:opacity-80 transition-opacity"
                              >
                                <Check className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={handleCancelEdit}
                                title="Cancel"
                                className="p-1 rounded-lg bg-card-subtle text-text-secondary hover:text-text-primary transition-colors"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={() => handleStartEdit(t)}
                                title={`Edit ${t.title_name}`}
                                className="p-1.5 rounded-lg hover:bg-card-subtle text-text-secondary hover:text-brand-purple transition-colors"
                              >
                                <Edit2 className="w-3.5 h-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDelete(t)}
                                title={`Delete ${t.title_name}`}
                                className="p-1.5 rounded-lg hover:bg-status-danger-bg text-text-secondary hover:text-status-danger-text transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </>
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

        <div className="flex justify-end pt-2 border-t border-border-light">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary text-xs font-bold hover:text-text-primary transition-colors cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
