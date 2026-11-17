// ============================================================================
// /api/kpi/reviews: Manager Reviews with Required Notes
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
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
    return NextResponse.json({ error: "Forbidden: Access denied to target employee reviews" }, { status: 403 });
  }

  const { data: reviews, error } = await (supabaseAdmin as any)
    .from("kpi_reviews")
    .select("id, employee_id, reviewer_id, period_type, period_start, period_end, ratings, note, created_at")
    .eq("employee_id", targetEmployeeId)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Fetch reviewer names
  const reviewerIds = Array.from(new Set((reviews || []).map((r: any) => r.reviewer_id).filter(Boolean)));
  let reviewerNameMap = new Map<string, string>();
  if (reviewerIds.length > 0) {
    const { data: reviewers } = await (supabaseAdmin.from("employees") as any)
      .select("id, full_name, email")
      .in("id", reviewerIds);
    for (const rev of reviewers || []) {
      reviewerNameMap.set(rev.id, rev.full_name || rev.email);
    }
  }

  const enrichedReviews = (reviews || []).map((r: any) => ({
    ...r,
    reviewer_name: reviewerNameMap.get(r.reviewer_id) || "Manager / HR",
  }));

  return NextResponse.json({ reviews: enrichedReviews });
}

export async function POST(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Manager, HR, Admin only
  if (caller.role === "employee") {
    return NextResponse.json({ error: "Forbidden: Only managers, HR, and admins can submit reviews" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const { employee_id, period_type, period_start, period_end, ratings, note } = body;

    if (!employee_id) {
      return NextResponse.json({ error: "employee_id is required" }, { status: 400 });
    }

    // Nobody can review themselves
    if (caller.userId === employee_id) {
      return NextResponse.json({ error: "Self-review is not permitted. Only managers/HR can review others." }, { status: 400 });
    }

    // Check scope
    const isAllowed = await verifyEmployeeAccess(caller, employee_id);
    if (!isAllowed) {
      return NextResponse.json({ error: "Forbidden: Employee is outside your review scope" }, { status: 403 });
    }

    // Note is strictly REQUIRED and must be at least 5 characters
    const trimmedNote = (note || "").trim();
    if (!trimmedNote || trimmedNote.length < 5) {
      return NextResponse.json({ error: "A detailed review note is required (minimum 5 characters)." }, { status: 400 });
    }

    // Validate period_type
    const validPeriodType = period_type === "quarterly" ? "quarterly" : "monthly";

    // Validate ratings
    if (!ratings || typeof ratings !== "object") {
      return NextResponse.json({ error: "Ratings object (quality, communication, initiative, teamwork) is required" }, { status: 400 });
    }

    const { quality, communication, initiative, teamwork } = ratings;
    const cleanRatings = {
      quality: Math.min(5, Math.max(1, Number(quality) || 3)),
      communication: Math.min(5, Math.max(1, Number(communication) || 3)),
      initiative: Math.min(5, Math.max(1, Number(initiative) || 3)),
      teamwork: Math.min(5, Math.max(1, Number(teamwork) || 3)),
    };

    const { data: newReview, error: insertErr } = await (supabaseAdmin as any)
      .from("kpi_reviews")
      .insert({
        employee_id,
        reviewer_id: caller.userId,
        period_type: validPeriodType,
        period_start: period_start || new Date().toISOString().slice(0, 10),
        period_end: period_end || new Date().toISOString().slice(0, 10),
        ratings: cleanRatings,
        note: trimmedNote,
      })
      .select()
      .single();

    if (insertErr) {
      return NextResponse.json({ error: insertErr.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, review: newReview }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Invalid review payload" }, { status: 400 });
  }
}
