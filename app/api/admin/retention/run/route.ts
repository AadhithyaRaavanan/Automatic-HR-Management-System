import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyAdminRouteCaller } from "@/lib/auth/admin-guard";
import { supabaseAdmin } from "@/lib/supabase/admin";
import { archiveAndRunRetentionCleanup } from "@/lib/retention/archiver";

const runRetentionSchema = z.object({
  dryRun: z.boolean().optional().default(true),
});

export async function POST(request: NextRequest) {
  const caller = await verifyAdminRouteCaller(request, ["admin"]);
  if ("response" in caller) {
    return caller.response;
  }

  let parsedBody = { dryRun: true };
  try {
    const raw = await request.json().catch(() => ({}));
    const result = runRetentionSchema.safeParse(raw);
    if (!result.success) {
      return NextResponse.json(
        { error: "Invalid request payload", details: result.error.flatten() },
        { status: 400 }
      );
    }
    parsedBody = result.data;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { organizationId, userId } = caller.context;

  try {
    if (parsedBody.dryRun) {
      const { data: preview, error } = await (supabaseAdmin.rpc as any)("run_org_retention_cleanup", {
        p_organization_id: organizationId,
        dry_run: true,
        p_actor_id: null,
      });

      if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }

      return NextResponse.json({
        dry_run: true,
        archivesCreated: [],
        cleanup: preview,
      });
    }

    const result = await archiveAndRunRetentionCleanup(organizationId, userId);
    return NextResponse.json({
      dry_run: false,
      archivesCreated: result.archivesCreated,
      cleanup: result.cleanup,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to run retention cleanup.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

