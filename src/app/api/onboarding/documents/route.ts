import { NextRequest, NextResponse } from "next/server";
import { resolveTenantCaller, verifyTargetEmployeeInOrg } from "@/features/auth/tenant-context";
import { listCandidateDocs } from "@/features/onboarding/storage";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const authResult = await resolveTenantCaller(request, {
      skipOnboardingCheck: true,
      requireAal2ForPrivileged: false,
    });
    if ("response" in authResult) {
      return authResult.response;
    }

    const { context } = authResult;
    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get("userId") || context.userId;

    if (requestedUserId !== context.userId) {
      if (context.role !== "admin" && context.role !== "hr") {
        return NextResponse.json(
          { error: "Forbidden: Cannot view other candidates' documents." },
          { status: 403 }
        );
      }
      const targetCheck = await verifyTargetEmployeeInOrg(context, requestedUserId, { allowSelf: true });
      if (!targetCheck.allowed) {
        return NextResponse.json(
          { error: "Forbidden: Candidate does not belong to your organization." },
          { status: 403 }
        );
      }
    }

    const docs = await listCandidateDocs(requestedUserId);
    return NextResponse.json({ documents: docs });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve onboarding documents." },
      { status: 500 }
    );
  }
}
