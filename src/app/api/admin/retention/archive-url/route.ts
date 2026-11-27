import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminRouteCaller } from "@/features/auth/admin-guard";
import { createRetentionArchiveSignedUrl } from "@/features/retention/archiver";

const uuidSchema = z.string().uuid();

export async function GET(request: NextRequest) {
  const caller = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in caller) {
    return caller.response;
  }

  const archiveId = request.nextUrl.searchParams.get("id");
  const parsed = uuidSchema.safeParse(archiveId);
  if (!parsed.success) {
    return NextResponse.json({ error: "Valid archive UUID id parameter is required." }, { status: 400 });
  }

  try {
    const result = await createRetentionArchiveSignedUrl(caller.context.organizationId, parsed.data);
    if (!result) {
      return NextResponse.json({ error: "Archive not found in organization." }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to sign archive download URL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

