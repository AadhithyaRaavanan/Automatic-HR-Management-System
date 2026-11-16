"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { CurvedSidebar } from "@/components/shell/curved-sidebar";
import { TopNavBar } from "@/components/shell/top-nav-bar";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { OnboardingTour } from "@/components/shared/onboarding-tour";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { isDemoModeEnabled } from "@/lib/config/demo";

export type AppUserRole = "employee" | "manager" | "hr" | "admin";

export interface AppSessionState {
  userId: string | null;
  organizationId: string | null;
  userRole: AppUserRole;
  fullName: string | null;
  timezone: string;
  isLoaded: boolean;
  departmentName?: string | null;
  jobTitleName?: string | null;
  requireMfaForPrivileged?: boolean;
}

const AppSessionContext = React.createContext<AppSessionState>({
  userId: null,
  organizationId: null,
  userRole: "employee",
  fullName: null,
  timezone: "UTC",
  isLoaded: false,
  departmentName: null,
  jobTitleName: null,
  requireMfaForPrivileged: true,
});

export function useAppSession(): AppSessionState {
  return React.useContext(AppSessionContext);
}

interface AppShellProps {
  children: React.ReactNode;
  userRole?: AppUserRole;
  onPrimaryAction?: () => void;
  primaryActionLabel?: string;
  className?: string;
}

let cachedSession: AppSessionState | null = null;

function getCookieRole(): AppUserRole | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie.match(/(?:^|;\s*)remotehr_role=([^;]*)/);
  const val = match ? decodeURIComponent(match[1]) : null;
  return val && ["employee", "manager", "hr", "admin"].includes(val) ? (val as AppUserRole) : null;
}

export function clearAppSessionCache() {
  cachedSession = null;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("remotehr_cached_session");
      localStorage.removeItem("remotehr_cached_role");
      document.cookie = "remotehr_role=; path=/; max-age=0; SameSite=Lax";
    } catch {}
  }
}

function getInitialSession(propRole?: AppUserRole): AppSessionState {
  if (propRole) {
    return {
      userId: null,
      organizationId: null,
      userRole: propRole,
      fullName: null,
      timezone: "UTC",
      isLoaded: true,
      departmentName: null,
      jobTitleName: null,
      requireMfaForPrivileged: true,
    };
  }
  if (cachedSession) {
    return cachedSession;
  }
  if (typeof window !== "undefined") {
    try {
      const stored = localStorage.getItem("remotehr_cached_session");
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.userRole) {
          cachedSession = parsed;
          return parsed;
        }
      }
      const storedRole =
        (localStorage.getItem("remotehr_cached_role") as AppUserRole | null) ||
        getCookieRole();
      if (storedRole && ["employee", "manager", "hr", "admin"].includes(storedRole)) {
        return {
          userId: null,
          organizationId: null,
          userRole: storedRole,
          fullName: null,
          timezone: "UTC",
          isLoaded: true,
          departmentName: null,
          jobTitleName: null,
          requireMfaForPrivileged: true,
        };
      }
    } catch {}
  }
  const defaultRole: AppUserRole = isDemoModeEnabled() ? "admin" : "employee";
  return {
    userId: null,
    organizationId: null,
    userRole: defaultRole,
    fullName: null,
    timezone: "UTC",
    isLoaded: isDemoModeEnabled(),
    departmentName: null,
    jobTitleName: null,
    requireMfaForPrivileged: true,
  };
}

export function AppShell({
  children,
  userRole: propUserRole,
  onPrimaryAction,
  primaryActionLabel = "Quick Check-in",
  className,
}: AppShellProps) {
  const [sessionState, setSessionState] = React.useState<AppSessionState>(() =>
    getInitialSession(propUserRole)
  );
  const [tourOpen, setTourOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const supabase = createClient();

    async function resolveSession() {
      let resolvedRole: AppUserRole =
        propUserRole ||
        sessionState.userRole ||
        (cachedSession?.userRole) ||
        (typeof window !== "undefined"
          ? (localStorage.getItem("remotehr_cached_role") as AppUserRole)
          : null) ||
        (isDemoModeEnabled() ? "admin" : "employee");
      let resolvedUserId: string | null = null;
      let resolvedOrgId: string | null = null;
      let resolvedName: string | null = null;
      let resolvedDeptName: string | null = null;
      let resolvedJobTitle: string | null = null;
      let resolvedReqMfa: boolean = true;
      let resolvedTz = "UTC";
      let shouldOpenTour = false;

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const user = session?.user ?? (await supabase.auth.getUser()).data.user;

        if (user) {
          resolvedUserId = user.id;

          if (!propUserRole) {
            const metaRole =
              (user.app_metadata as any)?.user_role ||
              (user.user_metadata as any)?.user_role;
            if (metaRole && ["employee", "manager", "hr", "admin"].includes(metaRole)) {
              resolvedRole = metaRole as AppUserRole;
            } else if (user.email === "admin@remotehr.io") {
              resolvedRole = "admin";
            } else if (user.email === "hr@remotehr.io") {
              resolvedRole = "hr";
            } else if (user.email === "manager@remotehr.io") {
              resolvedRole = "manager";
            } else if (user.email === "employee@remotehr.io") {
              resolvedRole = "employee";
            } else {
              const { data: rpcRole } = await (supabase.rpc as any)("current_user_role");
              if (rpcRole && ["employee", "manager", "hr", "admin"].includes(rpcRole)) {
                resolvedRole = rpcRole as AppUserRole;
              } else {
                const { data: member } = await (supabase as any)
                  .from("organization_members")
                  .select("role, organization_id")
                  .eq("user_id", user.id)
                  .eq("status", "active")
                  .maybeSingle();
                if (member?.role && ["employee", "manager", "hr", "admin"].includes(member.role)) {
                  resolvedRole = member.role as AppUserRole;
                }
                if (member?.organization_id) {
                  resolvedOrgId = member.organization_id;
                }
              }
            }
          }

          const { data: empProfile } = await (supabase as any)
            .from("employees")
            .select(
              "full_name, timezone, organization_id, onboarding_completed_at, departments:department_id(name), job_titles:job_title_id(title_name)"
            )
            .eq("id", user.id)
            .maybeSingle();

          if (empProfile) {
            resolvedName = empProfile.full_name || null;
            resolvedTz = empProfile.timezone || "UTC";
            resolvedOrgId = resolvedOrgId || empProfile.organization_id || null;
            resolvedDeptName = empProfile.departments?.name || null;
            resolvedJobTitle = empProfile.job_titles?.title_name || null;
          }

          const dismissed = typeof window !== "undefined" ? localStorage.getItem("pulse_tutorial_dismissed") : null;
          if (dismissed !== "true") {
            try {
              const { data: prof } = await (supabase as any)
                .from("profiles")
                .select("tutorial_completed")
                .eq("id", user.id)
                .maybeSingle();

              if (prof && prof.tutorial_completed === false) {
                shouldOpenTour = true;
              }
            } catch {}
          }

          if (resolvedOrgId) {
            const { data: orgData } = await (supabase as any)
              .from("organizations")
              .select("require_mfa_for_privileged")
              .eq("id", resolvedOrgId)
              .maybeSingle();
            if (orgData && typeof orgData.require_mfa_for_privileged === "boolean") {
              resolvedReqMfa = orgData.require_mfa_for_privileged;
            }
          }
        }
      } catch {
        // Keep safe fallback
      }

      if (isDemoModeEnabled()) {
        const storedRole =
          (typeof window !== "undefined"
            ? (localStorage.getItem("remotehr_cached_role") as AppUserRole)
            : null) || getCookieRole();
        if (storedRole && ["employee", "manager", "hr", "admin"].includes(storedRole)) {
          resolvedRole = storedRole;
        } else if (!resolvedRole || resolvedRole === "employee") {
          resolvedRole = "admin";
        }
      }

      if (!active) return;
      const finalRole = propUserRole || resolvedRole;
      const nextSession: AppSessionState = {
        userId: resolvedUserId,
        organizationId: resolvedOrgId,
        userRole: finalRole,
        fullName: resolvedName,
        timezone: resolvedTz,
        departmentName: resolvedDeptName,
        jobTitleName: resolvedJobTitle,
        requireMfaForPrivileged: resolvedReqMfa,
        isLoaded: true,
      };

      cachedSession = nextSession;
      if (typeof window !== "undefined") {
        try {
          localStorage.setItem("remotehr_cached_session", JSON.stringify(nextSession));
          localStorage.setItem("remotehr_cached_role", finalRole);
          document.cookie = `remotehr_role=${finalRole}; path=/; max-age=2592000; SameSite=Lax`;
        } catch {}
      }

      setSessionState(nextSession);
      if (shouldOpenTour) {
        setTourOpen(true);
      }
    }

    resolveSession();
    return () => {
      active = false;
    };
  }, [propUserRole]);

  const userRole = propUserRole || sessionState.userRole;

  return (
    <AppSessionContext.Provider value={{ ...sessionState, userRole }}>
      <div className="min-h-screen w-full bg-shell flex flex-col md:flex-row transition-colors duration-300 relative">
        {/* Left Docked Curved Sidebar */}
        <CurvedSidebar userRole={userRole} />

        {/* Main Full-Width Application Area */}
        <div className="flex-1 flex flex-col min-w-0 px-4 sm:px-6 md:px-8 lg:px-10 py-5 pb-20 md:pb-8">
          <TopNavBar
            userRole={userRole}
            onPrimaryAction={onPrimaryAction}
            primaryActionLabel={primaryActionLabel}
          />

          <main className={cn("flex-1 w-full flex flex-col min-w-0", className)}>
            {/* Warning banner when organization has disabled mandatory MFA for privileged accounts */}
            {sessionState.isLoaded && sessionState.requireMfaForPrivileged === false && (
              <div
                className="mb-4 p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 flex items-center justify-between gap-3 text-xs font-semibold shadow-sm"
                role="alert"
                data-testid="mfa-disabled-warning-banner"
              >
                <div className="flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                  <span>
                    <strong>Security Warning:</strong> Mandatory Two-Factor Authentication (MFA) for privileged accounts is currently disabled for this organization.
                  </span>
                </div>
                {userRole === "admin" && (
                  <Link
                    href="/settings"
                    className="underline text-amber-900 dark:text-amber-100 font-bold hover:opacity-80 shrink-0 text-[11px]"
                  >
                    Configure in Settings →
                  </Link>
                )}
              </div>
            )}
            {children}
          </main>
        </div>

        {/* Mobile Bottom Navigation Bar */}
        <BottomTabBar userRole={userRole} />

        {/* First-Login Onboarding Tour */}
        {sessionState.userId && (
          <OnboardingTour
            open={tourOpen}
            onOpenChange={setTourOpen}
            userRole={userRole}
            fullName={sessionState.fullName}
          />
        )}
      </div>
    </AppSessionContext.Provider>
  );
}
