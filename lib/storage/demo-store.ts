/**
 * Unified Shared Storage for RemoteHR Demo Environment
 *
 * Ensures all modules (Workforce, Departments, Locations, Shifts, Teams, Tasks, Team Hub, KPI, Leave, Requests, Audits, Attendance)
 * share the exact same clean, user-created data.
 *
 * No fake data pre-populates the workspace, except the 4 core demo login accounts
 * (Admin, HR, Manager, Employee) so the user can sign in and test each role.
 */

import { isDemoModeEnabled } from "@/lib/config/demo";

export interface DemoDepartment {
  id: string;
  name: string;
  code: string;
  headName?: string;
  headId?: string;
  parentName?: string;
  parentId?: string;
  memberCount: number;
}

export interface DemoJobTitle {
  id: string;
  title_name: string;
  description: string | null;
  department_id?: string | null;
  department_name?: string | null;
  created_at: string;
}

export interface DemoLocation {
  id: string;
  name: string;
  code: string;
  address: string;
  timezone: string;
  workingHours: number;
  weeklyOffDays: number[];
}

export interface DemoShift {
  id: string;
  name: string;
  code: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  graceMinutes: number;
}

export interface DemoUser {
  id: string;
  name: string;
  email: string;
  role: "employee" | "manager" | "hr" | "admin";
  workMode: "remote" | "hybrid" | "office";
  department: string;
  departmentId: string;
  jobTitle: string;
  jobTitleId: string;
  location: string;
  status: "active" | "invited" | "deactivated" | "suspended" | "inactive";
  timezone: string;
  shiftStartTime: string;
  shiftEndTime: string;
}

export interface DemoTeam {
  id: string;
  name: string;
  code: string;
  departmentId?: string | null;
  leadId?: string | null;
  leadName?: string | null;
  memberIds: string[];
  createdAt: string;
}

export interface DemoProject {
  id: string;
  name: string;
  code: string;
  department_id?: string | null;
  description?: string | null;
  status?: string;
  created_at?: string;
}

export interface DemoTask {
  id: string;
  title: string;
  description?: string | null;
  creator_id?: string | null;
  assignee_id?: string | null;
  project_id?: string | null;
  parent_task_id?: string | null;
  status: "todo" | "in_progress" | "blocked" | "done" | "cancelled";
  priority: "low" | "medium" | "high" | "urgent";
  due_date?: string | null;
  estimated_minutes?: number | null;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface DemoHoliday {
  id: string;
  name: string;
  holiday_date: string;
  is_half_day: boolean;
  notes?: string | null;
}

export interface DemoLeaveRequest {
  id: string;
  employee_id?: string;
  startDate: string;
  endDate: string;
  status: "pending" | "approved" | "rejected";
  days_count?: number;
  reason?: string;
}

export interface DemoRegularization {
  id: string;
  employee_id: string;
  employee_name: string;
  work_date: string;
  requested_in: string;
  requested_out: string;
  reason: string;
  status: "pending" | "approved" | "rejected";
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  review_note?: string | null;
  created_at: string;
}

export interface DemoAudit {
  id: string;
  created_at: string;
  actor_name: string;
  action: string;
  table_name: string;
  record_id: string;
  old_data?: any;
  new_data?: any;
}

export interface DemoAttendanceSession {
  id: string;
  employee_id: string;
  work_date: string;
  check_in_at: string;
  check_out_at: string | null;
  duration_minutes: number;
}

export interface DemoAttendanceDay {
  id: string;
  employee_id: string;
  work_date: string;
  status: "present" | "half_day" | "absent" | "leave" | "holiday";
  total_minutes: number;
  is_late: boolean;
  locked: boolean;
}

// Production & Active Admin User
export const INITIAL_DEMO_USERS: DemoUser[] = [
  {
    id: "952a33f0-3af4-4a69-a382-26fef3b7fa11",
    name: "Aadhithya Raavanan",
    email: "aadhithya.raavanan@gmail.com",
    role: "admin",
    workMode: "remote",
    department: "Unassigned",
    departmentId: "",
    jobTitle: "Super Admin",
    jobTitleId: "",
    location: "Unassigned",
    status: "active",
    timezone: "UTC",
    shiftStartTime: "09:00",
    shiftEndTime: "17:00",
  },
];

const KEYS = {
  departments: "remotehr_demo_departments",
  jobTitles: "remotehr_demo_job_titles",
  locations: "remotehr_demo_locations",
  shifts: "remotehr_demo_shifts",
  users: "remotehr_demo_users",
  teams: "remotehr_demo_teams",
  projects: "remotehr_demo_projects",
  tasks: "remotehr_demo_tasks",
  leaveRequests: "remotehr_demo_leave_requests",
  holidays: "remotehr_demo_holidays",
  regularizations: "remotehr_demo_regularizations",
  audits: "remotehr_demo_audits",
  attendanceSessions: "remotehr_demo_attendance_sessions",
  attendanceDays: "remotehr_demo_attendance_days",
};

function readKey<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeKey<T>(key: string, value: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    // Dispatch local change event
    window.dispatchEvent(new Event("remotehr_storage_change"));
    // Push update to server state asynchronously for cross-device sync
    fetch("/api/demo/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key.replace("remotehr_demo_", "")]: value }),
    }).catch(() => {});
  } catch {}
}

// Background sync from server (for cross-PC sync on Vercel)
export async function syncFromServer(): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    const res = await fetch("/api/demo/state");
    if (!res.ok) return;
    const data = await res.json();
    if (data && typeof data === "object") {
      let changed = false;
      if (Array.isArray(data.departments) && data.departments.length > 0) {
        localStorage.setItem(KEYS.departments, JSON.stringify(data.departments));
        changed = true;
      }
      if (Array.isArray(data.users) && data.users.length > 0) {
        localStorage.setItem(KEYS.users, JSON.stringify(data.users));
        changed = true;
      }
      if (Array.isArray(data.teams) && data.teams.length > 0) {
        localStorage.setItem(KEYS.teams, JSON.stringify(data.teams));
        changed = true;
      }
      if (Array.isArray(data.regularizations)) {
        localStorage.setItem(KEYS.regularizations, JSON.stringify(data.regularizations));
        changed = true;
      }
      if (Array.isArray(data.leaveRequests)) {
        const cleaned = data.leaveRequests.filter(
          (r: any) =>
            !r.id?.startsWith("lr-demo-") &&
            r.reason !== "Family event and personal commitment" &&
            r.reason !== "Doctor appointment in morning"
        );
        localStorage.setItem(KEYS.leaveRequests, JSON.stringify(cleaned));
        changed = true;
      }
      if (!isDemoModeEnabled()) {
        localStorage.removeItem(KEYS.tasks);
        localStorage.removeItem(KEYS.attendanceDays);
        localStorage.removeItem(KEYS.attendanceSessions);
        changed = true;
      }
      if (changed) {
        window.dispatchEvent(new Event("remotehr_storage_change"));
      }
    }
  } catch {}
}

// --- DEPARTMENTS ---
export function getStoredDepartments(): DemoDepartment[] {
  const current = readKey<DemoDepartment[]>(KEYS.departments, []);
  // Auto-clean legacy mock seeded departments if they match the initial seed template
  const isMockSeed = current.length === 4 &&
    current.some((d) => d.name === "Engineering" && d.code === "ENG") &&
    current.some((d) => d.name === "Marketing & Growth" && d.code === "MKT");
  if (isMockSeed) {
    writeKey(KEYS.departments, []);
    return [];
  }
  return current;
}

export function saveStoredDepartments(depts: DemoDepartment[]): void {
  writeKey(KEYS.departments, depts);
}

export function addStoredDepartment(dept: Omit<DemoDepartment, "id"> & { id?: string }): DemoDepartment {
  const current = getStoredDepartments();
  const created: DemoDepartment = {
    ...dept,
    id: dept.id || `dept-${Date.now()}`,
    memberCount: dept.memberCount || 0,
  };
  saveStoredDepartments([...current, created]);
  addStoredAudit("CREATE_DEPARTMENT", "departments", created.id, null, created);
  return created;
}

export function updateStoredDepartment(dept: DemoDepartment): void {
  const current = getStoredDepartments();
  const old = current.find((d) => d.id === dept.id);
  saveStoredDepartments(current.map((d) => (d.id === dept.id ? dept : d)));
  addStoredAudit("UPDATE_DEPARTMENT", "departments", dept.id, old, dept);
}

export function deleteStoredDepartment(id: string): void {
  const current = getStoredDepartments();
  const toDelete = current.find((d) => d.id === id);
  saveStoredDepartments(current.filter((d) => d.id !== id));
  if (toDelete) {
    addStoredAudit("DELETE_DEPARTMENT", "departments", id, toDelete, null);
  }

  // Cascade: clean up users assigned to this department
  const users = getStoredUsers();
  const updatedUsers = users.map((u) => {
    if (u.departmentId === id || (toDelete && u.department === toDelete.name)) {
      return { ...u, department: "Unassigned", departmentId: "" };
    }
    return u;
  });
  saveStoredUsers(updatedUsers);

  // Cascade: clean up teams assigned to this department
  const teams = getStoredTeams();
  const updatedTeams = teams.map((t) => (t.departmentId === id ? { ...t, departmentId: null } : t));
  saveStoredTeams(updatedTeams);

  // Cascade: clean up projects assigned to this department
  const projects = getStoredProjects();
  const updatedProjects = projects.map((p) => (p.department_id === id ? { ...p, department_id: null } : p));
  saveStoredProjects(updatedProjects);
}

// --- JOB TITLES ---
export function getStoredJobTitles(): DemoJobTitle[] {
  return readKey<DemoJobTitle[]>(KEYS.jobTitles, []);
}

export function saveStoredJobTitles(titles: DemoJobTitle[]): void {
  writeKey(KEYS.jobTitles, titles);
}

export function addStoredJobTitle(
  titleName: string,
  description?: string | null,
  departmentId?: string | null,
  departmentName?: string | null,
  explicitId?: string
): DemoJobTitle {
  const current = getStoredJobTitles();
  const created: DemoJobTitle = {
    id: explicitId || `jt-${Date.now()}`,
    title_name: titleName.trim(),
    description: description ? description.trim() : null,
    department_id: departmentId || null,
    department_name: departmentName || null,
    created_at: new Date().toISOString(),
  };
  saveStoredJobTitles([created, ...current.filter((t) => t.id !== created.id && t.title_name !== created.title_name)]);
  addStoredAudit("CREATE_JOB_TITLE", "job_titles", created.id, null, created);
  return created;
}

export function deleteStoredJobTitle(id: string): void {
  const current = getStoredJobTitles();
  const toDelete = current.find((t) => t.id === id);
  saveStoredJobTitles(current.filter((t) => t.id !== id));
  if (toDelete) {
    addStoredAudit("DELETE_JOB_TITLE", "job_titles", id, toDelete, null);
    // Cascade to users
    const users = getStoredUsers();
    saveStoredUsers(
      users.map((u) =>
        u.jobTitleId === id || u.jobTitle === toDelete.title_name
          ? { ...u, jobTitle: "Unassigned", jobTitleId: "" }
          : u
      )
    );
  }
}

// --- LOCATIONS ---
export function getStoredLocations(): DemoLocation[] {
  return readKey<DemoLocation[]>(KEYS.locations, []);
}

export function saveStoredLocations(locations: DemoLocation[]): void {
  writeKey(KEYS.locations, locations);
}

export function addStoredLocation(loc: Omit<DemoLocation, "id"> & { id?: string }): DemoLocation {
  const current = getStoredLocations();
  const created: DemoLocation = {
    ...loc,
    id: loc.id || `loc-${Date.now()}`,
  };
  saveStoredLocations([...current, created]);
  addStoredAudit("CREATE_LOCATION", "locations", created.id, null, created);
  return created;
}

export function deleteStoredLocation(id: string): void {
  const current = getStoredLocations();
  const toDelete = current.find((l) => l.id === id);
  saveStoredLocations(current.filter((l) => l.id !== id));
  if (toDelete) {
    addStoredAudit("DELETE_LOCATION", "locations", id, toDelete, null);
    // Cascade to users
    const users = getStoredUsers();
    saveStoredUsers(
      users.map((u) =>
        u.location === toDelete.name || u.location.includes(toDelete.name)
          ? { ...u, location: "Unassigned" }
          : u
      )
    );
  }
}

// --- SHIFTS ---
export function getStoredShifts(): DemoShift[] {
  return readKey<DemoShift[]>(KEYS.shifts, []);
}

export function saveStoredShifts(shifts: DemoShift[]): void {
  writeKey(KEYS.shifts, shifts);
}

export function addStoredShift(shift: Omit<DemoShift, "id"> & { id?: string }): DemoShift {
  const current = getStoredShifts();
  const created: DemoShift = {
    ...shift,
    id: shift.id || `shift-${Date.now()}`,
  };
  saveStoredShifts([...current, created]);
  addStoredAudit("CREATE_SHIFT", "shifts", created.id, null, created);
  return created;
}

export function deleteStoredShift(id: string): void {
  const current = getStoredShifts();
  saveStoredShifts(current.filter((s) => s.id !== id));
}

// --- USERS / WORKFORCE DIRECTORY ---
export function getStoredUsers(): DemoUser[] {
  const current = readKey<DemoUser[]>(KEYS.users, INITIAL_DEMO_USERS);
  // Auto-clean: scrub any legacy demo user names and previously deleted emails
  const purged = current.filter(
    (u) =>
      !u.email.endsWith("@remotehr.io") &&
      u.email !== "admin@remotehr.io" &&
      u.email !== "hr@remotehr.io" &&
      u.email !== "manager@remotehr.io" &&
      u.email !== "employee@remotehr.io" &&
      u.email !== "jamesaathithyandev@gmail.com" &&
      !u.name.toLowerCase().includes("jamesaathithyandev") &&
      !u.name.toLowerCase().includes("james aathithyan") &&
      !u.name.toLowerCase().includes("sarah jenkins") &&
      !u.name.toLowerCase().includes("david chen") &&
      !u.name.toLowerCase().includes("maya patel") &&
      !u.name.toLowerCase().includes("eleanor") &&
      !u.name.toLowerCase().includes("leslie")
  );

  const activeList = purged.length > 0 ? purged : INITIAL_DEMO_USERS;
  if (activeList.length !== current.length) {
    writeKey(KEYS.users, activeList);
  }

  // Auto-clean: verify that if a department, location, or job title no longer exists, it displays Unassigned
  const depts = getStoredDepartments();
  const locs = getStoredLocations();
  const titles = getStoredJobTitles();
  const deptNames = new Set(depts.map((d) => d.name));
  const locNames = new Set(locs.map((l) => l.name));
  const titleNames = new Set(titles.map((t) => t.title_name));

  return activeList.map((u) => {
    let changed = false;
    let dept = u.department;
    let deptId = u.departmentId;
    let loc = u.location;
    let title = u.jobTitle;
    let titleId = u.jobTitleId;

    if (depts.length === 0 || (dept !== "Unassigned" && !deptNames.has(dept))) {
      dept = "Unassigned";
      deptId = "";
      changed = true;
    }
    if (locs.length === 0 || (loc !== "Unassigned" && !locNames.has(loc) && !locNames.has(loc.split(" ")[0]))) {
      loc = "Unassigned";
      changed = true;
    }
    if (titles.length === 0 || (title && title !== "Unassigned" && !titleNames.has(title))) {
      title = "Unassigned";
      titleId = "";
      changed = true;
    }

    return changed
      ? { ...u, department: dept, departmentId: deptId, location: loc, jobTitle: title, jobTitleId: titleId }
      : u;
  });
}

export function saveStoredUsers(users: DemoUser[]): void {
  writeKey(KEYS.users, users);
}

export function addStoredUser(user: Omit<DemoUser, "id"> & { id?: string }): DemoUser {
  const current = getStoredUsers();
  const created: DemoUser = {
    ...user,
    id: user.id || `user-${Date.now()}`,
  };
  saveStoredUsers([created, ...current]);
  addStoredAudit("INVITE_EMPLOYEE", "organization_members", created.id, null, {
    name: created.name,
    email: created.email,
    role: created.role,
  });
  return created;
}

export function updateStoredUser(user: DemoUser): void {
  const current = getStoredUsers();
  const index = current.findIndex(
    (u) =>
      u.id === user.id ||
      (Boolean(u.email) && Boolean(user.email) && u.email.toLowerCase() === user.email.toLowerCase())
  );
  let next: DemoUser[];
  let old: DemoUser | undefined;
  if (index >= 0) {
    old = current[index];
    next = [...current];
    next[index] = { ...old, ...user };
  } else {
    next = [...current, user];
  }
  saveStoredUsers(next);
  addStoredAudit("UPDATE_USER_GOVERNANCE", "organization_members", user.id, old || null, user);
}

export function deleteStoredUser(id: string): void {
  const current = getStoredUsers();
  const toDelete = current.find((u) => u.id === id || u.email === id);
  saveStoredUsers(current.filter((u) => u.id !== id && u.email !== id));
  if (toDelete) {
    addStoredAudit("DELETE_USER", "organization_members", id, toDelete, null);
  }
}

// --- TEAMS MANAGEMENT ---
export function getStoredTeams(): DemoTeam[] {
  return readKey<DemoTeam[]>(KEYS.teams, []);
}

export function saveStoredTeams(teams: DemoTeam[]): void {
  writeKey(KEYS.teams, teams);
}

export function addStoredTeam(team: Omit<DemoTeam, "id" | "createdAt"> & { id?: string }): DemoTeam {
  const current = getStoredTeams();
  const users = getStoredUsers();
  const leadUser = team.leadId ? users.find((u) => u.id === team.leadId) : null;
  const created: DemoTeam = {
    ...team,
    id: team.id || `team-${Date.now()}`,
    leadName: leadUser ? leadUser.name : team.leadName || null,
    memberIds: team.memberIds || [],
    createdAt: new Date().toISOString(),
  };
  saveStoredTeams([...current, created]);
  addStoredAudit("CREATE_TEAM", "teams", created.id, null, created);
  return created;
}

export function updateStoredTeam(team: DemoTeam): void {
  const current = getStoredTeams();
  const old = current.find((t) => t.id === team.id);
  saveStoredTeams(current.map((t) => (t.id === team.id ? team : t)));
  addStoredAudit("UPDATE_TEAM", "teams", team.id, old, team);
}

export function deleteStoredTeam(id: string): void {
  const current = getStoredTeams();
  const toDelete = current.find((t) => t.id === id);
  saveStoredTeams(current.filter((t) => t.id !== id));
  if (toDelete) {
    addStoredAudit("DELETE_TEAM", "teams", id, toDelete, null);
  }
}

export function kickTeamMember(teamId: string, memberId: string): void {
  const current = getStoredTeams();
  const team = current.find((t) => t.id === teamId);
  if (!team) return;
  const updatedTeam: DemoTeam = {
    ...team,
    memberIds: team.memberIds.filter((mId) => mId !== memberId),
  };
  updateStoredTeam(updatedTeam);
  addStoredAudit("KICK_TEAM_MEMBER", "teams", teamId, null, { memberId });
}

export function addTeamMember(teamId: string, memberId: string): void {
  const current = getStoredTeams();
  const team = current.find((t) => t.id === teamId);
  if (!team || team.memberIds.includes(memberId)) return;
  const updatedTeam: DemoTeam = {
    ...team,
    memberIds: [...team.memberIds, memberId],
  };
  updateStoredTeam(updatedTeam);
  addStoredAudit("ADD_TEAM_MEMBER", "teams", teamId, null, { memberId });
}

// --- PROJECTS ---
export function getStoredProjects(): DemoProject[] {
  return readKey<DemoProject[]>(KEYS.projects, []);
}

export function saveStoredProjects(projects: DemoProject[]): void {
  writeKey(KEYS.projects, projects);
}

export function addStoredProject(proj: Omit<DemoProject, "id"> & { id?: string }): DemoProject {
  const current = getStoredProjects();
  const created: DemoProject = {
    ...proj,
    id: proj.id || `proj-${Date.now()}`,
    status: proj.status || "active",
    created_at: new Date().toISOString(),
  };
  saveStoredProjects([...current, created]);
  addStoredAudit("CREATE_PROJECT", "projects", created.id, null, created);
  return created;
}

export function deleteStoredProject(id: string): void {
  const current = getStoredProjects();
  saveStoredProjects(current.filter((p) => p.id !== id));
}

// --- TASKS ---
export function getStoredTasks(): DemoTask[] {
  if (!isDemoModeEnabled()) return [];
  return readKey<DemoTask[]>(KEYS.tasks, []);
}

export function saveStoredTasks(tasks: DemoTask[]): void {
  writeKey(KEYS.tasks, tasks);
}

export function addStoredTask(task: Omit<DemoTask, "id" | "created_at"> & { id?: string }): DemoTask {
  const current = getStoredTasks();
  const created: DemoTask = {
    ...task,
    id: task.id || `task-${Date.now()}`,
    created_at: new Date().toISOString(),
  };
  saveStoredTasks([created, ...current]);
  addStoredAudit("CREATE_TASK", "tasks", created.id, null, created);
  return created;
}

export function updateStoredTask(task: DemoTask): void {
  const current = getStoredTasks();
  saveStoredTasks(current.map((t) => (t.id === task.id ? task : t)));
}

export function deleteStoredTask(id: string): void {
  const current = getStoredTasks();
  saveStoredTasks(current.filter((t) => t.id !== id));
}

// --- COMPANY HOLIDAYS ---
export function getStoredHolidays(): DemoHoliday[] {
  return readKey<DemoHoliday[]>(KEYS.holidays, []);
}

export function saveStoredHolidays(holidays: DemoHoliday[]): void {
  writeKey(KEYS.holidays, holidays);
}

export function addStoredHoliday(holiday: Omit<DemoHoliday, "id"> & { id?: string }): DemoHoliday {
  const current = getStoredHolidays();
  const created: DemoHoliday = {
    ...holiday,
    id: holiday.id || `holiday-${Date.now()}`,
  };
  saveStoredHolidays([...current, created]);
  addStoredAudit("CREATE_HOLIDAY", "holidays", created.id, null, created);
  return created;
}

export function deleteStoredHoliday(id: string): void {
  const current = getStoredHolidays();
  saveStoredHolidays(current.filter((h) => h.id !== id));
}

// --- LEAVE REQUESTS ---
export function getStoredLeaveRequests(): DemoLeaveRequest[] {
  return readKey<DemoLeaveRequest[]>(KEYS.leaveRequests, []);
}

export function saveStoredLeaveRequests(requests: DemoLeaveRequest[]): void {
  writeKey(KEYS.leaveRequests, requests);
}

// --- REGULARIZATION REQUESTS (Clean Slate - Starts Empty) ---
export function getStoredRegularizations(): DemoRegularization[] {
  const list = readKey<DemoRegularization[]>(KEYS.regularizations, []);
  const cleaned = list.filter(
    (r) =>
      !r.id?.includes("demo") &&
      !r.employee_name?.includes("Eleanor Pena") &&
      !r.reason?.includes("Broadband connection")
  );
  if (cleaned.length !== list.length) {
    saveStoredRegularizations(cleaned);
  }
  return cleaned;
}

export function saveStoredRegularizations(requests: DemoRegularization[]): void {
  writeKey(KEYS.regularizations, requests);
}

export function addStoredRegularization(req: Omit<DemoRegularization, "id" | "created_at"> & { id?: string }): DemoRegularization {
  const current = getStoredRegularizations();
  const created: DemoRegularization = {
    ...req,
    id: req.id || `reg-${Date.now()}`,
    created_at: new Date().toISOString(),
  };
  saveStoredRegularizations([created, ...current]);
  addStoredAudit("SUBMIT_REGULARIZATION", "regularization_requests", created.id, null, created);
  return created;
}

export function updateStoredRegularization(id: string, updates: Partial<DemoRegularization>): void {
  const current = getStoredRegularizations();
  const next = current.map((r) => (r.id === id ? { ...r, ...updates } : r));
  saveStoredRegularizations(next);
  addStoredAudit("UPDATE_REGULARIZATION", "regularization_requests", id, null, updates);
}

// --- AUDIT LOGS (Real Action Logging) ---
export function getStoredAudits(): DemoAudit[] {
  return readKey<DemoAudit[]>(KEYS.audits, []);
}

export function saveStoredAudits(audits: DemoAudit[]): void {
  writeKey(KEYS.audits, audits);
}

export function addStoredAudit(
  action: string,
  tableName: string,
  recordId: string,
  oldData?: any,
  newData?: any
): DemoAudit {
  const current = getStoredAudits();
  let actorName = "Admin";
  if (typeof window !== "undefined") {
    actorName = localStorage.getItem("remotehr_cached_name") || "Active User";
  }
  const created: DemoAudit = {
    id: `aud-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    created_at: new Date().toISOString(),
    actor_name: actorName,
    action,
    table_name: tableName,
    record_id: recordId,
    old_data: oldData || null,
    new_data: newData || null,
  };
  // Prepend so latest appears on top
  saveStoredAudits([created, ...current.slice(0, 99)]);
  return created;
}

// --- ATTENDANCE TRACKING (Clean Slate - Starts 0) ---
export function getStoredAttendanceSessions(): DemoAttendanceSession[] {
  if (!isDemoModeEnabled()) return [];
  return readKey<DemoAttendanceSession[]>(KEYS.attendanceSessions, []);
}

export function saveStoredAttendanceSessions(sessions: DemoAttendanceSession[]): void {
  writeKey(KEYS.attendanceSessions, sessions);
}

export function getStoredAttendanceDays(): DemoAttendanceDay[] {
  if (!isDemoModeEnabled()) return [];
  return readKey<DemoAttendanceDay[]>(KEYS.attendanceDays, []);
}

export function saveStoredAttendanceDays(days: DemoAttendanceDay[]): void {
  writeKey(KEYS.attendanceDays, days);
}

export function recordCheckIn(employeeId: string): DemoAttendanceSession {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const currentSessions = getStoredAttendanceSessions();
  const session: DemoAttendanceSession = {
    id: `sess-${Date.now()}`,
    employee_id: employeeId,
    work_date: todayIso,
    check_in_at: now.toISOString(),
    check_out_at: null,
    duration_minutes: 0,
  };
  saveStoredAttendanceSessions([session, ...currentSessions]);

  // Update attendance day
  const currentDays = getStoredAttendanceDays();
  const existingDay = currentDays.find((d) => d.employee_id === employeeId && d.work_date === todayIso);
  if (!existingDay) {
    const day: DemoAttendanceDay = {
      id: `day-${Date.now()}`,
      employee_id: employeeId,
      work_date: todayIso,
      status: "present",
      total_minutes: 0,
      is_late: false,
      locked: false,
    };
    saveStoredAttendanceDays([day, ...currentDays]);
  }

  addStoredAudit("CHECK_IN", "attendance_sessions", session.id, null, session);
  return session;
}

export function recordCheckOut(employeeId: string): DemoAttendanceSession | null {
  const now = new Date();
  const todayIso = now.toISOString().slice(0, 10);
  const currentSessions = getStoredAttendanceSessions();
  const openSessionIndex = currentSessions.findIndex(
    (s) => s.employee_id === employeeId && s.work_date === todayIso && !s.check_out_at
  );

  if (openSessionIndex === -1) return null;

  const openSession = currentSessions[openSessionIndex];
  const start = new Date(openSession.check_in_at).getTime();
  const end = now.getTime();
  const durationMinutes = Math.max(1, Math.round((end - start) / 60000));

  const updatedSession: DemoAttendanceSession = {
    ...openSession,
    check_out_at: now.toISOString(),
    duration_minutes: durationMinutes,
  };

  const nextSessions = [...currentSessions];
  nextSessions[openSessionIndex] = updatedSession;
  saveStoredAttendanceSessions(nextSessions);

  // Update day total minutes
  const currentDays = getStoredAttendanceDays();
  const dayIndex = currentDays.findIndex((d) => d.employee_id === employeeId && d.work_date === todayIso);
  if (dayIndex !== -1) {
    const nextDays = [...currentDays];
    nextDays[dayIndex] = {
      ...nextDays[dayIndex],
      total_minutes: nextDays[dayIndex].total_minutes + durationMinutes,
    };
    saveStoredAttendanceDays(nextDays);
  }

  addStoredAudit("CHECK_OUT", "attendance_sessions", updatedSession.id, null, updatedSession);
  return updatedSession;
}
