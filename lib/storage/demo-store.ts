/**
 * Unified Shared Storage for RemoteHR Demo Environment
 *
 * Ensures all modules (Workforce, Departments, Locations, Shifts, Tasks, Team, KPI, Leave)
 * share the exact same clean, user-created data.
 *
 * No fake data pre-populates the workspace, except the 4 core demo login accounts
 * (Admin, HR, Manager, Employee) so the user can sign in and test each role.
 */

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

// 4 Core Demo Accounts (Preserved for Demo Login Switching)
export const INITIAL_DEMO_USERS: DemoUser[] = [
  {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Sarah Connor",
    email: "admin@remotehr.io",
    role: "admin",
    workMode: "remote",
    department: "Executive Management",
    departmentId: "",
    jobTitle: "System Administrator",
    jobTitleId: "",
    location: "Global Remote",
    status: "active",
    timezone: "UTC",
    shiftStartTime: "09:00",
    shiftEndTime: "17:00",
  },
  {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Marcus Vance",
    email: "hr@remotehr.io",
    role: "hr",
    workMode: "remote",
    department: "People Operations",
    departmentId: "",
    jobTitle: "HR Director",
    jobTitleId: "",
    location: "Global Remote",
    status: "active",
    timezone: "UTC",
    shiftStartTime: "09:00",
    shiftEndTime: "17:00",
  },
  {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Alex Morgan",
    email: "manager@remotehr.io",
    role: "manager",
    workMode: "remote",
    department: "Operations",
    departmentId: "",
    jobTitle: "Team Manager",
    jobTitleId: "",
    location: "Global Remote",
    status: "active",
    timezone: "UTC",
    shiftStartTime: "09:00",
    shiftEndTime: "17:00",
  },
  {
    id: "00000000-0000-0000-0000-000000000004",
    name: "James Sullivan",
    email: "employee@remotehr.io",
    role: "employee",
    workMode: "remote",
    department: "Engineering",
    departmentId: "",
    jobTitle: "Software Engineer",
    jobTitleId: "",
    location: "Global Remote",
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
  projects: "remotehr_demo_projects",
  tasks: "remotehr_demo_tasks",
  leaveRequests: "remotehr_demo_leave_requests",
  holidays: "remotehr_demo_holidays",
  regularizations: "remotehr_demo_regularizations",
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
    // Dispatch storage event so open pages/tabs stay in sync immediately
    window.dispatchEvent(new Event("remotehr_storage_change"));
  } catch {}
}

// --- DEPARTMENTS ---
export function getStoredDepartments(): DemoDepartment[] {
  return readKey<DemoDepartment[]>(KEYS.departments, []);
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
  return created;
}

export function deleteStoredDepartment(id: string): void {
  const current = getStoredDepartments();
  saveStoredDepartments(current.filter((d) => d.id !== id));
}

// --- JOB TITLES ---
export function getStoredJobTitles(): DemoJobTitle[] {
  return readKey<DemoJobTitle[]>(KEYS.jobTitles, []);
}

export function saveStoredJobTitles(titles: DemoJobTitle[]): void {
  writeKey(KEYS.jobTitles, titles);
}

export function addStoredJobTitle(titleName: string, description?: string | null): DemoJobTitle {
  const current = getStoredJobTitles();
  const created: DemoJobTitle = {
    id: `jt-${Date.now()}`,
    title_name: titleName.trim(),
    description: description ? description.trim() : null,
    created_at: new Date().toISOString(),
  };
  saveStoredJobTitles([created, ...current]);
  return created;
}

export function deleteStoredJobTitle(id: string): void {
  const current = getStoredJobTitles();
  saveStoredJobTitles(current.filter((t) => t.id !== id));
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
  return created;
}

export function deleteStoredLocation(id: string): void {
  const current = getStoredLocations();
  saveStoredLocations(current.filter((l) => l.id !== id));
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
  return created;
}

export function deleteStoredShift(id: string): void {
  const current = getStoredShifts();
  saveStoredShifts(current.filter((s) => s.id !== id));
}

// --- USERS / EMPLOYEES ---
export function getStoredUsers(): DemoUser[] {
  return readKey<DemoUser[]>(KEYS.users, INITIAL_DEMO_USERS);
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
  return created;
}

export function updateStoredUser(user: DemoUser): void {
  const current = getStoredUsers();
  saveStoredUsers(current.map((u) => (u.id === user.id ? user : u)));
}

export function deleteStoredUser(id: string): void {
  const current = getStoredUsers();
  saveStoredUsers(current.filter((u) => u.id !== id));
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
  return created;
}

export function deleteStoredProject(id: string): void {
  const current = getStoredProjects();
  saveStoredProjects(current.filter((p) => p.id !== id));
}

// --- TASKS ---
export function getStoredTasks(): DemoTask[] {
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
export interface DemoHoliday {
  id: string;
  name: string;
  holiday_date: string;
  is_half_day: boolean;
  notes?: string | null;
}

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
  return created;
}

export function deleteStoredHoliday(id: string): void {
  const current = getStoredHolidays();
  saveStoredHolidays(current.filter((h) => h.id !== id));
}
