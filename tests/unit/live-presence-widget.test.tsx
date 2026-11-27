import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mockRouterRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh }),
}));

const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    error: (...args: any[]) => mockToastError(...args),
  },
}));

import { LivePresenceWidget } from "@/features/attendance/components/live-presence-widget";

describe("LivePresenceWidget Refresh Live Presence button", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("triggers an uncached refetch with animate-spin feedback and updates presence logs", async () => {
    let resolveManual!: (value: Response) => void;
    const manualPromise = new Promise<Response>((resolve) => {
      resolveManual = resolve;
    });

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            counts: { total: 1, active: 0, checkedOut: 0, notLoggedIn: 1 },
            logs: [
              {
                id: "emp-1",
                name: "Riya Sharma",
                email: "riya@zenxea.com",
                avatarUrl: null,
                department: "Engineering",
                jobTitle: "Admin",
                status: "not_logged_in",
                checkInAt: null,
                checkOutAt: null,
                totalMinutes: 0,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockReturnValueOnce(manualPromise);

    vi.stubGlobal("fetch", fetchMock);

    render(<LivePresenceWidget userTimezone="Asia/Kolkata" />);

    await screen.findByText("Riya Sharma");
    expect(screen.getByText("Not Checked In")).toBeTruthy();

    const refreshBtn = screen.getByRole("button", { name: "Refresh Live Presence" }) as HTMLButtonElement;
    expect(refreshBtn.disabled).toBe(false);

    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(refreshBtn.disabled).toBe(true);
      expect(refreshBtn.querySelector("svg")?.getAttribute("class")).toContain("animate-spin");
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toMatch(/^\/api\/attendance\/live-presence\?_t=\d+$/);
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ cache: "no-store" });

    resolveManual(
      new Response(
        JSON.stringify({
          success: true,
          counts: { total: 1, active: 1, checkedOut: 0, notLoggedIn: 0 },
          logs: [
            {
              id: "emp-1",
              name: "Riya Sharma",
              email: "riya@zenxea.com",
              avatarUrl: null,
              department: "Engineering",
              jobTitle: "Admin",
              status: "active",
              checkInAt: "2026-11-27T04:00:00.000Z",
              checkOutAt: null,
              totalMinutes: 15,
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } }
      )
    );

    await screen.findByText("Logged In (Online)");
    expect(refreshBtn.disabled).toBe(false);
    expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    expect(mockToastError).not.toHaveBeenCalled();
  });

  it("shows an error toast and recovers loading state if manual refresh fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            counts: { total: 0, active: 0, checkedOut: 0, notLoggedIn: 0 },
            logs: [],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "Permission denied" }), {
          status: 400,
          headers: { "content-type": "application/json" },
        })
      );

    vi.stubGlobal("fetch", fetchMock);

    render(<LivePresenceWidget userTimezone="UTC" />);

    const refreshBtn = await screen.findByRole("button", { name: "Refresh Live Presence" }) as HTMLButtonElement;
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalledWith("Permission denied");
      expect(refreshBtn.disabled).toBe(false);
    });
  });
});
