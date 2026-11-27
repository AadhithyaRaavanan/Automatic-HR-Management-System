import * as React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";

const mockRouterRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRouterRefresh, push: vi.fn() }),
  usePathname: () => "/ems/departments",
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock("sonner", () => ({
  toast: {
    success: (...args: any[]) => mockToastSuccess(...args),
    error: (...args: any[]) => mockToastError(...args),
  },
}));

let mockSessionRole: string = "admin";
vi.mock("@/components/shell/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  useAppSession: () => ({
    userId: "admin-1",
    organizationId: "org-1",
    userRole: mockSessionRole,
    fullName: "Admin User",
    timezone: "Asia/Kolkata",
    isLoaded: true,
  }),
}));

vi.mock("@/features/ems/components/ems-navigation-header", () => ({
  EmsNavigationHeader: () => <div data-testid="ems-nav-header" />,
}));

import EmsDepartmentsPage from "@/app/ems/departments/page";

describe("/ems/departments Delete Department UI", () => {
  const sampleDepartments = [
    {
      id: "dept-hr",
      name: "Human Resources",
      code: "HR",
      headId: null,
      headName: null,
      headDesignation: null,
      headEmail: null,
      parentId: null,
      parentName: null,
      memberCount: 2,
      rolesCount: 1,
    },
    {
      id: "dept-mgmt",
      name: "Management",
      code: "MGT",
      headId: "emp-1",
      headName: "Aadhithya",
      headDesignation: "Director",
      headEmail: "aadhithya@zenxea.com",
      parentId: null,
      parentName: null,
      memberCount: 3,
      rolesCount: 2,
    },
    {
      id: "dept-qa",
      name: "Quality Assurance",
      code: "QA",
      headId: null,
      headName: null,
      headDesignation: null,
      headEmail: null,
      parentId: "dept-tech",
      parentName: "Tech",
      memberCount: 1,
      rolesCount: 1,
    },
  ];

  let activeList = [...sampleDepartments];
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSessionRole = "admin";
    activeList = [...sampleDepartments];

    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : String(input);
      const method = init?.method || "GET";

      if (url === "/api/admin/departments" && method === "GET") {
        return {
          ok: true,
          json: async () => ({
            departments: activeList,
            canDelete: true,
            callerRole: "admin",
          }),
        } as any;
      }

      if (url.startsWith("/api/admin/departments?id=") && method === "DELETE") {
        const deletedId = decodeURIComponent(url.split("id=")[1] || "");
        activeList = activeList.filter((d) => d.id !== deletedId);
        return {
          ok: true,
          json: async () => ({ success: true, deletedId }),
        } as any;
      }

      if (url === "/api/admin/departments/head?departmentId=dept-mgmt" && method === "DELETE") {
        return {
          ok: true,
          json: async () => ({ success: true, message: "Department Head removed successfully." }),
        } as any;
      }

      if (url.startsWith("/api/employees")) {
        return { ok: true, json: async () => ({ employees: [] }) } as any;
      }

      if (url === "/api/admin/job-titles") {
        return { ok: true, json: async () => ({ titles: [] }) } as any;
      }

      return { ok: true, json: async () => ({}) } as any;
    });

    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("renders Delete button on every card (with head, vacant, child subdept, members > 0) and deletes via confirmation modal", async () => {
    mockSessionRole = "super_admin";

    render(<EmsDepartmentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Human Resources")).toBeTruthy();
      expect(screen.getByText("Management")).toBeTruthy();
      expect(screen.getByText("Quality Assurance")).toBeTruthy();
    });

    const hrDeleteBtn = screen.getByRole("button", { name: "Delete department Human Resources" });
    const mgmtDeleteBtn = screen.getByRole("button", { name: "Delete department Management" });
    const qaDeleteBtn = screen.getByRole("button", { name: "Delete department Quality Assurance" });

    expect(hrDeleteBtn.textContent).toContain("Delete");
    expect(mgmtDeleteBtn.textContent).toContain("Delete");
    expect(qaDeleteBtn.textContent).toContain("Delete");

    // Click Delete on Quality Assurance (Child Subdept with memberCount > 0 & rolesCount > 0)
    fireEvent.click(qaDeleteBtn);

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getByText(/QA • 1 member • 1 role/i)).toBeTruthy();
    });

    const confirmBtn = screen.getByRole("button", { name: "Delete Department" });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/departments?id=dept-qa",
        expect.objectContaining({ method: "DELETE" })
      );
      expect(mockToastSuccess).toHaveBeenCalledWith("Department 'Quality Assurance' deleted.");
      expect(mockRouterRefresh).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.queryByText("Quality Assurance")).toBeNull();
    });
  });

  it("renders high-contrast Remove Head confirm button inside Remove Department Head modal and removes head cleanly", async () => {
    render(<EmsDepartmentsPage />);

    await waitFor(() => {
      expect(screen.getByText("Management")).toBeTruthy();
    });

    const removeTriggerBtn = screen.getByTitle("Remove Department Head and set to Vacant");
    fireEvent.click(removeTriggerBtn);

    await waitFor(() => {
      expect(screen.getByText("Remove Department Head")).toBeTruthy();
    });

    const removeHeadConfirmBtn = screen.getByRole("button", { name: "Remove Head" });
    expect(removeHeadConfirmBtn.className).toContain("bg-red-600");
    expect(removeHeadConfirmBtn.className).toContain("text-white");

    fireEvent.click(removeHeadConfirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/admin/departments/head?departmentId=dept-mgmt",
        expect.objectContaining({ method: "DELETE" })
      );
      expect(mockToastSuccess).toHaveBeenCalledWith("Department Head removed successfully.");
    });
  });
});
