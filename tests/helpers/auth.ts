import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { createChunks } from "@supabase/ssr";
import { generateSync } from "otplib";

export type RoleName = "admin" | "hr" | "manager" | "employee";

export interface RoleCredentials {
  email: string;
  password: string;
  totpSecret?: string;
}

export function loadEnvTest(): Record<string, string | undefined> {
  const envPath = path.resolve(process.cwd(), ".env.test");
  const envMap: Record<string, string> = {};
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        envMap[trimmed.slice(0, eq).trim()] = trimmed
          .slice(eq + 1)
          .trim()
          .replace(/^["']|["']$/g, "");
      }
    }
  }
  return { ...envMap, ...process.env };
}

export function getRoleCredentials(role: RoleName): RoleCredentials {
  const env = loadEnvTest();
  switch (role) {
    case "admin":
      return {
        email: env.TEST_ADMIN_EMAIL || "test_admin@zenxea.com",
        password: env.TEST_ADMIN_PASSWORD || "TestAdmin123!#Zen",
        totpSecret: env.TEST_ADMIN_TOTP_SECRET,
      };
    case "hr":
      return {
        email: env.TEST_HR_EMAIL || "test_hr@zenxea.com",
        password: env.TEST_HR_PASSWORD || "TestHr123!#Zen",
        totpSecret: env.TEST_HR_TOTP_SECRET,
      };
    case "manager":
      return {
        email: env.TEST_MANAGER_EMAIL || "test_manager@zenxea.com",
        password: env.TEST_MANAGER_PASSWORD || "TestManager123!#Zen",
      };
    case "employee":
      return {
        email: env.TEST_EMPLOYEE_EMAIL || "test_employee@zenxea.com",
        password: env.TEST_EMPLOYEE_PASSWORD || "TestEmployee123!#Zen",
      };
  }
}

export function getStorageStatePath(role: RoleName): string {
  const dir = path.resolve(process.cwd(), "tests/.auth");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, `${role}.json`);
}

export async function loginAndGetSession(role: RoleName): Promise<Session> {
  const env = loadEnvTest();
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || "https://bycyebxvxhmhelrvglvf.supabase.co";
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const creds = getRoleCredentials(role);

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
    email: creds.email,
    password: creds.password,
  });

  if (signInErr || !signInData.session) {
    throw new Error(`Sign-in failed for ${role} (${creds.email}): ${signInErr?.message}`);
  }

  let finalSession = signInData.session;

  // Elevate to AAL2 if TOTP secret exists
  if (creds.totpSecret) {
    try {
      const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
      const superAdmin = createClient(supabaseUrl, serviceKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      });
      const { data: factorList } = await superAdmin.auth.admin.mfa.listFactors({
        userId: signInData.user.id,
      });
      const verifiedFactor = factorList?.factors?.find((f: any) => f.status === "verified");
      if (verifiedFactor) {
        const code = generateSync({ secret: creds.totpSecret });
        const { data: verifyData, error: verifyErr } = await anon.auth.mfa.challengeAndVerify({
          factorId: verifiedFactor.id,
          code,
        });
        if (!verifyErr && verifyData?.access_token) {
          finalSession = {
            ...finalSession,
            access_token: verifyData.access_token,
            refresh_token: verifyData.refresh_token,
          };
        }
      }
    } catch {
      // Proceed with current session
    }
  }

  return finalSession;
}

export async function ensureStorageState(role: RoleName): Promise<string> {
  const filePath = getStorageStatePath(role);

  // Re-generate if older than 20 minutes
  if (fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const ageMinutes = (Date.now() - stats.mtimeMs) / (60 * 1000);
    if (ageMinutes < 20) {
      return filePath;
    }
  }

  const session = await loginAndGetSession(role);
  const cookieBaseName = "sb-bycyebxvxhmhelrvglvf-auth-token";
  const sessionString = JSON.stringify(session);
  const chunks = createChunks(cookieBaseName, sessionString);

  const domain = "pulse.zenxea.com";
  const expires = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days

  const cookies = chunks.map((chunk) => ({
    name: chunk.name,
    value: chunk.value,
    domain,
    path: "/",
    expires,
    httpOnly: false,
    secure: true,
    sameSite: "Lax" as const,
  }));

  const storageState = {
    cookies,
    origins: [
      {
        origin: "https://pulse.zenxea.com",
        localStorage: [
          {
            name: `${cookieBaseName}`,
            value: sessionString,
          },
        ],
      },
    ],
  };

  fs.writeFileSync(filePath, JSON.stringify(storageState, null, 2), "utf-8");
  return filePath;
}
