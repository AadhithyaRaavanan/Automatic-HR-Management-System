import "server-only";

import { sendEarlyCheckoutEmail } from "@/lib/email/resend";

export interface EarlyCheckoutAdminTarget {
  userId: string;
  email: string;
  fullName: string | null;
}

export interface EarlyCheckoutAlertInput {
  adminClient: any;
  organizationId: string | null;
  sessionId: string;
  employee: {
    id: string;
    fullName: string;
    email: string;
    employeeNumber?: string | null;
    departmentName?: string | null;
    timezone: string;
  };
  checkInAtIso: string;
  checkOutAtIso: string;
  workedMinutes: number;
  targetMinutes: number;
  shortfallMinutes: number;
  reason?: string | null;
  allowSelfAlert?: boolean;
}

export function formatHoursMins(totalMinutes: number): string {
  const safe = Math.max(0, Math.round(totalMinutes));
  const h = Math.floor(safe / 60);
  const m = safe % 60;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

export function formatShortfallSummary(workedMinutes: number, targetMinutes: number): {
  workedFormatted: string;
  targetFormatted: string;
  shortfallMinutes: number;
  shortfallFormatted: string;
  summaryText: string;
} {
  const workedFormatted = formatHoursMins(workedMinutes);
  const targetFormatted = formatHoursMins(targetMinutes);
  const shortfallMinutes = Math.max(0, Math.round(targetMinutes - workedMinutes));
  const shortfallFormatted = formatHoursMins(shortfallMinutes);
  return {
    workedFormatted,
    targetFormatted,
    shortfallMinutes,
    shortfallFormatted,
    summaryText: `Worked ${workedFormatted} of ${targetFormatted} target`,
  };
}

export function formatTimeInDeclaredTimezone(iso: string, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: timezone || "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

async function resolveOrganizationAdmins(
  adminClient: any,
  organizationId: string | null,
  excludeUserId: string | null
): Promise<EarlyCheckoutAdminTarget[]> {
  const adminIds = new Set<string>();

  try {
    let omQuery = adminClient
      .from("organization_members")
      .select("user_id, role, status")
      .eq("role", "admin")
      .eq("status", "active");
    if (organizationId) {
      omQuery = omQuery.eq("organization_id", organizationId);
    }
    const { data: omRows } = await omQuery;
    for (const row of omRows || []) {
      if (row?.user_id) adminIds.add(String(row.user_id));
    }
  } catch {}

  if (adminIds.size === 0) {
    try {
      const { data: urRows } = await adminClient
        .from("user_roles")
        .select("user_id, role")
        .eq("role", "admin");
      for (const row of urRows || []) {
        if (row?.user_id) adminIds.add(String(row.user_id));
      }
    } catch {}
  }

  const candidateIds = Array.from(adminIds).filter((id) => !excludeUserId || id !== excludeUserId);
  if (candidateIds.length === 0) return [];

  const empInfoMap = new Map<string, { email: string; fullName: string | null }>();
  try {
    let empQuery = adminClient
      .from("employees")
      .select("id, full_name, email")
      .in("id", candidateIds);
    if (organizationId) {
      empQuery = empQuery.eq("organization_id", organizationId);
    }
    const empRes = await empQuery;
    if (!empRes?.error && Array.isArray(empRes?.data)) {
      for (const e of empRes.data) {
        if (e?.id) {
          empInfoMap.set(e.id, { email: e.email || "", fullName: e.full_name || null });
        }
      }
    } else if (empRes?.error) {
      const fallbackEmp = await adminClient
        .from("employees")
        .select("id, full_name, email")
        .in("id", candidateIds);
      for (const e of fallbackEmp?.data || []) {
        if (e?.id) {
          empInfoMap.set(e.id, { email: e.email || "", fullName: e.full_name || null });
        }
      }
    }
  } catch {}

  const targets: EarlyCheckoutAdminTarget[] = [];
  const seenEmails = new Set<string>();

  for (const adminId of candidateIds) {
    let info = empInfoMap.get(adminId);
    if (!info?.email) {
      try {
        const authRes = await adminClient.auth?.admin?.getUserById?.(adminId);
        const u = authRes?.data?.user;
        if (u?.email) {
          info = {
            email: u.email,
            fullName:
              info?.fullName ||
              u.user_metadata?.full_name ||
              u.user_metadata?.name ||
              null,
          };
        }
      } catch {}
    }

    const cleanEmail = info?.email?.trim().toLowerCase() || "";
    if (cleanEmail && seenEmails.has(cleanEmail)) continue;
    if (cleanEmail) seenEmails.add(cleanEmail);

    targets.push({
      userId: adminId,
      email: info?.email || "",
      fullName: info?.fullName || null,
    });
  }

  return targets;
}

async function insertAdminNotification(
  adminClient: any,
  payload: {
    userId: string;
    organizationId: string | null;
    title: string;
    body: string;
    link: string;
    employeeId: string;
    dedupeKey: string;
  }
) {
  const fullRow: Record<string, any> = {
    user_id: payload.userId,
    type: "early_checkout",
    title: payload.title,
    body: payload.body,
    link: payload.link,
    entity_type: "employee",
    entity_id: payload.employeeId,
    actor_id: payload.employeeId,
    read_at: null,
    dedupe_key: payload.dedupeKey,
  };
  if (payload.organizationId) {
    fullRow.organization_id = payload.organizationId;
  }

  let res = await adminClient.from("notifications").insert(fullRow);
  if (!res?.error) return;

  // Retry with 'missed_checkout' if CHECK constraint restricts notification.type
  if (res.error.code === "23514" || /check constraint/i.test(String(res.error.message || ""))) {
    res = await adminClient.from("notifications").insert({
      ...fullRow,
      type: "missed_checkout",
    });
    if (!res?.error) return;
  }

  // Fallback to starter schema columns (user_id, type, title, body, read_at)
  if (
    res.error.code === "PGRST204" ||
    res.error.code === "42703" ||
    /column .* does not exist|schema cache/i.test(String(res.error.message || ""))
  ) {
    await adminClient.from("notifications").insert({
      user_id: payload.userId,
      type: "missed_checkout",
      title: payload.title,
      body: payload.body,
      read_at: null,
    });
  }
}

/**
 * Notifies all active organization admins (in-app notifications + email alerts)
 * whenever an employee checks out early before completing their shift target/end time.
 */
export async function notifyAdminsOfEarlyCheckout(input: EarlyCheckoutAlertInput): Promise<{
  notifiedAdminCount: number;
  emailedAdminCount: number;
}> {
  const excludeSelf = input.allowSelfAlert ? null : input.employee.id;
  const admins = await resolveOrganizationAdmins(
    input.adminClient,
    input.organizationId,
    excludeSelf
  );

  if (admins.length === 0) {
    return { notifiedAdminCount: 0, emailedAdminCount: 0 };
  }

  const workedFormatted = formatHoursMins(input.workedMinutes);
  const targetFormatted = formatHoursMins(input.targetMinutes);
  const shortfallFormatted = formatHoursMins(input.shortfallMinutes);
  const checkInAtFormatted = formatTimeInDeclaredTimezone(
    input.checkInAtIso,
    input.employee.timezone
  );
  const checkOutAtFormatted = formatTimeInDeclaredTimezone(
    input.checkOutAtIso,
    input.employee.timezone
  );

  const title = `Early Sign-Out Alert: ${input.employee.fullName} checked out early (${workedFormatted} / ${targetFormatted})`;
  const deptPart = input.employee.departmentName ? ` (${input.employee.departmentName})` : "";
  const reasonPart = input.reason ? ` Reason: ${input.reason}` : "";
  const body = `${input.employee.fullName}${deptPart} checked out early at ${checkOutAtFormatted}. Worked ${workedFormatted} of ${targetFormatted} target (${shortfallFormatted} short).${reasonPart}`;
  const link = `/employees/${input.employee.id}`;

  let notifiedAdminCount = 0;
  let emailedAdminCount = 0;

  await Promise.all(
    admins.map(async (admin) => {
      try {
        await insertAdminNotification(input.adminClient, {
          userId: admin.userId,
          organizationId: input.organizationId,
          title,
          body,
          link,
          employeeId: input.employee.id,
          dedupeKey: `early_checkout:${input.sessionId}:${admin.userId}`,
        });
        notifiedAdminCount += 1;
      } catch (notifErr: any) {
        console.error(
          `[EarlyCheckoutAlert] Failed to create notification for admin ${admin.userId}:`,
          notifErr?.message || notifErr
        );
      }

      if (admin.email) {
        try {
          const emailRes = await sendEarlyCheckoutEmail({
            to: admin.email,
            adminName: admin.fullName,
            employeeId: input.employee.id,
            employeeNumber: input.employee.employeeNumber,
            employeeName: input.employee.fullName,
            employeeEmail: input.employee.email,
            departmentName: input.employee.departmentName,
            timezone: input.employee.timezone,
            checkInAtFormatted,
            checkOutAtFormatted,
            workedFormatted,
            targetFormatted,
            shortfallFormatted,
            reason: input.reason,
          });
          if (emailRes.success) {
            emailedAdminCount += 1;
          } else {
            console.error(
              `[EarlyCheckoutAlert] Email delivery failed for ${admin.email}:`,
              emailRes.error
            );
          }
        } catch (emailErr: any) {
          console.error(
            `[EarlyCheckoutAlert] Email error for ${admin.email}:`,
            emailErr?.message || emailErr
          );
        }
      }
    })
  );

  return { notifiedAdminCount, emailedAdminCount };
}
