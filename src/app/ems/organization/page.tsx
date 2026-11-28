"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/features/ems/components/ems-navigation-header";
import {
  GitPullRequest,
  Building2,
  Network,
  Users,
  ChevronDown,
  ChevronRight,
  UserCheck,
  Briefcase,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function EmsOrganizationTreeContent() {
  const { organizationName } = useAppSession();
  const orgDisplayName = organizationName?.trim() || "Organization";
  const orgInitials = React.useMemo(() => {
    const words = orgDisplayName.split(/\s+/).filter(Boolean);
    if (words.length >= 2) {
      return `${words[0][0]}${words[1][0]}`.toUpperCase();
    }
    return orgDisplayName.slice(0, 2).toUpperCase() || "OR";
  }, [orgDisplayName]);

  const [departments, setDepartments] = React.useState<any[]>([]);
  const [teams, setTeams] = React.useState<any[]>([]);
  const [employees, setEmployees] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [expandedDepts, setExpandedDepts] = React.useState<Record<string, boolean>>({});

  React.useEffect(() => {
    async function loadTree() {
      try {
        const [dRes, tRes, eRes] = await Promise.all([
          fetch("/api/admin/departments"),
          fetch("/api/ems/teams"),
          fetch("/api/employees"),
        ]);
        const dJson = await dRes.json();
        const tJson = await tRes.json();
        const eJson = await eRes.json();
        if (dJson.departments) {
          setDepartments(dJson.departments);
          // Expand all by default
          const exp: Record<string, boolean> = {};
          dJson.departments.forEach((d: any) => (exp[d.id] = true));
          setExpandedDepts(exp);
        }
        if (tJson.teams) setTeams(tJson.teams);
        if (eJson.employees) setEmployees(eJson.employees);
      } catch {
        toast.error("Failed to load organization hierarchy");
      } finally {
        setLoading(false);
      }
    }
    loadTree();
  }, []);

  const toggleDept = (id: string) => {
    setExpandedDepts((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const topLevelDepts = departments.filter((d) => !d.parent_department_id);

  return (
      <div className="space-y-6 max-w-7xl mx-auto">
        <EmsNavigationHeader />

        <div>
          <h2 className="text-base font-bold text-text-primary">
            {orgDisplayName} Organizational Hierarchy
          </h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Interactive reporting tree visualizing departments, subdepartments, teams, and staff.
          </p>
        </div>

        {/* Tree Container */}
        {loading ? (
          <div className="h-64 rounded-3xl bg-card/40 border border-border-light animate-pulse" />
        ) : (
          <div className="p-6 rounded-3xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm space-y-6">
            {/* Root Node */}
            <div className="p-4 rounded-xl bg-card border border-border-light flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-card-subtle border border-border-light text-text-secondary flex items-center justify-center font-medium text-xs">
                  {orgInitials}
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-text-primary">
                    {orgDisplayName} Headquarters
                  </h3>
                  <p className="text-xs text-text-secondary">Organization root</p>
                </div>
              </div>
              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-card-subtle text-text-secondary border border-border-light">
                {employees.length} employees
              </span>
            </div>

            {/* Departments Sub-tree */}
            <div className="space-y-4 pl-4 border-l-2 border-dashed border-border-light ml-5">
              {topLevelDepts.map((dept) => {
                const childDepts = departments.filter((d) => d.parent_department_id === dept.id);
                const deptTeams = teams.filter((t) => t.department_id === dept.id);
                const deptEmps = employees.filter((e) => e.department_id === dept.id);
                const isExpanded = expandedDepts[dept.id];

                return (
                  <div key={dept.id} className="space-y-3">
                    <div
                      onClick={() => toggleDept(dept.id)}
                      className="p-4 rounded-2xl bg-card-subtle hover:bg-card-subtle/80 border border-border-light cursor-pointer flex items-center justify-between transition-all"
                    >
                      <div className="flex items-center gap-3">
                        {isExpanded ? (
                          <ChevronDown className="w-4 h-4 text-brand-purple" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-text-muted" />
                        )}
                        <Building2 className="w-4 h-4 text-brand-purple" />
                        <div>
                          <span className="font-bold text-xs text-text-primary">{dept.name}</span>
                          <span className="text-[11px] text-text-muted font-mono ml-2">({dept.code})</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 text-xs">
                        <span className="text-text-muted">Head:</span>
                        <span className="font-semibold text-text-primary">
                          {dept.name === "HR Consultancy"
                            ? "Internal HR Manager"
                            : dept.head?.full_name || "Vacant"}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-brand-purple/10 text-brand-purple text-[10px] font-bold">
                          {deptEmps.length} Staff
                        </span>
                      </div>
                    </div>

                    {/* Children: Subdepartments & Teams */}
                    {isExpanded && (
                      <div className="pl-6 border-l-2 border-border-light/60 space-y-3 ml-4">
                        {/* Child Departments (e.g. SEO) */}
                        {childDepts.map((sub) => {
                          const subEmps = employees.filter((e) => e.department_id === sub.id);
                          return (
                            <div
                              key={sub.id}
                              className="p-3.5 rounded-2xl bg-card border border-cyan-500/30 flex items-center justify-between text-xs"
                            >
                              <div className="flex items-center gap-2.5">
                                <span className="w-2 h-2 rounded-full bg-cyan-500" />
                                <span className="font-bold text-text-primary">{sub.name} (Subdepartment)</span>
                                <span className="font-mono text-[10px] text-cyan-600 bg-cyan-500/10 px-1.5 py-0.5 rounded">
                                  {sub.code}
                                </span>
                              </div>
                              <span className="font-mono text-text-muted">{subEmps.length} Employees</span>
                            </div>
                          );
                        })}

                        {/* Operational Teams */}
                        {deptTeams.map((team) => (
                          <div
                            key={team.id}
                            className="p-3 rounded-2xl bg-card border border-border-light flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-2">
                              <Network className="w-3.5 h-3.5 text-brand-cyan" />
                              <span className="font-semibold text-text-primary">{team.name}</span>
                            </div>
                            <span className="text-text-muted">
                              Lead: <strong className="text-text-primary">{team.team_lead?.full_name || "Vacant"}</strong>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
  );
}

export default function EmsOrganizationTreePage() {
  return (
    <AppShell>
      <EmsOrganizationTreeContent />
    </AppShell>
  );
}
