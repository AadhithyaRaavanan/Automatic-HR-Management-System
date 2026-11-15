/**
 * scripts/mutation-check.mjs
 * 
 * RemoteHR Automated Mutation Testing Suite for 10 Critical Protections.
 * For each protection:
 *  1. Applies a mutation that disables or bypasses the protection.
 *  2. Executes the relevant test suite and asserts it FAILS (exit code !== 0).
 *  3. Reverts the mutation to restore original code/schema.
 *  4. Executes the relevant test suite and confirms it passes GREEN (exit code === 0).
 */

import { Client } from "pg";
import { exec } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

const connectionString =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const rootDir = process.cwd();

function runCommand(cmdStr) {
  return new Promise((resolve) => {
    exec(cmdStr, { cwd: rootDir, env: process.env, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({
        code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
        output: (stdout || "") + (stderr || ""),
      });
    });
  });
}

async function main() {
  console.log("================================================================================");
  console.log("RemoteHR — Automated Mutation Testing Suite for 10 Critical Protections");
  console.log("================================================================================\n");

  const client = new Client({ connectionString });
  await client.connect();

  async function getFunctionDef(proname) {
    const res = await client.query(`
      SELECT pg_get_functiondef(p.oid) as def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = $1
      LIMIT 1;
    `, [proname]);
    if (!res.rows[0]?.def) {
      throw new Error(`Could not find function definition for ${proname}`);
    }
    return res.rows[0].def;
  }

  // Pre-fetch original function definitions from catalog
  const origGovDef = await getFunctionDef("admin_update_employee_governance");
  const origMemberRoleDef = await getFunctionDef("admin_update_org_member_role");
  const origLockMonthDef = await getFunctionDef("lock_month");
  const origRetentionCleanupDef = await getFunctionDef("run_org_retention_cleanup");
  const origIsActiveMemberDef = await getFunctionDef("is_active_org_member");

  const mutations = [
    // 1. Tenant RLS Protection
    {
      id: 1,
      name: "Tenant RLS Protection",
      suite: "tests/database/f1-multitenancy.test.ts",
      command: 'npx vitest run tests/database/f1-multitenancy.test.ts -t "[F1.1.1]"',
      mutate: async () => {
        await client.query("ALTER TABLE public.attendance_days DISABLE ROW LEVEL SECURITY;");
      },
      revert: async () => {
        await client.query("ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;");
      },
    },

    // 2. MFA AAL2 Step-Up Verification Gate
    {
      id: 2,
      name: "MFA AAL2 Step-Up Verification Gate",
      suite: "tests/database/phase3-rpc-matrix.test.ts",
      command: 'npx vitest run tests/database/phase3-rpc-matrix.test.ts -t "denies admin at aal1"',
      mutate: async () => {
        await client.query(`
          CREATE OR REPLACE FUNCTION public.admin_update_employee_governance(
              p_employee_id UUID,
              p_full_name TEXT DEFAULT NULL,
              p_department_id UUID DEFAULT NULL,
              p_manager_id UUID DEFAULT NULL,
              p_work_mode TEXT DEFAULT NULL,
              p_timezone TEXT DEFAULT NULL,
              p_primary_location_id UUID DEFAULT NULL,
              p_work_target_minutes INTEGER DEFAULT NULL,
              p_expected_office_days INTEGER[] DEFAULT NULL,
              p_required_office_days_per_week INTEGER DEFAULT NULL,
              p_status TEXT DEFAULT NULL
          )
          RETURNS JSONB
          LANGUAGE plpgsql
          SECURITY DEFINER
          SET search_path = ''
          AS $$
          BEGIN
              -- MUTATED: removed AAL2 verification check
              RETURN jsonb_build_object('success', TRUE, 'mutated_no_aal2', true);
          END;
          $$;
        `);
      },
      revert: async () => {
        await client.query(origGovDef);
      },
    },

    // 3. Last-Admin Protection
    {
      id: 3,
      name: "Last-Admin Protection",
      suite: "tests/database/f8-admin.test.ts",
      command: 'npx vitest run tests/database/f8-admin.test.ts -t "[F8.2.5]"',
      mutate: async () => {
        await client.query(`
          CREATE OR REPLACE FUNCTION public.admin_update_org_member_role(
              p_organization_id UUID,
              p_user_id UUID,
              p_new_role TEXT
          )
          RETURNS JSONB
          LANGUAGE plpgsql
          SECURITY DEFINER
          SET search_path = ''
          AS $$
          BEGIN
              -- MUTATED: removed Last Admin check
              UPDATE public.organization_members
              SET role = p_new_role, updated_at = pg_catalog.now()
              WHERE organization_id = p_organization_id AND user_id = p_user_id;
              RETURN jsonb_build_object('success', TRUE);
          END;
          $$;
        `);
      },
      revert: async () => {
        await client.query(origMemberRoleDef);
        await client.query("GRANT EXECUTE ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) TO authenticated;");
        await client.query("UPDATE public.organization_members SET role = 'admin' WHERE organization_id = '00000000-0000-0000-0000-000000000001' AND user_id = '00000000-0000-0000-0000-000000000001';");
      },
    },

    // 4. Locked Month Finalization
    {
      id: 4,
      name: "Locked Month Finalization & Immutability",
      suite: "tests/database/f3-attendance.test.ts",
      command: 'npx vitest run tests/database/f3-attendance.test.ts -t "[F3.4.4]"',
      mutate: async () => {
        await client.query(`
          CREATE OR REPLACE FUNCTION public.lock_month(p_year INTEGER, p_month INTEGER)
          RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
          BEGIN
              -- MUTATED: does not lock records
              RETURN jsonb_build_object('success', FALSE, 'records_locked', 0);
          END;
          $$;
        `);
      },
      revert: async () => {
        await client.query(origLockMonthDef);
      },
    },

    // 5. Single Open Session Index
    {
      id: 5,
      name: "Single Open Session Constraint (idx_single_open_session)",
      suite: "tests/database/f3-attendance.test.ts",
      command: 'npx vitest run tests/database/f3-attendance.test.ts -t "[F3.1.3]"',
      mutate: async () => {
        await client.query("DROP INDEX IF EXISTS public.idx_single_open_session;");
      },
      revert: async () => {
        await client.query("CREATE UNIQUE INDEX idx_single_open_session ON public.attendance_sessions (employee_id) WHERE check_out_at IS NULL;");
      },
    },

    // 6. Archive-Before-Delete
    {
      id: 6,
      name: "Retention Archive-Before-Delete Policy",
      suite: "tests/database/f9-retention.test.ts",
      command: 'npx vitest run tests/database/f9-retention.test.ts -t "[F9.1.2]"',
      mutate: async () => {
        await client.query(`
          CREATE OR REPLACE FUNCTION public.run_org_retention_cleanup(
              p_organization_id UUID,
              dry_run BOOLEAN DEFAULT TRUE,
              p_actor_id UUID DEFAULT NULL
          )
          RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
          BEGIN
              -- MUTATED: bypasses archive check and returns 0 eligible
              RETURN jsonb_build_object('dry_run', dry_run, 'eligible', jsonb_build_object('sessions_to_delete', 0));
          END;
          $$;
        `);
      },
      revert: async () => {
        await client.query(origRetentionCleanupDef);
      },
    },

    // 7. Half-Day Check Constraint
    {
      id: 7,
      name: "Half-Day Single-Date Constraint (chk_leave_request_half_day_single_date)",
      suite: "tests/database/f5-leave.test.ts",
      command: 'npx vitest run tests/database/f5-leave.test.ts -t "[F5.2.2]"',
      mutate: async () => {
        await client.query("ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS chk_leave_request_half_day_single_date;");
      },
      revert: async () => {
        await client.query("DELETE FROM public.leave_requests WHERE day_part IS NOT NULL AND start_date != end_date;");
        await client.query("ALTER TABLE public.leave_requests ADD CONSTRAINT chk_leave_request_half_day_single_date CHECK ((day_part IS NULL) OR (start_date = end_date));");
      },
    },

    // 8. Suspended Lockout
    {
      id: 8,
      name: "Immediate Suspended Member Lockout",
      suite: "tests/database/suspended-member-isolation.test.ts",
      command: 'npx vitest run tests/database/suspended-member-isolation.test.ts -t "Denies EVERY authenticated SECURITY DEFINER RPC"',
      mutate: async () => {
        await client.query(`
          CREATE OR REPLACE FUNCTION public.is_active_org_member()
          RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
              -- MUTATED: allows suspended users through
              SELECT TRUE;
          $$;
        `);
      },
      revert: async () => {
        await client.query(origIsActiveMemberDef);
      },
    },

    // 9. Login Rate Limiting Lockout
    {
      id: 9,
      name: "Login Rate Limiting Dual-Store Lockout",
      suite: "tests/unit/f2-auth.test.ts",
      command: 'npx vitest run tests/unit/f2-auth.test.ts -t "[F2.2.1]"',
      mutate: async () => {
        const filePath = path.join(rootDir, "lib/auth/rate-limiter.ts");
        const originalContent = fs.readFileSync(filePath, "utf-8");
        fs.writeFileSync(filePath + ".bak", originalContent, "utf-8");
        const mutatedContent = originalContent.replaceAll(
          "return { allowed: false, retryAfterSeconds: Math.max(retryAfter, 1) };",
          "return { allowed: true, retryAfterSeconds: 0 }; // MUTATED"
        );
        fs.writeFileSync(filePath, mutatedContent, "utf-8");
      },
      revert: async () => {
        const filePath = path.join(rootDir, "lib/auth/rate-limiter.ts");
        if (fs.existsSync(filePath + ".bak")) {
          fs.writeFileSync(filePath, fs.readFileSync(filePath + ".bak", "utf-8"), "utf-8");
          fs.unlinkSync(filePath + ".bak");
        }
      },
    },

    // 10. Clean Redirect Sanitizer
    {
      id: 10,
      name: "Open Redirect & Control-Character Neutralization",
      suite: "tests/unit/f2-auth.test.ts",
      command: 'npx vitest run tests/unit/f2-auth.test.ts -t "[F2.2.3]"',
      mutate: async () => {
        const filePath = path.join(rootDir, "lib/auth/redirect.ts");
        const originalContent = fs.readFileSync(filePath, "utf-8");
        fs.writeFileSync(filePath + ".bak", originalContent, "utf-8");
        const mutatedContent = originalContent.replace(
          "return sanitizeRedirectPath(input, fallback);",
          "return input || fallback; // MUTATED"
        );
        fs.writeFileSync(filePath, mutatedContent, "utf-8");
      },
      revert: async () => {
        const filePath = path.join(rootDir, "lib/auth/redirect.ts");
        if (fs.existsSync(filePath + ".bak")) {
          fs.writeFileSync(filePath, fs.readFileSync(filePath + ".bak", "utf-8"), "utf-8");
          fs.unlinkSync(filePath + ".bak");
        }
      },
    },
  ];

  const results = [];

  for (const m of mutations) {
    console.log(`\n--------------------------------------------------------------------------------`);
    console.log(`[MUTATION ${m.id}/10] Testing: ${m.name}`);
    console.log(`Target Suite: ${m.suite}`);
    console.log(`--------------------------------------------------------------------------------`);

    // 1. Apply mutation
    console.log(`[1] Applying mutation to remove defense...`);
    await m.mutate();

    // 2. Run test under mutation — MUST FAIL!
    console.log(`[2] Running test suite against mutated code (expecting FAILURE)...`);
    const mutatedRun = await runCommand(m.command);

    if (mutatedRun.code === 0) {
      console.error(`❌ MUTATION TEST FAILED: Test suite unexpectedly PASSED when protection was removed!`);
      await m.revert();
      await client.end();
      process.exit(1);
    }

    console.log(`✅ PROVEN: Test suite failed with exit code ${mutatedRun.code} under mutation.`);
    const firstFailLine = mutatedRun.output
      .split("\n")
      .filter((l) => l.includes("FAIL") || l.includes("AssertionError") || l.includes("Error:") || l.includes("expected"))
      .slice(0, 5)
      .join("\n   ");
    console.log(`   Captured error snippet:\n   ${firstFailLine}`);

    // 3. Revert mutation
    console.log(`[3] Reverting mutation to restore defense...`);
    await m.revert();

    // 4. Confirm GREEN
    console.log(`[4] Running test suite against restored defense (expecting GREEN)...`);
    const restoredRun = await runCommand(m.command);

    if (restoredRun.code !== 0) {
      console.error(`❌ REVERT FAILED: Test suite did not return to green! Exit code ${restoredRun.code}\n`);
      console.error(restoredRun.output);
      await client.end();
      process.exit(1);
    }

    console.log(`✅ CONFIRMED GREEN: Suite passed with exit code 0.`);
    results.push({
      id: m.id,
      name: m.name,
      mutatedExitCode: mutatedRun.code,
      mutatedSnippet: firstFailLine,
      restoredExitCode: restoredRun.code,
    });
  }

  await client.end();

  console.log("\n================================================================================");
  console.log("Mutation Check Summary: All 10 Protections Successfully Tested & Proven!");
  console.log("================================================================================");
  for (const r of results) {
    console.log(`[${r.id}/10] ${r.name}: MUTATION FAILED (exit ${r.mutatedExitCode}) -> REVERT GREEN (exit ${r.restoredExitCode})`);
  }
}

main().catch((err) => {
  console.error("Fatal error during mutation run:", err);
  process.exit(1);
});
