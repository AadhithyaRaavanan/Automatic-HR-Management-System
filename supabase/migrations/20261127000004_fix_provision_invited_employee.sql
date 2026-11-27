-- Migration: 20261127000004_fix_provision_invited_employee.sql
-- Fixes overloaded provision_invited_employee signatures and removes invalid
-- INSERT INTO public.user_roles (user_roles is a read-only view over organization_members).
-- Also ensures department_id and job_title_id remain nullable on employees and organization_members.

DO $$
BEGIN
    ALTER TABLE public.employees ALTER COLUMN department_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.employees ALTER COLUMN job_title_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.organization_members ALTER COLUMN department_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$
BEGIN
    ALTER TABLE public.organization_members ALTER COLUMN job_title_id DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DROP FUNCTION IF EXISTS public.provision_invited_employee(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, INTEGER[], INTEGER
);

DROP FUNCTION IF EXISTS public.provision_invited_employee(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, INTEGER[], INTEGER, TEXT
);

CREATE OR REPLACE FUNCTION public.provision_invited_employee(
    p_user_id UUID,
    p_organization_id UUID,
    p_email TEXT,
    p_full_name TEXT,
    p_role TEXT DEFAULT 'employee',
    p_work_mode TEXT DEFAULT 'remote',
    p_timezone TEXT DEFAULT 'Asia/Kolkata',
    p_department_id UUID DEFAULT NULL,
    p_manager_id UUID DEFAULT NULL,
    p_primary_location_id UUID DEFAULT NULL,
    p_work_target_minutes INTEGER DEFAULT 480,
    p_expected_office_days INTEGER[] DEFAULT '{1,2,3,4,5}',
    p_required_office_days_per_week INTEGER DEFAULT 0,
    p_employment_category TEXT DEFAULT 'full_time'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing_member_org UUID;
    v_existing_emp_org UUID;
    v_emp_number TEXT;
BEGIN
    IF p_role NOT IN ('employee', 'team_lead', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = '22023';
    END IF;

    IF p_work_mode NOT IN ('remote', 'office', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work mode: %', p_work_mode USING ERRCODE = '22023';
    END IF;

    IF p_employment_category NOT IN ('full_time', 'part_time', 'contract', 'intern') THEN
        RAISE EXCEPTION 'Invalid employment category: %', p_employment_category USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
        RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '02000';
    END IF;

    SELECT organization_id INTO v_existing_member_org
    FROM public.organization_members
    WHERE user_id = p_user_id;

    IF v_existing_member_org IS NOT NULL AND v_existing_member_org IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Cross-tenant violation: User already belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    SELECT organization_id INTO v_existing_emp_org
    FROM public.employees
    WHERE id = p_user_id;

    IF v_existing_emp_org IS NOT NULL AND v_existing_emp_org IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Cross-tenant violation: Employee already belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    BEGIN
        v_emp_number := public.generate_next_employee_number(p_employment_category);
    EXCEPTION WHEN undefined_function THEN
        v_emp_number := NULL;
    END;

    INSERT INTO public.organization_members (
        organization_id, user_id, role, department_id, status
    ) VALUES (
        p_organization_id, p_user_id, p_role, p_department_id, 'active'
    ) ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        department_id = EXCLUDED.department_id,
        status = 'active',
        updated_at = pg_catalog.now()
    WHERE public.organization_members.organization_id = p_organization_id;

    INSERT INTO public.employees (
        id,
        organization_id,
        email,
        full_name,
        work_mode,
        timezone,
        department_id,
        manager_id,
        primary_location_id,
        work_target_minutes,
        expected_office_days,
        required_office_days_per_week,
        employment_category,
        employee_number,
        status
    ) VALUES (
        p_user_id,
        p_organization_id,
        p_email,
        p_full_name,
        p_work_mode,
        p_timezone,
        p_department_id,
        p_manager_id,
        p_primary_location_id,
        p_work_target_minutes,
        p_expected_office_days,
        p_required_office_days_per_week,
        p_employment_category,
        v_emp_number,
        'active'
    ) ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        work_mode = EXCLUDED.work_mode,
        timezone = EXCLUDED.timezone,
        department_id = EXCLUDED.department_id,
        manager_id = EXCLUDED.manager_id,
        primary_location_id = EXCLUDED.primary_location_id,
        work_target_minutes = EXCLUDED.work_target_minutes,
        expected_office_days = EXCLUDED.expected_office_days,
        required_office_days_per_week = EXCLUDED.required_office_days_per_week,
        employment_category = EXCLUDED.employment_category,
        status = 'active',
        updated_at = pg_catalog.now()
    WHERE public.employees.organization_id = p_organization_id;

    IF p_employment_category = 'intern' AND to_regclass('public.internships') IS NOT NULL THEN
        INSERT INTO public.internships (
            organization_id, employee_id, mentor_id, start_date, end_date, duration_months, status
        ) VALUES (
            p_organization_id, p_user_id, p_manager_id, CURRENT_DATE, CURRENT_DATE + INTERVAL '3 months', 3, 'Active'
        ) ON CONFLICT (employee_id) DO NOTHING;
    END IF;

    IF to_regclass('public.employee_career_history') IS NOT NULL THEN
        INSERT INTO public.employee_career_history (
            organization_id, employee_id, event_type, new_department_id, new_manager_id, new_category, effective_date, notes
        ) VALUES (
            p_organization_id, p_user_id, 'JOINED', p_department_id, p_manager_id, p_employment_category, CURRENT_DATE, 'Initial employment provisioning'
        );
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'employee_number', v_emp_number,
        'role', p_role,
        'employment_category', p_employment_category
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_invited_employee(
    UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, INTEGER[], INTEGER, TEXT
) TO authenticated, service_role;
