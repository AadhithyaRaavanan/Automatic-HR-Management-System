"use client";

import * as React from "react";
import { AlertTriangle, Loader2, Trash2, X } from "lucide-react";

interface ConfirmDeleteModalProps {
  open: boolean;
  title: string;
  itemName: string;
  itemMeta?: string | null;
  description: string;
  confirmLabel?: string;
  deleting?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

export function ConfirmDeleteModal({
  open,
  title,
  itemName,
  itemMeta,
  description,
  confirmLabel = "Confirm Delete",
  deleting = false,
  onClose,
  onConfirm,
}: ConfirmDeleteModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-delete-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl bg-white dark:bg-zinc-950 border border-rose-200 dark:border-rose-900/50 p-6 shadow-xl space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
              <AlertTriangle className="w-5 h-5 text-rose-600" />
            </div>
            <div>
              <h3
                id="confirm-delete-modal-title"
                className="text-base font-bold text-zinc-900 dark:text-zinc-100"
              >
                {title}
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
          <p className="font-bold text-zinc-900 dark:text-zinc-100">{itemName}</p>
          {itemMeta && (
            <p className="text-zinc-600 dark:text-zinc-400 font-mono">{itemMeta}</p>
          )}
        </div>

        <p className="text-xs text-zinc-600 dark:text-zinc-400 leading-relaxed">
          {description}
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
            <span>{deleting ? "Deleting..." : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
