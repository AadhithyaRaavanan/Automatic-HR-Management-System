// ============================================================================
// /api/kpi/self-reviews: Self-Review Reflections for Evaluation Periods
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext, verifyEmployeeAccess } from "@/features/kpi/auth-helper";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";
import { getManagersOf } from "@/features/notifications/recipients";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const employeeId = searchParams.get("employee_id") || caller.userId;
  const periodStart = searchParams.get("period_start");
  const periodEnd = searchParams.get("period_end");
  const periodType = searchParams.get("period_type") || "monthly";

  const isAllowed = await verifyEmployeeAccess(caller, employeeId);
  if (!isAllowed) {
    return NextResponse.json(
      { error: "Forbidden: You do not have access to view this employee's self-review" },
      { status: 403 }
    );
  }

  try {
    let query = (supabaseAdmin as any)
      .from("kpi_self_reviews")
      .select("id, employee_id, period_type, period_start, period_end, reflection, created_at, updated_at")
      .eq("employee_id", employeeId);

    if (periodStart && periodEnd) {
      query = query
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd);
    }
    if (periodType) {
      query = query.eq("period_type", periodType);
    }

    const { data: selfReview, error } = await query
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Check if manager review exists for this period
    let hasManagerReview = false;
    if (periodStart && periodEnd) {
      const { data: managerReview } = await (supabaseAdmin as any)
        .from("kpi_reviews")
        .select("id")
        .eq("employee_id", employeeId)
        .eq("period_start", periodStart)
        .eq("period_end", periodEnd)
        .limit(1)
        .maybeSingle();

      hasManagerReview = Boolean(managerReview);
    }

    return NextResponse.json({
      selfReview: selfReview || null,
      canEdit: !hasManagerReview && caller.userId === employeeId,
      hasManagerReview,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load self-review" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await request.json();
    const { period_start, period_end, period_type = "monthly", reflection } = body;

    if (!period_start || !period_end) {
      return NextResponse.json({ error: "period_start and period_end are required" }, { status: 400 });
    }

    const trimmed = (reflection || "").trim();
    if (!trimmed || trimmed.length < 20) {
      return NextResponse.json(
        { error: "Reflection must be at least 20 characters in length." },
        { status: 400 }
      );
    }

    // Check if manager review exists for this period
    const { data: managerReview } = await (supabaseAdmin as any)
      .from("kpi_reviews")
      .select("id")
      .eq("employee_id", caller.userId)
      .eq("period_start", period_start)
      .eq("period_end", period_end)
      .limit(1)
      .maybeSingle();

    if (managerReview) {
      return NextResponse.json(
        { error: "Forbidden: Self-review cannot be modified once a manager evaluation has been created for this period." },
        { status: 400 }
      );
    }

    // Upsert self-review
    const { data: savedReview, error } = await (supabaseAdmin as any)
      .from("kpi_self_reviews")
      .upsert(
        {
          organization_id: caller.organizationId || "00000000-0000-0000-0000-000000000000",
          employee_id: caller.userId,
          period_type,
          period_start,
          period_end,
          reflection: trimmed,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "employee_id,period_start,period_end,period_type" }
      )
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Notify manager once
    try {
      const managerIds = await getManagersOf(caller.userId);
      if (managerIds.length > 0) {
        const { data: emp } = await (supabaseAdmin.from("employees") as any)
          .select("full_name")
          .eq("id", caller.userId)
          .maybeSingle();
        const employeeName = emp?.full_name || "Employee";

        await notify({
          userIds: managerIds,
          type: "kpi_self_review_submitted",
          typeGroup: "kpi",
          title: "Self-Review Added",
          body: `${employeeName} added a self-review`,
          link: `/kpi?employee_id=${caller.userId}`,
          entityType: "kpi_self_reviews",
          entityId: savedReview?.id,
          actorId: caller.userId,
        });
      }
    } catch {}

    return NextResponse.json({ success: true, selfReview: savedReview }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to submit self-review" }, { status: 400 });
  }
}
