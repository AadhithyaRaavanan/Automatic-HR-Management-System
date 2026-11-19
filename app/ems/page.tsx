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
      <div className="space-y-6 max-w-7xl mx-auto">
        <EmsNavigationHeader />

        {/* Metric Cards Row */}
        <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3.5">
          <Link
            href="/ems/employees/new"
            className="p-4 rounded-[14px] bg-black text-white hover:bg-[#1A1A1A] border border-black shadow-none transition-colors flex flex-col justify-between group cursor-pointer min-w-0"
          >
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[#A6F000]">Quick Action</span>
              <div className="w-5 h-5 rounded bg-[#A6F000] text-black font-bold flex items-center justify-center text-xs">
                +
              </div>
            </div>
            <div>
              <p className="text-base font-bold text-white tracking-tight">
                Add employee
              </p>
              <p className="text-[11px] text-[#808080] mt-0.5">5-step wizard</p>
            </div>
          </Link>

          <div className="p-4 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Total workforce</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <Users className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : stats.totalEmployees || 0}
            </p>
            <p className="text-[11px] text-[#4D4D4D] font-medium mt-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#A6F000]" />
              {stats.activeEmployees || 0} Active staff
            </p>
          </div>

          <div className="p-4 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Full-time</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <UserCheck className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : stats.fullTimeEmployees || 0}
            </p>
            <p className="text-[11px] text-[#808080] mt-1">Permanent core staff</p>
          </div>

          <div className="p-4 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Active interns</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <GraduationCap className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : stats.activeInterns || 0}
            </p>
            <p className="text-[11px] text-[#808080] mt-1">Under mentorship</p>
          </div>

          <div className="p-4 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Departments</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <Building2 className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : `${stats.totalDepartments || 0}/${stats.totalTeams || 0}`}
            </p>
            <p className="text-[11px] text-[#808080] mt-1">Departments & teams</p>
          </div>

          <div className="p-4 rounded-[14px] bg-white border border-[#E6E6E6] shadow-none flex flex-col justify-between min-w-0">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Onboarding</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <UserCheck className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : stats.pendingOnboarding || 0}
            </p>
            <p className="text-[11px] text-[#808080] mt-1">Awaiting HR review</p>
          </div>
        </div>

        {/* 2-Column Analytics Bento */}
        <BentoGrid className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Department Distribution */}
          <BentoCard
            title={
              <span className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-black" />
                Department workforce distribution
              </span>
            }
            className="lg:col-span-2"
          >
            <div className="space-y-3 pt-2">
              {depts.map((d: any) => (
                <div key={d.id} className="space-y-1 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-black">{d.name}</span>
                    <span className="font-mono text-[#808080]">{d.count} Employees</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-[#E6E6E6] overflow-hidden">
                    <div
                      className="h-full bg-black rounded-full transition-all duration-500"
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
                <Network className="w-4 h-4 text-black" />
                Workforce health & vacancies
              </span>
            }
          >
            <div className="space-y-4 pt-1 text-xs">
              <div className="p-3.5 rounded-lg bg-[#F5F5F5] border border-[#E6E6E6] space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-black">Vacant leadership</span>
                  <span className="px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-800 font-bold font-mono text-[11px]">
                    {stats.vacantLeadership || 0} Positions
                  </span>
                </div>
                <p className="text-[11px] text-[#808080]">
                  Departments or teams without an appointed head or lead.
                </p>
              </div>

              <div className="space-y-2">
                <Link
                  href="/ems/employees/new"
                  className="w-full p-2.5 rounded-lg bg-[#F5F5F5] hover:bg-white border border-[#E6E6E6] text-black font-semibold flex items-center justify-between transition-colors"
                >
                  <span>Launch new employee wizard</span>
                  <ArrowRight className="w-3.5 h-3.5 text-black" />
                </Link>

                <Link
                  href="/ems/organization"
                  className="w-full p-2.5 rounded-lg bg-[#F5F5F5] hover:bg-white border border-[#E6E6E6] text-black font-semibold flex items-center justify-between transition-colors"
                >
                  <span>Inspect organization hierarchy</span>
                  <ArrowRight className="w-3.5 h-3.5 text-black" />
                </Link>

                <Link
                  href="/ems/internships"
                  className="w-full p-2.5 rounded-lg bg-[#F5F5F5] hover:bg-white border border-[#E6E6E6] text-black font-semibold flex items-center justify-between transition-colors"
                >
                  <span>Manage intern evaluations</span>
                  <ArrowRight className="w-3.5 h-3.5 text-black" />
                </Link>
              </div>
            </div>
          </BentoCard>
        </BentoGrid>
      </div>
    </AppShell>
  );
}
