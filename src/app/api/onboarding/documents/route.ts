import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { listCandidateDocs } from "@/features/onboarding/storage";
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

    const { searchParams } = new URL(request.url);
    const requestedUserId = searchParams.get("userId") || user.id;

    if (requestedUserId !== user.id) {
      // Must be HR or Admin to view another user's onboarding documents
      const { data: emp } = await (supabaseAdmin.from("employees") as any)
        .select("user_role, role")
        .eq("id", user.id)
        .maybeSingle();

      const role = (emp?.user_role || emp?.role || user.user_metadata?.user_role || "").toLowerCase();
      if (role !== "admin" && role !== "hr") {
        return NextResponse.json({ error: "Forbidden: Cannot view other candidates' documents." }, { status: 403 });
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
