// ============================================================================
// /api/kpi/goals: Performance Goals Management
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { notify } from "@/lib/notifications/notify";
import { getManagersOf } from "@/lib/notifications/recipients";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/lib/kpi/auth-helper";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const targetEmployeeId = searchParams.get("employee_id") || caller.userId;

  const isAllowed = await verifyEmployeeAccess(caller, targetEmployeeId);
  if (!isAllowed) {
    return NextResponse.json({ error: "Forbidden: Access denied to target employee goals" }, { status: 403 });
  }

  const { data: goals, error } = await (supabaseAdmin as any)
    .from("kpi_goals")
    .select("id, employee_id, set_by, period_start, period_end, title, status, note, updated_at")
    .eq("employee_id", targetEmployeeId)
    .order("period_start", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (!goals || goals.length === 0) {
    return NextResponse.json({ goals: [] });
  }

  // Count linked tasks from tasks table for each goal
  try {
    const goalIds = goals.map((g: any) => g.id);
    const { data: linkedTasks } = await (supabaseAdmin as any)
      .from("tasks")
      .select("id, goal_id, status")
      .in("goal_id", goalIds);

    const countsByGoal: Record<string, { total: number; done: number }> = {};
    for (const t of linkedTasks || []) {
      if (!t.goal_id) continue;
      if (!countsByGoal[t.goal_id]) countsByGoal[t.goal_id] = { total: 0, done: 0 };
      countsByGoal[t.goal_id].total++;
      if (t.status === "done") {
        countsByGoal[t.goal_id].done++;
      }
    }

    const enhancedGoals = goals.map((g: any) => ({
      ...g,
      linked_tasks_total: countsByGoal[g.id]?.total || 0,
      linked_tasks_done: countsByGoal[g.id]?.done || 0,
    }));

    return NextResponse.json({ goals: enhancedGoals });
  } catch {
    return NextResponse.json({ goals });
  }
}

export async function POST(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (caller.role === "employee") {
    return NextResponse.json({ error: "Forbidden: Only managers and HR can assign KPI goals" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { employee_id, period_start, period_end, title, note } = body;

    if (!employee_id || !title?.trim()) {
      return NextResponse.json({ error: "employee_id and title are required" }, { status: 400 });
    }

    const isAllowed = await verifyEmployeeAccess(caller, employee_id);
    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden: Employee is outside your management scope" }, { status: 403 });
    }

    const { data: newGoal, error } = await (supabaseAdmin as any)
      .from("kpi_goals")
      .insert({
        employee_id,
        set_by: caller.userId,
        period_start: period_start || new Date().toISOString().slice(0, 10),
        period_end: period_end || new Date().toISOString().slice(0, 10),
        title: title.trim(),
        status: "not_started",
        note: note ? note.trim() : null,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (FEATURES.KPI && employee_id) {
      try {
        await notify({
          userIds: [employee_id],
          type: "kpi_goal_created",
          typeGroup: "kpi",
          title: "New Performance Goal Created",
          body: `A new performance goal has been assigned to you: "${title.trim()}".`,
          link: "/kpi",
          entityType: "kpi_goals",
          entityId: newGoal?.id,
          actorId: caller.userId,
        });
      } catch {}
    }

    return NextResponse.json({ success: true, goal: newGoal }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Invalid goal payload" }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { id, status, note } = body;

    if (!id) {
      return NextResponse.json({ error: "Goal id is required" }, { status: 400 });
    }

    // Verify existing goal
    const { data: existingGoal } = await (supabaseAdmin as any)
      .from("kpi_goals")
      .select("id, employee_id")
      .eq("id", id)
      .maybeSingle();

    if (!existingGoal) {
      return NextResponse.json({ error: "Goal not found" }, { status: 404 });
    }

    // Employee can update their own goal; managers/HR/admin can update scoped goals
    const isAllowed =
      caller.userId === existingGoal.employee_id ||
      (await verifyEmployeeAccess(caller, existingGoal.employee_id));

    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden: Cannot update this goal" }, { status: 403 });
    }

    const updateData: Record<string, any> = { updated_at: new Date().toISOString() };
    if (status && ["not_started", "on_track", "at_risk", "done"].includes(status)) {
      updateData.status = status;
    }
    if (note !== undefined) {
      updateData.note = note ? note.trim() : null;
    }

    const { data: updatedGoal, error } = await (supabaseAdmin as any)
      .from("kpi_goals")
      .update(updateData)
      .eq("id", id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (FEATURES.KPI && status === "at_risk") {
      try {
        const managers = await getManagersOf(existingGoal.employee_id);
        if (managers.length > 0) {
          await notify({
            userIds: managers,
            type: "kpi_goal_at_risk",
            typeGroup: "kpi",
            title: "Performance Goal At Risk",
            body: `Goal "${updatedGoal.title || "Goal"}" has been marked as At Risk.`,
            link: `/kpi?employee_id=${existingGoal.employee_id}`,
            entityType: "kpi_goals",
            entityId: id,
            actorId: caller.userId,
          });
        }
      } catch {}
    }

    return NextResponse.json({ success: true, goal: updatedGoal });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Invalid update payload" }, { status: 400 });
  }
}
