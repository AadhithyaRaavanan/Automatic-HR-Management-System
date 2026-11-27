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
  { label: "Onboarding reviews", href: "/hr/onboarding", icon: UserPlus },
];

export function EmsNavigationHeader({ currentTab }: EmsNavProps) {
  const pathname = usePathname();

  return (
    <div data-tour="ems-hub" data-tour-mgr="ems-department" className="space-y-4 min-w-0 w-full max-w-full">
      {/* Module Title */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-b border-border-light pb-3 min-w-0">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold text-text-primary tracking-tight">Employees</h1>
          <p className="text-xs text-text-secondary mt-0.5">
            Manage staff, teams, organizational hierarchy, and internships for Zenxea.
          </p>
        </div>
      </div>

      {/* Tabs / Sub-Navigation */}
      <nav
        aria-label="EMS sections"
        className="flex items-center gap-1.5 pb-1 w-full max-w-full overflow-x-auto no-scrollbar"
      >
        {emsNavItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/ems" && pathname?.startsWith(item.href));
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "px-2.5 2xl:px-3 py-1.5 rounded-lg text-[11px] 2xl:text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors",
                isActive
                  ? "bg-black text-white shadow-xs"
                  : "bg-white hover:bg-[#F5F5F5] text-[#808080] hover:text-black border border-[#E6E6E6]"
              )}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
