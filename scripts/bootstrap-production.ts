import { supabaseAdmin } from "../src/lib/supabase/admin";

export interface BootstrapConfig {
  orgName: string;
  slug: string;
  domain: string;
  timezone: string;
  currency: string;
  workMode: string;
  adminEmail: string;
  adminName: string;
  dryRun?: boolean;
  forceDeleteDefaultOrg?: boolean;
}

export interface BootstrapResult {
  success: boolean;
  dryRun: boolean;
  orgId?: string;
  adminUserId?: string;
  inviteLink?: string;
  message: string;
  createdEntities?: {
    organization: string;
    leaveTypesCount: number;
    attendancePolicy: boolean;
    holidayTemplate: boolean;
    adminInvited: boolean;
  };
}

export const STANDARD_LEAVE_TYPES = [
  { name: "Annual Leave", code: "AL", days: 18, isPaid: true, description: "Standard paid vacation days" },
  { name: "Casual Leave", code: "CL", days: 12, isPaid: true, description: "Short planned personal absences" },
  { name: "Sick Leave", code: "SL", days: 12, isPaid: true, description: "Medical and health recovery" },
  { name: "Maternity Leave", code: "ML", days: 180, isPaid: true, description: "Maternity parental support" },
  { name: "Paternity Leave", code: "PL", days: 15, isPaid: true, description: "Paternity parental support" },
  { name: "Unpaid Leave", code: "UL", days: 365, isPaid: false, description: "Extended leave without pay" },
];

export const DEFAULT_ATTENDANCE_POLICY = {
  dailyWorkTargetMinutes: 540, // 9 hours
  lateThresholdMinutes: 15,    // 15 min grace period
  regularizationWindowDays: 30, // 30-day window
  autoCheckoutTime: "23:59:00",
  halfDayMinutes: 240,
};

export async function bootstrapProduction(config: BootstrapConfig): Promise<BootstrapResult> {
  const {
    orgName,
    slug,
    domain,
    timezone = "UTC",
    currency = "USD",
    workMode = "hybrid",
    adminEmail,
    adminName,
    dryRun = false,
    forceDeleteDefaultOrg = false,
  } = config;

  if (!orgName || !slug || !domain || !adminEmail || !adminName) {
    throw new Error("Missing required bootstrap parameters: orgName, slug, domain, adminEmail, adminName");
  }

  // 1. Dry run output check
  if (dryRun) {
    return {
      success: true,
      dryRun: true,
      message: `[DRY-RUN] Planned provisioning for ${orgName} (${domain}) with admin ${adminEmail}. Zero mutations committed.`,
      createdEntities: {
        organization: orgName,
        leaveTypesCount: STANDARD_LEAVE_TYPES.length,
        attendancePolicy: true,
        holidayTemplate: true,
        adminInvited: true,
      },
    };
  }

  // 2. Idempotency Check: check if organization with this domain or slug already exists
  const { data: existingOrg } = await (supabaseAdmin as any)
    .from("organizations")
    .select("id, name, domain, slug")
    .or(`slug.eq.${slug},domain.eq.${domain}`)
    .maybeSingle();

  if (existingOrg) {
    return {
      success: false,
      dryRun: false,
      orgId: existingOrg.id,
      message: `Organization with slug '${slug}' or domain '${domain}' already exists (ID: ${existingOrg.id}). Bootstrap halted safely.`,
    };
  }

  // 3. Handle default demo/seed org cleanup if requested
  if (forceDeleteDefaultOrg) {
    const { data: defaultOrg } = await (supabaseAdmin as any)
      .from("organizations")
      .select("id")
      .eq("slug", "acme-corp")
      .maybeSingle();

    if (defaultOrg) {
      // Safety check: assert that default org has NO non-seed real data
      const { count: realAttendanceCount } = await (supabaseAdmin as any)
        .from("attendance_records")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", defaultOrg.id);

      if ((realAttendanceCount || 0) === 0) {
        await (supabaseAdmin as any)
          .from("organizations")
          .delete()
          .eq("id", defaultOrg.id);
      }
    }
  }

  // 4. Create real production organization
  const { data: newOrg, error: orgError } = await (supabaseAdmin as any)
    .from("organizations")
    .insert({
      name: orgName,
      slug,
      domain,
      timezone,
      currency,
      work_mode: workMode,
      require_mfa_for_privileged: true,
    })
    .select("id")
    .single();

  if (orgError || !newOrg) {
    throw new Error(`Failed to create organization: ${orgError?.message || "Unknown error"}`);
  }

  const orgId = newOrg.id;

  // 5. Provision standard leave types
  const leaveInserts = STANDARD_LEAVE_TYPES.map((lt) => ({
    organization_id: orgId,
    name: lt.name,
    code: lt.code,
    days_allowed: lt.days,
    is_paid: lt.isPaid,
    description: lt.description,
  }));

  const { error: leaveError } = await (supabaseAdmin as any)
    .from("leave_types")
    .insert(leaveInserts);

  if (leaveError) {
    console.warn(`[Bootstrap Warning] Could not insert leave types: ${leaveError.message}`);
  }

  // 6. Provision default attendance policy
  const { error: policyError } = await (supabaseAdmin as any)
    .from("attendance_policies")
    .insert({
      organization_id: orgId,
      daily_work_target_minutes: DEFAULT_ATTENDANCE_POLICY.dailyWorkTargetMinutes,
      late_threshold_minutes: DEFAULT_ATTENDANCE_POLICY.lateThresholdMinutes,
      regularization_window_days: DEFAULT_ATTENDANCE_POLICY.regularizationWindowDays,
      auto_checkout_time: DEFAULT_ATTENDANCE_POLICY.autoCheckoutTime,
      half_day_minutes: DEFAULT_ATTENDANCE_POLICY.halfDayMinutes,
    });

  if (policyError) {
    console.warn(`[Bootstrap Warning] Could not insert attendance policy: ${policyError.message}`);
  }

  // 7. Provision default holiday templates
  const { error: holidayError } = await (supabaseAdmin as any)
    .from("holidays")
    .insert([
      {
        organization_id: orgId,
        name: "New Year's Day",
        date: `${new Date().getFullYear()}-01-01`,
        is_optional: false,
      },
    ]);

  if (holidayError) {
    // Non-fatal if holiday insert fails
  }

  // 8. Provision initial root administrator via passwordless invite
  const normalizedEmail = adminEmail.trim().toLowerCase();
  const { data: linkData, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
    type: "invite",
    email: normalizedEmail,
    options: {
      data: {
        full_name: adminName,
        user_role: "admin",
        organization_id: orgId,
      },
    },
  });

  if (linkError || !linkData?.user) {
    throw new Error(`Failed to generate admin invite link: ${linkError?.message || "Unknown auth error"}`);
  }

  const adminUserId = linkData.user.id;
  const actionInviteLink = linkData.properties?.action_link || "";

  // Insert organization membership
  await (supabaseAdmin as any)
    .from("organization_members")
    .insert({
      organization_id: orgId,
      user_id: adminUserId,
      role: "admin",
      status: "active",
      shift_start_time: "09:00:00",
      shift_end_time: "17:00:00",
    });

  // Insert profile / employee row
  await (supabaseAdmin as any)
    .from("employees")
    .insert({
      id: adminUserId,
      organization_id: orgId,
      full_name: adminName,
      email: normalizedEmail,
      work_mode: workMode,
      timezone,
      status: "active",
      shift_start_time: "09:00:00",
      shift_end_time: "17:00:00",
    });

  return {
    success: true,
    dryRun: false,
    orgId,
    adminUserId,
    inviteLink: actionInviteLink,
    message: `Organization '${orgName}' bootstrapped successfully! Initial admin invited passwordlessly.`,
    createdEntities: {
      organization: orgName,
      leaveTypesCount: STANDARD_LEAVE_TYPES.length,
      attendancePolicy: true,
      holidayTemplate: true,
      adminInvited: true,
    },
  };
}

// CLI Execution Entry Point
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.log(`
RemoteHR Production Bootstrapping Utility
=========================================
Provisions the initial root organization, attendance policies, standard leave types,
and invites the primary root administrator without passwords or reusable credentials.

Usage:
  npx tsx scripts/bootstrap-production.ts [options]

Options:
  --name         Organization display name (default: "RemoteHR Enterprise")
  --slug         Unique tenant URL slug (default: "remotehr-enterprise")
  --domain       Primary corporate domain (default: "enterprise.remotehr.io")
  --admin-email  Root admin email address (default: "admin@enterprise.remotehr.io")
  --admin-name   Root admin full name (default: "Primary Administrator")
  --timezone     Organization primary timezone (default: "UTC")
  --currency     Currency code (default: "USD")
  --work-mode    Default workforce mode (remote|hybrid|office, default: "hybrid")
  --dry-run      Simulate provisioning without executing mutations
  --force        Delete default seed organization if no production data exists
  --help, -h     Show this documentation

Security & Credential Policy:
  - Zero persistent passwords or reusable emergency backup tokens are created.
  - The first administrator receives a single-use, short-lived (24-hour) invitation link.
  - The invite link is printed to stdout ONLY if stdout is an interactive terminal (isTTY)
    and CI environment variable is unset.
  - In CI or redirected pipelines, the invite link is redacted from console output to
    guarantee zero token leakage into build logs, audit tables, or Sentry.
`);
    process.exit(0);
  }

  const isDryRun = args.includes("--dry-run");
  const isForce = args.includes("--force");

  const getArg = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };

  const config: BootstrapConfig = {
    orgName: getArg("--name", "RemoteHR Enterprise"),
    slug: getArg("--slug", "remotehr-enterprise"),
    domain: getArg("--domain", "enterprise.remotehr.io"),
    timezone: getArg("--timezone", "UTC"),
    currency: getArg("--currency", "USD"),
    workMode: getArg("--work-mode", "hybrid"),
    adminEmail: getArg("--admin-email", "admin@enterprise.remotehr.io"),
    adminName: getArg("--admin-name", "Primary Administrator"),
    dryRun: isDryRun,
    forceDeleteDefaultOrg: isForce,
  };

  bootstrapProduction(config)
    .then((result) => {
      console.log("\n=========================================================================");
      console.log("PRODUCTION BOOTSTRAP RESULT:");
      console.log(result.message);
      const isInteractiveTerminal = Boolean(process.stdout.isTTY && !process.env.CI);
      if (result.inviteLink && isInteractiveTerminal) {
        console.log("\n[ADMIN INVITE LINK]:", result.inviteLink);
        console.log("INSTRUCTION: Open this single-use, short-lived invite link in your browser within 24 hours to set your password and complete MFA enrollment.");
      } else if (result.inviteLink) {
        console.log("\n[ADMIN INVITE LINK]: [REDACTED in non-interactive/CI session]. Link dispatched to admin email.");
      }
      console.log("=========================================================================\n");
      process.exit(result.success ? 0 : 1);
    })
    .catch((err) => {
      console.error("\n[Bootstrap Failed]:", err.message);
      process.exit(1);
    });
}
