import crypto from "crypto";

function resolvePrivateSigningSecret(): string {
  const configured =
    process.env.MFA_RECOVERY_HMAC_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (configured && configured.trim().length > 0) {
    return configured.trim();
  }
  if (process.env.NODE_ENV === "test") {
    // Ephemeral process-local CSPRNG secret for isolated offline unit tests only
    return crypto.randomBytes(32).toString("hex");
  }
  throw new Error(
    "Server configuration error: MFA_RECOVERY_HMAC_SECRET or SUPABASE_SERVICE_ROLE_KEY is required."
  );
}

const EPHEMERAL_TEST_SECRET =
  process.env.NODE_ENV === "test" ? crypto.randomBytes(32).toString("hex") : null;

function getHmacSecret(): string {
  return EPHEMERAL_TEST_SECRET || resolvePrivateSigningSecret();
}

export type AuthChallengePurpose =
  | "mfa_recovery"
  | "password_reset"
  | "email_verify"
  | "password_change_reauth";

// In-memory store retained strictly for synchronous offline unit tests (`NODE_ENV === "test"`).
// Non-test runtimes use persistent Supabase table `public.auth_recovery_challenges` via RPC.
const localRecoveryCodes = new Map<
  string,
  { code: string; expiresAt: number; tokenId: string; purpose: AuthChallengePurpose }
>();
const consumedTokens = new Set<string>();

export function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function generateRecoveryOtp(): string {
  // Cryptographically secure guaranteed 6-digit numeric string (100000 - 999999)
  return crypto.randomInt(100000, 1000000).toString();
}

export function createRecoveryProof(
  userId: string,
  code: string,
  ttlMs = 10 * 60 * 1000,
  purpose: AuthChallengePurpose = "mfa_recovery"
): {
  proofToken: string;
  expiresAt: number;
} {
  const expiresAt = Date.now() + ttlMs;
  const tokenId = crypto.randomUUID();
  const cleanCode = code.replace(/\s+/g, "");
  localRecoveryCodes.set(userId, { code: cleanCode, expiresAt, tokenId, purpose });

  const payload = `${purpose}:${userId}:${cleanCode}:${expiresAt}:${tokenId}`;
  const signature = crypto
    .createHmac("sha256", getHmacSecret())
    .update(payload)
    .digest("hex");

  const proofToken = Buffer.from(
    JSON.stringify({
      purpose,
      userId,
      expiresAt,
      tokenId,
      signature,
      codeHash: sha256Hex(cleanCode),
    })
  ).toString("base64url");

  return { proofToken, expiresAt };
}

export function verifyRecoveryProof(
  userId: string,
  code: string,
  proofToken?: string | null,
  expectedPurpose: AuthChallengePurpose = "mfa_recovery"
): boolean {
  const cleanCode = code.replace(/\s+/g, "");
  const now = Date.now();

  if (proofToken) {
    try {
      const decoded = JSON.parse(Buffer.from(proofToken, "base64url").toString("utf8"));
      if ((decoded.purpose || "mfa_recovery") !== expectedPurpose) return false;
      if (decoded.userId !== userId) return false;
      if (decoded.expiresAt < now) return false;
      if (decoded.tokenId && consumedTokens.has(decoded.tokenId)) return false;

      const payload = `${expectedPurpose}:${userId}:${cleanCode}:${decoded.expiresAt}:${decoded.tokenId}`;
      const expectedSig = crypto
        .createHmac("sha256", getHmacSecret())
        .update(payload)
        .digest("hex");
      const sigBuf = Buffer.from(String(decoded.signature || ""), "utf8");
      const expBuf = Buffer.from(expectedSig, "utf8");
      if (sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf)) {
        if (decoded.tokenId) consumedTokens.add(decoded.tokenId);
        localRecoveryCodes.delete(userId);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  const memoryEntry = localRecoveryCodes.get(userId);
  if (memoryEntry && memoryEntry.expiresAt > now && memoryEntry.purpose === expectedPurpose) {
    if (memoryEntry.code === cleanCode) {
      consumedTokens.add(memoryEntry.tokenId);
      localRecoveryCodes.delete(userId);
      return true;
    }
  }

  return false;
}

export function clearRecoveryCode(userId: string) {
  localRecoveryCodes.delete(userId);
}

/**
 * Persists a purpose-bound recovery challenge in PostgreSQL (`auth_recovery_challenges`)
 * so multiple app instances share and atomically consume challenges.
 */
export async function createPersistentRecoveryChallenge(params: {
  userId: string;
  organizationId?: string | null;
  purpose: AuthChallengePurpose;
  code: string;
  ttlMs?: number;
}): Promise<{ proofToken: string; expiresAt: number }> {
  const { userId, organizationId = null, purpose, code, ttlMs = 10 * 60 * 1000 } = params;
  const cleanCode = code.replace(/\s+/g, "");
  const expiresAt = Date.now() + ttlMs;
  const proofToken = crypto.randomBytes(32).toString("base64url");

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const admin = getAdminClient() as any;

  // Supersede prior unconsumed challenges of the same purpose
  await admin
    .from("auth_recovery_challenges")
    .update({ consumed_at: new Date().toISOString(), consumed_by_ip: "superseded" })
    .eq("user_id", userId)
    .eq("purpose", purpose)
    .is("consumed_at", null);

  const { error } = await admin.from("auth_recovery_challenges").insert({
    user_id: userId,
    organization_id: organizationId,
    purpose,
    code_hash: sha256Hex(cleanCode),
    token_hash: sha256Hex(proofToken),
    expires_at: new Date(expiresAt).toISOString(),
  });

  if (error) {
    throw new Error(`Failed to persist recovery challenge: ${error.message}`);
  }

  return { proofToken, expiresAt };
}

/**
 * Atomically verifies and consumes a persistent recovery challenge across all instances.
 */
export async function consumePersistentRecoveryChallenge(params: {
  userId: string;
  purpose: AuthChallengePurpose;
  code: string;
  proofToken?: string | null;
  clientIp?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  const { userId, purpose, code, proofToken, clientIp = null } = params;
  const cleanCode = code.replace(/\s+/g, "");
  if (!cleanCode) {
    return { ok: false, reason: "missing_code" };
  }

  const { getAdminClient } = await import("@/lib/supabase/admin");
  const admin = getAdminClient() as any;

  const { data, error } = await admin.rpc("consume_auth_recovery_challenge", {
    p_user_id: userId,
    p_purpose: purpose,
    p_code_hash: sha256Hex(cleanCode),
    p_token_hash: proofToken ? sha256Hex(proofToken) : null,
    p_ip: clientIp,
  });

  if (error) {
    throw new Error(`Recovery challenge verification failed: ${error.message}`);
  }

  return {
    ok: Boolean(data?.ok),
    reason: data?.reason,
  };
}
