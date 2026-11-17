"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/components/ems/ems-navigation-header";
import { JobTitlesManager } from "@/features/admin/components/job-titles-manager";
import { Briefcase, Plus, Filter } from "lucide-react";
import { toast } from "sonner";

export default function EmsDesignationsPage() {
  const [managerOpen, setManagerOpen] = React.useState(false);
  const [titles, setTitles] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  const loadTitles = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/job-titles");
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
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <EmsNavigationHeader />

        {/* Toolbar */}
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-text-primary">Job Designation Management</h2>
            <p className="text-xs text-text-secondary">
              Configure job titles decoupled from system permissions and mapped to departments.
            </p>
          </div>
          <button
            onClick={() => setManagerOpen(true)}
            className="px-3.5 py-2 rounded-xl text-xs font-bold bg-brand-purple text-white hover:bg-brand-purple/90 flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            Manage Designations
          </button>
        </div>

        {/* Titles Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-28 rounded-3xl bg-card/40 border border-border-light animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {titles.map((jt) => (
              <div
                key={jt.id}
                className="p-4 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm flex items-start gap-3 hover:border-brand-purple/30 transition-all"
              >
                <div className="w-10 h-10 rounded-2xl bg-brand-purple/10 border border-brand-purple/20 flex items-center justify-center text-brand-purple shrink-0">
                  <Briefcase className="w-5 h-5" />
                </div>
                <div className="overflow-hidden">
                  <h3 className="font-bold text-sm text-text-primary truncate">{jt.title_name}</h3>
                  <p className="text-xs text-text-secondary truncate mt-0.5">
                    {jt.departments?.name || "Organization-Wide"}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        <JobTitlesManager
          open={managerOpen}
          onOpenChange={setManagerOpen}
          onTitlesUpdated={loadTitles}
        />
      </div>
    </AppShell>
  );
}
