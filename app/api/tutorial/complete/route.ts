import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
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
    const isReset = body.reset === true;
    const targetStatus = isReset ? false : true;

    await Promise.all([
      (supabaseAdmin as any).from("profiles").upsert({
        id: user.id,
        user_id: user.id,
        tutorial_completed: targetStatus,
        updated_at: new Date().toISOString(),
      }, { onConflict: "id" }),
      (supabaseAdmin as any).from("employees").update({
        tutorial_completed: targetStatus,
        updated_at: new Date().toISOString(),
      }).eq("id", user.id),
    ]);

    return NextResponse.json({ success: true, tutorial_completed: targetStatus });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update tutorial status." },
      { status: 500 }
    );
  }
}
