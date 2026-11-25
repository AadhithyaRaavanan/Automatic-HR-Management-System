import { NextRequest, NextResponse } from "next/server";
import { getNotificationCaller } from "@/features/notifications/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const user = await getNotificationCaller(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread_only") === "true";
    const cursor = searchParams.get("cursor"); // created_at ISO timestamp
    const limit = Math.min(parseInt(searchParams.get("limit") || "20", 10), 50);

    // Clean up any lingering example notifications asynchronously
    (supabaseAdmin.from("notifications") as any)
      .delete()
      .ilike("body", "%Example Notification%")
      .then(() => {})
      .catch(() => {});

    let query = (supabaseAdmin.from("notifications") as any)
      .select("*")
      .eq("user_id", user.id)
      .not("body", "ilike", "%Example Notification%")
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (unreadOnly) {
      query = query.is("read_at", null);
    }

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const items = (data || []).filter(
      (n: any) =>
        !n.body?.toLowerCase().includes("example notification") &&
        !n.metadata?.isExample
    );
    let nextCursor: string | null = null;

    if (items.length > limit) {
      const nextItem = items.pop();
      nextCursor = nextItem.created_at;
    }

    return NextResponse.json(
      {
        notifications: items,
        nextCursor,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
