"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/components/ems/ems-navigation-header";
import {
  GraduationCap,
  Users,
  Calendar,
  Award,
  ExternalLink,
  CheckCircle2,
  Clock,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function EmsInternshipsPage() {
  const [internships, setInternships] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function loadInternships() {
      try {
        const res = await fetch("/api/ems/internships");
        const json = await res.json();
        if (json.internships) {
          setInternships(json.internships);
        }
      } catch {
        toast.error("Failed to load internship records");
      } finally {
        setLoading(false);
      }
    }
    loadInternships();
  }, []);

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <EmsNavigationHeader />

        <div>
          <h2 className="text-base font-bold text-text-primary">Internship Program & Mentorship Hub</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Track student and graduate interns, mentor assignments, learning objectives, and completion certificates.
          </p>
        </div>

        {/* Internships Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-44 rounded-3xl bg-card/40 border border-border-light animate-pulse" />
            ))}
          </div>
        ) : internships.length === 0 ? (
          <div className="text-center py-16 bg-card/30 rounded-3xl border border-dashed border-border-light">
            <GraduationCap className="w-10 h-10 text-text-muted mx-auto mb-2 opacity-50" />
            <h3 className="text-sm font-semibold text-text-primary">No Active Internships</h3>
            <p className="text-xs text-text-secondary mt-1">
              When employees are provisioned with the &quot;Intern&quot; category, they automatically appear here.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {internships.map((intern) => (
              <div
                key={intern.id}
                className="p-5 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light hover:border-amber-500/30 transition-all shadow-sm space-y-3"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-500 font-bold">
                      {intern.employee?.full_name?.slice(0, 2).toUpperCase() || "INT"}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-text-primary">{intern.employee?.full_name}</h3>
                      <p className="text-[11px] font-mono text-amber-500 font-medium">
                        {intern.employee?.employee_number || "ZX-INT"}
                      </p>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">
                    {intern.status || "Active"}
                  </span>
                </div>

                <div className="p-3.5 rounded-2xl bg-card-subtle text-xs space-y-1.5 border border-border-light/40">
                  <div className="flex justify-between">
                    <span className="text-text-muted">Mentor:</span>
                    <span className="font-semibold text-text-primary">
                      {intern.mentor?.full_name || "Not Assigned"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Duration:</span>
                    <span className="font-semibold text-text-primary">
                      {intern.start_date} to {intern.end_date}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-text-muted">Certificate:</span>
                    <span className="font-bold text-emerald-500">
                      {intern.certificate_issued ? "Issued" : "Pending Completion"}
                    </span>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Link
                    href={`/employees/${intern.employee_id}`}
                    className="text-xs font-semibold text-brand-purple hover:underline flex items-center gap-1"
                  >
                    View Dossier
                    <ExternalLink className="w-3 h-3" />
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
