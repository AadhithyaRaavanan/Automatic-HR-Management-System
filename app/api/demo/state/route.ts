import { NextResponse } from "next/server";

interface GlobalDemoStore {
  departments: any[];
  jobTitles: any[];
  locations: any[];
  shifts: any[];
  users: any[];
  teams: any[];
  projects: any[];
  tasks: any[];
  leaveRequests: any[];
  holidays: any[];
  regularizations: any[];
  audits: any[];
  attendanceDays: any[];
  attendanceSessions: any[];
}

declare global {
  // eslint-disable-next-line no-var
  var __remotehr_server_demo_store: GlobalDemoStore | undefined;
}

function getStore(): GlobalDemoStore {
  if (!globalThis.__remotehr_server_demo_store) {
    globalThis.__remotehr_server_demo_store = {
      departments: [],
      jobTitles: [],
      locations: [],
      shifts: [],
      users: [
        {
          id: "00000000-0000-0000-0000-000000000010",
          name: "James Aathithyan",
          email: "admin@remotehr.io",
          role: "admin",
          workMode: "remote",
          department: "Unassigned",
          departmentId: "",
          jobTitle: "Unassigned",
          jobTitleId: "",
          location: "Unassigned",
          status: "active",
          timezone: "UTC",
          shiftStartTime: "09:00",
          shiftEndTime: "17:00",
        },
        {
          id: "00000000-0000-0000-0000-000000000020",
          name: "Sarah Jenkins",
          email: "hr@remotehr.io",
          role: "hr",
          workMode: "remote",
          department: "Unassigned",
          departmentId: "",
          jobTitle: "Unassigned",
          jobTitleId: "",
          location: "Unassigned",
          status: "active",
          timezone: "UTC",
          shiftStartTime: "09:00",
          shiftEndTime: "17:00",
        },
        {
          id: "00000000-0000-0000-0000-000000000030",
          name: "David Chen",
          email: "manager@remotehr.io",
          role: "manager",
          workMode: "remote",
          department: "Unassigned",
          departmentId: "",
          jobTitle: "Unassigned",
          jobTitleId: "",
          location: "Unassigned",
          status: "active",
          timezone: "UTC",
          shiftStartTime: "09:00",
          shiftEndTime: "17:00",
        },
        {
          id: "00000000-0000-0000-0000-000000000040",
          name: "Maya Patel",
          email: "employee@remotehr.io",
          role: "employee",
          workMode: "remote",
          department: "Unassigned",
          departmentId: "",
          jobTitle: "Unassigned",
          jobTitleId: "",
          location: "Unassigned",
          status: "active",
          timezone: "UTC",
          shiftStartTime: "09:00",
          shiftEndTime: "17:00",
        },
      ],
      teams: [],
      projects: [],
      tasks: [],
      leaveRequests: [],
      holidays: [],
      regularizations: [],
      audits: [],
      attendanceDays: [],
      attendanceSessions: [],
    };
  }
  return globalThis.__remotehr_server_demo_store;
}

export async function GET() {
  const store = getStore();
  return NextResponse.json(store);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const store = getStore();

    if (Array.isArray(body.departments)) store.departments = body.departments;
    if (Array.isArray(body.jobTitles)) store.jobTitles = body.jobTitles;
    if (Array.isArray(body.locations)) store.locations = body.locations;
    if (Array.isArray(body.shifts)) store.shifts = body.shifts;
    if (Array.isArray(body.users)) store.users = body.users;
    if (Array.isArray(body.teams)) store.teams = body.teams;
    if (Array.isArray(body.projects)) store.projects = body.projects;
    if (Array.isArray(body.tasks)) store.tasks = body.tasks;
    if (Array.isArray(body.leaveRequests)) store.leaveRequests = body.leaveRequests;
    if (Array.isArray(body.holidays)) store.holidays = body.holidays;
    if (Array.isArray(body.regularizations)) store.regularizations = body.regularizations;
    if (Array.isArray(body.audits)) store.audits = body.audits;
    if (Array.isArray(body.attendanceDays)) store.attendanceDays = body.attendanceDays;
    if (Array.isArray(body.attendanceSessions)) store.attendanceSessions = body.attendanceSessions;

    return NextResponse.json({ success: true, store });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update state" }, { status: 400 });
  }
}
