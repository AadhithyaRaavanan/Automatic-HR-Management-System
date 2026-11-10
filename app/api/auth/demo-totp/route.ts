import { NextRequest, NextResponse } from "next/server";
import { generateSync } from "otplib";
import { Client } from "pg";
import { isDemoModeEnabled } from "@/lib/config/demo";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  if (!isDemoModeEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const { secret, factorId } = await request.json();

    // 1. Direct secret provided (from /mfa-setup)
    if (secret) {
      const code = generateSync({ secret });
      return NextResponse.json({ code });
    }

    // 2. factorId provided (from /mfa-challenge)
    if (factorId) {
      const dbUrl = process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
      const client = new Client({ connectionString: dbUrl });
      await client.connect();

      try {
        const res = await client.query(
          "SELECT secret FROM auth.mfa_factors WHERE id = $1 LIMIT 1",
          [factorId]
        );
        if (res.rows.length === 0 || !res.rows[0].secret) {
          return NextResponse.json({ error: "MFA factor not found" }, { status: 404 });
        }
        const factorSecret = res.rows[0].secret;
        const code = generateSync({ secret: factorSecret });
        return NextResponse.json({ code });
      } finally {
        await client.end().catch(() => {});
      }
    }

    return NextResponse.json({ error: "Either secret or factorId is required" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "Failed to generate demo TOTP" }, { status: 500 });
  }
}

