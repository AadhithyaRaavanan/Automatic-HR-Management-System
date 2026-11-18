import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET() {
  const now = new Date();
  return NextResponse.json({
    iso: now.toISOString(),
    epoch: now.getTime(),
    timezone: "Asia/Kolkata",
  });
}
