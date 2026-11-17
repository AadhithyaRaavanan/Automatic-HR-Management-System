-- Minimal migration: Add early checkout tracking columns to attendance_sessions
ALTER TABLE public.attendance_sessions
  ADD COLUMN IF NOT EXISTS early_checkout BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS early_checkout_reason TEXT;
