import { NextRequest, NextResponse } from "next/server";
import { getNotificationCaller } from "@/lib/notifications/auth";
import { getAllActiveEmployees } from "@/lib/notifications/recipients";
import { notify } from "@/lib/notifications/notify";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const user = await getNotificationCaller(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { action, holidayName, holidayDate, count } = body;

    const allEmployees = await getAllActiveEmployees();
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
      type: "holiday_scheduled",
      typeGroup: "announcements",
      title,
      body: bodyText,
      link: "/holidays",
      entityType: "holidays",
      actorId: user.id,
    });

    return NextResponse.json({ success: true, count: allEmployees.length });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
