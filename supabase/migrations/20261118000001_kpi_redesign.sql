-- ============================================================================
-- Migration: 20261118000001_kpi_redesign.sql
-- Description: Reconciles legacy `kpi_reviews` (period_id, rating, comment) with
--              redesigned dated reviews (period_type, period_start, period_end, ratings, note),
--              adds `kpi_goals` and `kpi_adjustments` with tenant isolation + strict RLS.
-- ============================================================================

-- 1. Ensure `kpi_reviews` exists (for isolated fresh runs) and upgrade legacy table safely
CREATE TABLE IF NOT EXISTS public.kpi_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_id UUID REFERENCES public.kpi_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    rating NUMERIC(3,1),
    comment TEXT,
    period_type TEXT,
    period_start DATE,
    period_end DATE,
    ratings JSONB,
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_kpi_reviews_no_self_review CHECK (reviewer_id IS DISTINCT FROM employee_id)
);

-- Upgrade legacy `kpi_reviews` schema while preserving 100% of existing historical rows
DO $$
BEGIN
    -- Make legacy-only NOT NULL columns nullable so dated v2 reviews can be inserted
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kpi_reviews' AND column_name = 'period_id' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE public.kpi_reviews ALTER COLUMN period_id DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kpi_reviews' AND column_name = 'rating' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE public.kpi_reviews ALTER COLUMN rating DROP NOT NULL;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kpi_reviews' AND column_name = 'comment' AND is_nullable = 'NO'
    ) THEN
        ALTER TABLE public.kpi_reviews ALTER COLUMN comment DROP NOT NULL;
    END IF;
END $$;

ALTER TABLE public.kpi_reviews
    ADD COLUMN IF NOT EXISTS period_type TEXT,
    ADD COLUMN IF NOT EXISTS period_start DATE,
    ADD COLUMN IF NOT EXISTS period_end DATE,
    ADD COLUMN IF NOT EXISTS ratings JSONB,
    ADD COLUMN IF NOT EXISTS note TEXT;

-- Backfill legacy `kpi_reviews` rows from `kpi_periods`, preserving exact IDs, ratings, and comments
DO $$
DECLARE
    v_has_imm BOOLEAN := FALSE;
BEGIN
    SELECT EXISTS (
        SELECT 1 FROM pg_trigger
        WHERE tgname = 'trg_kpi_reviews_immutable'
          AND tgrelid = 'public.kpi_reviews'::regclass
    ) INTO v_has_imm;

    IF v_has_imm THEN
        ALTER TABLE public.kpi_reviews DISABLE TRIGGER trg_kpi_reviews_immutable;
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'kpi_reviews' AND column_name = 'period_id'
    ) THEN
        UPDATE public.kpi_reviews kr
        SET
            period_type = COALESCE(kr.period_type, kp.period_type, 'monthly'),
            period_start = COALESCE(kr.period_start, kp.start_date),
            period_end = COALESCE(kr.period_end, kp.end_date),
            ratings = COALESCE(kr.ratings, CASE WHEN kr.rating IS NOT NULL THEN jsonb_build_object('overall', kr.rating) ELSE '{}'::jsonb END),
            note = COALESCE(kr.note, kr.comment)
        FROM public.kpi_periods kp
        WHERE kr.period_id = kp.id
          AND (kr.period_start IS NULL OR kr.period_end IS NULL OR kr.ratings IS NULL OR kr.note IS NULL);
    END IF;

    IF v_has_imm THEN
        ALTER TABLE public.kpi_reviews ENABLE TRIGGER trg_kpi_reviews_immutable;
    END IF;
END $$;

-- Reconcile constraints idempotently (supports both legacy period_id reviews and v2 dated reviews)
DO $$
BEGIN
    ALTER TABLE public.kpi_reviews DROP CONSTRAINT IF EXISTS kpi_reviews_period_type_check;
    ALTER TABLE public.kpi_reviews ADD CONSTRAINT kpi_reviews_period_type_check
        CHECK (period_type IS NULL OR period_type IN ('monthly', 'quarterly'));

    ALTER TABLE public.kpi_reviews DROP CONSTRAINT IF EXISTS kpi_reviews_note_check;
    ALTER TABLE public.kpi_reviews ADD CONSTRAINT kpi_reviews_note_check
        CHECK (
            note IS NULL
            OR period_id IS NOT NULL
            OR char_length(trim(note)) >= 5
        );
END $$;

-- Derive organization_id automatically on kpi_reviews when inserted via v2 routes without explicit org_id
CREATE OR REPLACE FUNCTION public.trg_derive_kpi_reviews_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.employees
        WHERE id = NEW.employee_id;
    END IF;
    IF NEW.period_type IS NULL AND NEW.period_id IS NOT NULL THEN
        SELECT period_type, start_date, end_date
        INTO NEW.period_type, NEW.period_start, NEW.period_end
        FROM public.kpi_periods
        WHERE id = NEW.period_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_kpi_reviews_org_id ON public.kpi_reviews;
CREATE TRIGGER trg_derive_kpi_reviews_org_id
    BEFORE INSERT OR UPDATE ON public.kpi_reviews
    FOR EACH ROW EXECUTE FUNCTION public.trg_derive_kpi_reviews_org_id();

-- Keep closed-period immutability trigger safe when period_id is NULL (v2 dated reviews)
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
    IF v_period_id IS NOT NULL THEN
        SELECT status INTO v_status FROM public.kpi_periods WHERE id = v_period_id;
        IF v_status = 'closed' THEN
            RAISE EXCEPTION 'KPI records belonging to a closed period are immutable.' USING ERRCODE = '22023';
        END IF;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TABLE IF NOT EXISTS public.kpi_goals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    set_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    title TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('not_started', 'on_track', 'at_risk', 'done')) DEFAULT 'not_started',
    note TEXT,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.kpi_goals
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE TABLE IF NOT EXISTS public.kpi_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    metric TEXT NOT NULL,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    override_value NUMERIC NOT NULL,
    reason TEXT NOT NULL CHECK (char_length(trim(reason)) >= 5),
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.kpi_adjustments
    ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.trg_derive_kpi_emp_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.employees
        WHERE id = NEW.employee_id;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_derive_kpi_goals_org_id ON public.kpi_goals;
CREATE TRIGGER trg_derive_kpi_goals_org_id
    BEFORE INSERT OR UPDATE ON public.kpi_goals
    FOR EACH ROW EXECUTE FUNCTION public.trg_derive_kpi_emp_org_id();

DROP TRIGGER IF EXISTS trg_derive_kpi_adjustments_org_id ON public.kpi_adjustments;
CREATE TRIGGER trg_derive_kpi_adjustments_org_id
    BEFORE INSERT OR UPDATE ON public.kpi_adjustments
    FOR EACH ROW EXECUTE FUNCTION public.trg_derive_kpi_emp_org_id();

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_kpi_reviews_emp ON public.kpi_reviews (employee_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_kpi_goals_emp ON public.kpi_goals (employee_id, period_start, period_end);
CREATE INDEX IF NOT EXISTS idx_kpi_adjustments_emp ON public.kpi_adjustments (employee_id, metric, period_start, period_end);

-- RLS: Tenant-scoped own-read; writes through server APIs using supabaseAdmin or verified RPCs
ALTER TABLE public.kpi_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_adjustments ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_reviews_select_own' AND tablename = 'kpi_reviews') THEN
        CREATE POLICY "kpi_reviews_select_own" ON public.kpi_reviews
            FOR SELECT TO authenticated
            USING (employee_id = auth.uid() AND organization_id = (SELECT public.current_org_id()));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_goals_select_own' AND tablename = 'kpi_goals') THEN
        CREATE POLICY "kpi_goals_select_own" ON public.kpi_goals
            FOR SELECT TO authenticated
            USING (employee_id = auth.uid() AND (organization_id IS NULL OR organization_id = (SELECT public.current_org_id())));
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'kpi_adjustments_select_own' AND tablename = 'kpi_adjustments') THEN
        CREATE POLICY "kpi_adjustments_select_own" ON public.kpi_adjustments
            FOR SELECT TO authenticated
            USING (employee_id = auth.uid() AND (organization_id IS NULL OR organization_id = (SELECT public.current_org_id())));
    END IF;
END $$;
