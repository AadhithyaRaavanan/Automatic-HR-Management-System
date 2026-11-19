import { FEATURES } from "@/lib/features";

export const TUTORIAL_VERSION = 2;

export interface TutorialStep {
  id: string;
  title: string;
  route: string;
  selector?: string;
  body: string;
  tip: string;
  minVersion?: number;
}

const RAW_ROLE_TUTORIAL_STEPS: Record<string, TutorialStep[]> = {
  employee: [
    {
      id: "emp-welcome",
      title: "Welcome to Pulse",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Pulse helps you track shifts, log breaks, manage tasks, and submit leave requests. Here is a brief guide to the primary tools.",
      tip: "Navigate with Next and Back or arrow keys. Press Esc to exit.",
    },
    {
      id: "emp-dashboard",
      title: "Dashboard overview",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Your dashboard summarizes your scheduled shift, active punch timer, and daily working targets.",
      tip: "The dashboard updates automatically as you work.",
    },
    {
      id: "emp-sidebar",
      title: "Sidebar navigation",
      route: "/",
      selector: '[data-tour="nav-sidebar"]',
      body: "Use the sidebar to open Attendance, Tasks, Leave, Requests, and Holidays. Press ⌘B or Ctrl+B to collapse it.",
      tip: "Use ⌘B on macOS or Ctrl+B on Windows to toggle the sidebar.",
    },
    {
      id: "emp-notifications",
      title: "Notifications",
      route: "/",
      selector: '[data-tour="notification-bell"]',
      body: "Click the bell to see alerts for shifts, tasks, and requests. Click an item to open it or mark all as read.",
      tip: "You can customize notification channels in Settings.",
    },
    {
      id: "emp-attendance-punch",
      title: "Shift check-in",
      route: "/",
      selector: '[data-tour="punch-card"]',
      body: "Punch in at the start of your workday to start your timer and track active hours against your target.",
      tip: "Check-in opens 5 minutes before your scheduled shift.",
    },
    {
      id: "emp-attendance-breaks",
      title: "Workplace breaks",
      route: "/",
      selector: '[data-tour="attendance-breaks"]',
      body: "Log short breaks (15 minutes) and lunch breaks (1 hour) when stepping away. Click Resume when you return.",
      tip: "Break periods are recorded in your daily attendance log.",
    },
    {
      id: "emp-attendance-checkout",
      title: "Check-out",
      route: "/",
      selector: '[data-tour="punch-checkout"]',
      body: "Click Check Out when finishing your workday. Early check-outs will ask for an optional reason.",
      tip: "Early check-outs are recorded for review.",
    },
    {
      id: "emp-attendance-timesheet",
      title: "Timesheets",
      route: "/attendance",
      selector: '[data-tour="attendance-timesheet"]',
      body: "Review your monthly attendance history, logged hours, breaks, and punctuality status.",
      tip: "If you missed a punch, submit a correction under Requests.",
    },
    {
      id: "emp-tasks",
      title: "Tasks",
      route: "/tasks",
      selector: '[data-tour="tasks-board"]',
      body: "Track assignments on the Kanban board. Accept tasks assigned by your manager or create your own.",
      tip: "Click Accept to move an assigned task into your active queue.",
    },
    {
      id: "emp-leave",
      title: "Leave requests",
      route: "/leave",
      selector: '[data-tour="leave-apply"]',
      body: "View your leave balances and submit time-off requests with start and end dates.",
      tip: "Approved leaves update your remaining balance automatically.",
    },
    {
      id: "emp-requests",
      title: "Correction requests",
      route: "/requests",
      selector: '[data-tour="requests-form"]',
      body: "Submit a correction request for missed check-ins or timesheet adjustments with a short note.",
      tip: "Corrections update your attendance record once approved.",
    },
    {
      id: "emp-holidays",
      title: "Holiday calendar",
      route: "/holidays",
      selector: '[data-tour="holidays-calendar"]',
      body: "View statutory and company holidays for the year. Holidays are excluded from leave calculations.",
      tip: "Leaves spanning a company holiday do not deduct holiday dates.",
    },
    {
      id: "emp-kpi-metrics",
      title: "Performance metrics",
      route: "/kpi",
      selector: '[data-tour="kpi-overview"]',
      body: "Track attendance, hours, and task completion metrics against set targets.",
      tip: "Approved leaves and holidays do not count against your targets.",
      minVersion: 2,
    },
    {
      id: "emp-kpi-reviews",
      title: "Performance reviews",
      route: "/kpi",
      selector: '[data-tour="kpi-reviews-tab"]',
      body: "View periodic reviews and feedback from your manager.",
      tip: "Reviews include category scores and feedback notes.",
      minVersion: 2,
    },
    {
      id: "emp-kpi-goals",
      title: "Goals",
      route: "/kpi",
      selector: '[data-tour="kpi-goals-tab"]',
      body: "Track assigned goals and update their progress status.",
      tip: "Update goal status before one-on-one reviews.",
      minVersion: 2,
    },
    {
      id: "emp-profile",
      title: "Profile",
      route: "/profile",
      selector: '[data-tour="profile-card"]',
      body: "Review personal details, emergency contacts, and verified credentials.",
      tip: "Keep your emergency contact details current.",
    },
    {
      id: "emp-settings",
      title: "Settings and security",
      route: "/settings",
      selector: '[data-tour="settings-security"]',
      body: "Update your password, manage notifications, and review privacy details.",
      tip: "Pulse does not log keystrokes, screen captures, or GPS location.",
    },
    {
      id: "emp-finish",
      title: "Tutorial complete",
      route: "/",
      body: "You are ready to begin using Pulse.",
      tip: "You can replay this tutorial anytime from your Profile.",
    },
  ],

  manager: [
    {
      id: "mgr-welcome",
      title: "Welcome to Pulse",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Pulse provides tools to track your attendance, manage team tasks, and review requests.",
      tip: "Navigate with Next and Back or arrow keys.",
    },
    {
      id: "mgr-dashboard",
      title: "Manager dashboard",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Your dashboard displays your punch timer, team presence, and daily targets.",
      tip: "Data updates in real time throughout your shift.",
    },
    {
      id: "mgr-sidebar",
      title: "Navigation",
      route: "/",
      selector: '[data-tour="nav-sidebar"]',
      body: "Access Attendance, Tasks, Leave, Requests, Holidays, and Employees from the sidebar.",
      tip: "Press ⌘B or Ctrl+B to collapse or expand the sidebar.",
    },
    {
      id: "mgr-notifications",
      title: "Notifications",
      route: "/",
      selector: '[data-tour="notification-bell"]',
      body: "The notification bell alerts you when direct reports submit requests or complete tasks.",
      tip: "Configure notifications in Settings.",
    },
    {
      id: "mgr-attendance-punch",
      title: "Shift check-in",
      route: "/",
      selector: '[data-tour="punch-card"]',
      body: "Punch in to start your timer and log hours against your daily target.",
      tip: "Check-in opens 5 minutes before your shift start time.",
    },
    {
      id: "mgr-attendance-breaks",
      title: "Break tracking",
      route: "/",
      selector: '[data-tour="attendance-breaks"]',
      body: "Use the short break (15m) and lunch break (1 hr) controls when stepping away.",
      tip: "Click Resume when returning from a break.",
    },
    {
      id: "mgr-attendance-checkout",
      title: "Check-out",
      route: "/",
      selector: '[data-tour="punch-checkout"]',
      body: "Click Check Out when finishing your shift. Early departures prompt for an optional reason.",
      tip: "Early check-outs are recorded for review.",
    },
    {
      id: "mgr-team-presence",
      title: "Team presence",
      route: "/attendance",
      selector: '[data-tour="attendance-timesheet"]',
      body: "See which team members are currently working, on break, or offline.",
      tip: "Filter by department or shift schedule to review presence.",
    },
    {
      id: "mgr-tasks",
      title: "Task delegation",
      route: "/tasks",
      selector: '[data-tour="tasks-board"]',
      body: "Create and assign deliverables to direct reports or yourself.",
      tip: "Filter by assignee to see individual workloads.",
    },
    {
      id: "mgr-leave",
      title: "Leave management",
      route: "/leave",
      selector: '[data-tour="leave-apply"]',
      body: "Apply for your own time off while reviewing team schedules to prevent understaffing.",
      tip: "Your leave requests are sent to HR for approval.",
    },
    {
      id: "mgr-approvals",
      title: "Approving requests",
      route: "/requests",
      selector: '[data-tour="approvals-queue"]',
      body: "Review pending leave and correction requests from direct reports. A brief note is required for each decision.",
      tip: "Your own requests must be reviewed by HR.",
    },
    {
      id: "mgr-ems",
      title: "Department directory",
      route: "/ems",
      selector: '[data-tour="ems-department"]',
      body: "View employees, job titles, and contact information for your department.",
      tip: "The view is scoped to your department.",
    },
    {
      id: "mgr-holidays",
      title: "Holiday calendar",
      route: "/holidays",
      selector: '[data-tour="holidays-calendar"]',
      body: "View statutory and company holidays to plan team schedules.",
      tip: "Company holidays are excluded from leave calculations.",
    },
    {
      id: "mgr-kpi-overview",
      title: "Performance analytics",
      route: "/kpi",
      selector: '[data-tour="kpi-filters"]',
      body: "Track attendance, hours, and task metrics for direct reports.",
      tip: "Metrics are scoped to your team.",
      minVersion: 2,
    },
    {
      id: "mgr-kpi-reviews",
      title: "Manager reviews",
      route: "/kpi",
      selector: '[data-tour="kpi-add-review"]',
      body: "Submit periodic evaluations for direct reports with ratings and feedback notes.",
      tip: "Reviews are visible to the employee on their profile.",
      minVersion: 2,
    },
    {
      id: "mgr-kpi-adjustments",
      title: "Metric adjustments",
      route: "/kpi",
      selector: '[data-tour="kpi-metrics-grid"]',
      body: "Adjust automated metrics with a documented reason when exceptions occur.",
      tip: "Adjustment notes are recorded for review.",
      minVersion: 2,
    },
    {
      id: "mgr-kpi-queues",
      title: "Review indicators",
      route: "/requests",
      selector: '[data-tour="approvals-queue"]',
      body: "Review queues display performance indicators to help evaluate requests.",
      tip: "Indicators update based on current metrics.",
      minVersion: 2,
    },
    {
      id: "mgr-profile",
      title: "Profile",
      route: "/profile",
      selector: '[data-tour="profile-card"]',
      body: "Review personal details and emergency contacts.",
      tip: "Keep emergency contact details current.",
    },
    {
      id: "mgr-settings",
      title: "Settings and security",
      route: "/settings",
      selector: '[data-tour="settings-security"]',
      body: "Manage your password, notifications, and security preferences.",
      tip: "Sign out when concluding your session on shared devices.",
    },
    {
      id: "mgr-finish",
      title: "Setup complete",
      route: "/",
      body: "You are ready to manage your team in Pulse.",
      tip: "Revisit this tutorial anytime from your Profile.",
    },
  ],

  hr: [
    {
      id: "hr-welcome",
      title: "Welcome to Pulse",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "As an HR administrator, you manage onboarding, leave queues, corrections, and employee records.",
      tip: "Navigate with Next and Back or arrow keys.",
    },
    {
      id: "hr-dashboard",
      title: "HR dashboard",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Summarizes pending approvals, workforce presence, and your daily punch timer.",
      tip: "Approval counts update in real time.",
    },
    {
      id: "hr-sidebar",
      title: "Navigation",
      route: "/",
      selector: '[data-tour="nav-sidebar"]',
      body: "The sidebar links directly to Employees, Onboarding, Leave, Requests, and Reports.",
      tip: "Press ⌘B or Ctrl+B to toggle the sidebar.",
    },
    {
      id: "hr-notifications",
      title: "Notifications",
      route: "/",
      selector: '[data-tour="notification-bell"]',
      body: "Alerts notify you of onboarding submissions, pending requests, and system notices.",
      tip: "Click an alert to review the candidate or request directly.",
    },
    {
      id: "hr-attendance-punch",
      title: "Shift check-in",
      route: "/",
      selector: '[data-tour="punch-card"]',
      body: "Punch in to start your shift timer and log daily hours.",
      tip: "Check-in opens 5 minutes before your shift.",
    },
    {
      id: "hr-attendance-breaks",
      title: "Break tracking",
      route: "/",
      selector: '[data-tour="attendance-breaks"]',
      body: "Log short breaks and lunch breaks during your shift.",
      tip: "Break periods are recorded in your daily attendance log.",
    },
    {
      id: "hr-attendance-checkout",
      title: "Check-out",
      route: "/",
      selector: '[data-tour="punch-checkout"]',
      body: "Click Check Out when ending your workday.",
      tip: "Early checkouts prompt for an optional note.",
    },
    {
      id: "hr-ems-hub",
      title: "Employee directory",
      route: "/ems",
      selector: '[data-tour="ems-hub"]',
      body: "Manage headcount, departments, job titles, and employee records for the organization.",
      tip: "Use the search bar to find employees quickly.",
    },
    {
      id: "hr-onboarding-hub",
      title: "Onboarding reviews",
      route: "/hr/onboarding",
      selector: '[data-tour="onboarding-hub"]',
      body: "Review uploaded identity documents, request corrections, and approve candidate accounts.",
      tip: "Candidates cannot sign in until their onboarding is approved.",
    },
    {
      id: "hr-leave-queue",
      title: "Leave requests",
      route: "/hr/leave",
      selector: '[data-tour="hr-leave-queue"]',
      body: "Review and approve company-wide leave applications with decision notes.",
      tip: "Approved leaves update employee balances automatically.",
    },
    {
      id: "hr-requests-queue",
      title: "Correction requests",
      route: "/requests",
      selector: '[data-tour="hr-requests-queue"]',
      body: "Review timesheet correction requests and punch adjustments across all departments.",
      tip: "Decision notes are saved with the attendance record.",
    },
    {
      id: "hr-tasks",
      title: "Tasks",
      route: "/tasks",
      selector: '[data-tour="tasks-board"]',
      body: "Manage HR initiatives, onboarding tasks, and compliance deadlines.",
      tip: "Set priorities and due dates on deliverables.",
    },
    {
      id: "hr-holidays",
      title: "Holiday calendar",
      route: "/holidays",
      selector: '[data-tour="holidays-management"]',
      body: "Add and manage company and statutory holidays for the organization.",
      tip: "Holidays update leave balance calculations automatically.",
    },
    {
      id: "hr-kpi-analytics",
      title: "Performance analytics",
      route: "/kpi",
      selector: '[data-tour="kpi-filters"]',
      body: "Review organization-wide attendance, hours, and task completion metrics.",
      tip: "Export performance data as needed.",
      minVersion: 2,
    },
    {
      id: "hr-kpi-reviews-adjustments",
      title: "Reviews and adjustments",
      route: "/kpi",
      selector: '[data-tour="kpi-overview"]',
      body: "Audit manager reviews and authorize metric adjustments when needed.",
      tip: "All review notes and adjustments are logged.",
      minVersion: 2,
    },
    {
      id: "hr-kpi-queues",
      title: "Review indicators",
      route: "/hr/leave",
      selector: '[data-tour="hr-leave-queue"]',
      body: "Indicators in the review queue show applicant attendance and task records.",
      tip: "Use performance data to inform approval decisions.",
      minVersion: 2,
    },
    {
      id: "hr-reports",
      title: "Reports and exports",
      route: "/reports",
      selector: '[data-tour="reports-hub"]',
      body: "Generate timesheet summaries, attendance logs, and payroll exports.",
      tip: "Exports format timestamps in your standard timezone.",
    },
    {
      id: "hr-sensitive-data",
      title: "Confidentiality",
      route: "/hr/onboarding",
      body: "HR accounts have access to sensitive records including tax IDs and bank details.",
      tip: "Keep sensitive employee records secure.",
    },
    {
      id: "hr-profile",
      title: "Profile",
      route: "/profile",
      selector: '[data-tour="profile-card"]',
      body: "Manage your contact details and credentials.",
      tip: "Keep contact details current.",
    },
    {
      id: "hr-settings",
      title: "Settings and security",
      route: "/settings",
      selector: '[data-tour="settings-security"]',
      body: "Manage two-factor authentication, passwords, and notification channels.",
      tip: "Two-factor authentication is required for HR administrators.",
    },
    {
      id: "hr-finish",
      title: "Setup complete",
      route: "/",
      body: "You are ready to manage HR operations in Pulse.",
      tip: "Revisit this tutorial anytime from your Profile.",
    },
  ],

  // Admin gets NO tour: no auto-start, no steps, no replay button
  admin: [],
};

function isStepFeatureEnabled(step: TutorialStep): boolean {
  if (step.route === "/kpi" && !FEATURES.KPI) return false;
  if (step.id.includes("kpi") && !FEATURES.KPI) return false;
  if (step.route === "/tasks" && !FEATURES.TASKS) return false;
  if (step.id.includes("tasks") && !FEATURES.TASKS) return false;
  if (step.route === "/admin/locations" && !FEATURES.LOCATIONS) return false;
  if (step.route === "/admin/shifts" && !FEATURES.SHIFTS) return false;
  if (step.route === "/admin/audits" && !FEATURES.AUDITS) return false;
  return true;
}

export const ROLE_TUTORIAL_STEPS: Record<string, TutorialStep[]> = Object.fromEntries(
  Object.entries(RAW_ROLE_TUTORIAL_STEPS).map(([role, steps]) => [
    role,
    steps.filter(isStepFeatureEnabled),
  ])
);

export function getTutorialStepsForUser(
  role: string,
  userTutorialVersion = 0,
  isCompleted = false
): TutorialStep[] {
  const allRoleSteps = ROLE_TUTORIAL_STEPS[role] || [];
  if (isCompleted) {
    // Existing user mini-tour: only show steps added in newer versions when feature is on
    if (FEATURES.KPI && userTutorialVersion < TUTORIAL_VERSION) {
      return allRoleSteps.filter((s) => (s.minVersion || 1) > userTutorialVersion);
    }
    return [];
  }
  return allRoleSteps;
}
