-- ============================================================================
-- Migration: 20261128000003_employment_date_attendance_repairs.sql
-- Purpose:
--   1. Prevent recalculate_day() and cron_nightly_finalize() from writing
--      'absent', 'weekend', or 'holiday' attendance_days rows prior to an
--      employee's joined_on date (or after deactivated/exited date when no punch).
--   2. Preserve cross-midnight shift boundaries in recalculate_day() late
--      checks and local_today resolution.
--   3. Provide a durable, audited review workflow (attendance_repair_proposals
--      + scan_pre_hire_absent_records + review_pre_hire_attendance_repair) to
--      identify historical pre-hire absences and reviewably repair locked
--      payroll periods without silent destructive mutations.
-- ============================================================================

-- 1. Repair Proposal Table for Locked Payroll Period Pre-Hire Absences
CREATE TABLE IF NOT EXISTS public.attendance_repair_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    original_status TEXT NOT NULL,
    original_total_minutes INTEGER NOT NULL DEFAULT 0,
    original_locked BOOLEAN NOT NULL DEFAULT FALSE,
    employee_joined_on DATE NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    proposed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    reviewed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_att_repair_pending_unique
    ON public.attendance_repair_proposals (employee_id, work_date)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_att_repair_org_status
    ON public.attendance_repair_proposals (organization_id, status, work_date DESC);

ALTER TABLE public.attendance_repair_proposals ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.attendance_repair_proposals FROM PUBLIC, anon;
GRANT SELECT ON public.attendance_repair_proposals TO authenticated;

DO $$
BEGIN
    DROP POLICY IF EXISTS "attendance_repair_proposals_select" ON public.attendance_repair_proposals;
    CREATE POLICY "attendance_repair_proposals_select"
        ON public.attendance_repair_proposals
        FOR SELECT TO authenticated
        USING (
            organization_id = (SELECT public.current_org_id())
            AND (SELECT public.is_active_org_member())
            AND (SELECT public.current_user_role()) IN ('hr', 'admin')
            AND (SELECT public.aal2_ok())
        );
END $$;

-- 2. Update recalculate_day() to enforce joined_on & accurate cross-midnight late checks
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
    v_local_now TIMESTAMP;
    v_local_today DATE;
    v_local_time TIME;
    v_is_locked BOOLEAN := FALSE;
    v_has_full_leave BOOLEAN := FALSE;
    v_has_first_half BOOLEAN := FALSE;
    v_has_second_half BOOLEAN := FALSE;
    v_member_start TIME;
    v_member_end TIME;
    v_joined_on DATE;
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
        l.weekly_off_days,
        COALESCE(om.shift_start_time, e.shift_start_time, '09:00:00'::time),
        COALESCE(om.shift_end_time, e.shift_end_time, '17:00:00'::time),
        e.joined_on
    INTO
        v_org_id, v_dept_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_target_minutes,
        v_loc_weekly_offs, v_member_start, v_member_end, v_joined_on
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.organization_members om ON om.user_id = e.id AND om.organization_id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id
          AND work_date = p_work_date
          AND (location_id IS NOT NULL OR source IN ('office_ip', 'rotating_qr', 'kiosk'))
    ) THEN
        v_work_location := 'office';
    ELSE
        v_work_location := 'remote';
    END IF;

    v_effective_tz := CASE
        WHEN v_work_mode = 'remote' THEN COALESCE(NULLIF(v_emp_tz, ''), v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(NULLIF(v_loc_tz, ''), v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN
            CASE
                WHEN v_work_location = 'office' THEN COALESCE(NULLIF(v_loc_tz, ''), v_org_tz, 'UTC')
                ELSE COALESCE(NULLIF(v_emp_tz, ''), v_org_tz, 'UTC')
            END
        ELSE COALESCE(NULLIF(v_emp_tz, ''), v_org_tz, 'UTC')
    END;

    v_local_now := pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC');
    v_local_today := v_local_now::date;
    v_local_time := v_local_now::time;
    IF v_member_end < v_member_start AND v_local_time <= v_member_end THEN
        v_local_today := v_local_today - 1;
    END IF;

    SELECT * INTO v_policy
    FROM public.attendance_policies
    WHERE organization_id = v_org_id
      AND is_active = TRUE
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 1;

    IF v_policy IS NULL THEN
        SELECT * INTO v_policy
        FROM public.attendance_policies
        WHERE organization_id = v_org_id
        LIMIT 1;
    END IF;

    -- Collect sessions matching either explicit work_date (supports cross-midnight shifts)
    -- or local check-in calendar date
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
      AND (
          work_date = p_work_date
          OR (work_date IS NULL AND (check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date)
      );

    -- Guard: Never persist pre-hire absent/weekend/holiday rows when no session exists before joined_on
    IF v_sessions_count = 0 AND v_joined_on IS NOT NULL AND p_work_date < v_joined_on THEN
        DELETE FROM public.attendance_days
        WHERE employee_id = p_employee_id
          AND work_date = p_work_date
          AND locked = FALSE
          AND status = 'absent'
          AND total_minutes = 0;
        RETURN;
    END IF;

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
            v_expected_start TIME := COALESCE(v_member_start, v_policy.shift_start_time, '09:00:00'::time);
            v_grace INTEGER := COALESCE(v_policy.grace_minutes, 15);
            v_actual_ts TIMESTAMP := v_first_in AT TIME ZONE v_effective_tz;
            v_expected_ts TIMESTAMP := (p_work_date::timestamp + v_expected_start);
        BEGIN
            IF v_actual_ts > (v_expected_ts + (v_grace || ' minutes')::interval) THEN
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

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'attendance_records'
    ) THEN
        UPDATE public.attendance_records
        SET is_late = v_is_late,
            updated_at = pg_catalog.now()
        WHERE user_id = p_employee_id AND work_date = p_work_date;
    END IF;

    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_day(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_day(UUID, DATE) TO service_role;

-- 3. Update cron_nightly_finalize() to intersect with employees.joined_on
CREATE OR REPLACE FUNCTION public.cron_nightly_finalize(
    p_now TIMESTAMPTZ DEFAULT pg_catalog.now()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := COALESCE(p_now, pg_catalog.now());
    v_nil_loc CONSTANT UUID := '00000000-0000-0000-0000-000000000000'::uuid;
    v_finalize_cutoff CONSTANT TIME := TIME '01:00:00';
    v_marked_count INTEGER := 0;
    v_org RECORD;
    v_scope RECORD;
    v_emp RECORD;
    v_local_now TIMESTAMP;
    v_local_date DATE;
    v_local_time TIME;
    v_target_date DATE;
    v_org_marked INTEGER := 0;
    v_scope_marked INTEGER := 0;
    v_err TEXT;
BEGIN
    FOR v_org IN
        SELECT
            o.id,
            COALESCE(o.work_mode, 'remote') AS work_mode,
            COALESCE(NULLIF(o.timezone, ''), 'UTC') AS timezone
        FROM public.organizations o
        WHERE o.status IN ('active', 'trial')
        ORDER BY o.created_at ASC, o.id ASC
    LOOP
        v_org_marked := 0;

        BEGIN
            FOR v_scope IN
                SELECT DISTINCT scope.loc_key, scope.eff_tz
                FROM (
                    SELECT v_nil_loc AS loc_key, v_org.timezone AS eff_tz
                    UNION
                    SELECT l.id AS loc_key, COALESCE(NULLIF(l.timezone, ''), v_org.timezone, 'UTC') AS eff_tz
                    FROM public.locations l
                    WHERE l.organization_id = v_org.id
                      AND l.is_active = TRUE
                    UNION
                    SELECT
                        CASE
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(e.primary_location_id, v_nil_loc)
                            ELSE v_nil_loc
                        END AS loc_key,
                        CASE
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                            ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                        END AS eff_tz
                    FROM public.employees e
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE e.organization_id = v_org.id
                      AND e.status = 'active'
                ) scope
                ORDER BY scope.loc_key, scope.eff_tz
            LOOP
                v_scope_marked := 0;
                v_local_now := v_now AT TIME ZONE v_scope.eff_tz;
                v_local_date := v_local_now::date;
                v_local_time := v_local_now::time;

                -- Only finalize yesterday once local time passes 01:00 AM policy finalize window
                IF v_local_time < v_finalize_cutoff THEN
                    CONTINUE;
                END IF;

                v_target_date := v_local_date - 1;

                IF EXISTS (
                    SELECT 1 FROM public.cron_run_state crs
                    WHERE crs.job_name = 'nightly_finalize'
                      AND crs.organization_id = v_org.id
                      AND crs.location_id = v_scope.loc_key
                      AND crs.timezone_key = v_scope.eff_tz
                      AND crs.target_date = v_target_date
                      AND crs.status = 'success'
                ) THEN
                    CONTINUE;
                END IF;

                FOR v_emp IN
                    SELECT e.id
                    FROM public.employees e
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE e.organization_id = v_org.id
                      AND e.status = 'active'
                      AND (e.joined_on IS NULL OR e.joined_on <= v_target_date)
                      AND (
                          CASE
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(e.primary_location_id, v_nil_loc)
                              ELSE v_nil_loc
                          END
                      ) = v_scope.loc_key
                      AND (
                          CASE
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                              ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                          END
                      ) = v_scope.eff_tz
                LOOP
                    IF NOT EXISTS (
                        SELECT 1 FROM public.attendance_days d
                        WHERE d.organization_id = v_org.id
                          AND d.employee_id = v_emp.id
                          AND d.work_date = v_target_date
                    ) THEN
                        PERFORM public.recalculate_day(v_emp.id, v_target_date);
                        v_scope_marked := v_scope_marked + 1;
                        v_org_marked := v_org_marked + 1;
                    END IF;
                END LOOP;

                INSERT INTO public.cron_run_state (
                    job_name, organization_id, location_id, timezone_key, target_date,
                    status, error_message, processed_count, executed_at
                ) VALUES (
                    'nightly_finalize', v_org.id, v_scope.loc_key, v_scope.eff_tz, v_target_date,
                    'success', NULL, v_scope_marked, v_now
                )
                ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
                SET status = 'success',
                    error_message = NULL,
                    processed_count = EXCLUDED.processed_count,
                    executed_at = EXCLUDED.executed_at
                WHERE public.cron_run_state.status IS DISTINCT FROM 'success';
            END LOOP;

            v_marked_count := v_marked_count + v_org_marked;
        EXCEPTION WHEN OTHERS THEN
            v_err := SQLERRM;
            INSERT INTO public.cron_run_state (
                job_name, organization_id, location_id, timezone_key, target_date,
                status, error_message, processed_count, executed_at
            ) VALUES (
                'nightly_finalize', v_org.id, v_nil_loc, v_org.timezone,
                (v_now AT TIME ZONE 'UTC')::date, 'failed', v_err, 0, v_now
            )
            ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
            SET status = CASE WHEN public.cron_run_state.status = 'success' THEN 'success' ELSE 'failed' END,
                error_message = COALESCE(EXCLUDED.error_message, public.cron_run_state.error_message),
                executed_at = EXCLUDED.executed_at;
        END;
    END LOOP;

    RETURN v_marked_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_nightly_finalize(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_nightly_finalize(TIMESTAMPTZ) TO service_role;

-- 4. Identify & Reviewably Repair Historical Pre-Hire Absences (including Locked Payroll Days)
CREATE OR REPLACE FUNCTION public.scan_pre_hire_absent_records(
    p_organization_id UUID DEFAULT NULL,
    p_stage_repairs BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := (SELECT auth.uid());
    v_role TEXT := public.current_user_role();
    v_caller_org UUID := public.current_org_id();
    v_target_org UUID;
    v_rec RECORD;
    v_total INTEGER := 0;
    v_unlocked_cleaned INTEGER := 0;
    v_locked_staged INTEGER := 0;
    v_rows JSONB := '[]'::jsonb;
BEGIN
    IF v_uid IS NOT NULL THEN
        IF v_caller_org IS NULL OR NOT public.is_active_org_member()
           OR v_role NOT IN ('admin', 'hr') OR NOT public.aal2_ok() THEN
            RAISE EXCEPTION 'Forbidden: AAL2 HR or Admin privileges required.' USING ERRCODE = '42501';
        END IF;
        v_target_org := COALESCE(p_organization_id, v_caller_org);
        IF v_target_org IS DISTINCT FROM v_caller_org THEN
            RAISE EXCEPTION 'Forbidden: Organization mismatch.' USING ERRCODE = '42501';
        END IF;
    ELSE
        v_target_org := p_organization_id;
    END IF;

    FOR v_rec IN
        SELECT
            d.organization_id,
            d.employee_id,
            e.full_name,
            d.work_date,
            d.status,
            d.total_minutes,
            d.locked,
            e.joined_on
        FROM public.attendance_days d
        JOIN public.employees e ON e.id = d.employee_id
        WHERE (v_target_org IS NULL OR d.organization_id = v_target_org)
          AND d.status = 'absent'
          AND d.total_minutes = 0
          AND e.joined_on IS NOT NULL
          AND d.work_date < e.joined_on
          AND NOT EXISTS (
              SELECT 1 FROM public.attendance_sessions s
              WHERE s.employee_id = d.employee_id
                AND s.work_date = d.work_date
          )
        ORDER BY d.work_date DESC, e.full_name ASC
    LOOP
        v_total := v_total + 1;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
            'organization_id', v_rec.organization_id,
            'employee_id', v_rec.employee_id,
            'full_name', v_rec.full_name,
            'work_date', v_rec.work_date,
            'joined_on', v_rec.joined_on,
            'locked', v_rec.locked
        ));

        IF p_stage_repairs THEN
            IF v_rec.locked = FALSE THEN
                DELETE FROM public.attendance_days
                WHERE employee_id = v_rec.employee_id
                  AND work_date = v_rec.work_date
                  AND locked = FALSE
                  AND status = 'absent'
                  AND total_minutes = 0;

                INSERT INTO public.audit_logs (
                    organization_id, actor_id, action, table_name, record_id, old_data, new_data
                ) VALUES (
                    v_rec.organization_id,
                    v_uid,
                    'clean_pre_hire_absence',
                    'attendance_days',
                    v_rec.employee_id,
                    jsonb_build_object(
                        'employee_id', v_rec.employee_id,
                        'work_date', v_rec.work_date,
                        'status', v_rec.status,
                        'locked', FALSE,
                        'joined_on', v_rec.joined_on
                    ),
                    jsonb_build_object('repaired', TRUE, 'reason', 'Removed unlocked pre-hire absence prior to joined_on')
                );
                v_unlocked_cleaned := v_unlocked_cleaned + 1;
            ELSE
                INSERT INTO public.attendance_repair_proposals (
                    organization_id, employee_id, work_date, original_status,
                    original_total_minutes, original_locked, employee_joined_on,
                    reason, status, proposed_by
                ) VALUES (
                    v_rec.organization_id, v_rec.employee_id, v_rec.work_date, v_rec.status,
                    v_rec.total_minutes, TRUE, v_rec.joined_on,
                    'Persisted pre-hire absent record prior to employee joined_on date inside locked payroll period.',
                    'pending', v_uid
                )
                ON CONFLICT (employee_id, work_date) WHERE status = 'pending' DO NOTHING;
                v_locked_staged := v_locked_staged + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'total_affected', v_total,
        'unlocked_cleaned', v_unlocked_cleaned,
        'locked_pending', v_locked_staged,
        'records', v_rows
    );
END;
$$;

REVOKE ALL ON FUNCTION public.scan_pre_hire_absent_records(UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scan_pre_hire_absent_records(UUID, BOOLEAN) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_pre_hire_attendance_repair(
    p_proposal_id UUID,
    p_action TEXT,
    p_review_note TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID := (SELECT auth.uid());
    v_role TEXT := public.current_user_role();
    v_caller_org UUID := public.current_org_id();
    v_prop public.attendance_repair_proposals%ROWTYPE;
    v_clean_note TEXT := pg_catalog.btrim(COALESCE(p_review_note, ''));
BEGIN
    IF v_uid IS NULL OR v_caller_org IS NULL OR NOT public.is_active_org_member()
       OR v_role NOT IN ('admin', 'hr') OR NOT public.aal2_ok() THEN
        RAISE EXCEPTION 'Forbidden: AAL2 HR or Admin privileges required.' USING ERRCODE = '42501';
    END IF;

    IF p_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Invalid repair action. Must be approve or reject.' USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.char_length(v_clean_note) < 5 THEN
        RAISE EXCEPTION 'Review note must be at least 5 characters.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_prop
    FROM public.attendance_repair_proposals
    WHERE id = p_proposal_id
      AND organization_id = v_caller_org
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Repair proposal not found in organization.' USING ERRCODE = 'P0002';
    END IF;

    IF v_prop.status <> 'pending' THEN
        RAISE EXCEPTION 'Repair proposal has already been reviewed.' USING ERRCODE = '22023';
    END IF;

    IF v_prop.employee_id = v_uid THEN
        RAISE EXCEPTION 'Separation of duties: you cannot review your own attendance repair.' USING ERRCODE = '42501';
    END IF;

    IF p_action = 'approve' THEN
        DELETE FROM public.attendance_days
        WHERE organization_id = v_prop.organization_id
          AND employee_id = v_prop.employee_id
          AND work_date = v_prop.work_date
          AND status = 'absent'
          AND total_minutes = 0;

        UPDATE public.attendance_repair_proposals
        SET status = 'approved',
            reviewed_by = v_uid,
            reviewed_at = pg_catalog.now(),
            review_note = v_clean_note
        WHERE id = v_prop.id;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_prop.organization_id,
            v_uid,
            'approve_pre_hire_absence_repair',
            'attendance_days',
            v_prop.id,
            jsonb_build_object(
                'status', v_prop.original_status,
                'locked', v_prop.original_locked,
                'work_date', v_prop.work_date,
                'joined_on', v_prop.employee_joined_on
            ),
            jsonb_build_object('repaired', TRUE, 'review_note', v_clean_note)
        );
    ELSE
        UPDATE public.attendance_repair_proposals
        SET status = 'rejected',
            reviewed_by = v_uid,
            reviewed_at = pg_catalog.now(),
            review_note = v_clean_note
        WHERE id = v_prop.id;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_prop.organization_id,
            v_uid,
            'reject_pre_hire_absence_repair',
            'attendance_repair_proposals',
            v_prop.id::text,
            jsonb_build_object('status', 'pending'),
            jsonb_build_object('status', 'rejected', 'review_note', v_clean_note)
        );
    END IF;

    RETURN jsonb_build_object(
        'proposal_id', v_prop.id,
        'status', CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END,
        'work_date', v_prop.work_date,
        'employee_id', v_prop.employee_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.review_pre_hire_attendance_repair(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.review_pre_hire_attendance_repair(UUID, TEXT, TEXT) TO authenticated, service_role;

-- Run one initial non-destructive scan at migration time:
-- unlocked zero-session pre-hire absences are cleaned + audited; locked payroll rows are staged as pending proposals.
SELECT public.scan_pre_hire_absent_records(NULL, TRUE);
