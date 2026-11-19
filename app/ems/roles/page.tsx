"use client";

import * as React from "react";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/components/ems/ems-navigation-header";
import {
  ShieldCheck,
  UserCheck,
  Shield,
  CheckCircle2,
  Lock,
} from "lucide-react";
import { cn } from "@/lib/utils";

const rolesList = [
  {
    role: "Admin",
    code: "admin",
    badgeColor: "bg-rose-500/10 text-rose-500 border-rose-500/20",
    description: "Company-wide administrative authority over workforce, departments, settings, and audits.",
    permissions: [
      "Access all company workforce records",
      "Manage departments, subdepartments, and teams",
      "Provision employees and assign system roles",
      "Manage system-level configurations & policies",
      "Inspect audit logs and security settings",
    ],
  },
  {
    role: "HR Manager",
    code: "hr",
    badgeColor: "bg-purple-500/10 text-purple-500 border-purple-500/20",
    description: "Company-wide operational HR governance across all departments without restriction.",
    permissions: [
      "Company-wide employee records oversight",
      "Review and verify onboarding documents",
      "Approve attendance regularizations & leaves",
      "Manage internship lifecycles and certificates",
      "Initiate employee transfers & promotions",
    ],
  },
  {
    role: "Department Manager",
    code: "manager",
    badgeColor: "bg-brand-purple/10 text-brand-purple border-brand-purple/20",
    description: "Management authority scoped to assigned department and child subdepartments.",
    permissions: [
      "View all department employees and interns",
      "Monitor department attendance and productivity",
      "Review department leave and permission requests",
      "Assign departmental tasks and monitor KPIs",
      "Manage assigned team leads",
    ],
  },
  {
    role: "Team Lead",
    code: "team_lead",
    badgeColor: "bg-cyan-500/10 text-cyan-500 border-cyan-500/20",
    description: "Operational leadership over assigned team members and interns.",
    permissions: [
      "View assigned team members & interns",
      "Monitor daily team attendance and task progress",
      "Review team hourly permission requests",
      "Provide mentor and performance feedback",
      "Escalate issues to Department Head or HR",
    ],
  },
  {
    role: "Employee",
    code: "employee",
    badgeColor: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    description: "Self-service workforce baseline role (includes all full-time, contract, and intern staff).",
    permissions: [
      "Access own profile and update personal info",
      "Clock in/out and manage permitted breaks",
      "Submit leave and hourly permission requests",
      "View assigned tasks and performance reviews",
      "Access onboarding and permitted documents",
    ],
  },
];

export default function EmsRolesPage() {
  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <EmsNavigationHeader />

        <div>
          <h2 className="text-base font-semibold text-text-primary">System roles and permission matrix</h2>
          <p className="text-xs text-text-secondary mt-0.5">
            Pulse enforces five system security roles with database-backed Row Level Security (RLS).
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {rolesList.map((r) => (
            <div
              key={r.code}
              className="p-5 rounded-xl bg-card border border-border-light flex flex-col justify-between space-y-4"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-sm text-text-primary">{r.role}</h3>
                  <span className={cn("text-[11px] font-medium px-2 py-0.5 rounded-md border uppercase", r.badgeColor)}>
                    {r.code}
                  </span>
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">{r.description}</p>

                <div className="mt-4 pt-3 border-t border-border-light/60 space-y-2">
                  <span className="text-[11px] font-bold text-text-muted uppercase tracking-wider block">
                    Core Capabilities
                  </span>
                  <ul className="space-y-1.5 text-xs text-text-secondary">
                    {r.permissions.map((p, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0 mt-0.5" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <div className="pt-2 text-[11px] text-text-muted font-mono flex items-center gap-1.5">
                <Lock className="w-3 h-3 text-text-muted" />
                <span>Enforced by PostgreSQL RLS</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </AppShell>
  );
}
