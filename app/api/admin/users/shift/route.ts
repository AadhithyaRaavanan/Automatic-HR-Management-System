import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { userId, shiftStartTime, shiftEndTime } = body;

    if (!userId || !shiftStartTime || !shiftEndTime) {
      return NextResponse.json(
        { error: "Missing required shift fields (userId, shiftStartTime, shiftEndTime)" },
        { status: 400 }
      );
    }

    // Verify caller role and organization
    const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === "true";
    const { data: callerMember, error: callerError } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id, role")
      .eq("user_id", user.id)
      .eq("status", "active")
      .maybeSingle();

    if (isDemo) {
      return NextResponse.json({
        success: true,
        userId,
        shiftStartTime: shiftStartTime.length === 5 ? `${shiftStartTime}:00` : shiftStartTime,
        shiftEndTime: shiftEndTime.length === 5 ? `${shiftEndTime}:00` : shiftEndTime,
        crossesMidnight: shiftEndTime < shiftStartTime,
      });
    }

    if (callerError || !callerMember || !["admin", "hr"].includes(callerMember.role)) {
      return NextResponse.json(
        { error: "Forbidden: Only HR or Admins can configure employee shift schedules." },
        { status: 403 }
      );
    }

    // Verify target user belongs to caller organization
    const { data: targetMember, error: targetError } = await supabaseAdmin
      .from("organization_members")
      .select("organization_id")
      .eq("user_id", userId)
      .maybeSingle();

    if (targetError || !targetMember || targetMember.organization_id !== callerMember.organization_id) {
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
        .eq("organization_id", callerMember.organization_id),
      (supabaseAdmin.from("employees") as any)
        .update({
          shift_start_time: startVal,
          shift_end_time: endVal,
          updated_at: new Date().toISOString(),
        })
        .eq("id", userId)
        .eq("organization_id", callerMember.organization_id),
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

