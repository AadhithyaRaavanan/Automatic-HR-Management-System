-- ============================================================================
-- Migration 17: Final Security & KPI Accuracy Fixes
--
-- Addresses:
-- 1. Item 2: Restrict `get_user_role(uuid)` to self, active HR, or active Admin
--    (AAL2 required for non-self queries) within the caller's active organization.
-- 2. Item 4(a): Nullable `kpi_scores.actual_value` / `kpi_scores.score` and
--    NULL return in `calculate_kpi_score(NULL, ...)` so metrics with no
--    underlying data produce NULL ("No data" / "Not scored") instead of 0/100.
-- 3. Item 4(b): Convert `tasks.completed_at` and current-date overdue comparisons
--    using each employee's effective timezone (location TZ for office mode,
--    employee TZ -> org TZ fallback otherwise).
-- 4. Item 4(c): `leave_days_taken` calculates working days via
--    `calculate_working_days(...)` across the period-clipped range for
--    straddling leave requests, and excludes `sick` / `statutory` leave types
--    by default (`leave_types.counts_toward_kpi`, configurable per leave type
--    via `hr_update_leave_type_kpi_setting`).
-- 5. Item 4(d): `tasks_overdue` counts open overdue tasks ONCE in the period
--    containing `due_date` (`due_date BETWEEN start_date AND end_date AND
--    due_date < local_today`), preventing repeated carry-over across later months.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: Restrict get_user_role(uuid) to Self, HR, or Admin
-- ----------------------------------------------------------------------------

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
    v_caller_role TEXT;
    v_caller_aal TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;

        v_caller_org := public.current_org_id();
        v_caller_role := public.current_user_role();

        IF p_user_id IS DISTINCT FROM v_caller_id THEN
            IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
                RAISE EXCEPTION 'Forbidden: You may only query your own role unless authorized as HR or admin.' USING ERRCODE = '42501';
            END IF;

            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 required to query another user''s role.' USING ERRCODE = '42501';
            END IF;
        END IF;

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

REVOKE ALL ON FUNCTION public.get_user_role(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- SECTION 2: Leave Type KPI Inclusion Flag & Hardened Configuration RPC
-- ----------------------------------------------------------------------------

ALTER TABLE public.leave_types
    ADD COLUMN IF NOT EXISTS counts_toward_kpi BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.leave_types
SET counts_toward_kpi = FALSE
WHERE UPPER(code) IN ('SICK', 'SL', 'STATUTORY', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'MEDICAL')
   OR LOWER(name) ~ '(sick|statutory|medical|maternity|paternity|bereavement|public\s+holiday)';

CREATE OR REPLACE FUNCTION public.hr_update_leave_type_kpi_setting(
    p_leave_type_id UUID,
    p_counts_toward_kpi BOOLEAN
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
    v_old RECORD;
    v_new RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators may configure leave type KPI counting.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for configuring leave types.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_leave_type_id IS NULL THEN
        RAISE EXCEPTION 'leave_type_id is required.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_old
    FROM public.leave_types
    WHERE id = p_leave_type_id
    FOR UPDATE;

    IF v_old IS NULL OR v_old.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Leave type not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.leave_types
    SET counts_toward_kpi = COALESCE(p_counts_toward_kpi, TRUE),
        updated_at = pg_catalog.now()
    WHERE id = p_leave_type_id
      AND organization_id = v_caller_org
    RETURNING * INTO v_new;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org,
        v_caller_id,
        'LEAVE_TYPE_KPI_SETTING_UPDATED',
        'leave_types',
        p_leave_type_id,
        jsonb_build_object('code', v_old.code, 'name', v_old.name, 'counts_toward_kpi', v_old.counts_toward_kpi),
        jsonb_build_object('code', v_new.code, 'name', v_new.name, 'counts_toward_kpi', v_new.counts_toward_kpi)
    );

    RETURN jsonb_build_object('success', true, 'leave_type', to_jsonb(v_new));
END;
$$;

REVOKE ALL ON FUNCTION public.hr_update_leave_type_kpi_setting(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_update_leave_type_kpi_setting(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 3: Nullable Unscored KPI Snapshots & NULL-Preserving Scoring
-- ----------------------------------------------------------------------------

ALTER TABLE public.kpi_scores
    ALTER COLUMN actual_value DROP DEFAULT,
    ALTER COLUMN actual_value DROP NOT NULL,
    ALTER COLUMN score DROP NOT NULL;

DO $$
DECLARE
    v_con RECORD;
BEGIN
    FOR v_con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.kpi_scores'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ 'score'
    LOOP
        EXECUTE format('ALTER TABLE public.kpi_scores DROP CONSTRAINT %I', v_con.conname);
    END LOOP;
END $$;

ALTER TABLE public.kpi_scores
    ADD CONSTRAINT kpi_scores_score_check
    CHECK (score IS NULL OR (score >= 0 AND score <= 100));

CREATE OR REPLACE FUNCTION public.calculate_kpi_score(
    p_actual NUMERIC,
    p_target NUMERIC,
    p_direction TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_target NUMERIC;
    v_score NUMERIC;
BEGIN
    IF p_direction IS NULL OR p_direction NOT IN ('higher_is_better', 'lower_is_better') THEN
        RAISE EXCEPTION 'Invalid KPI direction: must be higher_is_better or lower_is_better.' USING ERRCODE = '22023';
    END IF;

    -- No underlying data (NULL) must remain NULL ("not scored"), never 0 or 100
    IF p_actual IS NULL THEN
        RETURN NULL;
    END IF;

    v_target := COALESCE(p_target, 0);

    IF p_direction = 'higher_is_better' THEN
        IF v_target <= 0 THEN
            RETURN CASE WHEN p_actual > 0 THEN 100.00 ELSE 0.00 END;
        END IF;
        v_score := ROUND(GREATEST(0::numeric, LEAST(100::numeric, (p_actual / v_target) * 100.0)), 2);
        RETURN v_score;
    ELSE
        -- lower_is_better
        IF v_target <= 0 THEN
            IF p_actual <= 0 THEN
                RETURN 100.00;
            END IF;
            RETURN ROUND(GREATEST(0::numeric, 100.0 / (1.0 + p_actual)), 2);
        END IF;

        IF p_actual <= v_target THEN
            RETURN 100.00;
        END IF;

        v_score := ROUND(GREATEST(0::numeric, LEAST(100::numeric, (2.0 - (p_actual / v_target)) * 100.0)), 2);
        RETURN v_score;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_kpi_score(NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_kpi_score(NUMERIC, NUMERIC, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 4: Timezone-Correct, Null-Safe & Period-Scoped compute_kpi_scores
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.compute_kpi_scores(
    p_period_id UUID
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
    v_org_mode TEXT;
    v_org_tz TEXT;
    v_period RECORD;
    v_emp RECORD;
    v_def RECORD;
    v_lr RECORD;
    v_eff_tz TEXT;
    v_local_today DATE;
    v_att_count INTEGER;
    v_any_leave_count INTEGER;
    v_countable_leave_count INTEGER;
    v_leave_days NUMERIC;
    v_overlap_start DATE;
    v_overlap_end DATE;
    v_day_part TEXT;
    v_actual NUMERIC(12,2);
    v_score NUMERIC(5,2);
    v_written INTEGER := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can compute KPI scores.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for computing KPI scores.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_period
    FROM public.kpi_periods
    WHERE id = p_period_id
    FOR UPDATE;

    IF v_period IS NULL OR v_period.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI period not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_period.status = 'closed' THEN
        RAISE EXCEPTION 'Closed KPI periods are immutable and cannot be recalculated.' USING ERRCODE = '22023';
    END IF;

    SELECT
        COALESCE(o.work_mode, 'remote'),
        COALESCE(NULLIF(o.timezone, ''), 'UTC')
    INTO v_org_mode, v_org_tz
    FROM public.organizations o
    WHERE o.id = v_org_id;

    -- Wipe previous open-period snapshot rows before writing recomputed snapshots
    DELETE FROM public.kpi_scores WHERE period_id = p_period_id;

    FOR v_emp IN
        SELECT
            e.id,
            e.department_id,
            COALESCE(e.work_target_minutes, 480) AS work_target_minutes,
            e.work_mode,
            e.timezone AS emp_timezone,
            l.timezone AS loc_timezone,
            om.role
        FROM public.employees e
        JOIN public.organization_members om
          ON om.user_id = e.id
         AND om.organization_id = e.organization_id
         AND om.status = 'active'
        LEFT JOIN public.locations l
          ON l.id = e.primary_location_id
        WHERE e.organization_id = v_org_id
          AND e.status = 'active'
    LOOP
        -- Resolve employee effective timezone consistently with attendance & nightly crons
        v_eff_tz := CASE
            WHEN COALESCE(v_emp.work_mode, v_org_mode, 'remote') = 'office'
            THEN COALESCE(NULLIF(v_emp.loc_timezone, ''), NULLIF(v_emp.emp_timezone, ''), v_org_tz, 'UTC')
            ELSE COALESCE(NULLIF(v_emp.emp_timezone, ''), v_org_tz, 'UTC')
        END;
        v_local_today := (pg_catalog.now() AT TIME ZONE v_eff_tz)::date;

        FOR v_def IN
            SELECT *
            FROM public.kpi_definitions d
            WHERE d.organization_id = v_org_id
              AND d.is_active = TRUE
              AND (d.applies_to_role IS NULL OR d.applies_to_role = v_emp.role)
              AND (d.applies_to_department_id IS NULL OR d.applies_to_department_id = v_emp.department_id)
        LOOP
            v_actual := NULL;

            IF v_def.source_metric = 'attendance_on_time_rate' THEN
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day')) = 0 THEN NULL
                        ELSE ROUND(
                            (COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day') AND ad.is_late = FALSE)::numeric /
                             COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day'))::numeric) * 100.0,
                            2
                        )
                    END
                INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'hours_vs_target' THEN
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day', 'absent')) = 0
                             OR COALESCE(v_emp.work_target_minutes, 0) <= 0
                        THEN NULL
                        ELSE ROUND(
                            (COALESCE(SUM(CASE WHEN ad.status IN ('present', 'half_day') THEN ad.total_minutes ELSE 0 END), 0)::numeric /
                             (COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day', 'absent'))::numeric * v_emp.work_target_minutes)) * 100.0,
                            2
                        )
                    END
                INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'absence_days' THEN
                SELECT
                    CASE
                        WHEN COUNT(*) = 0 THEN NULL
                        ELSE COUNT(*) FILTER (WHERE ad.status = 'absent')::numeric
                    END
                INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'leave_days_taken' THEN
                SELECT COUNT(*)
                INTO v_att_count
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

                SELECT
                    COUNT(*),
                    COUNT(*) FILTER (WHERE COALESCE(lt.counts_toward_kpi, TRUE) = TRUE)
                INTO v_any_leave_count, v_countable_leave_count
                FROM public.leave_requests lr
                JOIN public.leave_types lt ON lt.id = lr.leave_type_id
                WHERE lr.organization_id = v_org_id
                  AND lr.employee_id = v_emp.id
                  AND lr.status = 'approved'
                  AND lr.start_date <= v_period.end_date
                  AND lr.end_date >= v_period.start_date;

                IF v_att_count = 0 AND v_any_leave_count = 0 THEN
                    v_actual := NULL;
                ELSE
                    v_leave_days := 0;
                    IF v_countable_leave_count > 0 THEN
                        FOR v_lr IN
                            SELECT lr.start_date, lr.end_date, lr.day_part
                            FROM public.leave_requests lr
                            JOIN public.leave_types lt ON lt.id = lr.leave_type_id
                            WHERE lr.organization_id = v_org_id
                              AND lr.employee_id = v_emp.id
                              AND lr.status = 'approved'
                              AND COALESCE(lt.counts_toward_kpi, TRUE) = TRUE
                              AND lr.start_date <= v_period.end_date
                              AND lr.end_date >= v_period.start_date
                        LOOP
                            v_overlap_start := GREATEST(v_lr.start_date, v_period.start_date);
                            v_overlap_end := LEAST(v_lr.end_date, v_period.end_date);
                            v_day_part := CASE
                                WHEN v_lr.start_date = v_lr.end_date THEN v_lr.day_part
                                ELSE 'full'
                            END;
                            v_leave_days := v_leave_days + public.calculate_working_days(
                                v_emp.id,
                                v_overlap_start,
                                v_overlap_end,
                                v_day_part
                            );
                        END LOOP;
                    END IF;
                    v_actual := ROUND(v_leave_days, 2);
                END IF;

            ELSIF v_def.source_metric = 'tasks_completed' THEN
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (
                            WHERE t.status <> 'cancelled'
                              AND (
                                  (t.completed_at IS NOT NULL AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date)
                                  OR (t.due_date BETWEEN v_period.start_date AND v_period.end_date)
                              )
                        ) = 0 THEN NULL
                        ELSE COUNT(*) FILTER (
                            WHERE t.status = 'done'
                              AND t.completed_at IS NOT NULL
                              AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date
                        )::numeric
                    END
                INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id;

            ELSIF v_def.source_metric = 'tasks_on_time_rate' THEN
                SELECT
                    ROUND(
                        (COUNT(*) FILTER (WHERE (t.completed_at AT TIME ZONE v_eff_tz)::date <= t.due_date)::numeric /
                         NULLIF(COUNT(*)::numeric, 0)) * 100.0,
                        2
                    )
                INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.due_date IS NOT NULL
                  AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'tasks_overdue' THEN
                -- Single-count period-scoped rule:
                -- * Open overdue tasks (todo/in_progress/blocked) count ONCE in the
                --   period containing their due_date (`due_date BETWEEN start AND end`
                --   and `due_date < employee local today`), never repeated in later periods.
                -- * Late-completed tasks count in the period containing local completion date.
                -- * NULL ("No data") when the employee has no dated tasks due or done in period.
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (
                            WHERE t.status <> 'cancelled'
                              AND t.due_date IS NOT NULL
                              AND (
                                  t.due_date BETWEEN v_period.start_date AND v_period.end_date
                                  OR (
                                      t.status = 'done'
                                      AND t.completed_at IS NOT NULL
                                      AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date
                                  )
                              )
                        ) = 0 THEN NULL
                        ELSE COUNT(*) FILTER (
                            WHERE t.due_date IS NOT NULL
                              AND (
                                  (
                                      t.status IN ('todo', 'in_progress', 'blocked')
                                      AND t.due_date BETWEEN v_period.start_date AND v_period.end_date
                                      AND t.due_date < v_local_today
                                  )
                                  OR (
                                      t.status = 'done'
                                      AND t.completed_at IS NOT NULL
                                      AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date
                                      AND (t.completed_at AT TIME ZONE v_eff_tz)::date > t.due_date
                                  )
                              )
                        )::numeric
                    END
                INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id;

            ELSIF v_def.source_metric = 'avg_task_cycle_days' THEN
                SELECT
                    ROUND(
                        AVG(
                            GREATEST(
                                0.0,
                                EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.started_at, t.created_at))) / 86400.0
                            )
                        )::numeric,
                        2
                    )
                INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date;
            END IF;

            v_score := public.calculate_kpi_score(v_actual, v_def.target_value, v_def.direction);

            INSERT INTO public.kpi_scores (
                organization_id, period_id, employee_id, kpi_definition_id,
                actual_value, target_value, score, computed_at
            ) VALUES (
                v_org_id, p_period_id, v_emp.id, v_def.id,
                v_actual, v_def.target_value, v_score, pg_catalog.now()
            );

            v_written := v_written + 1;
        END LOOP;
    END LOOP;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_SCORES_COMPUTED', 'kpi_scores', p_period_id,
        NULL, jsonb_build_object('period_id', p_period_id, 'scores_written', v_written)
    );

    RETURN jsonb_build_object('success', true, 'period_id', p_period_id, 'scores_written', v_written);
END;
$$;

REVOKE ALL ON FUNCTION public.compute_kpi_scores(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_kpi_scores(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 5: Unschedule Redundant Standalone Retention Cron
--
-- All automated retention cleanup is orchestrated exclusively through the
-- automated archive pipeline (`weekly-retention-archive` -> Edge Function ->
-- `archiveAndRunRetentionCleanup`), which archives sessions to storage before deletion.
-- The legacy standalone `weekly-retention-cleanup` job is unscheduled to prevent
-- deleting attendance records prior to storage backup.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension e
        JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_cron'
    ) THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-retention-cleanup') THEN
            PERFORM cron.unschedule('weekly-retention-cleanup');
        END IF;
    END IF;
END;
$$;


