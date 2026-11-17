import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render, screen, fireEvent, act } from "@testing-library/react";
import "@testing-library/jest-dom";
import { SidebarProvider, useSidebar } from "@/components/shell/sidebar-context";
import { CurvedSidebar } from "@/components/shell/curved-sidebar";
import { TopNavBar } from "@/components/shell/top-nav-bar";
import { CommandPalette } from "@/components/shared/command-palette";

// Mock Supabase
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      signOut: vi.fn(),
      getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
      getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: vi.fn().mockResolvedValue({ data: null }),
          count: 5,
        }),
      }),
    }),
  }),
}));

// Mock Next.js navigation
vi.mock("next/navigation", () => ({
  usePathname: () => "/attendance",
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

// Mock notifications hook
vi.mock("@/features/notifications/hooks/use-notifications", () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    markAsRead: vi.fn(),
    clearAll: vi.fn(),
  }),
}));

describe("Sidebar Collapse & Expand with Command Support", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    if (typeof window !== "undefined") {
      (window as any).ResizeObserver = class ResizeObserver {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      window.HTMLElement.prototype.scrollIntoView = vi.fn();
      Element.prototype.scrollIntoView = vi.fn();
    }
  });

  function TestConsumer() {
    const { isCollapsed, toggleSidebar, setCollapsed } = useSidebar();
    return (
      <div>
        <span data-testid="sidebar-state">{isCollapsed ? "collapsed" : "expanded"}</span>
        <button data-testid="toggle-btn" onClick={toggleSidebar}>
          Toggle
        </button>
        <button data-testid="collapse-btn" onClick={() => setCollapsed(true)}>
          Collapse
        </button>
        <button data-testid="expand-btn" onClick={() => setCollapsed(false)}>
          Expand
        </button>
      </div>
    );
  }

  describe("SidebarProvider & useSidebar Hook", () => {
    it("defaults to expanded state so labels and icons are displayed side-by-side", () => {
      render(
        <SidebarProvider>
          <TestConsumer />
        </SidebarProvider>
      );

      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("expanded");
    });

    it("toggles between collapsed and expanded when toggleSidebar is called", () => {
      render(
        <SidebarProvider>
          <TestConsumer />
        </SidebarProvider>
      );

      const toggleBtn = screen.getByTestId("toggle-btn");
      act(() => {
        fireEvent.click(toggleBtn);
      });
      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("collapsed");

      act(() => {
        fireEvent.click(toggleBtn);
      });
      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("expanded");
    });

    it("sets specific collapsed state and persists to localStorage", () => {
      render(
        <SidebarProvider>
          <TestConsumer />
        </SidebarProvider>
      );

      const collapseBtn = screen.getByTestId("collapse-btn");
      act(() => {
        fireEvent.click(collapseBtn);
      });
      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("collapsed");
      expect(localStorage.getItem("remotehr_sidebar_collapsed")).toBe("true");

      const expandBtn = screen.getByTestId("expand-btn");
      act(() => {
        fireEvent.click(expandBtn);
      });
      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("expanded");
      expect(localStorage.getItem("remotehr_sidebar_collapsed")).toBe("false");
    });

    it("toggles on Cmd+B / Ctrl+B global keyboard shortcut", () => {
      render(
        <SidebarProvider>
          <TestConsumer />
        </SidebarProvider>
      );

      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("expanded");

      // Press Command+B
      act(() => {
        fireEvent.keyDown(window, { key: "b", metaKey: true });
      });
      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("collapsed");

      // Press Ctrl+B
      act(() => {
        fireEvent.keyDown(window, { key: "b", ctrlKey: true });
      });
      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("expanded");
    });
  });

  describe("CurvedSidebar Component Rendering", () => {
    it("renders both icon and text side-by-side when expanded", async () => {
      await act(async () => {
        render(
          <SidebarProvider>
            <CurvedSidebar isCollapsed={false} />
          </SidebarProvider>
        );
      });

      const sidebar = screen.getByTestId("sidebar");
      expect(sidebar).toHaveAttribute("data-collapsed", "false");

      // Check for labels visible in expanded sidebar
      expect(screen.getByText("Dashboard")).toBeInTheDocument();
      expect(screen.getByText("Attendance")).toBeInTheDocument();
      expect(screen.getByText("Tasks")).toBeInTheDocument();
      expect(screen.getByText("KPI")).toBeInTheDocument();
      expect(screen.getByText("Leave")).toBeInTheDocument();
      expect(screen.getByText("RemoteHR")).toBeInTheDocument();
    });

    it("renders compact icon mode when collapsed", async () => {
      await act(async () => {
        render(
          <SidebarProvider>
            <CurvedSidebar isCollapsed={true} />
          </SidebarProvider>
        );
      });

      const sidebar = screen.getByTestId("sidebar");
      expect(sidebar).toHaveAttribute("data-collapsed", "true");

      // In collapsed mode, brand logo is present
      expect(screen.getByTitle("RemoteHR Home")).toBeInTheDocument();
    });
  });

  describe("TopNavBar Clean Bar Rendering", () => {
    it("renders only search bar, theme toggle, notification bell, and export data button", async () => {
      await act(async () => {
        render(
          <SidebarProvider>
            <TopNavBar />
          </SidebarProvider>
        );
      });

      // Search bar
      expect(screen.getByText("Search or type command")).toBeInTheDocument();
      // Export data
      expect(screen.getByText("Export data")).toBeInTheDocument();
      // Notification bell
      expect(screen.getByTitle("Notifications")).toBeInTheDocument();

      // Verify that clutter buttons and horizontal navigation tabs are completely removed
      expect(screen.queryByTestId("navbar-sidebar-toggle")).not.toBeInTheDocument();
      expect(screen.queryByText("Founder • Management")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("My Profile")).not.toBeInTheDocument();
    });
  });

  describe("CommandPalette Sidebar Commands", () => {
    it("renders sidebar collapse & expand commands inside Command Palette", async () => {
      await act(async () => {
        render(
          <SidebarProvider>
            <CommandPalette open={true} onOpenChange={vi.fn()} />
          </SidebarProvider>
        );
      });

      expect(screen.getAllByText(/Collapse Sidebar/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Expand Sidebar Navigation")).toBeInTheDocument();
      expect(screen.getByText("Collapse Sidebar Navigation")).toBeInTheDocument();
    });
  });
});
