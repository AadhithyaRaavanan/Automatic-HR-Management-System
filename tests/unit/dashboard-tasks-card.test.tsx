import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import type { TaskRecord } from "@/features/tasks/hooks/use-tasks";

const mockUseTasksData = vi.fn();
vi.mock("@/features/tasks/hooks/use-tasks", () => ({
  useTasksData: (...args: any[]) => mockUseTasksData(...args),
}));

import { DashboardTasksCard } from "@/features/tasks/components/dashboard-tasks-card";

function makeTask(overrides: Partial<TaskRecord> & { id: string; title: string }): TaskRecord {
  return {
    organization_id: "org-1",
    project_id: null,
    parent_task_id: null,
    description: null,
    creator_id: "admin-1",
    assignee_id: null,
    status: "todo",
    priority: "medium",
    due_date: null,
    estimated_minutes: null,
    started_at: null,
    completed_at: null,
    cancelled_at: null,
    created_at: "2026-11-27T08:00:00.000Z",
    updated_at: "2026-11-27T08:00:00.000Z",
    ...overrides,
  };
}

describe("DashboardTasksCard clean layout", () => {
  const adminId = "admin-aadhithya";
  const empId = "emp-abc";
  const todayIso = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders clean header and rows with optional project subtitle and muted due text", () => {
    mockUseTasksData.mockReturnValue({
      isLoading: false,
      data: {
        tasks: [
          makeTask({
            id: "t-1",
            title: "bug fixes",
            assignee_id: adminId,
            priority: "medium",
            due_date: todayIso,
            project_id: "proj-bug",
          }),
          makeTask({
            id: "t-2",
            title: "bifunctional tasks",
            assignee_id: adminId,
            priority: "medium",
            due_date: todayIso,
            project_id: null,
          }),
        ],
        projects: [{ id: "proj-bug", code: "BUG", name: "Bug Triage" }],
        employees: [],
      },
    });

    render(<DashboardTasksCard userId={adminId} userRole="admin" />);

    expect(screen.getByText("My Tasks")).toBeTruthy();
    expect(screen.getByText("Open assignments and upcoming deadlines")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Open Tasks Board/i }).getAttribute("href")).toBe("/tasks");
    expect(screen.queryByRole("tablist")).toBeNull();

    expect(screen.getByText("bug fixes")).toBeTruthy();
    expect(screen.getByText("BUG · Bug Triage")).toBeTruthy();
    const standalone = screen.getByText("bifunctional tasks");
    expect(standalone).toBeTruthy();
    expect(standalone.parentElement?.childElementCount).toBe(1);
    expect(screen.getAllByText("Due today · Medium")).toHaveLength(2);
  });

  it("renders centered empty state without extra summary banners when no open tasks are assigned", () => {
    mockUseTasksData.mockReturnValue({
      isLoading: false,
      data: {
        tasks: [
          makeTask({ id: "t-unassigned", title: "Unassigned task", assignee_id: null, creator_id: adminId }),
          makeTask({ id: "t-other", title: "Other user task", assignee_id: empId, creator_id: adminId }),
        ],
        projects: [],
        employees: [],
      },
    });

    render(<DashboardTasksCard userId={adminId} userRole="admin" />);

    expect(screen.getByText("No open tasks assigned")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Go to Tasks" }).getAttribute("href")).toBe("/tasks");
    expect(screen.queryByText(/open on the board/i)).toBeNull();
    expect(screen.queryByText(/View team tasks/i)).toBeNull();
  });
});
