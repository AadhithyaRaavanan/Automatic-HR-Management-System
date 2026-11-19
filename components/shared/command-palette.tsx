"use client";

import * as React from "react";
import { Command } from "cmdk";
import { useTheme } from "next-themes";
import {
  Search,
  Clock,
  Calendar,
  FileSpreadsheet,
  Moon,
  Sun,
  Shield,
  FileText,
  UserCheck,
  CheckCircle2,
  Target,
  X,
  PanelLeft,
  Bell,
  CheckSquare,
  User,
  Plus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { useSidebar } from "@/components/shell/sidebar-context";
import { FEATURES } from "@/lib/features";
import { useOptionalAttendanceContext } from "@/features/attendance/context/attendance-context";

interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userRole?: string;
}

export function CommandPalette({ open, onOpenChange, userRole = "employee" }: CommandPaletteProps) {
  const { setTheme, theme } = useTheme();
  const { isCollapsed, toggleSidebar } = useSidebar();
  const attendance = useOptionalAttendanceContext();
  const isCheckedIn = Boolean(attendance?.isCheckedIn);

  // OS detection for modifier key
  const [modKey, setModKey] = React.useState<string>("Ctrl");
  React.useEffect(() => {
    if (typeof navigator !== "undefined") {
      const isMac = /(Mac|iPhone|iPod|iPad)/i.test(navigator.platform || navigator.userAgent);
      setModKey(isMac ? "⌘" : "Ctrl");
    }
  }, []);

  // Hotkey listener for Cmd/Ctrl+K and G-then-X, N
  React.useEffect(() => {
    let pendingG = false;
    let gTimer: NodeJS.Timeout | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Toggle palette: Cmd+K / Ctrl+K
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        onOpenChange(!open);
        return;
      }

      // Skip global navigation keys if typing in form inputs or inside open dialogs
      const activeEl = document.activeElement;
      const isInput =
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        activeEl instanceof HTMLSelectElement ||
        activeEl?.getAttribute("contenteditable") === "true";

      if (isInput || open) return;

      const key = e.key.toLowerCase();

      // "N" for new task
      if (FEATURES.TASKS && key === "n" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        window.location.href = "/tasks?create=1";
        return;
      }

      // "G" key sequence
      if (key === "g" && !pendingG && !e.metaKey && !e.ctrlKey) {
        pendingG = true;
        if (gTimer) clearTimeout(gTimer);
        gTimer = setTimeout(() => {
          pendingG = false;
        }, 1200);
        return;
      }

      if (pendingG) {
        pendingG = false;
        if (gTimer) clearTimeout(gTimer);
        if (key === "d") {
          e.preventDefault();
          window.location.href = "/";
        } else if (key === "a") {
          e.preventDefault();
          window.location.href = "/attendance";
        } else if (key === "t") {
          e.preventDefault();
          if (FEATURES.TASKS) {
            window.location.href = "/tasks";
          }
        } else if (key === "l") {
          e.preventDefault();
          window.location.href = "/leave";
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (gTimer) clearTimeout(gTimer);
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  const navigate = (url: string) => {
    window.location.href = url;
    onOpenChange(false);
  };

  const handleMarkAllNotificationsRead = async () => {
    try {
      await fetch("/api/notifications/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ all: true }),
      });
      toast.success("All notifications marked as read");
    } catch {
      toast.error("Failed to mark notifications as read");
    }
    onOpenChange(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in-0">
      <div
        className="w-full max-w-lg bg-card rounded-3xl shadow-shell border border-border-light overflow-hidden flex flex-col"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
      >
        <Command className="flex flex-col w-full">
          <div className="flex items-center px-4 py-3.5 border-b border-border-light">
            <Search className="w-4 h-4 text-brand-purple mr-2 shrink-0" />
            <Command.Input
              autoFocus
              placeholder="Search actions or type a command..."
              className="w-full bg-transparent text-sm font-medium text-text-primary placeholder:text-text-tertiary focus:outline-none"
            />
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="p-1 rounded-full text-text-tertiary hover:text-text-primary hover:bg-card-subtle transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <Command.List className="max-h-80 overflow-y-auto p-2 space-y-1">
            <Command.Empty className="py-6 text-center text-xs text-text-tertiary font-medium">
              No matching commands found.
            </Command.Empty>

            {/* Quick Actions */}
            <Command.Group heading="Quick Actions" className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-text-tertiary">
              <Command.Item
                onSelect={() => navigate("/leave")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-brand-purple" />
                  <span>Apply for Leave</span>
                </div>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary">
                  G L
                </kbd>
              </Command.Item>

              {FEATURES.TASKS && (
                <Command.Item
                  onSelect={() => navigate("/tasks?create=1")}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Plus className="w-4 h-4 text-brand-purple" />
                    <span>New Task</span>
                  </div>
                  <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary">
                    N
                  </kbd>
                </Command.Item>
              )}

              <Command.Item
                onSelect={() => navigate("/requests")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-brand-purple" />
                  <span>Request Regularization Correction</span>
                </div>
              </Command.Item>

              <Command.Item
                onSelect={() => navigate("/")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  {isCheckedIn ? (
                    <Clock className="w-4 h-4 text-status-danger-dot" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4 text-status-success-dot" />
                  )}
                  <span>{isCheckedIn ? "Check Out from Session" : "Check In to Daily Session"}</span>
                </div>
                <span className="text-[10px] text-text-tertiary font-mono">
                  {isCheckedIn ? "Active" : "Ready"}
                </span>
              </Command.Item>

              <Command.Item
                onSelect={handleMarkAllNotificationsRead}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Bell className="w-4 h-4 text-brand-purple" />
                  <span>Mark All Notifications as Read</span>
                </div>
              </Command.Item>
            </Command.Group>

            {/* Navigation Destinations */}
            <Command.Group heading="Destinations" className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-text-tertiary mt-2">
              <Command.Item
                onSelect={() => navigate("/")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Clock className="w-4 h-4 text-brand-purple" />
                  <span>Dashboard Overview</span>
                </div>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary">
                  G D
                </kbd>
              </Command.Item>

              <Command.Item
                onSelect={() => navigate("/attendance")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-brand-purple" />
                  <span>Attendance Timesheet</span>
                </div>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary">
                  G A
                </kbd>
              </Command.Item>

              {FEATURES.TASKS && (
                <Command.Item
                  onSelect={() => navigate("/tasks")}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <CheckSquare className="w-4 h-4 text-brand-purple" />
                    <span>Tasks & Kanban Board</span>
                  </div>
                  <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary">
                    G T
                  </kbd>
                </Command.Item>
              )}

              <Command.Item
                onSelect={() => navigate("/leave")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-brand-purple" />
                  <span>Leave Applications & Balances</span>
                </div>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary">
                  G L
                </kbd>
              </Command.Item>

              <Command.Item
                onSelect={() => navigate("/requests")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <FileText className="w-4 h-4 text-brand-purple" />
                  <span>Regularization Requests</span>
                </div>
              </Command.Item>

              <Command.Item
                onSelect={() => navigate("/holidays")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Calendar className="w-4 h-4 text-brand-purple" />
                  <span>Company Holidays</span>
                </div>
              </Command.Item>

              <Command.Item
                onSelect={() => navigate("/notifications")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <Bell className="w-4 h-4 text-brand-purple" />
                  <span>Notifications Center</span>
                </div>
              </Command.Item>

              <Command.Item
                onSelect={() => navigate("/profile")}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <User className="w-4 h-4 text-brand-purple" />
                  <span>My Profile & Settings</span>
                </div>
              </Command.Item>

              {FEATURES.KPI && (
                <Command.Item
                  onSelect={() => navigate("/kpi")}
                  className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <Target className="w-4 h-4 text-brand-purple" />
                    <span>KPI Scorecards & Performance</span>
                  </div>
                </Command.Item>
              )}

              {(userRole === "hr" || userRole === "admin") && (
                <>
                  <Command.Item
                    onSelect={() => navigate("/ems")}
                    className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <Users className="w-4 h-4 text-brand-purple" />
                      <span>Employee Directory (EMS)</span>
                    </div>
                  </Command.Item>

                  <Command.Item
                    onSelect={() => navigate("/hr/onboarding")}
                    className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      <UserCheck className="w-4 h-4 text-brand-purple" />
                      <span>HR Onboarding Queue</span>
                    </div>
                  </Command.Item>
                </>
              )}
            </Command.Group>

            {/* Preferences & Tools */}
            <Command.Group heading="Preferences & Tools" className="px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-text-tertiary mt-2">
              <Command.Item
                onSelect={() => {
                  if (!isCollapsed) toggleSidebar();
                  onOpenChange(false);
                }}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <PanelLeft className="w-4 h-4 text-brand-purple" />
                  <span>Collapse Sidebar Navigation</span>
                </div>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary">
                  {modKey} B
                </kbd>
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  if (isCollapsed) toggleSidebar();
                  onOpenChange(false);
                }}
                className="flex items-center justify-between px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2.5">
                  <PanelLeft className="w-4 h-4 text-brand-purple" />
                  <span>Expand Sidebar Navigation</span>
                </div>
                <kbd className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-card border border-border-light text-text-tertiary">
                  {modKey} B
                </kbd>
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  setTheme(theme === "dark" ? "light" : "dark");
                  onOpenChange(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                {theme === "dark" ? (
                  <Sun className="w-4 h-4 text-status-warning-dot" />
                ) : (
                  <Moon className="w-4 h-4 text-brand-purple" />
                )}
                <span>Toggle Light / Dark Theme</span>
              </Command.Item>

              <Command.Item
                onSelect={() => {
                  toast.success("Triggering .xlsx attendance report export...");
                  onOpenChange(false);
                }}
                className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
              >
                <FileSpreadsheet className="w-4 h-4 text-status-success-dot" />
                <span>Export Attendance Data (.xlsx)</span>
              </Command.Item>

              {isDemoModeEnabled() && (
                <Command.Item
                  onSelect={() => navigate("/gallery")}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-text-primary hover:bg-brand-purple-light/50 hover:text-brand-purple cursor-pointer transition-colors"
                >
                  <Shield className="w-4 h-4 text-brand-purple" />
                  <span>Component Design Gallery</span>
                </Command.Item>
              )}
            </Command.Group>
          </Command.List>

          <div className="p-3 bg-card-subtle border-t border-border-light flex items-center justify-between text-[11px] text-text-tertiary">
            <span>Use ↑↓ to navigate, ↵ to select</span>
            <span className="font-mono bg-card px-1.5 py-0.5 rounded border border-border-light">
              ESC to close
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
