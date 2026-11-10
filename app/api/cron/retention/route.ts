import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { archiveAllOrgsAndRunRetentionCleanup } from "@/lib/retention/archiver";

export const dynamic = "force-dynamic";

function isAuthorizedCronRequest(request: NextRequest): { ok: true } | { ok: false; status: number; error: string } {
  const configuredSecret = process.env.CRON_SECRET?.trim();
  if (!configuredSecret) {
    return { ok: false, status: 503, error: "Scheduled cron secret is not configured." };
  }

  const authHeader = request.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Unauthorized: Missing bearer token." };
  }

  const presentedToken = authHeader.slice("Bearer ".length).trim();
  const expectedBuf = Buffer.from(configuredSecret, "utf8");
  const presentedBuf = Buffer.from(presentedToken, "utf8");

  if (
    expectedBuf.length !== presentedBuf.length ||
    !crypto.timingSafeEqual(expectedBuf, presentedBuf)
  ) {
    return { ok: false, status: 403, error: "Forbidden: Invalid cron bearer token." };
  }

  return { ok: true };
}

async function handleScheduledRetention(request: NextRequest) {
  const authCheck = isAuthorizedCronRequest(request);
  if (!authCheck.ok) {
    return NextResponse.json({ error: authCheck.error }, { status: authCheck.status });
  }

  try {
    const summary = await archiveAllOrgsAndRunRetentionCleanup(null);
    return NextResponse.json({
      automated: true,
      executed_at: new Date().toISOString(),
      ...summary,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Automated retention archive run failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return handleScheduledRetention(request);
}

export async function POST(request: NextRequest) {
  return handleScheduledRetention(request);
}

