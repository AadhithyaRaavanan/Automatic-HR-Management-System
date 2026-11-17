-- ============================================================================
-- Migration: 20261118000001_kpi_redesign.sql
-- Description: Redesigned KPI System (Reviews, Goals, Adjustments) with strict RLS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kpi_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    ratings JSONB NOT NULL,
    note TEXT NOT NULL CHECK (char_length(trim(note)) >= 5),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.kpi_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    set_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('not_started', 'on_track', 'at_risk', 'done')) DEFAULT 'not_started',
    note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE TABLE IF NOT EXISTS public.kpi_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    override_value NUMERIC NOT NULL,
    reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 5),
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_kpi_reviews_emp ON public.kpi_reviews (employee_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_kpi_goals_emp ON public.kpi_goals (employee_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_kpi_adjustments_emp ON public.kpi_adjustments (employee_id, metric, period_start, period_end);

-- RLS: Employees may SELECT their own rows only; writes only through server APIs using supabaseAdmin
ALTER TABLE public.kpi_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_adjustments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_reviews_select_own' AND tablename = 'kpi_reviews') THEN
        CREATE POLICY "kpi_reviews_select_own" ON public.kpi_reviews
            FOR SELECT TO authenticated
            USING (employee_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_goals_select_own' AND tablename = 'kpi_goals') THEN
        CREATE POLICY "kpi_goals_select_own" ON public.kpi_goals
            FOR SELECT TO authenticated
            USING (employee_id = auth.uid());
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_adjustments_select_own' AND tablename = 'kpi_adjustments') THEN
        CREATE POLICY "kpi_adjustments_select_own" ON public.kpi_adjustments
            FOR SELECT TO authenticated
            USING (employee_id = auth.uid());
    END IF;
END $$;
