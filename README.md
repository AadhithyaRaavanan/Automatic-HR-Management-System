# RemoteHR (Pulse) — Enterprise Automatic HR Management System

[![Next.js](https://img.shields.io/badge/Next.js-14.2%20App%20Router-black?logo=next.js)](https://nextjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-Strict%205.6-blue?logo=typescript)](https://www.typescriptlang.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4%20Bento%20Tokens-38bdf8?logo=tailwindcss)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-Auth%20%7C%20Postgres%20%7C%20RLS-3ecf8e?logo=supabase)](https://supabase.com/)
[![Vitest](https://img.shields.io/badge/Vitest-Unit%20Tests%20Passing-green?logo=vitest)](https://vitest.dev/)
[![Playwright](https://img.shields.io/badge/Playwright-E2E%20Automated-orange?logo=playwright)](https://playwright.dev/)
[![WCAG AA](https://img.shields.io/badge/Accessibility-WCAG%20AA%20Compliant-purple)](#accessibility--contrast)
[![Multi-Tenant](https://img.shields.io/badge/Multi--Tenant-RLS%20Isolated-blueviolet)](#1-core-architecture--multi-tenancy)

**RemoteHR** (internally code-named **Pulse**) is a production-grade, multi-tenant Human Resource Management System (HRMS) built for remote, hybrid, and distributed companies. It combines zero-invasive attendance tracking, automated shift engines, leave governance, task allocation, performance (KPI) scoring, candidate onboarding, real-time notification alerts, and role-based access control (RBAC) backed by Time-Based One-Time Password Multi-Factor Authentication (TOTP MFA).

---

## 📑 Table of Contents

1. [High-Level Architecture & Data Flow](#-high-level-architecture--data-flow)
2. [Visual Design & Bento UI System](#-visual-design--bento-ui-system)
3. [Zero-Invasive Privacy Manifesto](#-zero-invasive-privacy-manifesto)
4. [Complete Module Breakdown](#-complete-module-breakdown)
   - [Authentication, Security & MFA Suite](#1-authentication-security--mfa-suite)
   - [Employee Management System (EMS)](#2-employee-management-system-ems)
   - [Attendance Tracking & Live Time Clock](#3-attendance-tracking--live-time-clock)
   - [Leave Management & Accrual Engine](#4-leave-management--accrual-engine)
   - [Task Management & Recurrence System](#5-task-management--recurrence-system)
   - [Performance & Automated KPI Engine](#6-performance--automated-kpi-engine)
   - [Candidate Onboarding Portal](#7-candidate-onboarding-portal)
   - [Real-Time Notification & Audio Chime Engine](#8-real-time-notification--audio-chime-engine)
   - [Reporting, Analytics & Data Portability](#9-reporting-analytics--data-portability)
   - [System Administration & Audit Governance](#10-system-administration--audit-governance)
5. [Role-Based Access Control (RBAC) Matrix](#-role-based-access-control-rbac-matrix)
6. [Quick Start & Local Setup Guide](#-quick-start--local-setup-guide)
7. [Demo Accounts & Development Mode](#-demo-accounts--development-mode)
8. [Environment Configuration Reference](#-environment-configuration-reference)
9. [Testing & Quality Assurance](#-testing--quality-assurance)
10. [Production Deployment & Operational Runbook](#-production-deployment--operational-runbook)
11. [License](#-license)

---

## 🏛️ High-Level Architecture & Data Flow

The platform is designed around Next.js App Router for server-rendered layouts and API endpoints, connected to a dedicated PostgreSQL database managed through Supabase with Row-Level Security (RLS) on all tables.

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Next.js App Router (Client / SSR)               │
│   ├── Bento Grid Dashboard (Attendance, Calendar, KPIs, Tasks, Teams)  │
│   ├── Realtime Audio Engine (Web Audio API Buffer + Dual Chime Tone)   │
│   └── RBAC Route Guards (MFA Step-Up, AAL2 Gating, Sanity Checks)      │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ HTTPS / WSS
┌────────────────────────────────────▼───────────────────────────────────┐
│                     Next.js Edge & Node API Handlers                   │
│   ├── /api/auth/login, /api/auth/verify-otp, /api/auth/magic-link      │
│   ├── /api/attendance/* (Check-In, Check-Out, Breaks, Export)          │
│   ├── /api/kpi/* (Goals, Reviews, Periods, Scorecards)                 │
│   ├── /api/tasks/* (Assignments, Recurrences, Sound Dispatch)          │
│   └── /api/cron/* (Nightly Auto-Checkout, Day Consolidation)           │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ Supabase Service / JWT
┌────────────────────────────────────▼───────────────────────────────────┐
│                       Supabase Cloud / PostgreSQL                      │
│   ├── Multi-Tenant RLS Policies (100% tenant-isolated via current_org) │
│   ├── Custom Access Token Hook (Minting organization_id & user_role)   │
│   ├── Security Definer Stored Procedures (Atomic Check-in/out & Recalc)│
│   ├── Database Triggers (Audit logging, Timestamp updates)             │
│   └── Supabase Realtime Channels (Instant presence & notification bus) │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 🎨 Visual Design & Bento UI System

The user interface follows a modern Bento Grid architecture with high-contrast, accessible visual hierarchy:

| Design Token | Value | Description / Usage |
| :--- | :--- | :--- |
| **Canvas Tone** | `#D9DBEC` | Soft lavender backdrop across all authenticated views |
| **App Shell** | `#FFFFFF` | Centered rounded desktop container with `rounded-[32px]` and diffuse shadow |
| **Curved Sidebar** | `#6C5CE7` | Signature Brand Purple with smooth squircle active states |
| **Primary Buttons**| `#14123A` | Deep Navy primary CTA buttons with tactile focus rings |
| **Accent Glow** | `#8B5CF6` / `#A78BFA` | Violet glow on hover states and active countdown dials |
| **Bento Grid** | 12-Column Grid | Responsive modular layout with `rounded-[24px]` cards |
| **Typography** | Plus Jakarta Sans | High legibility font strictly compliant with WCAG AA ($\ge 4.5:1$) |
| **Design Gallery** | `/gallery` | Live visual preview of all components, badges, and tokens |

---

## 🛡️ Zero-Invasive Privacy Manifesto

RemoteHR is founded on the principle that mutual respect and transparency drive true productivity. **All invasive monitoring mechanisms are strictly excluded:**

- ❌ **No Keystroke Logging**: Never records typing velocity or key combinations.
- ❌ **No Mouse Tracking**: Never monitors mouse coordinate jitter or idle movement.
- ❌ **No Webcam / Screen Captures**: Never takes automated background screenshots or photos.
- ❌ **No Background Geolocation Sniffing**: Never polls background device GPS coordinates.
- ✅ **Recorded Data Only**: Explicit check-in timestamps, explicit check-out timestamps, employee-entered punch notes, and calculated durations against company shift rules.
- 📜 **Full Transparency**: Any employee can review the full privacy pledge under the [Settings](file:///c:/Users/Hp/OneDrive/Desktop/Automatic%20HR%20Management%20System/app/settings/page.tsx) page.

---

## 📦 Complete Module Breakdown

### 1. Authentication, Security & MFA Suite
- **Password & Magic Link Auth**: Standard password login alongside passwordless single-use email magic links.
- **Two-Factor Authentication (TOTP / AAL2)**: Gated via RFC 6238 time-based authenticator apps (Google Authenticator, 1Password, Authy).
- **Step-Up Verification**: Administrative mutations (inviting employees, altering policies, exporting data) enforce Authenticator Assurance Level 2 (AAL2).
- **Native Bot Protection (Cloudflare Turnstile)**: Embedded Turnstile CAPTCHA protects against credential stuffing and automated bot assaults.
- **Configurable Rate Limiting**: Dual-level protection tracking client IP and target email in `public.auth_rate_limits`. Configurable or bypassable in development using `DISABLE_AUTH_RATE_LIMIT=true`.
- **Instant Authentication Overlay**: Blur overlay displaying `"Authenticating & Syncing Session..."` to prevent duplicate clicks.

### 2. Employee Management System (EMS)
- **Centralized Directory (`/ems/employees`)**: Searchable, facet-filtered directory with avatars, department tags, job designations, and status badges (`Active`, `Onboarding`, `Terminated`).
- **Department Tree (`/ems/departments` & `/admin/departments`)**: Hierarchical structure with assigned department heads.
- **Job Designations (`/ems/designations`)**: Title mapping, organizational rank, and grade bands.
- **Team Roster Management (`/ems/teams`)**: Direct-report squad assignments under specific team leads.
- **Internship Pipeline (`/ems/internships`)**: Tracking intern cohorts, tenure duration, and conversion pipelines.
- **Bulk CSV Import (`/admin/users/bulk-import`)**: Uploading employee rosters with auto-generated invitations.

### 3. Attendance Tracking & Live Time Clock
- **Live Stopwatch**: Single-click punch with active real-time elapsed timer (`HH:MM:SS`) persisted across route changes via `AttendanceProvider`.
- **Single Open Session Guarantee**: Enforced by a PostgreSQL partial unique index (`idx_single_open_session`) preventing concurrent active check-ins.
- **5-Minute Pre-Shift Locking**: Check-in button unlocks exactly 5 minutes before scheduled shift start time.
- **Late Arrival Flagging**: Automatically flags punch as `is_late = TRUE` if clocked in after the shift start time plus grace period (default: 15 minutes).
- **Timezone Crossover Protection**: Seamless handling of remote staff working across midnight boundaries (`Asia/Kolkata`, `America/New_York`, `UTC`).
- **Break Time Tracker**: Log lunch and coffee pauses with live pause counters.
- **Automated Nightly Processing**:
  - `cron_auto_checkout` at 23:59: Automatically closes unclosed punches with `source = 'auto'`.
  - Day consolidation cron at 01:00 AM: Reconciles total hours, identifies unexcused absences, and finalizes records.
- **Regularization Workflow (`/requests`)**: Self-service correction request modal for forgotten check-outs, routed to manager approval queues.

### 4. Leave Management & Accrual Engine
- **Leave Types**: Casual Leave (CL), Sick Leave (SL), Earned/Privilege Leave (EL/PL), Maternity/Paternity, and Unpaid Leave.
- **Balance Governance**: Dynamic calculation of consumed vs. remaining allowances.
- **Approval Lifecycle**: Employee submits $\rightarrow$ Manager/HR review modal with accept/reject notes $\rightarrow$ Approved leaves automatically update `attendance_days` to status `on_leave`.
- **Calendar Visualization**: Leave blocks highlighted across personal and team calendars to prevent scheduling conflicts.

### 5. Task Management & Recurrence System
- **Task Workspace (`/tasks`)**: Task cards with priority indicators (`Low`, `Medium`, `High`, `Urgent`), estimated hours, and due dates.
- **Recurring Tasks**: Automated generation of daily, weekly, or monthly recurring duties.
- **Assignment Dispatch**: Assigning tasks immediately triggers a real-time notification with sound to the assignee.

### 6. Performance & Automated KPI Engine
- **8 Automated KPI Metrics**:
  1. *Attendance Rate*: Percentage of scheduled workdays attended.
  2. *Punctuality Rate*: Percentage of shifts started on time without late flags.
  3. *Task Completion Rate*: Percentage of assigned tasks completed.
  4. *On-Time Task Delivery*: Tasks completed on or before the due date.
  5. *Billable / Logged Hours*: Total hours logged against assigned work.
  6. *Overtime Contribution*: Overtime volume relative to policy ceilings.
  7. *Leave Policy Adherence*: Absence patterns and leave notice compliance.
  8. *Manager Qualitative Review*: Manager evaluation score (1.0 to 5.0).
- **Weighted Formula**: Division-by-zero protected calculation:
  $$\text{Weighted Total} = \frac{\sum (\text{metric\_score} \times \text{weight})}{\text{NULLIF}(\sum \text{weight}, 0)}$$
- **Evaluation Cycles (`/kpi`)**: Review cycles (Monthly, Quarterly, Annual) with employee self-evaluations and manager sign-offs.

### 7. Candidate Onboarding Portal
- **Self-Service Wizard (`/onboarding`)**: Candidate portal for entering personal details, emergency contacts, bank details, and address.
- **Document Verification**: Upload government IDs, educational certificates, and experience letters.
- **HR Review Center (`/hr/onboarding`)**: HR review dashboard to inspect uploaded documents, request document revisions, approve profiles, and auto-provision active employee records.
- **Google Drive Storage Sync**: Automated synchronization of onboarding documents with designated corporate folders.

### 8. Real-Time Notification & Audio Chime Engine
- **Realtime Push**: Supabase Realtime channel bus delivers live notifications without page polling.
- **High-Fidelity Audio Engine**:
  - Engineered master audio featuring a crisp musical chime played **twice** (Chime 1 + 130ms musical gap + Chime 2) encoded in both high-definition MP3 (`/notification.mp3`) and uncompressed 44.1kHz 16-bit PCM WAV (`/notification.wav`).
  - **Zero-Latency Web Audio API Buffer**: Pre-decodes into an in-memory `AudioBuffer` on initial user interaction to eliminate playback delay.
  - **HTML5 Audio Fallback**: Auto-fallback channel ensuring reliable playback across mobile browsers and background tabs.
  - **Active Login Chime**: Plays the chime tone automatically when a user logs in with unread notifications waiting in their inbox.

### 9. Reporting, Analytics & Data Portability
- **Attendance & KPI Ledger (`/reports`)**: TanStack Table with multi-column sorting, facet filtering, date range pickers, and keyset pagination.
- **Interactive Visualizations**: Recharts trends for punctuality, attendance rates, departmental hours, and absenteeism.
- **Excel Export Engine (`/api/attendance/export`)**: Server-side formatted `.xlsx` workbooks generated using `exceljs`, styled with Navy headers (`#14123A`), bold text, and formulas.
- **Streaming CSV Export**: Fast fallback exports with sanitization protecting against formula injection (`=, +, -, @`).

### 10. System Administration & Audit Governance
- **Role Governance (`/admin/users`)**: Managing system roles, resetting MFA factors, or deactivating accounts (with triggers protecting against deleting the sole remaining administrator).
- **Shift Policies (`/admin/shifts`)**: Standard day, afternoon, and rotational night shift configurations.
- **Data Retention & Archiving**: Configurable retention thresholds (90, 180, 365 days) with mandatory gzip-compressed cloud archiving before deletion.
- **Immutable Audit Trail (`/admin/audits`)**: Detailed tracking of actor ID, IP address, target table, action (`INSERT`, `UPDATE`, `DELETE`), old values, and new values.

---

## 👥 Role-Based Access Control (RBAC) Matrix

RemoteHR enforces 4 distinct roles stored in the database `user_roles` table:

| Capability / Route | Employee | Manager | HR Admin | System Admin |
| :--- | :---: | :---: | :---: | :---: |
| **Personal Attendance Stopwatch & Calendar** (`/`, `/attendance`) | ✅ | ✅ | ✅ | ✅ |
| **Submit Missed Punch Regularization** (`/requests`) | ✅ | ✅ | ✅ | ✅ |
| **Personal Leave Portal & Balances** (`/leave`) | ✅ | ✅ | ✅ | ✅ |
| **Personal Tasks & Work Board** (`/tasks`) | ✅ | ✅ | ✅ | ✅ |
| **Self-Service Profile & Privacy Manifesto** (`/profile`, `/settings`) | ✅ | ✅ | ✅ | ✅ |
| **Team Hub & Live Presence Stack** (`/team`) | ❌ | ✅ | ✅ | ✅ |
| **Approve/Reject Direct Report Regularizations** | ❌ | ✅ | ✅ | ✅ |
| **Approve/Reject Team Leave Requests** | ❌ | ✅ | ✅ | ✅ |
| **Departmental KPI Reviews & Grading** (`/kpi`) | ❌ | ✅ | ✅ | ✅ |
| **HR Company Reports & Excel Exports** (`/reports`) | ❌ | ❌ | ✅ | ✅ |
| **Holiday Calendar & Public Blackout Rules** (`/holidays`) | ❌ | ❌ | ✅ | ✅ |
| **Candidate Onboarding Approval Portal** (`/hr/onboarding`) | ❌ | ❌ | ✅ | ✅ |
| **Employee Directory & Lifecycle Management** (`/ems/*`) | ❌ | ❌ | ✅ | ✅ |
| **Organization Settings & Shift Policies** (`/admin/settings`, `/admin/shifts`) | ❌ | ❌ | ❌ | ✅ |
| **User Role Assignments & MFA Resets** (`/admin/users`) | ❌ | ❌ | ❌ | ✅ |
| **System Audit Logs & Retention Archiver** (`/admin/audits`) | ❌ | ❌ | ❌ | ✅ |

---

## ⚡ Quick Start & Local Setup Guide

### 1. Prerequisites
- **Node.js**: `v18.17.0` or higher (tested on Node `v24.18.0`)
- **npm**: `v9.0.0` or higher
- A free [Supabase](https://supabase.com/) project (or local Supabase CLI instance)

### 2. Installation
```bash
git clone https://github.com/AadhithyaRaavanan/Automatic-HR-Management-System.git
cd "Automatic HR Management System"
npm install
```

### 3. Environment Configuration
Create a `.env.local` file by copying the example template:
```bash
cp .env.example .env.local
```
Configure your credentials in `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key-here
DATABASE_URL=postgresql://postgres:[password]@db.[project].supabase.co:5432/postgres
NEXT_PUBLIC_APP_URL=http://localhost:3000

# Development Mode (Enables one-click demo presets and bypasses rate limit lockouts)
NEXT_PUBLIC_DEMO_MODE=true
DISABLE_AUTH_RATE_LIMIT=true

# Optional Integrations
RESEND_API_KEY=re_your_key_here
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_USER=business@yourdomain.com
SMTP_PASS=your_password
```

### 4. Database Setup & Migrations
In your Supabase project's **SQL Editor**:
1. Open [supabase/complete_setup.sql](file:///c:/Users/Hp/OneDrive/Desktop/Automatic%20HR%20Management%20System/supabase/complete_setup.sql).
2. Copy the entire contents, paste it into the **Supabase SQL Editor**, and click **Run**.
   *This provisions all tables, RLS policies, custom JWT claims hooks, RPC functions, and demo seed data.*

### 5. Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🔑 Demo Accounts & Development Mode

When `NEXT_PUBLIC_DEMO_MODE=true` is enabled in `.env.local`, the `/login` screen displays **One-Click Demo Role Presets**:

| Role | Pre-configured Email | Default Password | Persona Description |
| :--- | :--- | :--- | :--- |
| **System Admin** | `admin@remotehr.io` | `DemoPassword123!` | Super Admin: Full system governance, audit logs, policy settings |
| **HR Admin** | `hr@remotehr.io` | `DemoPassword123!` | HR Manager: Reports, onboarding approvals, leave reviews, exports |
| **Manager** | `manager@remotehr.io` | `DemoPassword123!` | Team Lead: Live team presence, approval queue, KPI grading |
| **Employee** | `employee@remotehr.io` | `DemoPassword123!` | Team Member: Attendance stopwatch, leave portal, task lists |

*Note: For testing individual accounts, `aadhithya.raavanan@gmail.com` is configured with password `Demo123!`.*

---

## ⚙️ Environment Configuration Reference

| Variable Name | Required | Target Runtime | Description |
| :--- | :---: | :---: | :--- |
| `NEXT_PUBLIC_SUPABASE_URL` | **Yes** | Client + Server | Supabase project API endpoint URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | **Yes** | Client + Server | Supabase public anonymous client JWT key |
| `SUPABASE_SERVICE_ROLE_KEY` | **Yes** | Server Only | Privileged service role key for admin operations |
| `DATABASE_URL` | Optional | Server Only | Direct PostgreSQL connection string |
| `NEXT_PUBLIC_APP_URL` | **Yes** | Client + Server | Base canonical URL (e.g. `http://localhost:3000`) |
| `NEXT_PUBLIC_DEMO_MODE` | Optional | Client + Server | Toggle `"true"` to enable login presets in dev |
| `DISABLE_AUTH_RATE_LIMIT`| Optional | Server Only | Toggle `"true"` to disable sign-in attempt lockouts |
| `RESEND_API_KEY` | Optional | Server Only | API key for transactional emails via Resend |
| `SMTP_HOST` / `SMTP_PORT` | Optional | Server Only | Custom SMTP host and port configuration |
| `SMTP_USER` / `SMTP_PASS` | Optional | Server Only | Custom SMTP credentials |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Optional | Client | Cloudflare Turnstile public site key |
| `TURNSTILE_SECRET_KEY` | Optional | Server Only | Cloudflare Turnstile secret verification key |
| `UPSTASH_REDIS_REST_URL` | Optional | Server Only | Distributed sliding-window Redis URL |
| `UPSTASH_REDIS_REST_TOKEN` | Optional | Server Only | Distributed sliding-window Redis token |

---

## 🧪 Testing & Quality Assurance

### Vitest Unit Test Suite
Execute the unit test suite covering auth guards, timezone conversions, regularization state machines, and KPI calculations:
```bash
npm test
```
To run targeted test suites:
```bash
npx vitest run tests/unit/f2-auth.test.ts
npx vitest run tests/unit/kpi-formulas.test.ts
npx vitest run tests/unit/attendance-engine.test.ts
```

### Playwright End-to-End Suite
Execute the headless browser test suite across Desktop and Mobile viewports:
```bash
npm run test:e2e
```

### Production Build Verification
Verify type safety and compile all 53 production routes:
```bash
npm run build
```

---

## 🚀 Production Deployment & Operational Runbook

### Deploying to Vercel
1. Push your repository to GitHub.
2. Import the project in the [Vercel Dashboard](https://vercel.com).
3. Add the required environment variables in **Project Settings ➔ Environment Variables**.
4. In production environments, set `NEXT_PUBLIC_DEMO_MODE=false` and `DISABLE_AUTH_RATE_LIMIT=false`.
5. Deploy. Every commit to `main` triggers an automatic immutable deployment.

### Cache Control & Notification Audio
Static notification audio files (`/notification.mp3` and `/notification.wav`) are served with explicit zero-cache headers configured in [next.config.mjs](file:///c:/Users/Hp/OneDrive/Desktop/Automatic%20HR%20Management%20System/next.config.mjs):
```
Cache-Control: no-store, no-cache, must-revalidate, max-age=0, s-maxage=0
CDN-Cache-Control: no-store
Vercel-CDN-Cache-Control: no-store
```
Audio requests include automatic version query parameters (e.g. `?v=5`) in [sound.ts](file:///c:/Users/Hp/OneDrive/Desktop/Automatic%20HR%20Management%20System/lib/notifications/sound.ts) to guarantee browsers immediately pick up newly deployed chimes.

### Emergency Break-Glass Procedure (Admin MFA Recovery)
If an administrator loses their authenticator app and is locked out of their privileged session:
1. Open the [Supabase SQL Editor](https://supabase.com/dashboard/project/_/sql).
2. Execute the emergency factor reset query:
   ```sql
   DELETE FROM auth.mfa_factors
   WHERE user_id = (SELECT id FROM auth.users WHERE email = 'admin@yourcompany.com');
   ```
3. The administrator can now sign in using their password and immediately re-enroll a new TOTP authenticator device at `/mfa-setup`.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
