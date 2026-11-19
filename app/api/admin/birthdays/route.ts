import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import {
  getVerifiedEmployeeBirthdays,
  dispatchBirthdayNotifications,
  sendAdminExampleBirthdayNotifications,
  getKolkataDateString,
} from "@/lib/notifications/birthdays";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const todayKolkata = getKolkataDateString();
    const birthdays = await getVerifiedEmployeeBirthdays();

    return NextResponse.json({
      success: true,
      todayKolkata,
      birthdays,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to fetch employee birthdays" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  const callerId = authResult.context.userId;

  try {
    const body = await request.json().catch(() => ({}));
    const { action, targetDate } = body;

    if (action === "send_example_notifications") {
      const ok = await sendAdminExampleBirthdayNotifications(callerId);
      return NextResponse.json({
        success: ok,
        message: "Example birthday notifications sent to your app notification inbox.",
      });
    }

    // Default action: dispatch birthday notifications
    const result = await dispatchBirthdayNotifications(targetDate);
    return NextResponse.json({
      success: true,
      result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to process birthday action" },
      { status: 500 }
    );
  }
}
