/**
 * Section 12 Persona Capability Matrix
 *
 * Single source of truth for the 30 capabilities across 4 user personas:
 *   - employee
 *   - manager
 *   - hr
 *   - admin
 *
 * Maps each capability to its UI route, API / RPC entry point, and expected
 * access permissions for automated table-driven testing.
 */

export type UserPersona = "employee" | "manager" | "hr" | "admin";

export type AccessLevel = "allowed" | "denied" | "view_only" | "mandatory" | "optional";

export interface CapabilitySpec {
  id: string; // e.g., 'F12.01'
  name: string;
  uiRoute?: string;
  apiEndpoint?: string;
  rpcName?: string;
  permissions: Record<UserPersona, AccessLevel>;
  description: string;
}

export const PERSONA_MATRIX: CapabilitySpec[] = [
  {
    id: "F12.01",
    name: "Clock In / Clock Out",
    uiRoute: "/",
    rpcName: "check_in",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Self-service time punch on the main dashboard",
  },
  {
    id: "F12.02",
    name: "Live Dynamic Attendance Timer",
    uiRoute: "/",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Continuous dynamic stopwatch counter across navigation",
  },
  {
    id: "F12.03",
    name: "5-Minute Pre-Shift Lock & Badge",
    uiRoute: "/",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Check-in disabled until 5 mins prior to shift start with countdown badge",
  },
  {
    id: "F12.04",
    name: "Shift Start Reminder Notification",
    uiRoute: "/",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "In-app toast reminder when active at exact shift start",
  },
  {
    id: "F12.05",
    name: "Personal Attendance Calendar & History",
    uiRoute: "/attendance",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Monthly attendance grid and personal session logs",
  },
  {
    id: "F12.06",
    name: "Regularization (Missed Punch) Request",
    uiRoute: "/requests",
    rpcName: "request_regularization",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Filing attendance correction requests",
  },
  {
    id: "F12.07",
    name: "Personal Leave Balance & Filing",
    uiRoute: "/leave",
    rpcName: "request_leave",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Filing personal leaves and viewing balance quotas",
  },
  {
    id: "F12.08",
    name: "Personal Task List & Time Logging",
    uiRoute: "/tasks",
    rpcName: "log_task_time",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Managing personal tasks and logging billable minutes",
  },
  {
    id: "F12.09",
    name: "Personal KPI Scorecard View",
    uiRoute: "/kpi",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Viewing personal performance scorecard and metrics",
  },
  {
    id: "F12.10",
    name: "Account Password Reset (/settings)",
    uiRoute: "/settings",
    permissions: {
      employee: "allowed",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Self-service password update in account settings",
  },
  {
    id: "F12.11",
    name: "MFA Setup & Challenge",
    uiRoute: "/mfa-setup",
    permissions: {
      employee: "optional",
      manager: "optional",
      hr: "mandatory",
      admin: "mandatory",
    },
    description: "TOTP authenticator setup; required AAL2 for HR and Admin",
  },
  {
    id: "F12.12",
    name: "Team Live Presence & Roster (/team)",
    uiRoute: "/team",
    permissions: {
      employee: "denied",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Manager team overview and direct reports live presence",
  },
  {
    id: "F12.13",
    name: "Leave Approval Queue (/requests)",
    uiRoute: "/requests",
    rpcName: "approve_leave",
    permissions: {
      employee: "denied",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Reviewing, approving, or rejecting subordinate leave requests",
  },
  {
    id: "F12.14",
    name: "Regularization Approval Queue",
    uiRoute: "/requests",
    rpcName: "approve_regularization",
    permissions: {
      employee: "denied",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Approving or rejecting missed punch regularization requests",
  },
  {
    id: "F12.15",
    name: "Manager Approval Delegation",
    uiRoute: "/requests",
    rpcName: "create_approval_delegation",
    permissions: {
      employee: "denied",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Delegating approval authority to another manager during absence",
  },
  {
    id: "F12.16",
    name: "Team KPI Reviews & Scoring",
    uiRoute: "/kpi",
    rpcName: "submit_kpi_review",
    permissions: {
      employee: "denied",
      manager: "allowed",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Submitting qualitative reviews and performance scores for team",
  },
  {
    id: "F12.17",
    name: "Company Attendance Ledger (/reports)",
    uiRoute: "/reports",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Organization-wide attendance ledger and records table",
  },
  {
    id: "F12.18",
    name: "Excel & CSV Analytics Export",
    apiEndpoint: "/api/attendance/export",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Exporting raw records and analytics workbooks",
  },
  {
    id: "F12.19",
    name: "Company Holiday Calendar (/holidays)",
    uiRoute: "/holidays",
    rpcName: "create_holiday",
    permissions: {
      employee: "view_only",
      manager: "view_only",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Viewing and modifying company holidays and location days off",
  },
  {
    id: "F12.20",
    name: "Leave Policy Configuration (/hr/leave)",
    uiRoute: "/hr/leave",
    rpcName: "hr_update_leave_type_kpi_setting",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Configuring leave types, quotas, and KPI toggles",
  },
  {
    id: "F12.21",
    name: "Manual Leave Balance Adjustment",
    uiRoute: "/hr/leave",
    rpcName: "hr_adjust_balance",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Manually crediting or debiting employee leave days with audit note",
  },
  {
    id: "F12.22",
    name: "Month Locking (lock_month)",
    rpcName: "lock_month",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Locking monthly attendance to freeze payroll inputs",
  },
  {
    id: "F12.23",
    name: "KPI Period Definition & Closure",
    uiRoute: "/kpi",
    rpcName: "close_kpi_period",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Creating review periods, triggering computations, and closing periods",
  },
  {
    id: "F12.24",
    name: "User Provisioning & Resend Email",
    uiRoute: "/admin/users",
    apiEndpoint: "/api/admin/users/invite",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "denied",
      admin: "allowed",
    },
    description: "Inviting users and sending welcome credentials emails via Resend",
  },
  {
    id: "F12.25",
    name: "User Shift Scheduling (/admin/users)",
    uiRoute: "/admin/users",
    apiEndpoint: "/api/admin/users/shift",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "allowed",
      admin: "allowed",
    },
    description: "Customizing member shift start and end times in workforce directory",
  },
  {
    id: "F12.26",
    name: "User Role Assignment & Governance",
    uiRoute: "/admin/users",
    rpcName: "admin_update_org_member_role",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "denied",
      admin: "allowed",
    },
    description: "Promoting or demoting member roles within the organization",
  },
  {
    id: "F12.27",
    name: "Force Signout & MFA Factor Reset",
    uiRoute: "/admin/users",
    apiEndpoint: "/api/admin/users/force-signout",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "denied",
      admin: "allowed",
    },
    description: "Revoking active sessions or resetting lost TOTP factors",
  },
  {
    id: "F12.28",
    name: "Office Location & Geofencing",
    uiRoute: "/admin/locations",
    rpcName: "admin_create_location",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "denied",
      admin: "allowed",
    },
    description: "Configuring physical office facilities, coordinates, and geofence radii",
  },
  {
    id: "F12.29",
    name: "Data Retention & Archive Execution",
    uiRoute: "/admin/settings",
    apiEndpoint: "/api/admin/retention/run",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "denied",
      admin: "allowed",
    },
    description: "Configuring retention thresholds and executing archival cleanups",
  },
  {
    id: "F12.30",
    name: "System Audit Log Inspection",
    uiRoute: "/admin/audits",
    permissions: {
      employee: "denied",
      manager: "denied",
      hr: "denied",
      admin: "allowed",
    },
    description: "Inspecting immutable system audit trails across all administrative actions",
  },
];

