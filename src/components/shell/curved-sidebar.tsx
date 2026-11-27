"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { FEATURES } from "@/lib/features";
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
  Palette,
  Search,
  PanelLeft,
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
  group?: "main" | "settings";
}

const baseNavItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, group: "main" },
  { label: "Employees", href: "/ems", icon: Users, roles: ["hr", "admin"], group: "main" },
  { label: "Attendance", href: "/attendance", icon: Clock, group: "main" },
  { label: "Tasks", href: "/tasks", icon: CheckSquare, group: "main" },
  { label: "KPI", href: "/kpi", icon: Target, group: "main" },
  { label: "Leave", href: "/leave", icon: CalendarDays, group: "main" },
  { label: "Requests", href: "/requests", icon: FileCheck2, group: "main" },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["hr", "admin"], group: "main" },
  { label: "Locations", href: "/admin/locations", icon: MapPin, roles: ["admin"], group: "settings" },
  { label: "Shifts", href: "/admin/shifts", icon: CalendarClock, roles: ["admin"], group: "settings" },
  { label: "Audits", href: "/admin/audits", icon: ScrollText, roles: ["admin"], group: "settings" },
  { label: "Holidays", href: "/holidays", icon: CalendarDays, group: "settings" },
  { label: "Admin settings", href: "/admin/settings", icon: ShieldAlert, roles: ["admin"], group: "settings" },
];

export function CurvedSidebar({
  className,
  userRole: propRole,
  isCollapsed: controlledCollapsed,
  onToggle: controlledOnToggle,
}: {
  className?: string;
  userRole?: "employee" | "team_lead" | "manager" | "hr" | "admin";
  isCollapsed?: boolean;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const sidebar = useSidebar();
  const session = useAppSession();

  const [mounted, setMounted] = React.useState(false);
  const [transitionsEnabled, setTransitionsEnabled] = React.useState(false);
  const [mountedRole, setMountedRole] = React.useState<string | null>(null);
  const [teamMemberCount, setTeamMemberCount] = React.useState<number | null>(null);
  const [isMac, setIsMac] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
    let rafId: number | null = null;
    if (typeof window !== "undefined") {
      setIsMac(/(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent));
      const match = document.cookie.match(/(?:^|;\s*)remotehr_role=([^;]*)/);
      const cookieRole = match ? decodeURIComponent(match[1]) : null;
      const stored = localStorage.getItem("remotehr_cached_role") || cookieRole;
      if (stored) setMountedRole(stored);
      rafId = window.requestAnimationFrame(() => setTransitionsEnabled(true));
    }
    return () => {
      if (rafId !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const isCollapsed =
    typeof controlledCollapsed === "boolean"
      ? controlledCollapsed
      : (sidebar.mounted ? sidebar.isCollapsed : false);

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
    let fetchTimeout: any = null;

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

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.access_token) {
          if (isMounted) {
            const activeUsers = getStoredUsers().filter((u) => u.status === "active");
            setTeamMemberCount(activeUsers.length || 1);
          }
          return;
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

    const debouncedStorageChange = () => {
      clearTimeout(fetchTimeout);
      fetchTimeout = setTimeout(() => {
        fetchMemberCount();
      }, 500);
    };

    window.addEventListener("remotehr_storage_change", debouncedStorageChange);
    return () => {
      isMounted = false;
      clearTimeout(fetchTimeout);
      window.removeEventListener("remotehr_storage_change", debouncedStorageChange);
    };
  }, [supabase]);

  const privilegedRoles = ["admin", "hr", "manager", "team_lead"];
  const effectiveRole =
    (propRole && privilegedRoles.includes(propRole) ? propRole : null) ||
    (session.userRole && privilegedRoles.includes(session.userRole) ? session.userRole : null) ||
    (mountedRole && privilegedRoles.includes(mountedRole) ? mountedRole : null) ||
    (isDemoModeEnabled() ? "admin" : (propRole || session.userRole || "employee"));

  const navItems = React.useMemo(() => {
    const items = [...baseNavItems];
    if (isDemoModeEnabled()) {
      items.push({ label: "Gallery", href: "/gallery", icon: Palette });
    }
    return items
      .filter((item) => {
        if (item.href === "/kpi" && !FEATURES.KPI) return false;
        if (item.href === "/tasks" && !FEATURES.TASKS) return false;
        if (item.href === "/admin/locations" && !FEATURES.LOCATIONS) return false;
        if (item.href === "/admin/shifts" && !FEATURES.SHIFTS) return false;
        if (item.href === "/admin/audits" && !FEATURES.AUDITS) return false;
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
        "sticky top-0 left-0 hidden md:flex flex-col justify-between py-4 h-screen max-h-screen bg-[#000000] text-white select-none shrink-0 z-40 overflow-hidden [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0",
        transitionsEnabled && "transition-[width,padding] duration-200 ease-in-out",
        isCollapsed
          ? "w-[72px] px-2 items-center"
          : "w-[260px] px-3.5 items-stretch",
        className
      )}
      aria-label="Sidebar navigation"
      data-testid="sidebar"
      data-collapsed={isCollapsed}
    >
      {/* Top Header & Brand Section */}
      <div className="shrink-0 mb-2">
        {isCollapsed ? (
          <div className="flex flex-col items-center gap-3">
            <Link
              href="/"
              className="w-9 h-9 rounded-xl bg-[#B7FF00] flex items-center justify-center text-[#000000] font-black text-sm shadow-sm hover:opacity-90 transition-opacity"
              title="RemoteHR Home"
              aria-label="Pulse Home"
            >
              P
            </Link>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("pulse_open_command_palette"))}
              className="w-9 h-9 rounded-lg bg-[#1A1A1A] border border-[#2E2E2E] hover:border-[#4D4D4D] text-[#808080] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Search (Cmd/Ctrl+K)"
              aria-label="Search"
            >
              <Search className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <Link
                href="/"
                className="flex items-center gap-2.5 group transition-opacity hover:opacity-90 min-w-0"
                title="RemoteHR Home"
              >
                <div className="w-8 h-8 rounded-lg bg-[#B7FF00] flex items-center justify-center text-[#000000] font-black text-sm shrink-0 shadow-sm">
                  P
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-bold text-sm tracking-tight leading-tight text-white truncate">
                    Pulse
                  </span>
                  <span className="sr-only">RemoteHR</span>
                  <span className="text-[11px] text-[#808080] font-medium truncate">
                    by Zenxea
                  </span>
                </div>
              </Link>
              <button
                type="button"
                onClick={toggleSidebar}
                className="p-1.5 rounded-lg text-[#808080] hover:text-white hover:bg-[#1A1A1A] transition-colors cursor-pointer"
                title="Toggle sidebar"
                aria-label="Toggle sidebar"
              >
                <PanelLeft className="w-4 h-4" />
              </button>
            </div>

            {/* Dark Search Box matching Decko Reference */}
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent("pulse_open_command_palette"))}
              className="w-full px-3 py-2 rounded-lg bg-[#1A1A1A] border border-[#2E2E2E] hover:border-[#4D4D4D] text-[#808080] hover:text-[#B3B3B3] flex items-center justify-between text-xs transition-colors cursor-pointer group"
            >
              <div className="flex items-center gap-2 min-w-0">
                <Search className="w-3.5 h-3.5 text-[#808080] group-hover:text-[#B3B3B3] shrink-0" />
                <span className="truncate">Search here...</span>
              </div>
              <kbd className="px-1.5 py-0.5 rounded text-[10px] font-sans bg-[#262626] border border-[#333333] text-[#B3B3B3] shrink-0">
                {isMac ? "⌘K" : "Ctrl+K"}
              </kbd>
            </button>
          </div>
        )}
      </div>

      {/* Navigation Items Stack */}
      <nav
        className={cn(
          "flex-1 w-full overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 py-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden [&::-webkit-scrollbar]:w-0 [&::-webkit-scrollbar]:h-0",
          isCollapsed ? "items-center" : "items-stretch"
        )}
        style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
      >
        {(() => {
          const mainItems = navItems.filter((i) => i.group !== "settings");
          const settingsItems = navItems.filter((i) => i.group === "settings");

          const renderItem = (item: NavItem) => {
            const isActive =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;

            if (isCollapsed) {
              return (
                <div key={item.href} className="relative group shrink-0 my-0.5">
                  <Link
                    href={item.href}
                    onMouseEnter={() => router.prefetch(item.href)}
                    onFocus={() => router.prefetch(item.href)}
                    className={cn(
                      "relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150",
                      isActive
                        ? "bg-[#B7FF00] text-[#000000] font-semibold shadow-sm"
                        : "text-[#B3B3B3] hover:text-white hover:bg-[#1A1A1A]"
                    )}
                    title={item.label}
                    aria-label={item.label}
                  >
                    <Icon className={cn("w-4 h-4 shrink-0", isActive ? "text-[#000000]" : "text-[#B3B3B3] group-hover:text-white")} />

                    {item.badge && (
                      <span className="absolute -top-1 -right-1 px-1 rounded-full text-[8px] font-bold bg-[#B7FF00] text-[#000000] border border-black">
                        {item.badge}
                      </span>
                    )}
                  </Link>

                  {/* Tooltip on Hover */}
                  <div className="absolute left-full ml-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center z-50 pointer-events-none">
                    <div className="bg-[#1A1A1A] text-white text-xs font-medium px-2 py-1 rounded shadow-md border border-[#333333] whitespace-nowrap">
                      {item.label}
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <Link
                key={item.href}
                href={item.href}
                onMouseEnter={() => router.prefetch(item.href)}
                onFocus={() => router.prefetch(item.href)}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all duration-150 w-full group select-none shrink-0 text-xs",
                  isActive
                    ? "bg-[#B7FF00] text-[#000000] font-semibold shadow-sm"
                    : "text-[#B3B3B3] hover:text-white hover:bg-[#1A1A1A] font-medium"
                )}
                title={item.label}
              >
                <Icon
                  className={cn(
                    "w-4 h-4 shrink-0 transition-colors",
                    isActive ? "text-[#000000]" : "text-[#B3B3B3] group-hover:text-white"
                  )}
                />
                <span className={cn("truncate flex-1 text-left", isActive ? "text-[#000000] font-semibold" : "text-[#B3B3B3] group-hover:text-white")}>
                  {item.label}
                </span>

                {item.badge && (
                  <span
                    className={cn(
                      "px-1.5 py-0.2 rounded-full text-[9px] font-bold shrink-0",
                      isActive
                        ? "bg-[#000000] text-[#B7FF00]"
                        : "bg-[#262626] text-[#B3B3B3]"
                    )}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          };

          return (
            <>
              {!isCollapsed && (
                <div className="px-3 pt-2 pb-1 text-[11px] font-medium text-[#808080]">
                  Main menu
                </div>
              )}
              {mainItems.map(renderItem)}

              {settingsItems.length > 0 && (
                <>
                  {!isCollapsed && (
                    <div className="px-3 pt-4 pb-1 text-[11px] font-medium text-[#808080]">
                      Management
                    </div>
                  )}
                  {settingsItems.map(renderItem)}
                </>
              )}
            </>
          );
        })()}
      </nav>

      {/* Bottom Profile / Quick Action Stack */}
      <div
        className={cn(
          "shrink-0 pt-3 border-t border-[#1A1A1A] flex flex-col gap-1.5",
          isCollapsed ? "items-center" : "items-stretch"
        )}
      >
        {isCollapsed ? (
          <>
            <Link
              href="/profile"
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                pathname.startsWith("/profile")
                  ? "bg-[#B7FF00] text-[#000000]"
                  : "text-[#B3B3B3] hover:text-white hover:bg-[#1A1A1A]"
              )}
              title={mounted && session.fullName ? `${session.fullName} (Profile)` : "My profile"}
              aria-label="My profile"
            >
              <UserCircle className="w-4 h-4" />
            </Link>
            <Link
              href="/settings"
              className={cn(
                "w-9 h-9 rounded-lg flex items-center justify-center transition-colors",
                pathname.startsWith("/settings")
                  ? "bg-[#B7FF00] text-[#000000]"
                  : "text-[#B3B3B3] hover:text-white hover:bg-[#1A1A1A]"
              )}
              title="Settings"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="w-9 h-9 rounded-lg text-[#808080] hover:text-[#FF1493] hover:bg-[#1A1A1A] flex items-center justify-center transition-colors cursor-pointer"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between p-1.5 rounded-lg bg-[#1A1A1A] border border-[#262626]">
              {session.isLoaded && session.fullName ? (
                <Link
                  href="/profile"
                  className="flex items-center gap-2.5 min-w-0 flex-1 hover:opacity-90 transition-opacity"
                  title="My profile"
                >
                  <div className="w-7 h-7 rounded-full bg-[#2E2E2E] text-white flex items-center justify-center text-xs font-semibold shrink-0">
                    {session.fullName.charAt(0).toUpperCase()}
                  </div>
                  <div className="flex flex-col min-w-0 flex-1 text-left">
                    <span className="truncate font-semibold text-xs text-white">
                      {session.fullName}
                    </span>
                    <span className="text-[10px] text-[#808080] truncate capitalize">
                      {session.jobTitleName || session.userRole}
                    </span>
                  </div>
                </Link>
              ) : (
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="w-7 h-7 rounded-full bg-[#262626] animate-pulse shrink-0" />
                  <div className="flex flex-col min-w-0 flex-1 gap-1">
                    <div className="h-3 w-16 bg-[#262626] rounded animate-pulse" />
                    <div className="h-2 w-10 bg-[#262626] rounded animate-pulse" />
                  </div>
                </div>
              )}
              <button
                type="button"
                onClick={handleSignOut}
                className="p-1.5 rounded-md text-[#808080] hover:text-[#FF1493] hover:bg-[#262626] transition-colors cursor-pointer shrink-0"
                title="Sign out"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="text-[10px] text-[#808080] text-center pt-1 font-sans">
              Press {isMac ? "⌘B" : "Ctrl+B"} to collapse
            </div>
          </>
        )}
      </div>
    </aside>
  );
}
