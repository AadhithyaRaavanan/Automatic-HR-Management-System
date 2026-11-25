import { NextRequest, NextResponse } from "next/server";
import { requireApprovedUser } from "@/features/auth/require-approved-user";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApprovedUser(request);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { employee, user, role } = authResult;
    const orgId = employee?.organization_id || user?.user_metadata?.organization_id;
    if (!orgId) return NextResponse.json({ recurrences: [] });

    let query = (supabaseAdmin as any)
      .from("task_recurrences")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });

    // Non-HR/admin only see their own recurrences
    if (!["admin", "hr"].includes(role)) {
      query = query.eq("created_by", user.id);
    }

    const { data, error } = await query;
    if (error) {
      // Return empty array if table not yet migrated
      return NextResponse.json({ recurrences: [] });
    }

    return NextResponse.json({ recurrences: data || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch recurrences" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireApprovedUser(request);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { employee, user } = authResult;
    const orgId = employee?.organization_id || user?.user_metadata?.organization_id;
    const body = await request.json().catch(() => ({}));

    const {
      task_type_id,
      title,
      description,
      priority = "medium",
      estimate_minutes,
      assignee_id,
      frequency,
      interval_n = 1,
      weekday,
      day_of_month,
      next_run_date,
      end_date,
    } = body;

    if (!title || title.trim().length < 2) {
      return NextResponse.json({ error: "Title must be at least 2 characters." }, { status: 400 });
    }

    if (!["daily", "weekly", "monthly", "every_n_working_days"].includes(frequency)) {
      return NextResponse.json({ error: "Invalid recurrence frequency." }, { status: 400 });
    }

    const { data: rec, error } = await (supabaseAdmin as any)
      .from("task_recurrences")
      .insert({
        organization_id: orgId,
        task_type_id: task_type_id || null,
        title: title.trim(),
        description: description ? String(description).trim() : null,
        priority: ["low", "medium", "high", "urgent"].includes(priority) ? priority : "medium",
        estimate_minutes: typeof estimate_minutes === "number" ? estimate_minutes : null,
        assignee_id: assignee_id || null,
        created_by: user.id,
        frequency,
        interval_n: Math.max(1, Number(interval_n) || 1),
        weekday: weekday !== undefined && weekday !== null ? Number(weekday) : null,
        day_of_month: day_of_month !== undefined && day_of_month !== null ? Number(day_of_month) : null,
        next_run_date: next_run_date || new Date().toISOString().slice(0, 10),
        end_date: end_date || null,
        is_active: true,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ recurrence: rec }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create recurrence" },
      { status: 500 }
    );
  }
}
