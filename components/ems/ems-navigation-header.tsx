"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  UserPlus,
  Building2,
  Network,
  ShieldCheck,
  Briefcase,
  GitPullRequest,
  GraduationCap,
  Sparkles,
  Download,
  CheckCircle2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface EmsNavProps {
  currentTab?: string;
}

export const emsNavItems = [
  { label: "Overview", href: "/ems", icon: LayoutDashboard },
  { label: "Employees", href: "/ems/employees", icon: Users },
  { label: "Departments", href: "/ems/departments", icon: Building2 },
  { label: "Teams", href: "/ems/teams", icon: Network },
  { label: "Designations", href: "/ems/designations", icon: Briefcase },
  { label: "Roles & Permissions", href: "/ems/roles", icon: ShieldCheck },
  { label: "Organization Tree", href: "/ems/organization", icon: GitPullRequest },
  { label: "Internships", href: "/ems/internships", icon: GraduationCap },
  { label: "Onboarding Hub", href: "/hr/onboarding", icon: Sparkles },
];

export function EmsNavigationHeader({ currentTab }: EmsNavProps) {
  const pathname = usePathname();

  return (
    <div className="space-y-4">
      {/* Module Title & Tagline */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border-light pb-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-bold tracking-widest uppercase text-brand-purple bg-brand-purple/10 px-2 py-0.5 rounded-full">
              EMS • Employee Management System
            </span>
            <span className="text-xs text-text-muted">• ZEN XEA HRMS</span>
          </div>
          <h1 className="text-2xl font-bold text-text-primary tracking-tight">Workforce Command Center</h1>
          <p className="text-xs text-text-secondary mt-0.5">
            Unified administration for staff, organizational hierarchy, teams, roles, designations, and internships.
          </p>
        </div>
      </div>

      {/* Tabs / Sub-Navigation */}
      <div className="flex items-center gap-1.5 overflow-x-auto pb-2 scrollbar-none">
        {emsNavItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/ems" && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition-all",
                isActive
                  ? "bg-brand-purple text-white shadow-sm"
                  : "bg-card-subtle/80 hover:bg-card-subtle text-text-secondary hover:text-text-primary border border-border-light/60"
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
