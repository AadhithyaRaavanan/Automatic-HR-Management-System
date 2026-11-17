import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/lib/notifications/notify";
import { getHrUsers } from "@/lib/notifications/recipients";

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

    const { password } = await request.json().catch(() => ({}));
    if (!password || password.length < 12) {
      return NextResponse.json(
        { error: "Password must be at least 12 characters long." },
        { status: 400 }
      );
    }

    // Update password and clear must_change_password lock via Admin client
    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
      user_metadata: {
        ...user.user_metadata,
        must_change_password: false,
        temp_password_expires_at: null,
      },
    });

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // 1. Notify user of password change (Security: in-app + email)
    try {
      await notify({
        userIds: [user.id],
        type: "security_password_changed",
        typeGroup: "security",
        title: "Account Password Changed",
        body: "Your Pulse account password was changed. If you did not make this change, please contact your administrator immediately.",
        link: "/settings",
        entityType: "users",
        entityId: user.id,
        forceEmail: true,
      });
    } catch {}

    // 2. If initial invite activation, notify HR
    if ((user.user_metadata as any)?.must_change_password) {
      try {
        const hrUsers = await getHrUsers();
        if (hrUsers.length > 0) {
          const name = (user.user_metadata as any)?.full_name || user.email;
          await notify({
            userIds: hrUsers,
            type: "onboarding_invite_accepted",
            typeGroup: "onboarding",
            title: "Workplace Invite Accepted",
            body: `${name} has activated their invitation and completed their initial password setup.`,
            link: "/hr/onboarding",
            entityType: "users",
            entityId: user.id,
          });
        }
      } catch {}
    }

    return NextResponse.json({ success: true, message: "Password updated successfully." });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update password." },
      { status: 500 }
    );
  }
}
