"use client";

import * as React from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/app-shell";
import { EmsNavigationHeader } from "@/components/ems/ems-navigation-header";
import {
  Users,
  Search,
  Download,
  Building2,
  Briefcase,
  Mail,
  ExternalLink,
  Plus,
  Shield,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export default function EmsEmployeesPage() {
  const [employees, setEmployees] = React.useState<any[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [search, setSearch] = React.useState("");
  const [selectedDept, setSelectedDept] = React.useState("all");
  const [selectedCategory, setSelectedCategory] = React.useState("all");

  const loadEmployees = React.useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (search) params.set("search", search);
      if (selectedDept !== "all") params.set("departmentId", selectedDept);
      if (selectedCategory !== "all") params.set("category", selectedCategory);

      const res = await fetch(`/api/employees?${params.toString()}`);
      const data = await res.json();
      if (data.employees) {
        setEmployees(data.employees);
      }
    } catch {
      toast.error("Failed to load workforce directory");
    } finally {
      setLoading(false);
    }
  }, [search, selectedDept, selectedCategory]);

  React.useEffect(() => {
    loadEmployees();
  }, [loadEmployees]);

  const departments = React.useMemo(() => {
    const map = new Map<string, string>();
    employees.forEach((e) => {
      if (e.departments?.id && e.departments?.name) {
        map.set(e.departments.id, e.departments.name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [employees]);

  return (
    <AppShell>
      <div className="space-y-6 max-w-7xl mx-auto">
        <EmsNavigationHeader />

        {/* Toolbar */}
        <div className="p-4 rounded-2xl bg-card/60 backdrop-blur-md border border-border-light shadow-sm flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex flex-1 items-center gap-3 w-full">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-text-muted absolute left-3.5 top-3" />
              <input
                type="text"
                placeholder="Search by name, ID (e.g. ZX-EMP-001), designation..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary focus:ring-2 focus:ring-brand-purple/20 focus:border-brand-purple"
              />
            </div>

            <select
              value={selectedDept}
              onChange={(e) => setSelectedDept(e.target.value)}
              className="px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            >
              <option value="all">All Departments</option>
              {departments.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>

            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="px-3 py-2 rounded-xl bg-card-subtle border border-border-light text-xs text-text-primary"
            >
              <option value="all">All Categories</option>
              <option value="full_time">Full-Time</option>
              <option value="intern">Intern</option>
              <option value="contract">Contract</option>
              <option value="part_time">Part-Time</option>
            </select>
          </div>

          <Link
            href="/ems/employees/new"
            className="px-4 py-2 rounded-xl text-xs font-bold bg-brand-purple text-white hover:bg-brand-purple/90 shrink-0 flex items-center gap-1.5 shadow-sm"
          >
            <Plus className="w-3.5 h-3.5" />
            New Employee
          </Link>
        </div>

        {/* Employees Table */}
        {loading ? (
          <div className="h-64 rounded-3xl bg-card/40 border border-border-light animate-pulse" />
        ) : (
          <div className="rounded-3xl bg-card/60 backdrop-blur-md border border-border-light overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-border-light text-text-muted bg-card-subtle/50 font-bold uppercase tracking-wider">
                    <th className="p-4">Employee</th>
                    <th className="p-4">ID</th>
                    <th className="p-4">Department & Title</th>
                    <th className="p-4">Category</th>
                    <th className="p-4">Role</th>
                    <th className="p-4">Status</th>
                    <th className="p-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light/40">
                  {employees.map((emp) => (
                    <tr key={emp.id} className="hover:bg-card-subtle/40 transition-colors">
                      <td className="p-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-brand-purple/10 border border-brand-purple/20 flex items-center justify-center font-bold text-xs text-brand-purple">
                            {emp.full_name?.slice(0, 2).toUpperCase() || "ZX"}
                          </div>
                          <div>
                            <p className="font-bold text-text-primary">{emp.full_name}</p>
                            <p className="text-[11px] text-text-muted">{emp.email}</p>
                          </div>
                        </div>
                      </td>

                      <td className="p-4 font-mono font-semibold text-brand-purple">
                        {emp.employee_number || emp.id.slice(0, 8)}
                      </td>

                      <td className="p-4">
                        <p className="font-semibold text-text-primary">{emp.job_titles?.title_name || "Specialist"}</p>
                        <p className="text-[11px] text-text-muted">{emp.departments?.name || "General"}</p>
                      </td>

                      <td className="p-4">
                        <span
                          className={cn(
                            "text-[10px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-wider",
                            emp.employment_category === "intern"
                              ? "bg-amber-500/10 text-amber-500 border-amber-500/20"
                              : emp.employment_category === "contract"
                              ? "bg-purple-500/10 text-purple-500 border-purple-500/20"
                              : "bg-lime/20 text-black border-lime/40"
                          )}
                        >
                          {emp.employment_category?.replace("_", " ") || "Full-Time"}
                        </span>
                      </td>

                      <td className="p-4">
                        <span
                          className={cn(
                            "font-bold text-xs px-2.5 py-1 rounded-lg inline-flex items-center tracking-tight",
                            (emp.role || "").toLowerCase() === "admin"
                              ? "bg-purple-500/10 text-purple-600 border border-purple-500/20"
                              : (emp.role || "").toLowerCase() === "hr"
                              ? "bg-indigo-500/10 text-indigo-600 border border-indigo-500/20"
                              : (emp.role || "").toLowerCase() === "manager"
                              ? "bg-blue-500/10 text-blue-600 border border-blue-500/20"
                              : (emp.role || "").toLowerCase() === "team_lead"
                              ? "bg-amber-500/10 text-amber-600 border border-amber-500/20"
                              : "bg-slate-500/10 text-slate-600 border border-slate-500/20"
                          )}
                        >
                          {(emp.role || "").toLowerCase() === "admin"
                            ? "Super Admin"
                            : (emp.role || "").toLowerCase() === "hr"
                            ? "HR Lead"
                            : (emp.role || "").toLowerCase() === "manager"
                            ? "Team Manager"
                            : (emp.role || "").toLowerCase() === "team_lead"
                            ? "Team Lead"
                            : "Employee"}
                        </span>
                      </td>

                      <td className="p-4">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-lime/20 text-black border border-lime/40 uppercase">
                          {emp.status || "Active"}
                        </span>
                      </td>

                      <td className="p-4 text-right">
                        <Link
                          href={`/employees/${emp.id}`}
                          className="px-3 py-1.5 rounded-xl bg-card-subtle hover:bg-brand-purple/10 border border-border-light text-brand-purple font-semibold text-xs inline-flex items-center gap-1 transition-all"
                        >
                          360° Profile
                          <ExternalLink className="w-3 h-3" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
