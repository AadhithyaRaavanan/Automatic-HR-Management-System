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

    const authHeader = request.headers.get("Authorization");
    let user = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { data: tokenUser } = await supabaseAdmin.auth.getUser(token);
      user = tokenUser?.user || null;
    }
    if (!user) {
      const { data: cookieUser } = await supabase.auth.getUser();
      user = cookieUser?.user || null;
    }
    if (!user) {
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

    // Fetch uploaded documents with signed URLs and status (with direct DB fallback)
    let documents: any[] = [];
    try {
      documents = await listCandidateDocs(user.id);
    } catch (docErr: any) {
      console.warn("[GET /api/onboarding/profile] listCandidateDocs failed, trying direct db fallback:", docErr?.message);
      try {
        const { data: rawDocs } = await (supabaseAdmin as any)
          .from("onboarding_documents")
          .select("*")
          .eq("user_id", user.id);
        if (rawDocs && rawDocs.length > 0) {
          documents = rawDocs.map((d: any) => ({
            id: d.id,
            doc_type: d.doc_type,
            file_name: d.file_name,
            storage_path: d.storage_path,
            file_size: Number(d.file_size || 0),
            document_status: d.document_status || "pending",
            rejection_reason: d.rejection_reason || null,
            uploaded_at: d.uploaded_at,
            signedUrl: "",
            salary_month: d.salary_month || null,
            salary_year: d.salary_year || null,
          }));
        }
      } catch { }
    }

    const employeeIdFormatted = employee?.id
      ? `EMP-${employee.id.slice(0, 6).toUpperCase()}`
      : `EMP-${user.id.slice(0, 6).toUpperCase()}`;

    const userRole = (user.app_metadata?.user_role || user.user_metadata?.role || "employee").toLowerCase();

    return NextResponse.json(
      {
        user: {
          id: user.id,
          email: user.email,
          fullName: employee?.full_name || onboardingProfile?.full_name || user.user_metadata?.full_name || "",
          employeeId: employeeIdFormatted,
          rawEmployeeId: employee?.id || user.id,
          department: employee?.departments?.name || "General",
          designation: employee?.job_titles?.title_name || "Employee",
          role: userRole,
          phone: employee?.phone || onboardingProfile?.phone || "",
          emergency_contact: employee?.emergency_contact || "",
          storage_folder: onboardingProfile?.storage_folder || null,
        },
        profile: {
          onboarding_completed: Boolean(
            (profile?.onboarding_completed || employee?.onboarding_completed) &&
            onboardingProfile?.status === "approved" &&
            employee?.status === "active"
          ),
          tutorial_completed: Boolean(profile?.tutorial_completed),
        },
        onboardingProfile: onboardingProfile || null,
        documents,
      },
      {
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
          Pragma: "no-cache",
          Expires: "0",
        },
      }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to load onboarding profile." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
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

    const authHeader = request.headers.get("Authorization");
    let user = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { data: tokenUser } = await supabaseAdmin.auth.getUser(token);
      user = tokenUser?.user || null;
    }
    if (!user) {
      const { data: cookieUser } = await supabase.auth.getUser();
      user = cookieUser?.user || null;
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const { fullName, phone, emergencyContact } = body;

    const empUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (typeof fullName === "string" && fullName.trim()) empUpdates.full_name = fullName.trim();
    if (typeof phone === "string") empUpdates.phone = phone.trim() || null;
    if (typeof emergencyContact === "string") empUpdates.emergency_contact = emergencyContact.trim() || null;

    await ((supabaseAdmin as any).from("employees"))
      .update(empUpdates)
      .eq("id", user.id);

    const onbUpdates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (empUpdates.full_name) onbUpdates.full_name = empUpdates.full_name;
    if (empUpdates.phone) onbUpdates.phone = empUpdates.phone;

    await ((supabaseAdmin as any).from("onboarding_profiles"))
      .update(onbUpdates)
      .eq("user_id", user.id);

    return NextResponse.json({ success: true, updates: empUpdates });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update profile." },
      { status: 500 }
    );
  }
}
