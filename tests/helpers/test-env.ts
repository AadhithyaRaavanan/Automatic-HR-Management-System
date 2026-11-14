import * as fs from "node:fs";
import * as path from "node:path";
import { createClient } from "@supabase/supabase-js";
import { generateSync } from "otplib";

export interface TestEnv {
  dbUrl: string;
  supabaseUrl: string;
  anonKey: string;
  serviceKey: string;
}

let cachedEnv: TestEnv | null = null;

export function getTestEnv(): TestEnv {
  if (cachedEnv) return cachedEnv;

  const stagingPath = path.resolve(process.cwd(), ".env.staging");
  const envMap: Record<string, string> = {};
  if (fs.existsSync(stagingPath)) {
    for (const line of fs.readFileSync(stagingPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq > 0) {
        envMap[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
      }
    }
  }

  const dbUrl = process.env.DATABASE_URL || envMap.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || envMap.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || envMap.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envMap.SUPABASE_SERVICE_ROLE_KEY || "";

  // Safety: Never allow non-local host in database tests
  const dbHostMatch = dbUrl.match(/@([^:/]+)/);
  const dbHost = dbHostMatch ? dbHostMatch[1] : "";
  if (dbHost && !["127.0.0.1", "localhost"].includes(dbHost)) {
    throw new Error(`CRITICAL SECURITY FAILURE: Test suite may connect ONLY to local database (attempted: ${dbHost})`);
  }

  cachedEnv = { dbUrl, supabaseUrl, anonKey, serviceKey };
  return cachedEnv;
}

export async function enrollAndElevateAal2(email: string, password: string): Promise<{
  aal1Token: string;
  aal2Token: string;
  userId: string;
  factorId: string;
}> {
  const env = getTestEnv();
  const anon = createClient(env.supabaseUrl, env.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const superAdmin = createClient(env.supabaseUrl, env.serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({ email, password });
  if (signInErr || !signInData.session) {
    throw new Error(`Sign-in failed for ${email}: ${signInErr?.message}`);
  }
  const aal1Token = signInData.session.access_token;
  const userId = signInData.user.id;

  // Clean stale unverified or existing factors
  const { data: existingFactors } = await superAdmin.auth.admin.mfa.listFactors({ userId });
  for (const f of existingFactors?.factors || []) {
    await superAdmin.auth.admin.mfa.deleteFactor({ userId, id: f.id }).catch(() => {});
  }

  const { data: enrollData, error: enrollErr } = await anon.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: `TestAal2-${Date.now()}`,
  });
  if (enrollErr || !enrollData) {
    throw new Error(`MFA enroll failed for ${email}: ${enrollErr?.message}`);
  }

  const code = generateSync({ secret: enrollData.totp.secret });
  const { data: verifyData, error: verifyErr } = await anon.auth.mfa.challengeAndVerify({
    factorId: enrollData.id,
    code,
  });
  if (verifyErr || !verifyData?.access_token) {
    throw new Error(`MFA challengeAndVerify failed for ${email}: ${verifyErr?.message}`);
  }

  return {
    aal1Token,
    aal2Token: verifyData.access_token,
    userId,
    factorId: enrollData.id,
  };
}
