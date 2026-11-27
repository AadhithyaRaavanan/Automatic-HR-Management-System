# Working on Pulse

- For a named feature, go directly to its row in [the module map](docs/MODULES.md). Open the affected entry point and closest test. Follow imports or search for one route, symbol or SQL routine when the change crosses a boundary.
- For a resumed task, read [the handoff](docs/STATUS.md) and check the working diff for the named files. Reuse facts already established in the session. Recheck a file when it changed or when the task depends on a detail the handoff omits.
- Use [the document index](docs/INDEX.md) to select a requirement or runbook. Routine `rg` searches skip archived reports, database snapshots and release logs. Name those paths explicitly for historical questions. Use `.env.example` for configuration names.
- Keep feature-specific UI, hooks, types and business logic together in `src/features/<feature>/`. Next.js pages and HTTP handlers live in `src/app/`. Keep browser and server-only imports separate. Preserve public URLs, organization scope, role checks and row-level security when changing a feature.
- Run the focused check first. For shared layout, routing or configuration changes, also run the unit suite and production build. Record verified results and any remaining issue in the handoff when they change what the next session needs to know. Update the module map when ownership or entry points move.
