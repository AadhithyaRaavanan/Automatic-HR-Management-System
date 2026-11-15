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

  // 2. Clear any lingering dummy requests and attendance sessions for clean slate
  await supabase.from("attendance_sessions").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("attendance_days").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("leave_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await supabase.from("regularization_requests").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // 3. Ensure Core Role Users exist (with unassigned departments and locations for clean user creation)
  const coreUsers = [
    {
      id: "00000000-0000-0000-0000-000000000010",
      email: "admin@remotehr.io",
      role: "admin",
      name: "James Aathithyan",
      deptId: null,
      titleId: null,
      locId: null,
    },
    {
      id: "00000000-0000-0000-0000-000000000020",
      email: "hr@remotehr.io",
      role: "hr",
      name: "Sarah Jenkins",
      deptId: null,
      titleId: null,
      locId: null,
    },
    {
      id: "00000000-0000-0000-0000-000000000030",
      email: "manager@remotehr.io",
      role: "manager",
      name: "David Chen",
      deptId: null,
      titleId: null,
      locId: null,
    },
    {
      id: "00000000-0000-0000-0000-000000000040",
      email: "employee@remotehr.io",
      role: "employee",
      name: "Maya Patel",
      deptId: null,
      titleId: null,
      locId: null,
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

    // Upsert Employee profile (unassigned until user configures in UI)
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

  // 4. Ensure Leave Types exist
  const leaveTypes = [
    { id: "00000000-0000-0000-0000-000000000501", organization_id: ORG_ID, name: "Casual Leave", code: "CL", is_paid: true, is_active: true },
    { id: "00000000-0000-0000-0000-000000000502", organization_id: ORG_ID, name: "Sick Leave", code: "SL", is_paid: true, is_active: true },
    { id: "00000000-0000-0000-0000-000000000503", organization_id: ORG_ID, name: "Privilege Leave", code: "PL", is_paid: true, is_active: true },
  ];
  await supabase.from("leave_types").upsert(leaveTypes);

  // 5. Ensure Leave Balances for Current Period (Clean: used = 0)
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
        used: 0,
        carried_forward: 0,
        adjusted: 0,
        period_start: periodStart,
        period_end: periodEnd,
      }, { onConflict: "organization_id,employee_id,leave_type_id,period_start,period_end" });
    }
  }

  // Clean slate: No fake leave requests or fake attendance days pre-seeded.
  // The user can create, submit, and approve their own requests in real-time.

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
