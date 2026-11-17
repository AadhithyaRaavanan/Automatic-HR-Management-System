"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/components/ems/ems-navigation-header";
import { BentoGrid } from "@/components/bento/bento-grid";
import { BentoCard } from "@/components/bento/bento-card";
import {
  Users,
  Building2,
  Network,
  GraduationCap,
  Sparkles,
  ShieldAlert,
  ArrowRight,
  TrendingUp,
  UserCheck,
  CheckCircle2,
  Clock,
  Briefcase,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function EmsOverviewPage() {
  const [data, setData] = React.useState<any>(null);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    async function fetchStats() {
      try {
        const res = await fetch("/api/ems/overview");
        const json = await res.json();
        setData(json);
      } catch {
        toast.error("Failed to load EMS overview metrics");
      } finally {
        setLoading(false);
      }
    }
    fetchStats();
  }, []);

  const stats = data?.stats || {};
  const depts = data?.deptDistribution || [];
  const categories = data?.categoryDistribution || [];

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        <EmsNavigationHeader />

        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
          <Link
            href="/ems/employees/new"
            className="p-4 rounded-2xl bg-gradient-to-br from-brand-purple/20 via-card/60 to-brand-cyan/10 backdrop-blur-md border border-brand-purple/40 hover:border-brand-purple shadow-sm hover:shadow-md transition-all flex flex-col justify-between group cursor-pointer"
          >
            <div className="flex items-center justify-between text-brand-purple mb-2">
              <span className="text-xs font-bold uppercase tracking-wider">Quick Action</span>
              <div className="w-6 h-6 rounded-lg bg-brand-purple text-white flex items-center justify-center shadow-sm group-hover:scale-110 transition-transform">
                +
              </div>
            </div>
            <div>
              <p className="text-base font-extrabold text-text-primary tracking-tight group-hover:text-brand-purple transition-colors">
                Add Employee
              </p>
              <p className="text-[11px] text-text-muted mt-0.5">5-Step Wizard</p>
            </div>
          </Link>

          <div className="p-4 rounded-2xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm">
            <div className="flex items-center justify-between text-text-muted mb-2">
              <span className="text-xs font-semibold">Total Workforce</span>
              <Users className="w-4 h-4 text-brand-purple" />
            </div>
            <p className="text-2xl font-extrabold text-text-primary tracking-tight">
              {loading ? "..." : stats.totalEmployees || 0}
            </p>
            <p className="text-[11px] text-emerald-500 font-medium mt-1">
              {stats.activeEmployees || 0} Active Staff
            </p>
          </div>

          <div className="p-4 rounded-2xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm">
            <div className="flex items-center justify-between text-text-muted mb-2">
              <span className="text-xs font-semibold">Full-Time</span>
              <UserCheck className="w-4 h-4 text-emerald-500" />
            </div>
            <p className="text-2xl font-extrabold text-text-primary tracking-tight">
              {loading ? "..." : stats.fullTimeEmployees || 0}
            </p>
            <p className="text-[11px] text-text-muted mt-1">Permanent Core Staff</p>
          </div>

          <div className="p-4 rounded-2xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm">
            <div className="flex items-center justify-between text-text-muted mb-2">
              <span className="text-xs font-semibold">Active Interns</span>
              <GraduationCap className="w-4 h-4 text-amber-500" />
            </div>
            <p className="text-2xl font-extrabold text-text-primary tracking-tight">
              {loading ? "..." : stats.activeInterns || 0}
            </p>
            <p className="text-[11px] text-amber-500 font-medium mt-1">Under Mentorship</p>
          </div>

          <div className="p-4 rounded-2xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm">
            <div className="flex items-center justify-between text-text-muted mb-2">
              <span className="text-xs font-semibold">Departments & Teams</span>
              <Building2 className="w-4 h-4 text-brand-cyan" />
            </div>
            <p className="text-2xl font-extrabold text-text-primary tracking-tight">
              {loading ? "..." : `${stats.totalDepartments || 0} / ${stats.totalTeams || 0}`}
            </p>
            <p className="text-[11px] text-text-muted mt-1">Org Tree Nodes</p>
          </div>

          <div className="p-4 rounded-2xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm">
            <div className="flex items-center justify-between text-text-muted mb-2">
              <span className="text-xs font-semibold">Pending Onboarding</span>
              <Sparkles className="w-4 h-4 text-rose-500" />
            </div>
            <p className="text-2xl font-extrabold text-text-primary tracking-tight">
              {loading ? "..." : stats.pendingOnboarding || 0}
            </p>
            <p className="text-[11px] text-rose-500 font-medium mt-1">Awaiting HR Review</p>
          </div>
        </div>

        {/* 2-Column Analytics Bento */}
        <BentoGrid className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Department Distribution */}
          <BentoCard
            title={
              <span className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-brand-purple" />
                Department Workforce Distribution
              </span>
            }
            className="lg:col-span-2"
          >
            <div className="space-y-3 pt-2">
              {depts.map((d: any) => (
                <div key={d.id} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-text-primary">{d.name}</span>
                    <span className="font-mono text-text-secondary">{d.count} Employees</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-card-subtle overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-brand-purple to-brand-cyan rounded-full transition-all duration-500"
                      style={{
                        width: `${stats.totalEmployees ? (d.count / stats.totalEmployees) * 100 : 15}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </BentoCard>

          {/* Quick Shortcuts & Vacancies */}
          <BentoCard
            title={
              <span className="flex items-center gap-2">
                <Network className="w-4 h-4 text-brand-cyan" />
                Workforce Health & Vacancies
              </span>
            }
          >
            <div className="space-y-4 pt-1 text-xs">
              <div className="p-3.5 rounded-2xl bg-card-subtle border border-border-light/60 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-text-primary">Vacant Leadership</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 font-bold font-mono">
                    {stats.vacantLeadership || 0} Positions
                  </span>
                </div>
                <p className="text-[11px] text-text-muted">
                  Departments or teams without an appointed head or lead.
                </p>
              </div>

              <div className="space-y-2">
                <Link
                  href="/ems/employees/new"
                  className="w-full p-2.5 rounded-xl bg-card-subtle hover:bg-brand-purple/10 border border-border-light text-text-primary font-semibold flex items-center justify-between transition-all"
                >
                  <span>Launch New Employee Wizard</span>
                  <ArrowRight className="w-3.5 h-3.5 text-brand-purple" />
                </Link>

                <Link
                  href="/ems/organization"
                  className="w-full p-2.5 rounded-xl bg-card-subtle hover:bg-brand-cyan/10 border border-border-light text-text-primary font-semibold flex items-center justify-between transition-all"
                >
                  <span>Inspect Organization Hierarchy</span>
                  <ArrowRight className="w-3.5 h-3.5 text-brand-cyan" />
                </Link>

                <Link
                  href="/ems/internships"
                  className="w-full p-2.5 rounded-xl bg-card-subtle hover:bg-amber-500/10 border border-border-light text-text-primary font-semibold flex items-center justify-between transition-all"
                >
                  <span>Manage Intern Evaluations</span>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-500" />
                </Link>
              </div>
            </div>
          </BentoCard>
        </BentoGrid>
      </div>
    </AppShell>
  );
}
