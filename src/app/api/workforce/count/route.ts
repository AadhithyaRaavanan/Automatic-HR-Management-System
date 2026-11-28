import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { resolveTenantCaller } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET(request: NextRequest) {
  try {
    const caller = await resolveTenantCaller(request, {
      skipOnboardingCheck: true,
      requireAal2ForPrivileged: false,
    });
    if ("response" in caller) {
      return caller.response;
    }

    const { count, error } = await (supabaseAdmin as any)
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", caller.context.organizationId)
      .eq("status", "active");

    if (error) {
      return NextResponse.json({ count: 0 });
    }

    return NextResponse.json({ count: typeof count === "number" ? count : 0 });
  } catch {
    return NextResponse.json({ count: 0 }, { status: 500 });
  }
}
