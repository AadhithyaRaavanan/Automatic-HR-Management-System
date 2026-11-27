"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/features/ems/components/ems-navigation-header";
import {
  GraduationCap,
  Users,
  Calendar,
  Award,
  ExternalLink,
  CheckCircle2,
  Clock,
  Search,
  Building2,
  UserCheck,
  Sparkles,
  BookOpen,
  Filter,
  ArrowUpRight,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function formatDate(d?: string | null): string {
  if (!d) return "—";
  try {
    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return d;
  }
}

function getDepartmentName(intern: any): string {
  const depts = intern.employee?.departments;
  if (!depts) return "General";
  if (Array.isArray(depts)) {
    return depts[0]?.name || "General";
  }
  return depts.name || "General";
}

function getJobTitle(intern: any): string {
  return intern.employee?.job_title || intern.job_title || "Intern";
}

export default function EmsInternshipsPage() {
  const [internships, setInternships] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [selectedDept, setSelectedDept] = React.useState("all");
  const [mentorFilter, setMentorFilter] = React.useState("all");

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

  const departmentList = React.useMemo(() => {
    const set = new Set<string>();
    internships.forEach((i) => {
      const name = getDepartmentName(i);
      if (name && name !== "General") set.add(name);
    });
    return Array.from(set).sort();
  }, [internships]);

  const filteredInternships = React.useMemo(() => {
    return internships.filter((intern) => {
      const q = search.trim().toLowerCase();
      const name = intern.employee?.full_name?.toLowerCase() || "";
      const email = intern.employee?.email?.toLowerCase() || "";
      const empNum = intern.employee?.employee_number?.toLowerCase() || "";
      const dept = getDepartmentName(intern).toLowerCase();
      const title = getJobTitle(intern).toLowerCase();
      const mentor = intern.mentor?.full_name?.toLowerCase() || "";

      const matchesSearch =
        !q ||
        name.includes(q) ||
        email.includes(q) ||
        empNum.includes(q) ||
        dept.includes(q) ||
        title.includes(q) ||
        mentor.includes(q);

      const matchesDept =
        selectedDept === "all" || getDepartmentName(intern) === selectedDept;

      const matchesMentor =
        mentorFilter === "all" ||
        (mentorFilter === "assigned" && !!intern.mentor) ||
        (mentorFilter === "unassigned" && !intern.mentor);

      return matchesSearch && matchesDept && matchesMentor;
    });
  }, [internships, search, selectedDept, mentorFilter]);

  const stats = React.useMemo(() => {
    const total = internships.length;
    const withMentor = internships.filter((i) => !!i.mentor).length;
    const certIssued = internships.filter((i) => i.certificate_issued).length;
    const deptsCount = new Set(internships.map((i) => getDepartmentName(i))).size;
    return { total, withMentor, certIssued, deptsCount };
  }, [internships]);

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <EmsNavigationHeader />

        {/* Page Title & Context */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold text-black tracking-tight flex items-center gap-2">
              <GraduationCap className="w-5 h-5 text-black" />
              Internship Program & Mentorship Hub
            </h2>
            <p className="text-xs text-[#808080] mt-0.5">
              Track student and graduate interns, mentor assignments, learning tracks, and completion certificates.
            </p>
          </div>
        </div>

        {/* Overview KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="p-4 rounded-xl bg-white border border-[#E6E6E6] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Active Interns</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <GraduationCap className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : stats.total}
            </p>
            <p className="text-[11px] text-[#808080] mt-1">Currently enrolled cohorts</p>
          </div>

          <div className="p-4 rounded-xl bg-white border border-[#E6E6E6] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Mentors Assigned</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <UserCheck className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : `${stats.withMentor}/${stats.total}`}
            </p>
            <p className="text-[11px] text-[#808080] mt-1">Active 1:1 mentorships</p>
          </div>

          <div className="p-4 rounded-xl bg-white border border-[#E6E6E6] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Departments</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <Building2 className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : stats.deptsCount}
            </p>
            <p className="text-[11px] text-[#808080] mt-1">Sponsoring business units</p>
          </div>

          <div className="p-4 rounded-xl bg-white border border-[#E6E6E6] flex flex-col justify-between">
            <div className="flex items-center justify-between text-[#808080] mb-2">
              <span className="text-xs font-semibold">Certifications</span>
              <div className="w-7 h-7 rounded-lg bg-[#F5F5F5] flex items-center justify-center text-black">
                <Award className="w-3.5 h-3.5" />
              </div>
            </div>
            <p className="text-2xl font-bold text-black tabular-nums tracking-tight">
              {loading ? "..." : stats.certIssued}
            </p>
            <p className="text-[11px] text-[#808080] mt-1">Completed & issued</p>
          </div>
        </div>

        {/* Toolbar: Search & Filters */}
        <div className="p-3 rounded-xl bg-white border border-[#E6E6E6] flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-2.5 w-full">
            <div className="relative flex-1">
              <Search className="w-3.5 h-3.5 text-[#808080] absolute left-3 top-2.5" />
              <input
                type="text"
                placeholder="Search by intern name, ID, role, or mentor..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#F5F5F5] border border-transparent focus:border-[#E6E6E6] focus:bg-white text-xs text-black placeholder:text-[#808080] transition-all outline-none"
              />
            </div>

            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[#F5F5F5] border border-transparent focus:border-[#E6E6E6] text-xs font-medium text-black cursor-pointer outline-none"
            >
              <option value="all">All Departments</option>
              {departmentList.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            <select
              value={mentorFilter}
              onChange={(e) => setMentorFilter(e.target.value)}
              className="px-3 py-1.5 rounded-lg bg-[#F5F5F5] border border-transparent focus:border-[#E6E6E6] text-xs font-medium text-black cursor-pointer outline-none"
            >
              <option value="all">All Mentors</option>
              <option value="assigned">Mentor Assigned</option>
              <option value="unassigned">Pending Mentor</option>
            </select>
          </div>

          <div className="text-xs text-[#808080] font-medium shrink-0">
            {filteredInternships.length} of {internships.length} {internships.length === 1 ? "intern" : "interns"}
          </div>
        </div>

        {/* Internships Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-56 rounded-2xl bg-white border border-[#E6E6E6] animate-pulse p-5" />
            ))}
          </div>
        ) : internships.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-2xl border border-dashed border-[#E6E6E6]">
            <GraduationCap className="w-12 h-12 text-[#808080] mx-auto mb-3 opacity-40" />
            <h3 className="text-sm font-semibold text-black">No Active Internships</h3>
            <p className="text-xs text-[#808080] mt-1 max-w-sm mx-auto">
              When employees are provisioned with an &quot;Intern&quot; designation or track, they automatically appear here.
            </p>
          </div>
        ) : filteredInternships.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-2xl border border-dashed border-[#E6E6E6]">
            <Search className="w-8 h-8 text-[#808080] mx-auto mb-2 opacity-40" />
            <p className="text-xs font-semibold text-black">No matching interns found</p>
            <p className="text-[11px] text-[#808080] mt-0.5">Try adjusting your search terms or filters.</p>
            <button
              onClick={() => {
                setSearch("");
                setSelectedDept("all");
                setMentorFilter("all");
              }}
              className="mt-3 px-3 py-1 text-xs font-semibold rounded-lg bg-[#F5F5F5] hover:bg-[#E6E6E6] text-black transition-colors"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredInternships.map((intern) => {
              const deptName = getDepartmentName(intern);
              const jobTitle = getJobTitle(intern);
              const initials =
                intern.employee?.full_name
                  ?.split(" ")
                  .map((p: string) => p[0])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join("")
                  .toUpperCase() || "IN";

              return (
                <div
                  key={intern.id}
                  className="p-5 rounded-2xl bg-white border border-[#E6E6E6] hover:border-black/30 hover:shadow-xs transition-all flex flex-col justify-between space-y-4"
                >
                  {/* Card Header */}
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3">
                        <div className="w-11 h-11 rounded-xl bg-black text-white flex items-center justify-center font-bold text-xs shrink-0 tracking-wider">
                          {initials}
                        </div>
                        <div className="min-w-0">
                          <Link
                            href={`/employees/${intern.employee_id}`}
                            className="font-bold text-sm text-black hover:underline block truncate"
                          >
                            {intern.employee?.full_name}
                          </Link>
                          <p className="text-[11px] font-mono text-[#808080] font-medium">
                            {intern.employee?.employee_number || `ZX-INT-${intern.employee_id?.slice(0, 4)?.toUpperCase()}`}
                          </p>
                        </div>
                      </div>

                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#EBF8EE] text-[#1E7E34] border border-[#C3E6CB] shrink-0">
                        {intern.status || "Active"}
                      </span>
                    </div>

                    {/* Badges */}
                    <div className="flex flex-wrap items-center gap-1.5 mt-3">
                      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-[#F5F5F5] text-black border border-[#E6E6E6]">
                        {jobTitle}
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-[#F5F5F5] text-[#555] border border-[#E6E6E6]">
                        {deptName}
                      </span>
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-md bg-white text-[#808080] border border-[#E6E6E6] capitalize">
                        {intern.employee?.work_mode || "Remote"}
                      </span>
                    </div>
                  </div>

                  {/* Program Metadata Details */}
                  <div className="p-3.5 rounded-xl bg-[#FAFAFA] text-xs space-y-2 border border-[#F0F0F0]">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#808080] font-medium">Mentor:</span>
                      {intern.mentor ? (
                        <span className="font-semibold text-black truncate max-w-[170px]" title={intern.mentor.full_name}>
                          {intern.mentor.full_name}
                        </span>
                      ) : (
                        <span className="font-medium text-[#B78103] bg-[#FFF8E6] px-1.5 py-0.5 rounded text-[10px] border border-[#FFE58F]">
                          Not Assigned
                        </span>
                      )}
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#808080] font-medium">Duration:</span>
                      <span className="font-medium text-black">
                        {formatDate(intern.start_date)} – {formatDate(intern.end_date)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center text-xs">
                      <span className="text-[#808080] font-medium">Certificate:</span>
                      <span className={cn(
                        "font-semibold text-[11px] flex items-center gap-1",
                        intern.certificate_issued ? "text-[#1E7E34]" : "text-[#808080]"
                      )}>
                        {intern.certificate_issued ? (
                          <>
                            <CheckCircle2 className="w-3 h-3 text-[#1E7E34]" />
                            Issued
                          </>
                        ) : (
                          <>
                            <Clock className="w-3 h-3 text-[#808080]" />
                            Pending Completion
                          </>
                        )}
                      </span>
                    </div>
                  </div>

                  {/* Footer Action */}
                  <div className="pt-1 flex items-center justify-between border-t border-[#F0F0F0]">
                    <span className="text-[11px] text-[#808080] truncate max-w-[150px]">
                      {intern.employee?.email}
                    </span>
                    <Link
                      href={`/employees/${intern.employee_id}`}
                      className="text-xs font-semibold text-black hover:text-[#555] flex items-center gap-1 transition-colors"
                    >
                      View Dossier
                      <ArrowUpRight className="w-3.5 h-3.5" />
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
