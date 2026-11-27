-- Migration: Break Timeout Auto-Checkout & Notification Idempotency
-- Adds configurable max_break_minutes policy field and auto_logged_out / break_timeout_notified
-- flags on attendance_sessions for idempotent auto-logout enforcement.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'attendance_policies'
  ) THEN
    ALTER TABLE public.attendance_policies
      ADD COLUMN IF NOT EXISTS max_break_minutes INTEGER NOT NULL DEFAULT 60;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'organizations'
  ) THEN
    ALTER TABLE public.organizations
      ADD COLUMN IF NOT EXISTS max_break_minutes INTEGER NOT NULL DEFAULT 60;
  END IF;
END
$$;

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS auto_logged_out BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS break_timeout_notified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS auto_logout_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_open_break_timeout
  ON public.attendance_sessions (id, employee_id)
  WHERE check_out_at IS NULL AND break_timeout_notified = FALSE;
