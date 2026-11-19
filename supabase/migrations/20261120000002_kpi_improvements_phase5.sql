-- ============================================================================
-- Migration: 20261120000002_kpi_improvements_phase5.sql
-- Description: KPI Self-Reviews, Goal Links on Tasks, and Versioned KPI Configs
-- ============================================================================

-- 1. KPI Self-Reviews Table
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
                      AND (e.manager_id = auth.uid() OR e.department_id IN (
                          SELECT department_id FROM public.employees WHERE id = auth.uid()
                      ))
                )
                OR EXISTS (
                    SELECT 1 FROM public.organization_members om
                    WHERE om.user_id = auth.uid()
                      AND om.organization_id = kpi_self_reviews.organization_id
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

-- 2. Link Tasks to KPI Goals (Nullable column, optional)
ALTER TABLE public.tasks 
    ADD COLUMN IF NOT EXISTS goal_id UUID REFERENCES public.kpi_goals(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_goal_id ON public.tasks(goal_id);

-- 3. Versioned KPI Settings Table for HR/Admin
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
                      AND om.role IN ('admin', 'hr')
                )
            )
            WITH CHECK (
                EXISTS (
                    SELECT 1 FROM public.organization_members om
                    WHERE om.user_id = auth.uid()
                      AND om.organization_id = kpi_config_versions.organization_id
                      AND om.role IN ('admin', 'hr')
                )
            );
    END IF;
END $$;
