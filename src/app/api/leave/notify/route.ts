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
    const { event, requestId, startDate, endDate, reason } = body;

    // Fetch employee full name
    const { data: emp } = await (supabaseAdmin.from("employees") as any)
      .select("full_name, organization_id")
      .eq("id", user.id)
      .maybeSingle();

    const empName = emp?.full_name || (user.user_metadata as any)?.full_name || "An employee";

    if (event === "adjusted") {
      const { targetEmployeeId, amount } = body;
      if (targetEmployeeId) {
        await notify({
          userIds: [targetEmployeeId],
          type: "leave_balance_adjusted",
          typeGroup: "leave",
          title: "Leave Balance Adjusted",
          body: `Your leave balance was updated by HR (${Number(amount) > 0 ? `+${amount}` : amount} days).\nReason: "${reason || "Annual policy adjustment"}"`,
          link: "/leave",
          entityType: "leave_balances",
          actorId: user.id,
        });
      }
      return NextResponse.json({ success: true });
    }

    if (event === "submitted") {
      const managers = await getManagersOf(user.id);
      const hrUsers = await getHrUsers(emp?.organization_id);
      const recipientIds = Array.from(new Set([...managers, ...hrUsers]));

      await notify({
        userIds: recipientIds,
        type: "leave_submitted",
        typeGroup: "leave",
        title: "New Leave Request Submitted",
        body: `${empName} submitted a leave request for ${startDate || "dates"} to ${endDate || "end"}.\nReason: "${reason || "No reason specified"}"`,
        link: "/leave",
        entityType: "leave_requests",
        entityId: requestId,
        actorId: user.id,
      });

      return NextResponse.json({ success: true, count: recipientIds.length });
    }

    if (event === "cancelled") {
      // Find who reviewed or managers
      const { data: reqData } = await (supabaseAdmin.from("leave_requests") as any)
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
        type: "leave_cancelled",
        typeGroup: "leave",
        title: "Leave Request Cancelled",
        body: `${empName} cancelled their leave request for ${startDate || "dates"} to ${endDate || "end"}.`,
        link: "/leave",
        entityType: "leave_requests",
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
