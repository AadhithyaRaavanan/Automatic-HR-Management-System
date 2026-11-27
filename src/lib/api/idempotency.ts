import { supabaseAdmin } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";

export async function checkIdempotency(
  key: string | null | undefined,
  userId: string,
  endpoint: string
): Promise<NextResponse | null> {
  if (!key) return null;

  try {
    const { data } = await (supabaseAdmin as any)
      .from("idempotency_keys")
      .select("response_body, response_status")
      .eq("key", key)
      .eq("user_id", userId)
      .maybeSingle();

    if (data) {
      return NextResponse.json(data.response_body, {
        status: data.response_status || 200,
        headers: { "X-Idempotent-Replay": "true" },
      });
    }
  } catch (err) {
    console.warn("Idempotency check error:", err);
  }

  return null;
}

export async function recordIdempotency(
  key: string | null | undefined,
  userId: string,
  endpoint: string,
  responseBody: unknown,
  responseStatus = 200
): Promise<void> {
  if (!key) return;

  try {
    await (supabaseAdmin as any).from("idempotency_keys").insert({
      key,
      user_id: userId,
      endpoint,
      response_body: responseBody,
      response_status: responseStatus,
    });
  } catch (err) {
    console.warn("Idempotency record error:", err);
  }
}
