import { NextRequest, NextResponse } from "next/server";
import { getNotificationAuth } from "@/features/notifications/auth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface ParsedNotificationCursor {
  createdAt: string;
  id: string | null;
}

function parseNotificationCursor(rawCursor: string | null): ParsedNotificationCursor | null {
  if (!rawCursor) return null;
  const trimmed = rawCursor.trim();
  if (!trimmed) return null;

  const pipeIdx = trimmed.indexOf("|");
  if (pipeIdx === -1) {
    if (Number.isNaN(Date.parse(trimmed))) return null;
    return { createdAt: trimmed, id: null };
  }

  const createdAt = trimmed.slice(0, pipeIdx).trim();
  const id = trimmed.slice(pipeIdx + 1).trim();
  if (!createdAt || Number.isNaN(Date.parse(createdAt))) return null;
  if (!id || !UUID_REGEX.test(id)) return null;

  return { createdAt, id };
}

function encodeNotificationCursor(createdAt?: string | null, id?: string | null): string | null {
  if (!createdAt || !id) return null;
  return `${createdAt}|${id}`;
}

async function fetchNotificationsWithClient(
  client: any,
  userId: string,
  organizationId: string,
  limit: number,
  unreadOnly: boolean,
  parsedCursor: ParsedNotificationCursor | null
) {
  try {
    let query = (client.from("notifications") as any)
      .select("*")
      .eq("user_id", userId)
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (unreadOnly) {
      query = query.is("read_at", null);
    }

    if (parsedCursor) {
      if (parsedCursor.id) {
        query = query.or(
          `created_at.lt.${parsedCursor.createdAt},and(created_at.eq.${parsedCursor.createdAt},id.lt.${parsedCursor.id})`
        );
      } else {
        query = query.lt("created_at", parsedCursor.createdAt);
      }
    }

    return await query;
  } catch (err: any) {
    return { data: null, error: err };
  }
}

export async function GET(request: NextRequest) {
  try {
    const { user, supabase, organizationId, errorResponse } = await getNotificationAuth(request);
    if (errorResponse) {
      return errorResponse;
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!organizationId) {
      return NextResponse.json(
        { error: "Forbidden: Active organization context is required." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(request.url);
    const unreadOnly = searchParams.get("unread_only") === "true";
    const rawCursor = searchParams.get("cursor");
    const parsedCursor = parseNotificationCursor(rawCursor);
    if (rawCursor && !parsedCursor) {
      return NextResponse.json({ error: "Invalid pagination cursor" }, { status: 400 });
    }
    const parsedLimit = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Math.min(Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 20, 50);

    let data: any[] | null = null;
    let queryError: any = null;

    if (isSupabaseAdminConfigured()) {
      const adminRes = await fetchNotificationsWithClient(
        supabaseAdmin,
        user.id,
        organizationId,
        limit,
        unreadOnly,
        parsedCursor
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
        organizationId,
        limit,
        unreadOnly,
        parsedCursor
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

    const rawItems = Array.isArray(data) ? data : [];
    const hasMore = rawItems.length > limit;
    const items = hasMore ? rawItems.slice(0, limit) : rawItems;
    const lastItem = items[items.length - 1];
    const nextCursor =
      hasMore && lastItem ? encodeNotificationCursor(lastItem.created_at, lastItem.id) : null;

    return NextResponse.json(
      {
        notifications: items,
        nextCursor,
        organizationId,
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
