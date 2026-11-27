# Pulse · Automatic HR Management System

Pulse (RemoteHR) manages attendance, leave, employee records, onboarding, tasks and performance reviews. The browser UI and HTTP API ship together as one Next.js application. Supabase provides authentication, PostgreSQL and file storage.

## Start here

| If you want to… | Open |
| --- | --- |
| Change an HR feature | [Module map and build guide](docs/MODULES.md) |
| Resume work from another session | [Current handoff](docs/STATUS.md) |
| Find a requirement, testing guide or runbook | [Document index](docs/INDEX.md) |
| Work with Antigravity | [Workspace instructions](AGENTS.md) |

## Run locally

From this directory, use Node.js 20 (the CI version) and npm. On a fresh checkout, install the locked dependencies with `npm ci --legacy-peer-deps`. For first-time setup, copy [.env.example](.env.example) to `.env.local`, then enter the URL and keys for your development Supabase instance. The schema and seed files are in [supabase](supabase/).

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000). Run `npm test` for the unit suite, `npm run verify:docs` for documentation checks, and `npm run build` for a production build.
