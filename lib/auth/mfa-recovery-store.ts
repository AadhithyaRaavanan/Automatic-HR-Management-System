import crypto from "crypto";

const SECRET_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  "fallback-mfa-recovery-secret-key-32chars";

// In-memory cache for ultra-fast validation and local dev
const localRecoveryCodes = new Map<string, { code: string; expiresAt: number; tokenId: string }>();
const consumedTokens = new Set<string>();

export function generateRecoveryOtp(): string {
  // Cryptographically secure 6-digit numeric string
  return crypto.randomInt(100000, 999999).toString();
}

export function createRecoveryProof(
  userId: string,
  code: string,
  ttlMs = 10 * 60 * 1000
): {
  proofToken: string;
  expiresAt: number;
} {
  const expiresAt = Date.now() + ttlMs;
  const tokenId = crypto.randomUUID();
  localRecoveryCodes.set(userId, { code, expiresAt, tokenId });

  // Create signed proof payload with unique tokenId to prevent replay
  const payload = `${userId}:${code}:${expiresAt}:${tokenId}`;
  const signature = crypto.createHmac("sha256", SECRET_KEY).update(payload).digest("hex");
  const proofToken = Buffer.from(
    JSON.stringify({
      userId,
      expiresAt,
      tokenId,
      signature,
      codeHash: crypto.createHash("sha256").update(code).digest("hex"),
    })
  ).toString("base64url");

  return { proofToken, expiresAt };
}

export function verifyRecoveryProof(
  userId: string,
  code: string,
  proofToken?: string | null
): boolean {
  const cleanCode = code.replace(/\s+/g, "");
  const now = Date.now();

  // 1. Check in-memory store
  const memoryEntry = localRecoveryCodes.get(userId);
  if (memoryEntry && memoryEntry.expiresAt > now) {
    if (memoryEntry.code === cleanCode) {
      consumedTokens.add(memoryEntry.tokenId);
      localRecoveryCodes.delete(userId);
      return true;
    }
  }

  // 2. Check signed proof token (cross-instance safe)
  if (proofToken) {
    try {
      const decoded = JSON.parse(Buffer.from(proofToken, "base64url").toString("utf8"));
      if (decoded.userId !== userId) return false;
      if (decoded.expiresAt < now) return false;
      if (decoded.tokenId && consumedTokens.has(decoded.tokenId)) return false;

      const payload = `${userId}:${cleanCode}:${decoded.expiresAt}:${decoded.tokenId}`;
      const expectedSig = crypto.createHmac("sha256", SECRET_KEY).update(payload).digest("hex");
      if (crypto.timingSafeEqual(Buffer.from(decoded.signature), Buffer.from(expectedSig))) {
        if (decoded.tokenId) consumedTokens.add(decoded.tokenId);
        localRecoveryCodes.delete(userId);
        return true;
      }
    } catch {
      return false;
    }
  }

  return false;
}

export function clearRecoveryCode(userId: string) {
  localRecoveryCodes.delete(userId);
}
