-- ============================================================================
-- Migration: 20261115000019_mfa_policy_and_job_titles.sql
-- Description:
-- 1. Add require_mfa_for_privileged column to public.organizations.
-- 2. Create STABLE SECURITY DEFINER helpers: mfa_required_for_caller() and aal2_ok().
-- 3. Create job_titles table with organization scoping, indexes, and constraints.
-- 4. Add job_title_id and department_id columns to organization_members and employees.
-- 5. Create Admin-only RPCs for job titles (admin_create_job_title, admin_update_job_title, admin_delete_job_title).
-- 6. Create Admin-only RPC for organization MFA policy (admin_set_mfa_policy).
-- 7. Create Admin-only RPC for member title/dept assignment (admin_assign_employee_title_and_department).
-- 8. Replace aal2 checks in RESTRICTIVE policies and privileged RPCs with public.aal2_ok().
-- 9. Seed default departments and custom job titles for demo organization.
-- ============================================================================

-- 1. Add require_mfa_for_privileged to organizations
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS require_mfa_for_privileged BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. STABLE SECURITY DEFINER helpers
CREATE OR REPLACE FUNCTION public.mfa_required_for_caller()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_role TEXT;
    v_req_mfa BOOLEAN;
    v_has_totp BOOLEAN;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN FALSE;
    END IF;

    -- 1. Check if caller has an active verified TOTP factor in auth.mfa_factors
    SELECT EXISTS (
        SELECT 1 FROM auth.mfa_factors
        WHERE user_id = v_uid
          AND factor_type = 'totp'
          AND status = 'verified'
    ) INTO v_has_totp;

    IF v_has_totp THEN
        RETURN TRUE;
    END IF;

    -- 2. Check if caller is hr or admin in an organization where require_mfa_for_privileged is TRUE
    SELECT om.role, o.require_mfa_for_privileged
    INTO v_role, v_req_mfa
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_uid
      AND om.status = 'active'
    LIMIT 1;

    IF v_role IN ('hr', 'admin') AND COALESCE(v_req_mfa, TRUE) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.mfa_required_for_caller() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mfa_required_for_caller() TO authenticated;

CREATE OR REPLACE FUNCTION public.aal2_ok()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NOT public.mfa_required_for_caller() THEN
        RETURN TRUE;
    END IF;

    RETURN (COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2');
END;
$$;

REVOKE ALL ON FUNCTION public.aal2_ok() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aal2_ok() TO authenticated;

-- 3. Job Titles Table
CREATE TABLE IF NOT EXISTS public.job_titles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    title_name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_job_titles_org_title UNIQUE (organization_id, title_name)
);

CREATE INDEX IF NOT EXISTS idx_job_titles_org ON public.job_titles (organization_id);

-- 4. Add columns to organization_members and employees
ALTER TABLE public.organization_members
    ADD COLUMN IF NOT EXISTS job_title_id UUID REFERENCES public.job_titles(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS job_title_id UUID REFERENCES public.job_titles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_org_members_job_title ON public.organization_members (job_title_id);
CREATE INDEX IF NOT EXISTS idx_org_members_department ON public.organization_members (department_id);
CREATE INDEX IF NOT EXISTS idx_employees_job_title ON public.employees (job_title_id);

-- RLS for job_titles
ALTER TABLE public.job_titles ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.job_titles TO authenticated;

CREATE POLICY "tenant_job_titles_select_policy" ON public.job_titles
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "enforce_active_org_membership_job_titles" ON public.job_titles
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 5. Admin RPCs for Job Titles (writes strictly through admin RPCs)
CREATE OR REPLACE FUNCTION public.admin_create_job_title(
    p_title_name TEXT,
    p_description TEXT DEFAULT NULL
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
    v_new_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Admins can create job titles.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.aal2_ok() THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for administrative updates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Organization not found.' USING ERRCODE = '42501';
    END IF;

    IF p_title_name IS NULL OR length(trim(p_title_name)) = 0 THEN
        RAISE EXCEPTION 'Job title name cannot be empty.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.job_titles (organization_id, title_name, description)
    VALUES (v_caller_org, trim(p_title_name), p_description)
    RETURNING id INTO v_new_id;

    v_new_data := jsonb_build_object('id', v_new_id, 'title_name', trim(p_title_name), 'description', p_description);

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'JOB_TITLE_CREATED', 'job_titles', v_new_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'id', v_new_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_job_title(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_create_job_title(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_job_title(
    p_id UUID,
    p_title_name TEXT,
    p_description TEXT DEFAULT NULL
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
    v_target_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Admins can update job titles.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.aal2_ok() THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for administrative updates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(j.*)
    INTO v_target_org, v_old_data
    FROM public.job_titles j
    WHERE id = p_id;

    IF v_target_org IS NULL OR v_target_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Job title not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF p_title_name IS NULL OR length(trim(p_title_name)) = 0 THEN
        RAISE EXCEPTION 'Job title name cannot be empty.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.job_titles
    SET title_name = trim(p_title_name),
        description = p_description,
        updated_at = pg_catalog.now()
    WHERE id = p_id
    RETURNING to_jsonb(job_titles.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'JOB_TITLE_UPDATED', 'job_titles', p_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'id', p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_job_title(UUID, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_job_title(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_job_title(
    p_id UUID
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
    v_target_org UUID;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Admins can delete job titles.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.aal2_ok() THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for administrative updates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(j.*)
    INTO v_target_org, v_old_data
    FROM public.job_titles j
    WHERE id = p_id;

    IF v_target_org IS NULL OR v_target_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Job title not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    DELETE FROM public.job_titles WHERE id = p_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'JOB_TITLE_DELETED', 'job_titles', p_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'id', p_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_job_title(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_job_title(UUID) TO authenticated;

-- 6. Admin RPC for Organization MFA Policy (admin_set_mfa_policy)
CREATE OR REPLACE FUNCTION public.admin_set_mfa_policy(
    p_require_mfa BOOLEAN
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
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Admins can change organization MFA policies.' USING ERRCODE = '42501';
    END IF;

    -- "Only an admin at aal2 may change the setting"
    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for updating MFA policy.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Organization not found.' USING ERRCODE = '42501';
    END IF;

    SELECT jsonb_build_object('require_mfa_for_privileged', require_mfa_for_privileged)
    INTO v_old_data
    FROM public.organizations
    WHERE id = v_caller_org;

    UPDATE public.organizations
    SET require_mfa_for_privileged = p_require_mfa,
        updated_at = pg_catalog.now()
    WHERE id = v_caller_org;

    v_new_data := jsonb_build_object('require_mfa_for_privileged', p_require_mfa);

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'ORGANIZATION_MFA_POLICY_UPDATED', 'organizations', v_caller_org, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'require_mfa_for_privileged', p_require_mfa);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_mfa_policy(BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_mfa_policy(BOOLEAN) TO authenticated;

-- 7. Update RESTRICTIVE policies to use public.aal2_ok()
DROP POLICY IF EXISTS "enforce_mfa_aal2_employees" ON public.employees;
CREATE POLICY "enforce_mfa_aal2_employees" ON public.employees
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_organization_members" ON public.organization_members;
CREATE POLICY "enforce_mfa_aal2_organization_members" ON public.organization_members
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_organizations" ON public.organizations;
CREATE POLICY "enforce_mfa_aal2_organizations" ON public.organizations
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_locations" ON public.locations;
CREATE POLICY "enforce_mfa_aal2_locations" ON public.locations
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_shift_templates" ON public.shift_templates;
CREATE POLICY "enforce_mfa_aal2_shift_templates" ON public.shift_templates
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_shift_assignments" ON public.employee_shift_assignments;
CREATE POLICY "enforce_mfa_aal2_shift_assignments" ON public.employee_shift_assignments
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_kiosk_devices" ON public.kiosk_devices;
CREATE POLICY "enforce_mfa_aal2_kiosk_devices" ON public.kiosk_devices
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_holidays" ON public.holidays;
CREATE POLICY "enforce_mfa_aal2_holidays" ON public.holidays
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_leave_types" ON public.leave_types;
CREATE POLICY "enforce_mfa_aal2_leave_types" ON public.leave_types
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_leave_policies" ON public.leave_policies;
CREATE POLICY "enforce_mfa_aal2_leave_policies" ON public.leave_policies
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_leave_balances" ON public.leave_balances;
CREATE POLICY "enforce_mfa_aal2_leave_balances" ON public.leave_balances
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_leave_balance_adjustments" ON public.leave_balance_adjustments;
CREATE POLICY "enforce_mfa_aal2_leave_balance_adjustments" ON public.leave_balance_adjustments
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_leave_requests" ON public.leave_requests;
CREATE POLICY "enforce_mfa_aal2_leave_requests" ON public.leave_requests
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_privacy_acknowledgments" ON public.privacy_acknowledgments;
CREATE POLICY "enforce_mfa_aal2_privacy_acknowledgments" ON public.privacy_acknowledgments
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_retention_policies" ON public.retention_policies;
CREATE POLICY "enforce_mfa_aal2_retention_policies" ON public.retention_policies
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_retention_archives" ON public.retention_archives;
CREATE POLICY "enforce_mfa_aal2_retention_archives" ON public.retention_archives
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_tasks" ON public.tasks;
CREATE POLICY "enforce_mfa_aal2_tasks" ON public.tasks
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_task_comments" ON public.task_comments;
CREATE POLICY "enforce_mfa_aal2_task_comments" ON public.task_comments
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_task_events" ON public.task_events;
CREATE POLICY "enforce_mfa_aal2_task_events" ON public.task_events
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_task_time_logs" ON public.task_time_logs;
CREATE POLICY "enforce_mfa_aal2_task_time_logs" ON public.task_time_logs
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_definitions" ON public.kpi_definitions;
CREATE POLICY "enforce_mfa_aal2_kpi_definitions" ON public.kpi_definitions
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_periods" ON public.kpi_periods;
CREATE POLICY "enforce_mfa_aal2_kpi_periods" ON public.kpi_periods
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_reviews" ON public.kpi_reviews;
CREATE POLICY "enforce_mfa_aal2_kpi_reviews" ON public.kpi_reviews
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_scores" ON public.kpi_scores;
CREATE POLICY "enforce_mfa_aal2_kpi_scores" ON public.kpi_scores
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN public.aal2_ok()
        ELSE true 
    END
);

-- 8. Replace aal2 checks in privileged RPCs with public.aal2_ok()
-- admin_update_employee_governance
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

    IF NOT public.aal2_ok() THEN
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

    IF p_department_id IS NOT NULL THEN
        UPDATE public.organization_members
        SET department_id = p_department_id,
            updated_at = pg_catalog.now()
        WHERE user_id = p_employee_id AND organization_id = v_caller_org;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'EMPLOYEE_UPDATED', 'employees', p_employee_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'employee_id', p_employee_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_employee_governance(UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_governance(UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) TO authenticated;

-- 9. Seed default departments and job titles for default demo organization
DO $$
DECLARE
    v_demo_org_id UUID := '00000000-0000-0000-0000-000000000001';
    v_eng_dept_id UUID := '00000000-0000-0000-0000-000000000010';
    v_hr_dept_id UUID := '00000000-0000-0000-0000-000000000012';
    v_pd_dept_id UUID := '00000000-0000-0000-0000-000000000013';
    v_mkt_dept_id UUID := '00000000-0000-0000-0000-000000000014';

    v_jt_fullstack UUID := '00000000-0000-0000-0000-000000000021';
    v_jt_seo UUID := '00000000-0000-0000-0000-000000000022';
    v_jt_qa UUID := '00000000-0000-0000-0000-000000000023';
    v_jt_pm UUID := '00000000-0000-0000-0000-000000000024';
BEGIN
    IF EXISTS (SELECT 1 FROM public.organizations WHERE id = v_demo_org_id) THEN
        -- Seed Departments
        INSERT INTO public.departments (id, organization_id, name, code)
        VALUES
            (v_eng_dept_id, v_demo_org_id, 'Engineering', 'ENG'),
            (v_hr_dept_id, v_demo_org_id, 'People Operations', 'HR'),
            (v_pd_dept_id, v_demo_org_id, 'Product & Design', 'PD'),
            (v_mkt_dept_id, v_demo_org_id, 'Marketing & Growth', 'MKT')
        ON CONFLICT (organization_id, code) DO NOTHING;

        -- Seed Job Titles
        INSERT INTO public.job_titles (id, organization_id, title_name, description)
        VALUES
            (v_jt_fullstack, v_demo_org_id, 'Full Stack Developer', 'Designs and builds frontend applications and backend APIs'),
            (v_jt_seo, v_demo_org_id, 'SEO Analyst', 'Optimizes organic search traffic and technical search architecture'),
            (v_jt_qa, v_demo_org_id, 'QA Lead', 'Leads automated test suites, quality gates, and verification pipelines'),
            (v_jt_pm, v_demo_org_id, 'Product Manager', 'Directs product strategy, backlog priorities, and team execution')
        ON CONFLICT (organization_id, title_name) DO NOTHING;

        -- Attach to demo users
        UPDATE public.employees
        SET department_id = v_eng_dept_id, job_title_id = v_jt_fullstack
        WHERE id = '00000000-0000-0000-0000-000000000004' AND organization_id = v_demo_org_id;

        UPDATE public.organization_members
        SET department_id = v_eng_dept_id, job_title_id = v_jt_fullstack
        WHERE user_id = '00000000-0000-0000-0000-000000000004' AND organization_id = v_demo_org_id;

        UPDATE public.employees
        SET department_id = v_hr_dept_id
        WHERE id = '00000000-0000-0000-0000-000000000002' AND organization_id = v_demo_org_id;

        UPDATE public.organization_members
        SET department_id = v_hr_dept_id
        WHERE user_id = '00000000-0000-0000-0000-000000000002' AND organization_id = v_demo_org_id;

        UPDATE public.employees
        SET department_id = v_eng_dept_id, job_title_id = v_jt_pm
        WHERE id = '00000000-0000-0000-0000-000000000003' AND organization_id = v_demo_org_id;

        UPDATE public.organization_members
        SET department_id = v_eng_dept_id, job_title_id = v_jt_pm
        WHERE user_id = '00000000-0000-0000-0000-000000000003' AND organization_id = v_demo_org_id;
    END IF;
END;
$$;
