import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const { userId, shiftStartTime, shiftEndTime } = body;

    if (!userId || !shiftStartTime || !shiftEndTime) {
      return NextResponse.json(
        { error: "Missing required shift fields (userId, shiftStartTime, shiftEndTime)" },
        { status: 400 }
      );
    }

    const isDemo = isDemoModeEnabled();
    if (isDemo) {
      return NextResponse.json({
        success: true,
        userId,
        shiftStartTime: shiftStartTime.length === 5 ? `${shiftStartTime}:00` : shiftStartTime,
        shiftEndTime: shiftEndTime.length === 5 ? `${shiftEndTime}:00` : shiftEndTime,
        crossesMidnight: shiftEndTime < shiftStartTime,
      });
    }

    // Verify target user belongs to caller organization
    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (targetError || !targetMember || targetMember.organization_id !== context.organizationId) {
      return NextResponse.json(
        { error: "Forbidden: Target member does not belong to your organization." },
        { status: 403 }
      );
    }

    const startVal = shiftStartTime.length === 5 ? `${shiftStartTime}:00` : shiftStartTime;
    const endVal = shiftEndTime.length === 5 ? `${shiftEndTime}:00` : shiftEndTime;

    await Promise.all([
      (supabaseAdmin.from("organization_members") as any)
        .update({
          shift_start_time: startVal,
          shift_end_time: endVal,
          updated_at: new Date().toISOString(),
        })
        .eq("user_id", userId)
        .eq("organization_id", context.organizationId),
      (supabaseAdmin.from("employees") as any)
        .update({
          shift_start_time: startVal,
          shift_end_time: endVal,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .eq("organization_id", context.organizationId),
    ]);

    return NextResponse.json({
      success: true,
      userId,
      shiftStartTime: startVal,
      shiftEndTime: endVal,
      crossesMidnight: endVal < startVal,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to update shift" }, { status: 500 });
  }
}

