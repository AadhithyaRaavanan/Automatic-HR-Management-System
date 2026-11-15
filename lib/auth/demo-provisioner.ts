import "server-only";
import { getAdminClient } from "@/lib/supabase/admin";

interface DemoAccountConfig {
  id: string;
  name: string;
  email: string;
  role: "admin" | "hr" | "manager" | "employee";
}

export const DEMO_ACCOUNTS: Record<string, DemoAccountConfig> = {
  "admin@remotehr.io": {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Sarah Connor",
    email: "admin@remotehr.io",
    role: "admin",
  },
  "hr@remotehr.io": {
    id: "00000000-0000-0000-0000-000000000002",
    name: "Marcus Vance",
    email: "hr@remotehr.io",
    role: "hr",
  },
  "manager@remotehr.io": {
    id: "00000000-0000-0000-0000-000000000003",
    name: "Alex Morgan",
    email: "manager@remotehr.io",
    role: "manager",
  },
  "employee@remotehr.io": {
    id: "00000000-0000-0000-0000-000000000004",
    name: "James Sullivan",
    email: "employee@remotehr.io",
    role: "employee",
  },
};

/**
 * Ensures demo user, company organization, and memberships exist in Supabase.
 * Automatically called when demo mode is active and a demo preset is clicked.
 */
export async function ensureDemoAccount(emailInput: string): Promise<boolean> {
  const account = DEMO_ACCOUNTS[emailInput.toLowerCase().trim()];
  if (!account) return false;

  const admin = getAdminClient();
  const orgId = "00000000-0000-0000-0000-000000000001";

  try {
    // 1. Ensure Organization exists
    await admin.from("organizations").upsert({
      id: orgId,
      name: "Acme Corp",
      slug: "acme-corp",
      work_mode: "hybrid",
      timezone: "UTC",
      require_mfa_for_privileged: false,
    } as any);

    // 2. Check if user exists in auth.users
    const { data: usersData } = await admin.auth.admin.listUsers();
    const existingUser = usersData?.users?.find(
      (u) => u.email?.toLowerCase() === account.email.toLowerCase()
    );

    let userId = existingUser?.id;

    if (!existingUser) {
      const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
        email: account.email,
        password: "DemoPassword123!",
        email_confirm: true,
        user_metadata: { full_name: account.name },
        app_metadata: {
          provider: "email",
          providers: ["email"],
          user_role: account.role,
        },
      });
      if (createErr) {
        console.error("[DemoProvisioner] admin.createUser failed:", createErr);
        return false;
      }
      userId = newUser?.user?.id;
    } else {
      // Update password to ensure it matches DemoPassword123!
      await admin.auth.admin.updateUserById(existingUser.id, {
        password: "DemoPassword123!",
        email_confirm: true,
        app_metadata: {
          ...existingUser.app_metadata,
          user_role: account.role,
        },
      });
    }

    if (!userId) return false;

    // 3. Ensure employee record exists
    await admin.from("employees").upsert({
      id: userId,
      full_name: account.name,
      email: account.email,
      timezone: "UTC",
      work_target_minutes: 480,
      status: "active",
    } as any);

    // 4. Ensure organization_members record exists
    await admin.from("organization_members").upsert({
      organization_id: orgId,
      user_id: userId,
      role: account.role,
      status: "active",
      shift_start_time: "09:00:00",
      shift_end_time: "17:00:00",
    } as any);

    return true;
  } catch (err) {
    console.error("[DemoProvisioner] Exception while ensuring demo account:", err);
    return false;
  }
}
