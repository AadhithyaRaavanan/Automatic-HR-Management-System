import { NextRequest, NextResponse } from "next/server";
import { getNotificationAuth } from "@/features/notifications/auth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getNotificationAuth(request);
    if (!user) {
      return NextResponse.json({ unreadCount: 0 });
    }

    const primaryClient: any = isSupabaseAdminConfigured() ? supabaseAdmin : supabase;
    let { count, error } = await (primaryClient.from("notifications") as any)
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .is("read_at", null);

    if (error && primaryClient === supabaseAdmin) {
      const fallback = await (supabase.from("notifications") as any)
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .is("read_at", null);
      count = fallback.count;
      error = fallback.error;
    }

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }

    return NextResponse.json({ unreadCount: count || 0 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
