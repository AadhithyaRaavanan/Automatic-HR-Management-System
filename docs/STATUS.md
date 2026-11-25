# Current handoff

Updated 25 November 2026.

The HR application now uses the feature-directory and handoff pattern from the Digital Twin final-year project. Start a new feature task at its row in the [module map](MODULES.md). Use the [document index](INDEX.md) for requirements or prior decisions.

## Verification

- `npm run build` and `npx tsc --noEmit --incremental false` passed. All 126 source page and route-handler paths survived the move. All 128 entries in the built route manifest matched the previous build.
- Local Chromium rendered sign-in, loaded its stylesheet and opened the password-recovery form. The production server served the web manifest, icon, privacy and terms pages, redirected a signed-out request for `/settings` to `/login`, and returned HTTP 401 for unauthenticated notifications.
- `npm run verify:docs` passed. All 69 concrete source, test and documentation paths listed in the module guide resolved.
- All 211 unit tests passed on a clean install using `npm ci --legacy-peer-deps`. The four previously failing assertions now exercise the Pulse email branding, the sidebar search button and the collapse/expand commands. The React tests declare their Testing Library DOM dependency explicitly so a clean CI installation can collect them.
- Comparing all 274 relocated source files against the previous commit showed identical contents after resolving import paths. The branch contains no changes to SQL migrations, seeds or deployed database configuration.

## Database release blocker

The checked-in migrations fail on a fresh Supabase installation. The [multi-tenancy migration](../supabase/migrations/20261107000008_multi_tenancy_and_workforce.sql) makes `user_roles` a read-only compatibility view. The later [employee migration](../supabase/migrations/20261117000002_complete_employee_and_attendance.sql) attempts to apply a table constraint to it. PostgreSQL stops with SQLSTATE `42809`.

An isolated diagnostic replay then reached a second conflict. The [original KPI migration](../supabase/migrations/20261108000015_kpi_system.sql) creates reviews with a period ID, one rating and a comment. The [KPI redesign](../supabase/migrations/20261118000001_kpi_redesign.sql) assumes dated reviews with structured ratings, and fails on the missing `period_start` column. The existing local development database also has the older columns. Migration experiments ran only on a disposable database.

Before merging for release, reconcile both schema versions using a data-preserving upgrade tested against representative historical reviews. Verify old review values and tenant permissions before and after the upgrade, then run the database integration and authenticated browser suites against that disposable instance. Those suites remain unverified.
