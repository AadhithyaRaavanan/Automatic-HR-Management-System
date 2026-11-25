import { NextRequest, NextResponse } from "next/server";
import { getNotificationCaller } from "@/features/notifications/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await getNotificationCaller(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { ids, all } = body;
    const nowIso = new Date().toISOString();

    if (all === true) {
      const { data, error } = await (supabaseAdmin.from("notifications") as any)
        .update({ read_at: nowIso })
        .eq("user_id", user.id)
        .is("read_at", null)
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        count: (data || []).length,
      });
    }

    if (Array.isArray(ids) && ids.length > 0) {
      const { data, error } = await (supabaseAdmin.from("notifications") as any)
        .update({ read_at: nowIso })
        .eq("user_id", user.id)
        .in("id", ids)
        .is("read_at", null)
        .select("id");

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        count: (data || []).length,
      });
    }

    return NextResponse.json(
      { error: "Provide 'ids' array or 'all: true'" },
      { status: 400 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
