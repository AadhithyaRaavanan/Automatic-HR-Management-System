"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Search, Bell, Settings, Download, Plus, LogOut, UserCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { CommandPalette } from "@/components/shared/command-palette";
import { NotificationCenter } from "@/components/shared/notification-center";
import { useNotifications } from "@/features/notifications/hooks/use-notifications";
import { useAppSession } from "@/components/shell/app-shell";
import { cn } from "@/lib/utils";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { toast } from "sonner";

interface TopNavBarProps {
  userRole?: "employee" | "manager" | "hr" | "admin";
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  className?: string;
}

export function TopNavBar({
  userRole = "employee",
  onPrimaryAction,
  primaryActionLabel = "Quick Check-in",
  className,
}: TopNavBarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const session = useAppSession();
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const { unreadCount } = useNotifications();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  const showDemoGallery = isDemoModeEnabled();

  const navTabs: Array<{
    label: string;
    href: string;
    requiresManager?: boolean;
    requiresHR?: boolean;
    requiresAdmin?: boolean;
  }> = [
    { label: "Dashboard", href: "/" },
    { label: "Attendance", href: "/attendance" },
    { label: "Tasks", href: "/tasks" },
    { label: "KPI", href: "/kpi" },
    { label: "Leave", href: "/leave" },
    { label: "Requests", href: "/requests" },
    { label: "Holidays", href: "/holidays" },
    { label: "Profile", href: "/profile" },
    { label: "Leave Hub", href: "/hr/leave", requiresHR: true },
    { label: "Team", href: "/team", requiresManager: true },
    { label: "Reports", href: "/reports", requiresHR: true },
    { label: "Directory", href: "/admin/users", requiresHR: true },
    { label: "Departments", href: "/admin/departments", requiresAdmin: true },
    { label: "Locations", href: "/admin/locations", requiresAdmin: true },
    { label: "Shifts", href: "/admin/shifts", requiresAdmin: true },
    { label: "Admin Settings", href: "/admin/settings", requiresAdmin: true },
    { label: "Audits", href: "/admin/audits", requiresAdmin: true },
    ...(showDemoGallery ? [{ label: "Gallery", href: "/gallery" }] : []),
  ].filter((tab) => {
    if (tab.requiresManager && userRole === "employee") return false;
    if (tab.requiresHR && (userRole === "employee" || userRole === "manager"))
      return false;
    if (tab.requiresAdmin && userRole !== "admin") return false;
    return true;
  });

  const handleExport = () => {
    toast.success("Preparing Excel (.xlsx) export...", {
      description: "Generating and downloading your team attendance sheet.",
    });
    window.open("/api/attendance/export?format=xlsx", "_blank");
  };

  return (
    <>
      <header
        className={cn(
          "w-full flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 select-none",
          className
        )}
      >
        {/* Left: Role Navigation Tabs */}
        <nav
          className="flex items-center gap-1 sm:gap-2 overflow-x-auto no-scrollbar"
          aria-label="Module tabs"
        >
          {navTabs.map((tab) => {
            const isActive =
              tab.href === "/" ? pathname === "/" : pathname.startsWith(tab.href);

            return (
              <Link
                key={tab.href}
                href={tab.href}
                className={cn(
                  "px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-bold transition-all relative whitespace-nowrap cursor-pointer",
                  isActive
                    ? "text-brand-purple bg-brand-purple-light/70"
                    : "text-text-secondary hover:text-text-primary hover:bg-card-subtle"
                )}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>

        {/* Center & Right Controls */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {/* Search Bar / Command Palette Trigger */}
          <button
            type="button"
            onClick={() => setCommandOpen(true)}
            className="flex items-center gap-2 px-3.5 py-2 rounded-full bg-card-subtle hover:bg-card border border-border-light text-xs text-text-tertiary hover:text-text-primary transition-colors cursor-pointer shadow-sm group"
          >
            <Search className="w-3.5 h-3.5 text-brand-purple" />
            <span className="hidden sm:inline">Search or type command</span>
            <span className="sm:hidden">Search</span>
            <kbd className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary group-hover:text-text-primary">
              ⌘K
            </kbd>
          </button>

          {/* Theme Toggle (Segmented Control) */}
          <ThemeToggle />

          {/* Notification Bell */}
          <button
            type="button"
            title="Notifications"
            aria-label={
              unreadCount > 0
                ? `Notifications (${unreadCount} unread)`
                : "Notifications"
            }
            onClick={() => setNotificationsOpen(true)}
            className="relative p-2 rounded-full bg-card-subtle hover:bg-card border border-border-light text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-brand-purple text-white text-[9px] font-extrabold flex items-center justify-center ring-2 ring-card">
                {unreadCount > 9 ? "9+" : unreadCount}
              </span>
            )}
          </button>

          {/* User Role / Job Title & Department Badges */}
          {(session.jobTitleName || session.departmentName) && (
            <div className="hidden xl:flex items-center gap-1.5 px-3 py-1 rounded-full bg-card-subtle border border-border-light text-xs">
              {session.jobTitleName && (
                <span className="font-bold text-text-primary text-[11px] truncate max-w-[140px]">
                  {session.jobTitleName}
                </span>
              )}
              {session.jobTitleName && session.departmentName && (
                <span className="text-text-tertiary text-[10px]">•</span>
              )}
              {session.departmentName && (
                <span className="text-text-secondary text-[11px] truncate max-w-[120px]">
                  {session.departmentName}
                </span>
              )}
            </div>
          )}

          {/* My Profile Shortcut */}
          <Link
            href="/profile"
            title={
              session.fullName
                ? `${session.fullName} (${session.jobTitleName || session.userRole})`
                : "My Profile"
            }
            aria-label="My Profile"
            className={cn(
              "p-2 rounded-full border transition-colors cursor-pointer",
              pathname.startsWith("/profile")
                ? "bg-brand-purple-light text-brand-purple border-brand-purple/30"
                : "bg-card-subtle hover:bg-card border-border-light text-text-secondary hover:text-text-primary"
            )}
          >
            <UserCircle className="w-4 h-4" />
          </Link>

          {/* Settings Icon */}
          <Link
            href="/settings"
            title="Settings"
            aria-label="Settings"
            className={cn(
              "p-2 rounded-full border transition-colors cursor-pointer",
              pathname.startsWith("/settings")
                ? "bg-brand-purple-light text-brand-purple border-brand-purple/30"
                : "bg-card-subtle hover:bg-card border-border-light text-text-secondary hover:text-text-primary"
            )}
          >
            <Settings className="w-4 h-4" />
          </Link>

          {/* Sign Out Button */}
          <button
            type="button"
            title="Sign Out"
            aria-label="Sign Out"
            onClick={handleSignOut}
            className="p-2 rounded-full bg-card-subtle hover:bg-red-500/10 hover:text-red-500 border border-border-light text-text-secondary transition-colors cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
          </button>

          {/* Export Data Button with .xlsx Badge */}
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-card-subtle hover:bg-card border border-border-light text-xs font-bold text-text-primary transition-colors cursor-pointer shadow-sm"
          >
            <Download className="w-3.5 h-3.5 text-text-secondary" />
            <span className="hidden md:inline">Export data</span>
            <span className="px-1.5 py-0.2 rounded-md bg-brand-purple-light text-brand-purple text-[10px] font-mono font-extrabold uppercase">
              .xlsx
            </span>
          </button>

          {/* Primary Dark Navy Action Button */}
          {onPrimaryAction && (
            <button
              type="button"
              onClick={onPrimaryAction}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-brand-navy hover:bg-brand-navy-hover text-white text-xs font-bold transition-all shadow-sm active:scale-95 cursor-pointer border border-border-light/30"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>{primaryActionLabel}</span>
            </button>
          )}
        </div>
      </header>

      {/* Global Command Palette */}
      <CommandPalette open={commandOpen} onOpenChange={setCommandOpen} />

      {/* Slide-over Notification Center */}
      <NotificationCenter
        open={notificationsOpen}
        onOpenChange={setNotificationsOpen}
      />
    </>
  );
}
