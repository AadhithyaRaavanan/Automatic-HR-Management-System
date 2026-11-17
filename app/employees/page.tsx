"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell, useAppSession } from "@/components/shell/app-shell";
import { StatusPill } from "@/components/shared/status-pill";
import {
  Users,
  Search,
  Filter,
  Download,
  Building2,
  Briefcase,
  Mail,
  Phone,
  Calendar,
  ExternalLink,
  GraduationCap,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface EmployeeDirectoryItem {
  id: string;
  email: string;
  full_name: string;
  avatar_url?: string | null;
  phone?: string;
  employment_category: "full_time" | "part_time" | "contract" | "intern";
  employee_number: string;
  work_mode: string;
  status: string;
  joined_on: string;
  role?: string;
  departments?: { id: string; name: string; code: string } | null;
  job_titles?: { id: string; title_name: string } | null;
}

export default function EmployeeDirectoryPage() {
  const { userRole } = useAppSession();
  const [employees, setEmployees] = React.useState<EmployeeDirectoryItem[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Filters
  const [search, setSearch] = React.useState("");
  const [selectedDept, setSelectedDept] = React.useState("all");
  const [selectedCategory, setSelectedCategory] = React.useState("all");
  const [selectedStatus, setSelectedStatus] = React.useState("all");

  const loadEmployees = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (selectedDept !== "all") params.set("departmentId", selectedDept);
      if (selectedCategory !== "all") params.set("category", selectedCategory);
      if (selectedStatus !== "all") params.set("status", selectedStatus);

      const res = await fetch(`/api/employees?${params.toString()}`);
      const data = await res.json();
      if (data.employees) {
        setEmployees(data.employees);
      }
    } catch (err: any) {
      toast.error("Failed to load employee directory");
    } finally {
      setLoading(false);
    }
  }, [search, selectedDept, selectedCategory, selectedStatus]);

  React.useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  // Unique departments for filter
  const departments = React.useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((e) => {
      if (e.departments?.id && e.departments?.name) {
        map.set(e.departments.id, e.departments.name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [employees]);

  const handleExportCSV = () => {
    if (!employees.length) return;
    const headers = ["Employee ID", "Full Name", "Email", "Department", "Job Title", "Category", "Status", "Joined On"];
    const rows = employees.map((e) => [
      e.employee_number || e.id.slice(0, 8),
      `"${e.full_name || ""}"`,
      e.email,
      `"${e.departments?.name || "Unassigned"}"`,
      `"${e.job_titles?.title_name || "Unassigned"}"`,
      e.employment_category,
      e.status,
      e.joined_on,
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `ZENXEA_Employees_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success("Employee directory exported successfully!");
  };

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-bold tracking-widest uppercase text-brand-purple bg-brand-purple/10 px-2 py-0.5 rounded-full">
                ZEN XEA HRMS
              </span>
              <span className="text-xs text-text-muted">• Build Business Beyond Limits</span>
            </div>
            <h1 className="text-2xl font-bold text-text-primary tracking-tight">Employee Directory</h1>
            <p className="text-xs text-text-secondary mt-1">
              Centralized workforce registry containing full-time staff, contract personnel, and interns.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={handleExportCSV}
              className="px-4 py-2 rounded-xl text-xs font-semibold bg-card-subtle border border-border-light text-text-primary hover:bg-card-subtle/80 flex items-center gap-2 shadow-sm transition-all"
            >
              <Download className="w-3.5 h-3.5 text-brand-purple" />
              Export Directory (.csv)
            </button>
          </div>
        </div>

        {/* Search & Filter Bar */}
        <div className="p-4 rounded-2xl bg-card/60 backdrop-blur-md border border-border-light/60 shadow-sm space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Search by name, ID, email..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary placeholder:text-text-muted focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple transition-all"
              />
            </div>

            {/* Department Filter */}
            <div>
              <select
                value={selectedDept}
                onChange={(e) => setSelectedDept(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
              >
                <option value="all">All Departments</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <select
                value={selectedCategory}
                onChange={(e) => setSelectedCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
              >
                <option value="all">All Categories</option>
                <option value="full_time">Full-Time Employee</option>
                <option value="intern">Intern</option>
                <option value="contract">Contract Employee</option>
                <option value="part_time">Part-Time Employee</option>
              </select>
            </div>

            {/* Status Filter */}
            <div>
              <select
                value={selectedStatus}
                onChange={(e) => setSelectedStatus(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="probation">Probation</option>
                <option value="inactive">Inactive</option>
                <option value="exited">Exited</option>
              </select>
            </div>
          </div>
        </div>

        {/* Directory Grid */}
        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="h-44 rounded-2xl bg-card/40 border border-border-light/40 animate-pulse" />
            ))}
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-16 bg-card/30 rounded-3xl border border-dashed border-border-light">
            <Users className="w-10 h-10 text-text-muted mx-auto mb-3 opacity-60" />
            <h3 className="text-sm font-semibold text-text-primary">No employees found</h3>
            <p className="text-xs text-text-secondary mt-1">Try adjusting your filters or search keywords.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {employees.map((emp) => (
              <div
                key={emp.id}
                className="p-5 rounded-2xl bg-card/60 backdrop-blur-md border border-border-light/60 hover:border-brand-purple/40 hover:shadow-md transition-all flex flex-col justify-between group"
              >
                <div>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3">
                      <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-brand-purple/20 to-brand-cyan/20 border border-brand-purple/30 flex items-center justify-center font-bold text-sm text-brand-purple shadow-inner">
                        {emp.full_name?.slice(0, 2).toUpperCase() || "ZX"}
                      </div>
                      <div>
                        <h3 className="text-sm font-bold text-text-primary group-hover:text-brand-purple transition-colors">
                          {emp.full_name}
                        </h3>
                        <p className="text-[11px] font-mono text-brand-purple font-medium">
                          {emp.employee_number || emp.id.slice(0, 8)}
                        </p>
                      </div>
                    </div>
                    <span
                      className={cn(
                        "text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider",
                        emp.employment_category === "intern"
                          ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                          : emp.employment_category === "contract"
                          ? "bg-purple-500/10 text-purple-500 border-purple-500/20"
                          : "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
                      )}
                    >
                      {emp.employment_category.replace("_", " ")}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2 text-xs text-text-secondary">
                    <div className="flex items-center gap-2">
                      <Building2 className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      <span className="truncate">{emp.departments?.name || "General Department"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Briefcase className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      <span className="truncate">{emp.job_titles?.title_name || "Staff Member"}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Mail className="w-3.5 h-3.5 text-text-muted shrink-0" />
                      <span className="truncate">{emp.email}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-5 pt-3 border-t border-border-light/60 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-block w-2 h-2 rounded-full bg-emerald-500" />
                    <span className="text-[11px] text-text-muted capitalize">{emp.work_mode || "Remote"}</span>
                  </div>

                  <Link
                    href={`/employees/${emp.id}`}
                    className="text-xs font-semibold text-brand-purple hover:underline flex items-center gap-1 group-hover:translate-x-0.5 transition-transform"
                  >
                    View 360° Profile
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
