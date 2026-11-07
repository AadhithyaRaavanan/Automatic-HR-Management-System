-- ============================================================================
-- MIGRATION 9: Phase 3 Organization Admin Panel & Foundation Hardening
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: Foundation Hardening - Replace admin_create_employee
-- ----------------------------------------------------------------------------

-- Drop old direct auth.users inserting function
DROP FUNCTION IF EXISTS public.admin_create_employee(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID);
DROP FUNCTION IF EXISTS public.admin_create_employee;

-- Provision invited employee (Callable ONLY by service_role after Supabase Auth invite)
CREATE OR REPLACE FUNCTION public.provision_invited_employee(
    p_user_id UUID,
    p_organization_id UUID,
    p_email TEXT,
    p_full_name TEXT,
    p_role TEXT DEFAULT 'employee',
    p_work_mode TEXT DEFAULT 'remote',
    p_timezone TEXT DEFAULT 'UTC',
    p_department_id UUID DEFAULT NULL,
    p_manager_id UUID DEFAULT NULL,
    p_primary_location_id UUID DEFAULT NULL,
    p_work_target_minutes INTEGER DEFAULT 480,
    p_expected_office_days INTEGER[] DEFAULT '{1,2,3,4,5}',
    p_required_office_days_per_week INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_new_data JSONB;
BEGIN
    v_actor_id := (SELECT auth.uid());

    -- Validate role
    IF p_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = '22023';
    END IF;

    -- Validate work mode
    IF p_work_mode NOT IN ('remote', 'office', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work mode: %', p_work_mode USING ERRCODE = '22023';
    END IF;

    -- Ensure organization exists
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
        RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '02000';
    END IF;

    -- Create or update organization_members record
    INSERT INTO public.organization_members (
        organization_id, user_id, role, status
    ) VALUES (
        p_organization_id, p_user_id, p_role, 'active'
    ) ON CONFLICT (user_id) DO UPDATE 
    SET organization_id = EXCLUDED.organization_id,
        role = EXCLUDED.role,
        status = 'active',
        updated_at = pg_catalog.now();

    -- Create or update employees record
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
        'active'
    ) ON CONFLICT (id) DO UPDATE
    SET organization_id = EXCLUDED.organization_id,
        email = EXCLUDED.email,
        full_name = EXCLUDED.full_name,
        work_mode = EXCLUDED.work_mode,
        timezone = EXCLUDED.timezone,
        department_id = EXCLUDED.department_id,
        manager_id = EXCLUDED.manager_id,
        primary_location_id = EXCLUDED.primary_location_id,
        work_target_minutes = EXCLUDED.work_target_minutes,
        expected_office_days = EXCLUDED.expected_office_days,
        required_office_days_per_week = EXCLUDED.required_office_days_per_week,
        status = 'active',
        updated_at = pg_catalog.now();

    v_new_data := jsonb_build_object(
        'email', p_email,
        'full_name', p_full_name,
        'role', p_role,
        'work_mode', p_work_mode,
        'timezone', p_timezone,
        'department_id', p_department_id,
        'manager_id', p_manager_id
    );

    INSERT INTO public.audit_logs (
        organization_id,
        actor_id,
        action,
        table_name,
        record_id,
        old_data,
        new_data
    ) VALUES (
        p_organization_id,
        COALESCE(v_actor_id, p_user_id),
        'EMPLOYEE_CREATED',
        'employees',
        p_user_id,
        NULL,
        v_new_data
    );

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.provision_invited_employee(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, INTEGER[], INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.provision_invited_employee(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, INTEGER[], INTEGER) TO service_role;


-- ----------------------------------------------------------------------------
-- SECTION 2: Organization Immutability & Employee Timezone Protection Triggers
-- ----------------------------------------------------------------------------

-- A. Organizations status and id immutability trigger
CREATE OR REPLACE FUNCTION public.protect_organization_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        RAISE EXCEPTION 'Forbidden: Organization status is immutable through direct API updates.' USING ERRCODE = '42501';
    END IF;

    IF NEW.id IS DISTINCT FROM OLD.id THEN
        RAISE EXCEPTION 'Forbidden: Organization ID is immutable.' USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_organization_fields ON public.organizations;
CREATE TRIGGER trg_protect_organization_fields
    BEFORE UPDATE ON public.organizations
    FOR EACH ROW
    EXECUTE FUNCTION public.protect_organization_fields();

REVOKE ALL ON FUNCTION public.protect_organization_fields() FROM PUBLIC, anon, authenticated;

-- B. Updated check_employee_field_protection (handles NULL role cleanly with IS DISTINCT FROM)
CREATE OR REPLACE FUNCTION public.check_employee_field_protection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
BEGIN
    v_role := public.current_user_role();

    IF (
        NEW.manager_id IS DISTINCT FROM OLD.manager_id OR
        NEW.status IS DISTINCT FROM OLD.status OR
        NEW.work_mode IS DISTINCT FROM OLD.work_mode OR
        NEW.primary_location_id IS DISTINCT FROM OLD.primary_location_id OR
        NEW.work_target_minutes IS DISTINCT FROM OLD.work_target_minutes OR
        NEW.expected_office_days IS DISTINCT FROM OLD.expected_office_days OR
        NEW.required_office_days_per_week IS DISTINCT FROM OLD.required_office_days_per_week OR
        NEW.organization_id IS DISTINCT FROM OLD.organization_id OR
        NEW.department_id IS DISTINCT FROM OLD.department_id
    ) THEN
        IF v_role IS DISTINCT FROM 'hr' AND v_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'Forbidden: Only HR or Admins can modify sensitive employee governance fields.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF (NEW.timezone IS DISTINCT FROM OLD.timezone) THEN
        IF v_role IS DISTINCT FROM 'hr' AND v_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'Forbidden: Only HR or Admins can modify employee timezone.' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_employee_field_protection() FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- SECTION 3: Main Multitenancy Composite Indexes
-- ----------------------------------------------------------------------------

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_org_emp_work_date 
    ON public.attendance_sessions (organization_id, employee_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_org_checkin 
    ON public.attendance_sessions (organization_id, check_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_days_org_emp_date 
    ON public.attendance_days (organization_id, employee_id, work_date);

CREATE INDEX IF NOT EXISTS idx_attendance_days_org_date 
    ON public.attendance_days (organization_id, work_date);

CREATE INDEX IF NOT EXISTS idx_employees_org_status 
    ON public.employees (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_employees_org_manager 
    ON public.employees (organization_id, manager_id);

CREATE INDEX IF NOT EXISTS idx_regularization_requests_org_status 
    ON public.regularization_requests (organization_id, status);

CREATE INDEX IF NOT EXISTS idx_regularization_requests_org_emp 
    ON public.regularization_requests (organization_id, employee_id, work_date);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created 
    ON public.audit_logs (organization_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_action 
    ON public.audit_logs (organization_id, action, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_org_user 
    ON public.notifications (organization_id, user_id, created_at DESC);


-- ----------------------------------------------------------------------------
-- SECTION 4: Departments Table & Hierarchy Cycle Prevention
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.departments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    department_head_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    parent_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_departments_org_code UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_departments_org ON public.departments (organization_id);
CREATE INDEX IF NOT EXISTS idx_departments_parent ON public.departments (parent_department_id);

-- Add department_id to employees
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_employees_org_dept ON public.employees (organization_id, department_id);

-- A. Department hierarchy cycle prevention trigger
CREATE OR REPLACE FUNCTION public.check_department_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_cycle BOOLEAN;
BEGIN
    IF NEW.parent_department_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.parent_department_id = NEW.id THEN
        RAISE EXCEPTION 'Cannot set department as its own parent.' USING ERRCODE = '22000';
    END IF;

    WITH RECURSIVE dept_ancestors AS (
        SELECT id, parent_department_id, 1 as depth
        FROM public.departments
        WHERE id = NEW.parent_department_id
        UNION ALL
        SELECT d.id, d.parent_department_id, da.depth + 1
        FROM public.departments d
        JOIN dept_ancestors da ON d.id = da.parent_department_id
        WHERE da.depth < 100
    )
    SELECT EXISTS (
        SELECT 1 FROM dept_ancestors WHERE id = NEW.id
    ) INTO v_cycle;

    IF v_cycle THEN
        RAISE EXCEPTION 'Cannot assign parent department: would create a circular department hierarchy.' USING ERRCODE = '22000';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_department_cycle ON public.departments;
CREATE TRIGGER trg_prevent_department_cycle
    BEFORE INSERT OR UPDATE OF parent_department_id ON public.departments
    FOR EACH ROW
    EXECUTE FUNCTION public.check_department_cycle();

REVOKE ALL ON FUNCTION public.check_department_cycle() FROM PUBLIC, anon, authenticated;

-- B. Employee manager hierarchy cycle prevention trigger
CREATE OR REPLACE FUNCTION public.check_employee_manager_cycle()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
    v_cycle BOOLEAN;
BEGIN
    IF NEW.manager_id IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.manager_id = NEW.id THEN
        RAISE EXCEPTION 'Cannot assign employee as their own manager.' USING ERRCODE = '22000';
    END IF;

    WITH RECURSIVE manager_chain AS (
        SELECT id, manager_id, 1 as depth
        FROM public.employees
        WHERE id = NEW.manager_id
        UNION ALL
        SELECT e.id, e.manager_id, mc.depth + 1
        FROM public.employees e
        JOIN manager_chain mc ON e.id = mc.manager_id
        WHERE mc.depth < 100
    )
    SELECT EXISTS (
        SELECT 1 FROM manager_chain WHERE id = NEW.id
    ) INTO v_cycle;

    IF v_cycle THEN
        RAISE EXCEPTION 'Cannot assign manager: would create a circular reporting hierarchy.' USING ERRCODE = '22000';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_employee_manager_cycle ON public.employees;
CREATE TRIGGER trg_prevent_employee_manager_cycle
    BEFORE INSERT OR UPDATE OF manager_id ON public.employees
    FOR EACH ROW
    EXECUTE FUNCTION public.check_employee_manager_cycle();

REVOKE ALL ON FUNCTION public.check_employee_manager_cycle() FROM PUBLIC, anon, authenticated;


-- ----------------------------------------------------------------------------
-- SECTION 5: Location & Shift Additions
-- ----------------------------------------------------------------------------

-- Add updated_at to locations if not already present
ALTER TABLE public.locations ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now();


-- ----------------------------------------------------------------------------
-- SECTION 6: Phase 3 Administrative RPCs (With old_data and new_data in audit)
-- ----------------------------------------------------------------------------

-- A. admin_update_employee_governance (HR or Admin at aal2)
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
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_emp_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can modify employee governance.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for administrative updates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(e.*)
    INTO v_emp_org, v_old_data
    FROM public.employees e
    WHERE id = p_employee_id;

    IF v_emp_org IS NULL OR v_emp_org != v_caller_org THEN
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

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'EMPLOYEE_UPDATED', 'employees', p_employee_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'employee_id', p_employee_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_employee_governance(UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_employee_governance(UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) TO authenticated;


-- B. admin_deactivate_member (Admin at aal2 with Last Admin Protection)
CREATE OR REPLACE FUNCTION public.admin_deactivate_member(
    p_user_id UUID
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
    v_target_role TEXT;
    v_target_org UUID;
    v_admin_count INTEGER;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can deactivate members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for member deactivation.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    -- Advisory lock on organization members
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('org_members_' || v_caller_org::text));

    -- Post-lock role verification
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT organization_id, role, to_jsonb(m.*)
    INTO v_target_org, v_target_role, v_old_data
    FROM public.organization_members m
    WHERE user_id = p_user_id;

    IF v_target_org IS NULL OR v_target_org != v_caller_org THEN
        RAISE EXCEPTION 'Member not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    -- Last admin check
    IF v_target_role = 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            RAISE EXCEPTION 'Last admin protection: Cannot deactivate the sole active administrator.' USING ERRCODE = '23514';
        END IF;
    END IF;

    UPDATE public.organization_members
    SET status = 'suspended', updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    UPDATE public.employees
    SET status = 'inactive', updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND id = p_user_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'MEMBER_DEACTIVATED', 'organization_members', p_user_id, v_old_data, jsonb_build_object('status', 'suspended')
    );

    RETURN jsonb_build_object('success', true, 'user_id', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_deactivate_member(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_deactivate_member(UUID) TO authenticated;


-- C. Department RPCs (admin_create_department, admin_update_department, admin_delete_department)
CREATE OR REPLACE FUNCTION public.admin_create_department(
    p_name TEXT,
    p_code TEXT,
    p_department_head_id UUID DEFAULT NULL,
    p_parent_department_id UUID DEFAULT NULL
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
    v_dept_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can create departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_department_head_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_department_head_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Department head does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_parent_department_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_parent_department_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Parent department does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO public.departments (
        organization_id, name, code, department_head_id, parent_department_id
    ) VALUES (
        v_caller_org, p_name, p_code, p_department_head_id, p_parent_department_id
    ) RETURNING id INTO v_dept_id;

    v_new_data := jsonb_build_object(
        'name', p_name,
        'code', p_code,
        'department_head_id', p_department_head_id,
        'parent_department_id', p_parent_department_id
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'DEPARTMENT_CREATED', 'departments', v_dept_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'department_id', v_dept_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_department(TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_department(TEXT, TEXT, UUID, UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_update_department(
    p_department_id UUID,
    p_name TEXT,
    p_code TEXT,
    p_department_head_id UUID DEFAULT NULL,
    p_parent_department_id UUID DEFAULT NULL
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
    v_dept_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can update departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(d.*)
    INTO v_dept_org, v_old_data
    FROM public.departments d
    WHERE id = p_department_id;

    IF v_dept_org IS NULL OR v_dept_org != v_caller_org THEN
        RAISE EXCEPTION 'Department not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF p_department_head_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_department_head_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Department head does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    IF p_parent_department_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_parent_department_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Parent department does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    UPDATE public.departments
    SET name = p_name,
        code = p_code,
        department_head_id = p_department_head_id,
        parent_department_id = p_parent_department_id,
        updated_at = pg_catalog.now()
    WHERE id = p_department_id
    RETURNING to_jsonb(departments.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'DEPARTMENT_UPDATED', 'departments', p_department_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'department_id', p_department_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_department(UUID, TEXT, TEXT, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_department(UUID, TEXT, TEXT, UUID, UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_department(
    p_department_id UUID
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
    v_dept_org UUID;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can delete departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(d.*)
    INTO v_dept_org, v_old_data
    FROM public.departments d
    WHERE id = p_department_id;

    IF v_dept_org IS NULL OR v_dept_org != v_caller_org THEN
        RAISE EXCEPTION 'Department not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    -- Reassign child departments
    UPDATE public.departments
    SET parent_department_id = NULL
    WHERE parent_department_id = p_department_id;

    -- Reassign employees
    UPDATE public.employees
    SET department_id = NULL
    WHERE department_id = p_department_id;

    DELETE FROM public.departments WHERE id = p_department_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'DEPARTMENT_DELETED', 'departments', p_department_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'department_id', p_department_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_department(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_department(UUID) TO authenticated;


-- D. Location RPCs (admin_create_location, admin_update_location, admin_delete_location)
CREATE OR REPLACE FUNCTION public.admin_create_location(
    p_name TEXT,
    p_code TEXT,
    p_address TEXT DEFAULT NULL,
    p_timezone TEXT DEFAULT 'UTC',
    p_working_hours INTEGER DEFAULT 480,
    p_weekly_off_days INTEGER[] DEFAULT '{0, 6}'
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
    v_loc_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can create locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    INSERT INTO public.locations (
        organization_id, name, code, address, timezone, working_hours, weekly_off_days
    ) VALUES (
        v_caller_org, p_name, p_code, p_address, p_timezone, p_working_hours, p_weekly_off_days
    ) RETURNING id INTO v_loc_id;

    v_new_data := jsonb_build_object(
        'name', p_name,
        'code', p_code,
        'address', p_address,
        'timezone', p_timezone,
        'working_hours', p_working_hours,
        'weekly_off_days', p_weekly_off_days
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LOCATION_CREATED', 'locations', v_loc_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'location_id', v_loc_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_location(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_location(TEXT, TEXT, TEXT, TEXT, INTEGER, INTEGER[]) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_update_location(
    p_location_id UUID,
    p_name TEXT,
    p_address TEXT DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL,
    p_working_hours INTEGER DEFAULT NULL,
    p_weekly_off_days INTEGER[] DEFAULT NULL
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
    v_loc_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(l.*)
    INTO v_loc_org, v_old_data
    FROM public.locations l
    WHERE id = p_location_id;

    IF v_loc_org IS NULL OR v_loc_org != v_caller_org THEN
        RAISE EXCEPTION 'Location not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    UPDATE public.locations
    SET name = p_name,
        address = COALESCE(p_address, address),
        timezone = COALESCE(p_timezone, timezone),
        working_hours = COALESCE(p_working_hours, working_hours),
        weekly_off_days = COALESCE(p_weekly_off_days, weekly_off_days),
        updated_at = pg_catalog.now()
    WHERE id = p_location_id
    RETURNING to_jsonb(locations.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LOCATION_UPDATED', 'locations', p_location_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'location_id', p_location_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_location(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_location(UUID, TEXT, TEXT, TEXT, INTEGER, INTEGER[]) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_location(
    p_location_id UUID
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
    v_loc_org UUID;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can delete locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(l.*)
    INTO v_loc_org, v_old_data
    FROM public.locations l
    WHERE id = p_location_id;

    IF v_loc_org IS NULL OR v_loc_org != v_caller_org THEN
        RAISE EXCEPTION 'Location not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    -- Unlink employees
    UPDATE public.employees
    SET primary_location_id = NULL
    WHERE primary_location_id = p_location_id;

    DELETE FROM public.locations WHERE id = p_location_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LOCATION_DELETED', 'locations', p_location_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'location_id', p_location_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_location(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_location(UUID) TO authenticated;


-- E. Shift Template RPCs (admin_create_shift_template, admin_update_shift_template, admin_delete_shift_template, admin_assign_shift)
CREATE OR REPLACE FUNCTION public.admin_create_shift_template(
    p_name TEXT,
    p_code TEXT,
    p_start_time TIME,
    p_end_time TIME,
    p_break_minutes INTEGER DEFAULT 60,
    p_grace_minutes INTEGER DEFAULT 15
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
    v_shift_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can create shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    INSERT INTO public.shift_templates (
        organization_id, name, code, start_time, end_time, break_duration_minutes, grace_minutes
    ) VALUES (
        v_caller_org, p_name, p_code, p_start_time, p_end_time, p_break_minutes, p_grace_minutes
    ) RETURNING id INTO v_shift_id;

    v_new_data := jsonb_build_object(
        'name', p_name,
        'code', p_code,
        'start_time', p_start_time,
        'end_time', p_end_time,
        'break_minutes', p_break_minutes,
        'grace_minutes', p_grace_minutes
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_CREATED', 'shift_templates', v_shift_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'shift_template_id', v_shift_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_shift_template(TEXT, TEXT, TIME, TIME, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_shift_template(TEXT, TEXT, TIME, TIME, INTEGER, INTEGER) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_update_shift_template(
    p_shift_id UUID,
    p_name TEXT,
    p_start_time TIME,
    p_end_time TIME,
    p_break_minutes INTEGER DEFAULT 60,
    p_grace_minutes INTEGER DEFAULT 15
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
    v_shift_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(s.*)
    INTO v_shift_org, v_old_data
    FROM public.shift_templates s
    WHERE id = p_shift_id;

    IF v_shift_org IS NULL OR v_shift_org != v_caller_org THEN
        RAISE EXCEPTION 'Shift template not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    UPDATE public.shift_templates
    SET name = p_name,
        start_time = p_start_time,
        end_time = p_end_time,
        break_duration_minutes = p_break_minutes,
        grace_minutes = p_grace_minutes
    WHERE id = p_shift_id
    RETURNING to_jsonb(shift_templates.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_UPDATED', 'shift_templates', p_shift_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'shift_template_id', p_shift_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_shift_template(UUID, TEXT, TIME, TIME, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_shift_template(UUID, TEXT, TIME, TIME, INTEGER, INTEGER) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_delete_shift_template(
    p_shift_id UUID
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
    v_shift_org UUID;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can delete shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(s.*)
    INTO v_shift_org, v_old_data
    FROM public.shift_templates s
    WHERE id = p_shift_id;

    IF v_shift_org IS NULL OR v_shift_org != v_caller_org THEN
        RAISE EXCEPTION 'Shift template not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    DELETE FROM public.employee_shift_assignments WHERE shift_template_id = p_shift_id;
    DELETE FROM public.shift_templates WHERE id = p_shift_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_DELETED', 'shift_templates', p_shift_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'shift_template_id', p_shift_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_delete_shift_template(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_shift_template(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_assign_shift(
    p_employee_id UUID,
    p_shift_template_id UUID,
    p_effective_from DATE,
    p_effective_to DATE DEFAULT NULL
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
    v_assignment_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can assign shifts.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to assign shifts.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Employee does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.shift_templates WHERE id = p_shift_template_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Shift template does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    -- Close prior open-ended assignments for this employee
    UPDATE public.employee_shift_assignments
    SET effective_to = p_effective_from - 1
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND (effective_to IS NULL OR effective_to >= p_effective_from)
      AND effective_from < p_effective_from;

    -- Delete any assignments starting on or after p_effective_from to avoid conflict
    DELETE FROM public.employee_shift_assignments
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND effective_from >= p_effective_from;

    INSERT INTO public.employee_shift_assignments (
        organization_id, employee_id, shift_template_id, effective_from, effective_to
    ) VALUES (
        v_caller_org, p_employee_id, p_shift_template_id, p_effective_from, p_effective_to
    ) RETURNING id INTO v_assignment_id;

    v_new_data := jsonb_build_object(
        'employee_id', p_employee_id,
        'shift_template_id', p_shift_template_id,
        'effective_from', p_effective_from,
        'effective_to', p_effective_to
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_ASSIGNED', 'employee_shift_assignments', v_assignment_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'assignment_id', v_assignment_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_assign_shift(UUID, UUID, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_assign_shift(UUID, UUID, DATE, DATE) TO authenticated;


-- F. Organization Settings & Attendance Policy RPCs
CREATE OR REPLACE FUNCTION public.admin_update_organization_settings(
    p_name TEXT,
    p_timezone TEXT,
    p_work_mode TEXT
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
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update organization settings.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update organization settings.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_work_mode NOT IN ('remote', 'office', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work mode: %', p_work_mode USING ERRCODE = '22023';
    END IF;

    SELECT to_jsonb(o.*) INTO v_old_data FROM public.organizations o WHERE id = v_caller_org;

    UPDATE public.organizations
    SET name = p_name,
        timezone = p_timezone,
        work_mode = p_work_mode,
        updated_at = pg_catalog.now()
    WHERE id = v_caller_org
    RETURNING to_jsonb(organizations.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'ORGANIZATION_UPDATED', 'organizations', v_caller_org, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'organization_id', v_caller_org);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_organization_settings(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_organization_settings(TEXT, TEXT, TEXT) TO authenticated;


CREATE OR REPLACE FUNCTION public.admin_update_attendance_policy(
    p_grace_minutes INTEGER,
    p_half_day_minutes INTEGER,
    p_auto_checkout_time TIME
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
    v_old_data JSONB;
    v_new_data JSONB;
    v_policy_id UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update attendance policy.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update attendance policy.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT id, to_jsonb(p.*) INTO v_policy_id, v_old_data
    FROM public.attendance_policies p
    WHERE organization_id = v_caller_org;

    IF v_policy_id IS NULL THEN
        INSERT INTO public.attendance_policies (
            organization_id, grace_minutes, half_day_minutes, auto_checkout_time
        ) VALUES (
            v_caller_org, p_grace_minutes, p_half_day_minutes, p_auto_checkout_time
        ) RETURNING id, to_jsonb(attendance_policies.*) INTO v_policy_id, v_new_data;
    ELSE
        UPDATE public.attendance_policies
        SET grace_minutes = p_grace_minutes,
            half_day_minutes = p_half_day_minutes,
            auto_checkout_time = p_auto_checkout_time,
            updated_at = pg_catalog.now()
        WHERE id = v_policy_id
        RETURNING to_jsonb(attendance_policies.*) INTO v_new_data;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'POLICY_UPDATED', 'attendance_policies', v_policy_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'policy_id', v_policy_id);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_attendance_policy(INTEGER, INTEGER, TIME) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_attendance_policy(INTEGER, INTEGER, TIME) TO authenticated;


-- ----------------------------------------------------------------------------
-- SECTION 7: RLS Policies for Departments & Table Grants
-- ----------------------------------------------------------------------------

ALTER TABLE public.departments ENABLE ROW LEVEL SECURITY;

-- Revoke all table-wide write permissions
REVOKE ALL ON public.departments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.departments TO authenticated;

-- Policies
DROP POLICY IF EXISTS "departments_select_policy" ON public.departments;
CREATE POLICY "departments_select_policy" ON public.departments
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

DROP POLICY IF EXISTS "enforce_active_org_membership_departments" ON public.departments;
CREATE POLICY "enforce_active_org_membership_departments" ON public.departments
    AS RESTRICTIVE
    FOR ALL TO authenticated
    USING (public.is_active_org_member());
