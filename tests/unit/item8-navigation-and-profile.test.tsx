import { describe, expect, it, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import {
  buildBoardColumnStorageKey,
  getInitialExpandedColumns,
  loadSavedBoardColumnState,
  saveBoardColumnState,
} from "@/features/tasks/board-columns";
import { FeatureOrRoleGate } from "@/components/shared/gated-destination-guard";
import { BottomTabBar } from "@/components/shell/bottom-tab-bar";

const mockSessionState = vi.hoisted(() => ({
  userId: "user-1",
  organizationId: "org-beta",
  organizationName: "Beta Corp",
  userRole: "employee" as "employee" | "team_lead" | "manager" | "hr" | "admin",
  isLoaded: true,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/tasks",
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/components/shell/app-shell", () => ({
  useAppSession: () => mockSessionState,
}));

describe("Item 8 — Tasks board columns, role/feature gates, and workspace session precedence", () => {
  beforeEach(() => {
    window.localStorage.clear();
    mockSessionState.userRole = "employee";
    mockSessionState.isLoaded = true;
    mockSessionState.organizationName = "Beta Corp";
  });

  it("expands nonempty board columns on first visit and preserves user toggles afterwards", () => {
    const columns = [
      { key: "todo" },
      { key: "in_progress" },
      { key: "blocked" },
      { key: "done" },
      { key: "cancelled" },
    ];
    const initial = getInitialExpandedColumns(columns, [
      { id: "t1", status: "in_progress" },
    ]);

    expect(initial).toEqual({
      todo: false,
      in_progress: true,
      blocked: false,
      done: false,
      cancelled: false,
    });

    const key = buildBoardColumnStorageKey("user-1", "org-beta");
    expect(loadSavedBoardColumnState(key)).toBeNull();

    const userOverride = { ...initial, in_progress: false, todo: true };
    saveBoardColumnState(key, userOverride);
    expect(loadSavedBoardColumnState(key)).toEqual(userOverride);
  });

  it("explains role- and feature-gated destinations clearly", () => {
    const { rerender } = render(
      <FeatureOrRoleGate featureEnabled={false} featureName="Locations & Facilities">
        <div>Secret Locations</div>
      </FeatureOrRoleGate>
    );
    expect(screen.getByText("Feature not enabled")).toBeInTheDocument();
    expect(screen.queryByText("Secret Locations")).toBeNull();

    mockSessionState.userRole = "employee";
    rerender(
      <FeatureOrRoleGate
        featureEnabled={true}
        featureName="Audit Viewer"
        allowedRoles={["admin"]}
      >
        <div>Audit Table</div>
      </FeatureOrRoleGate>
    );
    expect(screen.getByText("Role-restricted destination")).toBeInTheDocument();
    expect(screen.queryByText("Audit Table")).toBeNull();

    mockSessionState.userRole = "admin";
    rerender(
      <FeatureOrRoleGate
        featureEnabled={true}
        featureName="Audit Viewer"
        allowedRoles={["admin"]}
      >
        <div>Audit Table</div>
      </FeatureOrRoleGate>
    );
    expect(screen.getByText("Audit Table")).toBeInTheDocument();
  });

  it("uses loaded session role over stale localStorage role when hiding unavailable nav links", () => {
    window.localStorage.setItem("remotehr_cached_role", "admin");
    mockSessionState.isLoaded = true;
    mockSessionState.userRole = "employee";

    render(<BottomTabBar />);
    expect(screen.queryByText("EMS Hub")).toBeNull();
    expect(screen.queryByText("Reports")).toBeNull();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
  });
});
