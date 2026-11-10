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
} from "lucide-react";
import { cn } from "@/lib/utils";

const baseMobileTabs = [
  { label: "Home", href: "/", icon: LayoutDashboard },
  { label: "Attendance", href: "/attendance", icon: Clock },
  { label: "Leave", href: "/leave", icon: CalendarDays },
  { label: "Requests", href: "/requests", icon: FileCheck2 },
  { label: "Team", href: "/team", icon: Users, roles: ["manager", "hr", "admin"] },
  { label: "Reports", href: "/reports", icon: BarChart3, roles: ["hr", "admin"] },
  { label: "Profile", href: "/profile", icon: UserCircle },
];

export function BottomTabBar({
  className,
  userRole = "employee",
}: {
  className?: string;
  userRole?: "employee" | "manager" | "hr" | "admin";
}) {
  const pathname = usePathname();
  const visibleTabs = baseMobileTabs
    .filter((tab) => !tab.roles || tab.roles.includes(userRole))
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
