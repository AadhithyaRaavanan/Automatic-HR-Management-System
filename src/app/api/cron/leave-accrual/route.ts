import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";
import { requireCronAuthorization } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

const BATCH_SIZE = 100;

export async function POST(request: NextRequest) {
  const authError = requireCronAuthorization(request);
  if (authError) {
    return authError;
  }

  try {
    const now = new Date();
    const kolkataNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    const year = kolkataNow.getFullYear();
    const month = kolkataNow.getMonth() + 1;
    const yearMonth = `${year}-${String(month).padStart(2, "0")}`;
    const isYearEnd = month === 12;

    const { data: orgs, error: orgsErr } = await (supabaseAdmin.from("organizations") as any)
      .select("id, name, status")
      .in("status", ["active", "trial"]);

    if (orgsErr) {
      return NextResponse.json(
        { error: orgsErr.message || "Failed to load organizations for accrual." },
        { status: 500 }
      );
    }

    let totalProcessed = 0;
    let totalSkipped = 0;
    const orgSummaries: Array<{
      organizationId: string;
      processed: number;
      skipped: number;
    }> = [];

    for (const org of orgs || []) {
      const orgId = org.id as string;
      let offset = 0;
      let orgProcessed = 0;
      let orgSkipped = 0;
      const orgCreditedIds = new Set<string>();

      while (true) {
        const { data: batchRes, error: batchErr } = await (supabaseAdmin.rpc as any)(
          "service_accrue_org_leave_balances",
          {
            p_organization_id: orgId,
            p_year: year,
            p_month: month,
            p_batch_limit: BATCH_SIZE,
            p_offset: offset,
          }
        );

        if (batchErr) {
          throw new Error(`Org ${orgId} accrual failed: ${batchErr.message}`);
        }

        const empCount = Number(batchRes?.batch_employees || 0);
        orgProcessed += Number(batchRes?.processed || 0);
        orgSkipped += Number(batchRes?.skipped || 0);
        for (const eid of batchRes?.credited_employee_ids || []) {
          if (eid) orgCreditedIds.add(String(eid));
        }

        if (empCount < BATCH_SIZE) {
          break;
        }
        offset += BATCH_SIZE;
      }

      totalProcessed += orgProcessed;
      totalSkipped += orgSkipped;
      orgSummaries.push({
        organizationId: orgId,
        processed: orgProcessed,
        skipped: orgSkipped,
      });

      if (orgCreditedIds.size > 0) {
        await notify({
          userIds: Array.from(orgCreditedIds),
          organizationId: orgId,
          type: "policy_update",
          typeGroup: "leave",
          title: "Monthly Leave Credit Applied",
          body: `Your monthly leave allocation for ${yearMonth} has been credited to your balance.`,
          link: "/leave",
          entityType: "leave_balances",
          dedupeKey: `monthly-accrual-emp:${orgId}:${yearMonth}`,
        });
      }

      const { data: hrUsers } = await (supabaseAdmin.from("organization_members") as any)
        .select("user_id")
        .eq("organization_id", orgId)
        .in("role", ["hr", "admin"])
        .eq("status", "active");

      const hrUserIds = (hrUsers || []).map((h: any) => h.user_id).filter(Boolean);
      if (hrUserIds.length > 0) {
        await notify({
          userIds: hrUserIds,
          organizationId: orgId,
          type: "reminder",
          typeGroup: "leave",
          title: "Monthly Leave Automation Completed",
          body: `Automated leave allocation processed for ${yearMonth}: ${orgProcessed} credits applied, ${orgSkipped} skipped/deduped.`,
          link: "/hr/leave",
          entityType: "leave_balances",
          dedupeKey: `monthly-accrual-hr:${orgId}:${yearMonth}`,
        });
      }
    }

    return NextResponse.json({
      success: true,
      year_month: yearMonth,
      organizations_processed: orgSummaries.length,
      processed_credits: totalProcessed,
      skipped_or_deduped: totalSkipped,
      is_year_end_period: isYearEnd,
      organizations: orgSummaries,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error during leave automation." },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
