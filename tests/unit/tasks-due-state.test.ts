import { describe, it, expect } from "vitest";
import { getTaskDueState } from "@/features/tasks/hooks/use-tasks";

describe("Section 3: Task Due State Helper", () => {
  const ref = "2026-11-10";

  it("returns 'none' when due_date is null", () => {
    expect(getTaskDueState(null, "todo", ref)).toBe("none");
  });

  it("marks open past-due tasks as overdue", () => {
    expect(getTaskDueState("2026-11-09", "todo", ref)).toBe("overdue");
    expect(getTaskDueState("2026-11-01", "in_progress", ref)).toBe("overdue");
    expect(getTaskDueState("2026-11-08", "blocked", ref)).toBe("overdue");
  });

  it("marks tasks due today or tomorrow as due_soon", () => {
    expect(getTaskDueState("2026-11-10", "todo", ref)).toBe("due_soon");
    expect(getTaskDueState("2026-11-11", "in_progress", ref)).toBe("due_soon");
  });

  it("marks future tasks beyond tomorrow as upcoming", () => {
    expect(getTaskDueState("2026-11-12", "todo", ref)).toBe("upcoming");
  });

  it("does not flag done or cancelled tasks with past due dates as overdue", () => {
    expect(getTaskDueState("2026-11-01", "done", ref)).toBe("upcoming");
    expect(getTaskDueState("2026-11-01", "cancelled", ref)).toBe("upcoming");
  });
});

