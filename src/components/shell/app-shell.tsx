"use client";

import * as React from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { QueryClientContext } from "@tanstack/react-query";
import { AlertTriangle, Building2, Laptop } from "lucide-react";
import { CurvedSidebar } from "@/components/shell/curved-sidebar";
import { TopNavBar } from "@/components/shell/top-nav-bar";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { AutoSignoutListener } from "@/features/auth/components/auto-signout-listener";

const OnboardingTour = dynamic(
  () => import("@/features/tutorial/components/onboarding-tour").then((m) => m.OnboardingTour),
  { ssr: false }
);
import { SidebarProvider } from "@/components/shell/sidebar-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { FEATURES } from "@/lib/features";

export type AppUserRole = "employee" | "team_lead" | "manager" | "hr" | "admin";

export interface AppOrganizationSummary {
  organizationId: string;
  organizationName: string;
  slug?: string | null;
  timezone?: string;
  role: string;
}

export interface AppSessionState {
  userId: string | null;
  organizationId: string | null;
  organizationName?: string | null;
  organizations?: AppOrganizationSummary[];
  requiresOrgSelection?: boolean;
  switchOrganization?: (orgId: string) => Promise<void>;
  userRole: AppUserRole;
  fullName: string | null;
  userEmail?: string | null;
  timezone: string;
  isLoaded: boolean;
  departmentName?: string | null;
  jobTitleName?: string | null;
  requireMfaForPrivileged?: boolean;
}

const AppSessionContext = React.createContext<AppSessionState>({
  userId: null,
  organizationId: null,
  organizationName: null,
  organizations: [],
  requiresOrgSelection: false,
  userRole: "employee",
  fullName: null,
  userEmail: null,
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

  return {
    userId: null,
    organizationId: null,
    userRole: isDemoModeEnabled() ? "admin" : "employee",
    fullName: null,
    userEmail: null,
    timezone: "Asia/Kolkata",
    isLoaded: false,
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
  const queryClient = React.useContext(QueryClientContext);
  const [sessionState, setSessionState] = React.useState<AppSessionState>(() =>
    getInitialSession(propUserRole)
  );
  const [userTutorialVersion, setUserTutorialVersion] = React.useState<number>(0);
  const [isExistingUserTour, setIsExistingUserTour] = React.useState<boolean>(false);
  const [tourOpen, setTourOpen] = React.useState<boolean>(false);

  const switchOrganization = React.useCallback(
    async (nextOrgId: string) => {
      if (!nextOrgId || nextOrgId === sessionState.organizationId) return;
      const res = await fetch("/api/auth/organizations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ organizationId: nextOrgId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err?.error || "Unable to switch organization.");
      }
      clearAppSessionCache();
      queryClient?.clear();
      if (typeof window !== "undefined") {
        window.location.reload();
      }
    },
    [sessionState.organizationId, queryClient]
  );

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    if (!propUserRole) {
      try {
        const raw = localStorage.getItem("remotehr_cached_session");
        const cached = raw ? (JSON.parse(raw) as AppSessionState) : null;
        const cookieRole = getCookieRole();
        const storedRole = localStorage.getItem("remotehr_cached_role") as AppUserRole | null;
        const resolvedRole: AppUserRole =
          cached?.userRole || storedRole || cookieRole || (isDemoModeEnabled() ? "admin" : "employee");
        if (cached || cookieRole || storedRole) {
          setSessionState((prev) => ({
            ...prev,
            userId: cached?.userId || prev.userId,
            organizationId: cached?.organizationId || prev.organizationId,
            userRole: resolvedRole,
            fullName: cached?.fullName || prev.fullName,
            userEmail: cached?.userEmail || prev.userEmail,
            timezone: cached?.timezone || prev.timezone,
            isLoaded: Boolean(cached?.fullName),
            departmentName: cached?.departmentName || prev.departmentName,
            jobTitleName: cached?.jobTitleName || prev.jobTitleName,
          }));
        }
      } catch {}
    }
    if (sessionStorage.getItem("pulse_tutorial_active") === "true") {
      setTourOpen(true);
    }
  }, [propUserRole]);

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
      let resolvedEmail: string | null = null;
      let resolvedOrgName: string | null = null;
      let resolvedOrgs: AppOrganizationSummary[] = [];
      let requiresOrgSelection = false;
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
          resolvedEmail = user.email ?? null;

          // Fetch authoritative organization memberships & selected workspace from server
          try {
            const orgsRes = await fetch("/api/auth/organizations", {
              credentials: "same-origin",
              headers: session?.access_token
                ? { Authorization: `Bearer ${session.access_token}` }
                : {},
            });
            if (orgsRes.ok) {
              const orgsData = await orgsRes.json();
              resolvedOrgs = Array.isArray(orgsData.organizations) ? orgsData.organizations : [];
              requiresOrgSelection = Boolean(orgsData.requiresSelection);
              const selectedId = orgsData.selectedOrganizationId || null;
              const activeOrgObj = selectedId
                ? resolvedOrgs.find((o) => o.organizationId === selectedId)
                : resolvedOrgs.length === 1
                ? resolvedOrgs[0]
                : null;
              if (activeOrgObj) {
                resolvedOrgId = activeOrgObj.organizationId;
                resolvedOrgName = activeOrgObj.organizationName;
                if (!propUserRole && ["employee", "team_lead", "manager", "hr", "admin"].includes(activeOrgObj.role)) {
                  resolvedRole = activeOrgObj.role as AppUserRole;
                }
              }
            }
          } catch {}

          if (!propUserRole && resolvedOrgs.length === 0) {
            const appMetaRole = (user.app_metadata as any)?.user_role;
            if (appMetaRole && ["employee", "team_lead", "manager", "hr", "admin"].includes(appMetaRole)) {
              resolvedRole = appMetaRole as AppUserRole;
            } else {
              const { data: rpcRole } = await (supabase.rpc as any)("current_user_role");
              if (rpcRole && ["employee", "team_lead", "manager", "hr", "admin"].includes(rpcRole)) {
                resolvedRole = rpcRole as AppUserRole;
              }
            }
          }

          const isEligibleRole =
            resolvedRole === "employee" ||
            resolvedRole === "manager" ||
            resolvedRole === "hr";

          // Run independent profile, tutorial status, and MFA checks in parallel (with base-schema fallback)
          const [empResult, tutorialStatusResult, aalResult] = await Promise.all([
            (async () => {
              const ext = await (supabase as any)
                .from("employees")
                .select(
                  "full_name, timezone, organization_id, onboarding_completed, onboarding_completed_at, departments:department_id(name), job_titles:job_title_id(title_name)"
                )
                .eq("id", user.id)
                .maybeSingle();
              if (!ext?.error) return ext;
              return await (supabase as any)
                .from("employees")
                .select("full_name, timezone, status")
                .eq("id", user.id)
                .maybeSingle();
            })(),
            isEligibleRole
              ? fetch("/api/tutorial/complete", {
                  headers: session?.access_token
                    ? { Authorization: `Bearer ${session.access_token}` }
                    : {},
                })
                  .then((res) => (res.ok ? res.json() : null))
                  .catch(() => null)
              : Promise.resolve(null),
            supabase.auth.mfa
              .getAuthenticatorAssuranceLevel()
              .then((r) => r.data)
              .catch(() => null),
          ]);

          const empProfile = empResult?.data;
          const metaName =
            (user.user_metadata as any)?.full_name?.trim?.() ||
            (user.user_metadata as any)?.name?.trim?.() ||
            null;
          const emailPrefix = user.email ? user.email.split("@")[0] : null;
          resolvedName =
            empProfile?.full_name?.trim?.() || metaName || emailPrefix || null;

          if (empProfile) {
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
          // 2. profiles.tutorial_completed & version check
          let tutorialCompleted = false;
          let tutorialVersion = 0;
          let onboardingCompleted = false;
          if (tutorialStatusResult) {
            tutorialCompleted = tutorialStatusResult.tutorial_completed === true;
            tutorialVersion = Number(tutorialStatusResult.tutorial_version) || 0;
            onboardingCompleted = tutorialStatusResult.onboarding_completed === true;
          }

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
          if (aalResult) {
            const hasEnrolledTotp = aalResult.nextLevel === "aal2";
            if (hasEnrolledTotp) {
              mfaFinished = aalResult.currentLevel === "aal2";
            }
          }

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
        organizationName: resolvedOrgName,
        organizations: resolvedOrgs,
        requiresOrgSelection,
        switchOrganization,
        userRole: finalRole,
        fullName: resolvedName,
        userEmail: resolvedEmail,
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
    const { data: authSub } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        clearAppSessionCache();
        queryClient?.clear();
      }
    });
    return () => {
      active = false;
      authSub?.subscription?.unsubscribe?.();
    };
  }, [propUserRole, switchOrganization, queryClient]);

  const userRole = propUserRole || sessionState.userRole;

  return (
    <SidebarProvider>
      <AppSessionContext.Provider value={{ ...sessionState, switchOrganization, userRole }}>
        <div
          className="min-h-screen w-full bg-[#000000] flex flex-col md:flex-row transition-colors duration-300 relative"
          suppressHydrationWarning
        >
          {/* Left Docked Curved Sidebar */}
          <div data-tour="nav-sidebar" className="shrink-0">
            <CurvedSidebar userRole={userRole} />
          </div>

          {/* Main Full-Width Application Area */}
          <div className="flex-1 flex flex-col min-w-0 bg-[#F5F5F5] md:rounded-l-[28px] my-0 md:my-2 mr-0 md:mr-2 p-5 sm:p-6 md:p-8 min-h-[calc(100vh-16px)] overflow-x-hidden">
            <TopNavBar
              userRole={userRole}
              onPrimaryAction={onPrimaryAction}
              primaryActionLabel={primaryActionLabel}
            />
            <main className={cn("flex-1 w-full flex flex-col min-w-0 max-w-[1360px] mx-auto", className)}>
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
              {mounted &&
                sessionState.isLoaded &&
                sessionState.requiresOrgSelection &&
                (sessionState.organizations?.length || 0) > 1 && (
                  <div
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="org-select-heading"
                    className="fixed inset-0 z-[10001] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
                  >
                    <div className="bg-white border border-[#E6E6E6] rounded-2xl max-w-md w-full p-6 shadow-xl space-y-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-black text-[#B7FF00] flex items-center justify-center">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div>
                          <h2 id="org-select-heading" className="text-base font-bold text-black">
                            Select Active Organization
                          </h2>
                          <p className="text-xs text-[#666666]">
                            You belong to multiple organizations. Choose one workspace to continue.
                          </p>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {sessionState.organizations?.map((org) => (
                          <button
                            key={org.organizationId}
                            type="button"
                            onClick={() => switchOrganization(org.organizationId)}
                            className="w-full flex items-center justify-between px-4 py-3 rounded-xl border border-[#E6E6E6] hover:border-black hover:bg-[#F5F5F5] text-left transition-colors cursor-pointer"
                          >
                            <span className="text-sm font-semibold text-black">
                              {org.organizationName}
                            </span>
                            <span className="text-[11px] font-medium uppercase px-2 py-0.5 rounded bg-black text-[#B7FF00]">
                              {org.role}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              {children}
            </main>
          </div>

          {/* Mobile Access Gate: Restrict access on mobile screens */}
          <div className="fixed inset-0 z-[10000] bg-white flex flex-col items-center justify-center p-6 text-center md:hidden">
            <div className="w-16 h-16 rounded-2xl bg-[#B7FF00] border border-black/10 flex items-center justify-center text-black mb-4 shadow-sm font-black text-xl">
              <Laptop className="w-8 h-8 text-black" />
            </div>
            <h1 className="text-xl font-bold text-black tracking-tight mb-2">Desktop Workstation Required</h1>
            <p className="text-sm text-[#4D4D4D] max-w-sm mb-6 leading-relaxed">
              Pulse is optimized exclusively for desktop and laptop computers to support attendance governance, document verification, and productivity workflows.
            </p>
            <div className="px-4 py-2.5 rounded-xl bg-[#F5F5F5] border border-[#E6E6E6] text-xs font-semibold text-[#808080]">
              Please access <span className="text-black font-bold">pulse.zenxea.com</span> from your computer.
            </div>
          </div>

          {/* 3-Hour Post-Logout Auto Signout Enforcer */}
          <AutoSignoutListener />

          {/* First-Login Onboarding Tour (Employee, Manager, HR only - Admin gets NO tour) */}
          {mounted &&
            sessionState.userId &&
            !sessionState.requiresOrgSelection &&
            sessionState.userRole !== "admin" && (
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
