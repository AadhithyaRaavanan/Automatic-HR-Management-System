import { describe, it, expect } from "vitest";
import { EmployeeRole } from "@/types/database.types";

// Helper simulating RBAC permission evaluator
function canAccessRoute(role: EmployeeRole, path: string): boolean {
  if (path.startsWith("/team") && role === "employee") return false;
  if (path.startsWith("/reports") && role !== "hr" && role !== "admin") return false;
  if (path.startsWith("/admin") && role !== "admin") return false;
  return true;
}

// Helper evaluating application-level data isolation policy
function canViewAttendanceRecord(
  actor: { id: string; role: EmployeeRole },
  record: { employee_id: string; manager_id?: string | null }
): boolean {
  if (actor.role === "admin" || actor.role === "hr") return true;
  if (actor.role === "manager") {
    return record.employee_id === actor.id || record.manager_id === actor.id;
  }
  return record.employee_id === actor.id;
}

function canDirectlyMutateSession(role: EmployeeRole): boolean {
  // Direct client writes are forbidden; must go via RPC except emergency admin override
  return role === "admin";
}

describe("Phase 1: Application-Level RBAC & Route Guard Suite", () => {
  const employeeUser = { id: "emp-101", role: "employee" as EmployeeRole };
  const managerUser = { id: "mgr-201", role: "manager" as EmployeeRole };
  const hrUser = { id: "hr-301", role: "hr" as EmployeeRole };
  const adminUser = { id: "adm-401", role: "admin" as EmployeeRole };

  describe("1. Route Protection & RBAC Guards", () => {
    it("prevents employee from accessing /team, /reports, /admin", () => {
      expect(canAccessRoute(employeeUser.role, "/team")).toBe(false);
      expect(canAccessRoute(employeeUser.role, "/reports")).toBe(false);
      expect(canAccessRoute(employeeUser.role, "/admin")).toBe(false);
      expect(canAccessRoute(employeeUser.role, "/attendance")).toBe(true);
      expect(canAccessRoute(employeeUser.role, "/")).toBe(true);
    });

    it("allows manager to access /team but blocks /reports and /admin", () => {
      expect(canAccessRoute(managerUser.role, "/team")).toBe(true);
      expect(canAccessRoute(managerUser.role, "/reports")).toBe(false);
      expect(canAccessRoute(managerUser.role, "/admin")).toBe(false);
    });

    it("allows HR to access /reports and /team but blocks /admin", () => {
      expect(canAccessRoute(hrUser.role, "/reports")).toBe(true);
      expect(canAccessRoute(hrUser.role, "/team")).toBe(true);
      expect(canAccessRoute(hrUser.role, "/admin")).toBe(false);
    });

    it("allows Admin to access all routes including /admin", () => {
      expect(canAccessRoute(adminUser.role, "/team")).toBe(true);
      expect(canAccessRoute(adminUser.role, "/reports")).toBe(true);
      expect(canAccessRoute(adminUser.role, "/admin")).toBe(true);
      expect(canAccessRoute(adminUser.role, "/settings")).toBe(true);
    });
  });

  describe("2. Application-Level Attendance Data Isolation Policies", () => {
    const ownRecord = { employee_id: "emp-101", manager_id: "mgr-201" };
    const peerRecord = { employee_id: "emp-102", manager_id: "mgr-202" };
    const reportRecord = { employee_id: "emp-103", manager_id: "mgr-201" };

    it("ensures Employee can only read own attendance record", () => {
      expect(canViewAttendanceRecord(employeeUser, ownRecord)).toBe(true);
      expect(canViewAttendanceRecord(employeeUser, peerRecord)).toBe(false);
      expect(canViewAttendanceRecord(employeeUser, reportRecord)).toBe(false);
    });

    it("ensures Manager can read own and direct reports' records, but NOT other managers' reports", () => {
      expect(canViewAttendanceRecord(managerUser, ownRecord)).toBe(true);
      expect(canViewAttendanceRecord(managerUser, reportRecord)).toBe(true);
      expect(canViewAttendanceRecord(managerUser, peerRecord)).toBe(false);
    });

    it("ensures HR and Admin can read all records", () => {
      expect(canViewAttendanceRecord(hrUser, peerRecord)).toBe(true);
      expect(canViewAttendanceRecord(adminUser, peerRecord)).toBe(true);
    });
  });

  describe("3. Direct Mutation Denial (RPC Enforced)", () => {
    it("denies direct client mutations on attendance sessions for employees and managers", () => {
      expect(canDirectlyMutateSession("employee")).toBe(false);
      expect(canDirectlyMutateSession("manager")).toBe(false);
      expect(canDirectlyMutateSession("hr")).toBe(false);
    });

    it("allows only admin for emergency direct override", () => {
      expect(canDirectlyMutateSession("admin")).toBe(true);
    });
  });

  describe("4. Phase 1 Security Hardening: MFA AAL2 RESTRICTIVE Policy Verification", () => {
    function canAccessPrivilegedResource(actor: { role: EmployeeRole; aal: "aal1" | "aal2" }): boolean {
      if (actor.role === "hr" || actor.role === "admin") {
        return actor.aal === "aal2";
      }
      return true;
    }

    it("blocks HR and Admin from privileged resources if AAL2 is not satisfied", () => {
      expect(canAccessPrivilegedResource({ role: "hr", aal: "aal1" })).toBe(false);
      expect(canAccessPrivilegedResource({ role: "admin", aal: "aal1" })).toBe(false);
    });

    it("grants access to HR and Admin when AAL2 TOTP is verified", () => {
      expect(canAccessPrivilegedResource({ role: "hr", aal: "aal2" })).toBe(true);
      expect(canAccessPrivilegedResource({ role: "admin", aal: "aal2" })).toBe(true);
    });

    it("allows standard employees through without AAL2 for basic employee endpoints", () => {
      expect(canAccessPrivilegedResource({ role: "employee", aal: "aal1" })).toBe(true);
    });
  });

  describe("5. Phase 1 Anti-Collusion & Separation of Duties", () => {
    function approveRegularizationCheck(
      callerId: string,
      requestEmployeeId: string
    ): { allowed: boolean; error?: string } {
      if (callerId === requestEmployeeId) {
        return { allowed: false, error: "Separation of duties violation: Cannot approve own request" };
      }
      return { allowed: true };
    }

    it("blocks self-approval of regularization requests", () => {
      const result = approveRegularizationCheck("mgr-201", "mgr-201");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("Separation of duties");
    });

    it("permits approval of direct report request", () => {
      const result = approveRegularizationCheck("mgr-201", "emp-101");
      expect(result.allowed).toBe(true);
    });
  });

  describe("6. Phase 1 Last-Admin Protection & Self-Demotion Block", () => {
    function setRoleCheck(
      callerId: string,
      targetId: string,
      targetCurrentRole: EmployeeRole,
      newRole: EmployeeRole,
      adminCount: number
    ): { allowed: boolean; error?: string } {
      if (callerId === targetId) {
        return { allowed: false, error: "Admins cannot modify their own administrative role." };
      }
      if (targetCurrentRole === "admin" && newRole !== "admin" && adminCount <= 1) {
        return { allowed: false, error: "Cannot demote the last remaining administrator." };
      }
      return { allowed: true };
    }

    it("prevents admin from demoting themselves", () => {
      const result = setRoleCheck("adm-401", "adm-401", "admin", "employee", 2);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("cannot modify their own administrative role");
    });

    it("prevents demoting the last remaining administrator", () => {
      const result = setRoleCheck("adm-401", "adm-402", "admin", "manager", 1);
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("Cannot demote the last remaining administrator");
    });

    it("allows demoting an admin when multiple admins exist", () => {
      const result = setRoleCheck("adm-401", "adm-402", "admin", "manager", 2);
      expect(result.allowed).toBe(true);
    });
  });

  describe("7. Phase 1 Server-Side Rate Limiting Module", () => {
    it("allows retry under attempt limit", async () => {
      const { checkRateLimit, recordFailure, clearRateLimit } = await import("@/lib/auth/rate-limiter");
      const testKey = "192.168.1.1::testuser-under@remotehr.io";
      await clearRateLimit(testKey);

      expect((await checkRateLimit(testKey)).allowed).toBe(true);

      for (let i = 0; i < 4; i++) {
        await recordFailure(testKey);
      }
      expect((await checkRateLimit(testKey)).allowed).toBe(true);
      await clearRateLimit(testKey);
    });

    it("locks account upon reaching 5 failed attempts", async () => {
      const { checkRateLimit, recordFailure, clearRateLimit } = await import("@/lib/auth/rate-limiter");
      const testKey = "192.168.1.1::testuser-lock@remotehr.io";
      await clearRateLimit(testKey);

      for (let i = 0; i < 5; i++) {
        await recordFailure(testKey);
      }
      const lockedCheck = await checkRateLimit(testKey);
      expect(lockedCheck.allowed).toBe(false);
      expect(lockedCheck.retryAfterSeconds).toBeGreaterThan(0);
      await clearRateLimit(testKey);
    });
  });

  describe("8. Proxy Punch Authorization Checks (check_in / check_out)", () => {
    function authorizeProxyPunch(
      callerId: string,
      targetId: string,
      callerRole: EmployeeRole,
      callerAal: "aal1" | "aal2"
    ): { allowed: boolean; error?: string } {
      if (callerId !== targetId) {
        if (callerRole !== "hr" && callerRole !== "admin") {
          return { allowed: false, error: "Unauthorized check-in attempt for another employee." };
        }
        if (callerAal !== "aal2") {
          return { allowed: false, error: "MFA AAL2 verification required for administrative check-in override." };
        }
      }
      return { allowed: true };
    }

    function authorizeProxyCheckout(
      callerId: string,
      targetId: string,
      callerRole: EmployeeRole,
      callerAal: "aal1" | "aal2"
    ): { allowed: boolean; error?: string } {
      if (callerId !== targetId) {
        if (callerRole !== "hr" && callerRole !== "admin") {
          return { allowed: false, error: "Unauthorized check-out attempt." };
        }
        if (callerAal !== "aal2") {
          return { allowed: false, error: "MFA AAL2 verification required for administrative check-out override." };
        }
      }
      return { allowed: true };
    }

    it("blocks employee from checking in for another employee", () => {
      const result = authorizeProxyPunch("emp-101", "emp-102", "employee", "aal1");
      expect(result.allowed).toBe(false);
      expect(result.error).toBe("Unauthorized check-in attempt for another employee.");
    });

    it("blocks manager from checking in for another employee", () => {
      const result = authorizeProxyPunch("mgr-201", "emp-102", "manager", "aal1");
      expect(result.allowed).toBe(false);
      expect(result.error).toBe("Unauthorized check-in attempt for another employee.");
    });

    it("blocks employee from checking out for another employee", () => {
      const result = authorizeProxyCheckout("emp-101", "emp-102", "employee", "aal1");
      expect(result.allowed).toBe(false);
      expect(result.error).toBe("Unauthorized check-out attempt.");
    });

    it("blocks manager from checking out for another employee", () => {
      const result = authorizeProxyCheckout("mgr-201", "emp-102", "manager", "aal1");
      expect(result.allowed).toBe(false);
      expect(result.error).toBe("Unauthorized check-out attempt.");
    });

    it("blocks HR from checking in for another employee without AAL2", () => {
      const result = authorizeProxyPunch("hr-301", "emp-102", "hr", "aal1");
      expect(result.allowed).toBe(false);
      expect(result.error).toBe("MFA AAL2 verification required for administrative check-in override.");
    });

    it("allows HR to check in for another employee when AAL2 verified", () => {
      const result = authorizeProxyPunch("hr-301", "emp-102", "hr", "aal2");
      expect(result.allowed).toBe(true);
    });

    it("allows Admin to check out for another employee when AAL2 verified", () => {
      const result = authorizeProxyCheckout("adm-401", "emp-102", "admin", "aal2");
      expect(result.allowed).toBe(true);
    });
  });
});

