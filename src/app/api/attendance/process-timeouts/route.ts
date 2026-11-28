import { NextRequest, NextResponse } from "next/server";
import { getAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { requireApprovedUser } from "@/features/auth/require-approved-user";
import { processSessionTimeouts } from "@/features/attendance/session-timeout";

export const dynamic = "force-dynamic";

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${cronSecret}` || secretHeader === cronSecret;
}

async function handleProcessTimeouts(request: NextRequest) {
  try {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: "Server configuration missing Supabase Admin credentials." },
        { status: 500 }
      );
    }

    const adminClient: any = getAdminClient();
    const isCron = isAuthorizedCronRequest(request);
    let callerUserId: string | undefined = undefined;
    let organizationId: string | undefined = undefined;

    if (!isCron) {
      const approvedCheck = await requireApprovedUser(request);
      if ("response" in approvedCheck) {
        return approvedCheck.response;
      }
      callerUserId = approvedCheck.user.id;
      organizationId = approvedCheck.organizationId;

      if (!organizationId) {
        try {
          const { data: emp } = await adminClient
            .from("employees")
            .select("organization_id")
            .eq("id", callerUserId)
            .maybeSingle();
          if (emp?.organization_id) {
            organizationId = String(emp.organization_id);
          }
        } catch {}
      }
    }

    const result = await processSessionTimeouts({
      adminClient,
      organizationId,
      employeeId: organizationId || isCron ? undefined : callerUserId,
    });

    const timedOutForCaller = callerUserId
      ? result.timedOutSessions.some((s) => s.employeeId === callerUserId)
      : result.timedOutCount > 0;

    return NextResponse.json({
      success: true,
      mode: isCron ? "cron" : organizationId ? "organization" : "user",
      timedOut: timedOutForCaller,
      anyTimedOut: result.timedOutCount > 0,
      ...result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to process attendance timeouts." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handleProcessTimeouts(request);
}

export async function GET(request: NextRequest) {
  return handleProcessTimeouts(request);
}
