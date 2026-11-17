import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    const driveUrl = process.env.ONBOARDING_DRIVE_FOLDER_URL;
    if (driveUrl && driveUrl.trim()) {
      return NextResponse.json({
        configured: true,
        url: driveUrl.trim(),
      });
    }

    return NextResponse.json({
      configured: false,
      url: null,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve onboarding drive link." },
      { status: 500 }
    );
  }
}
