import { NextRequest, NextResponse } from "next/server";
import { getNotificationAuth } from "@/features/notifications/auth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

async function fetchNotificationsWithClient(
  client: any,
  userId: string,
  limit: number,
  unreadOnly: boolean,
  cursor: string | null
) {
  try {
    let query = (client.from("notifications") as any)
      .select("*")
      .eq("user_id", userId)
      .not("body", "ilike", "%Example Notification%")
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (unreadOnly) {
      query = query.is("read_at", null);
    }

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    return await query;
  } catch (err: any) {
    return { data: null, error: err };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase } = await getNotificationAuth(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread_only") === "true";
    const cursor = searchParams.get("cursor"); // created_at ISO timestamp
    const parsedLimit = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20, 50);

    // Clean up any lingering example notifications asynchronously when admin client is available
    if (isSupabaseAdminConfigured()) {
      void (async () => {
        try {
          await (supabaseAdmin.from("notifications") as any)
            .delete()
            .eq("user_id", user.id)
            .ilike("body", "%Example Notification%");
        } catch {}
      })();
    }

    let data: any[] | null = null;
    let queryError: any = null;

    if (isSupabaseAdminConfigured()) {
      const adminRes = await fetchNotificationsWithClient(
        supabaseAdmin,
        user.id,
        limit,
        unreadOnly,
        cursor
      );

      if (!adminRes?.error) {
        data = adminRes?.data || [];
      } else {
        queryError = adminRes.error;
      }
    }

    // Fallback gracefully to the caller's RLS-authenticated session client
    if (data === null) {
      const userRes = await fetchNotificationsWithClient(
        supabase,
        user.id,
        limit,
        unreadOnly,
        cursor
      );

      if (!userRes?.error) {
        data = userRes?.data || [];
        queryError = null;
      } else {
        queryError = userRes.error || queryError;
      }
    }

    if (queryError) {
      const msg = String(queryError?.message || "Failed to fetch notifications");
      const isAuthz =
        queryError?.code === "42501" ||
        /permission denied|row-level security|forbidden/i.test(msg);
      return NextResponse.json(
        { error: msg },
        { status: isAuthz ? 403 : 500 }
      );
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
