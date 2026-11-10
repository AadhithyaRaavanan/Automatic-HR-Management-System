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
} from "lucide-react";
import { cn } from "@/lib/utils";

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
  { label: "Leave", href: "/leave", icon: CalendarDays },
  { label: "Team", href: "/team", icon: Users, badge: "3", badgeColor: "green", roles: ["manager", "hr", "admin"] },
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
  userRole = "employee",
}: {
  className?: string;
  userRole?: "employee" | "manager" | "hr" | "admin";
}) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const navItems = baseNavItems.filter((item) => {
    if (!item.roles) return true;
    return item.roles.includes(userRole);
  });

  return (
    <aside
      className={cn(
        "sticky top-0 left-0 hidden md:flex flex-col items-center justify-between py-4 px-2 w-[76px] lg:w-[82px] h-screen max-h-screen bg-brand-purple text-white shadow-float select-none shrink-0 z-40 rounded-r-[28px] lg:rounded-r-[32px] transition-all overflow-hidden",
        className
      )}
      aria-label="Sidebar navigation"
    >
      {/* Top Brand Logo / Icon */}
      <div className="shrink-0 mb-2">
        <Link
          href="/"
          className="w-10 h-10 rounded-2xl bg-white/20 hover:bg-white/30 backdrop-blur-md flex items-center justify-center text-white transition-all shadow-inner"
          title="RemoteHR Home"
        >
          <div className="grid grid-cols-2 gap-1 p-1">
            <span className="w-1.5 h-1.5 rounded-sm bg-white" />
            <span className="w-1.5 h-1.5 rounded-sm bg-white/70" />
            <span className="w-1.5 h-1.5 rounded-sm bg-white/70" />
            <span className="w-1.5 h-1.5 rounded-sm bg-white" />
          </div>
        </Link>
      </div>

      {/* Navigation Item Stack - Scrollable without visible scrollbars */}
      <nav className="flex-1 w-full overflow-y-auto overflow-x-hidden no-scrollbar flex flex-col items-center gap-2 py-1">
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
                  "relative flex items-center justify-center w-10 h-10 lg:w-11 lg:h-11 rounded-2xl transition-all duration-200",
                  isActive
                    ? "bg-white text-brand-purple shadow-md scale-105"
                    : "text-white/80 hover:text-white hover:bg-white/15"
                )}
                title={item.label}
              >
                <Icon className="w-4 h-4 lg:w-5 lg:h-5 shrink-0" />

                {/* Badge */}
                {item.badge && (
                  <span
                    className={cn(
                      "absolute -top-1 -right-1 px-1.5 py-0.5 rounded-full text-[9px] font-bold border-2 border-brand-purple",
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
      <div className="shrink-0 pt-2 border-t border-white/15 flex flex-col items-center gap-2">
        <Link
          href="/profile"
          className={cn(
            "w-9 h-9 lg:w-10 lg:h-10 rounded-2xl flex items-center justify-center text-white transition-colors",
            pathname.startsWith("/profile") ? "bg-white text-brand-purple shadow-sm" : "bg-white/10 hover:bg-white/20"
          )}
          title="My Profile"
          aria-label="My Profile"
        >
          <UserCircle className="w-4 h-4 lg:w-5 lg:h-5" />
        </Link>
        <Link
          href="/settings"
          className={cn(
            "w-9 h-9 lg:w-10 lg:h-10 rounded-2xl flex items-center justify-center text-white transition-colors",
            pathname.startsWith("/settings") ? "bg-white text-brand-purple shadow-sm" : "bg-white/10 hover:bg-white/20"
          )}
          title="Account Settings"
          aria-label="Account Settings"
        >
          <Settings className="w-4 h-4 lg:w-5 lg:h-5" />
        </Link>
        <button
          type="button"
          onClick={handleSignOut}
          className="w-9 h-9 lg:w-10 lg:h-10 rounded-2xl bg-white/10 hover:bg-red-500/80 flex items-center justify-center text-white transition-colors cursor-pointer"
          title="Sign Out"
          aria-label="Sign Out"
        >
          <LogOut className="w-4 h-4 lg:w-5 lg:h-5" />
        </button>
      </div>
    </aside>
  );
}

