import { supabaseAdmin } from "@/lib/supabase/admin";
import { sendNotificationEmail } from "@/lib/email/resend";
import {
  NotificationTypeGroup,
  DEFAULT_PREFERENCES,
  resolveTypeGroup,
} from "./types";

export interface NotifyParams {
  userIds: string[];
  type: string;
  typeGroup?: NotificationTypeGroup;
  title: string;
  body: string;
  link?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  actorId?: string | null;
  dedupeKey?: string | null;
  forceEmail?: boolean;
}

export interface NotifyResult {
  success: boolean;
  inAppCount: number;
  emailCount: number;
  error?: string;
}

function isQuietHoursKolkata(): boolean {
  try {
    const kolkataFormatter = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Kolkata",
      hour: "numeric",
      hour12: false,
    });
    const currentHour = parseInt(kolkataFormatter.format(new Date()), 10);
    // Quiet hours: 21:00 to 08:00 IST
    return currentHour >= 21 || currentHour < 8;
  } catch {
    return false;
  }
}

/**
 * Dispatches an in-app and optional email notification to specified users.
 * - Filters out the triggering actor.
 * - Deduplicates by dedupeKey.
 * - Respects user preferences.
 * - Adheres to quiet hours (21:00 - 08:00 IST) for reminder emails.
 * - NEVER throws or blocks caller; always caught and logged.
 */
export async function notify(params: NotifyParams): Promise<NotifyResult> {
  try {
    const {
      userIds,
      type,
      typeGroup: explicitGroup,
      title,
      body,
      link,
      entityType,
      entityId,
      actorId,
      dedupeKey,
      forceEmail = false,
    } = params;

    if (!userIds || userIds.length === 0 || !title) {
      return { success: true, inAppCount: 0, emailCount: 0 };
    }

    // 1. Filter out the actor (never notify yourself for your own action)
    const targetUserIds = Array.from(
      new Set(userIds.filter((id) => id && id !== actorId))
    );

    if (targetUserIds.length === 0) {
      return { success: true, inAppCount: 0, emailCount: 0 };
    }

    const group = explicitGroup || resolveTypeGroup(type);
    const isSecurity = group === "security";
    const groupDefaults = DEFAULT_PREFERENCES[group] || { in_app: true, email: false };

    // 2. Fetch user notification preferences
    let prefsMap = new Map<string, { in_app: boolean; email: boolean }>();
    try {
      const { data: prefs } = await (supabaseAdmin as any)
        .from("notification_preferences")
        .select("user_id, in_app, email")
        .in("user_id", targetUserIds)
        .eq("type_group", group);

      if (prefs) {
        prefs.forEach((p: any) => {
          prefsMap.set(p.user_id, {
            in_app: Boolean(p.in_app),
            email: Boolean(p.email),
          });
        });
      }
    } catch (prefErr) {
      console.warn("[notify] Could not fetch preferences, using defaults:", prefErr);
    }

    // 3. Resolve eligible users for in-app and email
    const quietHours = isQuietHoursKolkata();
    const allowedInAppUserIds: string[] = [];
    const allowedEmailUserIds: string[] = [];

    for (const uid of targetUserIds) {
      const userPref = prefsMap.get(uid);

      // In-app evaluation (security is locked ON)
      const allowInApp = isSecurity ? true : (userPref ? userPref.in_app : groupDefaults.in_app);
      if (allowInApp) allowedInAppUserIds.push(uid);

      // Email evaluation (security is locked ON, reminders quiet hours suppress email)
      let allowEmail = isSecurity ? true : (userPref ? userPref.email : groupDefaults.email);
      if (forceEmail) allowEmail = true;

      // Quiet hours rule: suppress reminder/announcement emails during 21:00 - 08:00 IST
      if (quietHours && (group === "reminders" || group === "announcements") && !forceEmail) {
        allowEmail = false;
      }

      if (allowEmail) allowedEmailUserIds.push(uid);
    }

    // 4. Batch Insert In-App Notifications
    let inAppCount = 0;
    if (allowedInAppUserIds.length > 0) {
      try {
        const rows = allowedInAppUserIds.map((uid) => ({
          user_id: uid,
          type,
          title,
          body,
          link: link || null,
          entity_type: entityType || null,
          entity_id: entityId || null,
          actor_id: actorId || null,
          dedupe_key: dedupeKey || null,
        }));

        const { data, error } = await (supabaseAdmin.from("notifications") as any)
          .upsert(rows, {
            onConflict: "user_id,dedupe_key",
            ignoreDuplicates: true,
          })
          .select("id");

        if (error) {
          // If upsert with onConflict on partial index has schema variation, fallback to safe insert
          console.warn("[notify] Upsert notifications error, falling back to insert:", error.message);
          const { error: insErr } = await (supabaseAdmin.from("notifications") as any).insert(rows);
          if (!insErr) inAppCount = rows.length;
        } else {
          inAppCount = (data || []).length;
        }
      } catch (insertErr) {
        console.error("[notify] Failed to insert notifications:", insertErr);
      }
    }

    // 5. Asynchronous Email Dispatch (non-blocking)
    let emailCount = 0;
    if (allowedEmailUserIds.length > 0) {
      (async () => {
        try {
          // Fetch employee emails and names
          const { data: emps } = await (supabaseAdmin.from("employees") as any)
            .select("id, email, full_name")
            .in("id", allowedEmailUserIds);

          const emailMap = new Map<string, { email: string; name?: string }>();
          if (emps) {
            emps.forEach((e: any) => {
              if (e.email) emailMap.set(e.id, { email: e.email, name: e.full_name || undefined });
            });
          }

          // For any missing from employees, fallback to auth.users
          const missingIds = allowedEmailUserIds.filter((uid) => !emailMap.has(uid));
          for (const uid of missingIds) {
            try {
              const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(uid);
              if (authUser?.user?.email) {
                emailMap.set(uid, {
                  email: authUser.user.email,
                  name: (authUser.user.user_metadata as any)?.full_name || undefined,
                });
              }
            } catch {}
          }

          // Dispatch emails
          for (const [, recipient] of Array.from(emailMap.entries())) {
            if (recipient.email) {
              await sendNotificationEmail({
                to: recipient.email,
                recipientName: recipient.name,
                title,
                body,
                link,
              }).catch((err) => {
                console.error(`[notify] Failed to send email to ${recipient.email}:`, err);
              });
              emailCount++;
            }
          }
        } catch (emailErr) {
          console.error("[notify] Error in email dispatch loop:", emailErr);
        }
      })().catch(() => {});
    }

    return {
      success: true,
      inAppCount,
      emailCount,
    };
  } catch (globalErr: any) {
    console.error("[notify] Unhandled error during notification processing:", globalErr);
    return {
      success: false,
      inAppCount: 0,
      emailCount: 0,
      error: globalErr?.message || "Notification processing failed",
    };
  }
}
