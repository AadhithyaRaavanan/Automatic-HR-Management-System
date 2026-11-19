import { NextRequest, NextResponse } from "next/server";
import { requireApprovedUser } from "@/lib/auth/require-approved-user";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { STARTER_TASK_TYPES, TaskType } from "@/lib/tasks/types";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireApprovedUser(request);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { employee, user, role } = authResult;
    const orgId = employee?.organization_id || user?.user_metadata?.organization_id;

    if (!orgId) {
      return NextResponse.json({ types: [] });
    }

    const showAll = request.nextUrl.searchParams.get("all") === "true";
    const canViewAll = ["admin", "hr"].includes(role);

    // Query task types from database
    let query = (supabaseAdmin as any)
      .from("task_types")
      .select("*")
      .eq("organization_id", orgId)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (!showAll || !canViewAll) {
      query = query.eq("is_active", true);
    }

    const { data, error } = await query;

    if (!error && Array.isArray(data) && data.length > 0) {
      return NextResponse.json({ types: data });
    }

    // If table is empty or pending migration, return mapped starter types
    // Fetch departments to link department_id dynamically
    const { data: depts } = await (supabaseAdmin.from("departments") as any)
      .select("id, name")
      .eq("organization_id", orgId);

    const techDept = depts?.find((d: any) => /tech|technology/i.test(d.name))?.id || null;
    const hrDept = depts?.find((d: any) => /human resources|hr/i.test(d.name))?.id || null;

    const fallbackTypes: TaskType[] = STARTER_TASK_TYPES.map((st, idx) => {
      let deptId = null;
      if (idx < 6) deptId = techDept;
      else if (idx < 11) deptId = hrDept;

      return {
        ...st,
        id: `starter-${idx + 1}`,
        organization_id: orgId,
        department_id: deptId,
      };
    });

    return NextResponse.json({ types: fallbackTypes });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch task types" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { context } = authResult;
    const body = await request.json().catch(() => ({}));
    const {
      name,
      department_id,
      default_priority = "medium",
      default_estimate_minutes,
      due_rule_working_days,
      description_template,
      checklist,
      sort_order = 0,
    } = body;

    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName || trimmedName.length < 1) {
      return NextResponse.json(
        { error: "Task type name is required." },
        { status: 400 }
      );
    }

    const priority = ["low", "medium", "high", "urgent"].includes(default_priority)
      ? default_priority
      : "medium";

    let estimateMinutes: number | null = null;
    if (default_estimate_minutes !== undefined && default_estimate_minutes !== null && default_estimate_minutes !== "") {
      const parsed = Number(default_estimate_minutes);
      if (isNaN(parsed) || parsed < 1 || parsed > 1440) {
        return NextResponse.json(
          { error: "Default estimate must be between 1 and 1440 minutes (up to 24 hours)." },
          { status: 400 }
        );
      }
      estimateMinutes = Math.round(parsed);
    }

    let dueRuleWorkingDays: number | null = null;
    if (due_rule_working_days !== undefined && due_rule_working_days !== null && due_rule_working_days !== "") {
      const parsed = Number(due_rule_working_days);
      if (isNaN(parsed) || parsed < 0 || parsed > 30) {
        return NextResponse.json(
          { error: "Due date rule must be between 0 and 30 working days." },
          { status: 400 }
        );
      }
      dueRuleWorkingDays = Math.round(parsed);
    }

    const cleanChecklist = Array.isArray(checklist)
      ? checklist.filter((item: any) => typeof item === "string" && item.trim().length > 0).map((s: any) => s.trim())
      : [];

    const { data: newType, error } = await (supabaseAdmin as any)
      .from("task_types")
      .insert({
        organization_id: context.organizationId,
        department_id: department_id || null,
        name: trimmedName,
        default_priority: priority,
        default_estimate_minutes: estimateMinutes,
        due_rule_working_days: dueRuleWorkingDays,
        description_template: description_template ? String(description_template).trim() : null,
        checklist: cleanChecklist,
        sort_order: typeof sort_order === "number" ? sort_order : 0,
        is_active: true,
        created_by: context.userId,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({ type: newType }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to create task type" },
      { status: 500 }
    );
  }
}
