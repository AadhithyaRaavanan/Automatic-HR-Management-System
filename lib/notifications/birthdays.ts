import { supabaseAdmin } from "@/lib/supabase/admin";
import { notify } from "./notify";
import { sendNotificationEmail } from "@/lib/email/resend";

export interface BirthdayEmployee {
  employeeId: string;
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
 * Fetches all verified/approved employees with their date of birth.
 * Combines data from onboarding_profiles and employees directory.
 */
export async function getVerifiedEmployeeBirthdays(): Promise<BirthdayEmployee[]> {
  try {
    const todayKolkata = getKolkataDateString();
    const currentYear = parseInt(todayKolkata.slice(0, 4), 10);

    // 1. Fetch active employees
    const { data: emps, error: empErr } = await (supabaseAdmin.from("employees") as any)
      .select("id, full_name, email, avatar_url, status")
      .eq("status", "active");

    if (empErr || !emps) {
      console.warn("[getVerifiedEmployeeBirthdays] Could not load employees:", empErr);
      return [];
    }

    // 2. Fetch approved onboarding profiles with dob
    const { data: onbProfiles } = await ((supabaseAdmin as any).from("onboarding_profiles"))
      .select("user_id, full_name, dob, status")
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

      // Parse YYYY-MM-DD
      const parts = dob.split("-");
      if (parts.length < 3) continue;

      const birthMonth = parseInt(parts[1], 10);
      const birthDay = parseInt(parts[2], 10);
      if (isNaN(birthMonth) || isNaN(birthDay)) continue;

      const dateKeyThisYear = `${currentYear}-${String(birthMonth).padStart(2, "0")}-${String(birthDay).padStart(2, "0")}`;
      const isToday = dateKeyThisYear === todayKolkata;

      birthdays.push({
        employeeId: emp.id,
        fullName: emp.full_name,
        email: emp.email,
        avatarUrl: emp.avatar_url,
        dob,
        birthMonth,
        birthDay,
        dateKeyThisYear,
        isToday,
      });
    }

    return birthdays;
  } catch (err) {
    console.error("[getVerifiedEmployeeBirthdays] Error:", err);
    return [];
  }
}

/**
 * Checks for birthdays matching targetDate and dispatches:
 * 1. Celebratory in-app notification & email to the birthday celebrant.
 * 2. In-app announcement & email to all other colleagues.
 */
export async function dispatchBirthdayNotifications(targetDateIso?: string): Promise<{
  dateChecked: string;
  birthdaysCount: number;
  celebrantsNotified: string[];
  colleaguesNotifiedCount: number;
}> {
  const dateStr = targetDateIso || getKolkataDateString();
  const currentMonth = parseInt(dateStr.slice(5, 7), 10);
  const currentDay = parseInt(dateStr.slice(8, 10), 10);

  const allBirthdays = await getVerifiedEmployeeBirthdays();
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

  // Fetch all active employees
  const { data: allActiveEmps } = await (supabaseAdmin.from("employees") as any)
    .select("id, full_name, email")
    .eq("status", "active");

  const activeEmployees = allActiveEmps || [];
  const celebrantsNotified: string[] = [];
  let totalColleaguesNotified = 0;

  for (const celebrant of todaysCelebrants) {
    const firstName = celebrant.fullName.split(" ")[0];
    celebrantsNotified.push(celebrant.fullName);

    // 1. Send Celebrant Self Notification & Email
    try {
      const selfTitle = `🎂 Happy Birthday, ${firstName}!`;
      const selfBody = `Wishing you a wonderful and joyful birthday from everyone at Zen Xea! Have an extraordinary year ahead! 🎉`;

      await notify({
        userIds: [celebrant.employeeId],
        type: "reminder",
        title: selfTitle,
        body: selfBody,
        link: "/dashboard",
        entityType: "birthday",
        entityId: celebrant.employeeId,
        dedupeKey: `birthday-self:${celebrant.employeeId}:${dateStr}`,
        forceEmail: true,
      });
    } catch (selfErr) {
      console.error(`[dispatchBirthdayNotifications] Failed to notify celebrant ${celebrant.fullName}:`, selfErr);
    }

    // 2. Send Colleague Announcements & Emails
    const colleagueIds = activeEmployees
      .filter((e: any) => e.id !== celebrant.employeeId)
      .map((e: any) => e.id);

    if (colleagueIds.length > 0) {
      try {
        const announcementTitle = `🎉 Today is ${celebrant.fullName}'s Birthday!`;
        const announcementBody = `Today is ${celebrant.fullName}'s Birthday! Join the team in wishing them a very Happy Birthday! 🎂 Let's celebrate together!`;

        await notify({
          userIds: colleagueIds,
          type: "reminder",
          title: announcementTitle,
          body: announcementBody,
          link: "/attendance",
          entityType: "birthday",
          entityId: celebrant.employeeId,
          dedupeKey: `birthday-colleague:${celebrant.employeeId}:${dateStr}`,
          forceEmail: true,
        });

        totalColleaguesNotified += colleagueIds.length;
      } catch (colleagueErr) {
        console.error(`[dispatchBirthdayNotifications] Failed to notify colleagues for ${celebrant.fullName}:`, colleagueErr);
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
 * Sends the Admin an example in-app notification of BOTH scenarios (only on app).
 */
export async function sendAdminExampleBirthdayNotifications(adminUserId: string): Promise<boolean> {
  try {
    const { data: adminUser } = await (supabaseAdmin.from("employees") as any)
      .select("full_name")
      .eq("id", adminUserId)
      .maybeSingle();

    const adminName = adminUser?.full_name?.split(" ")[0] || "Admin";

    // Scenario 1: Self Birthday Notification
    const notif1 = {
      user_id: adminUserId,
      type: "reminder",
      title: `🎂 Happy Birthday, ${adminName}!`,
      body: "Wishing you a wonderful and joyful birthday from everyone at Zen Xea! Have an extraordinary year ahead! 🎉 (Example Notification: Scenario 1 - Self)",
      link: "/dashboard",
      organization_id: "00000000-0000-0000-0000-000000000001",
      metadata: {
        subType: "birthday_celebration",
        isExample: true,
      },
    };

    // Scenario 2: Colleague Birthday Announcement
    const notif2 = {
      user_id: adminUserId,
      type: "reminder",
      title: "🎉 Today is James Aathithyan's Birthday!",
      body: "Today is James Aathithyan's Birthday! Join the team in wishing them a very Happy Birthday! 🎂 (Example Notification: Scenario 2 - Colleague)",
      link: "/attendance",
      organization_id: "00000000-0000-0000-0000-000000000001",
      metadata: {
        subType: "birthday_announcement",
        isExample: true,
      },
    };

    const { error } = await (supabaseAdmin.from("notifications") as any).insert([notif1, notif2]);
    if (error) {
      console.error("[sendAdminExampleBirthdayNotifications] Failed to insert notifications:", error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[sendAdminExampleBirthdayNotifications] Error:", err);
    return false;
  }
}
