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
    if (typeof localStorage === "undefined" || typeof localStorage.clear !== "function") {
      const store = new Map<string, string>();
      const memoryStorage = {
        getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
        setItem: (key: string, value: string) => {
          store.set(key, String(value));
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => store.clear(),
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        get length() {
          return store.size;
        },
      };
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        writable: true,
        value: memoryStorage,
      });
      if (typeof window !== "undefined") {
        Object.defineProperty(window, "localStorage", {
          configurable: true,
          writable: true,
          value: memoryStorage,
        });
      }
    } else {
      localStorage.clear();
    }
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

  describe("Shell navigation", () => {
    it("opens search from the sidebar and exposes export and notifications in the header", async () => {
      await act(async () => {
        render(
          <SidebarProvider>
            <CurvedSidebar isCollapsed={false} />
            <TopNavBar />
          </SidebarProvider>
        );
      });

      expect(screen.getByRole("button", { name: "Export data" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Notifications" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog", { name: "Command palette" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /search here/i }));
      expect(await screen.findByRole("dialog", { name: "Command palette" })).toBeVisible();
    });
  });

  describe("CommandPalette Sidebar Commands", () => {
    it("collapses and expands the sidebar through the command palette", async () => {
      await act(async () => {
        render(
          <SidebarProvider>
            <CommandPalette open={true} onOpenChange={vi.fn()} />
            <TestConsumer />
          </SidebarProvider>
        );
      });

      fireEvent.click(screen.getByRole("option", { name: /collapse sidebar/i }));
      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("collapsed");
      fireEvent.click(screen.getByRole("option", { name: /expand sidebar/i }));
      expect(screen.getByTestId("sidebar-state")).toHaveTextContent("expanded");
    });
  });

  describe("Collapsed State Persistence Across Remounts", () => {
    it("keeps CurvedSidebar collapsed on first render when nested SidebarProvider remounts", async () => {
      const renderStates: boolean[] = [];

      function RouteWrapper({ pageKey }: { pageKey: string }) {
        const { isCollapsed } = useSidebar();
        renderStates.push(isCollapsed);
        return (
          <SidebarProvider key={pageKey}>
            <CurvedSidebar />
          </SidebarProvider>
        );
      }

      function Harness() {
        const [page, setPage] = React.useState("attendance");
        const { setCollapsed } = useSidebar();
        return (
          <div>
            <button data-testid="collapse-action" onClick={() => setCollapsed(true)}>
              Collapse
            </button>
            <button data-testid="switch-page" onClick={() => setPage("leave")}>
              Switch Page
            </button>
            <RouteWrapper pageKey={page} />
          </div>
        );
      }

      await act(async () => {
        render(
          <SidebarProvider>
            <Harness />
          </SidebarProvider>
        );
      });

      await act(async () => {
        fireEvent.click(screen.getByTestId("collapse-action"));
      });
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");

      renderStates.length = 0;

      await act(async () => {
        fireEvent.click(screen.getByTestId("switch-page"));
      });

      expect(renderStates.every((collapsed) => collapsed === true)).toBe(true);
      expect(screen.getByTestId("sidebar")).toHaveAttribute("data-collapsed", "true");
    });
  });
});
