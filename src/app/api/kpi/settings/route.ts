// ============================================================================
// /api/kpi/settings: Versioned KPI Configuration Settings for HR & Admin
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { FEATURES } from "@/lib/features";
import { getKpiCallerContext } from "@/features/kpi/auth-helper";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { KPI_CONFIG } from "@/features/kpi/config";
import { notify } from "@/features/notifications/notify";
import { getHrUsers } from "@/features/notifications/recipients";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // 1. Fetch versions history
    const { data: versions, error } = await (supabaseAdmin as any)
      .from("kpi_config_versions")
      .select("id, config, effective_from, reason, created_at, created_by, employees(full_name)")
      .order("effective_from", { ascending: false });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Active config is the latest effective as of today
    const todayIso = new Date().toISOString().slice(0, 10);
    const activeVersion = (versions || []).find((v: any) => v.effective_from <= todayIso) || null;
    const activeConfig = activeVersion?.config || KPI_CONFIG;

    return NextResponse.json({
      activeConfig,
      effectiveFrom: activeVersion?.effective_from || null,
      reason: activeVersion?.reason || null,
      versions: versions || [],
      canEdit: caller.role === "admin" || caller.role === "hr",
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to load KPI settings" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!FEATURES.KPI) {
    return NextResponse.json({ error: "KPI feature disabled" }, { status: 404 });
  }

  const { caller, errorResponse } = await getKpiCallerContext(request);
  if (errorResponse) return errorResponse;
  if (!caller) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Strictly HR and Admin only
  if (caller.role !== "admin" && caller.role !== "hr") {
    return NextResponse.json(
      { error: "Forbidden: Only administrators and HR personnel can modify KPI settings." },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const { config, effective_from, reason } = body;

    if (!config || !effective_from) {
      return NextResponse.json({ error: "config and effective_from are required" }, { status: 400 });
    }

    const trimmedReason = (reason || "").trim();
    if (trimmedReason.length < 5) {
      return NextResponse.json(
        { error: "A detailed version change reason is required (minimum 5 characters)." },
        { status: 400 }
      );
    }

    // Effective date cannot be in the past
    const todayIso = new Date().toISOString().slice(0, 10);
    if (effective_from < todayIso) {
      return NextResponse.json(
        { error: "Effective date cannot be in the past. Past periods must retain historical benchmarks." },
        { status: 400 }
      );
    }

    // Validate weights sum to 1.0 (or 100%)
    const weights: Record<string, number> = config.weights || {};
    const sum = Object.values(weights).reduce((acc, w) => acc + (Number(w) || 0), 0);
    // Allow slight floating point tolerance (e.g. 0.999 - 1.001 or 99.9 - 100.1)
    const normalizedSum = sum > 1.5 ? sum / 100 : sum;
    if (Math.abs(normalizedSum - 1.0) > 0.005) {
      return NextResponse.json(
        { error: `Weights must total 100%. Current total is ${Math.round(normalizedSum * 100)}%.` },
        { status: 400 }
      );
    }

    // Normalize weights to 0..1 scale
    const normalizedWeights: Record<string, number> = {};
    for (const [k, v] of Object.entries(weights)) {
      normalizedWeights[k] = Number(v) > 1.5 ? Number(v) / 100 : Number(v);
    }

    const fullConfig = {
      ...config,
      weights: normalizedWeights,
    };

    const { data: newVersion, error } = await (supabaseAdmin as any)
      .from("kpi_config_versions")
      .insert({
        organization_id: caller.organizationId || "00000000-0000-0000-0000-000000000000",
        config: fullConfig,
        effective_from,
        reason: trimmedReason,
        created_by: caller.userId,
      })
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    // Notify HR / Admins
    try {
      const hrAdminUserIds = await getHrUsers(caller.organizationId);
      if (hrAdminUserIds.length > 0) {
        await notify({
          userIds: hrAdminUserIds,
          type: "kpi_config_updated",
          typeGroup: "kpi",
          title: "KPI Benchmark Settings Updated",
          body: `New KPI targets & weights effective from ${effective_from}: "${trimmedReason}".`,
          link: "/admin/settings/kpi",
          entityType: "kpi_config_versions",
          entityId: newVersion?.id,
          actorId: caller.userId,
        });
      }
    } catch {}

    return NextResponse.json({ success: true, version: newVersion }, { status: 201 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to save KPI settings version" }, { status: 400 });
  }
}
