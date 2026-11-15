import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { isDemoModeEnabled } from "@/lib/config/demo";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    let orgId: string | null = null;
    const { data: member, error: memberErr } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id, status")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (member?.organization_id) {
      orgId = member.organization_id;
    } else if (isDemoModeEnabled()) {
      orgId = "00000000-0000-0000-0000-000000000001";
    }

    if (!orgId) {
      return NextResponse.json({ error: "Forbidden: Active organization membership required." }, { status: 403 });
    }

    const { data: titles, error: titlesErr } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, title_name, description, created_at, updated_at")
      .eq("organization_id", orgId)
      .order("title_name");

    if (titlesErr && !isDemoModeEnabled()) {
      return NextResponse.json({ error: titlesErr.message }, { status: 400 });
    }

    return NextResponse.json({ titles: titles || [] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to fetch job titles" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const { titleName, description } = body;

    const trimmedName = String(titleName || "").trim();
    if (!trimmedName) {
      return NextResponse.json({ error: "Validation Error: 'titleName' is required." }, { status: 400 });
    }

    const { data: created, error: insertErr } = await (supabaseAdmin as any)
      .from("job_titles")
      .insert({
        organization_id: context.organizationId,
        title_name: trimmedName,
        description: description ? String(description).trim() : null,
      })
      .select("id, title_name, description, created_at")
      .single();

    if (insertErr) {
      if (insertErr.code === "23505" || insertErr.message.includes("unique")) {
        return NextResponse.json(
          { error: `Job title '${trimmedName}' already exists in your company.` },
          { status: 409 }
        );
      }
      if (isDemoModeEnabled()) {
        const mockCreated = {
          id: `jt-${Date.now()}`,
          title_name: trimmedName,
          description: description ? String(description).trim() : null,
          created_at: new Date().toISOString(),
        };
        return NextResponse.json({ success: true, jobTitle: mockCreated }, { status: 201 });
      }
      return NextResponse.json({ error: insertErr.message }, { status: 400 });
    }

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "JOB_TITLE_CREATED",
      table_name: "job_titles",
      record_id: (created as any).id,
      old_data: null,
      new_data: created,
    });

    return NextResponse.json({ success: true, jobTitle: created }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to create job title" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const { id, titleName, description } = body;

    if (!id) {
      return NextResponse.json({ error: "Validation Error: 'id' is required." }, { status: 400 });
    }

    const trimmedName = String(titleName || "").trim();
    if (!trimmedName) {
      return NextResponse.json({ error: "Validation Error: 'titleName' cannot be empty." }, { status: 400 });
    }

    const { data: existing, error: findErr } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, organization_id, title_name, description")
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (findErr || !existing) {
      return NextResponse.json({ error: "Job title not found in your organization." }, { status: 404 });
    }

    const { data: updated, error: updateErr } = await (supabaseAdmin as any)
      .from("job_titles")
      .update({
        title_name: trimmedName,
        description: description !== undefined ? (description ? String(description).trim() : null) : (existing as any).description,
        updated_at: new Date().toISOString(),
      })
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .select("id, title_name, description, updated_at")
      .single();

    if (updateErr) {
      if (isDemoModeEnabled()) {
        const mockUpdated = {
          id,
          title_name: trimmedName,
          description: description !== undefined ? (description ? String(description).trim() : null) : null,
          updated_at: new Date().toISOString(),
        };
        return NextResponse.json({ success: true, jobTitle: mockUpdated });
      }
      return NextResponse.json({ error: updateErr.message }, { status: 400 });
    }

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "JOB_TITLE_UPDATED",
      table_name: "job_titles",
      record_id: id,
      old_data: existing,
      new_data: updated,
    });

    return NextResponse.json({ success: true, jobTitle: updated });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update job title" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Validation Error: 'id' parameter is required." }, { status: 400 });
    }

    const { data: existing, error: findErr } = await (supabaseAdmin as any)
      .from("job_titles")
      .select("id, title_name, organization_id")
      .eq("id", id)
      .eq("organization_id", context.organizationId)
      .maybeSingle();

    if (findErr || !existing) {
      if (isDemoModeEnabled()) {
        return NextResponse.json({ success: true, deletedId: id });
      }
      return NextResponse.json({ error: "Job title not found in your organization." }, { status: 404 });
    }

    const { error: deleteErr } = await (supabaseAdmin as any)
      .from("job_titles")
      .delete()
      .eq("id", id)
      .eq("organization_id", context.organizationId);

    if (deleteErr) {
      if (isDemoModeEnabled()) {
        return NextResponse.json({ success: true, deletedId: id });
      }
      return NextResponse.json({ error: deleteErr.message }, { status: 400 });
    }

    await supabaseAdmin.from("audit_logs").insert({
      organization_id: context.organizationId,
      actor_id: context.userId,
      action: "JOB_TITLE_DELETED",
      table_name: "job_titles",
      record_id: id,
      old_data: existing,
      new_data: null,
    });

    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to delete job title" }, { status: 500 });
  }
}
