import "server-only";

import crypto from "node:crypto";
import zlib from "node:zlib";
import { supabaseAdmin } from "@/lib/supabase/admin";

export interface ExportBatch {
  organization_id: string;
  archive_month: string;
  period_start: string;
  period_end: string;
  cutoff_at: string;
  row_count: number;
  session_ids: string[];
  sessions: Array<Record<string, unknown>>;
}

export interface CreatedRetentionArchive {
  organizationId: string;
  archiveId: string;
  archiveMonth: string;
  storagePath: string;
  rowCount: number;
  byteSize: number;
  checksumSha256: string;
}

export interface ArchiveAndCleanupResult {
  archivesCreated: CreatedRetentionArchive[];
  cleanup: Record<string, unknown>;
}

export interface OrgAutomatedRetentionResult {
  organizationId: string;
  success: boolean;
  archivesCreated: CreatedRetentionArchive[];
  cleanup?: Record<string, unknown>;
  error?: string;
}

export interface AllOrgsRetentionResult {
  organizationsProcessed: number;
  totalArchivesCreated: number;
  failures: number;
  results: OrgAutomatedRetentionResult[];
}

async function exportOrganizationSessionBatches(
  organizationId: string,
  actorId?: string | null
): Promise<CreatedRetentionArchive[]> {
  const archivesCreated: CreatedRetentionArchive[] = [];
  const maxPasses = 50;

  for (let pass = 0; pass < maxPasses; pass++) {
    const { data: rawBatches, error: batchError } = await (supabaseAdmin.rpc as any)(
      "get_retention_export_batches",
      {
        p_organization_id: organizationId,
        p_batch_limit: 500,
      }
    );

    if (batchError) {
      throw new Error(`Failed to fetch retention export batches: ${batchError.message}`);
    }

    const batches = (Array.isArray(rawBatches) ? rawBatches : []) as ExportBatch[];
    if (batches.length === 0) {
      break;
    }

    for (const batch of batches) {
      const payload = {
        schema_version: 1,
        organization_id: batch.organization_id,
        archive_month: batch.archive_month,
        period_start: batch.period_start,
        period_end: batch.period_end,
        cutoff_at: batch.cutoff_at,
        row_count: batch.row_count,
        exported_at: new Date().toISOString(),
        sessions: batch.sessions ?? [],
      };

      const rawJson = JSON.stringify(payload);
      const compressed = zlib.gzipSync(Buffer.from(rawJson, "utf-8"), { level: 9 });
      const checksumSha256 = crypto.createHash("sha256").update(compressed).digest("hex");
      const storagePath = `${organizationId}/${batch.archive_month}/attendance_sessions_${batch.archive_month}_${crypto.randomUUID()}.json.gz`;

      const { error: uploadError } = await supabaseAdmin.storage
        .from("retention-archives")
        .upload(storagePath, compressed, {
          contentType: "application/gzip",
          upsert: false,
        });

      if (uploadError) {
        throw new Error(`Failed to upload monthly retention archive (${storagePath}): ${uploadError.message}`);
      }

      const { data: recordResult, error: recordError } = await (supabaseAdmin.rpc as any)(
        "record_retention_archive",
        {
          p_organization_id: organizationId,
          p_archive_month: batch.archive_month,
          p_period_start: batch.period_start,
          p_period_end: batch.period_end,
          p_cutoff_at: batch.cutoff_at,
          p_storage_path: storagePath,
          p_byte_size: compressed.byteLength,
          p_checksum_sha256: checksumSha256,
          p_session_ids: batch.session_ids,
          p_created_by: actorId ?? null,
        }
      );

      if (recordError || !recordResult?.archive_id) {
        await supabaseAdmin.storage.from("retention-archives").remove([storagePath]).catch(() => {});
        throw new Error(
          `Failed to record retention archive manifest: ${recordError?.message || "Missing archive_id"}`
        );
      }

      archivesCreated.push({
        organizationId,
        archiveId: String(recordResult.archive_id),
        archiveMonth: batch.archive_month,
        storagePath,
        rowCount: batch.row_count,
        byteSize: compressed.byteLength,
        checksumSha256,
      });
    }
  }

  return archivesCreated;
}

/**
 * Exports eligible locked old attendance_sessions as monthly compressed `.json.gz` bundles
 * into the private `retention-archives` Storage bucket BEFORE deleting any rows via
 * `run_org_retention_cleanup(orgId, false)`.
 */
export async function archiveAndRunRetentionCleanup(
  organizationId: string,
  actorId?: string | null
): Promise<ArchiveAndCleanupResult> {
  const archivesCreated = await exportOrganizationSessionBatches(organizationId, actorId);

  const { data: cleanup, error: cleanupError } = await (supabaseAdmin.rpc as any)(
    "run_org_retention_cleanup",
    {
      p_organization_id: organizationId,
      dry_run: false,
      p_actor_id: actorId ?? null,
    }
  );

  if (cleanupError) {
    throw new Error(`Failed to execute retention cleanup: ${cleanupError.message}`);
  }

  return {
    archivesCreated,
    cleanup: (cleanup as Record<string, unknown>) ?? {},
  };
}

/**
 * Scheduled multi-organization retention orchestrator (no manual admin interaction).
 * Iterates across all organizations with per-organization error isolation,
 * exporting monthly `.json.gz` Storage archives BEFORE purging expired data.
 */
export async function archiveAllOrgsAndRunRetentionCleanup(
  actorId?: string | null
): Promise<AllOrgsRetentionResult> {
  const { data: orgs, error: orgError } = await (supabaseAdmin as any)
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true });

  if (orgError) {
    throw new Error(`Failed to list organizations for scheduled retention: ${orgError.message}`);
  }

  const orgRows = (Array.isArray(orgs) ? orgs : []) as Array<{ id: string }>;
  const results: OrgAutomatedRetentionResult[] = [];
  let totalArchivesCreated = 0;
  let failures = 0;

  for (const org of orgRows) {
    try {
      const outcome = await archiveAndRunRetentionCleanup(org.id, actorId ?? null);
      totalArchivesCreated += outcome.archivesCreated.length;
      results.push({
        organizationId: org.id,
        success: true,
        archivesCreated: outcome.archivesCreated,
        cleanup: outcome.cleanup,
      });
    } catch (err: unknown) {
      failures += 1;
      results.push({
        organizationId: org.id,
        success: false,
        archivesCreated: [],
        error: err instanceof Error ? err.message : "Unknown retention failure",
      });
    }
  }

  return {
    organizationsProcessed: orgRows.length,
    totalArchivesCreated,
    failures,
    results,
  };
}

export async function createRetentionArchiveSignedUrl(organizationId: string, archiveId: string) {
  const { data: archive, error } = await (supabaseAdmin as any)
    .from("retention_archives")
    .select("id, organization_id, archive_month, storage_bucket, storage_path, row_count, byte_size, checksum_sha256")
    .eq("id", archiveId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  if (error || !archive) {
    return null;
  }

  const { data: signed, error: signError } = await supabaseAdmin.storage
    .from(archive.storage_bucket || "retention-archives")
    .createSignedUrl(archive.storage_path, 60);

  if (signError || !signed?.signedUrl) {
    throw new Error(`Failed to generate signed download URL: ${signError?.message || "Unknown storage error"}`);
  }

  return {
    signedUrl: signed.signedUrl,
    archive,
  };
}
