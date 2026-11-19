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
    toast.success("Preparing export", {
      description: "Downloading attendance records.",
    });
    window.open("/api/attendance/export?format=xlsx", "_blank");
  };

  return (
    <>
      <header
        className={cn(
          "w-full flex items-center justify-end gap-2 pb-5 select-none",
          className
        )}
      >
        {/* 1. Search Bar / Command Palette Trigger */}
        <button
          type="button"
          onClick={() => setCommandOpen(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-card hover:bg-card-subtle border border-border-light text-xs text-text-secondary hover:text-text-primary transition-colors cursor-pointer group"
        >
          <Search className="w-3.5 h-3.5 text-text-tertiary group-hover:text-text-primary" />
          <span className="hidden sm:inline">Search or type command</span>
          <span className="sm:hidden">Search</span>
          <kbd className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-sans bg-card-subtle border border-border-light text-text-tertiary">
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
          className="relative p-2 rounded-lg bg-card hover:bg-card-subtle border border-border-light text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 min-w-[15px] h-3.5 px-0.5 rounded-full bg-brand-purple text-white text-[9px] font-semibold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>

        {/* 4. Export Data Button */}
        <button
          type="button"
          onClick={handleExport}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-card hover:bg-card-subtle border border-border-light text-xs font-medium text-text-primary transition-colors cursor-pointer"
        >
          <Download className="w-3.5 h-3.5 text-text-secondary" />
          <span className="hidden md:inline">Export data</span>
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
