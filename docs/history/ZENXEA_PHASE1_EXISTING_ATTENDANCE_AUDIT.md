# ZEN XEA HRMS – Phase 1 Existing Attendance Architecture Audit Report

**Date:** 2026-11-20  
**Status:** Completed  
**Subject:** Phase 1 – Shift Evaluation, 15-Minute Grace Period, Monthly Counters, and Centralized HR Exception Review Engine

---

## 1. Executive Summary & Objective

In accordance with Phase 1 requirements, this audit surveys the current attendance architecture of the ZEN XEA HRMS, identifying live schemas, stored procedures, RPCs, API routes, security controls, and frontend components to guarantee that:
1. **Rule A (1–15 min late, Occasions 1–3):** Marked as `present_grace_used` (Grace #1, #2, #3).
2. **Rule B (1–15 min late, Occasion 4+):** Marked as `late_arrival`, `hr_review_required = true`, generating an attendance exception for HR review.
3. **Rule C (>15 min late):** Immediately marked as `late_arrival`, `hr_review_required = true`, without consuming monthly grace.
4. **Rule D (Zero Automatic Deductions):** No automatic salary, CL, EL, SL, or half-day penalties are applied.
5. **Historical Retention:** Monthly counters persist permanently across all employee-local calendar months (`YYYY-MM`).

---

## 2. Live Database & Schema Audit

### 2.1 Table: `employees`
- **Fields verified:** `id`, `organization_id`, `department_id`, `primary_location_id`, `shift_start_time` (e.g., `'09:00:00'`), `shift_end_time` (e.g., `'18:00:00'`), `timezone` (default `'Asia/Kolkata'`).
- **Shift Override:** `organization_members.shift_start_time` and `shift_end_time` provide member-level overrides if assigned.

### 2.2 Table: `attendance_days`
- **Columns present:** `employee_id`, `work_date`, `total_minutes`, `status`, `is_late`, `locked`, `created_at`, `updated_at`, `organization_id`, `location_id`, `shift_id`, `work_location`, `overtime_minutes`.
- **Constraint identified:** `attendance_days_status_check` currently allows `('present', 'half_day', 'absent', 'holiday', 'weekend', 'leave')`.
- **Columns to extend:**
  - `late_minutes` (INTEGER DEFAULT 0)
  - `grace_occasion` (INTEGER DEFAULT NULL)
  - `hr_review_required` (BOOLEAN DEFAULT FALSE)
  - `attendance_days_status_check` must expand to include `'present_grace_used'`, `'late_arrival'`, and `'wfh'`.

### 2.3 Table: `attendance_sessions`
- **Constraint:** Partial unique index `idx_single_open_session ON attendance_sessions (employee_id) WHERE check_out_at IS NULL`.
- **Metadata:** Holds `note` JSON containing check-in remarks, break periods (`{ originalNote, breaks: [...] }`), and session tags.

### 2.4 Tables to Add / Formalize
- `monthly_late_counters` (`id`, `organization_id`, `employee_id`, `year_month`, `grace_used_count`, `late_flagged_count`, `created_at`, `updated_at`) with unique constraint `(organization_id, employee_id, year_month)`.
- `attendance_exceptions` (`id`, `organization_id`, `employee_id`, `work_date`, `exception_type`, `delay_minutes`, `shift_start_time`, `actual_check_in`, `status`, `action_taken`, `hr_notes`, `reviewed_by`, `reviewed_at`) for centralized queueing.

---

## 3. Backend & API Route Audit

### 3.1 Check-In Endpoint: `app/api/attendance/check-in/route.ts`
- Uses server-authoritative timestamps (`new Date().toISOString()`).
- Evaluates `evaluatePreCheckInLock()` across timezones with midnight crossover support.
- Inserts attendance session and triggers `recalculate_day(user.id, effectiveWorkDate)`.
- **Enhancement required:** Return structured grace payload in response:
  - `status: "present" | "present_grace_used" | "late_arrival"`
  - `late_minutes: number`
  - `grace_occasion: number | null`
  - `hr_review_required: boolean`

### 3.2 Stored Procedure: `recalculate_day(UUID, DATE)`
- Currently sets `is_late = TRUE` if check-in exceeds `shift_start_time + grace_minutes`.
- **Required update:** Embed the complete 4-tier decision tree:
  - $\le 15$ min: Check `monthly_late_counters`. If $< 3$, record occasion and set `present_grace_used`. If $\ge 3$, set `late_arrival`, `hr_review_required = TRUE`, insert exception.
  - $> 15$ min: Set `late_arrival`, `hr_review_required = TRUE`, insert exception immediately without consuming grace.

---

## 4. Frontend & User Experience Audit

1. **Dashboard Hero Check-In Card (`features/attendance/components/hero-check-in-card.tsx`):**
   - Displays live time, active session status, shift window, and breaks.
   - Updated to handle break pauses and grace feedback pills.
2. **Live Presence Widget (`components/attendance/live-presence-widget.tsx`):**
   - Displays real-time workforce presence.
   - Needs badges for `Present (Grace Used #X)` and `Late Arrival (HR Review)`.
3. **Centralized HR Approval Queue (`app/requests/page.tsx` & `/hr/leave`):**
   - Currently handles regularizations, leave requests, and delegations.
   - Ready to display attendance exceptions as part of the unified review architecture.

---

## 5. Security & RLS Review

- `monthly_late_counters` and `attendance_exceptions` must enforce RLS:
  - Employees have `SELECT` on their own records.
  - Managers have `SELECT` on their direct reports.
  - HR and Admins have full `SELECT`, `UPDATE` permissions.
- Stored procedure `recalculate_day` operates under `SECURITY DEFINER` with fixed `search_path = ''`.
