"use client";

import * as React from "react";
import { CurvedSidebar } from "@/components/shell/curved-sidebar";
import { TopNavBar } from "@/components/shell/top-nav-bar";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { OnboardingTour } from "@/components/shared/onboarding-tour";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export type AppUserRole = "employee" | "manager" | "hr" | "admin";

export interface AppSessionState {
  userId: string | null;
  organizationId: string | null;
  userRole: AppUserRole;
  fullName: string | null;
  timezone: string;
  isLoaded: boolean;
}

const AppSessionContext = React.createContext<AppSessionState>({
  userId: null,
  organizationId: null,
  userRole: "employee",
  fullName: null,
  timezone: "UTC",
  isLoaded: false,
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

export function AppShell({
  children,
  userRole: propUserRole,
  onPrimaryAction,
  primaryActionLabel = "Quick Check-in",
  className,
}: AppShellProps) {
  const [sessionState, setSessionState] = React.useState<AppSessionState>({
    userId: null,
    organizationId: null,
    userRole: propUserRole || "employee",
    fullName: null,
    timezone: "UTC",
    isLoaded: false,
  });
  const [tourOpen, setTourOpen] = React.useState(false);

  React.useEffect(() => {
    let active = true;
    const supabase = createClient();

    async function resolveSession() {
      let resolvedRole: AppUserRole = propUserRole || "employee";
      let resolvedUserId: string | null = null;
      let resolvedOrgId: string | null = null;
      let resolvedName: string | null = null;
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

          const { data: empProfile } = await (supabase as any)
            .from("employees")
            .select("full_name, timezone, organization_id, onboarding_completed_at")
            .eq("id", user.id)
            .maybeSingle();

          if (empProfile) {
            resolvedName = empProfile.full_name || null;
            resolvedTz = empProfile.timezone || "UTC";
            resolvedOrgId = resolvedOrgId || empProfile.organization_id || null;
            if (empProfile.onboarding_completed_at === null) {
              shouldOpenTour = true;
            }
          }
        }
      } catch {
        // Keep safe fallback
      }

      if (!active) return;
      setSessionState({
        userId: resolvedUserId,
        organizationId: resolvedOrgId,
        userRole: propUserRole || resolvedRole,
        fullName: resolvedName,
        timezone: resolvedTz,
        isLoaded: true,
      });
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
