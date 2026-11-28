import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { createChunks } from "@supabase/ssr";
import { generateSync } from "otplib";

export type RoleName = "admin" | "hr" | "manager" | "employee";

export interface RoleCredentials {
  email: string;
  password: string;
  totpSecret?: string;
}

const DEFAULT_LOCAL_APP_ORIGIN = "http://127.0.0.1:3000";
const DEFAULT_LOCAL_SUPABASE_ORIGIN = "http://127.0.0.1:54321";
const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]", "0.0.0.0"]);

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

/**
 * Enforces that automated test credentials, fixture writes, and state-changing
 * requests only target an explicitly allowed disposable local/test origin.
 */
export function assertAllowedTestOrigin(rawUrl: string, contextLabel: string = "test operation"): string {
  const env = loadEnvTest();
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error(`[Test Origin Guard] Invalid URL "${rawUrl}" for ${contextLabel}.`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`[Test Origin Guard] Unsupported protocol "${parsed.protocol}" for ${contextLabel}.`);
  }

  const normalizedOrigin = parsed.origin.replace(/\/+$/, "");
  const hostname = parsed.hostname.toLowerCase();

  // Never permit known production hosts even if misconfigured unless an explicit test sandbox allows non-loopback hosts
  const explicitAllowlist = (env.PLAYWRIGHT_ALLOWED_TEST_ORIGINS || "")
    .split(",")
    .map((entry) => entry.trim().replace(/\/+$/, ""))
    .filter(Boolean);

  const isLoopback = LOOPBACK_HOSTS.has(hostname);
  const isExplicitlyAllowed = explicitAllowlist.includes(normalizedOrigin);

  if (!isLoopback && !isExplicitlyAllowed) {
    throw new Error(
      `[Test Origin Guard] Blocked disallowed non-test origin "${normalizedOrigin}" for ${contextLabel}. Only local loopback origins or PLAYWRIGHT_ALLOWED_TEST_ORIGINS entries are permitted.`
    );
  }

  return normalizedOrigin;
}

export function getAllowedTestBaseUrl(): string {
  const env = loadEnvTest();
  const candidate = env.PLAYWRIGHT_TEST_BASE_URL || env.NEXT_PUBLIC_APP_URL || DEFAULT_LOCAL_APP_ORIGIN;
  return assertAllowedTestOrigin(candidate, "Playwright baseURL");
}

export function getAllowedTestSupabaseUrl(): string {
  const env = loadEnvTest();
  const candidate = env.NEXT_PUBLIC_SUPABASE_URL || DEFAULT_LOCAL_SUPABASE_ORIGIN;
  return assertAllowedTestOrigin(candidate, "Supabase API origin");
}

export function createAllowedSupabaseAdmin(): SupabaseClient {
  const env = loadEnvTest();
  const supabaseUrl = getAllowedTestSupabaseUrl();
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export function createAllowedSupabaseUserClient(accessToken: string): SupabaseClient {
  const env = loadEnvTest();
  const supabaseUrl = getAllowedTestSupabaseUrl();
  const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  return createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
}

export async function sendAllowedTestApiRequest(
  pathOrUrl: string,
  init: RequestInit = {}
): Promise<Response> {
  const baseUrl = getAllowedTestBaseUrl();
  const resolvedUrl = pathOrUrl.startsWith("http://") || pathOrUrl.startsWith("https://")
    ? pathOrUrl
    : `${baseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;
  assertAllowedTestOrigin(resolvedUrl, `API request (${pathOrUrl})`);
  return fetch(resolvedUrl, init);
}

export function getRoleCredentials(role: RoleName): RoleCredentials {
  const env = loadEnvTest();
  switch (role) {
    case "admin":
      return {
        email: env.TEST_ADMIN_EMAIL || "test_admin@pulse.test",
        password: env.TEST_ADMIN_PASSWORD || "TestAdmin123!#Local",
        totpSecret: env.TEST_ADMIN_TOTP_SECRET,
      };
    case "hr":
      return {
        email: env.TEST_HR_EMAIL || "test_hr@pulse.test",
        password: env.TEST_HR_PASSWORD || "TestHr123!#Local",
        totpSecret: env.TEST_HR_TOTP_SECRET,
      };
    case "manager":
      return {
        email: env.TEST_MANAGER_EMAIL || "test_manager@pulse.test",
        password: env.TEST_MANAGER_PASSWORD || "TestManager123!#Local",
      };
    case "employee":
      return {
        email: env.TEST_EMPLOYEE_EMAIL || "test_employee@pulse.test",
        password: env.TEST_EMPLOYEE_PASSWORD || "TestEmployee123!#Local",
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
  const supabaseUrl = getAllowedTestSupabaseUrl();
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
      const superAdmin = createAllowedSupabaseAdmin();
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

export async function ensureStorageState(role: RoleName, force: boolean = false): Promise<string> {
  const baseUrl = getAllowedTestBaseUrl();
  const supabaseUrl = getAllowedTestSupabaseUrl();
  const filePath = getStorageStatePath(role);

  // Re-generate if force requested or older than 5 minutes
  if (!force && fs.existsSync(filePath)) {
    const stats = fs.statSync(filePath);
    const ageMinutes = (Date.now() - stats.mtimeMs) / (60 * 1000);
    if (ageMinutes < 5) {
      return filePath;
    }
  }

  const session = await loginAndGetSession(role);
  const supaHostPrefix = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieBaseName = `sb-${supaHostPrefix}-auth-token`;
  const sessionString = JSON.stringify(session);
  const chunks = createChunks(cookieBaseName, sessionString);

  const parsedBase = new URL(baseUrl);
  const domain = parsedBase.hostname;
  const isHttps = parsedBase.protocol === "https:";
  const expires = Math.floor(Date.now() / 1000) + 86400 * 7; // 7 days

  const cookies = chunks.map((chunk) => ({
    name: chunk.name,
    value: chunk.value,
    domain,
    path: "/",
    expires,
    httpOnly: false,
    secure: isHttps,
    sameSite: "Lax" as const,
  }));

  const storageState = {
    cookies,
    origins: [
      {
        origin: parsedBase.origin,
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
