import { NextRequest, NextResponse } from "next/server";
import { getNotificationAuth } from "@/features/notifications/auth";
import { isSupabaseAdminConfigured, supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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

    const body = await request.json().catch(() => ({}));
    const { ids, all } = body;
    const nowIso = new Date().toISOString();
    const primaryClient: any = isSupabaseAdminConfigured() ? supabaseAdmin : supabase;

    if (all === true) {
      let { data, error } = await (primaryClient.from("notifications") as any)
        .update({ read_at: nowIso })
        .eq("user_id", user.id)
        .eq("organization_id", organizationId)
        .is("read_at", null)
        .select("id");

      if (error && primaryClient === supabaseAdmin) {
        const fallback = await (supabase.from("notifications") as any)
          .update({ read_at: nowIso })
          .eq("user_id", user.id)
          .eq("organization_id", organizationId)
          .is("read_at", null)
          .select("id");
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }

      return NextResponse.json({
        success: true,
        count: (data || []).length,
        organizationId,
      });
    }

    if (Array.isArray(ids) && ids.length > 0) {
      let { data, error } = await (primaryClient.from("notifications") as any)
        .update({ read_at: nowIso })
        .eq("user_id", user.id)
        .eq("organization_id", organizationId)
        .in("id", ids)
        .is("read_at", null)
        .select("id");

      if (error && primaryClient === supabaseAdmin) {
        const fallback = await (supabase.from("notifications") as any)
          .update({ read_at: nowIso })
          .eq("user_id", user.id)
          .eq("organization_id", organizationId)
          .in("id", ids)
          .is("read_at", null)
          .select("id");
        data = fallback.data;
        error = fallback.error;
      }

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }

      return NextResponse.json({
        success: true,
        count: (data || []).length,
        organizationId,
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
