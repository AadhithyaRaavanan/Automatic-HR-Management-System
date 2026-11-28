import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "@/features/notifications/notify";
import { getHrUsers } from "@/features/notifications/recipients";
import { ORG_SELECTION_COOKIE } from "@/features/auth/tenant-context";

export const dynamic = "force-dynamic";

function isStrongPassword(password: string): string | null {
  if (!password || password.length < 8) {
    return "Password must be at least 8 characters long.";
  }
  if (!/[A-Z]/.test(password) || !/[a-z]/.test(password) || !/\d/.test(password)) {
    return "Password must include uppercase, lowercase, and a number.";
  }
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) {
    return "Password must include at least one special character.";
  }
  return null;
}

export async function POST(request: NextRequest) {
  try {
    let response = NextResponse.next();
    const supabase = createServerClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
    let user: any = null;
    let bearerJwtPayload: any = null;
    if (authHeader?.startsWith("Bearer ")) {
      const token = authHeader.substring(7);
      const { data: tokenUser } = await supabaseAdmin.auth.getUser(token);
      user = tokenUser?.user || null;
      try {
        bearerJwtPayload = JSON.parse(Buffer.from(token.split(".")[1] || "", "base64").toString("utf8"));
      } catch {}
    }
    if (!user) {
      const { data: sessionData } = await supabase.auth.getSession();
      if (sessionData?.session?.access_token) {
        try {
          bearerJwtPayload = JSON.parse(
            Buffer.from(sessionData.session.access_token.split(".")[1] || "", "base64").toString("utf8")
          );
        } catch {}
      }
      const { data: cookieUser } = await supabase.auth.getUser();
      user = cookieUser?.user || null;
    }
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { password, currentPassword } = await request.json().catch(() => ({}));
    const strengthErr = isStrongPassword(password);
    if (strengthErr) {
      return NextResponse.json({ error: strengthErr }, { status: 400 });
    }

    const wasForcedChange = Boolean(
      (user.user_metadata as any)?.must_change_password ||
        (user.app_metadata as any)?.must_change_password
    );

    // Check if the session was recently established via recovery/OTP flow
    const amrEntries: Array<{ method?: string; timestamp?: number }> = Array.isArray(bearerJwtPayload?.amr)
      ? bearerJwtPayload.amr
      : [];
    const recentRecoveryProof = amrEntries.some((entry) => {
      if (!entry?.method) return false;
      const isRecoveryMethod = ["otp", "recovery", "magiclink"].includes(String(entry.method).toLowerCase());
      if (!isRecoveryMethod) return false;
      const tsMs = typeof entry.timestamp === "number" ? entry.timestamp * 1000 : Date.now();
      return Date.now() - tsMs <= 15 * 60 * 1000;
    });

    // Enforce recent proof: normal password changes must verify currentPassword
    if (!wasForcedChange && !recentRecoveryProof) {
      if (!currentPassword || typeof currentPassword !== "string") {
        return NextResponse.json(
          { error: "Current password is required to change your password." },
          { status: 400 }
        );
      }
      if (user.email) {
        const checkClient = createServerClient<Database>(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
          {
            cookies: {
              getAll() {
                return [];
              },
              setAll() {},
            },
          }
        );
        const { error: verifyPwdErr } = await checkClient.auth.signInWithPassword({
          email: user.email,
          password: currentPassword,
        });
        if (verifyPwdErr) {
          return NextResponse.json(
            { error: "Current password is incorrect." },
            { status: 403 }
          );
        }
      }
    }

    const nowIso = new Date().toISOString();

    const { error: updateErr } = await supabaseAdmin.auth.admin.updateUserById(user.id, {
      password,
      app_metadata: {
        ...user.app_metadata,
        must_change_password: false,
      },
      user_metadata: {
        ...user.user_metadata,
        must_change_password: false,
        temp_password_expires_at: null,
        password_last_changed_at: nowIso,
      },
    });

    if (updateErr) {
      return NextResponse.json({ error: updateErr.message }, { status: 500 });
    }

    // Write durable audit log across caller's active organizations
    const requestedOrg = request.cookies.get(ORG_SELECTION_COOKIE)?.value || null;
    const { data: members } = await (supabaseAdmin.from("organization_members") as any)
      .select("organization_id")
      .eq("user_id", user.id)
      .eq("status", "active");

    const orgIds = Array.from(
      new Set<string>((members || []).map((m: any) => m.organization_id).filter(Boolean))
    );
    const scopedOrgIds =
      requestedOrg && orgIds.includes(requestedOrg) ? [requestedOrg] : orgIds;

    for (const orgId of scopedOrgIds) {
      await supabaseAdmin.from("audit_logs").insert({
        organization_id: orgId,
        actor_id: user.id,
        action: "USER_PASSWORD_CHANGED",
        table_name: "auth.users",
        record_id: user.id,
        old_data: null,
        new_data: {
          changed_at: nowIso,
          via_recovery: !wasForcedChange && recentRecoveryProof,
          via_forced_reset: wasForcedChange,
        },
      });
    }

    try {
      await notify({
        userIds: [user.id],
        organizationId: scopedOrgIds[0] || null,
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

    if (wasForcedChange) {
      for (const orgId of scopedOrgIds) {
        try {
          const hrUsers = await getHrUsers(orgId);
          if (hrUsers.length > 0) {
            const name = (user.user_metadata as any)?.full_name || user.email;
            await notify({
              userIds: hrUsers,
              organizationId: orgId,
              type: "onboarding_invite_accepted",
              typeGroup: "onboarding",
              title: "Workplace Invite Accepted",
              body: `${name} has activated their invitation and completed their initial password setup.`,
              link: "/hr/onboarding",
              entityType: "users",
              entityId: user.id,
              actorId: user.id,
            });
          }
        } catch {}
      }
    }

    return NextResponse.json({
      success: true,
      message: "Password updated successfully.",
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Failed to update password." },
      { status: 500 }
    );
  }
}
