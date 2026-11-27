"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/features/ems/components/ems-navigation-header";
import { JobTitlesManager } from "@/features/admin/components/job-titles-manager";
import { ConfirmDeleteModal } from "@/components/shared/confirm-delete-modal";
import { Briefcase, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

export default function EmsDesignationsPage() {
  const router = useRouter();
  const { userRole, isLoaded } = useAppSession();
  const isAdmin = isLoaded && userRole === "admin";
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [titles, setTitles] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [deleteTitleTarget, setDeleteTitleTarget] = React.useState<any | null>(null);
  const [deletingTitle, setDeletingTitle] = React.useState(false);

  const loadTitles = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/job-titles", { cache: "no-store" });
      const json = await res.json();
      const list = json.jobTitles || json.titles || [];
      setTitles(list);
    } catch {
      toast.error("Failed to load designations");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadTitles();
  }, [loadTitles]);

  return (
    <AppShell>
      <div className="space-y-6 w-full max-w-full min-w-0 overflow-x-hidden pb-12">
        <EmsNavigationHeader />

        {/* Toolbar */}
        <div className="flex flex-wrap sm:flex-nowrap items-start justify-between gap-4 min-w-0">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-bold text-text-primary truncate">Job Designation Management</h2>
            <p className="text-xs text-text-secondary">
              Configure job titles decoupled from system permissions and mapped to departments.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setManagerOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-brand-purple text-white hover:bg-brand-purple/90 flex items-center gap-1.5 shadow-sm shrink-0 whitespace-nowrap cursor-pointer"
          >
            <Plus className="w-3.5 h-3.5" />
            Manage Designations
          </button>
        </div>

        {/* Titles Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 min-w-0">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-28 rounded-3xl bg-card/40 border border-border-light animate-pulse min-w-0" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 min-w-0">
            {titles.map((jt) => (
              <div
                key={jt.id}
                className="p-4 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm flex items-center justify-between gap-3 hover:border-brand-purple/30 transition-all min-w-0"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className="w-10 h-10 rounded-2xl bg-brand-purple/10 border border-brand-purple/20 flex items-center justify-center text-brand-purple shrink-0">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-bold text-sm text-text-primary truncate" title={jt.title_name}>
                      {jt.title_name}
                    </h3>
                    <p className="text-xs text-text-secondary truncate mt-0.5">
                      {jt.departments?.name || "Organization-Wide"}
                    </p>
                  </div>
                </div>

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setDeleteTitleTarget(jt)}
                    aria-label={`Delete designation ${jt.title_name}`}
                    title={`Delete ${jt.title_name}`}
                    className="p-2 rounded-xl bg-card border border-rose-200 hover:bg-rose-500/10 text-rose-600 transition-colors shrink-0 cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        <JobTitlesManager
          open={managerOpen}
          onOpenChange={setManagerOpen}
          onTitlesUpdated={loadTitles}
        />

        <ConfirmDeleteModal
          open={Boolean(deleteTitleTarget)}
          title="Delete Designation"
          itemName={deleteTitleTarget?.title_name || ""}
          itemMeta={deleteTitleTarget?.departments?.name || "Organization-Wide"}
          description="Deleting this designation permanently removes the job title and safely clears designation references from any employee profiles."
          confirmLabel="Delete Designation"
          deleting={deletingTitle}
          onClose={() => {
            if (!deletingTitle) setDeleteTitleTarget(null);
          }}
          onConfirm={async () => {
            if (!deleteTitleTarget) return;
            setDeletingTitle(true);
            try {
              const res = await fetch(
                `/api/admin/job-titles?id=${encodeURIComponent(deleteTitleTarget.id)}`,
                { method: "DELETE" }
              );
              const json = await res.json().catch(() => ({}));
              if (!res.ok || !json?.success) {
                throw new Error(json?.error || "Failed to delete designation.");
              }
              toast.success(`Designation '${deleteTitleTarget.title_name}' deleted.`);
              setTitles((prev) => prev.filter((item) => item.id !== deleteTitleTarget.id));
              setDeleteTitleTarget(null);
              await loadTitles();
              router.refresh();
            } catch (err: any) {
              toast.error(err?.message || "Failed to delete designation.");
            } finally {
              setDeletingTitle(false);
            }
          }}
        />
      </div>
    </AppShell>
  );
}
