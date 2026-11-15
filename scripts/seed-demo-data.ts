/**
 * Idempotent Demo Data Seeder
 *
 * Populates realistic data for the 4 core roles (admin, hr, manager, employee)
 * with dates dynamically relative to now. Refuses non-local databases.
 */
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });
dotenv.config();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

// Refuse any non-local database host
if (!supabaseUrl.includes("127.0.0.1") && !supabaseUrl.includes("localhost")) {
  console.error("CRITICAL: Refusing to seed non-local host:", supabaseUrl);
  process.exit(1);
}

if (!serviceRoleKey) {
  console.error("CRITICAL: SUPABASE_SERVICE_ROLE_KEY missing.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const ORG_ID = "00000000-0000-0000-0000-000000000001";
const PASSWORD = "DemoPassword123!";

export async function seedDemoData() {
  console.log("🌱 Seeding Demo Environment on local Supabase:", supabaseUrl);

  // 1. Ensure Demo Organization exists with require_mfa_for_privileged = FALSE
  const { error: orgErr } = await supabase.from("organizations").upsert({
    id: ORG_ID,
    name: "RemoteHR Global Tech",
    slug: "remotehr-global",
    domain: "remotehr.io",
    timezone: "America/Los_Angeles",
    work_mode: "hybrid",
    require_mfa_for_privileged: false,
    combined_monthly_leave_cap: 5,
  });
  if (orgErr) console.warn("Org upsert note:", orgErr.message);

  // 2. Ensure Departments exist
  const departments = [
    { id: "00000000-0000-0000-0000-000000000101", organization_id: ORG_ID, name: "Engineering", code: "ENG" },
    { id: "00000000-0000-0000-0000-000000000102", organization_id: ORG_ID, name: "People Operations", code: "HR" },
    { id: "00000000-0000-0000-0000-000000000103", organization_id: ORG_ID, name: "Product & Design", code: "DES" },
    { id: "00000000-0000-0000-0000-000000000104", organization_id: ORG_ID, name: "Marketing & Sales", code: "MKT" },
  ];
  await supabase.from("departments").upsert(departments);

  // 3. Ensure Locations exist
  const locations = [
    {
      id: "00000000-0000-0000-0000-000000000201",
      organization_id: ORG_ID,
      name: "San Francisco HQ",
      code: "SF-HQ",
      timezone: "America/Los_Angeles",
      working_hours: "09:00 - 17:00",
      weekly_off_days: [0, 6],
    },
    {
      id: "00000000-0000-0000-0000-000000000202",
      organization_id: ORG_ID,
      name: "New York Hub",
      code: "NY-HUB",
      timezone: "America/New_York",
      working_hours: "09:00 - 17:00",
      weekly_off_days: [0, 6],
    },
  ];
  await supabase.from("locations").upsert(locations);

  // 4. Ensure Job Titles exist
  const jobTitles = [
    { id: "00000000-0000-0000-0000-000000000301", organization_id: ORG_ID, title_name: "Lead Systems Architect" },
    { id: "00000000-0000-0000-0000-000000000302", organization_id: ORG_ID, title_name: "HR Director" },
    { id: "00000000-0000-0000-0000-000000000303", organization_id: ORG_ID, title_name: "Engineering Manager" },
    { id: "00000000-0000-0000-0000-000000000304", organization_id: ORG_ID, title_name: "Senior Product Designer" },
    { id: "00000000-0000-0000-0000-000000000305", organization_id: ORG_ID, title_name: "Full Stack Engineer" },
  ];
  await supabase.from("job_titles").upsert(jobTitles);

  // 5. Ensure Shift Templates exist
  const shifts = [
    {
      id: "00000000-0000-0000-0000-000000000401",
      organization_id: ORG_ID,
      name: "Standard Day Shift",
      code: "DAY-STD",
      start_time: "09:00:00",
      end_time: "17:00:00",
      break_minutes: 60,
      grace_minutes: 15,
    },
    {
      id: "00000000-0000-0000-0000-000000000402",
      organization_id: ORG_ID,
      name: "Night Operations Shift",
      code: "NIGHT-OPS",
      start_time: "20:00:00",
      end_time: "04:00:00",
      break_minutes: 60,
      grace_minutes: 15,
    },
  ];
  await supabase.from("shift_templates").upsert(shifts);

  // 6. Ensure Core Role Users exist
  const coreUsers = [
    {
      id: "00000000-0000-0000-0000-000000000010",
      email: "admin@remotehr.io",
      role: "admin",
      name: "James Aathithyan",
      deptId: departments[0].id,
      titleId: jobTitles[0].id,
      locId: locations[0].id,
    },
    {
      id: "00000000-0000-0000-0000-000000000020",
      email: "hr@remotehr.io",
      role: "hr",
      name: "Sarah Jenkins",
      deptId: departments[1].id,
      titleId: jobTitles[1].id,
      locId: locations[1].id,
    },
    {
      id: "00000000-0000-0000-0000-000000000030",
      email: "manager@remotehr.io",
      role: "manager",
      name: "David Chen",
      deptId: departments[0].id,
      titleId: jobTitles[2].id,
      locId: locations[0].id,
    },
    {
      id: "00000000-0000-0000-0000-000000000040",
      email: "employee@remotehr.io",
      role: "employee",
      name: "Maya Patel",
      deptId: departments[2].id,
      titleId: jobTitles[3].id,
      locId: locations[0].id,
      managerId: "00000000-0000-0000-0000-000000000030",
    },
  ];

  for (const u of coreUsers) {
    // Upsert Auth user
    const { data: existingUser } = await supabase.auth.admin.getUserById(u.id);
    if (!existingUser?.user) {
      await supabase.auth.admin.createUser({
        id: u.id,
        email: u.email,
        password: PASSWORD,
        email_confirm: true,
        user_metadata: { user_role: u.role, full_name: u.name },
        app_metadata: { user_role: u.role },
      });
    } else {
      await supabase.auth.admin.updateUserById(u.id, {
        password: PASSWORD,
        user_metadata: { user_role: u.role, full_name: u.name },
        app_metadata: { user_role: u.role },
      });
    }

    // Upsert Employee profile
    await supabase.from("employees").upsert({
      id: u.id,
      organization_id: ORG_ID,
      full_name: u.name,
      email: u.email,
      department_id: u.deptId,
      job_title_id: u.titleId,
      primary_location_id: u.locId,
      manager_id: u.managerId || null,
      status: "active",
      timezone: "America/Los_Angeles",
      work_mode: "hybrid",
      work_target_minutes: 480,
      shift_start_time: "09:00:00",
      shift_end_time: "17:00:00",
    });

    // Upsert Organization Member
    await supabase.from("organization_members").upsert({
      user_id: u.id,
      organization_id: ORG_ID,
      role: u.role,
      status: "active",
      department_id: u.deptId,
      job_title_id: u.titleId,
      shift_start_time: "09:00:00",
      shift_end_time: "17:00:00",
    });
  }

  // 7. Ensure Leave Types exist
  const leaveTypes = [
    { id: "00000000-0000-0000-0000-000000000501", organization_id: ORG_ID, name: "Casual Leave", code: "CL", is_paid: true, is_active: true },
    { id: "00000000-0000-0000-0000-000000000502", organization_id: ORG_ID, name: "Sick Leave", code: "SL", is_paid: true, is_active: true },
    { id: "00000000-0000-0000-0000-000000000503", organization_id: ORG_ID, name: "Privilege Leave", code: "PL", is_paid: true, is_active: true },
  ];
  await supabase.from("leave_types").upsert(leaveTypes);

  // 8. Ensure Leave Balances for Current Period
  const curYear = new Date().getFullYear();
  const periodStart = `${curYear}-01-01`;
  const periodEnd = `${curYear}-12-31`;

  for (const u of coreUsers) {
    for (const lt of leaveTypes) {
      await supabase.from("leave_balances").upsert({
        organization_id: ORG_ID,
        employee_id: u.id,
        leave_type_id: lt.id,
        allocated: lt.code === "PL" ? 18 : 12,
        used: 1,
        carried_forward: 0,
        adjusted: 0,
        period_start: periodStart,
        period_end: periodEnd,
      }, { onConflict: "organization_id,employee_id,leave_type_id,period_start,period_end" });
    }
  }

  // 9. Leave Requests in every status
  const nowIso = new Date().toISOString();
  const todayStr = new Date().toISOString().slice(0, 10);
  const sampleRequests = [
    {
      id: "00000000-0000-0000-0000-000000000601",
      organization_id: ORG_ID,
      employee_id: coreUsers[3].id, // Maya
      leave_type_id: leaveTypes[0].id,
      start_date: todayStr,
      end_date: todayStr,
      day_part: "full",
      total_days: 1,
      reason: "Family personal engagement",
      status: "pending",
      created_at: nowIso,
    },
    {
      id: "00000000-0000-0000-0000-000000000602",
      organization_id: ORG_ID,
      employee_id: coreUsers[3].id,
      leave_type_id: leaveTypes[1].id,
      start_date: `${curYear}-02-10`,
      end_date: `${curYear}-02-10`,
      day_part: "first_half",
      total_days: 0.5,
      reason: "Annual health checkup",
      status: "approved",
      created_at: `${curYear}-02-09T09:00:00Z`,
    },
    {
      id: "00000000-0000-0000-0000-000000000603",
      organization_id: ORG_ID,
      employee_id: coreUsers[3].id,
      leave_type_id: leaveTypes[0].id,
      start_date: `${curYear}-03-01`,
      end_date: `${curYear}-03-02`,
      day_part: "full",
      total_days: 2,
      reason: "Overlapping team sprint deadline",
      status: "rejected",
      created_at: `${curYear}-02-20T10:00:00Z`,
    },
    {
      id: "00000000-0000-0000-0000-000000000604",
      organization_id: ORG_ID,
      employee_id: coreUsers[3].id,
      leave_type_id: leaveTypes[2].id,
      start_date: `${curYear}-04-15`,
      end_date: `${curYear}-04-16`,
      day_part: "full",
      total_days: 2,
      reason: "Trip rescheduled",
      status: "cancelled",
      created_at: `${curYear}-04-01T12:00:00Z`,
    },
  ];
  await supabase.from("leave_requests").upsert(sampleRequests);

  // 10. Attendance Day & Open Session for today
  await supabase.from("attendance_days").upsert({
    organization_id: ORG_ID,
    employee_id: coreUsers[3].id,
    work_date: todayStr,
    status: "present",
    total_minutes: 240,
    is_late: false,
    calculated_at: nowIso,
  }, { onConflict: "organization_id,employee_id,work_date" });

  await supabase.from("attendance_sessions").upsert({
    id: "00000000-0000-0000-0000-000000000701",
    organization_id: ORG_ID,
    employee_id: coreUsers[3].id,
    work_date: todayStr,
    check_in_at: `${todayStr}T09:00:00Z`,
    check_out_at: null, // Active open session
    duration_minutes: 0,
    source: "web",
  });

  // 11. Print the clean Accounts Table
  console.log("\n=================================================================");
  console.log("   REMOTEEHR DEMO READY - ACCOUNTS MATRIX");
  console.log("=================================================================");
  console.log("| Role     | Email                | Password         | MFA Policy |");
  console.log("|----------|----------------------|------------------|------------|");
  console.log("| Admin    | admin@remotehr.io    | DemoPassword123! | Optional   |");
  console.log("| HR       | hr@remotehr.io       | DemoPassword123! | Optional   |");
  console.log("| Manager  | manager@remotehr.io  | DemoPassword123! | Optional   |");
  console.log("| Employee | employee@remotehr.io | DemoPassword123! | Optional   |");
  console.log("=================================================================\n");
}

if (process.argv[1]?.endsWith("seed-demo-data.ts") || process.argv[1]?.endsWith("seed-demo-data.js")) {
  seedDemoData().catch((err) => {
    console.error("Seeding failed:", err);
    process.exit(1);
  });
}
