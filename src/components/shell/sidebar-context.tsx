"use client";

import * as React from "react";

export interface SidebarContextValue {
  isCollapsed: boolean;
  toggleSidebar: () => void;
  setCollapsed: (collapsed: boolean) => void;
  mounted: boolean;
}

const SidebarContext = React.createContext<SidebarContextValue | undefined>(undefined);

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const existingContext = React.useContext(SidebarContext);
  if (existingContext) {
    // Reuse the root-level SidebarProvider so per-page AppShell mounts keep collapsed state
    return <>{children}</>;
  }
  return <SidebarProviderInner>{children}</SidebarProviderInner>;
}

function SidebarProviderInner({ children }: { children: React.ReactNode }) {
  // Always initialize to false on both server and client to prevent hydration mismatch
  const [isCollapsed, setIsCollapsed] = React.useState<boolean>(false);
  const [mounted, setMounted] = React.useState<boolean>(false);

  React.useEffect(() => {
    setMounted(true);
    try {
      const stored = localStorage.getItem("remotehr_sidebar_collapsed");
      if (stored !== null) {
        setIsCollapsed(stored === "true");
      }
    } catch {}
  }, []);

  const setCollapsed = React.useCallback((collapsed: boolean) => {
    setIsCollapsed(collapsed);
    try {
      localStorage.setItem("remotehr_sidebar_collapsed", String(collapsed));
      window.dispatchEvent(
        new CustomEvent("remotehr_sidebar_change", { detail: { collapsed } })
      );
    } catch {}
  }, []);

  const toggleSidebar = React.useCallback(() => {
    setIsCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("remotehr_sidebar_collapsed", String(next));
        window.dispatchEvent(
          new CustomEvent("remotehr_sidebar_change", { detail: { collapsed: next } })
        );
      } catch {}
      return next;
    });
  }, []);

  // Global command keyboard shortcut: ⌘B (Mac) or Ctrl+B (Windows/Linux)
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if (isInput) return;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [toggleSidebar]);

  return (
    <SidebarContext.Provider
      value={{
        isCollapsed,
        toggleSidebar,
        setCollapsed,
        mounted,
      }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const context = React.useContext(SidebarContext);
  if (!context) {
    return {
      isCollapsed: false,
      toggleSidebar: () => {},
      setCollapsed: () => {},
      mounted: false,
    };
  }
  return context;
}
