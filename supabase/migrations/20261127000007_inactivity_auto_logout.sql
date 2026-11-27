-- Migration: Inactivity & Break Overstay Auto-Logout Tracking
-- Adds last_seen_at, break tracking fields, status, checkout_reason, and auto_logout_notified
-- for idempotent 20-minute inactivity and break-overstay automatic attendance sign-out.

ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS break_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS break_duration_minutes INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'checked_in',
  ADD COLUMN IF NOT EXISTS checkout_reason TEXT,
  ADD COLUMN IF NOT EXISTS auto_logout_notified BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE public.attendance_sessions
SET last_seen_at = COALESCE(last_seen_at, check_in_at),
    status = CASE WHEN check_out_at IS NULL THEN 'checked_in' ELSE 'checked_out' END
WHERE last_seen_at IS NULL OR status IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'employees'
  ) THEN
    ALTER TABLE public.employees
      ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_open_inactivity
  ON public.attendance_sessions (id, employee_id, last_seen_at)
  WHERE check_out_at IS NULL AND auto_logout_notified = FALSE;
