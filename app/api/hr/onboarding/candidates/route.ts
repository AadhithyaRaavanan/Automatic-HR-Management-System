import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    let response = NextResponse.next();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
      {
        cookies: {
          getAll() {
            return request.cookies.getAll();
          },
          setAll(cookiesToSet: Array<{ name: string; value: string; options?: any }>) {
            cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
            response = NextResponse.next();
            cookiesToSet.forEach(({ name, value, options }) =>
              response.cookies.set(name, value, options)
            );
          },
        },
      }
    );

    const { data: { user }, error: authErr } = await supabase.auth.getUser();
    if (authErr || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: callerEmp } = await (supabaseAdmin.from("employees") as any)
      .select("user_role, role")
      .eq("id", user.id)
      .maybeSingle();

    const role = (callerEmp?.user_role || callerEmp?.role || user.user_metadata?.user_role || "").toLowerCase();
    if (role !== "admin" && role !== "hr") {
      return NextResponse.json({ error: "Forbidden: Restricted to HR and Administrators." }, { status: 403 });
    }

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
