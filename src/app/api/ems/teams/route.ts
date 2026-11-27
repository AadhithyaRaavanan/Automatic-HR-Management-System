import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { getAdminClient, supabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseAdminConfigError } from "@/lib/supabase/admin-config";
import { isDemoModeEnabled } from "@/lib/config/demo";
import {
  getStoredTeams,
  addStoredTeam,
  updateStoredTeam,
  deleteStoredTeam,
  getStoredUsers,
  getStoredDepartments,
} from "@/lib/storage/demo-store";
import { requireApprovedUser } from "@/features/auth/require-approved-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const approvedCheck = await requireApprovedUser(request);
  if ("response" in approvedCheck) {
    return approvedCheck.response;
  }
  try {
    const isDemo = isDemoModeEnabled();

    // Query real Supabase database
    const { data: dbTeams, error } = await (supabaseAdmin as any)
      .from("teams")
      .select(`
        *,
        departments:department_id(id, name, code),
        team_lead:team_lead_id(id, full_name, email),
        team_members(id, employee_id, employees:employee_id(id, full_name, email, employment_category))
      `)
      .order("created_at", { ascending: false });

    let teamsList = dbTeams || [];

    if ((!teamsList || teamsList.length === 0) && isDemo) {
      const stored = getStoredTeams();
      const users = getStoredUsers();
      const depts = getStoredDepartments();

      teamsList = stored.map((t: any) => {
        const lead = users.find((u) => u.id === (t.leadId || t.teamLeadId));
        const dept = depts.find((d) => d.id === (t.departmentId || t.deptId));
        return {
          id: t.id,
          name: t.name,
          code: t.code,
          department_id: t.departmentId || t.deptId,
          team_lead_id: t.leadId || t.teamLeadId,
          departments: dept ? { id: dept.id, name: dept.name, code: dept.code } : null,
          team_lead: lead ? { id: lead.id, full_name: lead.name, email: lead.email } : null,
          team_members: (t.memberIds || []).map((mid: string) => {
            const memberUser = users.find((u) => u.id === mid);
            return {
              id: mid,
              employee_id: mid,
              employees: memberUser
                ? {
                    id: mid,
                    full_name: memberUser.name,
                    email: memberUser.email,
                    employment_category: memberUser.employmentCategory || "full_time",
                  }
                : null,
            };
          }),
        };
      });
    }

    return NextResponse.json({ teams: teamsList });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch teams" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const { name, code, departmentId, teamLeadId, description, memberIds } = body;

    if (!name?.trim()) {
      return NextResponse.json({ error: "Team name is required" }, { status: 400 });
    }

    const { data: team, error } = await (supabaseAdmin as any)
      .from("teams")
      .insert({
        organization_id: context.organizationId,
        department_id: departmentId || null,
        name: name.trim(),
        code: code?.trim() || null,
        team_lead_id: teamLeadId || null,
        description: description?.trim() || null,
      })
      .select()
      .single();

    if (error && !isDemoModeEnabled()) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const newTeamId = team?.id || `team-${Date.now()}`;

    // Add members if provided
    if (memberIds && Array.isArray(memberIds) && memberIds.length > 0) {
      const inserts = memberIds.map((mid: string) => ({
        organization_id: context.organizationId,
        team_id: newTeamId,
        employee_id: mid,
      }));

      await (supabaseAdmin as any).from("team_members").insert(inserts);
    }

    if (isDemoModeEnabled()) {
      addStoredTeam({
        name,
        code: code || name.slice(0, 3).toUpperCase(),
        departmentId: departmentId || "",
        leadId: teamLeadId || "",
        memberIds: memberIds || [],
      });
    }

    return NextResponse.json({ success: true, team });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create team" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  const adminConfigError = getSupabaseAdminConfigError();
  if (adminConfigError) {
    return NextResponse.json({ error: adminConfigError }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    let id = searchParams.get("id")?.trim();
    if (!id) {
      const body = await request.json().catch(() => null);
      id = body?.id ? String(body.id).trim() : "";
    }

    if (!id) {
      return NextResponse.json({ error: "Validation Error: 'id' parameter is required." }, { status: 400 });
    }

    const adminClient = getAdminClient() as any;

    const { data: existing, error: findErr } = await adminClient
      .from("teams")
      .select("id, name, code, organization_id")
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (findErr && !isDemoModeEnabled()) {
      return NextResponse.json({ error: findErr.message }, { status: 400 });
    }

    if (!existing) {
      if (isDemoModeEnabled()) {
        deleteStoredTeam(id);
        revalidatePath("/ems");
        revalidatePath("/ems/teams");
        return NextResponse.json({ success: true, deletedId: id });
      }
      return NextResponse.json({ error: "Team not found in your organization." }, { status: 404 });
    }

    // 1. Delete team membership links cleanly before removing team record
    const { error: membersDelErr } = await adminClient
      .from("team_members")
      .delete()
      .eq("team_id", id);

    if (membersDelErr && !/does not exist|could not find the table/i.test(membersDelErr.message || "")) {
      return NextResponse.json(
        { error: `Failed to remove team memberships: ${membersDelErr.message}` },
        { status: 400 }
      );
    }

    // 2. Delete team row scoped to organization
    const { error: delErr } = await adminClient
      .from("teams")
      .delete()
      .eq("id", id)
      .eq("organization_id", context.organizationId);

    if (delErr) {
      return NextResponse.json({ error: delErr.message }, { status: 400 });
    }

    if (isDemoModeEnabled()) {
      deleteStoredTeam(id);
    }

    try {
      await adminClient.from("audit_logs").insert({
        organization_id: context.organizationId,
        actor_id: context.userId,
        action: "TEAM_DELETED",
        table_name: "teams",
        record_id: id,
        old_data: existing,
        new_data: null,
      });
    } catch {}

    revalidatePath("/ems");
    revalidatePath("/ems/teams");
    revalidatePath("/ems/employees");
    revalidatePath("/ems/organization");
    revalidatePath("/employees");

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "Failed to delete team" }, { status: 500 });
  }
}
