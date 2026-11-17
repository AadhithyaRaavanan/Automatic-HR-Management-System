"use client";

import * as React from "react";
import { Search, Bell, Download } from "lucide-react";
import { ThemeToggle } from "@/components/shared/theme-toggle";
import { CommandPalette } from "@/components/shared/command-palette";
import { NotificationCenter } from "@/components/shared/notification-center";
import { useNotifications } from "@/features/notifications/hooks/use-notifications";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface TopNavBarProps {
  userRole?: "employee" | "team_lead" | "manager" | "hr" | "admin";
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  className?: string;
}

export function TopNavBar({
  className,
}: TopNavBarProps) {
  const [commandOpen, setCommandOpen] = React.useState(false);
  const [notificationsOpen, setNotificationsOpen] = React.useState(false);
  const { unreadCount } = useNotifications();

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
          "w-full flex items-center justify-end gap-2 sm:gap-3 pb-6 select-none",
          className
        )}
      >
        {/* 1. Search Bar / Command Palette Trigger */}
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

        {/* 2. Theme Toggle (Light / Dark) */}
        <ThemeToggle />

        {/* 3. Notification Bell */}
        <button
          id="notification-bell"
          data-tour="notification-bell"
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
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* 4. Export Data Button (.xlsx) */}
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
