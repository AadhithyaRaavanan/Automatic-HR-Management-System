import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr", "manager", "team_lead"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json();
    const { requestId, action, reviewNote } = body;

    if (!requestId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid review parameters" }, { status: 400 });
    }

    if (action === "approve") {
      const { data, error } = await (supabaseAdmin as any).rpc("approve_permission_request", {
        p_request_id: requestId,
        p_review_note: reviewNote || null,
      });

      if (error) {
        // Fallback direct update if RPC error
        await (supabaseAdmin as any)
          .from("permission_requests")
          .update({
            status: "approved",
            reviewed_by: context.userId,
            reviewed_at: new Date().toISOString(),
            review_note: reviewNote || null,
            updated_at: new Date().toISOString(),
          })
          .eq("id", requestId);
      }
    } else {
      await (supabaseAdmin as any)
        .from("permission_requests")
        .update({
          status: "rejected",
          reviewed_by: context.userId,
          reviewed_at: new Date().toISOString(),
          review_note: reviewNote || null,
          updated_at: new Date().toISOString(),
        })
        .eq("id", requestId);
    }

    return NextResponse.json({ success: true, action });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to process permission review" }, { status: 500 });
  }
}
