import { NextRequest, NextResponse } from "next/server";
import { getNotificationCaller } from "@/features/notifications/auth";
import { supabaseAdmin } from "@/lib/supabase/admin";
import {
  NotificationTypeGroup,
  DEFAULT_PREFERENCES,
} from "@/features/notifications/types";
import { requireApprovedUser } from "@/features/auth/require-approved-user";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const user = await getNotificationCaller(request);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: savedPrefs, error } = await (supabaseAdmin as any)
      .from("notification_preferences")
      .select("*")
      .eq("user_id", user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const savedMap = new Map<string, { in_app: boolean; email: boolean }>();
    (savedPrefs || []).forEach((p: any) => {
      savedMap.set(p.type_group, {
        in_app: Boolean(p.in_app),
        email: Boolean(p.email),
      });
    });

    const groups: NotificationTypeGroup[] = [
      "leave",
      "requests",
      "tasks",
      "onboarding",
      "kpi",
      "announcements",
      "security",
      "reminders",
    ];

    const preferences = groups.map((g) => {
      const saved = savedMap.get(g);
      const def = DEFAULT_PREFERENCES[g];
      return {
        type_group: g,
        in_app: g === "security" ? true : (saved ? saved.in_app : def.in_app),
        email: g === "security" ? true : (saved ? saved.email : def.email),
        lockRequired: g === "security",
      };
    });

    return NextResponse.json({ preferences });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const approvedCheck = await requireApprovedUser(request);
    if ("response" in approvedCheck) {
      return approvedCheck.response;
    }

    const user = approvedCheck.user;

    const body = await request.json().catch(() => ({}));
    const { type_group, in_app, email } = body;

    if (!type_group) {
      return NextResponse.json({ error: "type_group is required" }, { status: 400 });
    }

    // Security cannot be turned off
    const effectiveInApp = type_group === "security" ? true : Boolean(in_app);
    const effectiveEmail = type_group === "security" ? true : Boolean(email);

    const nowIso = new Date().toISOString();
    const { data, error } = await (supabaseAdmin as any)
      .from("notification_preferences")
      .upsert({
        user_id: user.id,
        type_group,
        in_app: effectiveInApp,
        email: effectiveEmail,
        updated_at: nowIso,
      })
      .select();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true, preference: data?.[0] });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal server error" },
      { status: 500 }
    );
  }
}
