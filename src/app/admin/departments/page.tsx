"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import { Building, Plus, Edit, Trash2, GitFork, User, Briefcase, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/shared/empty-state";
import { JobTitlesManager } from "@/features/admin/components/job-titles-manager";

import {
  getStoredDepartments,
  saveStoredDepartments,
  deleteStoredDepartment,
  getStoredUsers,
  type DemoDepartment,
} from "@/lib/storage/demo-store";

export interface DepartmentItem extends DemoDepartment {
  rolesCount?: number;
}

export default function DepartmentsAdminPage() {
  const [departments, setDepartments] = React.useState<DepartmentItem[]>(() => {
    if (typeof window !== "undefined") {
      return getStoredDepartments();
    }
    return [];
  });
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingDept, setEditingDept] = React.useState<DepartmentItem | null>(null);

  // Role Manager modal state
  const [roleModalOpen, setRoleModalOpen] = React.useState(false);
  const [activeRoleDeptId, setActiveRoleDeptId] = React.useState<string | undefined>(undefined);

  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [headId, setHeadId] = React.useState("");
  const [workforceUsers, setWorkforceUsers] = React.useState<any[]>([]);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(() => {
    if (typeof window !== "undefined") {
      return getStoredDepartments().length === 0;
    }
    return true;
  });

  const supabase = React.useMemo(() => createClient(), []);

  const loadDepartments = React.useCallback(async () => {
    if (departments.length === 0) {
      setIsLoading(true);
    }

    try {
      // 1. Fetch departments from API
      const res = await fetch("/api/admin/departments");
      if (res.ok) {
        const json = await res.json();
        if (Array.isArray(json.departments)) {
          setDepartments(json.departments);
          saveStoredDepartments(json.departments);
        } else {
          setDepartments([]);
        }
      } else {
        const stored = getStoredDepartments();
        setDepartments(stored);
      }

      // 2. Fetch workforce active employees for Department Head dropdown
      const { data: emps } = await (supabase as any)
        .from("employees")
        .select("id, full_name, email")
        .eq("status", "active");

      if (emps && emps.length > 0) {
        setWorkforceUsers(emps.map((e: any) => ({ id: e.id, name: e.full_name, role: "admin" })));
      } else {
        const cleaned = getStoredUsers().filter(
          (u) =>
            !u.email.endsWith("@remotehr.io") &&
            !u.name.toLowerCase().includes("sarah jenkins") &&
            !u.name.toLowerCase().includes("david chen") &&
            !u.name.toLowerCase().includes("maya patel") &&
            !u.name.toLowerCase().includes("james aathithyan")
        );
        setWorkforceUsers(cleaned);
      }
    } catch {
      setDepartments(getStoredDepartments());
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    loadDepartments();
    const handleStorageChange = () => {
      setDepartments(getStoredDepartments());
    };
    window.addEventListener("remotehr_storage_change", handleStorageChange);
    return () => {
      window.removeEventListener("remotehr_storage_change", handleStorageChange);
    };
  }, [loadDepartments]);

  const handleOpenAdd = () => {
    setEditingDept(null);
    setName("");
    setCode("");
    setParentId("");
    setHeadId("");
    setModalOpen(true);
  };

  const handleOpenEdit = (dept: DepartmentItem) => {
    setEditingDept(dept);
    setName(dept.name);
    setCode(dept.code);
    setParentId(dept.parentId || "");
    setHeadId(dept.headId || "");
    setModalOpen(true);
  };

  const handleManageRoles = (dept?: DepartmentItem) => {
    setActiveRoleDeptId(dept?.id);
    setRoleModalOpen(true);
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      toast.error("Please provide both department name and code.");
      return;
    }

    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    if (editingDept && parentId === editingDept.id) {
      toast.error("Hierarchical cycle detected! A department cannot report to itself.");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/admin/departments", {
        method: editingDept ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingDept?.id,
          name: trimmedName,
          code: trimmedCode,
          parentId: parentId || null,
          headId: headId || null,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to save department");
      }

      toast.success(`Department "${trimmedName}" saved successfully!`);
      setModalOpen(false);
      await loadDepartments();
    } catch (err: any) {
      toast.error(err.message || "Failed to save department");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (dept: DepartmentItem) => {
    if (!confirm(`Are you sure you want to delete ${dept.name}? Employees and roles will be unlinked.`)) {
      return;
    }

    deleteStoredDepartment(dept.id);
    setDepartments((prev) => prev.filter((d) => d.id !== dept.id));
    toast.success(`Department ${dept.name} deleted.`);

    try {
      await fetch(`/api/admin/departments?id=${dept.id}`, { method: "DELETE" });
      await loadDepartments();
    } catch {}
  };

  return (
    <AppShell primaryActionLabel="Add Department" onPrimaryAction={handleOpenAdd}>
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary dark:text-white tracking-tight flex items-center gap-2">
              Departments & Roles Hierarchy
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary dark:text-slate-400 mt-1">
              Create departments first, create specialized roles inside each department, and assign them to users.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => handleManageRoles()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2.5 rounded-2xl bg-card border border-border-light hover:bg-card-subtle text-text-primary text-xs sm:text-sm font-semibold shadow-sm transition-all"
            >
              <Briefcase className="w-4 h-4 text-brand-purple" />
              Manage All Roles
            </button>
            <button
              onClick={handleOpenAdd}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs sm:text-sm font-semibold shadow-sm transition-all"
            >
              <Plus className="w-4 h-4" />
              Add Department
            </button>
          </div>
        </section>

        {/* Departments Table */}
        <div className="bg-white dark:bg-slate-900 rounded-[28px] border border-border-light dark:border-slate-800 shadow-card overflow-hidden">
          {isLoading && departments.length === 0 ? (
            <div className="p-6 space-y-4 animate-pulse">
              <div className="h-5 w-48 bg-card-subtle dark:bg-slate-800 rounded-lg mb-6" />
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center justify-between py-3 border-b border-border-light dark:border-slate-800">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-xl bg-card-subtle dark:bg-slate-800" />
                    <div className="h-4 w-36 bg-card-subtle dark:bg-slate-800 rounded" />
                  </div>
                  <div className="h-4 w-24 bg-card-subtle dark:bg-slate-800 rounded" />
                  <div className="h-4 w-28 bg-card-subtle dark:bg-slate-800 rounded" />
                  <div className="h-4 w-20 bg-card-subtle dark:bg-slate-800 rounded" />
                </div>
              ))}
            </div>
          ) : departments.length === 0 ? (
            <EmptyState
              icon={<Building className="w-6 h-6" />}
              title="No departments configured"
              description="Start building your hierarchy by creating your first department (e.g., Engineering, Sales, HR)."
              action={
                <button
                  onClick={handleOpenAdd}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-purple text-white text-xs font-semibold cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Department
                </button>
              }
              className="border-none rounded-none shadow-none"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-card-subtle dark:bg-slate-800/50 text-text-secondary dark:text-slate-400 font-semibold border-b border-border-light dark:border-slate-800">
                  <tr>
                    <th className="py-3.5 px-5">Department Name</th>
                    <th className="py-3.5 px-4">Code</th>
                    <th className="py-3.5 px-4">Department Roles</th>
                    <th className="py-3.5 px-4">Parent Department</th>
                    <th className="py-3.5 px-4">Department Head</th>
                    <th className="py-3.5 px-4">Headcount</th>
                    <th className="py-3.5 px-5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light dark:divide-slate-800">
                  {departments.map((d) => (
                    <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="py-4 px-5">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 rounded-xl bg-card-subtle dark:bg-slate-800 flex items-center justify-center text-brand-purple">
                            <Building className="w-4 h-4" />
                          </div>
                          <div>
                            <span className="font-bold text-text-primary dark:text-white block">{d.name}</span>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-4 font-mono text-xs font-bold text-brand-purple">
                        {d.code}
                      </td>
                      <td className="py-4 px-4">
                        <button
                          onClick={() => handleManageRoles(d)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-brand-purple/10 hover:bg-brand-purple/20 text-brand-purple text-xs font-semibold transition-all"
                        >
                          <Briefcase className="w-3 h-3" />
                          <span>{d.rolesCount || 0} roles</span>
                          <ChevronRight className="w-3 h-3" />
                        </button>
                      </td>
                      <td className="py-4 px-4 text-xs text-text-secondary dark:text-slate-300">
                        {d.parentName ? (
                          <span className="inline-flex items-center gap-1">
                            <GitFork className="w-3.5 h-3.5 text-text-tertiary rotate-180" />
                            {d.parentName}
                          </span>
                        ) : (
                          <span className="text-text-tertiary italic">Root Level</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs text-text-secondary dark:text-slate-300">
                        {d.headName ? (
                          <span className="inline-flex items-center gap-1 font-medium">
                            <User className="w-3.5 h-3.5 text-text-tertiary" />
                            {d.headName}
                          </span>
                        ) : (
                          <span className="text-text-tertiary italic">Unassigned</span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs font-semibold text-text-primary dark:text-white">
                        {d.memberCount} members
                      </td>
                      <td className="py-4 px-5 text-right space-x-1 whitespace-nowrap">
                        <button
                          onClick={() => handleManageRoles(d)}
                          title="Add/Manage Roles in Department"
                          className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary hover:text-brand-purple transition-colors"
                        >
                          <Briefcase className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleOpenEdit(d)}
                          title="Edit Department"
                          className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary hover:text-brand-purple transition-colors"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(d)}
                          title="Delete Department"
                          className="p-1.5 rounded-xl hover:bg-red-50 dark:hover:bg-red-900/30 text-text-secondary hover:text-status-danger transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Modal: Add / Edit Department */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in">
            <div className="bg-white dark:bg-slate-900 rounded-[28px] border border-border-light dark:border-slate-800 p-6 sm:p-8 max-w-lg w-full shadow-modal">
              <h2 className="text-xl font-extrabold text-text-primary dark:text-white mb-2">
                {editingDept ? "Edit Department" : "Add New Department"}
              </h2>
              <p className="text-xs text-text-secondary dark:text-slate-400 mb-6">
                Define the department details. Once created, you can add roles inside this department and assign them to users.
              </p>

              <form onSubmit={handleSaveDepartment} className="space-y-4">
                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Department Name
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Platform Engineering"
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Department Code
                  </label>
                  <input
                    type="text"
                    required
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="e.g. PLAT-ENG"
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm font-mono text-text-primary dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-purple"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Department Head (Manager)
                  </label>
                  <select
                    value={headId}
                    onChange={(e) => setHeadId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                  >
                    <option value="">None / Unassigned</option>
                    {workforceUsers.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold text-text-secondary dark:text-slate-400 block mb-1">
                    Parent Department (Optional)
                  </label>
                  <select
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-card-subtle dark:bg-slate-800 border border-border-light dark:border-slate-700 text-sm text-text-primary dark:text-white"
                  >
                    <option value="">None (Top-Level Root Department)</option>
                    {departments
                      .filter((d) => !editingDept || d.id !== editingDept.id)
                      .map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name} ({d.code})
                        </option>
                      ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-3 pt-4 border-t border-border-light dark:border-slate-800">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-text-secondary hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-xs font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? "Saving..." : editingDept ? "Save Changes" : "Create Department"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* Roles & Job Titles Hierarchy Modal */}
        <JobTitlesManager
          open={roleModalOpen}
          onOpenChange={setRoleModalOpen}
          defaultDepartmentId={activeRoleDeptId}
          onTitlesUpdated={loadDepartments}
        />
      </div>
    </AppShell>
  );
}
