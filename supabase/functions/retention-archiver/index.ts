import { createClient } from "@supabase/supabase-js";

// Ambient Deno declaration for dual Deno / Node/Vitest typechecking
declare const Deno: any;

interface ExportBatch {
  organization_id: string;
  archive_month: string;
  period_start: string;
  period_end: string;
  cutoff_at: string;
  row_count: number;
  session_ids: string[];
  sessions: Array<Record<string, unknown>>;
}

export function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

export async function gzipText(raw: string): Promise<Uint8Array> {
  const inputStream = new Blob([raw]).stream();
  const compressedStream = inputStream.pipeThrough(new CompressionStream("gzip"));
  const compressedBuf = await new Response(compressedStream).arrayBuffer();
  return new Uint8Array(compressedBuf);
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes.buffer as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function handleRetentionArchiverRequest(
  req: Request,
  envGetter: (key: string) => string | undefined = (k) => {
    if (typeof Deno !== "undefined" && typeof (Deno as any).env?.get === "function") {
      return (Deno as any).env.get(k);
    }
    return typeof process !== "undefined" && process.env ? process.env[k] : undefined;
  }
): Promise<Response> {
  // Disallow GET or other HTTP methods: allow POST only
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  // Require dedicated RETENTION_CRON_SECRET; fail closed (503) without fallback
  const expectedSecret = envGetter("RETENTION_CRON_SECRET")?.trim();

  if (!expectedSecret) {
    return Response.json({ error: "Archiver secret not configured." }, { status: 503 });
  }

  const authHeader = req.headers.get("authorization") || "";
  if (!authHeader.startsWith("Bearer ")) {
    return Response.json({ error: "Unauthorized: Missing bearer token." }, { status: 401 });
  }

  const presentedToken = authHeader.slice("Bearer ".length).trim();
  if (!constantTimeEqual(presentedToken, expectedSecret)) {
    return Response.json({ error: "Forbidden: Invalid bearer token." }, { status: 403 });
  }

  const supabaseUrl = envGetter("SUPABASE_URL") || envGetter("NEXT_PUBLIC_SUPABASE_URL");
  const serviceRoleKey = envGetter("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceRoleKey) {
    return Response.json({ error: "Supabase service credentials missing." }, { status: 500 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: orgs, error: orgError } = await supabaseAdmin
    .from("organizations")
    .select("id")
    .order("created_at", { ascending: true });

  if (orgError) {
    return Response.json({ error: `Failed to list organizations: ${orgError.message}` }, { status: 500 });
  }

  const results: Array<Record<string, unknown>> = [];
  let totalArchivesCreated = 0;
  let failures = 0;

  for (const org of (orgs ?? []) as Array<{ id: string }>) {
    try {
      const orgArchives: Array<Record<string, unknown>> = [];

      for (let pass = 0; pass < 50; pass++) {
        const { data: rawBatches, error: batchError } = await supabaseAdmin.rpc(
          "get_retention_export_batches",
          {
            p_organization_id: org.id,
            p_batch_limit: 500,
          }
        );

        if (batchError) {
          throw new Error(`Batch export failed: ${batchError.message}`);
        }

        const batches = (Array.isArray(rawBatches) ? rawBatches : []) as ExportBatch[];
        if (batches.length === 0) break;

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

          const compressed = await gzipText(JSON.stringify(payload));
          const checksumSha256 = await sha256Hex(compressed);
          const storagePath = `${org.id}/${batch.archive_month}/attendance_sessions_${batch.archive_month}_${crypto.randomUUID()}.json.gz`;

          const { error: uploadError } = await supabaseAdmin.storage
            .from("retention-archives")
            .upload(storagePath, compressed, {
              contentType: "application/gzip",
              upsert: false,
            });

          if (uploadError) {
            throw new Error(`Storage upload failed (${storagePath}): ${uploadError.message}`);
          }

          const { data: recordRes, error: recordError } = await supabaseAdmin.rpc(
            "record_retention_archive",
            {
              p_organization_id: org.id,
              p_archive_month: batch.archive_month,
              p_period_start: batch.period_start,
              p_period_end: batch.period_end,
              p_cutoff_at: batch.cutoff_at,
              p_storage_path: storagePath,
              p_byte_size: compressed.byteLength,
              p_checksum_sha256: checksumSha256,
              p_session_ids: batch.session_ids,
              p_created_by: null,
            }
          );

          if (recordError || !recordRes?.archive_id) {
            await supabaseAdmin.storage.from("retention-archives").remove([storagePath]).catch(() => {});
            throw new Error(`Manifest record failed: ${recordError?.message || "Missing archive_id"}`);
          }

          orgArchives.push({
            archiveId: String(recordRes.archive_id),
            archiveMonth: batch.archive_month,
            storagePath,
            rowCount: batch.row_count,
            byteSize: compressed.byteLength,
            checksumSha256,
          });
          totalArchivesCreated += 1;
        }
      }

      const { data: cleanup, error: cleanupError } = await supabaseAdmin.rpc(
        "run_org_retention_cleanup",
        {
          p_organization_id: org.id,
          dry_run: false,
          p_actor_id: null,
        }
      );

      if (cleanupError) {
        throw new Error(`Cleanup failed: ${cleanupError.message}`);
      }

      results.push({
        organizationId: org.id,
        success: true,
        archivesCreated: orgArchives,
        cleanup,
      });
    } catch (err) {
      failures += 1;
      results.push({
        organizationId: org.id,
        success: false,
        archivesCreated: [],
        error: err instanceof Error ? err.message : "Unknown retention error",
      });
    }
  }

  return Response.json({
    automated: true,
    runtime: "supabase-edge-function",
    executed_at: new Date().toISOString(),
    organizationsProcessed: (orgs ?? []).length,
    totalArchivesCreated,
    failures,
    results,
  });
}

// Guard Deno.serve invocation so module can be imported cleanly in Node/Vitest test suites
if (typeof Deno !== "undefined" && typeof (Deno as any).serve === "function") {
  (Deno as any).serve((req: Request) =>
    handleRetentionArchiverRequest(req, (k: string) => (Deno as any).env.get(k))
  );
}

