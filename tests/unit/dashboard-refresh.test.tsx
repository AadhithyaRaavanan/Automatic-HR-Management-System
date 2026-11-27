import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mockRouterRefresh = vi.fn();
const mockRouterPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: mockRouterPush }),
}));

const mockRefetchQueries = vi.fn().mockResolvedValue(undefined);
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ refetchQueries: mockRefetchQueries }),
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: any[]) => mockToastError(...args),
    success: vi.fn(),
    info: vi.fn(),
  },
}));

const mockRefetchAttendance = vi.fn();
const mockRefetchNotifications = vi.fn().mockResolvedValue({});
const mockRefetchRegularizations = vi.fn().mockResolvedValue({});

vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAppSession: () => ({
    userId: "user-1",
    fullName: "Aadhithya Raavanan",
    timezone: "Asia/Kolkata",
    userRole: "admin",
  }),
}));

vi.mock("@/features/attendance/hooks/use-attendance-today", () => ({
  useAttendanceToday: () => ({
    data: {
      workDate: "2026-11-27",
      timezone: "Asia/Kolkata",
      targetMinutes: 480,
      shiftStartTime: "09:00:00",
      shiftEndTime: "17:00:00",
      activeSession: null,
      sessions: [],
      daySummary: null,
      weekTotalMinutes: 120,
      streakDays: 2,
    },
    isLoading: false,
    refetch: mockRefetchAttendance,
  }),
}));

vi.mock("@/features/attendance/hooks/use-check-in", () => ({
  useCheckIn: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
}));

vi.mock("@/features/attendance/hooks/use-check-out", () => ({
  useCheckOut: () => ({ isPending: false, mutate: vi.fn(), mutateAsync: vi.fn() }),
}));

vi.mock("@/features/attendance/hooks/use-attendance-timer", () => ({
  useAttendanceTimer: () => ({ elapsedSeconds: 0, isOnBreak: false, formattedTime: "00:00:00" }),
}));

vi.mock("@/features/notifications/hooks/use-notifications", () => ({
  useNotifications: () => ({
    notifications: [],
    unreadCount: 0,
    markSingleRead: vi.fn(),
    markAllRead: vi.fn(),
    refetch: mockRefetchNotifications,
  }),
}));

vi.mock("@/features/requests/hooks/use-regularizations", () => ({
  useRegularizations: () => ({
    data: [],
    refetch: mockRefetchRegularizations,
  }),
  useSubmitRegularization: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

vi.mock("@/features/attendance/components/live-presence-widget", () => ({
  LivePresenceWidget: () => <div data-testid="live-presence" />,
}));

vi.mock("@/features/tasks/components/dashboard-tasks-card", () => ({
  DashboardTasksCard: () => <div data-testid="dashboard-tasks" />,
}));

vi.mock("@/features/attendance/components/weekly-hours-chart", () => ({
  WeeklyHoursChart: () => <div data-testid="weekly-chart" />,
}));

vi.mock("@/features/calendar/components/attendance-calendar-card", () => ({
  AttendanceCalendarCard: () => <div data-testid="calendar-card" />,
}));

vi.mock("@/features/requests/components/request-modal", () => ({
  RequestModal: () => null,
}));

vi.mock("@/features/attendance/components/early-checkout-dialog", () => ({
  EarlyCheckOutDialog: () => null,
}));

const mockSupabaseFrom = vi.fn(() => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  gte: vi.fn().mockReturnThis(),
  in: vi.fn().mockResolvedValue({ data: [], error: null }),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn().mockResolvedValue({ data: [], error: null }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: { session: { access_token: "tok-1", user: { id: "user-1" } } },
      }),
    },
    from: mockSupabaseFrom,
  }),
}));

import EmployeeDashboardPage from "@/app/page";

describe("Home Dashboard header refresh button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("refreshes attendance, week chart, tasks, notifications, clock sync, and router with spin feedback", async () => {
    let resolveAttendance!: (val: any) => void;
    const pendingAttendance = new Promise((res) => {
      resolveAttendance = res;
    });
    mockRefetchAttendance.mockReturnValueOnce(pendingAttendance);

    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ epoch: Date.now() }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const dispatchSpy = vi.spyOn(window, "dispatchEvent");

    render(<EmployeeDashboardPage />);

    const refreshBtn = screen.getByRole("button", { name: "Refresh attendance records" }) as HTMLButtonElement;
    expect(refreshBtn.disabled).toBe(false);

    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(refreshBtn.disabled).toBe(true);
      expect(refreshBtn.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
    });

    resolveAttendance({ isError: false, error: null });

    await waitFor(() => {
      expect(refreshBtn.disabled).toBe(false);
    });

    expect(mockRefetchAttendance).toHaveBeenCalledTimes(1);
    expect(mockRefetchNotifications).toHaveBeenCalledTimes(1);
    expect(mockRefetchRegularizations).toHaveBeenCalledTimes(1);
    expect(mockRefetchQueries).toHaveBeenCalledWith({ queryKey: ["tasks-workspace"] });
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^\/api\/time\?_t=\d+$/),
      expect.objectContaining({ cache: "no-store" })
    );
    expect(dispatchSpy).toHaveBeenCalled();
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows an error toast when attendance refresh returns an error", async () => {
    mockRefetchAttendance.mockResolvedValueOnce({
      isError: true,
      error: new Error("Network failure"),
    });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(() =>
        Promise.resolve(
          new Response(JSON.stringify({ epoch: Date.now() }), {
            status: 200,
            headers: { "content-type": "application/json" },
          })
        )
      )
    );

    render(<EmployeeDashboardPage />);

    const refreshBtn = screen.getByRole("button", { name: "Refresh attendance records" }) as HTMLButtonElement;
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Network failure");
      expect(refreshBtn.disabled).toBe(false);
    });
  });
});
