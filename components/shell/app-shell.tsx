"use client";

import * as React from "react";
import { CurvedSidebar } from "@/components/shell/curved-sidebar";
import { TopNavBar } from "@/components/shell/top-nav-bar";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: React.ReactNode;
  userRole?: "employee" | "manager" | "hr" | "admin";
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
  const [detectedRole, setDetectedRole] = React.useState<"employee" | "manager" | "hr" | "admin">(
    propUserRole || "employee"
  );

  React.useEffect(() => {
    if (propUserRole) {
      setDetectedRole(propUserRole);
      return;
    }

    const supabase = createClient();
    async function resolveRole() {
      try {
        // 1. Try current_user_role RPC (fastest, security definer)
        const { data: rpcRole } = await (supabase.rpc as any)("current_user_role");
        if (rpcRole && ["employee", "manager", "hr", "admin"].includes(rpcRole)) {
          setDetectedRole(rpcRole as any);
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (!session?.access_token) return;

        // 2. Decode JWT payload to get user_role claim
        const payloadBase64 = session.access_token.split(".")[1];
        if (payloadBase64) {
          const claims = JSON.parse(
            decodeURIComponent(
              atob(payloadBase64.replace(/-/g, "+").replace(/_/g, "/"))
                .split("")
                .map((c) => "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2))
                .join("")
            )
          );
          const role = claims.user_role || claims.app_metadata?.user_role;
          if (role && ["employee", "manager", "hr", "admin"].includes(role)) {
            setDetectedRole(role as any);
            return;
          }
        }

        // 3. Fallback: query organization_members
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (user) {
          const { data: member } = await (supabase as any)
            .from("organization_members")
            .select("role")
            .eq("user_id", user.id)
            .eq("status", "active")
            .maybeSingle();
          if (member?.role) {
            setDetectedRole(member.role as any);
          }
        }
      } catch {
        // keep fallback
      }
    }
    resolveRole();
  }, [propUserRole]);

  const userRole = propUserRole || detectedRole;

  return (
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
      <BottomTabBar />
    </div>
  );
}

