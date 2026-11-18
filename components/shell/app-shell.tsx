"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { AlertTriangle, Laptop } from "lucide-react";
import { CurvedSidebar } from "@/components/shell/curved-sidebar";
import { TopNavBar } from "@/components/shell/top-nav-bar";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { AutoSignoutListener } from "@/components/shared/auto-signout-listener";

const OnboardingTour = dynamic(
  () => import("@/components/shared/onboarding-tour").then((m) => m.OnboardingTour),
  { ssr: false }
);
import { SidebarProvider } from "@/components/shell/sidebar-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { FEATURES } from "@/lib/features";

export type AppUserRole = "employee" | "team_lead" | "manager" | "hr" | "admin";

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
  timezone: "Asia/Kolkata",
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
  return val && ["employee", "team_lead", "manager", "hr", "admin"].includes(val) ? (val as AppUserRole) : null;
}

export function clearAppSessionCache() {
  cachedSession = null;
  if (typeof window !== "undefined") {
    try {
      localStorage.removeItem("remotehr_cached_session");
      localStorage.removeItem("remotehr_cached_role");
      document.cookie = "remotehr_role=; path=/; max-age=0; SameSite=Lax";
    } catch { }
  }
}

function getInitialSession(propRole?: AppUserRole): AppSessionState {
  if (propRole) {
    return {
      userId: null,
      organizationId: null,
      userRole: propRole,
      fullName: null,
      timezone: "Asia/Kolkata",
      isLoaded: true,
      departmentName: null,
      jobTitleName: null,
      requireMfaForPrivileged: true,
    };
  }
  const defaultRole: AppUserRole = isDemoModeEnabled() ? "admin" : "employee";
  return {
    userId: null,
    organizationId: null,
    userRole: defaultRole,
    fullName: null,
    timezone: "Asia/Kolkata",
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
  const [mounted, setMounted] = React.useState(false);
  const [sessionState, setSessionState] = React.useState<AppSessionState>(() =>
    getInitialSession(propUserRole)
  );
  const [userTutorialVersion, setUserTutorialVersion] = React.useState<number>(0);
  const [isExistingUserTour, setIsExistingUserTour] = React.useState<boolean>(false);
  const [tourOpen, setTourOpen] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return sessionStorage.getItem("pulse_tutorial_active") === "true";
  });

  const handleTourOpenChange = React.useCallback((open: boolean) => {
    if (!open && typeof window !== "undefined") {
      sessionStorage.removeItem("pulse_tutorial_active");
      sessionStorage.removeItem("pulse_tutorial_step_index");
      sessionStorage.setItem("pulse_tutorial_completed", "true");
      localStorage.setItem("pulse_tutorial_completed", "true");
    }
    setTourOpen(open);
  }, []);

  React.useEffect(() => {
    setMounted(true);
    const handleManualTour = () => {
      if (sessionState.userRole !== "admin") {
        if (typeof window !== "undefined") {
          sessionStorage.setItem("pulse_tutorial_active", "true");
          sessionStorage.setItem("pulse_tutorial_step_index", "0");
          sessionStorage.removeItem("pulse_tutorial_completed");
          localStorage.removeItem("pulse_tutorial_completed");
        }
        setTourOpen(true);
      }
    };
    window.addEventListener("pulse:start-tour", handleManualTour);
    return () => window.removeEventListener("pulse:start-tour", handleManualTour);
  }, [sessionState.userRole]);

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
      let resolvedTz = "Asia/Kolkata";
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
              "full_name, timezone, organization_id, onboarding_completed, onboarding_completed_at, departments:department_id(name), job_titles:job_title_id(title_name)"
            )
            .eq("id", user.id)
            .maybeSingle();

          if (empProfile) {
            resolvedName = empProfile.full_name || null;
            resolvedTz = empProfile.timezone || "Asia/Kolkata";
            resolvedOrgId = resolvedOrgId || empProfile.organization_id || null;
            resolvedDeptName = empProfile.departments?.name || null;
            resolvedJobTitle = empProfile.job_titles?.title_name || null;

            // Extra client-side lockdown guard: un-approved non-admin users cannot mount the workplace shell
            if (
              resolvedRole !== "admin" &&
              empProfile.onboarding_completed === false
            ) {
              if (typeof window !== "undefined" && !window.location.pathname.startsWith("/onboarding")) {
                window.location.href = "/onboarding/pending";
                return;
              }
            }
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

          // Strict server-controlled auto-start check:
          // 1. Role is employee, manager, or hr (Admin gets NO tour)
          const isEligibleRole =
            resolvedRole === "employee" ||
            resolvedRole === "manager" ||
            resolvedRole === "hr";

          // 2. profiles.tutorial_completed & version check
          let tutorialCompleted = false;
          let tutorialVersion = 0;
          let onboardingCompleted = false;
          try {
            const res = await fetch("/api/tutorial/complete", {
              headers: session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : {},
            });
            if (res.ok) {
              const statusData = await res.json();
              tutorialCompleted = statusData.tutorial_completed === true;
              tutorialVersion = Number(statusData.tutorial_version) || 0;
              onboardingCompleted = statusData.onboarding_completed === true;
            }
          } catch { }

          if (empProfile?.onboarding_completed === true && (empProfile as any)?.status === "active") {
            onboardingCompleted = true;
          }

          // 3. must_change_password is false
          const mustChangePassword =
            (user.user_metadata as any)?.must_change_password === true ||
            (user.app_metadata as any)?.must_change_password === true ||
            (typeof window !== "undefined" &&
              new URLSearchParams(window.location.search).get("must_change_password") === "true");

          // 4. MFA verification finished (session is AAL2 if user has enrolled TOTP)
          let mfaFinished = true;
          try {
            const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
            if (aalData) {
              const hasEnrolledTotp = aalData.nextLevel === "aal2";
              if (hasEnrolledTotp) {
                mfaFinished = aalData.currentLevel === "aal2";
              }
            }
          } catch { }

          // If the authoritative server state says tutorial is not completed, clear any stale client flags
          if (!tutorialCompleted && typeof window !== "undefined") {
            sessionStorage.removeItem("pulse_tutorial_completed");
            localStorage.removeItem("pulse_tutorial_completed");
          }

          if (
            isEligibleRole &&
            onboardingCompleted &&
            !mustChangePassword &&
            mfaFinished &&
            !tutorialCompleted
          ) {
            shouldOpenTour = true;
            setIsExistingUserTour(false);
            setUserTutorialVersion(0);
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
        } catch { }
      }

      setSessionState(nextSession);
      const isAlreadyActive =
        typeof window !== "undefined" &&
        sessionStorage.getItem("pulse_tutorial_active") === "true";

      if (shouldOpenTour || isAlreadyActive) {
        if (typeof window !== "undefined") {
          sessionStorage.setItem("pulse_tutorial_active", "true");
        }
        setTourOpen(true);
      } else {
        setTourOpen(false);
      }
    }

    resolveSession();
    return () => {
      active = false;
    };
  }, [propUserRole]);

  const userRole = propUserRole || sessionState.userRole;

  return (
    <SidebarProvider>
      <AppSessionContext.Provider value={{ ...sessionState, userRole }}>
        <div
          className="min-h-screen w-full bg-shell flex flex-col md:flex-row transition-colors duration-300 relative"
          suppressHydrationWarning
        >
          {/* Left Docked Curved Sidebar */}
          <div data-tour="nav-sidebar">
            <CurvedSidebar userRole={userRole} />
          </div>

          {/* Main Full-Width Application Area */}
          <div className="flex-1 flex flex-col min-w-0 px-4 sm:px-6 md:px-8 lg:px-10 py-5 pb-20 md:pb-8">
            <TopNavBar
              userRole={userRole}
              onPrimaryAction={onPrimaryAction}
              primaryActionLabel={primaryActionLabel}
            />
            <main className={cn("flex-1 w-full flex flex-col min-w-0", className)}>
              {/* Warning banner when organization has disabled mandatory MFA for privileged accounts */}
              {mounted &&
                sessionState.isLoaded &&
                sessionState.userRole === "admin" &&
                sessionState.requireMfaForPrivileged === false &&
                typeof window !== "undefined" &&
                !window.location.pathname.startsWith("/settings") && (
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

          {/* Mobile Access Gate: Restrict access on mobile screens */}
          <div className="fixed inset-0 z-[10000] bg-surface-ground flex flex-col items-center justify-center p-6 text-center md:hidden">
            <div className="w-16 h-16 rounded-2xl bg-brand-purple/10 border border-brand-purple/20 flex items-center justify-center text-brand-purple mb-4 shadow-sm">
              <Laptop className="w-8 h-8" />
            </div>
            <h1 className="text-xl font-bold text-text-primary tracking-tight mb-2">Desktop Workstation Required</h1>
            <p className="text-sm text-text-secondary max-w-sm mb-6 leading-relaxed">
              Pulse HRMS is optimized exclusively for desktop and laptop computers to support enterprise attendance governance, document verification, and productivity workflows.
            </p>
            <div className="px-4 py-2.5 rounded-xl bg-card border border-border-light text-xs font-semibold text-text-muted">
              Please access <span className="text-brand-purple font-bold">pulse.zenxea.com</span> from your computer.
            </div>
          </div>

          {/* 3-Hour Post-Logout Auto Signout Enforcer */}
          <AutoSignoutListener />

          {/* First-Login Onboarding Tour (Employee, Manager, HR only - Admin gets NO tour) */}
          {mounted && sessionState.userId && sessionState.userRole !== "admin" && (
            <OnboardingTour
              open={tourOpen}
              onOpenChange={handleTourOpenChange}
              userRole={userRole}
              fullName={sessionState.fullName}
              userTutorialVersion={userTutorialVersion}
              isExistingUser={isExistingUserTour}
            />
          )}
        </div>
      </AppSessionContext.Provider>
    </SidebarProvider>
  );
}
