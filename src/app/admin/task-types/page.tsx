"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import {
  Plus,
  Edit2,
  Power,
  ArrowUp,
  ArrowDown,
  ListTodo,
  Clock,
  Calendar,
  Layers,
  ChevronLeft,
  CheckSquare,
  Trash2,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import { TaskType } from "@/features/tasks/types";
import { cn } from "@/lib/utils";

function AdminTaskTypesContent() {
  const { userRole, organizationId, isLoaded } = useAppSession();
  const [types, setTypes] = React.useState<TaskType[]>([]);
  const [departments, setDepartments] = React.useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = React.useState(true);
  const [serverDeniedReason, setServerDeniedReason] = React.useState<string | null>(null);

  // Modal State
  const [modalOpen, setModalOpen] = React.useState(false);
  const [editingType, setEditingType] = React.useState<TaskType | null>(null);

  // Form State
  const [formName, setFormName] = React.useState("");
  const [formDeptId, setFormDeptId] = React.useState<string>("");
  const [formPriority, setFormPriority] = React.useState<"low" | "medium" | "high" | "urgent">("medium");
  const [formDueDays, setFormDueDays] = React.useState<string>("1");
  const [showCustomDueRule, setShowCustomDueRule] = React.useState<boolean>(false);
  const [formTemplate, setFormTemplate] = React.useState<string>("");
  const [formChecklist, setFormChecklist] = React.useState<string[]>([]);
  const [newChecklistItem, setNewChecklistItem] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  const loadData = React.useCallback(async () => {
    if (!isLoaded) return;

    if (!["admin", "hr"].includes(userRole)) {
      setServerDeniedReason(null);
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setServerDeniedReason(null);

      const [deptRes, res] = await Promise.all([
        fetch("/api/admin/departments"),
        fetch("/api/tasks/types?all=true"),
      ]);

      if (deptRes.ok) {
        const deptJson = await deptRes.json().catch(() => ({}));
        if (Array.isArray(deptJson.departments)) {
          setDepartments(deptJson.departments.map((d: any) => ({ id: d.id, name: d.name })));
        }
      }

      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }

      if (res.status === 403) {
        const errJson = await res.json().catch(() => ({}));
        setServerDeniedReason(
          errJson.error || "Workspace HR or Administrator verification (including MFA) is required."
        );
        return;
      }

      if (res.ok) {
        const json = await res.json();
        setTypes(json.types || []);
      } else {
        toast.error("Failed to load task types.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to load task types data.");
    } finally {
      setLoading(false);
    }
  }, [isLoaded, userRole, organizationId]);

  React.useEffect(() => {
    loadData();
  }, [loadData]);

  const openCreateModal = () => {
    setEditingType(null);
    setFormName("");
    setFormDeptId("");
    setFormPriority("medium");
    setFormDueDays("1");
    setShowCustomDueRule(false);
    setFormTemplate("Objective:\n\nDetails:\n\nDeliverable:");
    setFormChecklist([]);
    setNewChecklistItem("");
    setModalOpen(true);
  };

  const openEditModal = (t: TaskType) => {
    setEditingType(t);
    setFormName(t.name);
    setFormDeptId(t.department_id || "");
    setFormPriority(t.default_priority || "medium");
    const dueVal =
      t.due_rule_working_days !== null && t.due_rule_working_days !== undefined
        ? String(t.due_rule_working_days)
        : "";
    setFormDueDays(dueVal);
    setShowCustomDueRule(Boolean(dueVal !== "" && Number(dueVal) > 2));
    setFormTemplate(t.description_template || "");
    setFormChecklist(Array.isArray(t.checklist) ? [...t.checklist] : []);
    setNewChecklistItem("");
    setModalOpen(true);
  };

  const handleAddChecklistItem = () => {
    if (!newChecklistItem.trim()) return;
    setFormChecklist((prev) => [...prev, newChecklistItem.trim()]);
    setNewChecklistItem("");
  };

  const handleRemoveChecklistItem = (idx: number) => {
    setFormChecklist((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error("Task type name is required.");
      return;
    }

    let parsedDueRule: number | null = null;
    if (formDueDays.trim() !== "") {
      const parsed = Number(formDueDays);
      if (isNaN(parsed) || parsed < 0 || parsed > 30) {
        toast.error("Working days due rule must be between 0 and 30.");
        return;
      }
      parsedDueRule = parsed;
    }

    setSubmitting(true);
    try {
      const payload = {
        name: formName.trim(),
        department_id: formDeptId || null,
        default_priority: formPriority,
        default_estimate_minutes: null,
        due_rule_working_days: parsedDueRule,
        description_template: formTemplate.trim() || null,
        checklist: formChecklist,
      };

      if (editingType) {
        const res = await fetch(`/api/tasks/types/${editingType.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const resJson = await res.json();
        if (!res.ok) throw new Error(resJson.error || "Failed to update task type");
        toast.success(`Updated task type "${formName.trim()}"`);
      } else {
        const res = await fetch("/api/tasks/types", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        const resJson = await res.json();
        if (!res.ok) throw new Error(resJson.error || "Failed to create task type");
        toast.success(`Created task type "${formName.trim()}"`);
      }

      setModalOpen(false);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to save task type");
    } finally {
      setSubmitting(false);
    }
  };

  const handleToggleActive = async (t: TaskType) => {
    try {
      const res = await fetch(`/api/tasks/types/${t.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !t.is_active }),
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.error || "Failed to update status");
      }
      toast.success(t.is_active ? `Deactivated "${t.name}"` : `Activated "${t.name}"`);
      await loadData();
    } catch (err: any) {
      toast.error(err?.message || "Failed to toggle status");
    }
  };

  const handleReorder = async (idx: number, direction: "up" | "down") => {
    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= types.length) return;

    const currentItem = types[idx];
    const targetItem = types[targetIdx];

    const currentOrder = currentItem.sort_order;
    const targetOrder = targetItem.sort_order;

    // Swap orders
    try {
      await Promise.all([
        fetch(`/api/tasks/types/${currentItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: targetOrder }),
        }),
        fetch(`/api/tasks/types/${targetItem.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sort_order: currentOrder }),
        }),
      ]);
      await loadData();
    } catch (err: any) {
      toast.error("Failed to reorder types");
    }
  };

  if (isLoaded && (!["admin", "hr"].includes(userRole) || serverDeniedReason)) {
    return (
      <div className="p-8 max-w-xl mx-auto text-center space-y-4">
        <h1 className="text-xl font-bold text-black">Access Denied</h1>
        <p className="text-sm text-[#4D4D4D]">
          {serverDeniedReason ||
            "Task types and workflow templates are managed exclusively by HR and System Administrators."}
        </p>
        <Link
          href="/tasks"
          className="inline-flex items-center px-4 py-2 text-sm font-semibold text-black bg-[#B7FF00] rounded hover:opacity-90"
        >
          Back to Tasks
        </Link>
      </div>
    );
  }

  return (
      <div className="space-y-6 pb-12">
        {/* Navigation & Header */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#E6E6E6] pb-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Link
                href="/admin/settings"
                className="inline-flex items-center text-xs font-semibold text-[#808080] hover:text-black transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5 mr-0.5" />
                Admin Settings
              </Link>
              <span className="text-xs text-[#B3B3B3]">/</span>
              <span className="text-xs font-semibold text-black">Task Types</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-black">Task Types & Presets</h1>
            <p className="text-xs text-[#4D4D4D]">
              Configure organization-wide templates, default priorities, working day due rules, and checklists.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <Link
              href="/tasks"
              className="px-3.5 py-1.5 text-xs font-semibold text-black bg-white border border-[#E6E6E6] rounded hover:bg-[#F5F5F5] transition-colors"
            >
              View Tasks Board
            </Link>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-bold text-black bg-[#B7FF00] rounded hover:opacity-90 transition-opacity"
            >
              <Plus className="w-4 h-4" />
              Add Task Type
            </button>
          </div>
        </div>

        {/* Task Types List */}
        {loading ? (
          <div className="p-12 text-center text-xs text-[#808080]">Loading task types...</div>
        ) : types.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-[#E6E6E6] rounded-lg bg-white space-y-3">
            <ListTodo className="w-8 h-8 mx-auto text-[#808080]" />
            <h3 className="text-sm font-bold text-black">No task types configured</h3>
            <p className="text-xs text-[#4D4D4D] max-w-sm mx-auto">
              Add your first task type to enable automated estimates, templates, and suggested due dates for your team.
            </p>
            <button
              onClick={openCreateModal}
              className="px-4 py-2 text-xs font-bold text-black bg-[#B7FF00] rounded hover:opacity-90"
            >
              Add Task Type
            </button>
          </div>
        ) : (
          <div className="border border-[#E6E6E6] rounded-lg overflow-hidden bg-white shadow-sm">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#E6E6E6] bg-[#F5F5F5] text-black font-bold uppercase tracking-wider text-[11px]">
                  <th className="py-2.5 px-3 w-16 text-center">Order</th>
                  <th className="py-2.5 px-4">Type Name</th>
                  <th className="py-2.5 px-3">Team Scope</th>
                  <th className="py-2.5 px-3">Default Priority</th>
                  <th className="py-2.5 px-3">Due Date Preset</th>
                  <th className="py-2.5 px-3">Checklist</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E6E6E6]">
                {types.map((t, idx) => {
                  const dept = departments.find((d) => d.id === t.department_id);
                  const deptLabel = dept ? dept.name : "General (All Teams)";

                  return (
                    <tr
                      key={t.id}
                      className={`hover:bg-[#F9F9F9] transition-colors ${!t.is_active ? "opacity-60 bg-[#FAFAFA]" : ""}`}
                    >
                      {/* Reorder Buttons */}
                      <td className="py-2.5 px-2 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            type="button"
                            disabled={idx === 0}
                            onClick={() => handleReorder(idx, "up")}
                            className="p-1 rounded text-[#808080] hover:text-black hover:bg-[#E6E6E6] disabled:opacity-30 disabled:pointer-events-none"
                            title="Move up"
                          >
                            <ArrowUp className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={idx === types.length - 1}
                            onClick={() => handleReorder(idx, "down")}
                            className="p-1 rounded text-[#808080] hover:text-black hover:bg-[#E6E6E6] disabled:opacity-30 disabled:pointer-events-none"
                            title="Move down"
                          >
                            <ArrowDown className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>

                      {/* Name & Template preview badge */}
                      <td className="py-2.5 px-4">
                        <div className="font-bold text-black">{t.name}</div>
                        {t.description_template && (
                          <div className="text-[10px] text-[#808080] line-clamp-1 mt-0.5">
                            {t.description_template.split("\n")[0]}
                          </div>
                        )}
                      </td>

                      {/* Team Scope */}
                      <td className="py-2.5 px-3">
                        <span className="inline-block px-2 py-0.5 text-[11px] font-semibold bg-[#F5F5F5] border border-[#E6E6E6] text-black rounded">
                          {deptLabel}
                        </span>
                      </td>

                      {/* Priority */}
                      <td className="py-2.5 px-3">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-bold uppercase rounded border ${
                            t.default_priority === "urgent"
                              ? "bg-red-50 text-[#FF1493] border-red-200"
                              : t.default_priority === "high"
                              ? "bg-amber-50 text-amber-900 border-amber-200"
                              : "bg-[#F5F5F5] text-black border-[#E6E6E6]"
                          }`}
                        >
                          {t.default_priority}
                        </span>
                      </td>

                      {/* Due Date Preset */}
                      <td className="py-2.5 px-3 text-[#4D4D4D] font-medium">
                        <div className="flex items-center gap-1.5">
                          <Calendar className="w-3.5 h-3.5 text-[#808080]" />
                          <span>
                            {t.due_rule_working_days === 0
                              ? "Today"
                              : t.due_rule_working_days === 1
                              ? "Tomorrow"
                              : t.due_rule_working_days === 2
                              ? "Day after tomorrow"
                              : t.due_rule_working_days !== null && t.due_rule_working_days !== undefined
                              ? `+${t.due_rule_working_days} working days`
                              : "No preset"}
                          </span>
                        </div>
                      </td>

                      {/* Checklist */}
                      <td className="py-2.5 px-3 text-[#4D4D4D]">
                        {Array.isArray(t.checklist) && t.checklist.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-black">
                            <CheckSquare className="w-3 h-3 text-[#808080]" />
                            {t.checklist.length} items
                          </span>
                        ) : (
                          <span className="text-[#808080]">—</span>
                        )}
                      </td>

                      {/* Status */}
                      <td className="py-2.5 px-3 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 text-[10px] font-bold rounded ${
                            t.is_active ? "bg-[#B7FF00] text-black" : "bg-[#E6E6E6] text-[#808080]"
                          }`}
                        >
                          {t.is_active ? "Active" : "Inactive"}
                        </span>
                      </td>

                      {/* Actions */}
                      <td className="py-2.5 px-4 text-right">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => openEditModal(t)}
                            className="p-1 rounded text-[#4D4D4D] hover:text-black hover:bg-[#E6E6E6] transition-colors"
                            title="Edit"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleToggleActive(t)}
                            className={`p-1 rounded transition-colors ${
                              t.is_active
                                ? "text-[#808080] hover:text-[#FF1493] hover:bg-red-50"
                                : "text-[#808080] hover:text-black hover:bg-[#E6E6E6]"
                            }`}
                            title={t.is_active ? "Deactivate" : "Activate"}
                          >
                            <Power className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Modal: Add / Edit Task Type */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-lg border border-[#E6E6E6] shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden animate-in fade-in duration-150">
              {/* Modal Header */}
              <div className="px-6 py-4 border-b border-[#E6E6E6] flex items-center justify-between">
                <div>
                  <h2 className="text-base font-bold text-black">
                    {editingType ? `Edit Task Type: ${editingType.name}` : "Create New Task Type"}
                  </h2>
                  <p className="text-xs text-[#808080]">
                    Configure default preset rules and description template for tasks of this type.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="text-xs font-bold text-[#808080] hover:text-black"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Name */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-black">Type Name *</label>
                    <input
                      type="text"
                      required
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      placeholder="e.g. Bug fix, Code review"
                      className="w-full px-3 py-1.5 text-xs border border-[#E6E6E6] rounded focus:outline-none focus:border-black"
                    />
                  </div>

                  {/* Department */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-black">Department Scope</label>
                    <select
                      value={formDeptId}
                      onChange={(e) => setFormDeptId(e.target.value)}
                      className="w-full px-3 py-1.5 text-xs border border-[#E6E6E6] rounded focus:outline-none focus:border-black bg-white"
                    >
                      <option value="">General (Available to all teams)</option>
                      {departments.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Default Priority */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-black">Default Priority</label>
                    <select
                      value={formPriority}
                      onChange={(e) => setFormPriority(e.target.value as any)}
                      className="w-full px-3 py-1.5 text-xs border border-[#E6E6E6] rounded focus:outline-none focus:border-black bg-white"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>

                  {/* Due Date Preset */}
                  <div className="space-y-1">
                    <label className="text-xs font-bold text-black">Due Date Preset</label>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {[
                        { label: "Today", val: "0" },
                        { label: "Tomorrow", val: "1" },
                        { label: "Day after tomorrow", val: "2" },
                      ].map((preset) => {
                        const isSelected = !showCustomDueRule && formDueDays === preset.val;
                        return (
                          <button
                            key={preset.val}
                            type="button"
                            onClick={() => {
                              setShowCustomDueRule(false);
                              setFormDueDays(preset.val);
                            }}
                            className={cn(
                              "px-2.5 py-1 rounded text-[11px] font-semibold border transition-all cursor-pointer",
                              isSelected
                                ? "bg-black text-white border-black shadow-xs"
                                : "bg-white text-black border-[#E6E6E6] hover:bg-[#F5F5F5]"
                            )}
                          >
                            {preset.label}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          setShowCustomDueRule(true);
                          if (formDueDays === "0" || formDueDays === "1" || formDueDays === "2") {
                            setFormDueDays("3");
                          }
                        }}
                        className={cn(
                          "px-2.5 py-1 rounded text-[11px] font-semibold border transition-all cursor-pointer",
                          showCustomDueRule
                            ? "bg-black text-white border-black shadow-xs"
                            : "bg-white text-black border-[#E6E6E6] hover:bg-[#F5F5F5]"
                        )}
                      >
                        Custom days...
                      </button>
                      {formDueDays !== "" && (
                        <button
                          type="button"
                          onClick={() => {
                            setFormDueDays("");
                            setShowCustomDueRule(false);
                          }}
                          className="px-2 py-1 text-[11px] font-bold text-[#808080] hover:text-black cursor-pointer"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {showCustomDueRule && (
                      <div className="pt-2 flex items-center gap-2">
                        <input
                          type="number"
                          min="0"
                          max="30"
                          value={formDueDays}
                          onChange={(e) => setFormDueDays(e.target.value)}
                          placeholder="e.g. 5"
                          className="w-24 px-3 py-1.5 text-xs border border-black rounded focus:outline-none bg-white font-semibold"
                        />
                        <span className="text-[11px] text-[#808080]">working days ahead</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Sub-Task Checklist */}
                <div className="space-y-2 pt-2 border-t border-[#E6E6E6]">
                  <label className="text-xs font-bold text-black flex items-center gap-1">
                    <CheckSquare className="w-3.5 h-3.5 text-[#808080]" />
                    Preset Sub-Task Checklist (Optional)
                  </label>
                  <p className="text-[11px] text-[#4D4D4D]">
                    When creating a task of this type, users will see checkboxes to automatically spawn these sub-tasks.
                  </p>

                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={newChecklistItem}
                      onChange={(e) => setNewChecklistItem(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          handleAddChecklistItem();
                        }
                      }}
                      placeholder="Add sub-task step (e.g. Reproduce bug, Code review)..."
                      className="flex-1 px-3 py-1.5 text-xs border border-[#E6E6E6] rounded focus:outline-none focus:border-black"
                    />
                    <button
                      type="button"
                      onClick={handleAddChecklistItem}
                      className="px-3 py-1.5 text-xs font-bold text-black bg-[#B7FF00] rounded hover:opacity-90"
                    >
                      Add
                    </button>
                  </div>

                  {formChecklist.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      {formChecklist.map((item, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between px-3 py-1.5 text-xs bg-[#F5F5F5] border border-[#E6E6E6] rounded"
                        >
                          <span className="text-black font-medium">{item}</span>
                          <button
                            type="button"
                            onClick={() => handleRemoveChecklistItem(i)}
                            className="text-[#808080] hover:text-[#FF1493]"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Description Template with Live Preview */}
                <div className="space-y-2 pt-2 border-t border-[#E6E6E6]">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-black">Description Template</label>
                    <span className="text-[10px] text-[#808080]">Plain text structure with headings</span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Editor */}
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-[#4D4D4D]">Template Source:</span>
                      <textarea
                        rows={7}
                        value={formTemplate}
                        onChange={(e) => setFormTemplate(e.target.value)}
                        placeholder="What's broken:&#10;&#10;Steps to reproduce:&#10;1. &#10;2. &#10;&#10;Expected result:"
                        className="w-full px-3 py-2 text-xs border border-[#E6E6E6] rounded focus:outline-none focus:border-black font-mono leading-relaxed"
                      />
                    </div>

                    {/* Live Preview */}
                    <div className="space-y-1">
                      <span className="text-[11px] font-semibold text-[#4D4D4D] flex items-center gap-1">
                        <Eye className="w-3.5 h-3.5 text-[#808080]" />
                        Live Task Description Preview:
                      </span>
                      <div className="h-[148px] overflow-y-auto px-3 py-2 text-xs bg-[#F9F9F9] border border-[#E6E6E6] rounded text-black whitespace-pre-wrap font-sans leading-relaxed">
                        {formTemplate || <span className="text-[#808080] italic">No template text entered</span>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="pt-4 border-t border-[#E6E6E6] flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 text-xs font-semibold text-[#4D4D4D] hover:text-black"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 text-xs font-bold text-black bg-[#B7FF00] rounded hover:opacity-90 disabled:opacity-50"
                  >
                    {submitting ? "Saving..." : editingType ? "Update Type" : "Create Type"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
  );
}

export default function AdminTaskTypesPage() {
  return (
    <AppShell>
      <AdminTaskTypesContent />
    </AppShell>
  );
}
