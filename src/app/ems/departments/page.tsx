"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/features/ems/components/ems-navigation-header";
import {
  Building2,
  Plus,
  Users,
  Briefcase,
  History,
  UserCheck,
  UserMinus,
  UserPlus,
  Calendar,
  Loader2,
  X,
  Clock,
  ShieldCheck,
  Check,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface DepartmentRecord {
  id: string;
  name: string;
  code: string;
  headId: string | null;
  headName: string | null;
  headDesignation: string | null;
  headEmail: string | null;
  head?: {
    id: string;
    full_name: string;
    designation: string;
    email: string;
  } | null;
  parentId: string | null;
  parentName: string | null;
  parent_department_id?: string | null;
  parent?: {
    id: string;
    name: string;
  } | null;
  memberCount: number;
  rolesCount: number;
  createdAt?: string;
}

interface ActiveEmployee {
  id: string;
  full_name: string;
  email: string;
  status: string;
  department_id: string | null;
  job_titles?: { title_name: string } | null;
  role?: string;
}

interface HistoryItem {
  id: string;
  action: string;
  employeeId: string | null;
  employeeName: string;
  designation: string;
  effectiveStartDate: string | null;
  effectiveEndDate: string | null;
  assignedByName: string;
  notes: string | null;
  createdAt: string;
}

export default function EmsDepartmentsPage() {
  const [departments, setDepartments] = React.useState<DepartmentRecord[]>([]);
  const [activeEmployees, setActiveEmployees] = React.useState<ActiveEmployee[]>([]);
  const [designations, setDesignations] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Create Department Modal State
  const [modalOpen, setModalOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [code, setCode] = React.useState("");
  const [parentId, setParentId] = React.useState("");
  const [submitting, setSubmitting] = React.useState(false);

  // Assign / Reassign Department Head Modal State
  const [assignModalOpen, setAssignModalOpen] = React.useState(false);
  const [targetDept, setTargetDept] = React.useState<DepartmentRecord | null>(null);
  const [selectedEmpId, setSelectedEmpId] = React.useState("");
  const [selectedDesignation, setSelectedDesignation] = React.useState("");
  const [effectiveStartDate, setEffectiveStartDate] = React.useState(() =>
    new Date().toISOString().slice(0, 10)
  );
  const [assignmentNotes, setAssignmentNotes] = React.useState("");
  const [savingHead, setSavingHead] = React.useState(false);

  // Remove Head Modal State
  const [removeModalOpen, setRemoveModalOpen] = React.useState(false);
  const [removingHead, setRemovingHead] = React.useState(false);

  // History Modal State
  const [historyModalOpen, setHistoryModalOpen] = React.useState(false);
  const [historyLoading, setHistoryLoading] = React.useState(false);
  const [historyRecords, setHistoryRecords] = React.useState<HistoryItem[]>([]);

  // 1. Load departments
  const loadDepartments = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/departments");
      const json = await res.json();
      if (Array.isArray(json.departments)) {
        setDepartments(json.departments);
      }
    } catch {
      toast.error("Failed to load departments");
    } finally {
      setLoading(false);
    }
  }, []);

  // 2. Load active employees & designations for the assignment form
  const loadReferenceData = React.useCallback(async () => {
    try {
      const [empRes, deptRes] = await Promise.all([
        fetch("/api/employees?status=active").then((r) => (r.ok ? r.json() : null)),
        fetch("/api/admin/job-titles").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);

      if (empRes?.employees && Array.isArray(empRes.employees)) {
        const onlyActive = empRes.employees.filter(
          (e: any) => e.status === "active"
        );
        setActiveEmployees(onlyActive);

        // Extract known designations
        const titles = new Set<string>();
        for (const e of onlyActive) {
          const t = e.job_titles?.title_name || e.job_title;
          if (t && typeof t === "string") titles.add(t);
        }
        if (deptRes?.jobTitles && Array.isArray(deptRes.jobTitles)) {
          for (const jt of deptRes.jobTitles) {
            if (jt.title_name) titles.add(jt.title_name);
          }
        }
        setDesignations(Array.from(titles));
      }
    } catch {
      // Non-critical background load
    }
  }, []);

  React.useEffect(() => {
    loadDepartments();
    loadReferenceData();
  }, [loadDepartments, loadReferenceData]);

  // Open Assign / Reassign Modal
  const openAssignModal = (dept: DepartmentRecord, isReassignment = false) => {
    setTargetDept(dept);
    setSelectedEmpId(dept.headId || "");
    setSelectedDesignation(dept.headDesignation || "Department Head");
    setEffectiveStartDate(new Date().toISOString().slice(0, 10));
    setAssignmentNotes(
      isReassignment
        ? `Reassigning Department Head from ${dept.headName || "previous head"}.`
        : `Initial Department Head assignment for ${dept.name}.`
    );
    setAssignModalOpen(true);
  };

  // Open Remove Modal
  const openRemoveModal = (dept: DepartmentRecord) => {
    setTargetDept(dept);
    setRemoveModalOpen(true);
  };

  // Open History Modal
  const openHistoryModal = async (dept: DepartmentRecord) => {
    setTargetDept(dept);
    setHistoryModalOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/admin/departments/head?departmentId=${dept.id}`);
      const json = await res.json();
      if (json.history && Array.isArray(json.history)) {
        setHistoryRecords(json.history);
      } else {
        setHistoryRecords([]);
      }
    } catch {
      toast.error("Failed to load department head history.");
      setHistoryRecords([]);
    } finally {
      setHistoryLoading(false);
    }
  };

  // Handle Employee Selection in Assignment Form
  const handleEmployeeChange = (empId: string) => {
    setSelectedEmpId(empId);
    if (!empId) {
      setSelectedDesignation("");
      return;
    }
    const chosen = activeEmployees.find((e) => e.id === empId);
    if (chosen) {
      const existingTitle = chosen.job_titles?.title_name;
      if (existingTitle) {
        setSelectedDesignation(existingTitle);
      } else if (targetDept) {
        setSelectedDesignation(`Head of ${targetDept.name}`);
      }
    }
  };

  // Submit Assign / Reassign Head
  const handleSaveHead = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetDept) return;
    if (!selectedEmpId) {
      toast.error("Please select an active employee.");
      return;
    }

    setSavingHead(true);
    try {
      const res = await fetch("/api/admin/departments/head", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          departmentId: targetDept.id,
          employeeId: selectedEmpId,
          designation: selectedDesignation.trim() || "Department Head",
          effectiveStartDate: effectiveStartDate,
          notes: assignmentNotes.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to assign Department Head.");
      }

      toast.success(data.message || "Department Head assigned successfully!");
      setAssignModalOpen(false);
      setTargetDept(null);
      await loadDepartments();
    } catch (err: any) {
      toast.error(err.message || "Failed to assign Department Head.");
    } finally {
      setSavingHead(false);
    }
  };

  // Submit Remove Head
  const handleConfirmRemoveHead = async () => {
    if (!targetDept) return;
    setRemovingHead(true);
    try {
      const res = await fetch(`/api/admin/departments/head?departmentId=${targetDept.id}`, {
        method: "DELETE",
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to remove Department Head.");
      }

      toast.success(data.message || "Department Head removed successfully.");
      setRemoveModalOpen(false);
      setTargetDept(null);
      await loadDepartments();
    } catch (err: any) {
      toast.error(err.message || "Failed to remove Department Head.");
    } finally {
      setRemovingHead(false);
    }
  };

  // Create Department
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
      <div className="space-y-6 max-w-7xl mx-auto pb-12">
        <EmsNavigationHeader />

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-text-primary tracking-tight">
              Department Hierarchy Management
            </h2>
            <p className="text-xs text-text-secondary mt-0.5">
              Configure main departments, subdepartments, and assign accountable Department Heads.
            </p>
          </div>
          <button
            onClick={() => setModalOpen(true)}
            className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-purple text-white hover:bg-brand-purple/90 flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>New Department</span>
          </button>
        </div>

        {/* Departments Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-52 rounded-3xl bg-card/40 border border-border-light animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {departments.map((dept) => {
              const hasHead = Boolean(dept.headName || dept.head?.full_name);
              const headDisplayName = dept.headName || dept.head?.full_name || "Vacant";
              const headDesignation = dept.headDesignation || dept.head?.designation || (hasHead ? "Department Head" : null);
              const parentTreeName = dept.parentName || dept.parent?.name || "ZEN XEA Root";
              const isChild = Boolean(dept.parentId || dept.parent_department_id);

              return (
                <div
                  key={dept.id}
                  className="p-5 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light hover:border-brand-purple/30 transition-all shadow-sm flex flex-col justify-between space-y-4"
                >
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-2xl bg-brand-purple/10 border border-brand-purple/20 flex items-center justify-center text-brand-purple shrink-0">
                        <Building2 className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="font-bold text-sm text-text-primary leading-tight">{dept.name}</h3>
                        <p className="text-[11px] font-mono text-brand-purple font-semibold mt-0.5">{dept.code}</p>
                      </div>
                    </div>
                    {isChild ? (
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-500 border border-cyan-500/20 whitespace-nowrap">
                        Child Subdept
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-lime/20 text-black border border-lime/40 whitespace-nowrap">
                        Main Dept
                      </span>
                    )}
                  </div>

                  {/* Body Info Box */}
                  <div className="p-3.5 rounded-2xl bg-card-subtle text-xs space-y-2.5 border border-border-light/40">
                    {/* Department Head Row */}
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-medium text-text-muted">Department Head:</span>
                        {hasHead ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-status-success/15 text-status-success border border-status-success/20">
                            <Check className="w-2.5 h-2.5" />
                            Active Head
                          </span>
                        ) : (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 border border-amber-500/20">
                            Vacant
                          </span>
                        )}
                      </div>

                      {hasHead ? (
                        <div className="pt-0.5">
                          <p className="font-bold text-text-primary text-xs flex items-center gap-1.5">
                            <UserCheck className="w-3.5 h-3.5 text-brand-purple shrink-0" />
                            <span className="truncate">{headDisplayName}</span>
                          </p>
                          {headDesignation && (
                            <p className="text-[11px] text-text-secondary pl-5 truncate font-medium">
                              {headDesignation}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="text-text-muted italic text-xs pt-0.5">
                          No Department Head assigned yet.
                        </p>
                      )}
                    </div>

                    {/* Parent Tree Row */}
                    <div className="flex items-center justify-between pt-1 border-t border-border-light/40">
                      <span className="text-[11px] font-medium text-text-muted">Parent Tree:</span>
                      <span className="font-semibold text-text-primary text-[11px] truncate max-w-[170px]">
                        {parentTreeName}
                      </span>
                    </div>

                    {/* Team & Roles Metrics */}
                    <div className="flex items-center justify-between text-[11px] pt-1 border-t border-border-light/40 text-text-secondary font-medium">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3 text-text-tertiary" />
                        {dept.memberCount || 0} {dept.memberCount === 1 ? "member" : "members"}
                      </span>
                      <span className="flex items-center gap-1">
                        <Briefcase className="w-3 h-3 text-text-tertiary" />
                        {dept.rolesCount || 0} {dept.rolesCount === 1 ? "role" : "roles"}
                      </span>
                    </div>
                  </div>

                  {/* Actions Footer */}
                  <div className="pt-1 flex items-center justify-between gap-1.5 border-t border-border-light/30">
                    {hasHead ? (
                      <div className="flex items-center gap-1.5 w-full">
                        <button
                          type="button"
                          onClick={() => openAssignModal(dept, true)}
                          className="flex-1 px-2.5 py-1.5 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-[11px] font-bold text-text-primary transition-colors flex items-center justify-center gap-1 cursor-pointer"
                          title="Reassign another active employee as head"
                        >
                          <UserCheck className="w-3 h-3 text-brand-purple" />
                          <span>Reassign</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => openRemoveModal(dept)}
                          className="px-2.5 py-1.5 rounded-xl bg-card border border-border-light hover:bg-status-danger/10 hover:text-status-danger text-[11px] font-bold text-text-secondary transition-colors flex items-center justify-center gap-1 cursor-pointer"
                          title="Remove Department Head and set to Vacant"
                        >
                          <UserMinus className="w-3 h-3" />
                          <span>Remove</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => openHistoryModal(dept)}
                          className="px-2.5 py-1.5 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-[11px] font-bold text-text-secondary transition-colors flex items-center justify-center gap-1 cursor-pointer"
                          title="View historical assignment audit log"
                        >
                          <History className="w-3 h-3" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1.5 w-full">
                        <button
                          type="button"
                          onClick={() => openAssignModal(dept, false)}
                          className="flex-1 px-3 py-1.5 rounded-xl bg-brand-purple hover:bg-brand-purple/90 text-[11px] font-bold text-white transition-colors flex items-center justify-center gap-1.5 shadow-xs cursor-pointer"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Assign Department Head</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => openHistoryModal(dept)}
                          className="px-2.5 py-1.5 rounded-xl bg-card border border-border-light hover:bg-card-subtle text-[11px] font-bold text-text-secondary transition-colors flex items-center justify-center gap-1 cursor-pointer"
                          title="View historical assignment audit log"
                        >
                          <History className="w-3 h-3" />
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* 1. Modal: Create New Department */}
        {modalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl bg-card border border-border-light p-6 shadow-2xl space-y-4">
              <div className="flex items-center justify-between border-b border-border-light pb-3">
                <h3 className="text-base font-bold text-text-primary">Create New Department</h3>
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleCreate} className="space-y-3.5 text-xs">
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Department Name *</label>
                  <input
                    type="text"
                    placeholder="e.g. Quality Assurance"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:outline-none focus:border-brand-purple"
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
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary uppercase focus:outline-none focus:border-brand-purple font-mono"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Parent Department (Optional)</label>
                  <select
                    value={parentId}
                    onChange={(e) => setParentId(e.target.value)}
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:outline-none focus:border-brand-purple cursor-pointer"
                  >
                    <option value="">None (Top-Level Main Department)</option>
                    {departments.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name} ({d.code})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-light">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary hover:text-text-primary font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-5 py-2 rounded-xl bg-brand-purple text-white font-bold hover:bg-brand-purple/90 flex items-center gap-1.5 shadow-sm"
                  >
                    {submitting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    <span>{submitting ? "Creating..." : "Create Department"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 2. Modal: Assign / Reassign Department Head */}
        {assignModalOpen && targetDept && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-lg rounded-3xl bg-card border border-border-light p-6 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-border-light pb-3">
                <div>
                  <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5 text-brand-purple" />
                    <span>
                      {targetDept.headId ? "Reassign Department Head" : "Assign Department Head"}
                    </span>
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    {targetDept.headId
                      ? `Reassigning active leadership for ${targetDept.name} department.`
                      : `Assign an active employee to lead ${targetDept.name}.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setAssignModalOpen(false)}
                  className="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <form onSubmit={handleSaveHead} className="space-y-4 text-xs">
                {/* 1. Department ID / Name (Auto-selected & locked) */}
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">Department (Auto-selected)</label>
                  <div className="px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light flex items-center justify-between">
                    <span className="font-bold text-text-primary text-xs">{targetDept.name}</span>
                    <span className="font-mono text-[11px] font-bold text-brand-purple bg-brand-purple/10 px-2 py-0.5 rounded">
                      {targetDept.code}
                    </span>
                  </div>
                  <input type="hidden" value={targetDept.id} />
                </div>

                {/* 2. Employee Selection (Active Employees Only) */}
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">
                    Select Active Employee *
                  </label>
                  <select
                    value={selectedEmpId}
                    onChange={(e) => handleEmployeeChange(e.target.value)}
                    required
                    className="w-full px-3.5 py-2.5 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:outline-none focus:border-brand-purple cursor-pointer text-xs"
                  >
                    <option value="">-- Choose an active employee --</option>
                    {activeEmployees.map((emp) => (
                      <option key={emp.id} value={emp.id}>
                        {emp.full_name} ({emp.job_titles?.title_name || "No Title"}) • {emp.email}
                      </option>
                    ))}
                  </select>
                  <p className="text-[11px] text-text-tertiary mt-1">
                    Only active employees can be assigned. Inactive or exited employees are excluded.
                  </p>
                </div>

                {/* 3. Designation Selection / Input */}
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">
                    Designation / Title *
                  </label>
                  <input
                    type="text"
                    list="designation-suggestions"
                    value={selectedDesignation}
                    onChange={(e) => setSelectedDesignation(e.target.value)}
                    placeholder="e.g. Head of Technology, Lead Manager"
                    required
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:outline-none focus:border-brand-purple text-xs"
                  />
                  <datalist id="designation-suggestions">
                    {designations.map((d) => (
                      <option key={d} value={d} />
                    ))}
                  </datalist>
                  <p className="text-[11px] text-text-tertiary mt-1">
                    Displayed alongside the Department Head on the hierarchy card.
                  </p>
                </div>

                {/* 4. Effective Start Date */}
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">
                    Effective Start Date *
                  </label>
                  <div className="relative">
                    <input
                      type="date"
                      value={effectiveStartDate}
                      onChange={(e) => setEffectiveStartDate(e.target.value)}
                      required
                      className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:outline-none focus:border-brand-purple text-xs"
                    />
                  </div>
                  <p className="text-[11px] text-text-tertiary mt-1">
                    The official date this leadership assignment takes effect for audit.
                  </p>
                </div>

                {/* 5. Audit Notes (Optional) */}
                <div>
                  <label className="block font-semibold text-text-secondary mb-1">
                    Assignment Reason / Audit Notes (Optional)
                  </label>
                  <textarea
                    rows={2}
                    value={assignmentNotes}
                    onChange={(e) => setAssignmentNotes(e.target.value)}
                    placeholder="Provide any context for this leadership assignment..."
                    className="w-full px-3.5 py-2 rounded-xl bg-card-subtle border border-border-light text-text-primary focus:outline-none focus:border-brand-purple text-xs resize-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-light">
                  <button
                    type="button"
                    onClick={() => setAssignModalOpen(false)}
                    className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary hover:text-text-primary font-semibold"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingHead}
                    className="px-5 py-2 rounded-xl bg-brand-purple text-white font-bold hover:bg-brand-purple/90 flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                  >
                    {savingHead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    <span>{savingHead ? "Saving..." : "Save Assignment"}</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* 3. Modal: Remove Department Head Confirmation */}
        {removeModalOpen && targetDept && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-md rounded-3xl bg-card border border-border-light p-6 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-border-light pb-3">
                <h3 className="text-base font-bold text-text-primary text-status-danger flex items-center gap-2">
                  <UserMinus className="w-5 h-5 text-status-danger" />
                  <span>Remove Department Head</span>
                </h3>
                <button
                  type="button"
                  onClick={() => setRemoveModalOpen(false)}
                  className="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-text-secondary">
                <p>
                  Are you sure you want to remove{" "}
                  <strong className="text-text-primary font-bold">{targetDept.headName}</strong> as the
                  Department Head of <strong className="text-text-primary font-bold">{targetDept.name}</strong>?
                </p>
                <div className="p-3 rounded-xl bg-card-subtle border border-border-light space-y-1 text-[11px]">
                  <p className="font-semibold text-text-primary">Audit Impact:</p>
                  <ul className="list-disc pl-4 space-y-0.5 text-text-tertiary">
                    <li>The department status will revert to <strong className="text-amber-500">Vacant</strong>.</li>
                    <li>This removal event will be recorded in the permanent audit logs.</li>
                    <li>Historical assignment records remain preserved for compliance.</li>
                  </ul>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-border-light">
                <button
                  type="button"
                  onClick={() => setRemoveModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary hover:text-text-primary font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleConfirmRemoveHead}
                  disabled={removingHead}
                  className="px-5 py-2 rounded-xl bg-status-danger text-white font-bold hover:bg-status-danger/90 flex items-center gap-1.5 shadow-sm transition-all cursor-pointer"
                >
                  {removingHead ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5" />}
                  <span>{removingHead ? "Removing..." : "Remove Head"}</span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 4. Modal: Department Head History & Audit Log */}
        {historyModalOpen && targetDept && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-3xl bg-card border border-border-light p-6 shadow-2xl space-y-4">
              <div className="flex items-start justify-between border-b border-border-light pb-3">
                <div>
                  <h3 className="text-base font-bold text-text-primary flex items-center gap-2">
                    <History className="w-5 h-5 text-brand-purple" />
                    <span>Leadership Assignment History</span>
                  </h3>
                  <p className="text-xs text-text-secondary mt-0.5">
                    Audit log of Department Heads for{" "}
                    <strong className="text-text-primary">{targetDept.name}</strong> ({targetDept.code})
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setHistoryModalOpen(false)}
                  className="p-1 rounded-lg text-text-tertiary hover:text-text-primary hover:bg-card-subtle"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto space-y-3 pr-1 text-xs">
                {historyLoading ? (
                  <div className="p-8 text-center text-text-tertiary flex items-center justify-center gap-2">
                    <Loader2 className="w-4 h-4 animate-spin text-brand-purple" />
                    <span>Loading assignment records...</span>
                  </div>
                ) : historyRecords.length === 0 ? (
                  <div className="p-8 text-center text-text-tertiary space-y-2">
                    <Clock className="w-8 h-8 mx-auto text-text-tertiary/60" />
                    <p className="font-semibold text-text-secondary">No previous assignment records found</p>
                    <p className="text-[11px]">
                      Historical records will automatically appear here whenever a Department Head is assigned,
                      reassigned, or removed.
                    </p>
                  </div>
                ) : (
                  historyRecords.map((item) => {
                    const isRemoval = item.action === "DEPARTMENT_HEAD_REMOVED";
                    const isReassignment = item.action === "DEPARTMENT_HEAD_REASSIGNED";

                    return (
                      <div
                        key={item.id}
                        className="p-3.5 rounded-2xl bg-card-subtle border border-border-light space-y-2"
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider border",
                                isRemoval
                                  ? "bg-status-danger/15 text-status-danger border-status-danger/20"
                                  : isReassignment
                                  ? "bg-status-warning/15 text-status-warning border-status-warning/20"
                                  : "bg-status-success/15 text-status-success border-status-success/20"
                              )}
                            >
                              {isRemoval ? "Removed" : isReassignment ? "Reassigned" : "Assigned"}
                            </span>
                            <span className="font-bold text-text-primary">{item.employeeName}</span>
                          </div>

                          <span className="text-[11px] text-text-tertiary font-mono">
                            {item.createdAt ? new Date(item.createdAt).toLocaleDateString() : "—"}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-[11px] text-text-secondary pt-1 border-t border-border-light/40">
                          <div>
                            <span className="text-text-muted">Designation:</span>{" "}
                            <span className="font-semibold text-text-primary">{item.designation}</span>
                          </div>
                          <div>
                            <span className="text-text-muted">Effective:</span>{" "}
                            <span className="font-semibold text-text-primary">
                              {item.effectiveStartDate || "—"}
                              {item.effectiveEndDate ? ` to ${item.effectiveEndDate}` : " (Active)"}
                            </span>
                          </div>
                          <div className="col-span-2">
                            <span className="text-text-muted">Assigned By:</span>{" "}
                            <span className="font-medium text-text-primary">{item.assignedByName}</span>
                          </div>
                          {item.notes && (
                            <div className="col-span-2 text-[11px] text-text-tertiary italic bg-card/60 p-2 rounded-lg border border-border-light/30">
                              &ldquo;{item.notes}&rdquo;
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="pt-3 border-t border-border-light flex justify-end">
                <button
                  type="button"
                  onClick={() => setHistoryModalOpen(false)}
                  className="px-4 py-2 rounded-xl bg-card-subtle text-text-secondary hover:text-text-primary font-semibold text-xs"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
