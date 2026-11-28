import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "./notify";

export interface BirthdayEmployee {
  employeeId: string;
  organizationId: string;
  fullName: string;
  email: string;
  avatarUrl?: string | null;
  dob: string; // "YYYY-MM-DD"
  birthMonth: number; // 1-12
  birthDay: number; // 1-31
  dateKeyThisYear: string; // "YYYY-MM-DD"
  isToday: boolean;
}

/**
 * Resolves today's date formatted as YYYY-MM-DD in Asia/Kolkata timezone.
 */
export function getKolkataDateString(refDate: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(refDate);
}

/**
 * Fetches verified/approved employees with DOB, scoped to an organization when provided.
 */
export async function getVerifiedEmployeeBirthdays(
  organizationId?: string | null
): Promise<BirthdayEmployee[]> {
  try {
    const todayKolkata = getKolkataDateString();
    const currentYear = parseInt(todayKolkata.slice(0, 4), 10);

    let empQuery = (supabaseAdmin.from("employees") as any)
      .select("id, organization_id, full_name, email, avatar_url, status")
      .eq("status", "active");

    if (organizationId) {
      empQuery = empQuery.eq("organization_id", organizationId);
    }

    const { data: emps, error: empErr } = await empQuery;
    if (empErr || !emps || emps.length === 0) {
      return [];
    }

    const empIds = emps.map((e: any) => e.id);
    const { data: onbProfiles } = await (supabaseAdmin as any)
      .from("onboarding_profiles")
      .select("user_id, full_name, dob, status")
      .in("user_id", empIds)
      .not("dob", "is", null);

    const dobMap = new Map<string, string>();
    (onbProfiles || []).forEach((p: any) => {
      if (p.dob && (p.status === "approved" || p.status === "COMPLETED" || p.status === "VERIFIED")) {
        dobMap.set(p.user_id, p.dob);
      }
    });

    const birthdays: BirthdayEmployee[] = [];
    for (const emp of emps) {
      const dob = dobMap.get(emp.id);
      if (!dob) continue;
      const parts = dob.split("-");
      if (parts.length < 3) continue;
      const birthMonth = parseInt(parts[1], 10);
      const birthDay = parseInt(parts[2], 10);
      if (isNaN(birthMonth) || isNaN(birthDay)) continue;

      const dateKeyThisYear = `${currentYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`;
      birthdays.push({
        employeeId: emp.id,
        organizationId: emp.organization_id,
        fullName: emp.full_name,
        email: emp.email,
        avatarUrl: emp.avatar_url,
        dob,
        birthMonth,
        birthDay,
        dateKeyThisYear,
        isToday: dateKeyThisYear === todayKolkata,
      });
    }

    return birthdays;
  } catch (err) {
    console.error("[getVerifiedEmployeeBirthdays] Error:", err);
    return [];
  }
}

/**
 * Checks for birthdays matching targetDate and dispatches strictly WITHIN each celebrant's own organization.
 */
export async function dispatchBirthdayNotifications(
  targetDateIso?: string,
  organizationId?: string | null
): Promise<{
  dateChecked: string;
  birthdaysCount: number;
  celebrantsNotified: string[];
  colleaguesNotifiedCount: number;
}> {
  const dateStr = targetDateIso || getKolkataDateString();
  const currentMonth = parseInt(dateStr.slice(5, 7), 10);
  const currentDay = parseInt(dateStr.slice(8, 10), 10);

  const allBirthdays = await getVerifiedEmployeeBirthdays(organizationId);
  const todaysCelebrants = allBirthdays.filter(
    (b) => b.birthMonth === currentMonth && b.birthDay === currentDay
  );

  if (todaysCelebrants.length === 0) {
    return {
      dateChecked: dateStr,
      birthdaysCount: 0,
      celebrantsNotified: [],
      colleaguesNotifiedCount: 0,
    };
  }

  let empQuery = (supabaseAdmin.from("employees") as any)
    .select("id, organization_id, full_name, email")
    .eq("status", "active");
  if (organizationId) {
    empQuery = empQuery.eq("organization_id", organizationId);
  }
  const { data: allActiveEmps } = await empQuery;
  const activeEmployees = allActiveEmps || [];
  const celebrantsNotified: string[] = [];
  let totalColleaguesNotified = 0;

  for (const celebrant of todaysCelebrants) {
    const firstName = celebrant.fullName.split(" ")[0];
    celebrantsNotified.push(celebrant.fullName);

    try {
      await notify({
        userIds: [celebrant.employeeId],
        organizationId: celebrant.organizationId,
        type: "reminder",
        title: `🎂 Happy Birthday, ${firstName}!`,
        body: "Wishing you a wonderful and joyful birthday from everyone on your team! 🎉",
        link: "/dashboard",
        entityType: "birthday",
        entityId: celebrant.employeeId,
        dedupeKey: `birthday-self:${celebrant.employeeId}:${dateStr}`,
        forceEmail: true,
      });
    } catch (selfErr) {
      console.error(`[dispatchBirthdayNotifications] Self notify failed:`, selfErr);
    }

    // Colleagues STRICTLY in the SAME organization as the celebrant
    const colleagueIds = activeEmployees
      .filter((e: any) => e.organization_id === celebrant.organizationId && e.id !== celebrant.employeeId)
      .map((e: any) => e.id);

    if (colleagueIds.length > 0) {
      try {
        await notify({
          userIds: colleagueIds,
          organizationId: celebrant.organizationId,
          type: "reminder",
          title: `🎉 Today is ${celebrant.fullName}'s Birthday!`,
          body: `Today is ${celebrant.fullName}'s Birthday! Join the team in wishing them a very Happy Birthday! 🎂`,
          link: "/attendance",
          entityType: "birthday",
          entityId: celebrant.employeeId,
          dedupeKey: `birthday-colleague:${celebrant.employeeId}:${dateStr}`,
          forceEmail: true,
        });
        totalColleaguesNotified += colleagueIds.length;
      } catch (colleagueErr) {
        console.error(`[dispatchBirthdayNotifications] Colleague notify failed:`, colleagueErr);
      }
    }
  }

  return {
    dateChecked: dateStr,
    birthdaysCount: todaysCelebrants.length,
    celebrantsNotified,
    colleaguesNotifiedCount: totalColleaguesNotified,
  };
}

/**
 * Sends example notifications scoped strictly to caller's organization.
 */
export async function sendAdminExampleBirthdayNotifications(
  adminUserId: string,
  organizationId: string
): Promise<boolean> {
  try {
    if (!organizationId) return false;
    const { data: adminUser } = await (supabaseAdmin.from("employees") as any)
      .select("full_name")
      .eq("id", adminUserId)
      .eq("organization_id", organizationId)
      .maybeSingle();

    const adminName = adminUser?.full_name?.split(" ")[0] || "Admin";
    const notif1 = {
      user_id: adminUserId,
      type: "reminder",
      title: `🎂 Happy Birthday, ${adminName}!`,
      body: "Example birthday celebration notification.",
      link: "/dashboard",
      organization_id: organizationId,
      metadata: { subType: "birthday_celebration", isExample: true },
    };

    const notif2 = {
      user_id: adminUserId,
      type: "reminder",
      title: "🎉 Team Birthday Reminder",
      body: "Example colleague birthday announcement notification.",
      link: "/attendance",
      organization_id: organizationId,
      metadata: { subType: "birthday_announcement", isExample: true },
    };

    const { error } = await (supabaseAdmin.from("notifications") as any).insert([notif1, notif2]);
    return !error;
  } catch {
    return false;
  }
}
