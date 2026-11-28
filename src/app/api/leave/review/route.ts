import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";
import { resolveTenantCaller } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const caller = await resolveTenantCaller(request, {
    allowedRoles: ["admin", "hr", "manager"],
  });
  if ("response" in caller) {
    return caller.response;
  }

  const { context } = caller;

  try {
    const body = await request.json().catch(() => ({}));
    const { requestId, action, reviewNote, idempotencyKey: bodyIdempKey } = body;
    const idempotencyKey =
      request.headers.get("Idempotency-Key") ||
      request.headers.get("x-idempotency-key") ||
      (typeof bodyIdempKey === "string" && bodyIdempKey.trim() ? bodyIdempKey.trim() : null);

    if (!requestId || !action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Invalid review request payload. Action must be 'approve' or 'reject'." },
        { status: 400 }
      );
    }

    const trimmedNote = typeof reviewNote === "string" ? reviewNote.trim() : "";
    if (!trimmedNote || trimmedNote.length < 5) {
      return NextResponse.json(
        { error: "A decision note of at least 5 characters is strictly required." },
        { status: 400 }
      );
    }

    const { data: rpcResult, error: rpcErr } = await (supabaseAdmin.rpc as any)(
      "service_review_leave_request",
      {
        p_actor_id: context.userId,
        p_organization_id: context.organizationId,
        p_request_id: requestId,
        p_action: action,
        p_review_note: trimmedNote,
        p_idempotency_key: idempotencyKey,
      }
    );

    if (rpcErr) {
      const msg = String(rpcErr.message || "Failed to review leave request.");
      const status =
        rpcErr.code === "P0002" || /not found/i.test(msg)
          ? 404
          : rpcErr.code === "42501" || /forbidden|separation of duties|authorized|membership/i.test(msg)
          ? 403
          : rpcErr.code === "P0001" || /conflict|already been|concurrently/i.test(msg)
          ? 409
          : 400;
      return NextResponse.json({ error: msg }, { status });
    }

    if (!rpcResult?.idempotent_replay && rpcResult?.employee_id) {
      const targetStatus = rpcResult.status || (action === "approve" ? "approved" : "rejected");
      try {
        await notify({
          userIds: [rpcResult.employee_id],
          organizationId: context.organizationId,
          type: targetStatus === "approved" ? "leave_approved" : "leave_rejected",
          typeGroup: "leave",
          title: targetStatus === "approved" ? "Leave Request Approved" : "Leave Request Rejected",
          body: `Your leave request for ${rpcResult.start_date || "requested dates"} to ${rpcResult.end_date || "end"} has been ${targetStatus}.\nReviewer note: "${trimmedNote}"`,
          link: "/leave",
          entityType: "leave_requests",
          entityId: requestId,
          actorId: context.userId,
          dedupeKey: `leave-review:${requestId}:${targetStatus}`,
        });
      } catch (notifErr) {
        console.warn("[Leave Review Notification Error]:", notifErr);
      }
    }

    return NextResponse.json({
      success: true,
      status: rpcResult?.status,
      review_note: rpcResult?.review_note || trimmedNote,
      idempotentReplay: Boolean(rpcResult?.idempotent_replay),
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error during leave review." },
      { status: 500 }
    );
  }
}
