import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase/admin";
import pkg from "@/package.json";

export const dynamic = "force-dynamic";

export async function GET() {
  const startTime = Date.now();
  let dbStatus: "ok" | "error" = "ok";
  let redisStatus: "ok" | "skipped" | "error" = "skipped";

  // 1. Check Database Health
  try {
    const { error } = await supabaseAdmin.from("organizations").select("id").limit(1);
    if (error) {
      dbStatus = "error";
    }
  } catch (err) {
    dbStatus = "error";
  }

  // 2. Check Redis Health
  const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (redisUrl && redisToken) {
    try {
      const redisRes = await fetch(`${redisUrl}/ping`, {
        headers: { Authorization: `Bearer ${redisToken}` },
        signal: AbortSignal.timeout(2000),
      });
      if (redisRes.ok) {
        redisStatus = "ok";
      } else {
        redisStatus = "error";
      }
    } catch {
      redisStatus = "error";
    }
  } else {
    redisStatus = "skipped";
  }

  const isDatabaseOk = dbStatus === "ok";
  const overallStatus = isDatabaseOk && redisStatus !== "error" ? "healthy" : "degraded";

  const responseBody = {
    status: overallStatus,
    version: process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || pkg.version || "0.1.0",
    uptime: Math.floor(process.uptime()),
    checks: {
      database: dbStatus,
      redis: redisStatus,
      timestamp: new Date().toISOString(),
    },
  };

  const httpStatus = isDatabaseOk ? 200 : 503;

  return NextResponse.json(responseBody, {
    status: httpStatus,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "X-Response-Time-Ms": String(Date.now() - startTime),
    },
  });
}
