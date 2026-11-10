-- ============================================================================
-- Migration 11: Security Hardening, Suspended-Member Isolation, RPC Reconciliation & Leave Fixes
--
-- Covers Section 0 requirements:
-- 0b: Separate current_org_id() org-resolution from active-membership check in is_active_org_member()
--     so RESTRICTIVE enforce_active_org_membership_* policies are genuinely load-bearing;
--     enforce is_active_org_member() at the top of every authenticated RPC.
-- 0c: Harden provision_invited_employee against cross-organization user hijacking.
-- 0d: Drop unhardened check_out(UUID, UUID); fix can_approve_for() & cron_nightly_finalize();
--     unify audit_logs.action names to UPPER_SNAKE <ENTITY>_<PAST_TENSE> convention;
--     ensure old_data & new_data population on mutations; enforce admin-only checks.
-- 0e: Fix holidays per-org uniqueness; allow complementary half-day leaves (first_half + second_half)
--     via leave_slot_range() exclusion constraint; route cancel_leave, approve_leave,
--     hr_assign_leave through recalculate_day() (no direct status writes, no 'regular',
--     never mark future days 'absent'); add locked-day checks on approve_regularization &
--     hr_assign_leave; add sole-admin organization leave approval fallback.
-- ============================================================================

-- ============================================================================
-- SECTION 1: Fix Holidays Per-Organization Unique Constraint
-- ============================================================================
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS holidays_date_key;
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS uq_holidays_org_date;
ALTER TABLE public.holidays ADD CONSTRAINT uq_holidays_org_date UNIQUE (organization_id, date);

-- ============================================================================
-- SECTION 2: Tenant & Active-Membership Helper Separation (0b)
-- ============================================================================
-- current_org_id() resolves the tenant org_id (without filtering om.status = 'active')
-- so PERMISSIVE policies resolve the tenant scope and RESTRICTIVE
-- enforce_active_org_membership_* policies strictly enforce om.status = 'active'.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT om.organization_id
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = (SELECT auth.uid())
      AND o.status IN ('active', 'trial')
      AND (
          NULLIF((auth.jwt())->>'organization_id', '') IS NULL
          OR om.organization_id = NULLIF((auth.jwt())->>'organization_id', '')::uuid
      )
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.current_org_id();
$$;

CREATE OR REPLACE FUNCTION public.is_active_org_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = (SELECT auth.uid())
          AND om.organization_id = public.current_org_id()
          AND om.status = 'active'
          AND o.status IN ('active', 'trial')
    );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT om.role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = (SELECT auth.uid())
      AND om.organization_id = public.current_org_id()
      AND om.status = 'active'
      AND o.status IN ('active', 'trial')
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_caller_id UUID;
    v_caller_org UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;

        v_caller_org := public.current_org_id();
        SELECT om.role INTO v_role
        FROM public.organization_members om
        WHERE om.user_id = p_user_id
          AND om.organization_id = v_caller_org
          AND om.status = 'active'
        LIMIT 1;

        RETURN v_role;
    END IF;

    -- System / service_role lookup when auth.uid() is NULL
    SELECT om.role INTO v_role
    FROM public.organization_members om
    WHERE om.user_id = p_user_id
      AND om.status = 'active'
    LIMIT 1;

    RETURN v_role;
END;
$$;

-- Drop legacy unhardened check_out(UUID, UUID) overload (0d)
DROP FUNCTION IF EXISTS public.check_out(UUID, UUID);

-- Fix can_approve_for(UUID, UUID): query organization_members (not dropped user_roles) + active + same org
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

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_approve_for(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve_for(UUID, UUID) TO service_role;

-- ============================================================================
-- SECTION 3: Half-Day Overlap Rule (0e)
-- ============================================================================
-- Allows first_half + second_half on the same date while blocking same-slot
-- or full-day overlaps for pending/approved requests.
CREATE OR REPLACE FUNCTION public.leave_slot_range(
    p_start DATE,
    p_end DATE,
    p_day_part TEXT
)
RETURNS int4range
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_day_part = 'first_half' THEN
            pg_catalog.int4range((p_start - DATE '2000-01-01')::integer * 2, (p_start - DATE '2000-01-01')::integer * 2 + 1, '[)')
        WHEN p_day_part = 'second_half' THEN
            pg_catalog.int4range((p_start - DATE '2000-01-01')::integer * 2 + 1, (p_start - DATE '2000-01-01')::integer * 2 + 2, '[)')
        ELSE
            pg_catalog.int4range((p_start - DATE '2000-01-01')::integer * 2, (p_end - DATE '2000-01-01')::integer * 2 + 2, '[)')
    END;
$$;

REVOKE ALL ON FUNCTION public.leave_slot_range(DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_slot_range(DATE, DATE, TEXT) TO authenticated, service_role;

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS chk_leave_request_half_day_single_date;
ALTER TABLE public.leave_requests ADD CONSTRAINT chk_leave_request_half_day_single_date
    CHECK (day_part = 'full' OR start_date = end_date);

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS exclude_overlapping_leave_requests;
ALTER TABLE public.leave_requests ADD CONSTRAINT exclude_overlapping_leave_requests
    EXCLUDE USING gist (
        employee_id WITH =,
        public.leave_slot_range(start_date, end_date, day_part) WITH &&
    ) WHERE (status IN ('pending', 'approved'));

-- ============================================================================
-- SECTION 4: Hardened provision_invited_employee (0c)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.provision_invited_employee(
    p_user_id UUID,
    p_organization_id UUID,
    p_email TEXT,
    p_full_name TEXT,
    p_role TEXT DEFAULT 'employee',
    p_work_mode TEXT DEFAULT 'remote',
    p_timezone TEXT DEFAULT 'UTC',
    p_department_id UUID DEFAULT NULL,
    p_manager_id UUID DEFAULT NULL,
    p_primary_location_id UUID DEFAULT NULL,
    p_work_target_minutes INTEGER DEFAULT 480,
    p_expected_office_days INTEGER[] DEFAULT '{1,2,3,4,5}',
    p_required_office_days_per_week INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_existing_member_org UUID;
    v_existing_emp_org UUID;
    v_new_data JSONB;
BEGIN
    v_actor_id := (SELECT auth.uid());

    IF p_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = '22023';
    END IF;

    IF p_work_mode NOT IN ('remote', 'office', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work mode: %', p_work_mode USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
        RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '02000';
    END IF;

    -- Prevent cross-organization user hijacking
    SELECT organization_id INTO v_existing_member_org
    FROM public.organization_members
    WHERE user_id = p_user_id;

    IF v_existing_member_org IS NOT NULL AND v_existing_member_org IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Cross-tenant violation: User already belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    SELECT organization_id INTO v_existing_emp_org
    FROM public.employees
    WHERE id = p_user_id;

    IF v_existing_emp_org IS NOT NULL AND v_existing_emp_org IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Cross-tenant violation: Employee already belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.organization_members (
        organization_id, user_id, role, status
    ) VALUES (
        p_organization_id, p_user_id, p_role, 'active'
    ) ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        status = 'active',
        updated_at = pg_catalog.now()
    WHERE public.organization_members.organization_id = p_organization_id;

    INSERT INTO public.employees (
        id, organization_id, email, full_name, work_mode, timezone,
        department_id, manager_id, primary_location_id,
        work_target_minutes, expected_office_days, required_office_days_per_week, status
    ) VALUES (
        p_user_id, p_organization_id, p_email, p_full_name, p_work_mode, p_timezone,
        p_department_id, p_manager_id, p_primary_location_id,
        p_work_target_minutes, p_expected_office_days, p_required_office_days_per_week, 'active'
    ) ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        work_mode = EXCLUDED.work_mode,
        timezone = EXCLUDED.timezone,
        department_id = EXCLUDED.department_id,
        manager_id = EXCLUDED.manager_id,
        primary_location_id = EXCLUDED.primary_location_id,
        work_target_minutes = EXCLUDED.work_target_minutes,
        expected_office_days = EXCLUDED.expected_office_days,
        required_office_days_per_week = EXCLUDED.required_office_days_per_week,
        status = 'active',
        updated_at = pg_catalog.now()
    WHERE public.employees.organization_id = p_organization_id;

    v_new_data := jsonb_build_object(
        'email', p_email,
        'full_name', p_full_name,
        'role', p_role,
        'work_mode', p_work_mode,
        'timezone', p_timezone,
        'department_id', p_department_id,
        'manager_id', p_manager_id
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        p_organization_id,
        COALESCE(v_actor_id, p_user_id),
        'EMPLOYEE_CREATED',
        'employees',
        p_user_id,
        NULL,
        v_new_data
    );

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id);
END;
$$;

-- ============================================================================
-- SECTION 5: Unified recalculate_day(), cron_auto_checkout(), cron_nightly_finalize()
-- ============================================================================
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
    -- Never overwrite locked attendance days
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
        WHERE organization_id = v_org_id AND date = p_work_date
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

    -- Check approved leave requests covering p_work_date
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
        -- Never mark future days 'absent'; remove non-locked placeholder rows when leave is cancelled
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
            v_closed_count := v_closed_count + 1;
        END IF;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_nightly_finalize()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_marked_count INTEGER := 0;
    v_emp RECORD;
    v_yesterday DATE;
BEGIN
    FOR v_emp IN
        SELECT
            e.id,
            COALESCE(e.timezone, o.timezone, 'UTC') AS eff_tz
        FROM public.employees e
        JOIN public.organizations o ON o.id = e.organization_id
        WHERE e.status = 'active'
          AND o.status IN ('active', 'trial')
    LOOP
        v_yesterday := ((pg_catalog.now() AT TIME ZONE COALESCE(v_emp.eff_tz, 'UTC'))::date - 1);

        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE employee_id = v_emp.id AND work_date = v_yesterday
        ) THEN
            PERFORM public.recalculate_day(v_emp.id, v_yesterday);
            v_marked_count := v_marked_count + 1;
        END IF;
    END LOOP;

    RETURN v_marked_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout() TO service_role;
REVOKE ALL ON FUNCTION public.cron_nightly_finalize() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_nightly_finalize() TO service_role;

-- ============================================================================
-- SECTION 6: Core Attendance & Regularization RPC Hardening + Unified Audits
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_in(
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_employee_id UUID;
    v_org_id UUID;
    v_allowed_methods TEXT[];
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_new_data JSONB;
BEGIN
    v_employee_id := (SELECT auth.uid());
    IF v_employee_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT e.organization_id, COALESCE(p.allowed_methods, '{"web"}'), COALESCE(e.timezone, o.timezone, 'UTC')
    INTO v_org_id, v_allowed_methods, v_effective_tz
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.attendance_policies p ON p.organization_id = e.organization_id
    WHERE e.id = v_employee_id;

    IF v_org_id IS NULL OR v_org_id IS DISTINCT FROM public.current_org_id() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee record not found');
    END IF;

    IF NOT ('web' = ANY(v_allowed_methods)) THEN
        RAISE EXCEPTION 'Direct web check-in is disabled for this organization. Physical verification required.';
    END IF;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE employee_id = v_employee_id AND work_date = v_work_date AND locked = TRUE
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attendance day is locked');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = v_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have an active open session');
    END IF;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, source, note
    ) VALUES (
        v_org_id, v_employee_id, v_work_date, pg_catalog.now(), 'web', p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(v_employee_id, v_work_date);

    v_new_data := jsonb_build_object('employee_id', v_employee_id, 'work_date', v_work_date, 'source', 'web', 'note', p_note);
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_org_id, v_employee_id, 'ATTENDANCE_CHECKED_IN', 'attendance_sessions', v_session_id, NULL, v_new_data);

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

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
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_target_org UUID;
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_id IS DISTINCT FROM p_employee_id THEN
        v_caller_role := public.current_user_role();
        IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized check-in attempt for another employee.');
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RETURN jsonb_build_object('success', false, 'error', 'MFA AAL2 verification required for administrative check-in override.');
        END IF;

        v_caller_org := public.current_org_id();
        SELECT organization_id INTO v_target_org FROM public.employees WHERE id = p_employee_id;

        IF v_target_org IS NULL OR v_caller_org IS NULL OR v_caller_org IS DISTINCT FROM v_target_org THEN
            RETURN jsonb_build_object('success', false, 'error', 'Target employee not found in your organization.');
        END IF;
    END IF;

    SELECT e.organization_id, COALESCE(e.timezone, o.timezone, 'UTC')
    INTO v_target_org, v_effective_tz
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    WHERE e.id = p_employee_id;

    IF v_target_org IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Target employee not found');
    END IF;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE employee_id = p_employee_id AND work_date = v_work_date AND locked = TRUE
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attendance day is locked');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee already has an active open session');
    END IF;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, source, note
    ) VALUES (
        v_target_org, p_employee_id, v_work_date, pg_catalog.now(), 'manual', p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(p_employee_id, v_work_date);

    v_new_data := jsonb_build_object('employee_id', p_employee_id, 'work_date', v_work_date, 'source', 'manual', 'note', p_note);
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_target_org, v_caller_id, 'ATTENDANCE_CHECK_IN_OVERRIDDEN', 'attendance_sessions', v_session_id, NULL, v_new_data);

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_out()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_employee_id UUID;
    v_session_id UUID;
    v_check_in_at TIMESTAMPTZ;
    v_org_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
    v_employee_id := (SELECT auth.uid());
    IF v_employee_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT id, check_in_at, organization_id INTO v_session_id, v_check_in_at, v_org_id
    FROM public.attendance_sessions
    WHERE employee_id = v_employee_id AND check_out_at IS NULL
    ORDER BY check_in_at DESC
    LIMIT 1;

    IF v_session_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active session found to check out');
    END IF;

    SELECT COALESCE(e.timezone, o.timezone, 'UTC')
    INTO v_effective_tz
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    WHERE e.id = v_employee_id;

    v_work_date := (v_check_in_at AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE employee_id = v_employee_id AND work_date = v_work_date AND locked = TRUE
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attendance day is locked');
    END IF;

    UPDATE public.attendance_sessions
    SET check_out_at = v_now
    WHERE id = v_session_id;

    PERFORM public.recalculate_day(v_employee_id, v_work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_org_id,
        v_employee_id,
        'ATTENDANCE_CHECKED_OUT',
        'attendance_sessions',
        v_session_id,
        jsonb_build_object('check_out_at', NULL, 'work_date', v_work_date),
        jsonb_build_object('check_out_at', v_now, 'work_date', v_work_date)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.punch_verified(
    p_employee_id UUID,
    p_source TEXT,
    p_location_id UUID DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
    v_emp_status TEXT;
    v_org_status TEXT;
    v_loc_org_id UUID;
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_work_mode TEXT;
BEGIN
    IF p_source NOT IN ('office_ip', 'rotating_qr', 'geofence', 'kiosk') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid verified source type');
    END IF;

    SELECT
        e.organization_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        e.status,
        o.status,
        l.organization_id
    INTO
        v_org_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_emp_status, v_org_status, v_loc_org_id
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = p_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee or Organization not found');
    END IF;

    IF COALESCE(v_emp_status, 'active') IS DISTINCT FROM 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee is inactive');
    END IF;

    IF v_org_status NOT IN ('active', 'trial') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Organization is not active');
    END IF;

    IF p_location_id IS NOT NULL AND (v_loc_org_id IS NULL OR v_loc_org_id IS DISTINCT FROM v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Location does not belong to employee organization');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee already has an active open session');
    END IF;

    v_effective_tz := CASE
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN
            CASE
                WHEN p_location_id IS NOT NULL OR p_source IN ('office_ip', 'rotating_qr', 'kiosk')
                THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_loc_tz, v_org_tz, 'UTC')
    END;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, location_id, work_date, check_in_at, source, note
    ) VALUES (
        v_org_id, p_employee_id, p_location_id, v_work_date, pg_catalog.now(), p_source, p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(p_employee_id, v_work_date);

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        p_employee_id,
        'ATTENDANCE_PUNCH_VERIFIED',
        'attendance_sessions',
        v_session_id,
        NULL,
        jsonb_build_object('source', p_source, 'location_id', p_location_id, 'work_date', v_work_date, 'note', p_note)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'work_date', v_work_date);
END;
$$;

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
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role IS NULL OR v_user_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can lock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to lock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = TRUE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month
      AND locked = FALSE;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'MONTH_LOCKED',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', false),
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', true, 'records_locked', v_count)
    );

    RETURN jsonb_build_object('success', true, 'records_locked', v_count);
END;
$$;

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
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
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
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', false, 'records_unlocked', v_count)
    );

    RETURN jsonb_build_object('success', true, 'records_unlocked', v_count);
END;
$$;

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

    -- Locked month check
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

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- SECTION 7: Hardened Leave Helpers & RPCs (0b, 0d, 0e)
-- ============================================================================
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
                WHERE organization_id = v_org_id AND date = v_curr
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

CREATE OR REPLACE FUNCTION public.get_organization_leave_period(
    p_organization_id UUID,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (period_start DATE, period_end DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_start_month INTEGER;
    v_year INTEGER;
    v_p_start DATE;
    v_p_end DATE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;
        IF p_organization_id IS DISTINCT FROM public.current_org_id() THEN
            RAISE EXCEPTION 'Cross-tenant violation: Organization does not match caller membership.' USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT leave_year_start_month INTO v_start_month
    FROM public.organizations
    WHERE id = p_organization_id;

    IF v_start_month IS NULL THEN
        v_start_month := 1;
    END IF;

    v_year := EXTRACT(YEAR FROM p_date)::INTEGER;

    IF EXTRACT(MONTH FROM p_date)::INTEGER < v_start_month THEN
        v_p_start := MAKE_DATE(v_year - 1, v_start_month, 1);
    ELSE
        v_p_start := MAKE_DATE(v_year, v_start_month, 1);
    END IF;

    v_p_end := (v_p_start + INTERVAL '1 year' - INTERVAL '1 day')::DATE;

    RETURN QUERY SELECT v_p_start, v_p_end;
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
        IF v_caller_role IS NULL OR v_caller_role = 'employee' THEN
            RAISE EXCEPTION 'Forbidden: Employees cannot approve leave requests.' USING ERRCODE = '42501';
        ELSIF v_caller_role = 'manager' THEN
            IF v_target_emp.manager_id IS DISTINCT FROM v_caller_id THEN
                RAISE EXCEPTION 'Forbidden: Managers can only approve leave for direct reports.' USING ERRCODE = '42501';
            END IF;
        ELSIF v_caller_role IN ('hr', 'admin') THEN
            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave approval.' USING ERRCODE = '42501';
            END IF;
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

    -- Synchronize attendance_days via recalculate_day() (no direct status writes)
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
    v_target_emp RECORD;
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

    SELECT * INTO v_target_emp FROM public.employees WHERE id = v_request.employee_id;

    IF v_caller_role IS NULL OR v_caller_role = 'employee' THEN
        RAISE EXCEPTION 'Forbidden: Employees cannot reject leave requests.' USING ERRCODE = '42501';
    ELSIF v_caller_role = 'manager' THEN
        IF v_target_emp.manager_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only reject leave for direct reports.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave rejection.' USING ERRCODE = '42501';
        END IF;
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

    -- Recalculate each day via recalculate_day() AFTER setting leave status='cancelled'
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

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'cancelled');
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_assign_leave(
    p_employee_ids UUID[],
    p_leave_type_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_day_part TEXT DEFAULT 'full',
    p_reason TEXT DEFAULT '',
    p_override_balance BOOLEAN DEFAULT FALSE
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
    v_emp_id UUID;
    v_total_days NUMERIC;
    v_p_start DATE;
    v_p_end DATE;
    v_balance RECORD;
    v_req_id UUID;
    v_assigned_count INTEGER := 0;
    v_curr DATE;
    v_locked BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can assign leave.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for assigning leave.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF v_caller_id = ANY(p_employee_ids) THEN
        RAISE EXCEPTION 'Separation of duties: HR and Admins cannot assign leave for themselves.' USING ERRCODE = '42501';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, p_start_date);

    FOREACH v_emp_id IN ARRAY p_employee_ids LOOP
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_emp_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Employee % does not belong to caller organization.', v_emp_id USING ERRCODE = '22023';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = v_caller_org
              AND employee_id = v_emp_id
              AND work_date BETWEEN p_start_date AND p_end_date
              AND locked = TRUE
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot assign leave for employee %: includes locked month dates.', v_emp_id USING ERRCODE = '22023';
        END IF;

        v_total_days := public.calculate_working_days(v_emp_id, p_start_date, p_end_date, p_day_part);
        IF v_total_days > 0 THEN
            IF NOT p_override_balance THEN
                SELECT * INTO v_balance
                FROM public.leave_balances
                WHERE organization_id = v_caller_org
                  AND employee_id = v_emp_id
                  AND leave_type_id = p_leave_type_id
                  AND period_start = v_p_start
                  AND period_end = v_p_end
                FOR UPDATE;

                IF v_balance IS NOT NULL AND (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_total_days THEN
                    RAISE EXCEPTION 'Insufficient balance for employee %: Available %, Requested %',
                        v_emp_id, (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used), v_total_days
                        USING ERRCODE = '22023';
                END IF;
            END IF;

            UPDATE public.leave_balances
            SET used = used + v_total_days,
                updated_at = pg_catalog.now()
            WHERE organization_id = v_caller_org
              AND employee_id = v_emp_id
              AND leave_type_id = p_leave_type_id
              AND period_start = v_p_start
              AND period_end = v_p_end;

            INSERT INTO public.leave_requests (
                organization_id, employee_id, leave_type_id, start_date, end_date,
                day_part, total_days, reason, status, reviewed_by, reviewed_at
            ) VALUES (
                v_caller_org, v_emp_id, p_leave_type_id, p_start_date, p_end_date,
                p_day_part, v_total_days, p_reason, 'approved', v_caller_id, pg_catalog.now()
            ) RETURNING id INTO v_req_id;

            -- Sync attendance_days via recalculate_day()
            v_curr := p_start_date;
            WHILE v_curr <= p_end_date LOOP
                PERFORM public.recalculate_day(v_emp_id, v_curr);
                v_curr := v_curr + 1;
            END LOOP;

            INSERT INTO public.audit_logs (
                organization_id, actor_id, action, table_name, record_id, old_data, new_data
            ) VALUES (
                v_caller_org, v_caller_id, 'LEAVE_ASSIGNED', 'leave_requests', v_req_id,
                NULL,
                jsonb_build_object(
                    'employee_id', v_emp_id,
                    'leave_type_id', p_leave_type_id,
                    'start_date', p_start_date,
                    'end_date', p_end_date,
                    'total_days', v_total_days,
                    'assigned_by', v_caller_id
                )
            );

            v_assigned_count := v_assigned_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'assigned_count', v_assigned_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.hr_adjust_balance(
    p_employee_id UUID,
    p_leave_type_id UUID,
    p_amount NUMERIC,
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
    v_p_start DATE;
    v_p_end DATE;
    v_bal_id UUID;
    v_adj_id UUID;
    v_old_adj NUMERIC := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can adjust leave balances.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to adjust leave balances.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: HR and Admins cannot adjust their own leave balance.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Employee does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, CURRENT_DATE);

    SELECT id, adjusted INTO v_bal_id, v_old_adj
    FROM public.leave_balances
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND leave_type_id = p_leave_type_id
      AND period_start = v_p_start
      AND period_end = v_p_end
    FOR UPDATE;

    IF v_bal_id IS NULL THEN
        INSERT INTO public.leave_balances (
            organization_id, employee_id, leave_type_id, period_start, period_end, allocated, adjusted
        ) VALUES (
            v_caller_org, p_employee_id, p_leave_type_id, v_p_start, v_p_end, 0, p_amount
        ) RETURNING id INTO v_bal_id;
    ELSE
        UPDATE public.leave_balances
        SET adjusted = adjusted + p_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_bal_id;
    END IF;

    INSERT INTO public.leave_balance_adjustments (
        organization_id, employee_id, leave_type_id, adjusted_by, amount, reason
    ) VALUES (
        v_caller_org, p_employee_id, p_leave_type_id, v_caller_id, p_amount, p_reason
    ) RETURNING id INTO v_adj_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_BALANCE_ADJUSTED', 'leave_balances', v_bal_id,
        jsonb_build_object('adjusted', v_old_adj),
        jsonb_build_object('adjusted', v_old_adj + p_amount, 'adjustment_amount', p_amount, 'reason', p_reason)
    );

    RETURN jsonb_build_object('success', true, 'balance_id', v_bal_id, 'new_adjustment', v_old_adj + p_amount);
END;
$$;

CREATE OR REPLACE FUNCTION public.allocate_yearly_balances(
    p_organization_id UUID DEFAULT NULL,
    p_year INTEGER DEFAULT NULL
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
    v_target_org UUID;
    v_org RECORD;
    v_emp RECORD;
    v_policy RECORD;
    v_p_start DATE;
    v_p_end DATE;
    v_hire_date DATE;
    v_months_remaining NUMERIC;
    v_quota NUMERIC;
    v_carry_fwd NUMERIC;
    v_prev_bal RECORD;
    v_allocated_count INTEGER := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());

    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;

        v_caller_role := public.current_user_role();
        v_caller_org := public.current_org_id();

        IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Forbidden: Only HR and Admins can allocate yearly balances.' USING ERRCODE = '42501';
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for allocating balances.' USING ERRCODE = '42501';
        END IF;

        v_target_org := COALESCE(p_organization_id, v_caller_org);
        IF v_target_org IS DISTINCT FROM v_caller_org THEN
            RAISE EXCEPTION 'Cannot allocate balances for another organization.' USING ERRCODE = '42501';
        END IF;
    ELSE
        v_target_org := p_organization_id;
    END IF;

    FOR v_org IN SELECT * FROM public.organizations WHERE (v_target_org IS NULL OR id = v_target_org) LOOP
        SELECT period_start, period_end INTO v_p_start, v_p_end
        FROM public.get_organization_leave_period(v_org.id, CURRENT_DATE);

        FOR v_emp IN SELECT * FROM public.employees WHERE organization_id = v_org.id AND status = 'active' LOOP
            FOR v_policy IN SELECT * FROM public.leave_policies WHERE organization_id = v_org.id LOOP
                v_hire_date := v_emp.created_at::DATE;
                IF v_hire_date > v_p_start AND v_hire_date <= v_p_end THEN
                    v_months_remaining := LEAST(12, GREATEST(1, (EXTRACT(YEAR FROM v_p_end) - EXTRACT(YEAR FROM v_hire_date))::INTEGER * 12 + (EXTRACT(MONTH FROM v_p_end) - EXTRACT(MONTH FROM v_hire_date))::INTEGER + 1));
                    v_quota := ROUND((v_policy.yearly_quota * (v_months_remaining / 12.0)), 1);
                ELSE
                    v_quota := v_policy.yearly_quota;
                END IF;

                v_carry_fwd := 0;
                IF v_policy.carry_forward_max > 0 THEN
                    SELECT * INTO v_prev_bal
                    FROM public.leave_balances
                    WHERE organization_id = v_org.id
                      AND employee_id = v_emp.id
                      AND leave_type_id = v_policy.leave_type_id
                      AND period_end = (v_p_start - INTERVAL '1 day')::DATE;

                    IF v_prev_bal IS NOT NULL THEN
                        v_carry_fwd := LEAST(
                            v_policy.carry_forward_max,
                            GREATEST(0, (v_prev_bal.allocated + v_prev_bal.carried_forward + v_prev_bal.adjusted - v_prev_bal.used))
                        );
                    END IF;
                END IF;

                INSERT INTO public.leave_balances (
                    organization_id, employee_id, leave_type_id, period_start, period_end,
                    allocated, carried_forward, used, adjusted
                ) VALUES (
                    v_org.id, v_emp.id, v_policy.leave_type_id, v_p_start, v_p_end,
                    v_quota, v_carry_fwd, 0, 0
                )
                ON CONFLICT (organization_id, employee_id, leave_type_id, period_start, period_end)
                DO UPDATE SET allocated = EXCLUDED.allocated,
                              carried_forward = EXCLUDED.carried_forward,
                              updated_at = pg_catalog.now();

                v_allocated_count := v_allocated_count + 1;
            END LOOP;
        END LOOP;
    END LOOP;

    IF v_caller_id IS NOT NULL THEN
        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_target_org, v_caller_id, 'LEAVE_BALANCES_ALLOCATED', 'leave_balances', v_target_org,
            NULL, jsonb_build_object('allocated_count', v_allocated_count, 'year', p_year)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'allocated_count', v_allocated_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.declare_company_day_off(
    p_date DATE,
    p_title TEXT,
    p_department_id UUID DEFAULT NULL
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
    v_off_id UUID;
    v_emp RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can declare company days off.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to declare company days off.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_department_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_department_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Department does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO public.company_days_off (
        organization_id, department_id, date, title, declared_by
    ) VALUES (
        v_caller_org, p_department_id, p_date, p_title, v_caller_id
    ) RETURNING id INTO v_off_id;

    -- Mirror into holidays only for organization-wide declarations
    IF p_department_id IS NULL THEN
        INSERT INTO public.holidays (
            organization_id, date, name, region
        ) VALUES (
            v_caller_org, p_date, p_title, 'COMPANY_DAY_OFF'
        ) ON CONFLICT (organization_id, date) DO UPDATE SET name = EXCLUDED.name;
    END IF;

    -- Recalculate unlocked days for affected employees if day already materialized or in the past/today
    FOR v_emp IN
        SELECT e.id, COALESCE(e.timezone, o.timezone, 'UTC') AS eff_tz
        FROM public.employees e
        JOIN public.organizations o ON o.id = e.organization_id
        WHERE e.organization_id = v_caller_org
          AND e.status = 'active'
          AND (p_department_id IS NULL OR e.department_id = p_department_id)
    LOOP
        IF p_date <= (pg_catalog.now() AT TIME ZONE COALESCE(v_emp.eff_tz, 'UTC'))::date
           OR EXISTS (SELECT 1 FROM public.attendance_days WHERE employee_id = v_emp.id AND work_date = p_date AND locked = FALSE) THEN
            PERFORM public.recalculate_day(v_emp.id, p_date);
        END IF;
    END LOOP;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'COMPANY_DAY_OFF_DECLARED', 'company_days_off', v_off_id,
        NULL,
        jsonb_build_object('date', p_date, 'title', p_title, 'department_id', p_department_id)
    );

    RETURN jsonb_build_object('success', true, 'day_off_id', v_off_id);
END;
$$;

-- ============================================================================
-- SECTION 8: Membership & Admin Governance RPC Active-Membership Enforcement (0b, 0d)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_add_org_member(
    p_organization_id UUID,
    p_user_id UUID,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can add organization members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    IF p_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = p_user_id AND organization_id IS DISTINCT FROM v_caller_org
    ) THEN
        RAISE EXCEPTION 'Cross-tenant violation: Target user belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_caller_org, p_user_id, p_role, 'active')
    ON CONFLICT (user_id) DO UPDATE
    SET role = p_role, status = 'active', updated_at = pg_catalog.now()
    WHERE public.organization_members.organization_id = v_caller_org;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_ADDED', 'organization_members', p_user_id,
        NULL, jsonb_build_object('user_id', p_user_id, 'role', p_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_org_member_role(
    p_organization_id UUID,
    p_user_id UUID,
    p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can update member roles.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    IF p_new_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_new_role;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_current_role
    FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id AND status = 'active';

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    IF v_current_role = 'admin' AND p_new_role != 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot demote yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot demote the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    UPDATE public.organization_members
    SET role = p_new_role, updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_ROLE_UPDATED', 'organization_members', p_user_id,
        jsonb_build_object('user_id', p_user_id, 'role', v_current_role),
        jsonb_build_object('user_id', p_user_id, 'old_role', v_current_role, 'new_role', p_new_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_org_member(
    p_organization_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can remove organization members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role, to_jsonb(m.*) INTO v_current_role, v_old_data
    FROM public.organization_members m
    WHERE m.organization_id = v_caller_org AND m.user_id = p_user_id;

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    IF v_current_role = 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot remove yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot remove the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    DELETE FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_REMOVED', 'organization_members', p_user_id,
        v_old_data,
        jsonb_build_object('user_id', p_user_id, 'removed_role', v_current_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_employee(
    p_employee_id UUID,
    p_manager_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_work_mode TEXT DEFAULT NULL,
    p_primary_location_id UUID DEFAULT NULL,
    p_work_target_minutes INTEGER DEFAULT NULL,
    p_expected_office_days INTEGER[] DEFAULT NULL,
    p_required_office_days_per_week INTEGER DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_org UUID;
    v_caller_aal TEXT;
    v_emp RECORD;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and administrators can update employee governance attributes.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for employee administrative updates.';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT * INTO v_emp
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_emp.id IS NULL THEN
        RAISE EXCEPTION 'Employee not found.';
    END IF;

    IF v_emp.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Target employee belongs to another organization.';
    END IF;

    IF p_primary_location_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.locations
            WHERE id = p_primary_location_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Invalid primary_location_id: Location does not belong to this organization.';
        END IF;
    END IF;

    IF p_manager_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.employees
            WHERE id = p_manager_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Invalid manager_id: Manager does not belong to this organization.';
        END IF;
    END IF;

    v_old_data := to_jsonb(v_emp);

    UPDATE public.employees
    SET
        manager_id = COALESCE(p_manager_id, manager_id),
        status = COALESCE(p_status, status),
        work_mode = COALESCE(p_work_mode, work_mode),
        primary_location_id = COALESCE(p_primary_location_id, primary_location_id),
        work_target_minutes = COALESCE(p_work_target_minutes, work_target_minutes),
        expected_office_days = COALESCE(p_expected_office_days, expected_office_days),
        required_office_days_per_week = COALESCE(p_required_office_days_per_week, required_office_days_per_week),
        timezone = COALESCE(p_timezone, timezone),
        updated_at = pg_catalog.now()
    WHERE id = p_employee_id
    RETURNING to_jsonb(employees.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'EMPLOYEE_UPDATED', 'employees', p_employee_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_employee_governance(
    p_employee_id UUID,
    p_full_name TEXT DEFAULT NULL,
    p_department_id UUID DEFAULT NULL,
    p_manager_id UUID DEFAULT NULL,
    p_work_mode TEXT DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL,
    p_primary_location_id UUID DEFAULT NULL,
    p_work_target_minutes INTEGER DEFAULT NULL,
    p_expected_office_days INTEGER[] DEFAULT NULL,
    p_required_office_days_per_week INTEGER DEFAULT NULL,
    p_status TEXT DEFAULT NULL
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
    v_emp_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can modify employee governance.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for administrative updates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(e.*)
    INTO v_emp_org, v_old_data
    FROM public.employees e
    WHERE id = p_employee_id;

    IF v_emp_org IS NULL OR v_emp_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Employee not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF p_department_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_department_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Department does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_manager_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_manager_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Manager does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_primary_location_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.locations WHERE id = p_primary_location_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Location does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.employees
    SET
        full_name = COALESCE(p_full_name, full_name),
        department_id = CASE WHEN p_department_id IS NOT NULL THEN p_department_id ELSE department_id END,
        manager_id = CASE WHEN p_manager_id IS NOT NULL THEN p_manager_id ELSE manager_id END,
        work_mode = COALESCE(p_work_mode, work_mode),
        timezone = COALESCE(p_timezone, timezone),
        primary_location_id = CASE WHEN p_primary_location_id IS NOT NULL THEN p_primary_location_id ELSE primary_location_id END,
        work_target_minutes = COALESCE(p_work_target_minutes, work_target_minutes),
        expected_office_days = COALESCE(p_expected_office_days, expected_office_days),
        required_office_days_per_week = COALESCE(p_required_office_days_per_week, required_office_days_per_week),
        status = COALESCE(p_status, status),
        updated_at = pg_catalog.now()
    WHERE id = p_employee_id
    RETURNING to_jsonb(employees.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'EMPLOYEE_UPDATED', 'employees', p_employee_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'employee_id', p_employee_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_deactivate_member(
    p_user_id UUID
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
    v_target_role TEXT;
    v_target_org UUID;
    v_admin_count INTEGER;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can deactivate members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for member deactivation.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('org_members_' || v_caller_org::text));

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT organization_id, role, to_jsonb(m.*)
    INTO v_target_org, v_target_role, v_old_data
    FROM public.organization_members m
    WHERE user_id = p_user_id;

    IF v_target_org IS NULL OR v_target_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Member not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_target_role = 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Last admin protection: Cannot deactivate the sole active administrator.' USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE public.organization_members
    SET status = 'suspended', updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    UPDATE public.employees
    SET status = 'inactive', updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND id = p_user_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'MEMBER_DEACTIVATED', 'organization_members', p_user_id, v_old_data, jsonb_build_object('status', 'suspended')
    );

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_department(
    p_name TEXT,
    p_code TEXT,
    p_department_head_id UUID DEFAULT NULL,
    p_parent_department_id UUID DEFAULT NULL
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
    v_dept_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can create departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_department_head_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_department_head_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Department head does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_parent_department_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_parent_department_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Parent department does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO public.departments (
        organization_id, name, code, department_head_id, parent_department_id
    ) VALUES (
        v_caller_org, p_name, p_code, p_department_head_id, p_parent_department_id
    ) RETURNING id INTO v_dept_id;

    v_new_data := jsonb_build_object(
        'name', p_name, 'code', p_code,
        'department_head_id', p_department_head_id,
        'parent_department_id', p_parent_department_id
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'DEPARTMENT_CREATED', 'departments', v_dept_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'department_id', v_dept_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_department(
    p_department_id UUID,
    p_name TEXT,
    p_code TEXT,
    p_department_head_id UUID DEFAULT NULL,
    p_parent_department_id UUID DEFAULT NULL
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
    v_dept_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can update departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(d.*)
    INTO v_dept_org, v_old_data
    FROM public.departments d
    WHERE id = p_department_id;

    IF v_dept_org IS NULL OR v_dept_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Department not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF p_department_head_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_department_head_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Department head does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_parent_department_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_parent_department_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Parent department does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.departments
    SET name = p_name,
        code = p_code,
        department_head_id = p_department_head_id,
        parent_department_id = p_parent_department_id,
        updated_at = pg_catalog.now()
    WHERE id = p_department_id
    RETURNING to_jsonb(departments.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'DEPARTMENT_UPDATED', 'departments', p_department_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'department_id', p_department_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_department(
    p_department_id UUID
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
    v_dept_org UUID;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can delete departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(d.*)
    INTO v_dept_org, v_old_data
    FROM public.departments d
    WHERE id = p_department_id;

    IF v_dept_org IS NULL OR v_dept_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Department not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    UPDATE public.departments SET parent_department_id = NULL WHERE parent_department_id = p_department_id;
    UPDATE public.employees SET department_id = NULL WHERE department_id = p_department_id;
    DELETE FROM public.departments WHERE id = p_department_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'DEPARTMENT_DELETED', 'departments', p_department_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'department_id', p_department_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_location(
    p_name TEXT,
    p_code TEXT,
    p_address TEXT DEFAULT NULL,
    p_timezone TEXT DEFAULT 'UTC',
    p_working_hours INTEGER DEFAULT 480,
    p_weekly_off_days INTEGER[] DEFAULT '{0, 6}'
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
    v_loc_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can create locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    INSERT INTO public.locations (
        organization_id, name, code, address, timezone, working_hours, weekly_off_days
    ) VALUES (
        v_caller_org, p_name, p_code, p_address, p_timezone, p_working_hours, p_weekly_off_days
    ) RETURNING id INTO v_loc_id;

    v_new_data := jsonb_build_object(
        'name', p_name, 'code', p_code, 'address', p_address,
        'timezone', p_timezone, 'working_hours', p_working_hours, 'weekly_off_days', p_weekly_off_days
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LOCATION_CREATED', 'locations', v_loc_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'location_id', v_loc_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_location(
    p_location_id UUID,
    p_name TEXT,
    p_address TEXT DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL,
    p_working_hours INTEGER DEFAULT NULL,
    p_weekly_off_days INTEGER[] DEFAULT NULL
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
    v_loc_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(l.*)
    INTO v_loc_org, v_old_data
    FROM public.locations l
    WHERE id = p_location_id;

    IF v_loc_org IS NULL OR v_loc_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Location not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    UPDATE public.locations
    SET name = p_name,
        address = COALESCE(p_address, address),
        timezone = COALESCE(p_timezone, timezone),
        working_hours = COALESCE(p_working_hours, working_hours),
        weekly_off_days = COALESCE(p_weekly_off_days, weekly_off_days),
        updated_at = pg_catalog.now()
    WHERE id = p_location_id
    RETURNING to_jsonb(locations.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LOCATION_UPDATED', 'locations', p_location_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'location_id', p_location_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_location(
    p_location_id UUID
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
    v_loc_org UUID;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can delete locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(l.*)
    INTO v_loc_org, v_old_data
    FROM public.locations l
    WHERE id = p_location_id;

    IF v_loc_org IS NULL OR v_loc_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Location not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    UPDATE public.employees SET primary_location_id = NULL WHERE primary_location_id = p_location_id;
    DELETE FROM public.locations WHERE id = p_location_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LOCATION_DELETED', 'locations', p_location_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'location_id', p_location_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_create_shift_template(
    p_name TEXT,
    p_code TEXT,
    p_start_time TIME,
    p_end_time TIME,
    p_break_minutes INTEGER DEFAULT 60,
    p_grace_minutes INTEGER DEFAULT 15
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
    v_shift_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can create shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    INSERT INTO public.shift_templates (
        organization_id, name, code, start_time, end_time, break_duration_minutes, grace_minutes
    ) VALUES (
        v_caller_org, p_name, p_code, p_start_time, p_end_time, p_break_minutes, p_grace_minutes
    ) RETURNING id INTO v_shift_id;

    v_new_data := jsonb_build_object(
        'name', p_name, 'code', p_code,
        'start_time', p_start_time, 'end_time', p_end_time,
        'break_minutes', p_break_minutes, 'grace_minutes', p_grace_minutes
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_CREATED', 'shift_templates', v_shift_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'shift_template_id', v_shift_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_shift_template(
    p_shift_id UUID,
    p_name TEXT,
    p_start_time TIME,
    p_end_time TIME,
    p_break_minutes INTEGER DEFAULT 60,
    p_grace_minutes INTEGER DEFAULT 15
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
    v_shift_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(s.*)
    INTO v_shift_org, v_old_data
    FROM public.shift_templates s
    WHERE id = p_shift_id;

    IF v_shift_org IS NULL OR v_shift_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Shift template not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    UPDATE public.shift_templates
    SET name = p_name,
        start_time = p_start_time,
        end_time = p_end_time,
        break_duration_minutes = p_break_minutes,
        grace_minutes = p_grace_minutes
    WHERE id = p_shift_id
    RETURNING to_jsonb(shift_templates.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_UPDATED', 'shift_templates', p_shift_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'shift_template_id', p_shift_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_shift_template(
    p_shift_id UUID
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
    v_shift_org UUID;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can delete shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(s.*)
    INTO v_shift_org, v_old_data
    FROM public.shift_templates s
    WHERE id = p_shift_id;

    IF v_shift_org IS NULL OR v_shift_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Shift template not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    DELETE FROM public.employee_shift_assignments WHERE shift_template_id = p_shift_id;
    DELETE FROM public.shift_templates WHERE id = p_shift_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_DELETED', 'shift_templates', p_shift_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'shift_template_id', p_shift_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_shift(
    p_employee_id UUID,
    p_shift_template_id UUID,
    p_effective_from DATE,
    p_effective_to DATE DEFAULT NULL
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
    v_assignment_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can assign shifts.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to assign shifts.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Employee does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.shift_templates WHERE id = p_shift_template_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Shift template does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.employee_shift_assignments
    SET effective_to = p_effective_from - 1
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND (effective_to IS NULL OR effective_to >= p_effective_from)
      AND effective_from < p_effective_from;

    DELETE FROM public.employee_shift_assignments
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND effective_from >= p_effective_from;

    INSERT INTO public.employee_shift_assignments (
        organization_id, employee_id, shift_template_id, effective_from, effective_to
    ) VALUES (
        v_caller_org, p_employee_id, p_shift_template_id, p_effective_from, p_effective_to
    ) RETURNING id INTO v_assignment_id;

    v_new_data := jsonb_build_object(
        'employee_id', p_employee_id,
        'shift_template_id', p_shift_template_id,
        'effective_from', p_effective_from,
        'effective_to', p_effective_to
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_ASSIGNED', 'employee_shift_assignments', v_assignment_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'assignment_id', v_assignment_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_organization_settings(
    p_name TEXT,
    p_timezone TEXT,
    p_work_mode TEXT
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
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update organization settings.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update organization settings.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_work_mode NOT IN ('remote', 'office', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work mode: %', p_work_mode USING ERRCODE = '22023';
    END IF;

    SELECT to_jsonb(o.*) INTO v_old_data FROM public.organizations o WHERE id = v_caller_org;

    UPDATE public.organizations
    SET name = p_name,
        timezone = p_timezone,
        work_mode = p_work_mode,
        updated_at = pg_catalog.now()
    WHERE id = v_caller_org
    RETURNING to_jsonb(organizations.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'ORGANIZATION_UPDATED', 'organizations', v_caller_org, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'organization_id', v_caller_org);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_attendance_policy(
    p_grace_minutes INTEGER,
    p_half_day_minutes INTEGER,
    p_auto_checkout_time TIME
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
    v_old_data JSONB;
    v_new_data JSONB;
    v_policy_id UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update attendance policy.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update attendance policy.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT id, to_jsonb(p.*) INTO v_policy_id, v_old_data
    FROM public.attendance_policies p
    WHERE organization_id = v_caller_org;

    IF v_policy_id IS NULL THEN
        INSERT INTO public.attendance_policies (
            organization_id, grace_minutes, half_day_minutes, auto_checkout_time
        ) VALUES (
            v_caller_org, p_grace_minutes, p_half_day_minutes, p_auto_checkout_time
        ) RETURNING id, to_jsonb(attendance_policies.*) INTO v_policy_id, v_new_data;
    ELSE
        UPDATE public.attendance_policies
        SET grace_minutes = p_grace_minutes,
            half_day_minutes = p_half_day_minutes,
            auto_checkout_time = p_auto_checkout_time,
            updated_at = pg_catalog.now()
        WHERE id = v_policy_id
        RETURNING to_jsonb(attendance_policies.*) INTO v_new_data;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'POLICY_UPDATED', 'attendance_policies', v_policy_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'policy_id', v_policy_id);
END;
$$;

