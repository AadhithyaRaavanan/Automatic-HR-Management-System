-- ============================================================================
-- Migration: 20261118000002_performance_indexes_and_tutorial_version.sql
-- Description: Indexes for instant navigation & tutorial versioning column
-- ============================================================================

-- 1. Performance Indexes for Filters and Joins
CREATE INDEX IF NOT EXISTS idx_attendance_days_emp_date
    ON public.attendance_days (employee_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_emp_date
    ON public.attendance_sessions (employee_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_assignee_status
    ON public.tasks (assignee_id, status);

CREATE INDEX IF NOT EXISTS idx_leave_applications_emp_status
    ON public.leave_applications (employee_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_regularization_requests_emp_status
    ON public.regularization_requests (employee_id, status);

CREATE INDEX IF NOT EXISTS idx_onboarding_documents_user_id
    ON public.onboarding_documents (user_id);

CREATE INDEX IF NOT EXISTS idx_employees_department_id
    ON public.employees (department_id);

-- 2. Tutorial Versioning for Existing Users
ALTER TABLE public.profiles
    ADD COLUMN IF NOT EXISTS tutorial_version INTEGER NOT NULL DEFAULT 0;
