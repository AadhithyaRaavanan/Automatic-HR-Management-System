import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    // Query active employees count via supabaseAdmin
    const { count, error } = await supabaseAdmin
      .from("employees")
      .select("id", { count: "exact", head: true })
      .eq("status", "active");

    if (error) {
      return NextResponse.json({ count: user ? 1 : 0 });
    }

    return NextResponse.json({ count: typeof count === "number" ? count : 1 });
  } catch {
    return NextResponse.json({ count: 1 });
  }
}
