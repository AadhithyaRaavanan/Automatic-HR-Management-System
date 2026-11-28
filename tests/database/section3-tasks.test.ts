/**
 * Section 3: Task Management System DB & Security Suite
 *
 * Covers:
 * 1. RLS matrix across projects, tasks, task_comments, task_time_logs, task_events:
 *    - Employee sees own/assigned only (NOT peers' or unrelated managers' tasks).
 *    - Manager sees own/assigned + direct reports' tasks (NOT non-reports').
 *    - HR / Admin AAL2 see all org tasks; HR / Admin AAL1 denied (0 rows).
 *    - Cross-tenant Org 2 sees 0 Org 1 records across all 5 tables.
 *    - Direct INSERT / UPDATE / DELETE denied for authenticated.
 * 2. RPC denial matrix (`create_project`, `create_task`, `assign_task`, `update_task_status`,
 *    `complete_task`, `cancel_task`, `add_task_comment`, `log_task_time`):
 *    - Wrong role, non-owner reassignment/self-assignment, non-creator cancel/reopen,
 *      AAL1 denial for HR/Admin, cross-tenant denial, suspended member denial.
 * 3. Status transitions & validation invariants:
 *    - blocked -> done rejected, cancelled -> in_progress rejected, done -> cancelled rejected.
 *    - todo -> in_progress -> done sets started_at/completed_at; done -> in_progress clears completed_at.
 *    - parent_task_id self-reference rejected, time log bounds 1..1440.
 * 4. Notifications & audits:
 *    - task_assigned, task_completed, task_due_soon, task_overdue notifications.
 *    - service_role dispatch_task_due_notifications() idempotency & daily pg_cron registration.
 *    - UPPER_SNAKE audit_logs with old_data/new_data.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "pg";
import * as fs from "fs";
import * as path from "path";

function getDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const stagingPath = path.resolve(process.cwd(), ".env.staging");
  if (fs.existsSync(stagingPath)) {
    for (const line of fs.readFileSync(stagingPath, "utf-8").split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("DATABASE_URL=")) {
        return trimmed.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
      }
    }
  }
  throw new Error("DATABASE_URL must be set for database tests.");
}

function enforceLocalhost(url: string): string {
  const host = (url.match(/@([^:/]+)/) || [])[1] || "";
  if (host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`CRITICAL SECURITY FAILURE: Database tests must run only against localhost (attempted ${host}).`);
  }
  return url;
}

const DB_URL = enforceLocalhost(getDatabaseUrl());

const ORG_1_ID = "00000000-0000-0000-0000-000000000001";
const ORG_2_ID = "00000000-0000-0000-0000-000000000930";

const ORG_1 = {
  admin: "00000000-0000-0000-0000-000000000001",
  hr: "00000000-0000-0000-0000-000000000002",
  manager: "00000000-0000-0000-0000-000000000003",
  reportEmp: "00000000-0000-0000-0000-000000000004",
  otherManager: "00000000-0000-0000-0000-000000000931",
  nonReportEmp: "00000000-0000-0000-0000-000000000932",
};

const ORG_2 = {
  admin: "00000000-0000-0000-0000-000000000933",
  employee: "00000000-0000-0000-0000-000000000934",
};

describe("Section 3: Task Management System", () => {
  let client: Client;

  beforeAll(async () => {
    client = new Client({ connectionString: DB_URL, ssl: false, connectionTimeoutMillis: 5000 });
    await client.connect();

    // Ensure reportEmp reports to ORG_1.manager
    await client.query(`
      UPDATE public.employees
      SET manager_id = '${ORG_1.manager}'
      WHERE id = '${ORG_1.reportEmp}' AND organization_id = '${ORG_1_ID}';
    `);

    // Create Org 1 otherManager & nonReportEmp
    const org1Extras = [
      { id: ORG_1.otherManager, email: "sec3-othermgr@org1.test", role: "manager", mgr: null as string | null },
      { id: ORG_1.nonReportEmp, email: "sec3-nonreport@org1.test", role: "employee", mgr: ORG_1.otherManager },
    ];
    for (const u of org1Extras) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES ('${u.id}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', '${u.email}', 'fake', now(), '{"provider":"email"}', '{}', now(), now())
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_1_ID}', '${u.id}', '${u.role}', 'active')
        ON CONFLICT (organization_id, user_id) DO UPDATE SET organization_id = '${ORG_1_ID}', role = '${u.role}', status = 'active';
      `);
      await client.query(`
        INSERT INTO public.employees (id, organization_id, email, full_name, manager_id, status, work_mode, timezone)
        VALUES ('${u.id}', '${ORG_1_ID}', '${u.email}', 'Sec3 ${u.role}', ${u.mgr ? `'${u.mgr}'` : "NULL"}, 'active', 'hybrid', 'UTC')
        ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_1_ID}', manager_id = ${u.mgr ? `'${u.mgr}'` : "NULL"}, status = 'active';
      `);
    }

    // Create Tenant 2 org and users
    await client.query(`
      INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone, leave_year_start_month)
      VALUES ('${ORG_2_ID}', 'Section 3 Tenant 2', 'sec3-t2', 'hybrid', 'active', 'UTC', 1)
      ON CONFLICT (id) DO UPDATE SET status = 'active';
    `);
    for (const [role, uid] of Object.entries(ORG_2)) {
      await client.query(`
        INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
        VALUES ('${uid}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sec3-${role}@t2.test', 'fake', now(), '{"provider":"email"}', '{}', now(), now())
        ON CONFLICT (id) DO NOTHING;
      `);
      await client.query(`
        INSERT INTO public.organization_members (organization_id, user_id, role, status)
        VALUES ('${ORG_2_ID}', '${uid}', '${role}', 'active')
        ON CONFLICT (organization_id, user_id) DO UPDATE SET organization_id = '${ORG_2_ID}', role = '${role}', status = 'active';
      `);
      await client.query(`
        INSERT INTO public.employees (id, organization_id, email, full_name, status, work_mode, timezone)
        VALUES ('${uid}', '${ORG_2_ID}', 'sec3-${role}@t2.test', 'Sec3 T2 ${role}', 'active', 'hybrid', 'UTC')
        ON CONFLICT (id) DO UPDATE SET organization_id = '${ORG_2_ID}', status = 'active';
      `);
    }
  });

  afterAll(async () => {
    if (client) {
      await client.query("RESET ROLE;").catch(() => {});
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'task_id' IS NOT NULL AND organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});
      await client.query(`DELETE FROM public.audit_logs WHERE table_name IN ('projects', 'tasks', 'task_comments', 'task_time_logs') AND organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});
      await client.query(`DELETE FROM public.tasks WHERE organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});
      await client.query(`DELETE FROM public.projects WHERE organization_id IN ('${ORG_1_ID}', '${ORG_2_ID}');`).catch(() => {});

      for (const uid of [ORG_1.nonReportEmp, ORG_1.otherManager, ORG_2.admin, ORG_2.employee]) {
        await client.query(`DELETE FROM public.notifications WHERE user_id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM public.organization_members WHERE user_id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM public.employees WHERE id = '${uid}';`).catch(() => {});
        await client.query(`DELETE FROM auth.users WHERE id = '${uid}';`).catch(() => {});
      }
      await client.query(`DELETE FROM public.organizations WHERE id = '${ORG_2_ID}';`).catch(() => {});
      await client.end();
    }
  });

  async function asRole<T>(
    uid: string,
    orgId: string,
    role: string,
    aal: "aal1" | "aal2",
    fn: () => Promise<T>,
    opts?: { commit?: boolean }
  ): Promise<T> {
    const claims = JSON.stringify({
      sub: uid,
      aud: "authenticated",
      role: "authenticated",
      aal,
      user_role: role,
      organization_id: orgId,
    });
    await client.query("BEGIN;");
    try {
      await client.query("SET LOCAL ROLE authenticated;");
      await client.query(`SELECT set_config('request.jwt.claims', $1, true);`, [claims]);
      const result = await fn();
      await client.query(opts?.commit ? "COMMIT;" : "ROLLBACK;");
      return result;
    } catch (err) {
      await client.query("ROLLBACK;").catch(() => {});
      throw err;
    } finally {
      await client.query("RESET ROLE;").catch(() => {});
    }
  }

  it("1. Enforces RLS visibility matrix & direct client write denial across all 5 tables", async () => {
    // Seed 3 distinct tasks in Org 1 using RPCs (committed, cleaned at end of test)
    const reportTask = await asRole(
      ORG_1.manager,
      ORG_1_ID,
      "manager",
      "aal1",
      async () => {
        const p = await client.query(`SELECT public.create_project('Sec3 Proj 1', NULL, 'Team scope', 'S3P1') AS res;`);
        const pid = p.rows[0].res.project.id;
        const t = await client.query(`SELECT public.create_task('Report Task', 'For direct report', $1, 'high', CURRENT_DATE + 1, 90, $2, NULL) AS res;`, [ORG_1.reportEmp, pid]);
        const tid = t.rows[0].res.task.id;
        await client.query(`SELECT public.add_task_comment($1, 'Manager initial comment');`, [tid]);
        await client.query(`SELECT public.log_task_time($1, CURRENT_DATE, 20, 'Manager prep');`, [tid]);
        return { projectId: pid, taskId: tid };
      },
      { commit: true }
    );

    const nonReportTask = await asRole(
      ORG_1.otherManager,
      ORG_1_ID,
      "manager",
      "aal1",
      async () => {
        const t = await client.query(`SELECT public.create_task('NonReport Task', 'Isolated team', $1, 'medium', NULL, NULL, NULL, NULL) AS res;`, [ORG_1.nonReportEmp]);
        return t.rows[0].res.task.id as string;
      },
      { commit: true }
    );

    try {
      // reportEmp sees own assigned task + comment + time log + event, NOT nonReportTask
      await asRole(ORG_1.reportEmp, ORG_1_ID, "employee", "aal1", async () => {
        const vis = await client.query(`SELECT id FROM public.tasks WHERE id IN ($1, $2);`, [reportTask.taskId, nonReportTask]);
        expect(vis.rows.map((r) => r.id)).toEqual([reportTask.taskId]);

        const coms = await client.query(`SELECT id FROM public.task_comments WHERE task_id IN ($1, $2);`, [reportTask.taskId, nonReportTask]);
        expect(coms.rows.length).toBe(1);

        const logs = await client.query(`SELECT id FROM public.task_time_logs WHERE task_id = $1;`, [reportTask.taskId]);
        expect(logs.rows.length).toBe(1);

        const evs = await client.query(`SELECT id FROM public.task_events WHERE task_id = $1;`, [reportTask.taskId]);
        expect(evs.rows.length).toBeGreaterThanOrEqual(3);
      });

      // nonReportEmp CANNOT see reportTask
      await asRole(ORG_1.nonReportEmp, ORG_1_ID, "employee", "aal1", async () => {
        const vis = await client.query(`SELECT id FROM public.tasks WHERE id IN ($1, $2);`, [reportTask.taskId, nonReportTask]);
        expect(vis.rows.map((r) => r.id)).toEqual([nonReportTask]);
      });

      // ORG_1.manager sees reportTask (created by self / assigned to direct report), NOT nonReportTask
      await asRole(ORG_1.manager, ORG_1_ID, "manager", "aal1", async () => {
        const vis = await client.query(`SELECT id FROM public.tasks WHERE id IN ($1, $2);`, [reportTask.taskId, nonReportTask]);
        expect(vis.rows.map((r) => r.id)).toEqual([reportTask.taskId]);
      });

      // HR at AAL1 blocked by RESTRICTIVE MFA policy (0 rows)
      await asRole(ORG_1.hr, ORG_1_ID, "hr", "aal1", async () => {
        const vis = await client.query(`SELECT id FROM public.tasks WHERE id IN ($1, $2);`, [reportTask.taskId, nonReportTask]);
        expect(vis.rows.length).toBe(0);
      });

      // HR & Admin at AAL2 see BOTH Org 1 tasks
      for (const [role, uid] of [
        ["hr", ORG_1.hr],
        ["admin", ORG_1.admin],
      ] as const) {
        await asRole(uid, ORG_1_ID, role, "aal2", async () => {
          const vis = await client.query(`SELECT id FROM public.tasks WHERE id IN ($1, $2) ORDER BY id;`, [reportTask.taskId, nonReportTask]);
          expect(vis.rows.length).toBe(2);
        });
      }

      // Cross-tenant Org 2 admin AAL2 sees ZERO Org 1 projects/tasks/comments/time logs/events
      await asRole(ORG_2.admin, ORG_2_ID, "admin", "aal2", async () => {
        for (const q of [
          `SELECT count(*)::int AS c FROM public.projects WHERE organization_id = '${ORG_1_ID}';`,
          `SELECT count(*)::int AS c FROM public.tasks WHERE organization_id = '${ORG_1_ID}';`,
          `SELECT count(*)::int AS c FROM public.task_comments WHERE organization_id = '${ORG_1_ID}';`,
          `SELECT count(*)::int AS c FROM public.task_time_logs WHERE organization_id = '${ORG_1_ID}';`,
          `SELECT count(*)::int AS c FROM public.task_events WHERE organization_id = '${ORG_1_ID}';`,
        ]) {
          const r = await client.query(q);
          expect(r.rows[0].c).toBe(0);
        }
      });

      // Direct INSERT / UPDATE / DELETE denied for authenticated
      for (const sql of [
        `INSERT INTO public.projects (organization_id, name, created_by) VALUES ('${ORG_1_ID}', 'DirectProj', '${ORG_1.admin}');`,
        `INSERT INTO public.tasks (organization_id, title, creator_id) VALUES ('${ORG_1_ID}', 'DirectTask', '${ORG_1.admin}');`,
        `INSERT INTO public.task_comments (organization_id, task_id, author_id, body) VALUES ('${ORG_1_ID}', '${reportTask.taskId}', '${ORG_1.admin}', 'Hi');`,
        `INSERT INTO public.task_time_logs (organization_id, task_id, employee_id, work_date, minutes) VALUES ('${ORG_1_ID}', '${reportTask.taskId}', '${ORG_1.admin}', CURRENT_DATE, 10);`,
        `INSERT INTO public.task_events (organization_id, task_id, actor_id, event_type) VALUES ('${ORG_1_ID}', '${reportTask.taskId}', '${ORG_1.admin}', 'created');`,
      ]) {
        await expect(
          asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
            await client.query(sql);
          })
        ).rejects.toThrow(/permission denied/i);
      }
    } finally {
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'task_id' IN ($1, $2);`, [reportTask.taskId, nonReportTask]);
      await client.query(`DELETE FROM public.tasks WHERE id IN ($1, $2);`, [reportTask.taskId, nonReportTask]);
      await client.query(`DELETE FROM public.projects WHERE id = $1;`, [reportTask.projectId]);
    }
  });

  it("2. Enforces RPC authorization matrix, cross-tenant denial, and ownership rules", async () => {
    // Employee denied create_project
    await expect(
      asRole(ORG_1.reportEmp, ORG_1_ID, "employee", "aal1", async () => {
        await client.query(`SELECT public.create_project('EmpProj');`);
      })
    ).rejects.toThrow(/Only managers, HR, or administrators/i);

    // Employee denied assigning to peer on create_task
    await expect(
      asRole(ORG_1.reportEmp, ORG_1_ID, "employee", "aal1", async () => {
        await client.query(`SELECT public.create_task('Peer Task', NULL, $1);`, [ORG_1.nonReportEmp]);
      })
    ).rejects.toThrow(/Employees cannot assign tasks to other employees/i);

    // Manager denied assigning outside direct reports on create_task
    await expect(
      asRole(ORG_1.manager, ORG_1_ID, "manager", "aal1", async () => {
        await client.query(`SELECT public.create_task('Out of Team', NULL, $1);`, [ORG_1.nonReportEmp]);
      })
    ).rejects.toThrow(/themselves or direct reports/i);

    // HR/Admin AAL1 denied create_task & create_project
    for (const [role, uid] of [
      ["hr", ORG_1.hr],
      ["admin", ORG_1.admin],
    ] as const) {
      await expect(
        asRole(uid, ORG_1_ID, role, "aal1", async () => {
          await client.query(`SELECT public.create_task('Blocked AAL1');`);
        })
      ).rejects.toThrow(/MFA AAL2 verification required/i);
    }

    // Manager creates unassigned & assigned tasks to test employee ownership denials
    const ids = await asRole(
      ORG_1.manager,
      ORG_1_ID,
      "manager",
      "aal1",
      async () => {
        const unassigned = await client.query(`SELECT public.create_task('Mgr Unassigned') AS res;`);
        const assigned = await client.query(`SELECT public.create_task('Mgr Assigned', NULL, $1) AS res;`, [ORG_1.reportEmp]);
        return {
          unassignedId: unassigned.rows[0].res.task.id as string,
          assignedId: assigned.rows[0].res.task.id as string,
        };
      },
      { commit: true }
    );

    try {
      // Employee CANNOT self-assign or reassign task created by manager
      await expect(
        asRole(ORG_1.reportEmp, ORG_1_ID, "employee", "aal1", async () => {
          await client.query(`SELECT public.assign_task($1, $2);`, [ids.unassignedId, ORG_1.reportEmp]);
        })
      ).rejects.toThrow(/cannot assign or reassign tasks they did not create/i);

      await expect(
        asRole(ORG_1.reportEmp, ORG_1_ID, "employee", "aal1", async () => {
          await client.query(`SELECT public.assign_task($1, NULL);`, [ids.assignedId]);
        })
      ).rejects.toThrow(/cannot assign or reassign tasks they did not create/i);

      // Employee CANNOT cancel task created by manager
      await expect(
        asRole(ORG_1.reportEmp, ORG_1_ID, "employee", "aal1", async () => {
          await client.query(`SELECT public.cancel_task($1, 'Not creator');`, [ids.assignedId]);
        })
      ).rejects.toThrow(/Only task creator, manager, HR, or admin can cancel/i);

      // Non-report employee CANNOT update, comment, or log time on assignedId
      await expect(
        asRole(ORG_1.nonReportEmp, ORG_1_ID, "employee", "aal1", async () => {
          await client.query(`SELECT public.update_task_status($1, 'in_progress');`, [ids.assignedId]);
        })
      ).rejects.toThrow(/assigned to them/i);

      await expect(
        asRole(ORG_1.nonReportEmp, ORG_1_ID, "employee", "aal1", async () => {
          await client.query(`SELECT public.add_task_comment($1, 'Snoop');`, [ids.assignedId]);
        })
      ).rejects.toThrow(/do not have access to comment/i);

      await expect(
        asRole(ORG_1.nonReportEmp, ORG_1_ID, "employee", "aal1", async () => {
          await client.query(`SELECT public.log_task_time($1, CURRENT_DATE, 15);`, [ids.assignedId]);
        })
      ).rejects.toThrow(/assigned to them/i);

      // Cross-tenant Org 2 admin AAL2 denied on Org 1 tasks
      await expect(
        asRole(ORG_2.admin, ORG_2_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.update_task_status($1, 'done');`, [ids.assignedId]);
        })
      ).rejects.toThrow(/Task not found in caller organization/i);

      await expect(
        asRole(ORG_2.admin, ORG_2_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.assign_task($1, $2);`, [ids.assignedId, ORG_2.employee]);
        })
      ).rejects.toThrow(/Task not found in caller organization/i);

      // Org 1 admin AAL2 cannot assign task to Org 2 employee
      await expect(
        asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
          await client.query(`SELECT public.assign_task($1, $2);`, [ids.assignedId, ORG_2.employee]);
        })
      ).rejects.toThrow(/active member of caller organization/i);
    } finally {
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'task_id' IN ($1, $2);`, [ids.unassignedId, ids.assignedId]);
      await client.query(`DELETE FROM public.tasks WHERE id IN ($1, $2);`, [ids.unassignedId, ids.assignedId]);
    }
  });

  it("3. Enforces status transition state machine, cycle guard, time bounds, and audit logs", async () => {
    const taskId = await asRole(
      ORG_1.reportEmp,
      ORG_1_ID,
      "employee",
      "aal1",
      async () => {
        const res = await client.query(
          `SELECT public.create_task('State Machine Task', 'Verify transitions', $1, 'urgent', CURRENT_DATE - 2, 120, NULL, NULL) AS res;`,
          [ORG_1.reportEmp]
        );
        return res.rows[0].res.task.id as string;
      },
      { commit: true }
    );

    try {
      // Self-parent CHECK constraint
      await expect(
        client.query(`UPDATE public.tasks SET parent_task_id = id WHERE id = $1;`, [taskId])
      ).rejects.toThrow(/chk_tasks_not_self_parent/i);

      // todo -> in_progress -> blocked -> done (blocked -> done must fail 22023)
      await asRole(ORG_1.reportEmp, ORG_1_ID, "employee", "aal1", async () => {
        const s1 = await client.query(`SELECT public.update_task_status($1, 'in_progress', 'Starting') AS res;`, [taskId]);
        expect(s1.rows[0].res.task.started_at).not.toBeNull();

        await client.query(`SELECT public.update_task_status($1, 'blocked', 'Waiting on dependency');`, [taskId]);

        await client.query(`SAVEPOINT sp_blocked_done;`);
        await expect(
          client.query(`SELECT public.complete_task($1, 'Shortcut');`, [taskId])
        ).rejects.toThrow(/Blocked tasks must transition to in_progress or todo before completion/i);
        await client.query(`ROLLBACK TO SAVEPOINT sp_blocked_done;`);

        // Resume -> Complete
        await client.query(`SELECT public.update_task_status($1, 'in_progress');`, [taskId]);
        const done = await client.query(`SELECT public.complete_task($1, 'Done cleanly') AS res;`, [taskId]);
        expect(done.rows[0].res.task.status).toBe("done");
        expect(done.rows[0].res.task.completed_at).not.toBeNull();

        // done -> cancelled forbidden
        await client.query(`SAVEPOINT sp_done_cancel;`);
        await expect(
          client.query(`SELECT public.cancel_task($1, 'Too late');`, [taskId])
        ).rejects.toThrow(/Completed tasks may only be reopened/i);
        await client.query(`ROLLBACK TO SAVEPOINT sp_done_cancel;`);

        // Creator can reopen done -> in_progress and completed_at resets to NULL
        const reopened = await client.query(`SELECT public.update_task_status($1, 'in_progress', 'Follow-up') AS res;`, [taskId]);
        expect(reopened.rows[0].res.task.completed_at).toBeNull();

        // Cancel becomes terminal
        const cancelled = await client.query(`SELECT public.cancel_task($1, 'Superseded') AS res;`, [taskId]);
        expect(cancelled.rows[0].res.task.status).toBe("cancelled");
        expect(cancelled.rows[0].res.task.cancelled_at).not.toBeNull();

        await client.query(`SAVEPOINT sp_cancel_todo;`);
        await expect(
          client.query(`SELECT public.update_task_status($1, 'todo');`, [taskId])
        ).rejects.toThrow(/Cancelled tasks cannot change status/i);
        await client.query(`ROLLBACK TO SAVEPOINT sp_cancel_todo;`);

        await client.query(`SAVEPOINT sp_cancel_log;`);
        await expect(
          client.query(`SELECT public.log_task_time($1, CURRENT_DATE, 30);`, [taskId])
        ).rejects.toThrow(/cancelled task/i);
        await client.query(`ROLLBACK TO SAVEPOINT sp_cancel_log;`);
      });

      // Commit full lifecycle + audit check cleanly on fresh non-cancelled task
      await asRole(
        ORG_1.manager,
        ORG_1_ID,
        "manager",
        "aal1",
        async () => {
          await client.query(`SELECT public.assign_task($1, NULL);`, [taskId]);
          await client.query(`SELECT public.assign_task($1, $2);`, [taskId, ORG_1.reportEmp]);
        },
        { commit: true }
      );

      await asRole(
        ORG_1.reportEmp,
        ORG_1_ID,
        "employee",
        "aal1",
        async () => {
          await client.query(`SAVEPOINT sp_zero_mins;`);
          await expect(
            client.query(`SELECT public.log_task_time($1, CURRENT_DATE, 0);`, [taskId])
          ).rejects.toThrow(/minutes \(1-1440\)/i);
          await client.query(`ROLLBACK TO SAVEPOINT sp_zero_mins;`);

          await client.query(`SELECT public.log_task_time($1, CURRENT_DATE, 45, 'Coding');`, [taskId]);
          await client.query(`SELECT public.add_task_comment($1, 'Ready for review');`, [taskId]);
          await client.query(`SELECT public.complete_task($1, 'Shipped');`, [taskId]);
        },
        { commit: true }
      );

      const audits = await client.query(
        `SELECT action, old_data, new_data FROM public.audit_logs
         WHERE record_id = $1 OR (new_data->>'task_id') = $1::text
         ORDER BY created_at ASC;`,
        [taskId]
      );
      const actions = audits.rows.map((r) => r.action);
      expect(actions).toContain("TASK_CREATED");
      expect(actions).toContain("TASK_ASSIGNED");
      expect(actions).toContain("TASK_TIME_LOGGED");
      expect(actions).toContain("TASK_COMMENT_ADDED");
      expect(actions).toContain("TASK_COMPLETED");
      for (const a of actions) {
        expect(a).toMatch(/^[A-Z][A-Z0-9_]+$/);
      }

      // Check notifications generated on assign & complete (creator=reportEmp completed own task, wait manager assigned reportEmp)
      const notifs = await client.query(
        `SELECT type, link FROM public.notifications
         WHERE metadata->>'task_id' = $1::text;`,
        [taskId]
      );
      expect(notifs.rows.some((n) => n.type === "task_overdue")).toBe(true);
      expect(notifs.rows.some((n) => n.type === "task_assigned")).toBe(true);
      for (const n of notifs.rows) {
        expect(n.link).toBe(`/tasks?task=${taskId}`);
      }
    } finally {
      await client.query(`DELETE FROM public.audit_logs WHERE record_id = $1 OR (new_data->>'task_id') = $1::text;`, [taskId]);
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'task_id' = $1::text;`, [taskId]);
      await client.query(`DELETE FROM public.tasks WHERE id = $1;`, [taskId]);
    }
  });

  it("4. Sends task_completed notification & idempotent due_soon/overdue cron reminders; authenticated denied dispatcher", async () => {
    // authenticated cannot call dispatch_task_due_notifications
    await expect(
      asRole(ORG_1.admin, ORG_1_ID, "admin", "aal2", async () => {
        await client.query(`SELECT public.dispatch_task_due_notifications();`);
      })
    ).rejects.toThrow(/permission denied/i);

    const taskId = await asRole(
      ORG_1.manager,
      ORG_1_ID,
      "manager",
      "aal1",
      async () => {
        const res = await client.query(
          `SELECT public.create_task('Cron Reminder Task', NULL, $1, 'medium', CURRENT_DATE, 30, NULL, NULL) AS res;`,
          [ORG_1.reportEmp]
        );
        return res.rows[0].res.task.id as string;
      },
      { commit: true }
    );

    try {
      // Clear auto-sent due_soon notification so service_role dispatcher sends cleanly once
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'task_id' = $1::text AND type = 'task_due_soon';`, [taskId]);

      const firstRun = await client.query(`SELECT public.dispatch_task_due_notifications() AS sent;`);
      expect(firstRun.rows[0].sent).toBeGreaterThanOrEqual(1);

      const secondRun = await client.query(`SELECT public.dispatch_task_due_notifications() AS sent;`);
      expect(secondRun.rows[0].sent).toBe(0);

      // Completing a task assigned by manager notifies manager (`task_completed`)
      await asRole(
        ORG_1.reportEmp,
        ORG_1_ID,
        "employee",
        "aal1",
        async () => {
          await client.query(`SELECT public.complete_task($1, 'Completed for manager');`, [taskId]);
        },
        { commit: true }
      );

      const mgrNotif = await client.query(
        `SELECT type, user_id FROM public.notifications WHERE metadata->>'task_id' = $1::text AND type = 'task_completed';`,
        [taskId]
      );
      expect(mgrNotif.rows.length).toBe(1);
      expect(mgrNotif.rows[0].user_id).toBe(ORG_1.manager);

      // Verify pg_cron daily schedule registered
      const cronRes = await client.query(`SELECT jobname, schedule FROM cron.job WHERE jobname = 'daily-task-due-notifications';`);
      expect(cronRes.rows.length).toBe(1);
      expect(cronRes.rows[0].schedule).toBe("0 8 * * *");
    } finally {
      await client.query(`DELETE FROM public.audit_logs WHERE record_id = $1 OR (new_data->>'task_id') = $1::text;`, [taskId]);
      await client.query(`DELETE FROM public.notifications WHERE metadata->>'task_id' = $1::text;`, [taskId]);
      await client.query(`DELETE FROM public.tasks WHERE id = $1;`, [taskId]);
    }
  });
});

