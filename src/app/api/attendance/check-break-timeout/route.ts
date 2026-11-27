import { NextRequest, NextResponse } from "next/server";
import { getAdminClient, isSupabaseAdminConfigured } from "@/lib/supabase/admin";
import { requireApprovedUser } from "@/features/auth/require-approved-user";
import { enforceBreakTimeouts } from "@/features/attendance/break-timeout";

export const dynamic = "force-dynamic";

function isAuthorizedCronRequest(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) return false;
  const authHeader = request.headers.get("authorization");
  const secretHeader = request.headers.get("x-cron-secret");
  return authHeader === `Bearer ${cronSecret}` || secretHeader === cronSecret;
}

async function handleCheckBreakTimeout(request: NextRequest) {
  try {
    if (!isSupabaseAdminConfigured()) {
      return NextResponse.json(
        { error: "Server configuration missing Supabase Admin credentials." },
        { status: 500 }
      );
    }

    const adminClient = getAdminClient();
    const isCron = isAuthorizedCronRequest(request);
    let scopedEmployeeId: string | undefined = undefined;

    if (!isCron) {
      const approvedCheck = await requireApprovedUser(request);
      if ("response" in approvedCheck) {
        return approvedCheck.response;
      }
      scopedEmployeeId = approvedCheck.user.id;
    }

    const result = await enforceBreakTimeouts({
      adminClient,
      employeeId: scopedEmployeeId,
    });

    const timedOut = result.timedOutCount > 0;
    return NextResponse.json({
      success: true,
      mode: isCron ? "cron" : "user",
      timedOut,
      reason: timedOut ? "break_timeout" : null,
      ...result,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to evaluate break timeout." },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handleCheckBreakTimeout(request);
}

export async function GET(request: NextRequest) {
  return handleCheckBreakTimeout(request);
}
