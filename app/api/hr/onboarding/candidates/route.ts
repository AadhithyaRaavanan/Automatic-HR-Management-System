import { NextRequest, NextResponse } from "next/server";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const authResult = await verifyAdminRouteCaller(request, ["admin", "hr"]);
  if ("response" in authResult) {
    return authResult.response;
  }

  try {
    // Fetch onboarding profiles joined with employee information
    const { data: candidates, error: fetchErr } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select(`
        *,
        employees:user_id (
          full_name,
          email,
          status,
          department_id,
          job_title_id
        )
      `)
      .order("created_at", { ascending: false });

    if (fetchErr) {
      return NextResponse.json({ error: fetchErr.message }, { status: 500 });
    }

    return NextResponse.json({ candidates: candidates || [] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to retrieve onboarding candidates." },
      { status: 500 }
    );
  }
}
