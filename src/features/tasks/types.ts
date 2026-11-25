export interface TaskType {
  id: string;
  organization_id: string;
  department_id: string | null;
  name: string;
  default_priority: "low" | "medium" | "high" | "urgent";
  default_estimate_minutes: number | null;
  due_rule_working_days: number | null;
  description_template: string | null;
  checklist: string[];
  is_active: boolean;
  sort_order: number;
  created_by?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface TaskRecurrence {
  id: string;
  organization_id: string;
  task_type_id: string | null;
  title: string;
  description: string | null;
  priority: "low" | "medium" | "high" | "urgent";
  estimate_minutes: number | null;
  assignee_id: string | null;
  created_by: string;
  frequency: "daily" | "weekly" | "monthly" | "every_n_working_days";
  interval_n: number;
  weekday: number | null;
  day_of_month: number | null;
  next_run_date: string;
  last_created_task_id: string | null;
  is_active: boolean;
  end_date: string | null;
  created_at?: string;
  updated_at?: string;
}

export const STARTER_TASK_TYPES: Omit<TaskType, "id" | "organization_id">[] = [
  // Technology
  {
    department_id: null, // matched dynamically by department name 'Tech'/'Technology'
    name: "Bug fix",
    default_priority: "high",
    default_estimate_minutes: 120, // 2h
    due_rule_working_days: 2,
    description_template: "What's broken:\n\nSteps to reproduce:\n1. \n2. \n\nExpected result:\n\nWhere (page or link):",
    checklist: ["Reproduce issue", "Write fix", "Test edge cases", "Review changes"],
    is_active: true,
    sort_order: 10,
  },
  {
    department_id: null,
    name: "New feature",
    default_priority: "medium",
    default_estimate_minutes: 480, // 8h
    due_rule_working_days: 5,
    description_template: "Feature goal:\n\nUser story:\n\nAcceptance criteria:\n- \n\nTechnical design notes:",
    checklist: ["Design spec", "Frontend implementation", "Backend implementation", "QA verification"],
    is_active: true,
    sort_order: 20,
  },
  {
    department_id: null,
    name: "Code review",
    default_priority: "high",
    default_estimate_minutes: 60, // 1h
    due_rule_working_days: 1,
    description_template: "PR / Branch link:\n\nSummary of changes:\n\nAreas to focus on:",
    checklist: ["Review diff", "Check tests", "Approve or comment"],
    is_active: true,
    sort_order: 30,
  },
  {
    department_id: null,
    name: "Deployment",
    default_priority: "urgent",
    default_estimate_minutes: 120, // 2h
    due_rule_working_days: 1,
    description_template: "Target environment:\n\nRelease tag / commit:\n\nMigration steps:\n\nVerification checklist:",
    checklist: ["Pre-deploy checks", "Run migration", "Verify health", "Rollback plan"],
    is_active: true,
    sort_order: 40,
  },
  {
    department_id: null,
    name: "Research",
    default_priority: "low",
    default_estimate_minutes: 240, // 4h
    due_rule_working_days: 5,
    description_template: "Research objective:\n\nOptions to evaluate:\n\nDeliverable format:",
    checklist: ["Problem statement", "Evaluate options", "Summary doc"],
    is_active: true,
    sort_order: 50,
  },
  {
    department_id: null,
    name: "Documentation",
    default_priority: "low",
    default_estimate_minutes: 120, // 2h
    due_rule_working_days: 3,
    description_template: "Feature or workflow documented:\n\nTarget audience:\n\nKey sections:",
    checklist: ["Draft content", "Review screenshots", "Publish"],
    is_active: true,
    sort_order: 60,
  },

  // Human Resources
  {
    department_id: null, // matched dynamically by department name 'Human Resources'/'HR'
    name: "Candidate screening",
    default_priority: "medium",
    default_estimate_minutes: 60, // 1h
    due_rule_working_days: 2,
    description_template: "Candidate name:\n\nRole applied for:\n\nResume / portfolio link:\n\nKey qualifications:",
    checklist: ["Review resume", "Conduct screening call", "Submit feedback"],
    is_active: true,
    sort_order: 110,
  },
  {
    department_id: null,
    name: "Interview round",
    default_priority: "high",
    default_estimate_minutes: 60, // 1h
    due_rule_working_days: 2,
    description_template: "Candidate name:\n\nInterview round & focus:\n\nPanel members:\n\nMeeting link:",
    checklist: ["Prepare questions", "Conduct interview", "Fill scorecard"],
    is_active: true,
    sort_order: 120,
  },
  {
    department_id: null,
    name: "Onboarding review",
    default_priority: "high",
    default_estimate_minutes: 60, // 1h
    due_rule_working_days: 2,
    description_template: "Employee name:\n\nDepartment:\n\nStart date:\n\nChecklist status:",
    checklist: ["Check document submission", "Verify identity info", "Provision access", "Send welcome kit"],
    is_active: true,
    sort_order: 130,
  },
  {
    department_id: null,
    name: "Policy update",
    default_priority: "medium",
    default_estimate_minutes: 240, // 4h
    due_rule_working_days: 5,
    description_template: "Policy name:\n\nReason for update:\n\nAffected departments:\n\nEffective date:",
    checklist: ["Draft policy change", "Legal/compliance review", "Publish to portal"],
    is_active: true,
    sort_order: 140,
  },
  {
    department_id: null,
    name: "Exit formalities",
    default_priority: "high",
    default_estimate_minutes: 120, // 2h
    due_rule_working_days: 2,
    description_template: "Employee name:\n\nLast working day:\n\nAsset handover status:\n\nExit interview notes:",
    checklist: ["Handover review", "Revoke credentials", "Final settlement check", "Exit interview"],
    is_active: true,
    sort_order: 150,
  },

  // General
  {
    department_id: null,
    name: "Meeting follow-up",
    default_priority: "medium",
    default_estimate_minutes: 30, // 30m
    due_rule_working_days: 1,
    description_template: "Meeting title & date:\n\nAttendees:\n\nKey decisions:\n\nAction items:",
    checklist: ["Review notes", "Send summary", "Track action items"],
    is_active: true,
    sort_order: 210,
  },
  {
    department_id: null,
    name: "Report",
    default_priority: "medium",
    default_estimate_minutes: 120, // 2h
    due_rule_working_days: 3,
    description_template: "Report title / period:\n\nKey metrics to cover:\n\nDistribution list:",
    checklist: ["Collect data", "Draft report", "Review and share"],
    is_active: true,
    sort_order: 220,
  },
  {
    department_id: null,
    name: "Admin work",
    default_priority: "low",
    default_estimate_minutes: 60, // 1h
    due_rule_working_days: 2,
    description_template: "Objective:\n\nDetails:\n\nDeadline / urgency:",
    checklist: ["Gather requirements", "Complete task", "Confirm completion"],
    is_active: true,
    sort_order: 230,
  },
  {
    department_id: null,
    name: "Other",
    default_priority: "medium",
    default_estimate_minutes: null,
    due_rule_working_days: null,
    description_template: null,
    checklist: [],
    is_active: true,
    sort_order: 240,
  },
];
