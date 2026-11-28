-- ============================================================================
-- Migration: 20261128000005_align_notifications_type_and_indexes.sql
-- Description: Align notifications_type_check with all application notification
--              types (including holiday_scheduled, review outcomes, security,
--              reminders) and add composite keyset pagination indexes.
-- ============================================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
    type IN (
        'missed_checkout',
        'request_status',
        'request_approved',
        'request_rejected',
        'request_submitted',
        'request_cancelled',
        'policy_update',
        'reminder',
        'reminder_task_due',
        'reminder_task_overdue',
        'reminder_task_overdue_manager',
        'reminder_leave_pending_48h',
        'reminder_reg_pending_48h',
        'reminder_shift_missed_checkin',
        'reminder_shift_late_checkout',
        'reminder_autoclosed_session',
        'reminder_onboarding_incomplete',
        'reminder_stale_task',
        'leave_requested',
        'leave_status',
        'leave_approved',
        'leave_rejected',
        'leave_submitted',
        'leave_cancelled',
        'leave_balance_adjusted',
        'attendance_corrected',
        'break_timeout',
        'early_checkout',
        'auto_logout',
        'delegation',
        'task_assigned',
        'task_due_soon',
        'task_overdue',
        'task_completed',
        'task_blocked',
        'task_due_date_changed',
        'task_comment',
        'task_recurrence_paused',
        'kpi_review',
        'kpi_review_submitted',
        'kpi_self_review_submitted',
        'kpi_goal_created',
        'kpi_goal_at_risk',
        'kpi_config_updated',
        'onboarding_submission',
        'onboarding_status',
        'onboarding_invite_accepted',
        'onboarding_doc_approved',
        'onboarding_doc_rejected',
        'holiday_scheduled',
        'birthday',
        'security_account_deactivated',
        'security_mfa_reset',
        'security_role_changed',
        'security_status_changed',
        'security_password_changed',
        'security_alert'
    )
);

CREATE INDEX IF NOT EXISTS idx_notifications_org_user_created_id
    ON public.notifications (organization_id, user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_org_user_read_created_id
    ON public.notifications (organization_id, user_id, read_at, created_at DESC, id DESC);
