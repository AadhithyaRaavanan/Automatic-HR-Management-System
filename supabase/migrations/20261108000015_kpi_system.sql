-- ============================================================================
-- Migration 15: Section 4 - KPI System (Attendance, Leave & Tasks)
-- ============================================================================
-- Covers:
-- 1. Tenant-scoped tables (RLS enabled, RPC-only writes, SELECT granted cleanly):
--    `kpi_definitions`, `kpi_periods`, `kpi_scores`, `kpi_reviews`.
-- 2. Pure SQL KPI formula function `calculate_kpi_score(numeric, numeric, text)`
--    (IMMUTABLE, handles no data / NULL, zero target, higher_is_better, lower_is_better).
-- 3. Closed-period immutability triggers (`kpi_periods`, `kpi_scores`, `kpi_reviews`).
-- 4. SECURITY DEFINER RPCs (`SET search_path = ''`, role from `organization_members`,
--    AAL2 for HR/Admin, no self-review, UPPER_SNAKE audits, notifications):
--    - `upsert_kpi_definition`
--    - `delete_kpi_definition`
--    - `create_kpi_period`
--    - `compute_kpi_scores`
--    - `close_kpi_period`
--    - `submit_kpi_review`
-- ============================================================================

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kpi_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(name)) >= 2),
    description TEXT,
    source_metric TEXT NOT NULL CHECK (
        source_metric IN (
            'attendance_on_time_rate',
            'hours_vs_target',
            'absence_days',
            'leave_days_taken',
            'tasks_completed',
            'tasks_on_time_rate',
            'tasks_overdue',
            'avg_task_cycle_days'
        )
    ),
    target_value NUMERIC(12,2) NOT NULL CHECK (target_value >= 0),
    direction TEXT NOT NULL CHECK (direction IN ('higher_is_better', 'lower_is_better')),
    weight NUMERIC(6,2) NOT NULL DEFAULT 1.00 CHECK (weight > 0 AND weight <= 1000),
    applies_to_role TEXT CHECK (applies_to_role IS NULL OR applies_to_role IN ('employee', 'manager', 'hr', 'admin')),
    applies_to_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_kpi_definitions_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_kpi_definitions_org_active
    ON public.kpi_definitions (organization_id, is_active, source_metric);

CREATE TABLE IF NOT EXISTS public.kpi_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(name)) >= 2),
    period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_kpi_periods_dates CHECK (end_date >= start_date),
    CONSTRAINT uq_kpi_periods_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_kpi_periods_org_status
    ON public.kpi_periods (organization_id, status, start_date DESC);

CREATE TABLE IF NOT EXISTS public.kpi_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES public.kpi_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    kpi_definition_id UUID NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
    actual_value NUMERIC(12,2) NOT NULL DEFAULT 0,
    target_value NUMERIC(12,2) NOT NULL,
    score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
    computed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_kpi_scores_period_emp_def UNIQUE (period_id, employee_id, kpi_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_scores_org_period_emp
    ON public.kpi_scores (organization_id, period_id, employee_id);

CREATE TABLE IF NOT EXISTS public.kpi_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES public.kpi_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    rating NUMERIC(3,1) NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
    comment TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(comment)) >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_kpi_reviews_period_emp UNIQUE (period_id, employee_id),
    CONSTRAINT chk_kpi_reviews_no_self_review CHECK (reviewer_id IS DISTINCT FROM employee_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_reviews_org_period_emp
    ON public.kpi_reviews (organization_id, period_id, employee_id);

-- ============================================================================
-- 2. GRANTS & ROW LEVEL SECURITY
-- ============================================================================

REVOKE ALL ON TABLE public.kpi_definitions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kpi_definitions TO authenticated;

REVOKE ALL ON TABLE public.kpi_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kpi_periods TO authenticated;

REVOKE ALL ON TABLE public.kpi_scores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kpi_scores TO authenticated;

REVOKE ALL ON TABLE public.kpi_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kpi_reviews TO authenticated;

ALTER TABLE public.kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_reviews ENABLE ROW LEVEL SECURITY;

-- kpi_definitions policies
DROP POLICY IF EXISTS "enforce_active_org_membership_kpi_definitions" ON public.kpi_definitions;
DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_definitions" ON public.kpi_definitions;
DROP POLICY IF EXISTS "kpi_definitions_select_policy" ON public.kpi_definitions;

CREATE POLICY "enforce_active_org_membership_kpi_definitions" ON public.kpi_definitions
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_kpi_definitions" ON public.kpi_definitions
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "kpi_definitions_select_policy" ON public.kpi_definitions
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

-- kpi_periods policies
DROP POLICY IF EXISTS "enforce_active_org_membership_kpi_periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "kpi_periods_select_policy" ON public.kpi_periods;

CREATE POLICY "enforce_active_org_membership_kpi_periods" ON public.kpi_periods
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_kpi_periods" ON public.kpi_periods
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "kpi_periods_select_policy" ON public.kpi_periods
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

-- kpi_scores policies (employee own; manager direct reports; hr/admin all)
DROP POLICY IF EXISTS "enforce_active_org_membership_kpi_scores" ON public.kpi_scores;
DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_scores" ON public.kpi_scores;
DROP POLICY IF EXISTS "kpi_scores_select_policy" ON public.kpi_scores;

CREATE POLICY "enforce_active_org_membership_kpi_scores" ON public.kpi_scores
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_kpi_scores" ON public.kpi_scores
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "kpi_scores_select_policy" ON public.kpi_scores
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            employee_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR (
                (SELECT public.current_user_role()) = 'manager'
                AND EXISTS (
                    SELECT 1 FROM public.employees e
                    WHERE e.id = kpi_scores.employee_id
                      AND e.organization_id = kpi_scores.organization_id
                      AND e.manager_id = (SELECT auth.uid())
                )
            )
        )
    );

-- kpi_reviews policies (employee own; manager direct reports; hr/admin all)
DROP POLICY IF EXISTS "enforce_active_org_membership_kpi_reviews" ON public.kpi_reviews;
DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_reviews" ON public.kpi_reviews;
DROP POLICY IF EXISTS "kpi_reviews_select_policy" ON public.kpi_reviews;

CREATE POLICY "enforce_active_org_membership_kpi_reviews" ON public.kpi_reviews
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_kpi_reviews" ON public.kpi_reviews
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "kpi_reviews_select_policy" ON public.kpi_reviews
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            employee_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR (
                (SELECT public.current_user_role()) = 'manager'
                AND EXISTS (
                    SELECT 1 FROM public.employees e
                    WHERE e.id = kpi_reviews.employee_id
                      AND e.organization_id = kpi_reviews.organization_id
                      AND e.manager_id = (SELECT auth.uid())
                )
            )
        )
    );

-- ============================================================================
-- 3. PURE SQL SCORING FORMULA FUNCTION
-- ============================================================================

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

    -- Edge case: No recorded data (NULL) resolves safely to 0.00
    IF p_actual IS NULL THEN
        RETURN 0.00;
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

-- ============================================================================
-- 4. CLOSED-PERIOD IMMUTABILITY TRIGGERS
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_enforce_kpi_closed_immutability()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_period_id UUID;
    v_status TEXT;
BEGIN
    IF TG_TABLE_NAME = 'kpi_periods' THEN
        IF TG_OP = 'DELETE' AND OLD.status = 'closed' THEN
            RAISE EXCEPTION 'Closed KPI periods cannot be deleted.' USING ERRCODE = '22023';
        END IF;
        IF TG_OP = 'UPDATE' AND OLD.status = 'closed' THEN
            RAISE EXCEPTION 'Closed KPI periods are immutable.' USING ERRCODE = '22023';
        END IF;
        RETURN COALESCE(NEW, OLD);
    END IF;

    v_period_id := COALESCE(NEW.period_id, OLD.period_id);
    SELECT status INTO v_status FROM public.kpi_periods WHERE id = v_period_id;

    -- Allow CASCADE delete when the entire period itself is open and deleted, otherwise block
    IF v_status = 'closed' THEN
        RAISE EXCEPTION 'KPI records belonging to a closed period are immutable.' USING ERRCODE = '22023';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_kpi_closed_immutability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kpi_periods_immutable ON public.kpi_periods;
CREATE TRIGGER trg_kpi_periods_immutable
    BEFORE UPDATE OR DELETE ON public.kpi_periods
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_kpi_closed_immutability();

DROP TRIGGER IF EXISTS trg_kpi_scores_immutable ON public.kpi_scores;
CREATE TRIGGER trg_kpi_scores_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.kpi_scores
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_kpi_closed_immutability();

DROP TRIGGER IF EXISTS trg_kpi_reviews_immutable ON public.kpi_reviews;
CREATE TRIGGER trg_kpi_reviews_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.kpi_reviews
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_kpi_closed_immutability();

-- ============================================================================
-- 5. KPI MANAGEMENT & COMPUTATION RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_kpi_definition(
    p_name TEXT,
    p_source_metric TEXT,
    p_target_value NUMERIC,
    p_direction TEXT,
    p_weight NUMERIC DEFAULT 1.0,
    p_description TEXT DEFAULT NULL,
    p_applies_to_role TEXT DEFAULT NULL,
    p_applies_to_department_id UUID DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT TRUE,
    p_definition_id UUID DEFAULT NULL
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
    v_desc TEXT;
    v_role_filter TEXT;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can manage KPI definitions.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for KPI definition changes.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF char_length(v_name) < 2 THEN
        RAISE EXCEPTION 'KPI name must be at least 2 characters.' USING ERRCODE = '22023';
    END IF;

    IF p_source_metric IS NULL OR p_source_metric NOT IN (
        'attendance_on_time_rate',
        'hours_vs_target',
        'absence_days',
        'leave_days_taken',
        'tasks_completed',
        'tasks_on_time_rate',
        'tasks_overdue',
        'avg_task_cycle_days'
    ) THEN
        RAISE EXCEPTION 'Invalid KPI source metric: %.', p_source_metric USING ERRCODE = '22023';
    END IF;

    IF p_target_value IS NULL OR p_target_value < 0 THEN
        RAISE EXCEPTION 'target_value must be non-negative.' USING ERRCODE = '22023';
    END IF;

    IF p_direction IS NULL OR p_direction NOT IN ('higher_is_better', 'lower_is_better') THEN
        RAISE EXCEPTION 'direction must be higher_is_better or lower_is_better.' USING ERRCODE = '22023';
    END IF;

    IF p_weight IS NULL OR p_weight <= 0 OR p_weight > 1000 THEN
        RAISE EXCEPTION 'weight must be between 0.01 and 1000.' USING ERRCODE = '22023';
    END IF;

    v_role_filter := NULLIF(pg_catalog.btrim(COALESCE(p_applies_to_role, '')), '');
    IF v_role_filter IS NOT NULL AND v_role_filter NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid applies_to_role: %.', v_role_filter USING ERRCODE = '22023';
    END IF;

    IF p_applies_to_department_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.departments d
        WHERE d.id = p_applies_to_department_id AND d.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Forbidden: Department not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    v_desc := NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), '');

    IF p_definition_id IS NOT NULL THEN
        SELECT * INTO v_old_row
        FROM public.kpi_definitions
        WHERE id = p_definition_id
        FOR UPDATE;

        IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
            RAISE EXCEPTION 'Forbidden: KPI definition not found in caller organization.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.kpi_definitions
        SET name = v_name,
            description = v_desc,
            source_metric = p_source_metric,
            target_value = p_target_value,
            direction = p_direction,
            weight = p_weight,
            applies_to_role = v_role_filter,
            applies_to_department_id = p_applies_to_department_id,
            is_active = COALESCE(p_is_active, TRUE),
            updated_at = pg_catalog.now()
        WHERE id = p_definition_id
        RETURNING * INTO v_new_row;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_org_id, v_caller_id, 'KPI_DEFINITION_UPDATED', 'kpi_definitions', v_new_row.id,
            to_jsonb(v_old_row), to_jsonb(v_new_row)
        );
    ELSE
        INSERT INTO public.kpi_definitions (
            organization_id, name, description, source_metric, target_value, direction,
            weight, applies_to_role, applies_to_department_id, is_active, created_by
        ) VALUES (
            v_org_id, v_name, v_desc, p_source_metric, p_target_value, p_direction,
            p_weight, v_role_filter, p_applies_to_department_id, COALESCE(p_is_active, TRUE), v_caller_id
        )
        RETURNING * INTO v_new_row;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_org_id, v_caller_id, 'KPI_DEFINITION_CREATED', 'kpi_definitions', v_new_row.id,
            NULL, to_jsonb(v_new_row)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'definition', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_kpi_definition(TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, UUID, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_kpi_definition(TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, UUID, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_kpi_definition(
    p_definition_id UUID
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
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can delete KPI definitions.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for KPI definition deletion.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.kpi_definitions
    WHERE id = p_definition_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI definition not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.kpi_scores ks
        JOIN public.kpi_periods kp ON kp.id = ks.period_id
        WHERE ks.kpi_definition_id = p_definition_id
          AND kp.status = 'closed'
    ) THEN
        RAISE EXCEPTION 'Cannot delete KPI definition referenced by a closed period; deactivate it instead.' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.kpi_definitions WHERE id = p_definition_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_DEFINITION_DELETED', 'kpi_definitions', p_definition_id,
        to_jsonb(v_old_row), NULL
    );

    RETURN jsonb_build_object('success', true, 'deleted_id', p_definition_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_kpi_definition(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_kpi_definition(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_kpi_period(
    p_name TEXT,
    p_period_type TEXT,
    p_start_date DATE,
    p_end_date DATE
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
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can create KPI periods.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for creating KPI periods.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF char_length(v_name) < 2 THEN
        RAISE EXCEPTION 'Period name must be at least 2 characters.' USING ERRCODE = '22023';
    END IF;

    IF p_period_type IS NULL OR p_period_type NOT IN ('monthly', 'quarterly') THEN
        RAISE EXCEPTION 'period_type must be monthly or quarterly.' USING ERRCODE = '22023';
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'end_date must be on or after start_date.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.kpi_periods (
        organization_id, name, period_type, start_date, end_date, status, created_by
    ) VALUES (
        v_org_id, v_name, p_period_type, p_start_date, p_end_date, 'open', v_caller_id
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_PERIOD_CREATED', 'kpi_periods', v_row.id, NULL, to_jsonb(v_row)
    );

    RETURN jsonb_build_object('success', true, 'period', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.create_kpi_period(TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_kpi_period(TEXT, TEXT, DATE, DATE) TO authenticated;

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
    v_period RECORD;
    v_emp RECORD;
    v_def RECORD;
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

    -- Wipe previous open-period snapshot rows before writing recomputed snapshots
    DELETE FROM public.kpi_scores WHERE period_id = p_period_id;

    FOR v_emp IN
        SELECT e.id, e.department_id, COALESCE(e.work_target_minutes, 480) AS work_target_minutes, om.role
        FROM public.employees e
        JOIN public.organization_members om
          ON om.user_id = e.id
         AND om.organization_id = e.organization_id
         AND om.status = 'active'
        WHERE e.organization_id = v_org_id
          AND e.status = 'active'
    LOOP
        FOR v_def IN
            SELECT *
            FROM public.kpi_definitions d
            WHERE d.organization_id = v_org_id
              AND d.is_active = TRUE
              AND (d.applies_to_role IS NULL OR d.applies_to_role = v_emp.role)
              AND (d.applies_to_department_id IS NULL OR d.applies_to_department_id = v_emp.department_id)
        LOOP
            v_actual := 0.00;

            IF v_def.source_metric = 'attendance_on_time_rate' THEN
                SELECT COALESCE(
                    ROUND(
                        (COUNT(*) FILTER (WHERE is_late = FALSE)::numeric /
                         NULLIF(COUNT(*)::numeric, 0)) * 100.0,
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date
                  AND ad.status IN ('present', 'half_day');

            ELSIF v_def.source_metric = 'hours_vs_target' THEN
                SELECT COALESCE(
                    ROUND(
                        (COALESCE(SUM(CASE WHEN ad.status IN ('present', 'half_day') THEN ad.total_minutes ELSE 0 END), 0)::numeric /
                         NULLIF((COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day', 'absent'))::numeric * v_emp.work_target_minutes), 0)) * 100.0,
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'absence_days' THEN
                SELECT COUNT(*)::numeric INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date
                  AND ad.status = 'absent';

            ELSIF v_def.source_metric = 'leave_days_taken' THEN
                SELECT COALESCE(
                    ROUND(
                        SUM(
                            CASE
                                WHEN lr.start_date >= v_period.start_date AND lr.end_date <= v_period.end_date
                                THEN lr.total_days
                                ELSE GREATEST(
                                    0,
                                    (LEAST(lr.end_date, v_period.end_date) - GREATEST(lr.start_date, v_period.start_date) + 1)
                                )::numeric
                            END
                        ),
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.leave_requests lr
                WHERE lr.organization_id = v_org_id
                  AND lr.employee_id = v_emp.id
                  AND lr.status = 'approved'
                  AND lr.start_date <= v_period.end_date
                  AND lr.end_date >= v_period.start_date;

            ELSIF v_def.source_metric = 'tasks_completed' THEN
                SELECT COUNT(*)::numeric INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.completed_at::date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'tasks_on_time_rate' THEN
                SELECT COALESCE(
                    ROUND(
                        (COUNT(*) FILTER (WHERE t.completed_at::date <= t.due_date)::numeric /
                         NULLIF(COUNT(*)::numeric, 0)) * 100.0,
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.due_date IS NOT NULL
                  AND t.completed_at::date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'tasks_overdue' THEN
                SELECT COUNT(*)::numeric INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.due_date IS NOT NULL
                  AND (
                      (
                          t.status IN ('todo', 'in_progress', 'blocked')
                          AND t.due_date <= v_period.end_date
                          AND t.due_date < CURRENT_DATE
                      )
                      OR (
                          t.status = 'done'
                          AND t.completed_at IS NOT NULL
                          AND t.completed_at::date BETWEEN v_period.start_date AND v_period.end_date
                          AND t.completed_at::date > t.due_date
                      )
                  );

            ELSIF v_def.source_metric = 'avg_task_cycle_days' THEN
                SELECT COALESCE(
                    ROUND(
                        AVG(
                            GREATEST(
                                0.0,
                                EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.started_at, t.created_at))) / 86400.0
                            )
                        )::numeric,
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.completed_at::date BETWEEN v_period.start_date AND v_period.end_date;
            END IF;

            v_score := public.calculate_kpi_score(v_actual, v_def.target_value, v_def.direction);

            INSERT INTO public.kpi_scores (
                organization_id, period_id, employee_id, kpi_definition_id,
                actual_value, target_value, score, computed_at
            ) VALUES (
                v_org_id, p_period_id, v_emp.id, v_def.id,
                COALESCE(v_actual, 0.00), v_def.target_value, v_score, pg_catalog.now()
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

CREATE OR REPLACE FUNCTION public.close_kpi_period(
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
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can close KPI periods.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for closing KPI periods.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.kpi_periods
    WHERE id = p_period_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI period not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_old_row.status = 'closed' THEN
        RAISE EXCEPTION 'KPI period is already closed.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.kpi_periods
    SET status = 'closed',
        closed_at = pg_catalog.now(),
        closed_by = v_caller_id,
        updated_at = pg_catalog.now()
    WHERE id = p_period_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_PERIOD_CLOSED', 'kpi_periods', p_period_id,
        to_jsonb(v_old_row), to_jsonb(v_new_row)
    );

    RETURN jsonb_build_object('success', true, 'period', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.close_kpi_period(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_kpi_period(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_kpi_review(
    p_period_id UUID,
    p_employee_id UUID,
    p_rating NUMERIC,
    p_comment TEXT
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
    v_period RECORD;
    v_emp RECORD;
    v_comment TEXT;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only managers, HR, or administrators can submit KPI reviews.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin KPI reviews.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Separation of duties prevents reviewing your own KPI performance.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_period FROM public.kpi_periods WHERE id = p_period_id;
    IF v_period IS NULL OR v_period.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI period not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_period.status = 'closed' THEN
        RAISE EXCEPTION 'Closed KPI periods are immutable and cannot be reviewed.' USING ERRCODE = '22023';
    END IF;

    SELECT e.* INTO v_emp
    FROM public.employees e
    JOIN public.organization_members om
      ON om.user_id = e.id
     AND om.organization_id = e.organization_id
     AND om.status = 'active'
    WHERE e.id = p_employee_id
      AND e.organization_id = v_org_id;

    IF v_emp IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Target employee not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role = 'manager' AND v_emp.manager_id IS DISTINCT FROM v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Managers can only submit KPI reviews for direct reports.' USING ERRCODE = '42501';
    END IF;

    IF p_rating IS NULL OR p_rating < 1.0 OR p_rating > 5.0 THEN
        RAISE EXCEPTION 'rating must be between 1.0 and 5.0.' USING ERRCODE = '22023';
    END IF;

    v_comment := pg_catalog.btrim(COALESCE(p_comment, ''));
    IF char_length(v_comment) < 1 THEN
        RAISE EXCEPTION 'Review comment cannot be empty.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_old_row
    FROM public.kpi_reviews
    WHERE period_id = p_period_id AND employee_id = p_employee_id
    FOR UPDATE;

    IF v_old_row IS NOT NULL THEN
        UPDATE public.kpi_reviews
        SET reviewer_id = v_caller_id,
            rating = ROUND(p_rating, 1),
            comment = v_comment,
            updated_at = pg_catalog.now()
        WHERE id = v_old_row.id
        RETURNING * INTO v_new_row;
    ELSE
        INSERT INTO public.kpi_reviews (
            organization_id, period_id, employee_id, reviewer_id, rating, comment
        ) VALUES (
            v_org_id, p_period_id, p_employee_id, v_caller_id, ROUND(p_rating, 1), v_comment
        )
        RETURNING * INTO v_new_row;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_REVIEW_SUBMITTED', 'kpi_reviews', v_new_row.id,
        CASE WHEN v_old_row IS NOT NULL THEN to_jsonb(v_old_row) ELSE NULL END,
        to_jsonb(v_new_row)
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_org_id,
        p_employee_id,
        'kpi_review',
        'KPI Review Posted',
        'Your performance review for "' || v_period.name || '" has been submitted (Rating: ' || ROUND(p_rating, 1)::text || '/5).',
        '/kpi?period=' || p_period_id::text,
        jsonb_build_object('period_id', p_period_id, 'review_id', v_new_row.id, 'rating', ROUND(p_rating, 1))
    );

    RETURN jsonb_build_object('success', true, 'review', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.submit_kpi_review(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_kpi_review(UUID, UUID, NUMERIC, TEXT) TO authenticated;

