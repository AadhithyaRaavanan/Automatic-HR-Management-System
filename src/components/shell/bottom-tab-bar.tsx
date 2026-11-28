"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Clock,
  Users,
  FileCheck2,
  BarChart3,
  CalendarDays,
  UserCircle,
  CheckSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FEATURES } from "@/lib/features";
import { useAppSession } from "@/components/shell/app-shell";

const baseMobileTabs = [
  { label: "Home", href: "/", icon: LayoutDashboard },
  { label: "EMS Hub", href: "/ems", icon: Users, roles: ["hr", "admin"] },
  { label: "Attendance", href: "/attendance", icon: Clock },
  { label: "Tasks", href: "/tasks", icon: CheckSquare },
  { label: "Leave", href: "/leave", icon: CalendarDays },
  { label: "Requests", href: "/requests", icon: FileCheck2 },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["hr", "admin"] },
  { label: "Profile", href: "/profile", icon: UserCircle },
];

export function BottomTabBar({
  className,
  userRole: propRole,
}: {
  className?: string;
  userRole?: "employee" | "team_lead" | "manager" | "hr" | "admin";
}) {
  const pathname = usePathname();
  const session = useAppSession();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const getCookieRole = () => {
    if (typeof document === "undefined") return null;
    const match = document.cookie.match(/(?:^|;\s*)remotehr_role=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  };

  const cachedRole =
    mounted && typeof window !== "undefined"
      ? (localStorage.getItem("remotehr_cached_role") as any) || getCookieRole()
      : null;

  const userRole = propRole
    ? propRole
    : session.isLoaded
    ? session.userRole
    : cachedRole || session.userRole || "employee";

  const visibleTabs = baseMobileTabs
    .filter((tab) => {
      if (tab.href === "/tasks" && !FEATURES.TASKS) return false;
      if (!tab.roles) return true;
      return tab.roles.includes(userRole);
    })
    .slice(0, 5);

  return (
    <nav
      className={cn(
        "md:hidden fixed bottom-0 left-0 right-0 z-40 bg-card/95 backdrop-blur-md border-t border-border-light px-2 py-2 flex items-center justify-around shadow-shell",
        className
      )}
      aria-label="Mobile Navigation"
    >
      {visibleTabs.map((tab) => {
        const isActive =
          tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);
        const Icon = tab.icon;

        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "flex flex-col items-center gap-1 py-1 px-2.5 rounded-2xl text-xs font-semibold transition-all",
              isActive
                ? "text-brand-purple bg-brand-purple-light/50"
                : "text-text-tertiary hover:text-text-primary"
            )}
          >
            <Icon className="w-5 h-5" />
            <span className="text-[11px]">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
