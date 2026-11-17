"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  LayoutDashboard,
  Clock,
  Users,
  FileCheck2,
  BarChart3,
  CalendarDays,
  Settings,
  ShieldAlert,
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
  UserPlus,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { getStoredUsers } from "@/lib/storage/demo-store";
import { useSidebar } from "@/components/shell/sidebar-context";
import { useAppSession } from "@/components/shell/app-shell";

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
  { label: "Onboarding", href: "/hr/onboarding", icon: UserPlus, roles: ["hr", "admin"] },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["hr", "admin"] },
  { label: "Workforce", href: "/admin/users", icon: UserCheck, roles: ["hr", "admin"] },
  { label: "Departments", href: "/admin/departments", icon: Building, roles: ["admin"] },
  { label: "Locations", href: "/admin/locations", icon: MapPin, roles: ["admin"] },
  { label: "Shifts", href: "/admin/shifts", icon: CalendarClock, roles: ["admin"] },
  { label: "Audits", href: "/admin/audits", icon: ScrollText, roles: ["admin"] },
  { label: "Holidays", href: "/holidays", icon: CalendarDays },
  { label: "Admin Settings", href: "/admin/settings", icon: ShieldAlert, roles: ["admin"] },
];

export function CurvedSidebar({
  className,
  userRole: propRole,
  isCollapsed: controlledCollapsed,
  onToggle: controlledOnToggle,
}: {
  className?: string;
  userRole?: "employee" | "manager" | "hr" | "admin";
  isCollapsed?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const sidebar = useSidebar();
  const session = useAppSession();

  const [mounted, setMounted] = React.useState(false);
  const [mountedRole, setMountedRole] = React.useState<string | null>(null);
  const [teamMemberCount, setTeamMemberCount] = React.useState<number | null>(null);

  React.useEffect(() => {
    setMounted(true);
    if (typeof window !== "undefined") {
      const match = document.cookie.match(/(?:^|;\s*)remotehr_role=([^;]*)/);
      const cookieRole = match ? decodeURIComponent(match[1]) : null;
      const stored = localStorage.getItem("remotehr_cached_role") || cookieRole;
      if (stored) setMountedRole(stored);
    }
  }, []);

  const isCollapsed =
    typeof controlledCollapsed === "boolean"
      ? controlledCollapsed
      : (mounted ? sidebar.isCollapsed : false);

  const toggleSidebar = controlledOnToggle || sidebar.toggleSidebar;

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

  React.useEffect(() => {
    let isMounted = true;
    const fetchMemberCount = async () => {
      try {
        const res = await fetch("/api/workforce/count");
        if (res.ok) {
          const json = await res.json();
          if (isMounted && typeof json.count === "number") {
            setTeamMemberCount(json.count);
            return;
          }
        }

        const { count, error } = await supabase
          .from("employees")
          .select("id", { count: "exact", head: true })
          .eq("status", "active");

        if (isMounted) {
          if (!error && typeof count === "number") {
            setTeamMemberCount(count);
          } else {
            const activeUsers = getStoredUsers().filter((u) => u.status === "active");
            setTeamMemberCount(activeUsers.length || 1);
          }
        }
      } catch {
        if (isMounted) {
          const activeUsers = getStoredUsers().filter((u) => u.status === "active");
          setTeamMemberCount(activeUsers.length || 1);
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
    (mounted && session.userRole && privilegedRoles.includes(session.userRole) ? session.userRole : null) ||
    (mountedRole && privilegedRoles.includes(mountedRole) ? mountedRole : null) ||
    (isDemoModeEnabled() ? "admin" : (propRole || "employee"));

  const navItems = React.useMemo(() => {
    const items = [...baseNavItems];
    if (isDemoModeEnabled()) {
      items.push({ label: "Gallery", href: "/gallery", icon: Sparkles });
    }
    return items
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
        "sticky top-0 left-0 hidden md:flex flex-col justify-between py-3 h-screen max-h-screen bg-brand-purple text-white shadow-float select-none shrink-0 z-40 rounded-r-[24px] lg:rounded-r-[28px] transition-[width,padding] duration-300 ease-in-out overflow-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0",
        isCollapsed
          ? "w-[68px] lg:w-[72px] px-2 items-center"
          : "w-[240px] lg:w-[260px] px-3.5 items-stretch",
        className
      )}
      aria-label="Sidebar navigation"
      data-testid="sidebar"
      data-collapsed={isCollapsed}
    >
      {/* Top Header & Brand Section */}
      <div className="shrink-0 mb-2">
        {isCollapsed ? (
          <div className="flex flex-col items-center">
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
        ) : (
          <div className="flex items-center px-1">
            <Link
              href="/"
              className="flex items-center gap-2.5 group transition-opacity hover:opacity-95 min-w-0"
              title="RemoteHR Home"
            >
              <div className="w-8 h-8 rounded-xl bg-white/20 group-hover:bg-white/30 backdrop-blur-md flex items-center justify-center text-white transition-all shadow-inner shrink-0">
                <div className="grid grid-cols-2 gap-0.5 p-1">
                  <span className="w-1.5 h-1.5 rounded-sm bg-white" />
                  <span className="w-1.5 h-1.5 rounded-sm bg-white/70" />
                  <span className="w-1.5 h-1.5 rounded-sm bg-white/70" />
                  <span className="w-1.5 h-1.5 rounded-sm bg-white" />
                </div>
              </div>
              <div className="flex flex-col min-w-0">
                <span className="font-extrabold text-sm tracking-tight leading-tight text-white truncate">
                  RemoteHR
                </span>
                <span className="text-[10px] text-white/70 font-semibold tracking-wider uppercase truncate">
                  Workspace
                </span>
              </div>
            </Link>
          </div>
        )}
      </div>

      {/* Navigation Items Stack */}
      <nav
        className={cn(
          "flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col gap-1 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0",
          isCollapsed ? "items-center" : "items-stretch"
        )}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {navItems.map((item) => {
          const isActive =
            item.href === "/"
              ? pathname === "/"
              : pathname.startsWith(item.href);
          const Icon = item.icon;

          if (isCollapsed) {
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
                  aria-label={item.label}
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
          }

          // Expanded view: Icon and label displayed side-by-side at the same time
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-xl transition-all duration-150 w-full group select-none shrink-0",
                isActive
                  ? "bg-white text-brand-purple shadow-sm font-bold"
                  : "text-white/85 hover:text-white hover:bg-white/15 font-medium"
              )}
              title={item.label}
            >
              <Icon className="w-4 h-4 shrink-0" />
              <span className="text-xs truncate flex-1 text-left">
                {item.label}
              </span>

              {item.badge && (
                <span
                  className={cn(
                    "px-1.5 py-0.2 rounded-full text-[9px] font-bold shrink-0",
                    isActive
                      ? item.badgeColor === "green"
                        ? "bg-status-success-dot text-white"
                        : "bg-brand-purple text-white"
                      : item.badgeColor === "green"
                        ? "bg-status-success-dot text-white"
                        : "bg-white/20 text-white"
                  )}
                >
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom Profile / Quick Action Stack */}
      <div
        className={cn(
          "shrink-0 pt-2 border-t border-white/15 flex flex-col gap-1",
          isCollapsed ? "items-center" : "items-stretch"
        )}
      >
        {isCollapsed ? (
          <>
            <Link
              href="/profile"
              className={cn(
                "w-7.5 h-7.5 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center text-white transition-colors",
                pathname.startsWith("/profile")
                  ? "bg-white text-brand-purple shadow-sm"
                  : "bg-white/10 hover:bg-white/20"
              )}
              title={mounted && session.fullName ? `${session.fullName} (Profile)` : "My Profile"}
              aria-label="My Profile"
            >
              <UserCircle className="w-4 h-4" />
            </Link>
            <Link
              href="/settings"
              className={cn(
                "w-7.5 h-7.5 lg:w-8 lg:h-8 rounded-lg flex items-center justify-center text-white transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-white text-brand-purple shadow-sm"
                  : "bg-white/10 hover:bg-white/20"
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
          </>
        ) : (
          <>
            <Link
              href="/profile"
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium w-full transition-colors",
                pathname.startsWith("/profile")
                  ? "bg-white text-brand-purple shadow-sm font-bold"
                  : "text-white/85 hover:text-white hover:bg-white/15"
              )}
              title="My Profile"
            >
              <UserCircle className="w-4 h-4 shrink-0" />
              <div className="flex flex-col min-w-0 flex-1 text-left">
                <span className="truncate font-semibold">
                  {mounted && session.fullName ? session.fullName : "My Profile"}
                </span>
                <span className="text-[10px] opacity-75 truncate capitalize">
                  {mounted && session.jobTitleName
                    ? session.jobTitleName
                    : mounted
                    ? effectiveRole
                    : "Profile"}
                </span>
              </div>
            </Link>

            <Link
              href="/settings"
              className={cn(
                "flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium w-full transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-white text-brand-purple shadow-sm font-bold"
                  : "text-white/85 hover:text-white hover:bg-white/15"
              )}
              title="Account Settings"
            >
              <Settings className="w-4 h-4 shrink-0" />
              <span className="truncate flex-1 text-left">Settings</span>
            </Link>

            <button
              type="button"
              onClick={handleSignOut}
              className="flex items-center gap-3 px-3 py-2 rounded-xl text-xs font-medium w-full text-white/85 hover:text-white hover:bg-red-500/80 transition-colors cursor-pointer"
              title="Sign Out"
            >
              <LogOut className="w-4 h-4 shrink-0" />
              <span className="truncate flex-1 text-left">Sign Out</span>
            </button>

            <div className="text-[9.5px] text-white/50 text-center pt-1 font-mono tracking-wide">
              Press ⌘B to collapse
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
