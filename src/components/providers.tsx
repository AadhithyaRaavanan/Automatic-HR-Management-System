"use client";

import * as React from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { QueryProvider } from "@/components/query-provider";
import { AttendanceProvider } from "@/features/attendance/context/attendance-context";
import { SidebarProvider } from "@/components/shell/sidebar-context";
import { DesktopOnlyGatekeeper } from "@/components/shared/desktop-only-gatekeeper";
import { PwaRegister } from "@/components/pwa/pwa-register";
import { Toaster } from "sonner";

/**
 * Consolidates all client-side root providers behind a single RSC boundary
 * so Next.js dev webpack does not split external/barrel client references across RootLayout.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PwaRegister />
      <ThemeProvider>
        <QueryProvider>
          <DesktopOnlyGatekeeper>
            <AttendanceProvider>
              <SidebarProvider>{children}</SidebarProvider>
            </AttendanceProvider>
          </DesktopOnlyGatekeeper>
          <Toaster
            position="top-right"
            toastOptions={{
              style: {
                background: "#000000",
                color: "#FFFFFF",
                border: "1px solid #1A1A1A",
                borderRadius: "10px",
              },
            }}
          />
        </QueryProvider>
      </ThemeProvider>
    </>
  );
}
