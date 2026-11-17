import { FEATURES } from "@/lib/features";

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  path: string;
  category: string;
}

const RAW_ROLE_TUTORIAL_STEPS: Record<string, TutorialStep[]> = {
  employee: [
    {
      id: "emp-attendance",
      title: "Time & Attendance Tracking",
      description: "Punch in and out daily with automatic overnight shift handling, break tracking, and monthly timesheet reviews.",
      path: "/attendance",
      category: "Daily Operations",
    },
    {
      id: "emp-leave",
      title: "Leave & Time Off",
      description: "Track your Casual, Sick, and Earned leave balances, and submit paid time-off applications in seconds.",
      path: "/leave",
      category: "Personal Hub",
    },
    {
      id: "emp-requests",
      title: "Requests & Corrections",
      description: "Submit regularization requests for missed punches and view authoritative reviewer notes directly on your cards.",
      path: "/requests",
      category: "Approvals",
    },
    {
      id: "emp-tasks",
      title: "Project & Task Kanban",
      description: "Organize, prioritize, and track your daily deliverables with milestone due dates and cycle time tracking.",
      path: "/tasks",
      category: "Productivity",
    },
    {
      id: "emp-kpi",
      title: "Personal Performance Index (KPI)",
      description: "Monitor your live performance score, calculated objectively from attendance punctuality and task completion.",
      path: "/kpi",
      category: "Performance",
    },
    {
      id: "emp-profile",
      title: "Profile & Workplace Credentials",
      description: "Manage your contact info, assigned department and role, working hours, and account security.",
      path: "/profile",
      category: "Identity",
    },
  ],

  manager: [
    {
      id: "mgr-attendance",
      title: "Team Attendance & Timesheets",
      description: "Monitor check-ins across your department and track punctuality against shift schedules.",
      path: "/attendance",
      category: "Daily Operations",
    },
    {
      id: "mgr-team",
      title: "Live Team Presence Hub",
      description: "See in real time who is currently working, on break, or offline across your department and location.",
      path: "/team",
      category: "Workforce",
    },
    {
      id: "mgr-approvals",
      title: "Approvals with Mandatory Notes",
      description: "Review regularization and team leave applications. Provide required feedback notes (min 5 chars) on all decisions.",
      path: "/requests",
      category: "Approvals",
    },
    {
      id: "mgr-kpi",
      title: "Scoped Department KPI",
      description: "View objective performance indices scoped strictly to your direct reports and department colleagues.",
      path: "/kpi",
      category: "Performance",
    },
    {
      id: "mgr-tasks",
      title: "Task Delegation & Milestones",
      description: "Assign deliverables, monitor team throughput, and prevent overdue bottlenecks across active projects.",
      path: "/tasks",
      category: "Productivity",
    },
    {
      id: "mgr-profile",
      title: "Manager Profile & Settings",
      description: "Review department policies and replay this tutorial whenever you need a refresher.",
      path: "/profile",
      category: "Identity",
    },
  ],

  hr: [
    {
      id: "hr-leave",
      title: "HR Leave Governance Queue",
      description: "Centralized leave approval dashboard with real-time employee balances, KPI badges, and company day-off overrides.",
      path: "/hr/leave",
      category: "HR Operations",
    },
    {
      id: "hr-onboarding",
      title: "Candidate Onboarding Portal",
      description: "Review new hire documentation, download verified files via secure signed URLs, and jump directly to your Drive folder.",
      path: "/hr/onboarding",
      category: "HR Operations",
    },
    {
      id: "hr-users",
      title: "Employee Directory & Invitations",
      description: "Invite candidates via single-use token links and govern department titles, shifts, and active accounts.",
      path: "/admin/users",
      category: "Workforce",
    },
    {
      id: "hr-shifts",
      title: "Work Shifts & Night Schedules",
      description: "Configure working hours, overnight night shifts crossing midnight, and grace period thresholds.",
      path: "/admin/shifts",
      category: "Scheduling",
    },
    {
      id: "hr-reports",
      title: "Workforce Analytics & Exports",
      description: "Generate compliant payroll exports, attendance timesheet spreadsheets, and leave summaries.",
      path: "/reports",
      category: "Analytics",
    },
    {
      id: "hr-kpi",
      title: "Organization-Wide KPI Governance",
      description: "Audit automated performance indices across all departments with search filtering.",
      path: "/kpi",
      category: "Performance",
    },
  ],

  admin: [
    {
      id: "adm-users",
      title: "Workforce Administration & Lifecycle",
      description: "Invite team members, assign departments and job titles, enforce MFA, and execute permanent deletions.",
      path: "/admin/users",
      category: "Governance",
    },
    {
      id: "adm-departments",
      title: "Department Architecture",
      description: "Create and organize hierarchical departments, assign department heads, and track headcounts.",
      path: "/admin/departments",
      category: "Structure",
    },
    {
      id: "adm-shifts",
      title: "Shifts & Schedule Policies",
      description: "Manage organization shifts, day and overnight night shifts, and punctuality grace windows.",
      path: "/admin/shifts",
      category: "Scheduling",
    },
    {
      id: "adm-locations",
      title: "Locations & Geofencing",
      description: "Define office branch locations, geofence radius coordinates, and timezone boundaries.",
      path: "/admin/locations",
      category: "Locations",
    },
    {
      id: "adm-settings",
      title: "Organization Settings & Policies",
      description: "Configure organizational profile, working days, and corporate identity settings.",
      path: "/admin/settings",
      category: "Settings",
    },
    {
      id: "adm-audits",
      title: "Immutable Security Audit Logs",
      description: "Track all administrative actions, policy adjustments, and review decision notes in a permanent trail.",
      path: "/admin/audits",
      category: "Security",
    },
    {
      id: "adm-mfa",
      title: "MFA Enforcement Policy",
      description: "Enforce mandatory TOTP Two-Factor Authentication (AAL2) for all privileged HR and Administrative sessions.",
      path: "/admin/settings",
      category: "Security",
    },
  ],
};

function isStepFeatureEnabled(step: TutorialStep): boolean {
  if (step.path === "/kpi" && !FEATURES.KPI) return false;
  if (step.path === "/admin/locations" && !FEATURES.LOCATIONS) return false;
  if (step.path === "/admin/shifts" && !FEATURES.SHIFTS) return false;
  if (step.path === "/admin/audits" && !FEATURES.AUDITS) return false;
  return true;
}

export const ROLE_TUTORIAL_STEPS: Record<string, TutorialStep[]> = Object.fromEntries(
  Object.entries(RAW_ROLE_TUTORIAL_STEPS).map(([role, steps]) => [
    role,
    steps.filter(isStepFeatureEnabled),
  ])
);
