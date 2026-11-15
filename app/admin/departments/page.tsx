"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { createClient } from "@/lib/supabase/client";
import { Building, Plus, Edit, Trash2, GitFork, User } from "lucide-react";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { EmptyState } from "@/components/shared/empty-state";

import {
  getStoredDepartments,
  saveStoredDepartments,
  addStoredDepartment,
  deleteStoredDepartment,
  type DemoDepartment,
} from "@/lib/storage/demo-store";

export type DepartmentItem = DemoDepartment;

export default function DepartmentsAdminPage() {
  const [departments, setDepartments] = React.useState<DepartmentItem[]>(() => getStoredDepartments());
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingDept, setEditingDept] = React.useState<DepartmentItem | null>(null);

  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [isLoading, setIsLoading] = React.useState(true);

  const supabase = React.useMemo(() => createClient(), []);

  const loadDepartments = React.useCallback(async () => {
    setIsLoading(true);
    try {
      const [{ data: depts, error }, { data: emps }] = await Promise.all([
        (supabase as any)
          .from("departments")
          .select("id, name, code, parent_department_id, department_head_id")
          .order("name"),
        (supabase as any)
          .from("employees")
          .select("id, full_name, department_id")
          .eq("status", "active"),
      ]);

      if (!error && depts && depts.length > 0) {
        const empMap = new Map<string, string>();
        const counts = new Map<string, number>();
        (emps || []).forEach((e: any) => {
          empMap.set(e.id, e.full_name);
          if (e.department_id) {
            counts.set(e.department_id, (counts.get(e.department_id) || 0) + 1);
          }
        });
        const deptNameMap = new Map<string, string>(
          depts.map((d: any) => [d.id, d.name])
        );
        const mapped: DepartmentItem[] = depts.map((d: any) => ({
          id: d.id,
          name: d.name,
          code: d.code,
          headId: d.department_head_id || undefined,
          headName: d.department_head_id ? empMap.get(d.department_head_id) : undefined,
          parentId: d.parent_department_id || undefined,
          parentName: d.parent_department_id ? deptNameMap.get(d.parent_department_id) : undefined,
          memberCount: counts.get(d.id) || 0,
        }));
        setDepartments(mapped);
        saveStoredDepartments(mapped);
      } else {
        setDepartments(getStoredDepartments());
      }
    } catch {
      setDepartments(getStoredDepartments());
    } finally {
      setIsLoading(false);
    }
  }, [supabase]);

  React.useEffect(() => {
    loadDepartments();
  }, [loadDepartments]);

  const handleOpenAdd = () => {
    setEditingDept(null);
    setName("");
    setCode("");
    setParentId("");
    setModalOpen(true);
  };

  const handleOpenEdit = (dept: DepartmentItem) => {
    setEditingDept(dept);
    setName(dept.name);
    setCode(dept.code);
    setParentId(dept.parentId || "");
    setModalOpen(true);
  };

  const handleSaveDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !code.trim()) {
      toast.error("Please enter department name and code.");
      return;
    }

    const trimmedName = name.trim();
    const trimmedCode = code.trim().toUpperCase();

    if (editingDept && parentId === editingDept.id) {
      toast.error("Hierarchical cycle detected! A department cannot report to itself.");
      return;
    }

    setIsSubmitting(true);
    let nextList: DepartmentItem[];

    if (editingDept) {
      nextList = departments.map((d) =>
        d.id === editingDept.id
          ? {
              ...d,
              name: trimmedName,
              code: trimmedCode,
              parentId: parentId || undefined,
              parentName: departments.find((p) => p.id === parentId)?.name,
            }
          : d
      );
      toast.success(`Department "${trimmedName}" updated!`);
    } else {
      const newDept: DepartmentItem = {
        id: `dept-${Date.now()}`,
        name: trimmedName,
        code: trimmedCode,
        parentId: parentId || undefined,
        parentName: departments.find((p) => p.id === parentId)?.name,
        memberCount: 0,
      };
      nextList = [...departments, newDept];
      toast.success(`Department "${trimmedName}" created!`);
    }

    setDepartments(nextList);
    saveStoredDepartments(nextList);
    setModalOpen(false);
    setIsSubmitting(false);

    try {
      if (editingDept) {
        await (supabase.rpc as any)("admin_update_department", {
          p_department_id: editingDept.id,
          p_name: trimmedName,
          p_code: trimmedCode,
          p_department_head_id: editingDept.headId || null,
          p_parent_department_id: parentId || null,
        });
      } else {
        await (supabase.rpc as any)("admin_create_department", {
          p_name: trimmedName,
          p_code: trimmedCode,
          p_department_head_id: null,
          p_parent_department_id: parentId || null,
        });
      }
    } catch {}
  };

  const handleDelete = async (dept: DepartmentItem) => {
    if (!confirm(`Are you sure you want to delete ${dept.name}? Employees will be unlinked.`)) {
      return;
    }
    const nextList = departments.filter((d) => d.id !== dept.id);
    setDepartments(nextList);
    saveStoredDepartments(nextList);
    toast.success(`Department ${dept.name} deleted.`);

    try {
      await (supabase.rpc as any)("admin_delete_department", {
        p_department_id: dept.id,
      });
    } catch {}
  };

  return (
    <AppShell primaryActionLabel="Add Department" onPrimaryAction={handleOpenAdd}>
      <div className="space-y-6">
        {/* Header */}
        <section className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-3">
          <div>
            <h1 className="text-2xl md:text-3xl font-extrabold text-text-primary dark:text-white tracking-tight flex items-center gap-2">
              Departments & Hierarchy
            </h1>
            <p className="text-xs sm:text-sm text-text-secondary dark:text-slate-400 mt-1">
              Structure organizational units, assign department heads, and prevent cyclic reporting trees.
            </p>
          </div>
          <button
            onClick={handleOpenAdd}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-brand-purple hover:bg-brand-purple-hover text-white text-sm font-semibold shadow-sm transition-all"
          >
            <Plus className="w-4 h-4" />
            Add Department
          </button>
        </section>

        {/* Departments Table */}
        <div className="bg-white dark:bg-slate-900 rounded-[28px] border border-border-light dark:border-slate-800 shadow-card overflow-hidden">
          {departments.length === 0 ? (
            <EmptyState
              icon={<Building className="w-6 h-6" />}
              title={isLoading ? "Loading departments..." : "No departments configured"}
              description={
                isLoading
                  ? "Retrieving organizational hierarchy..."
                  : "Create your first department to group employees and assign reporting heads."
              }
              action={
                !isLoading && (
                  <button
                    onClick={handleOpenAdd}
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-purple text-white text-xs font-semibold"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add Department
                  </button>
                )
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
                        <span className="font-bold text-text-primary dark:text-white">{d.name}</span>
                      </div>
                    </td>
                    <td className="py-4 px-4 font-mono text-xs font-bold text-brand-purple">
                      {d.code}
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
                        onClick={() => handleOpenEdit(d)}
                        title="Edit Department"
                        className="p-1.5 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-text-secondary hover:text-brand-purple transition-colors"
                      >
                        <Edit className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleDelete(d)}
                        title="Delete Department"
                        className="p-1.5 rounded-xl hover:bg-status-danger-bg text-text-secondary hover:text-status-danger-text transition-colors"
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

        {/* Create/Edit Modal */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white dark:bg-slate-900 rounded-[28px] max-w-md w-full p-6 shadow-shell border border-border-light dark:border-slate-800 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-extrabold text-text-primary dark:text-white flex items-center gap-2">
                  <Building className="w-5 h-5 text-brand-purple" />
                  {editingDept ? "Edit Department" : "Add Department"}
                </h3>
                <button
                  onClick={() => setModalOpen(false)}
                  className="text-text-tertiary hover:text-text-primary text-sm font-bold"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleSaveDepartment} className="space-y-3.5">
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

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary text-sm font-semibold hover:bg-slate-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-4 py-2 rounded-xl bg-brand-purple hover:bg-brand-purple-hover text-white text-sm font-semibold shadow-sm transition-all disabled:opacity-50"
                  >
                    {isSubmitting ? "Saving..." : editingDept ? "Save Changes" : "Create Department"}
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
