import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { isDemoModeEnabled } from "@/lib/config/demo";
import { consumePersistentRecoveryChallenge } from "@/features/auth/mfa-recovery-store";
import { ORG_SELECTION_COOKIE } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Authentication required. Please sign in first." },
        { status: 401 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { code, demoReset } = body;
    const isDemo = isDemoModeEnabled();
    const forwardedFor = request.headers.get("x-forwarded-for");
    const clientIp = forwardedFor ? forwardedFor.split(",")[0].trim() : "127.0.0.1";

    if (demoReset && isDemo && process.env.NODE_ENV !== "production") {
      // Explicit non-production demo shortcut only
    } else {
      if (!code || typeof code !== "string") {
        return NextResponse.json(
          { error: "A valid 6-digit recovery code is required." },
          { status: 400 }
        );
      }

      const proofToken = request.cookies.get("pulse_mfa_proof")?.value || null;
      const check = await consumePersistentRecoveryChallenge({
        userId: user.id,
        purpose: "mfa_recovery",
        code,
        proofToken,
        clientIp,
      });

      if (!check.ok) {
        const msg =
          check.reason === "too_many_attempts"
            ? "Too many incorrect recovery code attempts. Please request a new code."
            : check.reason === "expired"
            ? "Recovery code has expired. Please request a new code."
            : "Invalid or already used recovery code. Please check your email or request a new code.";
        return NextResponse.json({ error: msg }, { status: 400 });
      }
    }

    // Unenroll all MFA factors using Admin client & verify complete removal
    const admin = getAdminClient();
    const { data: factorsData, error: listError } = await admin.auth.admin.mfa.listFactors({
      userId: user.id,
    });

    if (listError) {
      return NextResponse.json(
        { error: `Failed to retrieve existing factors: ${listError.message}` },
        { status: 500 }
      );
    }

    const factors = factorsData?.factors || [];
    let deletedCount = 0;
    const deleteErrors: string[] = [];

    for (const factor of factors) {
      const { error: delError } = await admin.auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: user.id,
      });
      if (delError) {
        deleteErrors.push(delError.message);
      } else {
        deletedCount++;
      }
    }

    if (deleteErrors.length > 0) {
      return NextResponse.json(
        {
          error: `MFA factor removal incomplete: ${deleteErrors.join("; ")}`,
        },
        { status: 500 }
      );
    }

    // Write durable audit log(s) across caller's active organizations
    const requestedOrg = request.cookies.get(ORG_SELECTION_COOKIE)?.value || null;
    const { data: members } = await (admin.from("organization_members") as any)
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("status", "active");

    const orgIds = Array.from(
      new Set<string>(
        (members || [])
          .map((m: any) => m.organization_id)
          .filter(Boolean)
      )
    );
    const targetAuditOrgs =
      requestedOrg && orgIds.includes(requestedOrg) ? [requestedOrg] : orgIds;

    for (const orgId of targetAuditOrgs) {
      const { error: auditErr } = await admin.from("audit_logs").insert({
        organization_id: orgId,
        actor_id: user.id,
        action: "USER_MFA_RESET",
        table_name: "auth.mfa_factors",
        record_id: user.id,
        old_data: { factors_count: factors.length },
        new_data: {
          reason: "LOST_DEVICE_RECOVERY",
          reset_at: new Date().toISOString(),
          deleted_count: deletedCount,
          client_ip: clientIp,
        },
      });
      if (auditErr) {
        console.error("[reset-lost-device] Audit log error:", auditErr.message);
        return NextResponse.json(
          { error: "MFA factors reset, but durable audit logging failed." },
          { status: 500 }
        );
      }
    }

    const res = NextResponse.json({
      success: true,
      deletedCount,
      message: "Two-Factor Authentication has been reset. You may now enroll a new device.",
    });
    res.cookies.delete("pulse_mfa_proof");
    return res;
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to reset MFA factors." },
      { status: 500 }
    );
  }
}
