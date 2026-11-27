"use client";

import * as React from "react";
import { Lock, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ProjectAssignmentType,
  resolveDepartmentInchargeLock,
} from "@/features/tasks/project-access";
import type {
  DepartmentOption,
  VisibleEmployeeOption,
} from "@/features/tasks/hooks/use-tasks";

export interface AssignmentScopeControlsProps {
  entityLabel: "Project" | "Task";
  assignmentType: ProjectAssignmentType;
  onAssignmentTypeChange: (next: ProjectAssignmentType) => void;
  departmentIds: string[];
  onDepartmentIdsChange: (next: string[]) => void;
  departments: DepartmentOption[];
  inchargeId: string;
  onInchargeIdChange: (next: string) => void;
  assigneeOptions: VisibleEmployeeOption[];
  formatPerson: (id: string | null) => string;
  formatAssigneeOptionLabel: (emp: {
    id: string;
    full_name: string | null;
    email: string;
  }) => string;
  workloadMap?: Map<string, { openCount: number; dueThisWeekCount: number }>;
  suggestedAssignees?: Array<VisibleEmployeeOption & { openCount: number }>;
  showWorkload?: boolean;
  scopeLockedProjectName?: string | null;
  assigneeLockedReason?: string | null;
  isIndividualRequired?: boolean;
  inchargeFieldLabel?: string;
  deptSelectAriaLabel: string;
  assigneeSelectAriaLabel: string;
  companyWideUnassignedLabel: string;
  individualUnassignedLabel: string;
  onAssigneeEdited?: () => void;
}

/**
 * Shared Company-Wide / Department(s) / Individual assignment selector used
 * in both Create Project and Create Task modals, with automatic Department Head
 * Incharge locking and Project-override locking.
 */
export function AssignmentScopeControls({
  entityLabel,
  assignmentType,
  onAssignmentTypeChange,
  departmentIds,
  onDepartmentIdsChange,
  departments,
  inchargeId,
  onInchargeIdChange,
  assigneeOptions,
  formatPerson,
  formatAssigneeOptionLabel,
  workloadMap,
  suggestedAssignees,
  showWorkload = false,
  scopeLockedProjectName = null,
  assigneeLockedReason = null,
  isIndividualRequired = false,
  inchargeFieldLabel = "Incharge",
  deptSelectAriaLabel,
  assigneeSelectAriaLabel,
  companyWideUnassignedLabel,
  individualUnassignedLabel,
  onAssigneeEdited,
}: AssignmentScopeControlsProps) {
  const isScopeLocked = Boolean(scopeLockedProjectName);
  const deptLock = React.useMemo(
    () =>
      assignmentType === "department"
        ? resolveDepartmentInchargeLock(departmentIds, departments)
        : { isLocked: false, lockedInchargeId: null, headIds: [], headEntries: [] },
    [assignmentType, departmentIds, departments]
  );

  const effectiveLockedAssigneeId =
    assigneeLockedReason && inchargeId
      ? inchargeId
      : !isScopeLocked && assignmentType === "department" && deptLock.isLocked
      ? deptLock.lockedInchargeId
      : null;

  const lockBadgeText = assigneeLockedReason
    ? assigneeLockedReason
    : !isScopeLocked && assignmentType === "department" && deptLock.isLocked
    ? "Department Head"
    : null;

  const formatEmployeeOption = (emp: VisibleEmployeeOption) => {
    const base = formatAssigneeOptionLabel(emp);
    if (!showWorkload || !workloadMap) return base;
    const wl = workloadMap.get(emp.id) || { openCount: 0, dueThisWeekCount: 0 };
    return `${base} — ${wl.openCount} open (${wl.dueThisWeekCount} due this week)`;
  };

  const handleSelectScope = (nextType: ProjectAssignmentType) => {
    if (isScopeLocked) return;
    onAssignmentTypeChange(nextType);
    if (nextType === "department") {
      if (departmentIds.length === 0 && departments.length > 0) {
        const firstId = departments[0].id;
        onDepartmentIdsChange([firstId]);
        const lock = resolveDepartmentInchargeLock([firstId], departments);
        onInchargeIdChange(
          lock.isLocked && lock.lockedInchargeId ? lock.lockedInchargeId : ""
        );
      }
    } else {
      onDepartmentIdsChange([]);
      onInchargeIdChange("");
    }
  };

  const renderAssigneeSelect = (
    unassignedLabel: string,
    options: VisibleEmployeeOption[],
    required: boolean
  ) => (
    <>
      <select
        required={required}
        aria-label={assigneeSelectAriaLabel}
        value={inchargeId}
        onChange={(e) => {
          onInchargeIdChange(e.target.value);
          onAssigneeEdited?.();
        }}
        className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none focus:border-black"
      >
        <option value="">{unassignedLabel}</option>
        {options.map((emp) => (
          <option key={emp.id} value={emp.id}>
            {formatEmployeeOption(emp)}
          </option>
        ))}
      </select>

      {showWorkload && suggestedAssignees && suggestedAssignees.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-bold uppercase text-[#808080]">
            Suggested:
          </span>
          {suggestedAssignees.map((emp) => (
            <button
              key={emp.id}
              type="button"
              onClick={() => {
                onInchargeIdChange(emp.id);
                onAssigneeEdited?.();
              }}
              className="px-2 py-0.5 rounded text-[10px] font-semibold bg-[#F5F5F5] border border-[#E6E6E6] hover:bg-[#E6E6E6] text-black cursor-pointer"
              title="Fewest open tasks"
            >
              {emp.full_name?.split(" ")[0] || emp.email} ({emp.openCount} open)
            </button>
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      <div>
        <div className="flex items-center justify-between gap-2 mb-1.5">
          <label className="block text-xs font-bold text-black">
            Assign {entityLabel} To
          </label>
          {isScopeLocked && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-[#F5F5F5] border border-[#E6E6E6] text-[10px] font-semibold text-[#4D4D4D]">
              <Lock className="w-2.5 h-2.5" />
              From {scopeLockedProjectName}
            </span>
          )}
        </div>
        <div
          className={cn(
            "grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6]",
            isScopeLocked && "opacity-75"
          )}
        >
          {(
            [
              { key: "company", label: "Company-Wide" },
              { key: "department", label: "Department" },
              { key: "individual", label: "Individual" },
            ] as const
          ).map((opt) => (
            <button
              key={opt.key}
              type="button"
              disabled={isScopeLocked}
              aria-pressed={assignmentType === opt.key}
              onClick={() => handleSelectScope(opt.key)}
              className={cn(
                "px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors",
                isScopeLocked ? "cursor-not-allowed" : "cursor-pointer",
                assignmentType === opt.key
                  ? "bg-black text-white shadow-xs"
                  : "text-[#4D4D4D] hover:text-black hover:bg-white"
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {assignmentType === "department" && (
        <div className="space-y-2">
          <div>
            <label className="block text-xs font-bold text-black mb-1">
              Departments *
            </label>
            {!isScopeLocked && (
              <select
                aria-label={deptSelectAriaLabel}
                value=""
                onChange={(e) => {
                  const deptId = e.target.value;
                  if (!deptId) return;
                  const next = departmentIds.includes(deptId)
                    ? departmentIds
                    : [...departmentIds, deptId];
                  onDepartmentIdsChange(next);
                }}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs text-black"
              >
                <option value="">
                  {departmentIds.length === 0
                    ? "Select department..."
                    : "Add another department..."}
                </option>
                {departments
                  .filter((d) => !departmentIds.includes(d.id))
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                      {d.department_head_id
                        ? ` (Head: ${formatPerson(d.department_head_id)})`
                        : ""}
                    </option>
                  ))}
              </select>
            )}
          </div>

          {departmentIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {departmentIds.map((deptId) => {
                const dept = departments.find((d) => d.id === deptId);
                return (
                  <span
                    key={deptId}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F5F5F5] border border-[#E6E6E6] text-[11px] font-semibold text-black"
                  >
                    <span>{dept?.name || "Department"}</span>
                    {!isScopeLocked && (
                      <button
                        type="button"
                        aria-label={`Remove ${dept?.name || "department"}`}
                        onClick={() => {
                          const next = departmentIds.filter((id) => id !== deptId);
                          onDepartmentIdsChange(next);
                          const nextLock = resolveDepartmentInchargeLock(
                            next,
                            departments
                          );
                          if (nextLock.isLocked && nextLock.lockedInchargeId) {
                            onInchargeIdChange(nextLock.lockedInchargeId);
                          } else {
                            onInchargeIdChange("");
                          }
                        }}
                        className="text-[#808080] hover:text-black cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </span>
                );
              })}
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-black mb-1">
              {inchargeFieldLabel}
            </label>
            {effectiveLockedAssigneeId && lockBadgeText ? (
              <div
                aria-label={`Locked ${assigneeSelectAriaLabel}`}
                className="w-full px-3 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {formatPerson(effectiveLockedAssigneeId)}
                </span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-[#E6E6E6] text-[10px] font-bold text-[#4D4D4D] shrink-0">
                  <Lock className="w-3 h-3" />
                  {lockBadgeText}
                </span>
              </div>
            ) : !isScopeLocked && deptLock.headIds.length > 1 ? (
              <select
                aria-label={assigneeSelectAriaLabel}
                value={inchargeId}
                onChange={(e) => {
                  onInchargeIdChange(e.target.value);
                  onAssigneeEdited?.();
                }}
                className="w-full px-3 py-2 rounded-lg bg-white border border-[#E6E6E6] text-xs font-semibold text-black focus:outline-none focus:border-black"
              >
                {deptLock.headIds.map((headId) => (
                  <option key={headId} value={headId}>
                    {formatPerson(headId)} (Department Head)
                  </option>
                ))}
              </select>
            ) : (
              renderAssigneeSelect(companyWideUnassignedLabel, assigneeOptions, false)
            )}
          </div>
        </div>
      )}

      {assignmentType === "individual" && (
        <div>
          <label className="block text-xs font-bold text-black mb-1">
            Individual ({inchargeFieldLabel}){isIndividualRequired ? " *" : ""}
          </label>
          {effectiveLockedAssigneeId && lockBadgeText ? (
            <div
              aria-label={`Locked ${assigneeSelectAriaLabel}`}
              className="w-full px-3 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black flex items-center justify-between gap-2"
            >
              <span className="truncate">
                {formatPerson(effectiveLockedAssigneeId)}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-[#E6E6E6] text-[10px] font-bold text-[#4D4D4D] shrink-0">
                <Lock className="w-3 h-3" />
                {lockBadgeText}
              </span>
            </div>
          ) : (
            renderAssigneeSelect(
              individualUnassignedLabel,
              assigneeOptions,
              isIndividualRequired
            )
          )}
        </div>
      )}

      {assignmentType === "company" && (
        <div>
          <label className="block text-xs font-bold text-black mb-1">
            {inchargeFieldLabel} (optional)
          </label>
          {effectiveLockedAssigneeId && lockBadgeText ? (
            <div
              aria-label={`Locked ${assigneeSelectAriaLabel}`}
              className="w-full px-3 py-2 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-black flex items-center justify-between gap-2"
            >
              <span className="truncate">
                {formatPerson(effectiveLockedAssigneeId)}
              </span>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-[#E6E6E6] text-[10px] font-bold text-[#4D4D4D] shrink-0">
                <Lock className="w-3 h-3" />
                {lockBadgeText}
              </span>
            </div>
          ) : (
            renderAssigneeSelect(companyWideUnassignedLabel, assigneeOptions, false)
          )}
        </div>
      )}
    </div>
  );
}
