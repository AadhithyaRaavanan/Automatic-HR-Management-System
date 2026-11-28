-- ============================================================================
-- Migration: 20261128000004_onboarding_org_scoping_and_durability.sql
-- Purpose:
--   1. Scope onboarding_profiles and onboarding_documents strictly by
--      organization_id so a single auth user invited to multiple organizations
--      maintains isolated candidate profiles, uploaded documents, HR decisions,
--      and payroll/bank details per organization.
--   2. Replace global uq_onboarding_user_id (user_id) with composite
--      (organization_id, user_id) uniqueness.
--   3. Harden RLS on onboarding_profiles, onboarding_documents, and profiles
--      so privileged HR/Admin reads require same-org membership + AAL2.
-- ============================================================================

-- 1. Add organization_id to onboarding_profiles & onboarding_documents and backfill deterministically
DO $$
DECLARE
    v_null_prof INTEGER;
    v_null_docs INTEGER;
BEGIN
    -- A. onboarding_profiles
    ALTER TABLE public.onboarding_profiles
        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

    UPDATE public.onboarding_profiles op
    SET organization_id = src.organization_id
    FROM (
        SELECT DISTINCT ON (employee_id) employee_id, organization_id
        FROM public.employee_onboarding_audit
        WHERE organization_id IS NOT NULL
        ORDER BY employee_id, created_at DESC
    ) src
    WHERE op.organization_id IS NULL
      AND op.user_id = src.employee_id;

    UPDATE public.onboarding_profiles op
    SET organization_id = e.organization_id
    FROM public.employees e
    WHERE op.organization_id IS NULL
      AND op.user_id = e.id
      AND e.organization_id IS NOT NULL;

    UPDATE public.onboarding_profiles op
    SET organization_id = src.organization_id
    FROM (
        SELECT user_id, MIN(organization_id::text)::uuid AS organization_id
        FROM public.organization_members
        WHERE status IN ('active', 'invited')
        GROUP BY user_id
        HAVING COUNT(DISTINCT organization_id) = 1
    ) src
    WHERE op.organization_id IS NULL
      AND op.user_id = src.user_id;

    ALTER TABLE public.onboarding_profiles DROP CONSTRAINT IF EXISTS uq_onboarding_user_id;
    DROP INDEX IF EXISTS public.uq_onboarding_user_id;
    CREATE UNIQUE INDEX IF NOT EXISTS uq_onboarding_org_user
        ON public.onboarding_profiles (organization_id, user_id);
    CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_org
        ON public.onboarding_profiles (organization_id, status);

    SELECT count(*) INTO v_null_prof FROM public.onboarding_profiles WHERE organization_id IS NULL;
    IF v_null_prof = 0 THEN
        ALTER TABLE public.onboarding_profiles ALTER COLUMN organization_id SET NOT NULL;
    END IF;

    -- B. onboarding_documents
    ALTER TABLE public.onboarding_documents
        ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

    UPDATE public.onboarding_documents od
    SET organization_id = op.organization_id
    FROM public.onboarding_profiles op
    WHERE od.organization_id IS NULL
      AND od.user_id = op.user_id
      AND op.organization_id IS NOT NULL;

    UPDATE public.onboarding_documents od
    SET organization_id = e.organization_id
    FROM public.employees e
    WHERE od.organization_id IS NULL
      AND od.user_id = e.id
      AND e.organization_id IS NOT NULL;

    UPDATE public.onboarding_documents od
    SET organization_id = src.organization_id
    FROM (
        SELECT user_id, MIN(organization_id::text)::uuid AS organization_id
        FROM public.organization_members
        WHERE status IN ('active', 'invited')
        GROUP BY user_id
        HAVING COUNT(DISTINCT organization_id) = 1
    ) src
    WHERE od.organization_id IS NULL
      AND od.user_id = src.user_id;

    CREATE INDEX IF NOT EXISTS idx_onboarding_documents_org_user
        ON public.onboarding_documents (organization_id, user_id);

    SELECT count(*) INTO v_null_docs FROM public.onboarding_documents WHERE organization_id IS NULL;
    IF v_null_docs = 0 THEN
        ALTER TABLE public.onboarding_documents ALTER COLUMN organization_id SET NOT NULL;
    END IF;
END $$;

-- 2. Strict trigger to derive or enforce organization_id on onboarding tables (never placeholder org fallback)
CREATE OR REPLACE FUNCTION public.trg_derive_onboarding_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        NEW.organization_id := public.current_org_id();

        IF NEW.organization_id IS NULL AND NEW.user_id IS NOT NULL THEN
            SELECT e.organization_id INTO NEW.organization_id
            FROM public.employees e
            WHERE e.id = NEW.user_id;

            IF NEW.organization_id IS NULL THEN
                SELECT MIN(om.organization_id::text)::uuid INTO NEW.organization_id
                FROM public.organization_members om
                WHERE om.user_id = NEW.user_id
                  AND om.status IN ('active', 'invited')
                GROUP BY om.user_id
                HAVING COUNT(DISTINCT om.organization_id) = 1;
            END IF;
        END IF;

        IF NEW.organization_id IS NULL THEN
            RAISE EXCEPTION 'organization_id is required on onboarding records (ambiguous multi-organization user).'
                USING ERRCODE = '23502';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_derive_onboarding_org_id() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS trg_derive_onboarding_profiles_org_id ON public.onboarding_profiles;
CREATE TRIGGER trg_derive_onboarding_profiles_org_id
    BEFORE INSERT ON public.onboarding_profiles
    FOR EACH ROW EXECUTE FUNCTION public.trg_derive_onboarding_org_id();

DROP TRIGGER IF EXISTS trg_derive_onboarding_documents_org_id ON public.onboarding_documents;
CREATE TRIGGER trg_derive_onboarding_documents_org_id
    BEFORE INSERT ON public.onboarding_documents
    FOR EACH ROW EXECUTE FUNCTION public.trg_derive_onboarding_org_id();

-- 3. Tighten RLS policies for onboarding_profiles, onboarding_documents, and profiles
DO $$
BEGIN
    -- onboarding_profiles
    DROP POLICY IF EXISTS "onboarding_profiles_user_rw" ON public.onboarding_profiles;
    DROP POLICY IF EXISTS "onboarding_profiles_admin_hr_all" ON public.onboarding_profiles;

    CREATE POLICY "onboarding_profiles_user_rw" ON public.onboarding_profiles
        FOR ALL TO authenticated
        USING (
            auth.uid() = user_id
            AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = onboarding_profiles.organization_id
                  AND om.user_id = auth.uid()
                  AND om.status IN ('active', 'invited')
            )
            AND (
                public.current_org_id() IS NULL
                OR organization_id = (SELECT public.current_org_id())
            )
        )
        WITH CHECK (
            auth.uid() = user_id
            AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = onboarding_profiles.organization_id
                  AND om.user_id = auth.uid()
                  AND om.status IN ('active', 'invited')
            )
            AND (
                public.current_org_id() IS NULL
                OR organization_id = (SELECT public.current_org_id())
            )
        );

    CREATE POLICY "onboarding_profiles_admin_hr_all" ON public.onboarding_profiles
        FOR SELECT TO authenticated
        USING (
            organization_id = (SELECT public.current_org_id())
            AND (SELECT public.is_active_org_member())
            AND (SELECT public.current_user_role()) IN ('hr', 'admin')
            AND (SELECT public.aal2_ok())
        );

    -- onboarding_documents
    DROP POLICY IF EXISTS "onboarding_documents_user_rw" ON public.onboarding_documents;
    DROP POLICY IF EXISTS "onboarding_documents_admin_hr_all" ON public.onboarding_documents;

    CREATE POLICY "onboarding_documents_user_rw" ON public.onboarding_documents
        FOR ALL TO authenticated
        USING (
            auth.uid() = user_id
            AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = onboarding_documents.organization_id
                  AND om.user_id = auth.uid()
                  AND om.status IN ('active', 'invited')
            )
            AND (
                public.current_org_id() IS NULL
                OR organization_id = (SELECT public.current_org_id())
            )
        )
        WITH CHECK (
            auth.uid() = user_id
            AND EXISTS (
                SELECT 1 FROM public.organization_members om
                WHERE om.organization_id = onboarding_documents.organization_id
                  AND om.user_id = auth.uid()
                  AND om.status IN ('active', 'invited')
            )
            AND (
                public.current_org_id() IS NULL
                OR organization_id = (SELECT public.current_org_id())
            )
        );

    CREATE POLICY "onboarding_documents_admin_hr_all" ON public.onboarding_documents
        FOR SELECT TO authenticated
        USING (
            organization_id = (SELECT public.current_org_id())
            AND (SELECT public.is_active_org_member())
            AND (SELECT public.current_user_role()) IN ('hr', 'admin')
            AND (SELECT public.aal2_ok())
        );

    -- Tighten profiles (account-wide user auth/tutorial sync) so admin/HR access is same-org scoped
    DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;

    CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
        FOR SELECT TO authenticated
        USING (
            auth.uid() = id
            OR auth.uid() = user_id
            OR (
                (SELECT public.is_active_org_member())
                AND (SELECT public.current_user_role()) IN ('hr', 'admin')
                AND (SELECT public.aal2_ok())
                AND EXISTS (
                    SELECT 1 FROM public.organization_members om
                    WHERE om.organization_id = (SELECT public.current_org_id())
                      AND om.user_id = profiles.id
                )
            )
        );

    CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
        FOR UPDATE TO authenticated
        USING (
            auth.uid() = id
            OR auth.uid() = user_id
            OR (
                (SELECT public.is_active_org_member())
                AND (SELECT public.current_user_role()) IN ('hr', 'admin')
                AND (SELECT public.aal2_ok())
                AND EXISTS (
                    SELECT 1 FROM public.organization_members om
                    WHERE om.organization_id = (SELECT public.current_org_id())
                      AND om.user_id = profiles.id
                )
            )
        );
END $$;
