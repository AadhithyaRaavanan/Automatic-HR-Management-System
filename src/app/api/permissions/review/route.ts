import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr", "manager", "team_lead"]);
  if ("response" in authResult) {
    return authResult.response;
  }
  const { context } = authResult;

  try {
    const body = await request.json().catch(() => ({}));
    const { requestId, action, reviewNote } = body;

    if (!requestId || !["approve", "reject"].includes(action)) {
      return NextResponse.json({ error: "Invalid review parameters" }, { status: 400 });
    }

    const { data: rpcResult, error: rpcErr } = await (supabaseAdmin.rpc as any)(
      "service_review_permission_request",
      {
        p_actor_id: context.userId,
        p_organization_id: context.organizationId,
        p_request_id: requestId,
        p_action: action,
        p_review_note: reviewNote || null,
      }
    );

    if (rpcErr) {
      const msg = String(rpcErr.message || "Failed to review permission request.");
      const status =
        rpcErr.code === "P0002" || /not found/i.test(msg)
          ? 404
          : rpcErr.code === "42501" || /forbidden|separation of duties|authorized/i.test(msg)
          ? 403
          : rpcErr.code === "P0001" || /conflict|already been|concurrently/i.test(msg)
          ? 409
          : 400;
      return NextResponse.json({ error: msg }, { status });
    }

    if (rpcResult?.employee_id) {
      const targetStatus = rpcResult.status || (action === "approve" ? "approved" : "rejected");
      try {
        await notify({
          userIds: [rpcResult.employee_id],
          organizationId: context.organizationId,
          type: "request_status",
          typeGroup: "requests",
          title:
            targetStatus === "approved"
              ? "Permission Request Approved"
              : "Permission Request Rejected",
          body: `Your permission request for ${rpcResult.permission_date || "requested date"} (${rpcResult.duration_minutes || 0} mins) was ${targetStatus}.`,
          link: "/requests",
          entityType: "permission_requests",
          entityId: requestId,
          actorId: context.userId,
          dedupeKey: `perm-review:${requestId}:${targetStatus}`,
        });
      } catch (notifErr) {
        console.warn("[Permission Review Notification Error]:", notifErr);
      }
    }

    return NextResponse.json({
      success: true,
      action,
      status: rpcResult?.status,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to process permission review" },
      { status: 500 }
    );
  }
}
