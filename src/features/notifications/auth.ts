import { NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";

export async function getNotificationCaller(request: NextRequest) {
  const authHeader = request.headers.get("Authorization");
  let user = null;

  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    try {
      const { data: tokenUser } = await supabaseAdmin.auth.getUser(token);
      user = tokenUser?.user || null;
    } catch {}
  }

  if (!user) {
    try {
      const supabase = createServerClient<Database>(
        process.env.NEXT_PUBLIC_SUPABASE_URL || "https://dummy-project.supabase.co",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy-anon-key",
        {
          cookies: {
            getAll() {
              return request.cookies.getAll();
            },
            setAll() {},
          },
        }
      );
      const { data: cookieUser } = await supabase.auth.getUser();
      user = cookieUser?.user || null;
    } catch {}
  }

  return user;
}
