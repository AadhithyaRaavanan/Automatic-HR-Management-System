# Modular monolith build guide

Pulse has one npm package and one Next.js build. Both the employee interface and administrative API use the same source tree. A feature can call another feature through a TypeScript import. Browser code reaches server operations through a route handler or an existing Supabase client call. Supabase owns the database and runs the [retention Edge Function](../supabase/functions/retention-archiver/index.ts) separately.

## Find the code for a task

Paths in this table start at the repository root. Within `src/app`, a page uses `page.tsx` and an API handler uses `route.ts`. Test filenames below are in `tests/unit` unless a different directory is shown.

| Task | First place to look | Nearby check |
| --- | --- | --- |
| Sign-in, MFA or session redirects | `src/app/(auth)/`, `src/app/api/auth/`, `src/features/auth/`. Session refresh starts at `src/middleware.ts`. | `login-membership.test.ts`, `auth-redirect.test.ts` |
| Attendance, breaks or calendars | `src/app/attendance/`, `src/features/attendance/`, `src/app/api/attendance/`. The calendar card lives in `src/features/calendar/`. | `attendance-engine.test.ts`, `tests/e2e/01-attendance.spec.ts` |
| Leave, holidays or accrual | `src/features/leave/`, `src/app/hr/leave/`, `src/app/api/leave/`, `src/app/api/cron/leave-accrual/`. Holiday and working-day helpers live in `src/lib/date/`. | `tests/database/leave-rpcs.test.ts`, `tests/e2e/03-leave.spec.ts` |
| Attendance corrections or permission requests | `src/features/requests/`, `src/app/requests/`, `src/app/api/requests/`, `src/app/api/permissions/` | `regularization-flow.test.ts` |
| Employee directory, teams or EMS | `src/app/employees/`, `src/app/ems/`, `src/features/ems/`, `src/app/api/employees/`, `src/app/api/ems/` | `employee-management-system.test.ts` |
| Employee invitations or administration | `src/app/admin/`, `src/features/admin/`, `src/app/api/admin/` | `admin-user-routes.test.ts` |
| Candidate onboarding and HR approval | `src/app/onboarding/`, `src/features/onboarding/`, `src/app/api/onboarding/`, `src/app/api/hr/onboarding/` | `onboarding.test.ts` |
| Tasks, due dates or recurrence | `src/features/tasks/`, `src/app/tasks/`, `src/app/api/tasks/` | `tasks-due-state.test.ts`, `tests/database/section3-tasks.test.ts` |
| KPI scoring, goals or reviews | `src/features/kpi/compute.ts`, `src/features/kpi/components/`, `src/app/api/kpi/` | `kpi-formulas.test.ts` |
| Notifications, preferences or reminders | `src/features/notifications/`, `src/app/api/notifications/`, `src/app/api/cron/notifications/` | Follow the emitting feature's test and the relevant delivery check in `docs/MANUAL_TESTING_GUIDE.md`. |
| Reports or data export | `src/app/reports/` and the owning API, such as `src/app/api/attendance/export/` | `f10-reporting.test.ts` |
| Retention and archives | `src/features/retention/archiver.ts`, `src/app/api/admin/retention/`, `supabase/functions/retention-archiver/` | `tests/database/section2-retention.test.ts` |
| Navigation, theme or product tour | `src/components/shell/`, `src/app/globals.css`, `src/features/tutorial/` | `sidebar-collapse.test.tsx`, `tests/e2e/08-profile-tutorial.spec.ts` |

## Trace a check-in

1. The [check-in hook](../src/features/attendance/hooks/use-check-in.ts) sends a POST to `/api/attendance/check-in` with an idempotency key.
2. The [route handler](../src/app/api/attendance/check-in/route.ts) checks the caller, resolves their employment and organization, and writes the session. Start here for a rejected punch.
3. For time calculations, open the [attendance unit test](../tests/unit/attendance-engine.test.ts). For a database rule, search the [migrations](../supabase/migrations/) for the table or routine named in the handler. For the browser interaction, open the [attendance flow](../tests/e2e/01-attendance.spec.ts).

## Place a change

- Put feature-owned code beside its callers in `src/features/<feature>/`. Use `src/components/` for reusable UI and shell components, and `src/lib/` for shared infrastructure such as Supabase clients, email and date utilities. The `@/` import prefix resolves to `src/`.
- Keep pages and API handlers at their matching URL segments. Some pages and handlers contain the full implementation. When editing one, extract reusable logic into its feature when needed.
- Put schema changes in [the migration directory](../supabase/migrations/) and check [TypeScript database contracts](../src/types/database.types.ts) when changing a table or RPC signature.
- From the repository root, run a focused test with `npx vitest run tests/unit/tasks-due-state.test.ts`, substituting the relevant file. The [handoff](STATUS.md) records the last broad verification.
