"use client";

import * as React from "react";
import { Bell, Download } from "lucide-react";
import { CommandPalette } from "@/components/shared/command-palette";
import { NotificationCenter } from "@/components/shared/notification-center";
import { useNotifications } from "@/features/notifications/hooks/use-notifications";
import { useAppSession } from "@/components/shell/app-shell";
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
  const session = useAppSession();

  React.useEffect(() => {
    const handleCustom = () => setCommandOpen(true);
    window.addEventListener("pulse_open_command_palette", handleCustom);
    return () => window.removeEventListener("pulse_open_command_palette", handleCustom);
  }, []);

  const handleExport = () => {
    toast.success("Preparing export", {
      description: "Downloading attendance records.",
    });
    window.open("/api/attendance/export?format=xlsx", "_blank");
  };

  const displayName = session.fullName ? session.fullName.split(" ")[0] : "there";

  return (
    <>
      <header
        className={cn(
          "w-full flex items-center justify-between gap-4 pb-6 select-none",
          className
        )}
      >
        {/* Left: Greeting & Factual Subline */}
        <div className="flex-1 flex flex-col min-w-0">
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-black truncate">
            Hello, {displayName}!
          </h1>
          <p className="text-xs text-[#808080] font-normal truncate mt-0.5">
            Here's your workplace overview.
          </p>
        </div>

        {/* Right: Actions (Notification bell with magenta dot, quiet Export, user chip) */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Notification Bell */}
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
            className="relative p-2 rounded-lg bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-black transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4 text-black" />
            {unreadCount > 0 && (
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#F00091]"
                aria-hidden="true"
              />
            )}
          </button>

          {/* Quiet Export Data Button */}
          <button
            type="button"
            onClick={handleExport}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-medium text-black transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-[#808080]" />
            <span className="hidden md:inline">Export data</span>
          </button>

          {/* User Profile Chip */}
          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-[#E6E6E6]">
            <div className="w-8 h-8 rounded-full bg-black text-[#A6F000] flex items-center justify-center font-bold text-xs select-none">
              {session.fullName ? session.fullName.charAt(0).toUpperCase() : "U"}
            </div>
            <div className="hidden lg:flex flex-col text-left">
              <span className="text-xs font-semibold text-black leading-tight truncate max-w-[140px]">
                {session.fullName || "User"}
              </span>
              <span className="text-[10px] text-[#808080] leading-tight truncate max-w-[140px] capitalize">
                {session.jobTitleName || session.userRole || ""}
              </span>
            </div>
          </div>
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
