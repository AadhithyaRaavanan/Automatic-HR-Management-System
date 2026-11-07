-- Migration: 20261107000007_security_and_mfa.sql
-- Description: Security Hardening: SET search_path = '', Revoke EXECUTE from PUBLIC/anon,
--              Restrictive AAL2 MFA policies for HR/Admin across all public tables,
--              Separation of Duties, schema qualifications, and can_approve_for() helper.

-- 1. Schema Extensions on notifications table
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 2. Fast helper: current_user_role() with search_path = ''
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        NULLIF(pg_catalog.current_setting('request.jwt.claim.user_role', true), ''),
        (SELECT (auth.jwt())->>'user_role'),
        (SELECT role FROM public.user_roles WHERE user_id = (SELECT auth.uid()) LIMIT 1),
        'employee'
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- 3. Fast helper: get_user_role(UUID) with search_path = ''
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.user_roles WHERE user_id = p_user_id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_role(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_role(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;

-- 4. Supabase Custom Access Token Hook with search_path = ''
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    claims JSONB;
    user_role TEXT;
    target_user_id UUID;
BEGIN
    target_user_id := (event->>'user_id')::UUID;
    
    SELECT role INTO user_role 
    FROM public.user_roles 
    WHERE user_id = target_user_id 
    LIMIT 1;

    IF user_role IS NULL THEN
        user_role := 'employee';
    END IF;

    claims := event->'claims';
    claims := pg_catalog.jsonb_set(claims, '{user_role}', pg_catalog.to_jsonb(user_role));
    event := pg_catalog.jsonb_set(event, '{claims}', claims);
    
    RETURN event;
END;
$$;

-- Critical: ensure supabase_auth_admin retains execution permission
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM authenticated, anon, PUBLIC;

-- 5. Approval authority helper: can_approve_for(UUID, UUID)
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
    v_approver_role TEXT;
    v_is_direct_manager BOOLEAN := FALSE;
BEGIN
    SELECT role INTO v_approver_role 
    FROM public.user_roles 
    WHERE user_id = p_approver_id;

    IF v_approver_role IN ('hr', 'admin') THEN
        RETURN TRUE;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.employees 
        WHERE id = p_employee_id AND manager_id = p_approver_id
    ) INTO v_is_direct_manager;

    IF v_is_direct_manager THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_approve_for(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_approve_for(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_approve_for(UUID, UUID) TO authenticated;

-- 6. Hardened check_in with search_path = '' and AAL2 on privileged overrides
DROP FUNCTION IF EXISTS public.check_in(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.check_in(
    p_employee_id UUID,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target_id UUID := coalesce(p_employee_id, (SELECT auth.uid()));
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
    v_today DATE;
    v_now TIMESTAMPTZ := pg_catalog.now();
    v_session_id UUID;
    v_policy RECORD;
    v_shift_start TIMESTAMPTZ;
    v_is_late BOOLEAN := FALSE;
    v_existing_open UUID;
    v_emp_timezone TEXT;
    v_emp_status TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    -- If caller checking in for another employee, require HR/Admin role AND AAL2
    IF v_caller_id <> v_target_id THEN
        SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Unauthorized check-in attempt for another employee.';
        END IF;

        IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative check-in override.';
        END IF;
    END IF;

    -- Verify employee status
    SELECT status, timezone INTO v_emp_status, v_emp_timezone 
    FROM public.employees 
    WHERE id = v_target_id;

    IF v_emp_status IS NULL THEN
        RAISE EXCEPTION 'Employee record not found.';
    END IF;

    IF v_emp_status <> 'active' THEN
        RAISE EXCEPTION 'Inactive or exited employees cannot check in.';
    END IF;

    v_today := (v_now AT TIME ZONE COALESCE(v_emp_timezone, 'UTC'))::date;

    -- Check open session
    SELECT id INTO v_existing_open
    FROM public.attendance_sessions
    WHERE employee_id = v_target_id AND check_out_at IS NULL;

    IF v_existing_open IS NOT NULL THEN
        RAISE EXCEPTION 'Active session already open. Check out first before starting a new session.';
    END IF;

    -- Check attendance policy
    SELECT * INTO v_policy 
    FROM public.attendance_policies 
    WHERE is_active = TRUE 
    LIMIT 1;

    IF v_policy IS NOT NULL THEN
        v_shift_start := (v_today::text || ' 09:30:00')::timestamptz;
        IF v_now > (v_shift_start + (v_policy.grace_minutes || ' minutes')::interval) THEN
            v_is_late := TRUE;
        END IF;
    END IF;

    -- Insert session
    INSERT INTO public.attendance_sessions (
        employee_id,
        work_date,
        check_in_at,
        source,
        note
    ) VALUES (
        v_target_id,
        v_today,
        v_now,
        'web',
        p_note
    ) RETURNING id INTO v_session_id;

    -- Upsert attendance day
    INSERT INTO public.attendance_days (
        employee_id,
        work_date,
        total_minutes,
        status,
        is_late,
        locked
    ) VALUES (
        v_target_id,
        v_today,
        0,
        'present',
        v_is_late,
        FALSE
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE
    SET is_late = EXCLUDED.is_late OR attendance_days.is_late,
        status = CASE 
            WHEN attendance_days.status = 'absent' THEN 'present' 
            ELSE attendance_days.status 
        END,
        updated_at = v_now;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'session_id', v_session_id,
        'check_in_at', v_now,
        'work_date', v_today,
        'is_late', v_is_late
    );
END;
$$;

-- Single parameter overload for backward compatibility with frontend: check_in(p_note)
CREATE OR REPLACE FUNCTION public.check_in(p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.check_in(NULL, p_note);
$$;

REVOKE ALL ON FUNCTION public.check_in(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.check_in(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in(TEXT) TO authenticated;

-- 7. Hardened check_out with search_path = '' and AAL2 on privileged overrides
DROP FUNCTION IF EXISTS public.check_out(UUID, UUID);
CREATE OR REPLACE FUNCTION public.check_out(
    p_employee_id UUID,
    p_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID := (SELECT auth.uid());
    v_target_id UUID := coalesce(p_employee_id, (SELECT auth.uid()));
    v_caller_role TEXT;
    v_now TIMESTAMPTZ := pg_catalog.now();
    v_session RECORD;
    v_duration_minutes INTEGER;
    v_capped_duration INTEGER;
    v_today DATE;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    IF v_caller_id <> v_target_id THEN
        SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Unauthorized check-out attempt.';
        END IF;

        IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative check-out override.';
        END IF;
    END IF;

    IF p_session_id IS NOT NULL THEN
        SELECT * INTO v_session
        FROM public.attendance_sessions
        WHERE id = p_session_id AND employee_id = v_target_id AND check_out_at IS NULL;
    ELSE
        SELECT * INTO v_session
        FROM public.attendance_sessions
        WHERE employee_id = v_target_id AND check_out_at IS NULL
        ORDER BY check_in_at DESC
        LIMIT 1;
    END IF;

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'No matching open session found to check out.';
    END IF;

    v_duration_minutes := pg_catalog.round(EXTRACT(EPOCH FROM (v_now - v_session.check_in_at)) / 60)::integer;
    v_capped_duration := LEAST(GREATEST(v_duration_minutes, 1), 960);
    v_today := v_session.work_date;

    UPDATE public.attendance_sessions
    SET check_out_at = v_now
    WHERE id = v_session.id;

    PERFORM public.recalculate_day(v_target_id, v_today);

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'session_id', v_session.id,
        'check_out_at', v_now,
        'work_date', v_today,
        'duration_minutes', v_capped_duration
    );
END;
$$;

-- Zero parameter overload for backward compatibility with frontend: check_out()
CREATE OR REPLACE FUNCTION public.check_out()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.check_out(NULL, NULL);
$$;

REVOKE ALL ON FUNCTION public.check_out(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_out(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_out(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.check_out() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_out() FROM anon;
GRANT EXECUTE ON FUNCTION public.check_out() TO authenticated;

-- 8. Hardened recalculate_day with search_path = ''
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
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_policy RECORD;
    v_is_locked BOOLEAN := FALSE;
BEGIN
    SELECT locked INTO v_is_locked 
    FROM public.attendance_days 
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    IF v_is_locked = TRUE THEN
        RETURN;
    END IF;

    SELECT coalesce(pg_catalog.sum(
        pg_catalog.round(EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60)
    )::integer, 0)
    INTO v_total_minutes
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id 
      AND work_date = p_work_date 
      AND check_out_at IS NOT NULL;

    SELECT * INTO v_policy 
    FROM public.attendance_policies 
    WHERE is_active = TRUE 
    LIMIT 1;

    IF v_policy IS NOT NULL THEN
        IF v_total_minutes >= v_policy.half_day_minutes THEN
            v_status := 'present';
        ELSIF v_total_minutes >= v_policy.absent_minutes THEN
            v_status := 'half_day';
        ELSE
            v_status := 'absent';
        END IF;
    ELSE
        IF v_total_minutes >= 240 THEN
            v_status := 'present';
        ELSE
            v_status := 'absent';
        END IF;
    END IF;

    SELECT coalesce(is_late, FALSE) INTO v_is_late
    FROM public.attendance_days
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    v_is_late := coalesce(v_is_late, FALSE);

    INSERT INTO public.attendance_days (
        employee_id,
        work_date,
        total_minutes,
        status,
        is_late,
        locked,
        updated_at
    ) VALUES (
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_status,
        v_is_late,
        FALSE,
        pg_catalog.now()
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE
    SET total_minutes = EXCLUDED.total_minutes,
        status = CASE 
            WHEN attendance_days.status = 'leave' THEN 'leave'
            WHEN attendance_days.status = 'holiday' THEN 'holiday'
            ELSE EXCLUDED.status 
        END,
        updated_at = pg_catalog.now();
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_day(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_day(UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.recalculate_day(UUID, DATE) TO authenticated;

-- 9. Hardened lock_month and unlock_month with AAL2 verification
CREATE OR REPLACE FUNCTION public.lock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_rows_locked INTEGER;
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can lock attendance months.';
    END IF;

    IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to lock attendance months.';
    END IF;

    v_start_date := pg_catalog.make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + INTERVAL '1 month - 1 day')::date;

    UPDATE public.attendance_days
    SET locked = TRUE,
        updated_at = pg_catalog.now()
    WHERE work_date >= v_start_date AND work_date <= v_end_date;

    GET DIAGNOSTICS v_rows_locked = ROW_COUNT;

    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_id,
        'LOCK_MONTH',
        'attendance_days',
        v_caller_id,
        pg_catalog.jsonb_build_object(
            'year', p_year,
            'month', p_month,
            'rows_locked', v_rows_locked
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'year', p_year,
        'month', p_month,
        'rows_locked', v_rows_locked
    );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_month(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_month(INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.lock_month(INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.unlock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_rows_unlocked INTEGER;
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
    IF v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Administrators can unlock attendance months.';
    END IF;

    IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to unlock attendance months.';
    END IF;

    v_start_date := pg_catalog.make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + INTERVAL '1 month - 1 day')::date;

    UPDATE public.attendance_days
    SET locked = FALSE,
        updated_at = pg_catalog.now()
    WHERE work_date >= v_start_date AND work_date <= v_end_date;

    GET DIAGNOSTICS v_rows_unlocked = ROW_COUNT;

    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_id,
        'UNLOCK_MONTH',
        'attendance_days',
        v_caller_id,
        pg_catalog.jsonb_build_object(
            'year', p_year,
            'month', p_month,
            'rows_unlocked', v_rows_unlocked
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'year', p_year,
        'month', p_month,
        'rows_unlocked', v_rows_unlocked
    );
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_month(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlock_month(INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.unlock_month(INTEGER, INTEGER) TO authenticated;

-- 10. Hardened approve_regularization with Separation of Duties & AAL2
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
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
    v_can_approve BOOLEAN;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    SELECT * INTO v_req 
    FROM public.regularization_requests 
    WHERE id = p_request_id;

    IF v_req IS NULL THEN
        RAISE EXCEPTION 'Regularization request not found.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Request is already finalized (status: %).', v_req.status;
    END IF;

    -- Anti-collusion: Separation of duties prevents approving own request
    IF v_req.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot approve your own regularization request.';
    END IF;

    -- Authority check
    v_can_approve := public.can_approve_for(v_caller_id, v_req.employee_id);
    IF NOT v_can_approve THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to approve requests for this employee.';
    END IF;

    -- HR & Admin require AAL2
    SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
    IF v_caller_role IN ('hr', 'admin') THEN
        IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative approvals.';
        END IF;
    END IF;

    -- Insert corrected synthetic punch session
    INSERT INTO public.attendance_sessions (
        employee_id,
        work_date,
        check_in_at,
        check_out_at,
        source,
        note
    ) VALUES (
        v_req.employee_id,
        v_req.work_date,
        v_req.requested_in,
        v_req.requested_out,
        'manual',
        'Regularization Approved: ' || COALESCE(v_req.reason, '')
    );

    UPDATE public.regularization_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id;

    PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body,
        link
    ) VALUES (
        v_req.employee_id,
        'request_status',
        'Regularization Approved',
        'Your punch correction for ' || v_req.work_date::text || ' was approved.',
        '/attendance'
    );

    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_id,
        'APPROVE_REGULARIZATION',
        'regularization_requests',
        p_request_id,
        pg_catalog.jsonb_build_object('status', 'pending'),
        pg_catalog.jsonb_build_object('status', 'approved', 'review_note', p_review_note)
    );

    RETURN pg_catalog.jsonb_build_object('success', TRUE, 'request_id', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_regularization(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_regularization(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_regularization(UUID, TEXT) TO authenticated;

-- 11. Hardened reject_regularization with Separation of Duties & AAL2
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
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
    v_can_approve BOOLEAN;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    SELECT * INTO v_req 
    FROM public.regularization_requests 
    WHERE id = p_request_id;

    IF v_req IS NULL THEN
        RAISE EXCEPTION 'Regularization request not found.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Request is already finalized (status: %).', v_req.status;
    END IF;

    -- Anti-collusion: Separation of duties prevents rejecting own request
    IF v_req.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot reject your own regularization request.';
    END IF;

    -- Authority check
    v_can_approve := public.can_approve_for(v_caller_id, v_req.employee_id);
    IF NOT v_can_approve THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to reject requests for this employee.';
    END IF;

    -- HR & Admin require AAL2
    SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
    IF v_caller_role IN ('hr', 'admin') THEN
        IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative rejections.';
        END IF;
    END IF;

    UPDATE public.regularization_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id;

    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body,
        link
    ) VALUES (
        v_req.employee_id,
        'request_status',
        'Regularization Declined',
        COALESCE(p_review_note, 'Your attendance request for ' || v_req.work_date::text || ' was not approved.'),
        '/attendance'
    );

    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_id,
        'REJECT_REGULARIZATION',
        'regularization_requests',
        p_request_id,
        pg_catalog.jsonb_build_object('status', 'pending'),
        pg_catalog.jsonb_build_object('status', 'rejected', 'note', p_review_note)
    );

    RETURN pg_catalog.jsonb_build_object('success', TRUE, 'request_id', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_regularization(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_regularization(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_regularization(UUID, TEXT) TO authenticated;

-- 12. Hardened cron jobs with search_path = ''
CREATE OR REPLACE FUNCTION public.cron_auto_checkout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_closed_count INTEGER := 0;
    v_rec RECORD;
    v_checkout_time TIMESTAMPTZ;
BEGIN
    FOR v_rec IN
        SELECT id, employee_id, work_date, check_in_at
        FROM public.attendance_sessions
        WHERE check_out_at IS NULL
          AND (pg_catalog.now() - check_in_at) >= INTERVAL '12 hours'
    LOOP
        v_checkout_time := v_rec.check_in_at + INTERVAL '8 hours';
        IF v_checkout_time > pg_catalog.now() THEN
            v_checkout_time := pg_catalog.now();
        END IF;

        UPDATE public.attendance_sessions
        SET check_out_at = v_checkout_time,
            source = 'auto',
            note = COALESCE(note, '') || ' [System Auto-Checkout at Day End]'
        WHERE id = v_rec.id;

        PERFORM public.recalculate_day(v_rec.employee_id, v_rec.work_date);

        INSERT INTO public.notifications (
            user_id,
            type,
            title,
            body
        ) VALUES (
            v_rec.employee_id,
            'missed_checkout',
            'Missed Checkout Recorded',
            'Your session on ' || v_rec.work_date::text || ' was auto-closed. Please apply for regularization if adjustments are needed.'
        );

        v_closed_count := v_closed_count + 1;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_auto_checkout() FROM anon;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout() TO authenticated;

CREATE OR REPLACE FUNCTION public.cron_nightly_finalize()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_yesterday DATE := (pg_catalog.now() - INTERVAL '1 day')::date;
    v_marked_count INTEGER := 0;
    v_emp RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_is_weekend BOOLEAN := FALSE;
BEGIN
    IF EXISTS (SELECT 1 FROM public.holidays WHERE date = v_yesterday) THEN
        v_is_holiday := TRUE;
    END IF;

    IF EXTRACT(ISODOW FROM v_yesterday) IN (6, 7) THEN
        v_is_weekend := TRUE;
    END IF;

    FOR v_emp IN
        SELECT id FROM public.employees WHERE status = 'active'
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_days 
            WHERE employee_id = v_emp.id AND work_date = v_yesterday
        ) THEN
            INSERT INTO public.attendance_days (
                employee_id,
                work_date,
                total_minutes,
                status,
                is_late,
                locked,
                created_at,
                updated_at
            ) VALUES (
                v_emp.id,
                v_yesterday,
                0,
                CASE 
                    WHEN v_is_holiday THEN 'holiday'
                    WHEN v_is_weekend THEN 'weekend'
                    ELSE 'absent'
                END,
                FALSE,
                FALSE,
                pg_catalog.now(),
                pg_catalog.now()
            );
            v_marked_count := v_marked_count + 1;
        END IF;
    END LOOP;

    RETURN v_marked_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_nightly_finalize() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_nightly_finalize() FROM anon;
GRANT EXECUTE ON FUNCTION public.cron_nightly_finalize() TO authenticated;

-- 13. RESTRICTIVE AAL2 MFA Policies across all public tables for HR & Admin
-- AS RESTRICTIVE policies must evaluate to TRUE in addition to permissive policies.
-- By evaluating against JWT claims (auth.jwt()->>'user_role' and auth.jwt()->>'aal'),
-- they operate with zero subquery overhead and prevent recursive lockouts.

DO $$
BEGIN
    -- 13.1 employees
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'enforce_mfa_aal2_employees') THEN
        CREATE POLICY "enforce_mfa_aal2_employees" ON public.employees
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.2 user_roles
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_roles' AND policyname = 'enforce_mfa_aal2_user_roles') THEN
        CREATE POLICY "enforce_mfa_aal2_user_roles" ON public.user_roles
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.3 attendance_policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_policies' AND policyname = 'enforce_mfa_aal2_attendance_policies') THEN
        CREATE POLICY "enforce_mfa_aal2_attendance_policies" ON public.attendance_policies
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.4 audit_logs
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'enforce_mfa_aal2_audit_logs') THEN
        CREATE POLICY "enforce_mfa_aal2_audit_logs" ON public.audit_logs
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.5 attendance_sessions (for direct emergency admin modifications)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_sessions' AND policyname = 'enforce_mfa_aal2_attendance_sessions') THEN
        CREATE POLICY "enforce_mfa_aal2_attendance_sessions" ON public.attendance_sessions
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.6 attendance_days (for direct updates by HR / Admin)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_days' AND policyname = 'enforce_mfa_aal2_attendance_days') THEN
        CREATE POLICY "enforce_mfa_aal2_attendance_days" ON public.attendance_days
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.7 regularization_requests (for direct updates by HR / Admin)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'regularization_requests' AND policyname = 'enforce_mfa_aal2_regularization_requests') THEN
        CREATE POLICY "enforce_mfa_aal2_regularization_requests" ON public.regularization_requests
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.8 holidays (for holiday schedule mutations by HR / Admin)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'holidays' AND policyname = 'enforce_mfa_aal2_holidays') THEN
        CREATE POLICY "enforce_mfa_aal2_holidays" ON public.holidays
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;
END $$;

-- 14. Shared Persistent Rate Limiting Table
-- Replaces ephemeral in-memory storage with multi-node, serverless-safe shared persistence
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE public.auth_rate_limits FROM anon;
REVOKE ALL ON TABLE public.auth_rate_limits FROM authenticated;
GRANT ALL ON TABLE public.auth_rate_limits TO service_role;

