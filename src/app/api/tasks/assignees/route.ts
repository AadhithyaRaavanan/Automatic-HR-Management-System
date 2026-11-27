import { NextRequest, NextResponse } from "next/server";
import { requireApprovedUser } from "@/features/auth/require-approved-user";
import { getAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import {
  sanitizeAndDedupeAssignees,
  type AssigneeCandidate,
} from "@/features/tasks/assignees";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function safeQuery<T = any>(promiseLike: PromiseLike<T>): Promise<T | null> {
  try {
    return await promiseLike;
  } catch {
    return null;
  }
}

function isMissingColumnOrRel(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || "");
  return (
    err.code === "PGRST204" ||
    err.code === "PGRST205" ||
    err.code === "42703" ||
    err.code === "42P01" ||
    /column .* does not exist|could not find|relationship|schema cache|does not exist/i.test(msg)
  );
}

/**
 * GET /api/tasks/assignees
 * Returns active, deduplicated real organization members eligible to appear in /tasks Assignee dropdowns.
 * Never falls back to hardcoded mock or demo-store placeholder users.
 */
export async function GET(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }

  const { user, supabase: callerSupabase, role: approvedRole } = approvedCheck;
  const adminConfigured = isSupabaseAdminConfigured();
  const dbClient: any = adminConfigured ? getAdminClient() : callerSupabase;

  const currentUserMetaName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    null;

  let orgId: string | null =
    (user?.app_metadata?.organization_id as string | undefined) ||
    (user?.user_metadata?.organization_id as string | undefined) ||
    null;

  let resolvedCallerRole: string = approvedRole || "employee";

  // Resolve active organization_id and role for the signed-in caller
  if (user?.id) {
    const memberRes: any = await safeQuery(
      dbClient
        .from("organization_members")
        .select("organization_id, role, status")
        .eq("user_id", user.id)
        .eq("status", "active")
        .maybeSingle()
    );
    if (memberRes?.data?.organization_id) {
      orgId = memberRes.data.organization_id;
    }
    if (memberRes?.data?.role) {
      resolvedCallerRole = String(memberRes.data.role).toLowerCase();
    }

    if (!orgId) {
      const selfEmpRes: any = await safeQuery(
        dbClient
          .from("employees")
          .select("organization_id")
          .eq("id", user.id)
          .maybeSingle()
      );
      if (selfEmpRes?.data?.organization_id) {
        orgId = selfEmpRes.data.organization_id;
      }
    }
  }

  // Query organization-scoped active employees with clean starter-schema fallback
  const fetchEmployeesWithClient = async (client: any) => {
    let query = client
      .from("employees")
      .select("id, organization_id, full_name, email, manager_id, status")
      .eq("status", "active")
      .order("full_name", { ascending: true });
    if (orgId) {
      query = query.eq("organization_id", orgId);
    }

    let res = await query;
    if (res?.error && isMissingColumnOrRel(res.error)) {
      res = await client
        .from("employees")
        .select("id, full_name, email, manager_id, status")
        .eq("status", "active")
        .order("full_name", { ascending: true });
    }
    return res;
  };

  let empRes: any = await fetchEmployeesWithClient(dbClient);
  if (empRes?.error && dbClient !== callerSupabase) {
    const callerRes: any = await fetchEmployeesWithClient(callerSupabase);
    if (!callerRes?.error) {
      empRes = callerRes;
    }
  }

  const metaClient = empRes?.error ? callerSupabase : dbClient;

  const orgMembersPromise = orgId
    ? metaClient
        .from("organization_members")
        .select("user_id, role, status")
        .eq("organization_id", orgId)
        .eq("status", "active")
    : metaClient
        .from("organization_members")
        .select("user_id, role, status")
        .eq("status", "active");

  const [orgMembersRes, userRolesRes] = await Promise.all([
    safeQuery(orgMembersPromise),
    safeQuery(metaClient.from("user_roles").select("user_id, role")),
  ]);

  const roleMap = new Map<string, string>();
  for (const m of orgMembersRes?.data || []) {
    if (m?.user_id && m?.role) {
      roleMap.set(m.user_id, String(m.role).toLowerCase());
    }
  }
  for (const ur of userRolesRes?.data || []) {
    if (ur?.user_id && ur?.role && !roleMap.has(ur.user_id)) {
      roleMap.set(ur.user_id, String(ur.role).toLowerCase());
    }
  }

  const rawRows: AssigneeCandidate[] = (empRes?.data || []).map((emp: any) => ({
    id: emp.id,
    full_name: emp.full_name || null,
    email: emp.email || "",
    manager_id: emp.manager_id || null,
    status: emp.status || "active",
    role: roleMap.get(emp.id) || "employee",
  }));

  // Include active organization_members missing an employees row (no fake fallbacks)
  if (adminConfigured && Array.isArray(orgMembersRes?.data)) {
    const existingIds = new Set(rawRows.map((r) => r.id));
    const missingMemberIds = (orgMembersRes.data as any[])
      .map((m) => m?.user_id)
      .filter((id): id is string => Boolean(id && !existingIds.has(id)));

    for (const memberId of missingMemberIds) {
      try {
        const authRes = await dbClient.auth.admin.getUserById(memberId);
        const authUser = authRes?.data?.user;
        if (!authUser) continue;
        rawRows.push({
          id: authUser.id,
          full_name:
            authUser.user_metadata?.full_name ||
            authUser.user_metadata?.name ||
            authUser.email?.split("@")[0] ||
            null,
          email: authUser.email || "",
          manager_id: null,
          status: "active",
          role: roleMap.get(authUser.id) || "employee",
        });
      } catch {}
    }
  }

  // Always include the signed-in caller so "You (<Name>)" is resolvable even on sparse schemas
  if (user?.id) {
    rawRows.push({
      id: user.id,
      full_name:
        currentUserMetaName || (user.email ? user.email.split("@")[0] : null),
      email: user.email || "",
      manager_id: null,
      status: "active",
      role: roleMap.get(user.id) || resolvedCallerRole,
    });
  }

  const assignees = sanitizeAndDedupeAssignees(rawRows, {
    userId: user?.id,
    email: user?.email,
    fullName: currentUserMetaName,
  });

  return NextResponse.json(
    { assignees },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    }
  );
}
