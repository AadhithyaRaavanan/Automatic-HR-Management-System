-- ============================================================================
-- Migration: 20261114000018_shifts_and_night_shifts.sql
-- Description:
-- 1. Adds shift_start_time and shift_end_time to organization_members and employees.
-- 2. Updates recalculate_day to automatically flag is_late based on assigned shift + grace.
-- 3. Updates cron_auto_checkout to support night shifts crossing midnight (skip active 
--    sessions before their scheduled post-midnight shift end).
-- ============================================================================

-- 1. Add shift columns to organization_members and employees
ALTER TABLE public.organization_members
    ADD COLUMN IF NOT EXISTS shift_start_time TIME NOT NULL DEFAULT '09:00:00',
    ADD COLUMN IF NOT EXISTS shift_end_time TIME NOT NULL DEFAULT '17:00:00';

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS shift_start_time TIME NOT NULL DEFAULT '09:00:00',
    ADD COLUMN IF NOT EXISTS shift_end_time TIME NOT NULL DEFAULT '17:00:00';

-- 2. Overwrite recalculate_day to support member shift times + grace period late calculation
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
    v_member_start TIME;
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
        COALESCE(om.shift_start_time, e.shift_start_time, '09:00:00'::time)
    INTO
        v_org_id, v_dept_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_target_minutes, v_loc_weekly_offs, v_member_start
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
            v_expected_start TIME := COALESCE(v_member_start, v_policy.shift_start_time, '09:00:00'::time);
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

-- 3. Overwrite cron_auto_checkout with night shift crossover support
CREATE OR REPLACE FUNCTION public.cron_auto_checkout(
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
    v_closed_count INTEGER := 0;
    v_org RECORD;
    v_scope RECORD;
    v_session RECORD;
    v_local_now TIMESTAMP;
    v_local_date DATE;
    v_local_time TIME;
    v_target_date DATE;
    v_sess_date DATE;
    v_cutoff_ts TIMESTAMPTZ;
    v_checkout_ts TIMESTAMPTZ;
    v_org_closed INTEGER := 0;
    v_scope_closed INTEGER := 0;
    v_err TEXT;
BEGIN
    FOR v_org IN
        SELECT
            o.id,
            COALESCE(o.work_mode, 'remote') AS work_mode,
            COALESCE(NULLIF(o.timezone, ''), 'UTC') AS timezone,
            COALESCE(ap.auto_checkout_time, TIME '23:59:00') AS auto_checkout_time
        FROM public.organizations o
        LEFT JOIN LATERAL (
            SELECT auto_checkout_time
            FROM public.attendance_policies
            WHERE organization_id = o.id
              AND is_active = TRUE
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
        ) ap ON TRUE
        WHERE o.status IN ('active', 'trial')
        ORDER BY o.created_at ASC, o.id ASC
    LOOP
        v_org_closed := 0;

        BEGIN
            FOR v_scope IN
                SELECT DISTINCT scope.loc_key, scope.eff_tz
                FROM (
                    -- Org fallback scope
                    SELECT v_nil_loc AS loc_key, v_org.timezone AS eff_tz
                    UNION
                    -- Active office locations
                    SELECT l.id AS loc_key, COALESCE(NULLIF(l.timezone, ''), v_org.timezone, 'UTC') AS eff_tz
                    FROM public.locations l
                    WHERE l.organization_id = v_org.id
                      AND l.is_active = TRUE
                    UNION
                    -- Active employees' effective scopes
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
                    UNION
                    -- Open sessions' exact resolved scopes
                    SELECT
                        CASE
                            WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                            THEN COALESCE(s.location_id, e.primary_location_id, v_nil_loc)
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(e.primary_location_id, v_nil_loc)
                            ELSE v_nil_loc
                        END AS loc_key,
                        CASE
                            WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                            THEN COALESCE(NULLIF(sl.timezone, ''), NULLIF(el.timezone, ''), v_org.timezone, 'UTC')
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                            ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                        END AS eff_tz
                    FROM public.attendance_sessions s
                    JOIN public.employees e ON e.id = s.employee_id
                    LEFT JOIN public.locations sl ON sl.id = s.location_id
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE s.organization_id = v_org.id
                      AND s.check_out_at IS NULL
                ) scope
                ORDER BY scope.loc_key, scope.eff_tz
            LOOP
                v_scope_closed := 0;
                v_local_now := v_now AT TIME ZONE v_scope.eff_tz;
                v_local_date := v_local_now::date;
                v_local_time := v_local_now::time;

                IF v_local_time >= v_org.auto_checkout_time THEN
                    v_target_date := v_local_date;
                ELSE
                    v_target_date := v_local_date - 1;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM public.cron_run_state crs
                    WHERE crs.job_name = 'auto_checkout'
                      AND crs.organization_id = v_org.id
                      AND crs.location_id = v_scope.loc_key
                      AND crs.timezone_key = v_scope.eff_tz
                      AND crs.target_date = v_target_date
                      AND crs.status = 'success'
                ) THEN
                    CONTINUE;
                END IF;

                FOR v_session IN
                    SELECT
                        s.id,
                        s.employee_id,
                        s.check_in_at
                    FROM public.attendance_sessions s
                    JOIN public.employees e ON e.id = s.employee_id
                    LEFT JOIN public.locations sl ON sl.id = s.location_id
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE s.organization_id = v_org.id
                      AND s.check_out_at IS NULL
                      AND (
                          CASE
                              WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                              THEN COALESCE(s.location_id, e.primary_location_id, v_nil_loc)
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(e.primary_location_id, v_nil_loc)
                              ELSE v_nil_loc
                          END
                      ) = v_scope.loc_key
                      AND (
                          CASE
                              WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                              THEN COALESCE(NULLIF(sl.timezone, ''), NULLIF(el.timezone, ''), v_org.timezone, 'UTC')
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                              ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                          END
                      ) = v_scope.eff_tz
                    ORDER BY s.check_in_at ASC, s.id ASC
                LOOP
                    v_sess_date := (v_session.check_in_at AT TIME ZONE v_scope.eff_tz)::date;
                    IF v_sess_date > v_target_date THEN
                        CONTINUE;
                    END IF;

                    -- Support night shift crossover (shift_end_time < shift_start_time)
                    DECLARE
                        v_shift_start TIME;
                        v_shift_end TIME;
                        v_night_cutoff TIMESTAMPTZ;
                    BEGIN
                        SELECT
                            COALESCE(om.shift_start_time, e.shift_start_time, '09:00:00'::time),
                            COALESCE(om.shift_end_time, e.shift_end_time, '17:00:00'::time)
                        INTO v_shift_start, v_shift_end
                        FROM public.employees e
                        LEFT JOIN public.organization_members om ON om.user_id = e.id AND om.organization_id = e.organization_id
                        WHERE e.id = v_session.employee_id;

                        IF v_shift_end < v_shift_start THEN
                            v_night_cutoff := ((v_sess_date + 1) + v_shift_end) AT TIME ZONE v_scope.eff_tz + INTERVAL '15 minutes';
                            IF v_now < v_night_cutoff THEN
                                CONTINUE;
                            END IF;
                        END IF;
                    END;

                    v_cutoff_ts := (v_sess_date + v_org.auto_checkout_time) AT TIME ZONE v_scope.eff_tz;
                    IF v_session.check_in_at >= v_cutoff_ts THEN
                        v_cutoff_ts := ((v_sess_date + 1) + v_org.auto_checkout_time) AT TIME ZONE v_scope.eff_tz;
                    END IF;

                    IF v_cutoff_ts <= v_now THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM public.attendance_days d
                            WHERE d.organization_id = v_org.id
                              AND d.employee_id = v_session.employee_id
                              AND d.work_date = v_sess_date
                              AND d.locked = TRUE
                        ) THEN
                            v_checkout_ts := GREATEST(v_session.check_in_at + INTERVAL '1 minute', LEAST(v_now, v_cutoff_ts));

                            UPDATE public.attendance_sessions
                            SET check_out_at = v_checkout_ts,
                                source = 'auto',
                                note = COALESCE(note, '') || ' [Auto-closed at policy cutoff ' || v_scope.eff_tz || ']'
                            WHERE id = v_session.id;

                            PERFORM public.recalculate_day(v_session.employee_id, v_sess_date);

                            INSERT INTO public.notifications (
                                organization_id, user_id, type, title, body, link, metadata
                            ) VALUES (
                                v_org.id,
                                v_session.employee_id,
                                'missed_checkout',
                                'Missed Checkout Auto-Closed',
                                'Your open shift from ' || v_sess_date::text || ' passed the organization auto-checkout cutoff (' || v_org.auto_checkout_time::text || ' ' || v_scope.eff_tz || ') and was closed automatically.',
                                '/requests',
                                jsonb_build_object(
                                    'session_id', v_session.id,
                                    'work_date', v_sess_date,
                                    'timezone', v_scope.eff_tz,
                                    'cutoff_at', v_cutoff_ts
                                )
                            );

                            v_scope_closed := v_scope_closed + 1;
                            v_org_closed := v_org_closed + 1;
                        END IF;
                    END IF;
                END LOOP;

                INSERT INTO public.cron_run_state (
                    job_name, organization_id, location_id, timezone_key, target_date,
                    status, error_message, processed_count, executed_at
                ) VALUES (
                    'auto_checkout', v_org.id, v_scope.loc_key, v_scope.eff_tz, v_target_date,
                    'success', NULL, v_scope_closed, v_now
                )
                ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
                SET status = 'success',
                    error_message = NULL,
                    processed_count = EXCLUDED.processed_count,
                    executed_at = EXCLUDED.executed_at
                WHERE public.cron_run_state.status IS DISTINCT FROM 'success';
            END LOOP;

            v_closed_count := v_closed_count + v_org_closed;
        EXCEPTION WHEN OTHERS THEN
            v_err := SQLERRM;
            INSERT INTO public.cron_run_state (
                job_name, organization_id, location_id, timezone_key, target_date,
                status, error_message, processed_count, executed_at
            ) VALUES (
                'auto_checkout', v_org.id, v_nil_loc, v_org.timezone,
                (v_now AT TIME ZONE 'UTC')::date, 'failed', v_err, 0, v_now
            )
            ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
            SET status = CASE WHEN public.cron_run_state.status = 'success' THEN 'success' ELSE 'failed' END,
                error_message = COALESCE(EXCLUDED.error_message, public.cron_run_state.error_message),
                executed_at = EXCLUDED.executed_at;
        END;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout(TIMESTAMPTZ) TO service_role;
