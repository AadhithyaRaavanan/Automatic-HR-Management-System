"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { motion } from "framer-motion";
import {
  LayoutDashboard,
  Clock,
  Users,
  FileCheck2,
  BarChart3,
  CalendarDays,
  Settings,
  ShieldAlert,
  Bell,
  Sparkles,
  Building,
  MapPin,
  CalendarClock,
  ScrollText,
  UserCheck,
  LogOut,
  FileSpreadsheet,
  UserCircle,
  CheckSquare,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredUsers } from "@/lib/storage/demo-store";

export interface NavItem {
  label: string;
  href: string;
  icon: React.ElementType;
  badge?: string | number;
  badgeColor?: "green" | "purple" | "amber";
  roles?: string[];
}

const baseNavItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Attendance", href: "/attendance", icon: Clock },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "KPI", href: "/kpi", icon: Target },
  { label: "Leave", href: "/leave", icon: CalendarDays },
  { label: "Team", href: "/team", icon: Users, badgeColor: "green", roles: ["manager", "hr", "admin"] },
  { label: "Requests", href: "/requests", icon: FileCheck2 },
  { label: "Leave Hub", href: "/hr/leave", icon: FileSpreadsheet, roles: ["hr", "admin"] },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["hr", "admin"] },
  { label: "Workforce", href: "/admin/users", icon: UserCheck, roles: ["hr", "admin"] },
  { label: "Departments", href: "/admin/departments", icon: Building, roles: ["admin"] },
  { label: "Locations", href: "/admin/locations", icon: MapPin, roles: ["admin"] },
  { label: "Shifts", href: "/admin/shifts", icon: CalendarClock, roles: ["admin"] },
  { label: "Audits", href: "/admin/audits", icon: ScrollText, roles: ["admin"] },
  { label: "Holidays", href: "/holidays", icon: CalendarDays },
];

export function CurvedSidebar({
  className,
  userRole: propRole,
}: {
  className?: string;
  userRole?: "employee" | "manager" | "hr" | "admin";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    if (typeof window !== "undefined") {
      try {
        localStorage.removeItem("remotehr_cached_session");
        localStorage.removeItem("remotehr_cached_role");
        document.cookie = "remotehr_role=; path=/; max-age=0; SameSite=Lax";
      } catch {}
    }
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const getCookieRole = () => {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(/(?:^|;\s*)remotehr_role=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const cachedRole =
    typeof window !== "undefined"
      ? (localStorage.getItem("remotehr_cached_role") as any) || getCookieRole()
      : null;

  const [mountedRole, setMountedRole] = React.useState<string | null>(null);
  const [teamMemberCount, setTeamMemberCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("remotehr_cached_role") || getCookieRole();
      if (stored) setMountedRole(stored);
    }
  }, []);

  React.useEffect(() => {
    let isMounted = true;
    const fetchMemberCount = async () => {
      try {
        const { count, error } = await supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("status", "active");

        if (isMounted) {
          if (!error && typeof count === "number") {
            setTeamMemberCount(count);
          } else {
            const activeUsers = getStoredUsers().filter((u) => u.status === "active");
            setTeamMemberCount(activeUsers.length);
          }
        }
      } catch {
        if (isMounted) {
          const activeUsers = getStoredUsers().filter((u) => u.status === "active");
          setTeamMemberCount(activeUsers.length);
        }
      }
    };

    fetchMemberCount();
    const handleStorageChange = () => fetchMemberCount();
    window.addEventListener("remotehr_storage_change", handleStorageChange);
    return () => {
      isMounted = false;
      window.removeEventListener("remotehr_storage_change", handleStorageChange);
    };
  }, [supabase]);

  const privilegedRoles = ["admin", "hr", "manager"];
  const effectiveRole =
    (propRole && privilegedRoles.includes(propRole) ? propRole : null) ||
    (mountedRole && privilegedRoles.includes(mountedRole) ? mountedRole : null) ||
    (cachedRole && privilegedRoles.includes(cachedRole) ? cachedRole : null) ||
    (isDemoModeEnabled() ? (mountedRole || cachedRole || "admin") : (mountedRole || cachedRole || propRole || "employee"));

  const navItems = React.useMemo(() => {
    return baseNavItems
      .filter((item) => {
        if (!item.roles) return true;
        return item.roles.includes(effectiveRole);
      })
      .map((item) => {
        if (item.href === "/team") {
          return {
            ...item,
            badge: teamMemberCount && teamMemberCount > 0 ? String(teamMemberCount) : undefined,
          };
        }
        return item;
      });
  }, [effectiveRole, teamMemberCount]);

  return (
    <aside
      className={cn(
        "sticky top-0 left-0 hidden md:flex flex-col items-center justify-between py-2 px-1.5 w-[68px] lg:w-[72px] h-screen max-h-screen bg-brand-purple text-white shadow-float select-none shrink-0 z-40 rounded-r-[24px] lg:rounded-r-[28px] transition-all overflow-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0",
        className
      )}
      aria-label="Sidebar navigation"
    >
      {/* Top Brand Logo / Icon */}
      <div className="shrink-0 mb-0.5">
        <Link
          href="/"
          className="w-8 h-8 rounded-xl bg-white/20 hover:bg-white/30 backdrop-blur-md flex items-center justify-center text-white transition-all shadow-inner"
          title="RemoteHR Home"
        >
          <div className="grid grid-cols-2 gap-0.5 p-1">
            <span className="w-1.5 h-1.5 rounded-sm bg-white" />
            <span className="w-1.5 h-1.5 rounded-sm bg-white/70" />
            <span className="w-1.5 h-1.5 rounded-sm bg-white/70" />
            <span className="w-1.5 h-1.5 rounded-sm bg-white" />
          </div>
        </Link>
      </div>

      {/* Navigation Item Stack - Scrollable without visible scrollbars */}
      <nav
        className="flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col items-center gap-1 py-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0"
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          return (
            <div key={item.href} className="relative group shrink-0">
              <Link
                href={item.href}
                className={cn(
                  "relative flex items-center justify-center w-8 h-8 lg:w-8.5 lg:h-8.5 rounded-xl transition-all duration-150",
                  isActive
                    ? "bg-white text-brand-purple shadow-md scale-105"
                    : "text-white/80 hover:text-white hover:bg-white/15"
                )}
                title={item.label}
              >
                <Icon className="w-4 h-4 shrink-0" />

                {/* Badge */}
                {item.badge && (
                  <span
                    className={cn(
                      "absolute -top-1 -right-1 px-1.5 py-0.2 rounded-full text-[8.5px] font-bold border border-brand-purple",
                      item.badgeColor === "green"
                        ? "bg-status-success-dot text-white"
                        : "bg-status-warning-dot text-brand-navy"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>

              {/* Floating Tooltip on Hover */}
              <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center z-50 pointer-events-none">
                <div className="bg-brand-navy text-white text-xs font-semibold px-2.5 py-1.5 rounded-xl shadow-lg whitespace-nowrap border border-border-light/30">
                  {item.label}
                </div>
              </div>
            </div>
          );
        })}
      </nav>

      {/* Bottom Profile / Quick Action */}
      <div className="shrink-0 pt-1.5 border-t border-white/15 flex flex-col items-center gap-1">
        <Link
          href="/profile"
          className={cn(
            "w-7.5 h-7.5 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center text-white transition-colors",
            pathname.startsWith("/profile") ? "bg-white text-brand-purple shadow-sm" : "bg-white/10 hover:bg-white/20"
          )}
          title="My Profile"
          aria-label="My Profile"
        >
          <UserCircle className="w-4 h-4" />
        </Link>
        <Link
          href="/settings"
          className={cn(
            "w-7.5 h-7.5 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center text-white transition-colors",
            pathname.startsWith("/settings") ? "bg-white text-brand-purple shadow-sm" : "bg-white/10 hover:bg-white/20"
          )}
          title="Account Settings"
          aria-label="Account Settings"
        >
          <Settings className="w-4 h-4" />
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-7.5 h-7.5 lg:w-8 lg:h-8 rounded-lg bg-white/10 hover:bg-red-500/80 flex items-center justify-center text-white transition-colors cursor-pointer"
          title="Sign Out"
          aria-label="Sign Out"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </aside>
  );
}

