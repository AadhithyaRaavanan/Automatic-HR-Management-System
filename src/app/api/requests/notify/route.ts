import { NextRequest, NextResponse } from "next/server";
import { getNotificationCaller } from "@/features/notifications/auth";
import { getManagersOf, getHrUsers } from "@/features/notifications/recipients";
import { notify } from "@/features/notifications/notify";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { requireApprovedUser } from "@/features/auth/require-approved-user";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const approvedCheck = await requireApprovedUser(request);
    if ("response" in approvedCheck) {
      return approvedCheck.response;
    }

    const user = approvedCheck.user;

    const body = await request.json().catch(() => ({}));
    const { event, requestId, workDate, reason } = body;

    const { data: emp } = await (supabaseAdmin.from("employees") as any)
      .select("full_name, organization_id")
      .eq("id", user.id)
      .maybeSingle();

    const empName = emp?.full_name || (user.user_metadata as any)?.full_name || "An employee";

    if (event === "submitted") {
      const managers = await getManagersOf(user.id);
      const hrUsers = await getHrUsers(emp?.organization_id);
      const recipientIds = Array.from(new Set([...managers, ...hrUsers]));

      await notify({
        userIds: recipientIds,
        type: "request_submitted",
        typeGroup: "requests",
        title: "New Attendance Regularization Request",
        body: `${empName} requested attendance regularization for ${workDate || "date"}.\nReason: "${reason || "No reason specified"}"`,
        link: "/requests",
        entityType: "regularization_requests",
        entityId: requestId,
        actorId: user.id,
      });

      return NextResponse.json({ success: true, count: recipientIds.length });
    }

    if (event === "cancelled") {
      const { data: reqData } = await (supabaseAdmin.from("regularization_requests") as any)
        .select("reviewed_by")
        .eq("id", requestId)
        .maybeSingle();

      let recipientIds: string[] = [];
      if (reqData?.reviewed_by) {
        recipientIds = [reqData.reviewed_by];
      } else {
        const managers = await getManagersOf(user.id);
        const hrUsers = await getHrUsers(emp?.organization_id);
        recipientIds = Array.from(new Set([...managers, ...hrUsers]));
      }

      await notify({
        userIds: recipientIds,
        type: "request_cancelled",
        typeGroup: "requests",
        title: "Regularization Request Cancelled",
        body: `${empName} cancelled their attendance regularization request for ${workDate || "date"}.`,
        link: "/requests",
        entityType: "regularization_requests",
        entityId: requestId,
        actorId: user.id,
      });

      return NextResponse.json({ success: true, count: recipientIds.length });
    }

    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
