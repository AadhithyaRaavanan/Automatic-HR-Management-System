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
      title: "Welcome to Pulse HRMS",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Welcome to your digital workplace! Pulse streamlines your everyday remote work, from shift check-ins and break tracking to task delivery and leave requests. Let's take a quick walkthrough of your essential workplace tools.",
      tip: "You can navigate using the Next and Back buttons or your keyboard arrow keys. Press Esc anytime to skip.",
    },
    {
      id: "emp-dashboard",
      title: "Daily Dashboard Overview",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Your daily dashboard is your central control hub, summarizing your scheduled shift, active punch timer, and daily working targets. Check the status badges at the top for real-time progress indicators.",
      tip: "Your dashboard updates automatically throughout your shift without needing manual page reloads.",
    },
    {
      id: "emp-sidebar",
      title: "Workspace Navigation",
      route: "/",
      selector: '[data-tour="nav-sidebar"]',
      body: "Use the primary sidebar to jump between Attendance, Tasks, Leave, Requests, and Holidays. On desktop, press ⌘B or Ctrl+B to collapse the sidebar whenever you want more screen room.",
      tip: "Press ⌘B or Ctrl+B on your keyboard anytime to toggle the sidebar navigation.",
    },
    {
      id: "emp-attendance-punch",
      title: "Check-In & Live Work Timer",
      route: "/",
      selector: '[data-tour="punch-card"]',
      body: "Punch in at the start of your workday to start your official work session. The live countdown timer tracks your active hours against your daily 8-hour target, showing both elapsed time and remaining balance.",
      tip: "Daily check-in unlocks 5 minutes prior to your assigned shift start time.",
    },
    {
      id: "emp-attendance-breaks",
      title: "Workplace Breaks Policy",
      route: "/",
      selector: '[data-tour="attendance-breaks"]',
      body: "Pulse provides built-in allowances for your daily rest: one 15-minute Short Break and one 1-hour Lunch Break. Click 'Take Break' when stepping away, and click 'Resume Work' as soon as you return so your timer pauses and resumes accurately.",
      tip: "Taking recorded breaks ensures your timesheet is compliant and lets teammates know when you are away from keyboard.",
    },
    {
      id: "emp-attendance-checkout",
      title: "Check-Out & Early Departure Dialog",
      route: "/",
      selector: '[data-tour="punch-checkout"]',
      body: "When wrapping up your workday, click 'Check Out Now'. If you attempt to check out before your scheduled shift end, an Early Check-Out confirmation dialog will calculate your early minutes and prompt for an optional reason. Click Cancel to keep working, or Confirm to punch out.",
      tip: "Departures before shift end are recorded with early checkout flags for transparent payroll verification.",
    },
    {
      id: "emp-attendance-timesheet",
      title: "Monthly Timesheets & Punctuality",
      route: "/attendance",
      selector: '[data-tour="attendance-timesheet"]',
      body: "Scroll down on the Attendance page to inspect your full monthly timesheet history. Each day summarizes your total work minutes, break time, overtime, and punctuality flags such as On-Time, Late, or Half-Day.",
      tip: "If a technical glitch or power cut caused a missed punch, submit a regularization request under Requests.",
    },
    {
      id: "emp-tasks",
      title: "Tasks, Kanban & Time Estimates",
      route: "/tasks",
      selector: '[data-tour="tasks-board"]',
      body: "Track deliverables on the interactive Kanban board or list view. When you assign a task to yourself, Pulse marks it Self-Assigned and automatically places it in Progress. Tasks assigned by managers start in To Do with an instant '✓ Accept Task' button. Set realistic estimates using the Hours & Minutes duration picker with quick presets (30m, 1h, 2h, 4h, 8h).",
      tip: "Subordinates only need one click on '✓ Accept Task' to accept delegated work and begin execution.",
    },
    {
      id: "emp-leave",
      title: "Leave Balances & Time-Off",
      route: "/leave",
      selector: '[data-tour="leave-apply"]',
      body: "Monitor your live balance allocations for Casual, Sick, and Earned leave. To apply, select your leave category, choose start and end dates, and provide a clear justification for your supervisor to review.",
      tip: "Approved leaves deduct from your balance in real time, while rejected requests leave your balance intact and show the reviewer's explanation note.",
    },
    {
      id: "emp-requests",
      title: "Regularization & Punch Corrections",
      route: "/requests",
      selector: '[data-tour="requests-form"]',
      body: "Forgot to punch in or experienced an internet outage? Submit a regularization request with your adjusted check-in and check-out times along with a detailed explanation. Once approved by your reviewer, your official timesheet updates immediately.",
      tip: "Future dates and duplicate requests for the same date are blocked by server validation rules.",
    },
    {
      id: "emp-holidays",
      title: "Organization Holiday Calendar",
      route: "/holidays",
      selector: '[data-tour="holidays-calendar"]',
      body: "View all approved national and corporate holidays for the calendar year. Pulse automatically reconciles official holidays when calculating your leave days, ensuring you are never charged leave on an official holiday.",
      tip: "Official holidays are managed by HR and reflect across your organization's schedule.",
    },
    {
      id: "emp-kpi-metrics",
      title: "KPI & Performance Metrics",
      route: "/kpi",
      selector: '[data-tour="kpi-overview"]',
      body: "Track your live performance across Attendance, Hours, and Task execution. Each metric is computed on its own with clear targets. If a metric displays 'No data', it simply means no activity has been recorded yet for that cycle—you are never penalized with a false 0%. Approved leaves and holidays count as target met and are not counted against your hours.",
      tip: "KPIs are designed as an objective conversation starter with your manager, not a one-size-fits-all verdict.",
      minVersion: 2,
    },
    {
      id: "emp-kpi-reviews",
      title: "Manager Reviews & Feedback",
      route: "/kpi",
      selector: '[data-tour="kpi-reviews-tab"]',
      body: "Switch to the Manager Reviews tab to inspect feedback from your supervisors. Each review evaluates Quality, Communication, Initiative, and Teamwork on a 1-5 scale, accompanied by a mandatory feedback note detailing achievements and areas for growth.",
      tip: "You can compare your overall performance trend against the previous cycle directly from the top summary card.",
      minVersion: 2,
    },
    {
      id: "emp-kpi-goals",
      title: "Performance Goals & Milestones",
      route: "/kpi",
      selector: '[data-tour="kpi-goals-tab"]',
      body: "Under the Goals tab, track milestones assigned for your review cycle. You can update your goal status between Not Started, On Track, At Risk, and Done at any time, and attach personal progress notes.",
      tip: "Keep your goal statuses updated before one-on-one reviews to showcase your progress.",
      minVersion: 2,
    },
    {
      id: "emp-profile",
      title: "Personal Profile, Emergency Contact & Vault",
      route: "/profile",
      selector: '[data-tour="profile-card"]',
      body: "Review your personal details, emergency contact information, and bank details. You can view all verified onboarding certificates securely using encrypted time-limited links, or replay this interactive tutorial at any time.",
      tip: "Keep your emergency contact details updated at all times so management can reach family in an emergency.",
    },
    {
      id: "emp-settings",
      title: "Security, Privacy & Sign Out",
      route: "/settings",
      selector: '[data-tour="settings-security"]',
      body: "Review zero-invasive privacy manifesto commitments, update your account password, and manage notification preferences. When working on shared devices, use the Sign Out button in the sidebar to cleanly end your session.",
      tip: "Pulse never records keystrokes, screenshots, or location telemetry.",
    },
    {
      id: "emp-finish",
      title: "You're All Set!",
      route: "/",
      body: "Congratulations! You have completed the workplace walkthrough and understand all your core employee tools in Pulse. You are now ready to start your workday, mark attendance, and collaborate with your team.",
      tip: "You can replay this walkthrough at any time by visiting My Profile and clicking 'Replay Workplace Tutorial'.",
    },
  ],

  manager: [
    {
      id: "mgr-welcome",
      title: "Welcome to Pulse for Managers",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Welcome to Pulse! As a manager, you have comprehensive tools to track your own work, monitor team presence, delegate deliverables, and govern employee leave and correction approvals.",
      tip: "Use the Next and Back buttons or arrow keys to navigate through each section of your supervisory workspace.",
    },
    {
      id: "mgr-dashboard",
      title: "Manager Dashboard & Team Overview",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Your dashboard provides your own daily punch card alongside team presence indicators. Monitor active shift statuses, scheduled targets, and deliverables in real time.",
      tip: "The dashboard automatically refreshes to keep your shift timesheet in sync.",
    },
    {
      id: "mgr-sidebar",
      title: "Manager Navigation Hub",
      route: "/",
      selector: '[data-tour="nav-sidebar"]',
      body: "Access Attendance, Tasks, Leave, Requests, Holidays, and your Department EMS view from the unified sidebar. Privileged administrative routes are restricted, keeping your view focused on your team.",
      tip: "Press ⌘B or Ctrl+B to collapse or expand the navigation menu at any time.",
    },
    {
      id: "mgr-attendance-punch",
      title: "Punching In & Shift Timer",
      route: "/",
      selector: '[data-tour="punch-card"]',
      body: "Managers follow the same attendance rules as team members. Punch in at the start of your shift to begin your active work timer, tracking elapsed minutes against your daily 8-hour target.",
      tip: "Check-in unlocks 5 minutes before your shift start time.",
    },
    {
      id: "mgr-attendance-breaks",
      title: "Break Tracking & Availability",
      route: "/",
      selector: '[data-tour="attendance-breaks"]',
      body: "Use the 15-minute Short Break and 1-hour Lunch Break controls when stepping away from your workspace. Taking recorded breaks ensures accurate timesheet records and signals your availability to your team.",
      tip: "Remember to click Resume Work when returning from breaks to continue logging active hours.",
    },
    {
      id: "mgr-attendance-checkout",
      title: "Check-Out & Early Departure Dialog",
      route: "/",
      selector: '[data-tour="punch-checkout"]',
      body: "When completing your shift, click 'Check Out Now'. If departing before scheduled shift end, the Early Check-Out modal will display your early minutes and allow you to submit an optional departure reason.",
      tip: "Cancel keeps your punch active; Confirm saves early checkout flags for audit compliance.",
    },
    {
      id: "mgr-team-presence",
      title: "Team Presence & Attendance Visibility",
      route: "/attendance",
      selector: '[data-tour="attendance-timesheet"]',
      body: "As a manager, you have full attendance visibility into your department. See in real time who is currently working, on lunch, on break, or offline, allowing you to balance workloads and coordinate handoffs effectively.",
      tip: "Filter by department or shift schedule to track team attendance patterns over time.",
    },
    {
      id: "mgr-tasks",
      title: "Team Task Delegation & Kanban Pipeline",
      route: "/tasks",
      selector: '[data-tour="tasks-board"]',
      body: "Delegate deliverables to yourself and direct reports. Use the Hours & Minutes duration selector with presets (30m, 1h, 2h, 4h, 8h) to define realistic timelines. Tasks assigned to reports start in To Do awaiting their acceptance, while self-assigned tasks move directly to In Progress.",
      tip: "Filter by Assignee to inspect workload balance and unblock team bottlenecks.",
    },
    {
      id: "mgr-leave",
      title: "Personal Leave & Team Balances",
      route: "/leave",
      selector: '[data-tour="leave-apply"]',
      body: "Apply for your own Casual, Sick, or Earned leaves while inspecting team schedules to prevent understaffing. Your personal leave applications are routed to HR for review.",
      tip: "Approved leaves deduct from your balance, while rejected requests preserve your balance with reviewer feedback.",
    },
    {
      id: "mgr-approvals",
      title: "Approving Team Leave & Corrections",
      route: "/requests",
      selector: '[data-tour="approvals-queue"]',
      body: "Review pending regularization and leave applications from your direct reports. Every decision REQUIRES a mandatory note (minimum 5 characters) explaining your approval or rejection, which the employee sees directly on their card.",
      tip: "Governance rules strictly prohibit self-approval. Your own requests must be reviewed by HR.",
    },
    {
      id: "mgr-ems",
      title: "Department EMS & Team Directory",
      route: "/ems",
      selector: '[data-tour="ems-department"]',
      body: "Access your scoped Employee Management System view to inspect active headcounts, job titles, and employee directory details strictly within your assigned department.",
      tip: "Your EMS view is automatically scoped to your department to preserve company-wide confidentiality.",
    },
    {
      id: "mgr-holidays",
      title: "Company Holidays & Schedule Planning",
      route: "/holidays",
      selector: '[data-tour="holidays-calendar"]',
      body: "View all organization holidays to anticipate team availability and plan sprint milestones. Official holidays are automatically excluded when deducting employee leave balances.",
      tip: "Leave requests spanning a company holiday deduct only net working days.",
    },
    {
      id: "mgr-kpi-overview",
      title: "Team KPI Analytics & Scoped Filters",
      route: "/kpi",
      selector: '[data-tour="kpi-filters"]',
      body: "As a manager, you have full performance visibility into your department and direct reports. Use the filter bar to switch between team members, select employee types (Full-Time, Part-Time, Intern, Contract), and adjust date ranges between Week, Month, Quarter, or Custom.",
      tip: "Your view is automatically scoped to your team, preserving confidentiality while preventing self-reviews.",
      minVersion: 2,
    },
    {
      id: "mgr-kpi-reviews",
      title: "Conducting Manager Reviews",
      route: "/kpi",
      selector: '[data-tour="kpi-add-review"]',
      body: "Click 'Add Review' under the Manager Reviews tab to submit qualitative performance assessments. Rate Quality, Communication, Initiative, and Teamwork from 1 to 5 stars. Every review strictly REQUIRES a comprehensive note (minimum 5 characters) explaining your assessment.",
      tip: "Reviews are immediately visible to the employee on their dashboard to guide their professional growth.",
      minVersion: 2,
    },
    {
      id: "mgr-kpi-adjustments",
      title: "Metric Adjustments & Objective Logging",
      route: "/kpi",
      selector: '[data-tour="kpi-metrics-grid"]',
      body: "If exceptional circumstances warrant overriding an automated metric—such as verified hardware failure or emergency dispatch—click 'Adjust' on any card. Every adjustment REQUIRES a documented reason of at least 5 characters, which is permanently displayed alongside the adjusted metric.",
      tip: "Transparent adjustment logs prevent audit discrepancies and ensure fair performance evaluations.",
      minVersion: 2,
    },
    {
      id: "mgr-kpi-queues",
      title: "Review Queue KPI Badges & Export",
      route: "/requests",
      selector: '[data-tour="approvals-queue"]',
      body: "When reviewing leave or punch correction requests, a small KPI badge appears beside each applicant's name. Click it to inspect their live performance index before making approval decisions. You can also click 'Export CSV' on the KPI page to download report sheets.",
      tip: "KPI badges only appear when the KPI feature is active, respecting team scoping rules.",
      minVersion: 2,
    },
    {
      id: "mgr-profile",
      title: "Manager Profile & Vault",
      route: "/profile",
      selector: '[data-tour="profile-card"]',
      body: "Manage your contact details, emergency phone number, and verified credentials. You can replay this manager tutorial at any time by clicking the Replay button on this page.",
      tip: "Ensure your emergency contact details remain up to date.",
    },
    {
      id: "mgr-settings",
      title: "Security & Account Settings",
      route: "/settings",
      selector: '[data-tour="settings-security"]',
      body: "Configure account security, update your permanent password, and review the zero-invasive privacy manifesto. Always sign out securely when concluding work on shared computers.",
      tip: "Pulse will never ask for your password or two-factor codes.",
    },
    {
      id: "mgr-finish",
      title: "Manager Setup Complete!",
      route: "/",
      body: "You are fully equipped to govern your team! You know how to track attendance, delegate deliverables, review approvals with mandatory notes, and monitor your department's presence.",
      tip: "Revisit this tutorial anytime from My Profile > Replay Workplace Tutorial.",
    },
  ],

  hr: [
    {
      id: "hr-welcome",
      title: "Welcome to Pulse HR Governance",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Welcome to Pulse HRMS! As an HR administrator, you have full governance across workforce onboarding, leave queues, regularization approvals, employee lifecycle, and compliance analytics.",
      tip: "Navigate using Next/Back buttons or arrow keys. Press Esc anytime to skip.",
    },
    {
      id: "hr-dashboard",
      title: "HR Governance Dashboard",
      route: "/",
      selector: '[data-tour="dashboard-hero"]',
      body: "Your dashboard summarizes key daily operations, pending approval counts, employee presence, and your own attendance punch timer. Stay informed on company-wide activity from one central view.",
      tip: "All metrics and approval badges update in real time.",
    },
    {
      id: "hr-sidebar",
      title: "HR Operations Hub Navigation",
      route: "/",
      selector: '[data-tour="nav-sidebar"]',
      body: "The HR sidebar provides direct access to EMS, Onboarding, Leave Queues, Requests, Reports, and Holiday Management. Everything you need to govern the workforce is organized here.",
      tip: "Press ⌘B or Ctrl+B to collapse or expand the navigation drawer.",
    },
    {
      id: "hr-attendance-punch",
      title: "Personal Attendance Tracking",
      route: "/",
      selector: '[data-tour="punch-card"]',
      body: "HR team members track their working hours using the same standard punch controls: check in at the start of your shift, log your breaks, and track your daily 8-hour target.",
      tip: "Check-in unlocks 5 minutes prior to scheduled shift start time.",
    },
    {
      id: "hr-attendance-breaks",
      title: "Break Compliance & Session Logging",
      route: "/",
      selector: '[data-tour="attendance-breaks"]',
      body: "Log your 15-minute Short Break and 1-hour Lunch Break using the one-click break buttons. Clicking Resume Work returns your session to active work status.",
      tip: "Break logging ensures transparent timesheet audit trails.",
    },
    {
      id: "hr-attendance-checkout",
      title: "Check-Out & Early Departure Dialog",
      route: "/",
      selector: '[data-tour="punch-checkout"]',
      body: "Click Check Out Now when finishing your workday. If departing before your shift ends, the Early Check-Out dialog appears with the calculated early duration and optional departure note.",
      tip: "Early checkouts are saved to the attendance record for payroll compliance reviews.",
    },
    {
      id: "hr-ems-hub",
      title: "EMS Hub: Workforce & Department Headcounts",
      route: "/ems",
      selector: '[data-tour="ems-hub"]',
      body: "Govern organization-wide headcount, department rosters, job titles, and pending hires. Monitor total workforce strength and track real-time headcount distribution across all business units.",
      tip: "Use the EMS search filters to quickly locate employees by department, designation, or status.",
    },
    {
      id: "hr-onboarding-hub",
      title: "Onboarding Hub & Document Verification",
      route: "/hr/onboarding",
      selector: '[data-tour="onboarding-hub"]',
      body: "Review candidate onboarding submissions, inspect uploaded PAN cards, resumes, and bank proofs via secure signed previews, and approve or reject each certificate with structured feedback notes. All documents are segregated into private EMPLOYEEID_NAME folders.",
      tip: "Once all required documents are verified, one click completes onboarding and transitions the candidate to active status.",
    },
    {
      id: "hr-leave-queue",
      title: "Company-Wide Leave Governance Queue",
      route: "/hr/leave",
      selector: '[data-tour="hr-leave-queue"]',
      body: "Review and govern leave requests across the entire company. Inspect real-time leave balances and verify that leaves spanning company holidays correctly exclude official non-working days. Mandatory 5-character decision notes are enforced on every review.",
      tip: "HR approval automatically updates the employee's remaining leave balance in real time.",
    },
    {
      id: "hr-requests-queue",
      title: "Requests & Punch Regularization Queue",
      route: "/requests",
      selector: '[data-tour="hr-requests-queue"]',
      body: "Audit and resolve punch correction applications across all departments. Approve adjustments to automatically recalculate work minutes on official attendance days, or reject incomplete submissions with constructive guidance.",
      tip: "Reviewer notes are permanently recorded on attendance days and visible to applicants.",
    },
    {
      id: "hr-tasks",
      title: "HR Deliverables & Task Management",
      route: "/tasks",
      selector: '[data-tour="tasks-board"]',
      body: "Manage HR operational initiatives, onboarding pipelines, and compliance deadlines. Delegate deliverables across HR, managers, or employees using the Hours & Minutes selector with presets. Delegated tasks start in To Do for acceptance, while self-assigned tasks move directly to In Progress.",
      tip: "Use priority badges to highlight time-critical compliance tasks.",
    },
    {
      id: "hr-holidays",
      title: "Holiday Calendar Management",
      route: "/holidays",
      selector: '[data-tour="holidays-management"]',
      body: "As HR, you have full privileges to add, update, or remove company and national holidays. Adding holidays immediately recalculates holiday allowances across active leave applications.",
      tip: "Set up the yearly holiday calendar early so leave balances compute seamlessly.",
    },
    {
      id: "hr-kpi-analytics",
      title: "Company-Wide KPI & Performance Governance",
      route: "/kpi",
      selector: '[data-tour="kpi-filters"]',
      body: "HR administrators have organization-wide visibility across all business units. Filter by department, designation, employee type, or individual staff member. The team benchmark card provides an objective organization average to evaluate company health.",
      tip: "Export complete performance rosters to CSV with one click for executive compensation reviews.",
      minVersion: 2,
    },
    {
      id: "hr-kpi-reviews-adjustments",
      title: "Governing Reviews & Metric Overrides",
      route: "/kpi",
      selector: '[data-tour="kpi-overview"]',
      body: "Audit manager reviews and authorize metric adjustments when discrepancies arise. HR enforces mandatory 5-character justification notes on all reviews and overrides, maintaining complete transparency.",
      tip: "All review notes and adjustment justifications are cryptographically linked to the author's session.",
      minVersion: 2,
    },
    {
      id: "hr-kpi-queues",
      title: "Leave & Regularization KPI Badges",
      route: "/hr/leave",
      selector: '[data-tour="hr-leave-queue"]',
      body: "In both the Leave and Regularization review queues, a KPI badge beside each employee's name links directly to their detailed performance report. Review applicant punctuality and task completion rates before approving extended leaves.",
      tip: "The KPI badge automatically hides if the KPI module is disabled, ensuring zero UI clutter.",
      minVersion: 2,
    },
    {
      id: "hr-reports",
      title: "Workforce Analytics & Compliant Exports",
      route: "/reports",
      selector: '[data-tour="reports-hub"]',
      body: "Generate compliant payroll exports, monthly timesheet aggregates, attendance punctuality summaries, and leave utilization reports. Download instant CSV sheets formatted for your payroll processing systems.",
      tip: "All exports preserve employee confidentiality and format timestamps in your standard organization timezone.",
    },
    {
      id: "hr-sensitive-data",
      title: "Data Privacy & Confidentiality Protocol",
      route: "/hr/onboarding",
      body: "HR administrators have privileged access to highly sensitive employee credentials including bank account numbers, IFSC codes, Aadhaar, PAN cards, and emergency contacts. Pulse strictly enforces zero third-party disclosure.",
      tip: "Never export, email, or share candidate identity credentials outside Pulse's encrypted infrastructure.",
    },
    {
      id: "hr-profile",
      title: "Profile & Personal Credentials",
      route: "/profile",
      selector: '[data-tour="profile-card"]',
      body: "Manage your contact details, emergency phone number, and verified credentials. You can replay this HR tutorial at any time by clicking the Replay button on this page.",
      tip: "Ensure your emergency contact details remain up to date.",
    },
    {
      id: "hr-settings",
      title: "Security, MFA & Sign Out",
      route: "/settings",
      selector: '[data-tour="settings-security"]',
      body: "Manage your two-factor authentication (AAL2), update your permanent password, and review security policies. When completing HR operations, sign out cleanly to secure sensitive workforce data.",
      tip: "Privileged HR sessions require active Two-Factor Authentication (TOTP).",
    },
    {
      id: "hr-finish",
      title: "HR Governance Setup Complete!",
      route: "/",
      body: "You now have complete mastery over Pulse HRMS! You are ready to review candidate onboarding, govern leave requests, manage timesheets, and export compliance reports.",
      tip: "Revisit this tutorial anytime from My Profile > Replay Workplace Tutorial.",
    },
  ],

  // Admin gets NO tour: no auto-start, no steps, no replay button
  admin: [],
};

function isStepFeatureEnabled(step: TutorialStep): boolean {
  if (step.route === "/kpi" && !FEATURES.KPI) return false;
  if (step.id.includes("kpi") && !FEATURES.KPI) return false;
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
