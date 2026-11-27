"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

interface DeleteEmployeeModalProps {
  open: boolean;
  employee: {
    id: string;
    full_name?: string | null;
    email?: string | null;
  } | null;
  deleting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function DeleteEmployeeModal({
  open,
  employee,
  deleting,
  onClose,
  onConfirm,
}: DeleteEmployeeModalProps) {
  if (!open || !employee) return null;

  const displayName = employee.full_name?.trim() || "this employee";
  const displayEmail = employee.email?.trim() || "No email on file";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-employee-dialog-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-950 border border-rose-200 dark:border-rose-900/50 p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h3
                id="delete-employee-dialog-title"
                className="text-base font-bold text-zinc-900 dark:text-zinc-100"
              >
                Delete Employee
              </h3>
              <p className="text-xs text-rose-600 font-semibold">
                Permanent &amp; irreversible action
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            aria-label="Close delete confirmation"
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 disabled:opacity-50 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-3.5 rounded-xl bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-800 space-y-1 text-xs">
          <p className="font-bold text-zinc-900 dark:text-zinc-100">{displayName}</p>
          <p className="text-zinc-600 dark:text-zinc-400 font-mono">{displayEmail}</p>
        </div>

        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          Deleting <span className="font-semibold text-zinc-900 dark:text-zinc-100">{displayName}</span> is{" "}
          <span className="font-semibold text-rose-600">permanent</span> and will remove their employee profile,
          organization role/membership, onboarding records, and Supabase Auth access across{" "}
          <span className="font-mono">/employees</span>, <span className="font-mono">/ems/employees</span>,{" "}
          <span className="font-mono">/admin/users</span>, and <span className="font-mono">/tasks</span>.
        </p>

        <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-zinc-200 dark:border-zinc-800">
          <button
            type="button"
            onClick={onClose}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-zinc-100 hover:bg-zinc-200 text-zinc-700 border border-zinc-200 disabled:opacity-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={deleting}
            className="px-4 py-2 rounded-lg text-xs font-bold bg-rose-600 hover:bg-rose-700 text-white shadow-xs inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
          >
            {deleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
            <span>{deleting ? "Deleting..." : "Confirm Delete Employee"}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
