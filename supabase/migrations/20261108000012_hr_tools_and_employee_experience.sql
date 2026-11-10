-- ============================================================================
-- Migration 12: Section 1 - HR Attendance Tools & Employee Experience
-- ============================================================================
-- Covers:
-- 1. Profile fields (phone, emergency_contact, onboarding_completed_at),
--    column-level grants, hardened protection triggers, complete_onboarding(),
--    and private 'avatars' Storage bucket (200 KB max, MIME allowlist, per-user RLS).
-- 2. HR attendance corrections (`hr_correct_attendance`), Month-End Close
--    checklist (`get_month_close_checklist`), and reason-mandatory
--    `unlock_month(p_year, p_month, p_reason)`.
-- 3. DB-driven `holidays` (local_name, holiday_type, is_active, RPC-only writes)
--    and global `holiday_templates` catalog (with 'India - Tamil Nadu' copy-on-import).
-- 4. Approval delegations (`approval_delegations`), updated `can_approve_for()`,
--    delegation-aware RLS & leave/regularization approval RPCs.
-- 5. Real notifications across RPCs + triggers, expanded type constraint,
--    and private per-user Supabase Realtime channel broadcast + RLS policy.
-- ============================================================================

-- ============================================================================
-- 1. PROFILE, ONBOARDING, & PRIVATE AVATARS STORAGE BUCKET
-- ============================================================================

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

REVOKE UPDATE ON public.employees FROM authenticated;
GRANT UPDATE (full_name, avatar_url, phone, emergency_contact) ON public.employees TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_protect_employee_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_role TEXT;
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'organization_id cannot be changed.' USING ERRCODE = '42501';
    END IF;

    v_uid := (SELECT auth.uid());
    IF v_uid IS NOT NULL THEN
        v_role := public.current_user_role();
        IF v_role IS DISTINCT FROM 'hr' AND v_role IS DISTINCT FROM 'admin' THEN
            IF NEW.manager_id IS DISTINCT FROM OLD.manager_id OR
               NEW.status IS DISTINCT FROM OLD.status OR
               NEW.work_mode IS DISTINCT FROM OLD.work_mode OR
               NEW.primary_location_id IS DISTINCT FROM OLD.primary_location_id OR
               NEW.work_target_minutes IS DISTINCT FROM OLD.work_target_minutes OR
               NEW.expected_office_days IS DISTINCT FROM OLD.expected_office_days OR
               NEW.required_office_days_per_week IS DISTINCT FROM OLD.required_office_days_per_week OR
               NEW.department_id IS DISTINCT FROM OLD.department_id OR
               NEW.timezone IS DISTINCT FROM OLD.timezone OR
               NEW.email IS DISTINCT FROM OLD.email OR
               NEW.joined_on IS DISTINCT FROM OLD.joined_on THEN
                RAISE EXCEPTION 'Permission denied: Employees cannot modify administrative attributes.' USING ERRCODE = '42501';
            END IF;

            IF NEW.onboarding_completed_at IS DISTINCT FROM OLD.onboarding_completed_at AND
               pg_catalog.current_setting('app.onboarding_rpc', true) IS DISTINCT FROM '1' THEN
                RAISE EXCEPTION 'Permission denied: onboarding_completed_at must be updated via complete_onboarding().' USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_employee_field_protection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_role TEXT;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;

    v_role := public.current_user_role();

    IF (
        NEW.manager_id IS DISTINCT FROM OLD.manager_id OR
        NEW.status IS DISTINCT FROM OLD.status OR
        NEW.work_mode IS DISTINCT FROM OLD.work_mode OR
        NEW.primary_location_id IS DISTINCT FROM OLD.primary_location_id OR
        NEW.work_target_minutes IS DISTINCT FROM OLD.work_target_minutes OR
        NEW.expected_office_days IS DISTINCT FROM OLD.expected_office_days OR
        NEW.required_office_days_per_week IS DISTINCT FROM OLD.required_office_days_per_week OR
        NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
        NEW.department_id IS DISTINCT FROM OLD.department_id
    ) THEN
        IF v_role IS DISTINCT FROM 'hr' AND v_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'Forbidden: Only HR or Admins can modify sensitive employee governance fields.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF (NEW.timezone IS DISTINCT FROM OLD.timezone) THEN
        IF v_role IS DISTINCT FROM 'hr' AND v_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'Forbidden: Only HR or Admins can modify employee timezone.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF (NEW.onboarding_completed_at IS DISTINCT FROM OLD.onboarding_completed_at) AND
       pg_catalog.current_setting('app.onboarding_rpc', true) IS DISTINCT FROM '1' THEN
        IF v_role IS DISTINCT FROM 'hr' AND v_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'Forbidden: onboarding_completed_at must be updated via complete_onboarding().' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_onboarding()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_prev TIMESTAMPTZ;
    v_completed_at TIMESTAMPTZ;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT onboarding_completed_at INTO v_prev
    FROM public.employees
    WHERE id = v_caller_id
      AND organization_id = v_caller_org
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee profile not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_prev IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_completed', true,
            'onboarding_completed_at', v_prev
        );
    END IF;

    PERFORM pg_catalog.set_config('app.onboarding_rpc', '1', true);

    UPDATE public.employees
    SET onboarding_completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_caller_id
      AND organization_id = v_caller_org
    RETURNING onboarding_completed_at INTO v_completed_at;

    PERFORM pg_catalog.set_config('app.onboarding_rpc', '', true);

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org,
        v_caller_id,
        'ONBOARDING_COMPLETED',
        'employees',
        v_caller_id,
        jsonb_build_object('onboarding_completed_at', NULL),
        jsonb_build_object('onboarding_completed_at', v_completed_at)
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_completed', false,
        'onboarding_completed_at', v_completed_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding() TO authenticated;

-- Private Storage bucket 'avatars': 200 KB max, JPEG/PNG/WebP only
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    FALSE,
    204800,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 204800,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "avatars_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_policy" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_policy" ON storage.objects;

CREATE POLICY "avatars_select_policy" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    );

CREATE POLICY "avatars_insert_policy" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    );

CREATE POLICY "avatars_update_policy" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    )
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    );

CREATE POLICY "avatars_delete_policy" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    );

-- ============================================================================
-- 2. NOTIFICATIONS: EXPAND TYPE CONSTRAINT + REALTIME BROADCAST + RLS
-- ============================================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (
        type IN (
            'missed_checkout',
            'request_status',
            'policy_update',
            'reminder',
            'leave_requested',
            'leave_status',
            'attendance_corrected',
            'delegation',
            'task_assigned',
            'task_due_soon',
            'task_overdue'
        )
    );

CREATE OR REPLACE FUNCTION public.trg_broadcast_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM realtime.send(
        jsonb_build_object(
            'id', NEW.id,
            'user_id', NEW.user_id,
            'organization_id', NEW.organization_id,
            'type', NEW.type,
            'title', NEW.title,
            'body', NEW.body,
            'link', NEW.link,
            'read_at', NEW.read_at,
            'created_at', NEW.created_at
        ),
        'notification_created',
        'notifications:user:' || NEW.user_id::text,
        TRUE
    );
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_broadcast_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS broadcast_notification_after_insert ON public.notifications;
CREATE TRIGGER broadcast_notification_after_insert
    AFTER INSERT ON public.notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_broadcast_notification();

DROP POLICY IF EXISTS "realtime_notifications_user_select_policy" ON realtime.messages;
CREATE POLICY "realtime_notifications_user_select_policy"
    ON realtime.messages
    FOR SELECT
    TO authenticated
    USING (
        realtime.topic() = ('notifications:user:' || (SELECT auth.uid())::text)
        AND (topic IS NULL OR topic = ('notifications:user:' || (SELECT auth.uid())::text))
        AND (SELECT public.is_active_org_member())
    );

CREATE OR REPLACE FUNCTION public.trg_notify_regularization_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_emp_name TEXT;
    v_manager_id UUID;
BEGIN
    SELECT e.full_name, e.manager_id
    INTO v_emp_name, v_manager_id
    FROM public.employees e
    WHERE e.id = NEW.employee_id;

    IF v_manager_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.user_id = v_manager_id
          AND om.organization_id = NEW.organization_id
          AND om.status = 'active'
    ) THEN
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            NEW.organization_id,
            v_manager_id,
            'request_status',
            'Regularization Request Submitted',
            COALESCE(v_emp_name, 'Team member') || ' requested punch correction for ' || NEW.work_date::text || '.',
            '/requests',
            jsonb_build_object('request_id', NEW.id, 'employee_id', NEW.employee_id, 'work_date', NEW.work_date)
        );
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_notify_regularization_submitted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_regularization_submitted_after_insert ON public.regularization_requests;
CREATE TRIGGER notify_regularization_submitted_after_insert
    AFTER INSERT ON public.regularization_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_notify_regularization_submitted();

CREATE OR REPLACE FUNCTION public.cron_auto_checkout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session RECORD;
    v_closed_count INTEGER := 0;
    v_work_date DATE;
BEGIN
    FOR v_session IN
        SELECT s.id, s.employee_id, s.check_in_at, s.organization_id, COALESCE(e.timezone, o.timezone, 'UTC') AS eff_tz
        FROM public.attendance_sessions s
        JOIN public.employees e ON e.id = s.employee_id
        JOIN public.organizations o ON o.id = s.organization_id
        WHERE s.check_out_at IS NULL
          AND s.check_in_at < (pg_catalog.now() - INTERVAL '12 hours')
    LOOP
        v_work_date := (v_session.check_in_at AT TIME ZONE COALESCE(v_session.eff_tz, 'UTC'))::date;

        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE employee_id = v_session.employee_id
              AND work_date = v_work_date
              AND locked = TRUE
        ) THEN
            UPDATE public.attendance_sessions
            SET check_out_at = pg_catalog.now(),
                source = 'auto',
                note = COALESCE(note, '') || ' [Auto-closed by nightly cron]'
            WHERE id = v_session.id;

            PERFORM public.recalculate_day(v_session.employee_id, v_work_date);

            INSERT INTO public.notifications (
                organization_id, user_id, type, title, body, link, metadata
            ) VALUES (
                v_session.organization_id,
                v_session.employee_id,
                'missed_checkout',
                'Missed Checkout Auto-Closed',
                'Your open shift from ' || v_work_date::text || ' exceeded 12 hours and was automatically closed. Submit a regularization if needed.',
                '/requests',
                jsonb_build_object('session_id', v_session.id, 'work_date', v_work_date)
            );

            v_closed_count := v_closed_count + 1;
        END IF;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout() TO service_role;

-- ============================================================================
-- 3. MONTH-END CLOSE CHECKLIST, UNLOCK REASON, & HR ATTENDANCE CORRECTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS public.unlock_month(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.unlock_month(
    p_year INTEGER,
    p_month INTEGER,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_reason TEXT;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Administrators can unlock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to unlock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_reason := pg_catalog.btrim(COALESCE(p_reason, ''));
    IF v_reason = '' THEN
        RAISE EXCEPTION 'Reason is required when unlocking an attendance month.' USING ERRCODE = '22023';
    END IF;

    IF p_year < 2000 OR p_year > 2100 OR p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'Invalid year or month parameter.' USING ERRCODE = '22023';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = FALSE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month
      AND locked = TRUE;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'MONTH_UNLOCKED',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', true),
        jsonb_build_object(
            'year', p_year,
            'month', p_month,
            'locked', false,
            'records_unlocked', v_count,
            'reason', v_reason
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'records_unlocked', v_count,
        'reason', v_reason
    );
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_month(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_month(INTEGER, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_month_close_checklist(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_start DATE;
    v_end DATE;
    v_open_count INTEGER := 0;
    v_reg_count INTEGER := 0;
    v_leave_count INTEGER := 0;
    v_locked_count INTEGER := 0;
    v_unlocked_count INTEGER := 0;
    v_total_days_count INTEGER := 0;
    v_open_items JSONB := '[]'::jsonb;
    v_reg_items JSONB := '[]'::jsonb;
    v_leave_items JSONB := '[]'::jsonb;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can inspect month-end close checklists.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to inspect month-end close checklists.' USING ERRCODE = '42501';
    END IF;

    IF p_year < 2000 OR p_year > 2100 OR p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'Invalid year or month parameter.' USING ERRCODE = '22023';
    END IF;

    v_org_id := public.current_org_id();
    v_start := pg_catalog.make_date(p_year, p_month, 1);
    v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;

    SELECT COUNT(*)::int INTO v_open_count
    FROM public.attendance_sessions s
    WHERE s.organization_id = v_org_id
      AND s.check_out_at IS NULL
      AND s.work_date BETWEEN v_start AND v_end;

    SELECT COALESCE(jsonb_agg(sub ORDER BY sub.work_date, sub.check_in_at), '[]'::jsonb)
    INTO v_open_items
    FROM (
        SELECT s.id, s.employee_id, e.full_name AS employee_name, s.work_date, s.check_in_at
        FROM public.attendance_sessions s
        JOIN public.employees e ON e.id = s.employee_id
        WHERE s.organization_id = v_org_id
          AND s.check_out_at IS NULL
          AND s.work_date BETWEEN v_start AND v_end
        ORDER BY s.work_date, s.check_in_at
        LIMIT 25
    ) sub;

    SELECT COUNT(*)::int INTO v_reg_count
    FROM public.regularization_requests r
    WHERE r.organization_id = v_org_id
      AND r.status = 'pending'
      AND r.work_date BETWEEN v_start AND v_end;

    SELECT COALESCE(jsonb_agg(sub ORDER BY sub.work_date, sub.created_at), '[]'::jsonb)
    INTO v_reg_items
    FROM (
        SELECT r.id, r.employee_id, e.full_name AS employee_name, r.work_date, r.reason, r.created_at
        FROM public.regularization_requests r
        JOIN public.employees e ON e.id = r.employee_id
        WHERE r.organization_id = v_org_id
          AND r.status = 'pending'
          AND r.work_date BETWEEN v_start AND v_end
        ORDER BY r.work_date, r.created_at
        LIMIT 25
    ) sub;

    SELECT COUNT(*)::int INTO v_leave_count
    FROM public.leave_requests lr
    WHERE lr.organization_id = v_org_id
      AND lr.status = 'pending'
      AND lr.start_date <= v_end
      AND lr.end_date >= v_start;

    SELECT COALESCE(jsonb_agg(sub ORDER BY sub.start_date, sub.created_at), '[]'::jsonb)
    INTO v_leave_items
    FROM (
        SELECT lr.id, lr.employee_id, e.full_name AS employee_name, lr.start_date, lr.end_date, lr.total_days, lr.reason, lr.created_at
        FROM public.leave_requests lr
        JOIN public.employees e ON e.id = lr.employee_id
        WHERE lr.organization_id = v_org_id
          AND lr.status = 'pending'
          AND lr.start_date <= v_end
          AND lr.end_date >= v_start
        ORDER BY lr.start_date, lr.created_at
        LIMIT 25
    ) sub;

    SELECT
        COUNT(*) FILTER (WHERE locked = TRUE)::int,
        COUNT(*) FILTER (WHERE locked = FALSE)::int,
        COUNT(*)::int
    INTO v_locked_count, v_unlocked_count, v_total_days_count
    FROM public.attendance_days d
    WHERE d.organization_id = v_org_id
      AND d.work_date BETWEEN v_start AND v_end;

    RETURN jsonb_build_object(
        'year', p_year,
        'month', p_month,
        'period_start', v_start,
        'period_end', v_end,
        'open_sessions_count', v_open_count,
        'open_sessions', v_open_items,
        'pending_regularizations_count', v_reg_count,
        'pending_regularizations', v_reg_items,
        'pending_leaves_count', v_leave_count,
        'pending_leaves', v_leave_items,
        'locked_days_count', v_locked_count,
        'unlocked_days_count', v_unlocked_count,
        'total_days_count', v_total_days_count,
        'is_month_locked', (v_locked_count > 0 AND v_unlocked_count = 0),
        'ready_to_lock', (v_open_count = 0 AND v_reg_count = 0 AND v_leave_count = 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_month_close_checklist(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_month_close_checklist(INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_correct_attendance(
    p_employee_id UUID,
    p_work_date DATE,
    p_sessions JSONB,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_reason TEXT;
    v_target RECORD;
    v_effective_tz TEXT;
    v_is_locked BOOLEAN := FALSE;
    v_old_sessions JSONB := '[]'::jsonb;
    v_old_day JSONB := NULL;
    v_new_sessions JSONB := '[]'::jsonb;
    v_new_day JSONB := NULL;
    v_elem JSONB;
    v_in TIMESTAMPTZ;
    v_out TIMESTAMPTZ;
    v_loc_id UUID;
    v_note TEXT;
    v_parsed_ranges TSTZRANGE[] := ARRAY[]::TSTZRANGE[];
    v_curr_range TSTZRANGE;
    v_existing_range TSTZRANGE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can perform direct attendance corrections.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for attendance corrections.' USING ERRCODE = '42501';
    END IF;

    IF p_employee_id IS NULL OR p_work_date IS NULL THEN
        RAISE EXCEPTION 'Employee ID and work date are required.' USING ERRCODE = '22023';
    END IF;

    IF p_employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot correct your own attendance.' USING ERRCODE = '42501';
    END IF;

    v_reason := pg_catalog.btrim(COALESCE(p_reason, ''));
    IF v_reason = '' THEN
        RAISE EXCEPTION 'Reason is mandatory for HR attendance corrections.' USING ERRCODE = '22023';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT
        e.id,
        e.organization_id,
        e.timezone AS emp_tz,
        COALESCE(e.work_mode, o.work_mode, 'remote') AS eff_work_mode,
        o.timezone AS org_tz,
        l.timezone AS loc_tz
    INTO v_target
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_target IS NULL OR v_target.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant or unknown target: Employee does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    v_effective_tz := CASE
        WHEN v_target.eff_work_mode = 'office' THEN COALESCE(v_target.loc_tz, v_target.org_tz, 'UTC')
        ELSE COALESCE(v_target.emp_tz, v_target.org_tz, 'UTC')
    END;

    SELECT locked INTO v_is_locked
    FROM public.attendance_days
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND work_date = p_work_date
    FOR UPDATE;

    IF COALESCE(v_is_locked, FALSE) THEN
        RAISE EXCEPTION 'Attendance day % is locked. An administrator must unlock the month before corrections can be applied.', p_work_date USING ERRCODE = '22023';
    END IF;

    IF p_sessions IS NULL OR jsonb_typeof(p_sessions) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'p_sessions must be a JSON array.' USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_sessions) > 20 THEN
        RAISE EXCEPTION 'Too many sessions provided for a single day (max 20).' USING ERRCODE = '22023';
    END IF;

    -- Snapshot old_data before mutation
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'check_in_at', s.check_in_at,
        'check_out_at', s.check_out_at,
        'source', s.source,
        'note', s.note
    ) ORDER BY s.check_in_at), '[]'::jsonb)
    INTO v_old_sessions
    FROM public.attendance_sessions s
    WHERE s.organization_id = v_caller_org
      AND s.employee_id = p_employee_id
      AND (s.work_date = p_work_date OR (s.check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date);

    SELECT jsonb_build_object(
        'status', d.status,
        'total_minutes', d.total_minutes,
        'overtime_minutes', d.overtime_minutes,
        'is_late', d.is_late,
        'locked', d.locked
    )
    INTO v_old_day
    FROM public.attendance_days d
    WHERE d.organization_id = v_caller_org
      AND d.employee_id = p_employee_id
      AND d.work_date = p_work_date;

    -- Validate all sessions before writing anything
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_sessions)
    LOOP
        IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Each session entry must be a JSON object.' USING ERRCODE = '22023';
        END IF;

        BEGIN
            v_in := NULLIF(v_elem->>'check_in_at', '')::timestamptz;
            v_out := NULLIF(v_elem->>'check_out_at', '')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid ISO timestamp in p_sessions.' USING ERRCODE = '22023';
        END;

        IF v_in IS NULL OR v_out IS NULL OR v_out <= v_in THEN
            RAISE EXCEPTION 'Each session requires valid check_in_at and check_out_at with check_out_at > check_in_at.' USING ERRCODE = '22023';
        END IF;

        IF (v_in AT TIME ZONE v_effective_tz)::date IS DISTINCT FROM p_work_date THEN
            RAISE EXCEPTION 'Session check_in_at (%) does not fall on work_date % in employee timezone %.', v_in, p_work_date, v_effective_tz USING ERRCODE = '22023';
        END IF;

        IF NULLIF(v_elem->>'location_id', '') IS NOT NULL THEN
            BEGIN
                v_loc_id := (v_elem->>'location_id')::uuid;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'Invalid location_id UUID in p_sessions.' USING ERRCODE = '22023';
            END;
            IF NOT EXISTS (
                SELECT 1 FROM public.locations
                WHERE id = v_loc_id AND organization_id = v_caller_org
            ) THEN
                RAISE EXCEPTION 'Location does not belong to caller organization.' USING ERRCODE = '42501';
            END IF;
        END IF;

        v_curr_range := tstzrange(v_in, v_out, '[)');
        FOREACH v_existing_range IN ARRAY v_parsed_ranges
        LOOP
            IF v_curr_range && v_existing_range THEN
                RAISE EXCEPTION 'Corrected attendance sessions cannot overlap.' USING ERRCODE = '22023';
            END IF;
        END LOOP;
        v_parsed_ranges := array_append(v_parsed_ranges, v_curr_range);
    END LOOP;

    -- Replace day's sessions
    DELETE FROM public.attendance_sessions s
    WHERE s.organization_id = v_caller_org
      AND s.employee_id = p_employee_id
      AND (s.work_date = p_work_date OR (s.check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date);

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_sessions)
    LOOP
        v_in := (v_elem->>'check_in_at')::timestamptz;
        v_out := (v_elem->>'check_out_at')::timestamptz;
        v_loc_id := CASE WHEN NULLIF(v_elem->>'location_id', '') IS NOT NULL THEN (v_elem->>'location_id')::uuid ELSE NULL END;
        v_note := COALESCE(NULLIF(pg_catalog.btrim(v_elem->>'note'), ''), 'HR Correction: ' || v_reason);

        INSERT INTO public.attendance_sessions (
            organization_id, employee_id, work_date, check_in_at, check_out_at, source, location_id, note
        ) VALUES (
            v_caller_org, p_employee_id, p_work_date, v_in, v_out, 'manual', v_loc_id, v_note
        );
    END LOOP;

    -- Recompute canonical attendance_days row
    PERFORM public.recalculate_day(p_employee_id, p_work_date);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'check_in_at', s.check_in_at,
        'check_out_at', s.check_out_at,
        'source', s.source,
        'note', s.note
    ) ORDER BY s.check_in_at), '[]'::jsonb)
    INTO v_new_sessions
    FROM public.attendance_sessions s
    WHERE s.organization_id = v_caller_org
      AND s.employee_id = p_employee_id
      AND (s.work_date = p_work_date OR (s.check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date);

    SELECT jsonb_build_object(
        'status', d.status,
        'total_minutes', d.total_minutes,
        'overtime_minutes', d.overtime_minutes,
        'is_late', d.is_late,
        'locked', d.locked
    )
    INTO v_new_day
    FROM public.attendance_days d
    WHERE d.organization_id = v_caller_org
      AND d.employee_id = p_employee_id
      AND d.work_date = p_work_date;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org,
        v_caller_id,
        'ATTENDANCE_CORRECTED',
        'attendance_days',
        p_employee_id,
        jsonb_build_object(
            'employee_id', p_employee_id,
            'work_date', p_work_date,
            'day', v_old_day,
            'sessions', v_old_sessions
        ),
        jsonb_build_object(
            'employee_id', p_employee_id,
            'work_date', p_work_date,
            'reason', v_reason,
            'day', v_new_day,
            'sessions', v_new_sessions
        )
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_caller_org,
        p_employee_id,
        'attendance_corrected',
        'Attendance Corrected',
        'Your attendance record for ' || p_work_date::text || ' was adjusted by HR/Admin. Reason: ' || v_reason,
        '/attendance',
        jsonb_build_object('work_date', p_work_date, 'corrected_by', v_caller_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'employee_id', p_employee_id,
        'work_date', p_work_date,
        'day', v_new_day,
        'sessions', v_new_sessions
    );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_correct_attendance(UUID, DATE, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_correct_attendance(UUID, DATE, JSONB, TEXT) TO authenticated;

-- ============================================================================
-- 4. DB-DRIVEN HOLIDAYS & GLOBAL HOLIDAY_TEMPLATES CATALOG
-- ============================================================================

ALTER TABLE public.holidays
    ADD COLUMN IF NOT EXISTS local_name TEXT,
    ADD COLUMN IF NOT EXISTS holiday_type TEXT NOT NULL DEFAULT 'public' CHECK (holiday_type IN ('public', 'company', 'special')),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now();

-- Backfill split English + Local Script from legacy "English (தமிழ்)" format
UPDATE public.holidays
SET
    local_name = COALESCE(local_name, pg_catalog.btrim(substring(name FROM '\(([^)]+)\)\s*$'))),
    name = pg_catalog.btrim(regexp_replace(name, '\s*\(([^)]+)\)\s*$', ''))
WHERE local_name IS NULL
  AND name ~ '\([^)]+\)\s*$';

-- Enforce RPC-only writes on holidays
REVOKE INSERT, UPDATE, DELETE ON public.holidays FROM authenticated;
DROP POLICY IF EXISTS "holidays_insert_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_update_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_delete_policy" ON public.holidays;

CREATE TABLE IF NOT EXISTS public.holiday_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code TEXT NOT NULL,
    template_name TEXT NOT NULL,
    region_code TEXT NOT NULL,
    template_year INTEGER NULL CHECK (template_year IS NULL OR template_year BETWEEN 2000 AND 2100),
    month_num INTEGER NOT NULL CHECK (month_num BETWEEN 1 AND 12),
    day_num INTEGER NOT NULL CHECK (day_num BETWEEN 1 AND 31),
    name TEXT NOT NULL,
    local_name TEXT,
    holiday_type TEXT NOT NULL DEFAULT 'public' CHECK (holiday_type IN ('public', 'company', 'special')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_holiday_templates_code_year_date
    ON public.holiday_templates (template_code, COALESCE(template_year, 0), month_num, day_num);

REVOKE ALL ON TABLE public.holiday_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.holiday_templates TO authenticated;

ALTER TABLE public.holiday_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "holiday_templates_select_policy" ON public.holiday_templates;
DROP POLICY IF EXISTS "enforce_active_org_membership_holiday_templates" ON public.holiday_templates;

CREATE POLICY "holiday_templates_select_policy" ON public.holiday_templates
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "enforce_active_org_membership_holiday_templates" ON public.holiday_templates
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

-- Seed global holiday templates ('India - Tamil Nadu', 'India - National', 'United States - Federal')
INSERT INTO public.holiday_templates (template_code, template_name, region_code, template_year, month_num, day_num, name, local_name, holiday_type)
VALUES
    -- India - Tamil Nadu (Fixed Annual Dates)
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 1, 'New Year''s Day', 'ஆங்கிலப் புத்தாண்டு', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 14, 'Bhogi Festival', 'போகிப் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 15, 'Thai Pongal', 'தைப்பொங்கல்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 16, 'Thiruvalluvar Day / Mattu Pongal', 'திருவள்ளுவர் தினம் / மாட்டுப் பொங்கல்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 17, 'Uzhavar Thirunal', 'உழவர் திருநாள்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', NULL, 1, 26, 'Republic Day', 'குடியரசு தினம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 4, 14, 'Tamil New Year & Dr. Ambedkar Jayanti', 'தமிழ்ப் புத்தாண்டு / அம்பேத்கர் ஜெயந்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', NULL, 5, 1, 'May Day / Labour Day', 'உழைப்பாளர் தினம் - மே தினம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', NULL, 8, 15, 'Independence Day', 'சுதந்திர தினம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', NULL, 10, 2, 'Gandhi Jayanti', 'காந்தி ஜெயந்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'GLOBAL', NULL, 12, 25, 'Christmas Day', 'கிறிஸ்துமஸ் பண்டிகை', 'public'),
    -- India - Tamil Nadu (2026 Lunar/Variable Dates)
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 2, 1, 'Thaipusam', 'தைப்பூசம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2026, 3, 20, 'Ramzan / Eid-ul-Fitr', 'ரம்ஜான் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'GLOBAL', 2026, 4, 3, 'Good Friday', 'புனித வெள்ளி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2026, 5, 27, 'Bakrid / Eid-al-Adha', 'பக்ரீத் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2026, 6, 26, 'Muharram', 'மொஹரம் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 9, 4, 'Krishna Jayanthi / Gokulashtami', 'கிருஷ்ண ஜெயந்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 9, 14, 'Vinayakar Chathurthi', 'விநாயகர் சதுர்த்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2026, 9, 25, 'Milad-un-Nabi', 'நபிகள் நாயகம் பிறந்த நாள்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 10, 19, 'Ayutha Pooja / Saraswathi Pooja', 'ஆயுத பூஜை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 10, 20, 'Vijaya Dasami', 'விஜயதசமி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 11, 8, 'Deepavali', 'தீபாவளி பண்டிகை', 'public'),
    -- India - Tamil Nadu (2027 Lunar/Variable Dates)
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 1, 22, 'Thaipusam', 'தைப்பூசம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2027, 3, 10, 'Ramzan / Eid-ul-Fitr', 'ரம்ஜான் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'GLOBAL', 2027, 3, 26, 'Good Friday', 'புனித வெள்ளி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2027, 5, 17, 'Bakrid / Eid-al-Adha', 'பக்ரீத் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2027, 6, 16, 'Muharram', 'மொஹரம் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 8, 25, 'Krishna Jayanthi / Gokulashtami', 'கிருஷ்ண ஜெயந்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 9, 4, 'Vinayakar Chathurthi', 'விநாயகர் சதுர்த்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 10, 8, 'Ayutha Pooja / Saraswathi Pooja', 'ஆயுத பூஜை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 10, 9, 'Vijaya Dasami', 'விஜயதசமி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 10, 29, 'Deepavali', 'தீபாவளி பண்டிகை', 'public'),
    -- India - National Gazetted
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 1, 1, 'New Year''s Day', NULL, 'public'),
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 1, 26, 'Republic Day', 'गणतंत्र दिवस', 'public'),
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 5, 1, 'Labour Day', NULL, 'public'),
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 8, 15, 'Independence Day', 'स्वतंत्रता दिवस', 'public'),
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 10, 2, 'Gandhi Jayanti', 'गांधी जयंती', 'public'),
    ('IN_NAT', 'India - National Gazetted', 'GLOBAL', NULL, 12, 25, 'Christmas Day', NULL, 'public'),
    -- United States - Federal
    ('US_FED', 'United States - Federal', 'US', NULL, 1, 1, 'New Year''s Day', NULL, 'public'),
    ('US_FED', 'United States - Federal', 'US', NULL, 6, 19, 'Juneteenth National Independence Day', NULL, 'public'),
    ('US_FED', 'United States - Federal', 'US', NULL, 7, 4, 'Independence Day', NULL, 'public'),
    ('US_FED', 'United States - Federal', 'US', NULL, 11, 11, 'Veterans Day', NULL, 'public'),
    ('US_FED', 'United States - Federal', 'US', NULL, 12, 25, 'Christmas Day', NULL, 'public')
ON CONFLICT DO NOTHING;

-- Update recalculate_day & calculate_working_days to respect holidays.is_active = TRUE
CREATE OR REPLACE FUNCTION public.recalculate_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total_minutes INTEGER := 0;
    v_sessions_count INTEGER := 0;
    v_first_in TIMESTAMPTZ;
    v_last_out TIMESTAMPTZ;
    v_open_sessions INTEGER := 0;
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_overtime_minutes INTEGER := 0;
    v_work_location TEXT := 'remote';
    v_policy RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_is_company_day_off BOOLEAN := FALSE;
    v_day_of_week INTEGER;
    v_weekly_offs INTEGER[];
    v_is_weekend BOOLEAN := FALSE;
    v_target_minutes INTEGER := 480;
    v_org_id UUID;
    v_dept_id UUID;
    v_work_mode TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_loc_weekly_offs INTEGER[];
    v_effective_tz TEXT;
    v_local_today DATE;
    v_is_locked BOOLEAN := FALSE;
    v_has_full_leave BOOLEAN := FALSE;
    v_has_first_half BOOLEAN := FALSE;
    v_has_second_half BOOLEAN := FALSE;
BEGIN
    SELECT locked INTO v_is_locked
    FROM public.attendance_days
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    IF COALESCE(v_is_locked, FALSE) THEN
        RETURN;
    END IF;

    SELECT
        e.organization_id,
        e.department_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        COALESCE(e.work_target_minutes, 480),
        l.weekly_off_days
    INTO
        v_org_id, v_dept_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_target_minutes, v_loc_weekly_offs
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id
          AND (check_in_at AT TIME ZONE COALESCE(v_emp_tz, v_org_tz, 'UTC'))::date = p_work_date
          AND (location_id IS NOT NULL OR source IN ('office_ip', 'rotating_qr', 'kiosk'))
    ) THEN
        v_work_location := 'office';
    ELSE
        v_work_location := 'remote';
    END IF;

    v_effective_tz := CASE
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN
            CASE
                WHEN v_work_location = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
    END;

    v_local_today := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    SELECT * INTO v_policy
    FROM public.attendance_policies
    WHERE organization_id = v_org_id
    LIMIT 1;

    SELECT
        COALESCE(SUM(
            CASE
                WHEN check_out_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60
                ELSE EXTRACT(EPOCH FROM (pg_catalog.now() - check_in_at)) / 60
            END
        ), 0)::INTEGER,
        COUNT(*),
        MIN(check_in_at),
        MAX(check_out_at),
        COUNT(*) FILTER (WHERE check_out_at IS NULL)
    INTO
        v_total_minutes,
        v_sessions_count,
        v_first_in,
        v_last_out,
        v_open_sessions
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id
      AND (check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date;

    SELECT EXISTS (
        SELECT 1 FROM public.holidays
        WHERE organization_id = v_org_id
          AND date = p_work_date
          AND is_active = TRUE
    ) INTO v_is_holiday;

    SELECT EXISTS (
        SELECT 1 FROM public.company_days_off
        WHERE organization_id = v_org_id
          AND date = p_work_date
          AND (department_id IS NULL OR department_id = v_dept_id)
    ) INTO v_is_company_day_off;

    v_weekly_offs := COALESCE(v_loc_weekly_offs, v_policy.weekly_off_days, '{0, 6}'::INTEGER[]);
    v_day_of_week := EXTRACT(DOW FROM p_work_date)::INTEGER;
    v_is_weekend := v_day_of_week = ANY(v_weekly_offs);

    SELECT
        COALESCE(bool_or(day_part = 'full'), FALSE),
        COALESCE(bool_or(day_part = 'first_half'), FALSE),
        COALESCE(bool_or(day_part = 'second_half'), FALSE)
    INTO v_has_full_leave, v_has_first_half, v_has_second_half
    FROM public.leave_requests
    WHERE organization_id = v_org_id
      AND employee_id = p_employee_id
      AND status = 'approved'
      AND p_work_date BETWEEN start_date AND end_date;

    IF v_first_in IS NOT NULL THEN
        DECLARE
            v_expected_start TIME := COALESCE(v_policy.shift_start_time, '09:00:00'::time);
            v_grace INTEGER := COALESCE(v_policy.grace_minutes, 15);
            v_actual_time TIME := (v_first_in AT TIME ZONE v_effective_tz)::time;
        BEGIN
            IF v_actual_time > (v_expected_start + (v_grace || ' minutes')::interval) THEN
                v_is_late := TRUE;
            END IF;
        END;
    END IF;

    IF v_is_holiday OR v_is_company_day_off THEN
        v_status := 'holiday';
    ELSIF v_is_weekend THEN
        v_status := 'weekend';
    ELSIF v_has_full_leave OR (v_has_first_half AND v_has_second_half) THEN
        v_status := 'leave';
    ELSIF (v_has_first_half OR v_has_second_half) AND v_sessions_count = 0 THEN
        v_status := 'leave';
        v_total_minutes := COALESCE(v_policy.half_day_minutes, 240);
    ELSIF v_sessions_count = 0 THEN
        IF p_work_date > v_local_today THEN
            DELETE FROM public.attendance_days
            WHERE employee_id = p_employee_id
              AND work_date = p_work_date
              AND locked = FALSE;
            RETURN;
        END IF;
        v_status := 'absent';
    ELSIF v_total_minutes >= v_target_minutes THEN
        v_status := 'present';
        v_overtime_minutes := GREATEST(0, v_total_minutes - v_target_minutes);
    ELSE
        v_status := 'half_day';
    END IF;

    INSERT INTO public.attendance_days (
        organization_id,
        employee_id,
        work_date,
        total_minutes,
        overtime_minutes,
        status,
        is_late,
        locked,
        updated_at
    ) VALUES (
        v_org_id,
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_overtime_minutes,
        v_status,
        v_is_late,
        FALSE,
        pg_catalog.now()
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        total_minutes = EXCLUDED.total_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes,
        status = EXCLUDED.status,
        is_late = EXCLUDED.is_late,
        updated_at = EXCLUDED.updated_at
    WHERE public.attendance_days.locked = FALSE;

    RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.calculate_working_days(
    p_employee_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_day_part TEXT DEFAULT 'full'
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_org_id UUID;
    v_dept_id UUID;
    v_loc_id UUID;
    v_weekly_offs INTEGER[];
    v_curr DATE;
    v_dow INTEGER;
    v_count NUMERIC := 0;
    v_is_holiday BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;
        v_caller_org := public.current_org_id();
    END IF;

    IF p_start_date > p_end_date THEN
        RETURN 0;
    END IF;

    IF p_day_part IN ('first_half', 'second_half') AND p_start_date != p_end_date THEN
        RAISE EXCEPTION 'Half day leave must have identical start and end dates.' USING ERRCODE = '22023';
    END IF;

    SELECT organization_id, department_id, primary_location_id
    INTO v_org_id, v_dept_id, v_loc_id
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN 0;
    END IF;

    IF v_caller_id IS NOT NULL AND v_org_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Employee does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_loc_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.locations WHERE id = v_loc_id;
    END IF;
    IF v_weekly_offs IS NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.attendance_policies WHERE organization_id = v_org_id LIMIT 1;
    END IF;
    IF v_weekly_offs IS NULL THEN
        v_weekly_offs := '{0, 6}'::INTEGER[];
    END IF;

    v_curr := p_start_date;
    WHILE v_curr <= p_end_date LOOP
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;

        IF NOT (v_dow = ANY(v_weekly_offs)) THEN
            SELECT EXISTS (
                SELECT 1 FROM public.holidays
                WHERE organization_id = v_org_id
                  AND date = v_curr
                  AND is_active = TRUE
            ) INTO v_is_holiday;

            IF NOT v_is_holiday THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.company_days_off
                    WHERE organization_id = v_org_id
                      AND date = v_curr
                      AND (department_id IS NULL OR department_id = v_dept_id)
                ) INTO v_is_holiday;
            END IF;

            IF NOT v_is_holiday THEN
                IF p_day_part IN ('first_half', 'second_half') THEN
                    v_count := v_count + 0.5;
                ELSE
                    v_count := v_count + 1.0;
                END IF;
            END IF;
        END IF;

        v_curr := v_curr + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_holiday(
    p_date DATE,
    p_name TEXT,
    p_local_name TEXT DEFAULT NULL,
    p_region TEXT DEFAULT 'GLOBAL',
    p_holiday_type TEXT DEFAULT 'public'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_name TEXT;
    v_local_name TEXT;
    v_region TEXT;
    v_type TEXT;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can create holidays.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to manage holidays.' USING ERRCODE = '42501';
    END IF;

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF p_date IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Holiday date and name are required.' USING ERRCODE = '22023';
    END IF;

    v_type := COALESCE(NULLIF(pg_catalog.btrim(p_holiday_type), ''), 'public');
    IF v_type NOT IN ('public', 'company', 'special') THEN
        RAISE EXCEPTION 'Invalid holiday_type: must be public, company, or special.' USING ERRCODE = '22023';
    END IF;

    v_region := COALESCE(NULLIF(pg_catalog.btrim(p_region), ''), 'GLOBAL');
    v_local_name := NULLIF(pg_catalog.btrim(COALESCE(p_local_name, '')), '');
    v_org_id := public.current_org_id();

    IF EXISTS (
        SELECT 1 FROM public.holidays
        WHERE organization_id = v_org_id AND date = p_date
    ) THEN
        RAISE EXCEPTION 'A holiday already exists for date %.', p_date USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.holidays (
        organization_id, date, name, local_name, region, holiday_type, is_active, updated_at
    ) VALUES (
        v_org_id, p_date, v_name, v_local_name, v_region, v_type, TRUE, pg_catalog.now()
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'HOLIDAY_CREATED',
        'holidays',
        v_row.id,
        NULL,
        to_jsonb(v_row)
    );

    RETURN jsonb_build_object('success', true, 'holiday', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.create_holiday(DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_holiday(DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_holiday(
    p_holiday_id UUID,
    p_date DATE,
    p_name TEXT,
    p_local_name TEXT DEFAULT NULL,
    p_region TEXT DEFAULT 'GLOBAL',
    p_holiday_type TEXT DEFAULT 'public',
    p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_old_row RECORD;
    v_new_row RECORD;
    v_name TEXT;
    v_local_name TEXT;
    v_region TEXT;
    v_type TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can update holidays.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to manage holidays.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.holidays
    WHERE id = p_holiday_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Holiday not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF p_date IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Holiday date and name are required.' USING ERRCODE = '22023';
    END IF;

    v_type := COALESCE(NULLIF(pg_catalog.btrim(p_holiday_type), ''), 'public');
    IF v_type NOT IN ('public', 'company', 'special') THEN
        RAISE EXCEPTION 'Invalid holiday_type: must be public, company, or special.' USING ERRCODE = '22023';
    END IF;

    v_region := COALESCE(NULLIF(pg_catalog.btrim(p_region), ''), 'GLOBAL');
    v_local_name := NULLIF(pg_catalog.btrim(COALESCE(p_local_name, '')), '');

    IF EXISTS (
        SELECT 1 FROM public.holidays
        WHERE organization_id = v_org_id AND date = p_date AND id IS DISTINCT FROM p_holiday_id
    ) THEN
        RAISE EXCEPTION 'Another holiday already exists for date %.', p_date USING ERRCODE = '23505';
    END IF;

    UPDATE public.holidays
    SET date = p_date,
        name = v_name,
        local_name = v_local_name,
        region = v_region,
        holiday_type = v_type,
        is_active = COALESCE(p_is_active, TRUE),
        updated_at = pg_catalog.now()
    WHERE id = p_holiday_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'HOLIDAY_UPDATED',
        'holidays',
        p_holiday_id,
        to_jsonb(v_old_row),
        to_jsonb(v_new_row)
    );

    RETURN jsonb_build_object('success', true, 'holiday', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.update_holiday(UUID, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_holiday(UUID, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_holiday(
    p_holiday_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_old_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can delete holidays.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to manage holidays.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.holidays
    WHERE id = p_holiday_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Holiday not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.holidays WHERE id = p_holiday_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'HOLIDAY_DELETED',
        'holidays',
        p_holiday_id,
        to_jsonb(v_old_row),
        NULL
    );

    RETURN jsonb_build_object('success', true, 'deleted_id', p_holiday_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_holiday(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_holiday(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_holiday_template(
    p_template_code TEXT,
    p_year INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_tpl RECORD;
    v_target_date DATE;
    v_inserted INTEGER := 0;
    v_skipped INTEGER := 0;
    v_row_id UUID;
    v_code TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can import holiday templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to import holiday templates.' USING ERRCODE = '42501';
    END IF;

    v_code := pg_catalog.btrim(COALESCE(p_template_code, ''));
    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'Invalid target year for holiday template import.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.holiday_templates
        WHERE template_code = v_code
    ) THEN
        RAISE EXCEPTION 'Unknown holiday template code: %', v_code USING ERRCODE = '22023';
    END IF;

    v_org_id := public.current_org_id();

    FOR v_tpl IN
        SELECT *
        FROM public.holiday_templates
        WHERE template_code = v_code
          AND (template_year IS NULL OR template_year = p_year)
        ORDER BY month_num, day_num
    LOOP
        BEGIN
            v_target_date := pg_catalog.make_date(p_year, v_tpl.month_num, v_tpl.day_num);
        EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END;

        v_row_id := NULL;
        INSERT INTO public.holidays (
            organization_id, date, name, local_name, region, holiday_type, is_active, updated_at
        ) VALUES (
            v_org_id, v_target_date, v_tpl.name, v_tpl.local_name, v_tpl.region_code, v_tpl.holiday_type, TRUE, pg_catalog.now()
        )
        ON CONFLICT (organization_id, date) DO NOTHING
        RETURNING id INTO v_row_id;

        IF v_row_id IS NOT NULL THEN
            v_inserted := v_inserted + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'HOLIDAY_TEMPLATE_IMPORTED',
        'holidays',
        v_org_id,
        NULL,
        jsonb_build_object(
            'template_code', v_code,
            'year', p_year,
            'inserted_count', v_inserted,
            'skipped_count', v_skipped
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'template_code', v_code,
        'year', p_year,
        'inserted_count', v_inserted,
        'skipped_count', v_skipped
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_holiday_template(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_holiday_template(TEXT, INTEGER) TO authenticated;

-- ============================================================================
-- 5. APPROVAL DELEGATIONS & NOTIFICATION-EMITTING WORKFLOW RPCS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.approval_delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    delegator_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    delegate_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    reason TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_approval_delegations_not_self CHECK (delegator_id <> delegate_id),
    CONSTRAINT chk_approval_delegations_dates CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_approval_delegations_lookup
    ON public.approval_delegations (organization_id, delegator_id, delegate_id, starts_on, ends_on)
    WHERE is_active = TRUE AND revoked_at IS NULL;

REVOKE ALL ON TABLE public.approval_delegations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.approval_delegations TO authenticated;

ALTER TABLE public.approval_delegations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enforce_active_org_membership_approval_delegations" ON public.approval_delegations;
DROP POLICY IF EXISTS "enforce_mfa_aal2_approval_delegations" ON public.approval_delegations;
DROP POLICY IF EXISTS "approval_delegations_select_policy" ON public.approval_delegations;

CREATE POLICY "enforce_active_org_membership_approval_delegations" ON public.approval_delegations
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_approval_delegations" ON public.approval_delegations
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "approval_delegations_select_policy" ON public.approval_delegations
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            delegator_id = (SELECT auth.uid())
            OR delegate_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
        )
    );

CREATE OR REPLACE FUNCTION public.can_approve_for(
    p_approver_id UUID,
    p_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_approver_org UUID;
    v_approver_role TEXT;
    v_emp_org UUID;
    v_emp_manager UUID;
BEGIN
    IF p_approver_id IS NULL OR p_employee_id IS NULL OR p_approver_id = p_employee_id THEN
        RETURN FALSE;
    END IF;

    SELECT om.organization_id, om.role
    INTO v_approver_org, v_approver_role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = p_approver_id
      AND om.status = 'active'
      AND o.status IN ('active', 'trial')
    LIMIT 1;

    IF v_approver_org IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT e.organization_id, e.manager_id
    INTO v_emp_org, v_emp_manager
    FROM public.employees e
    WHERE e.id = p_employee_id;

    IF v_emp_org IS NULL OR v_emp_org IS DISTINCT FROM v_approver_org THEN
        RETURN FALSE;
    END IF;

    IF v_approver_role IN ('hr', 'admin') THEN
        RETURN TRUE;
    END IF;

    IF v_approver_role = 'manager' AND v_emp_manager = p_approver_id THEN
        RETURN TRUE;
    END IF;

    IF v_emp_manager IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.approval_delegations d
        JOIN public.organization_members mgr_om
          ON mgr_om.user_id = d.delegator_id
         AND mgr_om.organization_id = d.organization_id
         AND mgr_om.status = 'active'
        WHERE d.organization_id = v_approver_org
          AND d.delegator_id = v_emp_manager
          AND d.delegate_id = p_approver_id
          AND d.is_active = TRUE
          AND d.revoked_at IS NULL
          AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- RLS-safe delegation check bound strictly to auth.uid() (never takes arbitrary approver UUID)
CREATE OR REPLACE FUNCTION public.is_active_delegated_approver(
    p_delegator_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR p_delegator_id IS NULL OR v_caller_id = p_delegator_id THEN
        RETURN FALSE;
    END IF;

    IF NOT public.is_active_org_member() THEN
        RETURN FALSE;
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.approval_delegations d
        JOIN public.organization_members mgr_om
          ON mgr_om.user_id = d.delegator_id
         AND mgr_om.organization_id = d.organization_id
         AND mgr_om.status = 'active'
        JOIN public.organizations o
          ON o.id = d.organization_id
         AND o.status IN ('active', 'trial')
        WHERE d.organization_id = v_caller_org
          AND d.delegator_id = p_delegator_id
          AND d.delegate_id = v_caller_id
          AND d.is_active = TRUE
          AND d.revoked_at IS NULL
          AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_active_delegated_approver(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_delegated_approver(UUID) TO authenticated;

-- Update SELECT policies so delegates can read team employees, leave_requests, and regularization_requests
DROP POLICY IF EXISTS "employees_select_policy" ON public.employees;
CREATE POLICY "employees_select_policy" ON public.employees
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            id = (SELECT auth.uid())
            OR manager_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR (SELECT public.is_active_delegated_approver(manager_id))
        )
    );

DROP POLICY IF EXISTS "leave_requests_select_policy" ON public.leave_requests;
CREATE POLICY "leave_requests_select_policy" ON public.leave_requests
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            employee_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR EXISTS (
                SELECT 1
                FROM public.employees e
                WHERE e.id = leave_requests.employee_id
                  AND e.organization_id = leave_requests.organization_id
                  AND (
                      e.manager_id = (SELECT auth.uid())
                      OR (SELECT public.is_active_delegated_approver(e.manager_id))
                  )
            )
        )
    );

DROP POLICY IF EXISTS "regularization_requests_select_policy" ON public.regularization_requests;
CREATE POLICY "regularization_requests_select_policy" ON public.regularization_requests
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            employee_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR EXISTS (
                SELECT 1
                FROM public.employees e
                WHERE e.id = regularization_requests.employee_id
                  AND e.organization_id = regularization_requests.organization_id
                  AND (
                      e.manager_id = (SELECT auth.uid())
                      OR (SELECT public.is_active_delegated_approver(e.manager_id))
                  )
            )
        )
    );

CREATE OR REPLACE FUNCTION public.create_approval_delegation(
    p_manager_id UUID,
    p_delegate_id UUID,
    p_starts_on DATE,
    p_ends_on DATE,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_manager_id UUID;
    v_manager_role TEXT;
    v_reason TEXT;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_org_id := public.current_org_id();

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin delegation management.' USING ERRCODE = '42501';
        END IF;
        v_manager_id := COALESCE(p_manager_id, v_caller_id);
    ELSIF v_caller_role = 'manager' THEN
        IF p_manager_id IS NOT NULL AND p_manager_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only delegate their own approvals.' USING ERRCODE = '42501';
        END IF;
        v_manager_id := v_caller_id;
    ELSE
        RAISE EXCEPTION 'Forbidden: Employees cannot create approval delegations.' USING ERRCODE = '42501';
    END IF;

    IF p_delegate_id IS NULL OR p_starts_on IS NULL OR p_ends_on IS NULL THEN
        RAISE EXCEPTION 'Delegate and valid start/end dates are required.' USING ERRCODE = '22023';
    END IF;

    IF v_manager_id = p_delegate_id THEN
        RAISE EXCEPTION 'Self-delegation is not allowed.' USING ERRCODE = '22023';
    END IF;

    IF p_ends_on < p_starts_on THEN
        RAISE EXCEPTION 'Delegation end date must be on or after start date.' USING ERRCODE = '22023';
    END IF;

    SELECT om.role INTO v_manager_role
    FROM public.organization_members om
    WHERE om.user_id = v_manager_id
      AND om.organization_id = v_org_id
      AND om.status = 'active';

    IF v_manager_role IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Delegator must be an active member of caller organization.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.employees e ON e.id = om.user_id AND e.organization_id = om.organization_id
        WHERE om.user_id = p_delegate_id
          AND om.organization_id = v_org_id
          AND om.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Delegate must be an active member of caller organization.' USING ERRCODE = '42501';
    END IF;

    v_reason := NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '');

    INSERT INTO public.approval_delegations (
        organization_id, delegator_id, delegate_id, starts_on, ends_on, reason, created_by
    ) VALUES (
        v_org_id, v_manager_id, p_delegate_id, p_starts_on, p_ends_on, v_reason, v_caller_id
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'APPROVAL_DELEGATION_CREATED',
        'approval_delegations',
        v_row.id,
        NULL,
        to_jsonb(v_row)
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_org_id,
        p_delegate_id,
        'delegation',
        'Approval Authority Delegated',
        'You have been assigned approval coverage from ' || p_starts_on::text || ' through ' || p_ends_on::text || '.',
        '/requests',
        jsonb_build_object('delegation_id', v_row.id, 'delegator_id', v_manager_id, 'starts_on', p_starts_on, 'ends_on', p_ends_on)
    );

    RETURN jsonb_build_object('success', true, 'delegation', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.create_approval_delegation(UUID, UUID, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_approval_delegation(UUID, UUID, DATE, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_approval_delegation(
    p_delegation_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.approval_delegations
    WHERE id = p_delegation_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Approval delegation not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin delegation management.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role = 'manager' THEN
        IF v_old_row.delegator_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only revoke their own delegations.' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'Forbidden: Insufficient permissions to revoke delegations.' USING ERRCODE = '42501';
    END IF;

    IF NOT v_old_row.is_active THEN
        RETURN jsonb_build_object('success', true, 'already_revoked', true, 'delegation', to_jsonb(v_old_row));
    END IF;

    UPDATE public.approval_delegations
    SET is_active = FALSE,
        revoked_at = pg_catalog.now(),
        revoked_by = v_caller_id,
        updated_at = pg_catalog.now()
    WHERE id = p_delegation_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'APPROVAL_DELEGATION_REVOKED',
        'approval_delegations',
        p_delegation_id,
        to_jsonb(v_old_row),
        to_jsonb(v_new_row)
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_org_id,
        v_new_row.delegate_id,
        'delegation',
        'Approval Delegation Ended',
        'Your approval delegation (' || v_new_row.starts_on::text || ' to ' || v_new_row.ends_on::text || ') has been revoked.',
        '/requests',
        jsonb_build_object('delegation_id', p_delegation_id, 'revoked_by', v_caller_id)
    );

    RETURN jsonb_build_object('success', true, 'delegation', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_approval_delegation(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_approval_delegation(UUID) TO authenticated;

-- Upgrade workflow RPCs to emit notifications and use can_approve_for()
CREATE OR REPLACE FUNCTION public.approve_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL OR v_req.organization_id IS DISTINCT FROM v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status IS DISTINCT FROM 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot approve your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization approval.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to approve requests for this employee.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE organization_id = v_req.organization_id
          AND employee_id = v_req.employee_id
          AND work_date = v_req.work_date
          AND locked = TRUE
    ) THEN
        RAISE EXCEPTION 'Cannot approve regularization: attendance day % is locked.', v_req.work_date USING ERRCODE = '22023';
    END IF;

    v_old_data := to_jsonb(v_req);

    UPDATE public.regularization_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id
    RETURNING to_jsonb(regularization_requests.*) INTO v_new_data;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, check_out_at, source, note
    ) VALUES (
        v_req.organization_id, v_req.employee_id, v_req.work_date, v_req.requested_in, v_req.requested_out, 'manual',
        'Regularized: ' || COALESCE(v_req.reason, '')
    );

    PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_req.organization_id, v_caller_id, 'REGULARIZATION_APPROVED', 'regularization_requests', p_request_id,
        v_old_data, v_new_data
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_req.organization_id,
        v_req.employee_id,
        'request_status',
        'Regularization Approved',
        'Your attendance regularization for ' || v_req.work_date::text || ' was approved.',
        '/attendance',
        jsonb_build_object('request_id', p_request_id, 'work_date', v_req.work_date, 'status', 'approved')
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL OR v_req.organization_id IS DISTINCT FROM v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status IS DISTINCT FROM 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot reject your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization review.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to review requests for this employee.';
    END IF;

    v_old_data := to_jsonb(v_req);

    UPDATE public.regularization_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id
    RETURNING to_jsonb(regularization_requests.*) INTO v_new_data;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_req.organization_id, v_caller_id, 'REGULARIZATION_REJECTED', 'regularization_requests', p_request_id, v_old_data, v_new_data);

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_req.organization_id,
        v_req.employee_id,
        'request_status',
        'Regularization Declined',
        'Your attendance regularization for ' || v_req.work_date::text || ' was declined.' || CASE WHEN NULLIF(pg_catalog.btrim(COALESCE(p_review_note, '')), '') IS NOT NULL THEN ' Note: ' || pg_catalog.btrim(p_review_note) ELSE '' END,
        '/requests',
        jsonb_build_object('request_id', p_request_id, 'work_date', v_req.work_date, 'status', 'rejected')
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.request_leave(
    p_leave_type_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_day_part TEXT DEFAULT 'full',
    p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_total_days NUMERIC;
    v_p_start DATE;
    v_p_end DATE;
    v_balance RECORD;
    v_policy RECORD;
    v_combined_cap NUMERIC;
    v_request_id UUID;
    v_new_data JSONB;
    v_emp_name TEXT;
    v_manager_id UUID;
    v_notified_ids UUID[] := ARRAY[]::UUID[];
    v_hr_id UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Invalid date range: start_date must be before or equal to end_date.' USING ERRCODE = '22023';
    END IF;

    IF p_day_part NOT IN ('full', 'first_half', 'second_half') THEN
        RAISE EXCEPTION 'Invalid day_part: must be full, first_half, or second_half.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.leave_types
        WHERE id = p_leave_type_id AND organization_id = v_caller_org AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Invalid or inactive leave type for caller organization.' USING ERRCODE = '22023';
    END IF;

    v_total_days := public.calculate_working_days(v_caller_id, p_start_date, p_end_date, p_day_part);
    IF v_total_days <= 0 THEN
        RAISE EXCEPTION 'Selected date range contains 0 working days (all dates are holidays or weekly offs).' USING ERRCODE = '22023';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, p_start_date);

    SELECT * INTO v_balance
    FROM public.leave_balances
    WHERE organization_id = v_caller_org
      AND employee_id = v_caller_id
      AND leave_type_id = p_leave_type_id
      AND period_start = v_p_start
      AND period_end = v_p_end
    FOR UPDATE;

    SELECT * INTO v_policy
    FROM public.leave_policies
    WHERE organization_id = v_caller_org
      AND leave_type_id = p_leave_type_id;

    IF v_balance IS NOT NULL THEN
        IF (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_total_days THEN
            RAISE EXCEPTION 'Insufficient leave balance. Available: %, Requested: %',
                (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used), v_total_days
                USING ERRCODE = '22023';
        END IF;
    END IF;

    DECLARE
        v_loop_date DATE := p_start_date;
        v_cur_m_start DATE;
        v_cur_m_end DATE;
        v_slice_start DATE;
        v_slice_end DATE;
        v_slice_days NUMERIC;
        v_month_used NUMERIC;
        v_combined_used NUMERIC;
    BEGIN
        SELECT combined_monthly_leave_cap INTO v_combined_cap
        FROM public.organizations
        WHERE id = v_caller_org;

        WHILE v_loop_date <= p_end_date LOOP
            v_cur_m_start := MAKE_DATE(EXTRACT(YEAR FROM v_loop_date)::INT, EXTRACT(MONTH FROM v_loop_date)::INT, 1);
            v_cur_m_end := (v_cur_m_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
            v_slice_start := GREATEST(p_start_date, v_cur_m_start);
            v_slice_end := LEAST(p_end_date, v_cur_m_end);

            v_slice_days := public.calculate_working_days(v_caller_id, v_slice_start, v_slice_end, p_day_part);

            IF v_slice_days > 0 THEN
                IF v_policy.monthly_cap IS NOT NULL THEN
                    SELECT COALESCE(SUM(total_days), 0) INTO v_month_used
                    FROM public.leave_requests
                    WHERE organization_id = v_caller_org
                      AND employee_id = v_caller_id
                      AND leave_type_id = p_leave_type_id
                      AND status IN ('pending', 'approved')
                      AND start_date <= v_cur_m_end
                      AND end_date >= v_cur_m_start;

                    IF (v_month_used + v_slice_days) > v_policy.monthly_cap THEN
                        RAISE EXCEPTION 'Monthly leave cap exceeded for %: Cap is % days, requested in this month is % days.',
                            v_policy.leave_type_id, v_policy.monthly_cap, (v_month_used + v_slice_days)
                            USING ERRCODE = '22023';
                    END IF;
                END IF;

                IF v_combined_cap IS NOT NULL THEN
                    SELECT COALESCE(SUM(total_days), 0) INTO v_combined_used
                    FROM public.leave_requests
                    WHERE organization_id = v_caller_org
                      AND employee_id = v_caller_id
                      AND status IN ('pending', 'approved')
                      AND start_date <= v_cur_m_end
                      AND end_date >= v_cur_m_start;

                    IF (v_combined_used + v_slice_days) > v_combined_cap THEN
                        RAISE EXCEPTION 'Combined monthly leave cap exceeded: Cap is % days, requested in this month is % days.',
                            v_combined_cap, (v_combined_used + v_slice_days)
                            USING ERRCODE = '22023';
                    END IF;
                END IF;
            END IF;

            v_loop_date := v_cur_m_end + 1;
        END LOOP;
    END;

    INSERT INTO public.leave_requests (
        organization_id, employee_id, leave_type_id, start_date, end_date,
        day_part, total_days, reason, status
    ) VALUES (
        v_caller_org, v_caller_id, p_leave_type_id, p_start_date, p_end_date,
        p_day_part, v_total_days, p_reason, 'pending'
    ) RETURNING id INTO v_request_id;

    v_new_data := jsonb_build_object(
        'request_id', v_request_id,
        'leave_type_id', p_leave_type_id,
        'start_date', p_start_date,
        'end_date', p_end_date,
        'total_days', v_total_days,
        'day_part', p_day_part
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_REQUESTED', 'leave_requests', v_request_id, NULL, v_new_data
    );

    SELECT full_name, manager_id INTO v_emp_name, v_manager_id
    FROM public.employees WHERE id = v_caller_id;

    IF v_manager_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = v_manager_id AND organization_id = v_caller_org AND status = 'active'
    ) THEN
        v_notified_ids := array_append(v_notified_ids, v_manager_id);
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            v_caller_org,
            v_manager_id,
            'leave_requested',
            'Leave Request Pending Review',
            COALESCE(v_emp_name, 'Employee') || ' requested ' || v_total_days || ' day(s) of leave (' || p_start_date::text || ' to ' || p_end_date::text || ').',
            '/requests',
            jsonb_build_object('request_id', v_request_id, 'employee_id', v_caller_id, 'total_days', v_total_days)
        );
    END IF;

    -- Also notify active delegates of the manager if any
    IF v_manager_id IS NOT NULL THEN
        FOR v_hr_id IN
            SELECT DISTINCT d.delegate_id
            FROM public.approval_delegations d
            JOIN public.organization_members om ON om.user_id = d.delegate_id AND om.organization_id = v_caller_org AND om.status = 'active'
            WHERE d.organization_id = v_caller_org
              AND d.delegator_id = v_manager_id
              AND d.is_active = TRUE
              AND d.revoked_at IS NULL
              AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on
              AND d.delegate_id <> v_caller_id
        LOOP
            IF NOT (v_hr_id = ANY(v_notified_ids)) THEN
                v_notified_ids := array_append(v_notified_ids, v_hr_id);
                INSERT INTO public.notifications (
                    organization_id, user_id, type, title, body, link, metadata
                ) VALUES (
                    v_caller_org,
                    v_hr_id,
                    'leave_requested',
                    'Delegated Leave Request Pending',
                    COALESCE(v_emp_name, 'Employee') || ' submitted leave (' || p_start_date::text || ' to ' || p_end_date::text || ') under your approval delegation.',
                    '/requests',
                    jsonb_build_object('request_id', v_request_id, 'employee_id', v_caller_id, 'delegated', true)
                );
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'total_days', v_total_days);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_leave(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_request RECORD;
    v_target_emp RECORD;
    v_p_start DATE;
    v_p_end DATE;
    v_balance RECORD;
    v_curr DATE;
    v_dow INTEGER;
    v_weekly_offs INTEGER[] := '{0, 6}'::INTEGER[];
    v_punched BOOLEAN;
    v_locked BOOLEAN;
    v_other_approvers_count INTEGER := 0;
    v_has_active_manager BOOLEAN := FALSE;
    v_sole_admin_fallback BOOLEAN := FALSE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Leave request cannot be approved: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target_emp
    FROM public.employees
    WHERE id = v_request.employee_id;

    -- Separation of duties with single-admin organization founder fallback
    IF v_request.employee_id = v_caller_id THEN
        IF v_caller_role = 'admin' THEN
            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 verification required for sole-admin leave approval fallback.' USING ERRCODE = '42501';
            END IF;

            SELECT COUNT(*) INTO v_other_approvers_count
            FROM public.organization_members
            WHERE organization_id = v_caller_org
              AND user_id IS DISTINCT FROM v_caller_id
              AND status = 'active'
              AND role IN ('admin', 'hr');

            IF v_target_emp.manager_id IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.organization_members
                    WHERE organization_id = v_caller_org
                      AND user_id = v_target_emp.manager_id
                      AND status = 'active'
                ) INTO v_has_active_manager;
            END IF;

            IF v_other_approvers_count = 0 AND NOT v_has_active_manager THEN
                v_sole_admin_fallback := TRUE;
            ELSE
                RAISE EXCEPTION 'Separation of duties: You cannot approve your own leave request.' USING ERRCODE = '42501';
            END IF;
        ELSE
            RAISE EXCEPTION 'Separation of duties: You cannot approve your own leave request.' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF v_caller_role IN ('hr', 'admin') THEN
            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave approval.' USING ERRCODE = '42501';
            END IF;
        ELSIF NOT public.can_approve_for(v_caller_id, v_request.employee_id) THEN
            RAISE EXCEPTION 'Forbidden: You are not authorized or delegated to approve leave for this employee.' USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE organization_id = v_caller_org
          AND employee_id = v_request.employee_id
          AND work_date BETWEEN v_request.start_date AND v_request.end_date
          AND locked = TRUE
    ) INTO v_locked;

    IF v_locked THEN
        RAISE EXCEPTION 'Cannot approve leave: includes locked month dates.' USING ERRCODE = '22023';
    END IF;

    IF v_target_emp.primary_location_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs
        FROM public.locations
        WHERE id = v_target_emp.primary_location_id;
    END IF;
    IF v_weekly_offs IS NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs
        FROM public.attendance_policies
        WHERE organization_id = v_caller_org LIMIT 1;
    END IF;
    IF v_weekly_offs IS NULL THEN
        v_weekly_offs := '{0, 6}'::INTEGER[];
    END IF;

    v_curr := v_request.start_date;
    WHILE v_curr <= v_request.end_date LOOP
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;
        IF NOT (v_dow = ANY(v_weekly_offs)) THEN
            SELECT EXISTS (
                SELECT 1 FROM public.attendance_sessions
                WHERE organization_id = v_caller_org
                  AND employee_id = v_request.employee_id
                  AND work_date = v_curr
            ) INTO v_punched;

            IF v_punched AND v_request.day_part = 'full' THEN
                RAISE EXCEPTION 'Employee already punched in on %: cannot approve full day leave.', v_curr USING ERRCODE = '22023';
            END IF;
        END IF;
        v_curr := v_curr + 1;
    END LOOP;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, v_request.start_date);

    SELECT * INTO v_balance
    FROM public.leave_balances
    WHERE organization_id = v_caller_org
      AND employee_id = v_request.employee_id
      AND leave_type_id = v_request.leave_type_id
      AND period_start = v_p_start
      AND period_end = v_p_end
    FOR UPDATE;

    IF v_balance IS NOT NULL THEN
        IF (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_request.total_days THEN
            RAISE EXCEPTION 'Insufficient leave balance to approve request. Available: %, Requested: %',
                (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used), v_request.total_days
                USING ERRCODE = '22023';
        END IF;

        UPDATE public.leave_balances
        SET used = used + v_request.total_days,
            updated_at = pg_catalog.now()
        WHERE id = v_balance.id;
    END IF;

    UPDATE public.leave_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = COALESCE(p_review_note, CASE WHEN v_sole_admin_fallback THEN 'Auto-approved via sole-admin organization fallback' ELSE NULL END),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    v_curr := v_request.start_date;
    WHILE v_curr <= v_request.end_date LOOP
        PERFORM public.recalculate_day(v_request.employee_id, v_curr);
        v_curr := v_curr + 1;
    END LOOP;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_APPROVED', 'leave_requests', p_request_id,
        jsonb_build_object('status', 'pending'),
        jsonb_build_object(
            'status', 'approved',
            'total_days', v_request.total_days,
            'reviewed_by', v_caller_id,
            'sole_admin_fallback', v_sole_admin_fallback
        )
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_caller_org,
        v_request.employee_id,
        'leave_status',
        'Leave Request Approved',
        'Your leave request from ' || v_request.start_date::text || ' to ' || v_request.end_date::text || ' has been approved.',
        '/leave',
        jsonb_build_object('request_id', p_request_id, 'status', 'approved', 'reviewed_by', v_caller_id)
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'approved', 'sole_admin_fallback', v_sole_admin_fallback);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_leave(
    p_request_id UUID,
    p_review_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_request RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Leave request cannot be rejected: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    IF v_request.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: You cannot reject your own leave request.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave rejection.' USING ERRCODE = '42501';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_request.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You are not authorized or delegated to reject leave for this employee.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.leave_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note,
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_REJECTED', 'leave_requests', p_request_id,
        jsonb_build_object('status', 'pending'),
        jsonb_build_object('status', 'rejected', 'note', p_review_note, 'reviewed_by', v_caller_id)
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_caller_org,
        v_request.employee_id,
        'leave_status',
        'Leave Request Declined',
        'Your leave request from ' || v_request.start_date::text || ' to ' || v_request.end_date::text || ' was declined.' || CASE WHEN NULLIF(pg_catalog.btrim(COALESCE(p_review_note, '')), '') IS NOT NULL THEN ' Reason: ' || pg_catalog.btrim(p_review_note) ELSE '' END,
        '/leave',
        jsonb_build_object('request_id', p_request_id, 'status', 'rejected', 'reviewed_by', v_caller_id)
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'rejected');
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_leave(
    p_request_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_request RECORD;
    v_p_start DATE;
    v_p_end DATE;
    v_locked BOOLEAN;
    v_was_approved BOOLEAN;
    v_curr DATE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.employee_id IS DISTINCT FROM v_caller_id THEN
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Forbidden: You cannot cancel another employee leave request.' USING ERRCODE = '42501';
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required to cancel employee leave.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_request.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'Leave request cannot be cancelled: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    v_was_approved := (v_request.status = 'approved');

    IF v_was_approved THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = v_caller_org
              AND employee_id = v_request.employee_id
              AND work_date BETWEEN v_request.start_date AND v_request.end_date
              AND locked = TRUE
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot cancel leave: touches locked month dates.' USING ERRCODE = '22023';
        END IF;

        SELECT period_start, period_end INTO v_p_start, v_p_end
        FROM public.get_organization_leave_period(v_caller_org, v_request.start_date);

        UPDATE public.leave_balances
        SET used = GREATEST(0, used - v_request.total_days),
            updated_at = pg_catalog.now()
        WHERE organization_id = v_caller_org
          AND employee_id = v_request.employee_id
          AND leave_type_id = v_request.leave_type_id
          AND period_start = v_p_start
          AND period_end = v_p_end;
    END IF;

    UPDATE public.leave_requests
    SET status = 'cancelled',
        cancelled_at = pg_catalog.now(),
        review_note = COALESCE(p_reason, review_note),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    IF v_was_approved THEN
        v_curr := v_request.start_date;
        WHILE v_curr <= v_request.end_date LOOP
            PERFORM public.recalculate_day(v_request.employee_id, v_curr);
            v_curr := v_curr + 1;
        END LOOP;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_CANCELLED', 'leave_requests', p_request_id,
        jsonb_build_object('status', v_request.status),
        jsonb_build_object('status', 'cancelled', 'cancelled_by', v_caller_id, 'reason', p_reason)
    );

    IF v_request.employee_id IS DISTINCT FROM v_caller_id THEN
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            v_caller_org,
            v_request.employee_id,
            'leave_status',
            'Leave Request Cancelled',
            'Your leave (' || v_request.start_date::text || ' to ' || v_request.end_date::text || ') was cancelled by HR/Admin.',
            '/leave',
            jsonb_build_object('request_id', p_request_id, 'status', 'cancelled', 'cancelled_by', v_caller_id)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'cancelled');
END;
$$;

