import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { getAllActiveEmployees } from "@/features/notifications/recipients";
import { notify } from "@/features/notifications/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
    if ("response" in authResult) {
      return authResult.response;
    }

    const { userId, organizationId } = authResult.context;

    const body = await request.json().catch(() => ({}));
    const { action, holidayName, holidayDate, count } = body;

    const allEmployees = await getAllActiveEmployees(organizationId);
    if (allEmployees.length === 0) {
      return NextResponse.json({ success: true, count: 0 });
    }

    const title =
      action === "import"
        ? `${count || "Official"} Holiday Schedule Published`
        : `Holiday Notice: ${holidayName || "Upcoming Holiday"}`;

    const bodyText =
      action === "import"
        ? `The official company holiday calendar for the upcoming cycle has been updated with ${count} holidays.`
        : `${holidayName || "A holiday"} has been scheduled on ${holidayDate || "the calendar"}.`;

    await notify({
      userIds: allEmployees,
      organizationId,
      type: "holiday_scheduled",
      typeGroup: "announcements",
      title,
      body: bodyText,
      link: "/holidays",
      entityType: "holidays",
      actorId: userId,
    });

    return NextResponse.json({ success: true, count: allEmployees.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
