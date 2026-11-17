import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { listCandidateDocs } from "@/lib/onboarding-storage";

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

    // Check profiles completion status
    const { data: profile } = await (supabaseAdmin as any)
      .from("profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();

    // Fetch onboarding profile data
    const { data: onboardingProfile } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();

    // Fetch employee data joined with department and job title
    const { data: employee } = await (supabaseAdmin.from("employees") as any)
      .select(`
        id,
        full_name,
        email,
        phone,
        emergency_contact,
        department_id,
        job_title_id,
        status,
        onboarding_completed,
        departments:department_id(name),
        job_titles:job_title_id(title_name)
      `)
      .eq("id", user.id)
      .maybeSingle();

    // Fetch uploaded documents with signed URLs and status
    const documents = await listCandidateDocs(user.id).catch(() => []);

    const employeeIdFormatted = employee?.id
      ? `EMP-${employee.id.slice(0, 6).toUpperCase()}`
      : `EMP-${user.id.slice(0, 6).toUpperCase()}`;

    const userRole = (user.app_metadata?.user_role || user.user_metadata?.role || "employee").toLowerCase();

    return NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: employee?.full_name || user.user_metadata?.full_name || "",
        employeeId: employeeIdFormatted,
        rawEmployeeId: employee?.id || user.id,
        department: employee?.departments?.name || "General",
        designation: employee?.job_titles?.title_name || "Employee",
        role: userRole,
      },
      profile: {
        onboarding_completed: Boolean(profile?.onboarding_completed || employee?.onboarding_completed),
        tutorial_completed: Boolean(profile?.tutorial_completed),
      },
      onboardingProfile: onboardingProfile || null,
      documents,
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load onboarding profile." },
      { status: 500 }
    );
  }
}
