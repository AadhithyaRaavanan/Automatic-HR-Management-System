-- ============================================================================
-- Migration: 20261128000002_reconcile_migrations_and_upgrades.sql
-- Purpose:
--   1. Guarantee idempotent presence of both job_titles department scoping
--      (20261120000002) and KPI Phase 5 improvements (20261120000004) on
--      installations that stopped or recorded only one 20261120000002 entry.
--   2. Forward-apply the 732bf1c hardenings (deterministic onboarding audit
--      attribution + RLS, and strict trg_derive_audit_log_org_id()) on
--      installations that already recorded an earlier 20261128000001 revision,
--      while preserving all existing historical records.
--   3. Reconcile supabase_migrations.schema_migrations version records safely.
-- ============================================================================

-- 1. Idempotently ensure job_titles department scoping exists (20261120000002)
DO $$
BEGIN
    ALTER TABLE public.job_titles
        ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE;

    ALTER TABLE public.job_titles DROP CONSTRAINT IF EXISTS uq_job_titles_org_title;
    DROP INDEX IF EXISTS public.uq_job_titles_org_dept_title;

    CREATE UNIQUE INDEX IF NOT EXISTS idx_job_titles_org_dept_title
        ON public.job_titles (
            organization_id,
            COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid),
            title_name
        );

    CREATE INDEX IF NOT EXISTS idx_job_titles_department
        ON public.job_titles (department_id);
END $$;

-- 2. Idempotently ensure KPI Phase 5 tables, columns & policies exist (20261120000004)
CREATE TABLE IF NOT EXISTS public.kpi_self_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    period_type TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    reflection TEXT NOT NULL CHECK (char_length(trim(reflection)) >= 20),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT kpi_self_reviews_unique UNIQUE (employee_id, period_start, period_end, period_type)
);

CREATE INDEX IF NOT EXISTS idx_kpi_self_reviews_lookup
    ON public.kpi_self_reviews (employee_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_kpi_self_reviews_org
    ON public.kpi_self_reviews (organization_id);

ALTER TABLE public.kpi_self_reviews ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_self_reviews_select' AND tablename = 'kpi_self_reviews') THEN
        CREATE POLICY "kpi_self_reviews_select" ON public.kpi_self_reviews
            FOR SELECT TO authenticated
            USING (
                employee_id = auth.uid()
                OR EXISTS (
                    SELECT 1 FROM public.employees e
                    WHERE e.id = kpi_self_reviews.employee_id
                      AND e.organization_id = kpi_self_reviews.organization_id
                      AND (e.manager_id = auth.uid() OR e.department_id IN (
                          SELECT department_id FROM public.employees WHERE id = auth.uid() AND organization_id = kpi_self_reviews.organization_id
                      ))
                )
                OR EXISTS (
                    SELECT 1 FROM public.organization_members om
                    WHERE om.user_id = auth.uid()
                      AND om.organization_id = kpi_self_reviews.organization_id
                      AND om.status = 'active'
                      AND om.role IN ('admin', 'hr')
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_self_reviews_insert_own' AND tablename = 'kpi_self_reviews') THEN
        CREATE POLICY "kpi_self_reviews_insert_own" ON public.kpi_self_reviews
            FOR INSERT TO authenticated
            WITH CHECK (employee_id = auth.uid());
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_self_reviews_update_own' AND tablename = 'kpi_self_reviews') THEN
        CREATE POLICY "kpi_self_reviews_update_own" ON public.kpi_self_reviews
            FOR UPDATE TO authenticated
            USING (employee_id = auth.uid())
            WITH CHECK (employee_id = auth.uid());
    END IF;
END $$;

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES public.kpi_goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON public.tasks(goal_id);

CREATE TABLE IF NOT EXISTS public.kpi_config_versions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL,
    config JSONB NOT NULL,
    effective_from DATE NOT NULL,
    reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 5),
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_kpi_config_versions_org_date
    ON public.kpi_config_versions (organization_id, effective_from DESC);

ALTER TABLE public.kpi_config_versions ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_config_versions_select' AND tablename = 'kpi_config_versions') THEN
        CREATE POLICY "kpi_config_versions_select" ON public.kpi_config_versions
            FOR SELECT TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.organization_members om
                    WHERE om.user_id = auth.uid()
                      AND om.organization_id = kpi_config_versions.organization_id
                      AND om.status = 'active'
                )
            );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_config_versions_admin_write' AND tablename = 'kpi_config_versions') THEN
        CREATE POLICY "kpi_config_versions_admin_write" ON public.kpi_config_versions
            FOR ALL TO authenticated
            USING (
                EXISTS (
                    SELECT 1 FROM public.organization_members om
                    WHERE om.user_id = auth.uid()
                      AND om.organization_id = kpi_config_versions.organization_id
                      AND om.status = 'active'
                      AND om.role IN ('admin', 'hr')
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.organization_members om
                    WHERE om.user_id = auth.uid()
                      AND om.organization_id = kpi_config_versions.organization_id
                      AND om.status = 'active'
                      AND om.role IN ('admin', 'hr')
                )
            );
    END IF;
END $$;

-- 3. Forward-apply deterministic employee_onboarding_audit ownership & RLS (for d985243..732bf1c upgrades)
DO $$
BEGIN
    IF to_regclass('public.employee_onboarding_audit') IS NOT NULL THEN
        ALTER TABLE public.employee_onboarding_audit
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

        UPDATE public.employee_onboarding_audit a
        SET organization_id = src.organization_id
        FROM (
            SELECT om.user_id, MIN(om.organization_id::text)::uuid AS organization_id
            FROM public.organization_members om
            WHERE om.status IN ('active', 'invited')
            GROUP BY om.user_id
            HAVING COUNT(DISTINCT om.organization_id) = 1
        ) src
        WHERE a.organization_id IS NULL
          AND a.performed_by IS NOT NULL
          AND a.performed_by IS DISTINCT FROM a.employee_id
          AND src.user_id = a.performed_by;

        UPDATE public.employee_onboarding_audit a
        SET organization_id = e.organization_id
        FROM public.employees e
        WHERE a.organization_id IS NULL
          AND e.id = a.employee_id;

        UPDATE public.employee_onboarding_audit a
        SET organization_id = src.organization_id
        FROM (
            SELECT om.user_id, MIN(om.organization_id::text)::uuid AS organization_id
            FROM public.organization_members om
            WHERE om.status IN ('active', 'invited')
            GROUP BY om.user_id
            HAVING COUNT(DISTINCT om.organization_id) = 1
        ) src
        WHERE a.organization_id IS NULL
          AND src.user_id = a.employee_id;

        CREATE INDEX IF NOT EXISTS idx_onboarding_audit_org_emp
            ON public.employee_onboarding_audit(organization_id, employee_id);

        DROP POLICY IF EXISTS "onboarding_audit_select_own_or_admin" ON public.employee_onboarding_audit;
        CREATE POLICY "onboarding_audit_select_own_or_admin" ON public.employee_onboarding_audit
            FOR SELECT TO authenticated
            USING (
                (
                    organization_id = (SELECT public.current_org_id())
                    AND (SELECT public.is_active_org_member())
                    AND (
                        employee_id = (SELECT auth.uid())
                        OR (
                            (SELECT public.current_user_role()) IN ('hr', 'admin')
                            AND (SELECT public.aal2_ok())
                        )
                    )
                )
                OR (
                    organization_id IS NULL
                    AND employee_id = (SELECT auth.uid())
                )
            );
    END IF;
END $$;

-- 4. Forward-apply strict audit_logs organization trigger (removes placeholder UUID fallback)
CREATE OR REPLACE FUNCTION public.trg_derive_audit_log_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        NEW.organization_id := public.current_org_id();

        IF NEW.organization_id IS NULL AND NEW.actor_id IS NOT NULL THEN
            SELECT e.organization_id INTO NEW.organization_id
            FROM public.employees e
            WHERE e.id = NEW.actor_id;

            IF NEW.organization_id IS NULL THEN
                SELECT MIN(om.organization_id::text)::uuid INTO NEW.organization_id
                FROM public.organization_members om
                WHERE om.user_id = NEW.actor_id
                  AND om.status IN ('active', 'invited')
                GROUP BY om.user_id
                HAVING COUNT(DISTINCT om.organization_id) = 1;
            END IF;
        END IF;

        IF NEW.organization_id IS NULL THEN
            RAISE EXCEPTION 'organization_id is required on audit_logs (no unambiguous organization context).'
                USING ERRCODE = '23502';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_derive_audit_log_org_id() FROM PUBLIC, anon;

-- 5. Reconcile supabase_migrations.schema_migrations for previously installed databases
DO $$
BEGIN
    IF to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
        -- Normalize 20261120000002 metadata if recorded under the old colliding name or NULL name
        UPDATE supabase_migrations.schema_migrations
        SET name = 'job_titles_department_scoping'
        WHERE version = '20261120000002'
          AND (name IS NULL OR name = '' OR name = 'kpi_improvements_phase5');

        -- If the DB had 20261120000002 or 20261128000001 recorded from before the split,
        -- ensure 20261120000004 (whose effects are idempotently applied above) is marked recorded.
        IF EXISTS (
            SELECT 1 FROM supabase_migrations.schema_migrations
            WHERE version IN ('20261120000002', '20261128000001')
        ) THEN
            INSERT INTO supabase_migrations.schema_migrations (version, name)
            VALUES ('20261120000002', 'job_titles_department_scoping')
            ON CONFLICT (version) DO NOTHING;

            INSERT INTO supabase_migrations.schema_migrations (version, name)
            VALUES ('20261120000004', 'kpi_improvements_phase5')
            ON CONFLICT (version) DO NOTHING;
        END IF;
    END IF;
END $$;
