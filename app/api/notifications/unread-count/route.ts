import { NextRequest, NextResponse } from "next/server";
import { getNotificationCaller } from "@/lib/notifications/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getNotificationCaller(request);
    if (!user) {
      return NextResponse.json({ unreadCount: 0 });
    }

    const { count, error } = await (supabaseAdmin.from("notifications") as any)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ unreadCount: count || 0 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
