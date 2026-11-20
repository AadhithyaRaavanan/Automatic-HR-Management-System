"use client";

import * as React from "react";
import { usePathname } from "next/navigation";
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
  const safeUnread = typeof unreadCount === "number" && !isNaN(unreadCount) ? unreadCount : 0;
  const session = useAppSession();
  const pathname = usePathname();
  const isDashboard = pathname === "/" || pathname === "/dashboard";

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

  const firstName = typeof session?.fullName === "string" && session.fullName.trim().length > 0
    ? session.fullName.trim().split(/\s+/)[0]
    : "there";
  const userInitial = typeof session?.fullName === "string" && session.fullName.trim().length > 0
    ? session.fullName.trim().charAt(0).toUpperCase()
    : "U";

  return (
    <>
      <header
        className={cn(
          "w-full flex items-center justify-between gap-4 pb-6 select-none",
          className
        )}
      >
        {/* Left: Greeting only on /dashboard, clean spacer on all other pages so page title leads */}
        {isDashboard ? (
          <div className="flex-1 flex flex-col min-w-0">
            {session.isLoaded && session.fullName ? (
              <h1 className="text-xl md:text-2xl font-bold tracking-tight text-black truncate">
                Hello, {firstName}!
              </h1>
            ) : (
              <div className="h-7 w-44 bg-[#E6E6E6] rounded animate-pulse my-0.5" />
            )}
            <p className="text-xs text-[#808080] font-normal truncate mt-0.5">
              Here's your workplace overview.
            </p>
          </div>
        ) : (
          <div className="flex-1 min-w-0" />
        )}

        {/* Right: Actions (Notification bell with magenta dot, quiet Export, user chip) */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Notification Bell */}
          <button
            id="notification-bell"
            data-tour="notification-bell"
            type="button"
            title="Notifications"
            aria-label={
              safeUnread > 0
                ? `Notifications (${safeUnread} unread)`
                : "Notifications"
            }
            onClick={() => setNotificationsOpen(true)}
            className="relative p-2 rounded-lg bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-black transition-colors cursor-pointer"
          >
            <Bell className="w-4 h-4 text-black" />
            {safeUnread > 0 && (
              <span
                className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-[#FF1493]"
                aria-hidden="true"
              />
            )}
          </button>

          {/* Quiet Export Data Button (hidden on /kpi where Export CSV exists on page) */}
          {(!pathname || !pathname.startsWith("/kpi")) && (
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-medium text-black transition-colors cursor-pointer"
            >
              <Download className="w-3.5 h-3.5 text-[#808080]" />
              <span className="hidden md:inline">Export data</span>
            </button>
          )}

          {/* User Profile Chip: Uses session, neutral skeleton placeholder when loading */}
          <div className="flex items-center gap-2 pl-2 ml-1 border-l border-[#E6E6E6]">
            {session.isLoaded && session.fullName ? (
              <>
                <div className="w-8 h-8 rounded-full bg-black text-[#B7FF00] flex items-center justify-center font-bold text-xs select-none">
                  {userInitial}
                </div>
                <div className="hidden lg:flex flex-col text-left">
                  <span className="text-xs font-semibold text-black leading-tight truncate max-w-[140px]">
                    {session.fullName}
                  </span>
                  <span className="text-[10px] text-[#808080] leading-tight truncate max-w-[140px] capitalize">
                    {session.jobTitleName || session.userRole}
                  </span>
                </div>
              </>
            ) : (
              <>
                <div className="w-8 h-8 rounded-full bg-[#E6E6E6] animate-pulse" />
                <div className="hidden lg:flex flex-col gap-1">
                  <div className="h-3 w-20 bg-[#E6E6E6] rounded animate-pulse" />
                  <div className="h-2 w-12 bg-[#E6E6E6] rounded animate-pulse" />
                </div>
              </>
            )}
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
