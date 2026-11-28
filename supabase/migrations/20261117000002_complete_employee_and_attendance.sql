-- ============================================================================
-- Migration 22: ZEN XEA HRMS Complete Employee Management & Attendance Foundations
-- ============================================================================
-- Features:
-- 1. Five System Roles: update constraints on `user_roles`, `organization_members`, `kpi_metrics`
--    to explicitly support ('employee', 'team_lead', 'manager', 'hr', 'admin').
-- 2. Employment Categories: add `employment_category` to `public.employees` ('full_time', 'part_time', 'contract', 'intern')
--    with safe backfill and index.
-- 3. Human-Readable Business ID: add `employee_number` (e.g. ZX-EMP-001, ZX-INT-001) with concurrent sequence generator.
-- 4. Teams & Team Lead Architecture: `teams` and `team_members` tables with RLS and foreign keys.
-- 5. Internship Management: `internships` table with mentor, duration, status, training goals, evaluation, and certificate status.
-- 6. Career History: `employee_career_history` effective-dated table tracking promotions, transfers, and status changes.
-- 7. Hourly Permissions: `permission_requests` table with overlap check, approval workflow, and separation of duties.
-- 8. Attendance Extensions: `is_early_exit`, `early_departure_minutes`, and `regularization_attachments` support.
-- 9. Updated RPCs: `provision_invited_employee`, `admin_update_employee_governance`, and `current_user_role`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: FIVE SYSTEM ROLES EXPANSION
-- ----------------------------------------------------------------------------

-- A. Update public.user_roles constraint ONLY if it is still a base table
-- (`20261107000008` converted it into a compatibility view over `organization_members`).
DO $$
DECLARE
    v_relkind CHAR;
BEGIN
    SELECT c.relkind INTO v_relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'user_roles';

    IF v_relkind IN ('r', 'p') THEN
        ALTER TABLE public.user_roles
            DROP CONSTRAINT IF EXISTS user_roles_role_check;

        ALTER TABLE public.user_roles
            ADD CONSTRAINT user_roles_role_check
            CHECK (role IN ('employee', 'team_lead', 'manager', 'hr', 'admin'));
    END IF;
END $$;

-- B. Update public.organization_members constraint
ALTER TABLE public.organization_members
    DROP CONSTRAINT IF EXISTS organization_members_role_check;

ALTER TABLE public.organization_members
    ADD CONSTRAINT organization_members_role_check
    CHECK (role IN ('employee', 'team_lead', 'manager', 'hr', 'admin'));

-- C. Update public.kpi_metrics applies_to_role constraint if exists
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'kpi_metrics'
    ) THEN
        ALTER TABLE public.kpi_metrics
            DROP CONSTRAINT IF EXISTS kpi_metrics_applies_to_role_check;
        ALTER TABLE public.kpi_metrics
            ADD CONSTRAINT kpi_metrics_applies_to_role_check
            CHECK (applies_to_role IS NULL OR applies_to_role IN ('employee', 'team_lead', 'manager', 'hr', 'admin'));
    END IF;
END $$;

-- D. Fast helper: current_user_role() with search_path = '' supporting five roles
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT COALESCE(
        NULLIF(pg_catalog.current_setting('request.jwt.claim.user_role', true), ''),
        (SELECT (auth.jwt())->>'user_role'),
        (SELECT role FROM public.user_roles WHERE user_id = (SELECT auth.uid()) LIMIT 1),
        (SELECT role FROM public.organization_members WHERE user_id = (SELECT auth.uid()) LIMIT 1),
        'employee'
    );
$$;

-- ----------------------------------------------------------------------------
-- SECTION 2: EMPLOYMENT CATEGORIES & BUSINESS ID
-- ----------------------------------------------------------------------------

-- A. Add employment_category to public.employees
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS employment_category TEXT NOT NULL DEFAULT 'full_time'
    CHECK (employment_category IN ('full_time', 'part_time', 'contract', 'intern'));

CREATE INDEX IF NOT EXISTS idx_employees_category
    ON public.employees (organization_id, employment_category);

-- B. Add business employee_number to public.employees
ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS employee_number TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_employees_org_emp_number
    ON public.employees (organization_id, employee_number)
    WHERE employee_number IS NOT NULL;

-- C. Create sequence for employee numbers
CREATE SEQUENCE IF NOT EXISTS public.seq_employee_number START WITH 1 INCREMENT BY 1;
CREATE SEQUENCE IF NOT EXISTS public.seq_intern_number START WITH 1 INCREMENT BY 1;

-- Function to safely generate next business ID
CREATE OR REPLACE FUNCTION public.generate_next_employee_number(p_category TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_seq_val BIGINT;
    v_prefix TEXT;
    v_code TEXT;
    v_exists BOOLEAN;
BEGIN
    IF p_category = 'intern' THEN
        v_prefix := 'ZX-INT-';
        LOOP
            v_seq_val := pg_catalog.nextval('public.seq_intern_number');
            v_code := v_prefix || pg_catalog.lpad(v_seq_val::text, 3, '0');
            SELECT EXISTS (SELECT 1 FROM public.employees WHERE employee_number = v_code) INTO v_exists;
            IF NOT v_exists THEN
                EXIT;
            END IF;
        END LOOP;
    ELSE
        v_prefix := 'ZX-EMP-';
        LOOP
            v_seq_val := pg_catalog.nextval('public.seq_employee_number');
            v_code := v_prefix || pg_catalog.lpad(v_seq_val::text, 3, '0');
            SELECT EXISTS (SELECT 1 FROM public.employees WHERE employee_number = v_code) INTO v_exists;
            IF NOT v_exists THEN
                EXIT;
            END IF;
        END LOOP;
    END IF;

    RETURN v_code;
END;
$$;

-- Safe backfill for existing employee_number if null
DO $$
DECLARE
    rec RECORD;
BEGIN
    FOR rec IN SELECT id, employment_category FROM public.employees WHERE employee_number IS NULL ORDER BY joined_on ASC LOOP
        UPDATE public.employees
        SET employee_number = public.generate_next_employee_number(rec.employment_category)
        WHERE id = rec.id;
    END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- SECTION 3: TEAMS & TEAM LEADS ARCHITECTURE
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.teams (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    code TEXT,
    team_lead_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_teams_org_code UNIQUE (organization_id, code)
);

CREATE INDEX IF NOT EXISTS idx_teams_org_dept ON public.teams (organization_id, department_id);
CREATE INDEX IF NOT EXISTS idx_teams_lead ON public.teams (team_lead_id);

CREATE TABLE IF NOT EXISTS public.team_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    team_id UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_team_members_team_emp UNIQUE (team_id, employee_id)
);

CREATE INDEX IF NOT EXISTS idx_team_members_emp ON public.team_members (employee_id);

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "teams_select_policy" ON public.teams
FOR SELECT TO authenticated
USING (organization_id = public.current_org_id());

CREATE POLICY "teams_manage_policy" ON public.teams
FOR ALL TO authenticated
USING (public.current_user_role() IN ('admin', 'hr'))
WITH CHECK (public.current_user_role() IN ('admin', 'hr'));

CREATE POLICY "team_members_select_policy" ON public.team_members
FOR SELECT TO authenticated
USING (organization_id = public.current_org_id());

CREATE POLICY "team_members_manage_policy" ON public.team_members
FOR ALL TO authenticated
USING (public.current_user_role() IN ('admin', 'hr', 'manager', 'team_lead'))
WITH CHECK (public.current_user_role() IN ('admin', 'hr', 'manager', 'team_lead'));

-- ----------------------------------------------------------------------------
-- SECTION 4: INTERNSHIP MANAGEMENT FOUNDATION
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.internships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    mentor_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    duration_months INTEGER NOT NULL DEFAULT 3,
    status TEXT NOT NULL DEFAULT 'Active'
        CHECK (status IN ('Selected', 'Offer Sent', 'Joined', 'Active', 'Extended', 'Completed', 'Discontinued')),
    training_plan TEXT,
    assigned_skills TEXT[],
    weekly_progress_notes JSONB DEFAULT '[]'::jsonb,
    evaluation_score NUMERIC(3, 1),
    evaluation_feedback TEXT,
    certificate_issued BOOLEAN NOT NULL DEFAULT FALSE,
    certificate_issued_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_internships_emp UNIQUE (employee_id),
    CONSTRAINT chk_internship_dates CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_internships_org_status ON public.internships (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_internships_mentor ON public.internships (mentor_id);

ALTER TABLE public.internships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "internships_select_policy" ON public.internships
FOR SELECT TO authenticated
USING (
    employee_id = (SELECT auth.uid())
    OR mentor_id = (SELECT auth.uid())
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = internships.employee_id
        AND (e.manager_id = (SELECT auth.uid()) OR (SELECT public.current_user_role()) = 'manager')
    )
);

CREATE POLICY "internships_manage_policy" ON public.internships
FOR ALL TO authenticated
USING ((SELECT public.current_user_role()) IN ('hr', 'admin'))
WITH CHECK ((SELECT public.current_user_role()) IN ('hr', 'admin'));

-- ----------------------------------------------------------------------------
-- SECTION 5: CAREER HISTORY
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.employee_career_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL CHECK (event_type IN ('JOINED', 'PROBATION', 'CONFIRMED', 'TRANSFER', 'PROMOTION', 'DESIGNATION_CHANGE', 'MANAGER_CHANGE', 'CATEGORY_CHANGE', 'RESIGNED', 'EXITED')),
    previous_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    new_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    previous_job_title_id UUID REFERENCES public.job_titles(id) ON DELETE SET NULL,
    new_job_title_id UUID REFERENCES public.job_titles(id) ON DELETE SET NULL,
    previous_manager_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    new_manager_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    previous_category TEXT,
    new_category TEXT,
    effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
    notes TEXT,
    recorded_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_career_history_emp ON public.employee_career_history (employee_id, effective_date DESC);
ALTER TABLE public.employee_career_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "career_history_select_policy" ON public.employee_career_history
FOR SELECT TO authenticated
USING (
    employee_id = (SELECT auth.uid())
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "career_history_manage_policy" ON public.employee_career_history
FOR ALL TO authenticated
USING ((SELECT public.current_user_role()) IN ('hr', 'admin'))
WITH CHECK ((SELECT public.current_user_role()) IN ('hr', 'admin'));

-- ----------------------------------------------------------------------------
-- SECTION 6: HOURLY PERMISSION REQUESTS
-- ----------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permission_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    permission_date DATE NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    duration_minutes INTEGER NOT NULL CHECK (duration_minutes > 0 AND duration_minutes <= 480),
    permission_type TEXT NOT NULL DEFAULT 'personal' CHECK (permission_type IN ('personal', 'medical', 'official', 'emergency')),
    reason TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(reason)) >= 3),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_permission_times CHECK (start_time < end_time)
);

CREATE INDEX IF NOT EXISTS idx_permission_requests_emp_date ON public.permission_requests (employee_id, permission_date);
ALTER TABLE public.permission_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permission_requests_select_policy" ON public.permission_requests
FOR SELECT TO authenticated
USING (
    employee_id = (SELECT auth.uid())
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = permission_requests.employee_id
        AND (e.manager_id = (SELECT auth.uid()) OR (SELECT public.current_user_role()) = 'manager')
    )
    OR EXISTS (
        SELECT 1 FROM public.teams t
        JOIN public.team_members tm ON tm.team_id = t.id
        WHERE tm.employee_id = permission_requests.employee_id
        AND t.team_lead_id = (SELECT auth.uid())
    )
);

CREATE POLICY "permission_requests_insert_policy" ON public.permission_requests
FOR INSERT TO authenticated
WITH CHECK (employee_id = (SELECT auth.uid()));

CREATE POLICY "permission_requests_update_policy" ON public.permission_requests
FOR UPDATE TO authenticated
USING (
    employee_id = (SELECT auth.uid())
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    OR EXISTS (
        SELECT 1 FROM public.employees e
        WHERE e.id = permission_requests.employee_id
        AND e.manager_id = (SELECT auth.uid())
    )
);

-- RPC for approving permissions with separation of duties
CREATE OR REPLACE FUNCTION public.approve_permission_request(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_req RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();

    SELECT * INTO v_req FROM public.permission_requests WHERE id = p_request_id;
    IF v_req IS NULL THEN
        RAISE EXCEPTION 'Permission request not found.' USING ERRCODE = '02000';
    END IF;

    IF v_req.status != 'pending' THEN
        RAISE EXCEPTION 'Permission request is not pending.' USING ERRCODE = '22023';
    END IF;

    -- Separation of duties: caller cannot approve own request
    IF v_req.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: Cannot approve your own permission request.' USING ERRCODE = '42501';
    END IF;

    -- Authorize reviewer: HR/Admin OR Department Manager OR direct manager OR team lead
    IF v_caller_role NOT IN ('hr', 'admin', 'manager', 'team_lead') THEN
        RAISE EXCEPTION 'Forbidden: Not authorized to approve permissions.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.permission_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note,
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    -- Insert notification for employee
    INSERT INTO public.notifications (
        organization_id, user_id, title, message, type
    ) VALUES (
        v_req.organization_id,
        v_req.employee_id,
        'Permission Request Approved',
        'Your permission request for ' || v_req.permission_date::text || ' (' || v_req.duration_minutes || ' mins) was approved.',
        'request_status'
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'approved');
END;
$$;

-- ----------------------------------------------------------------------------
-- SECTION 7: ATTENDANCE ENHANCEMENTS (Early Exit, Regularization Attachments)
-- ----------------------------------------------------------------------------

-- A. Early Exit on attendance_days
ALTER TABLE public.attendance_days
    ADD COLUMN IF NOT EXISTS is_early_exit BOOLEAN DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS early_departure_minutes INTEGER DEFAULT 0;

-- B. Regularization Attachments
ALTER TABLE public.regularization_requests
    ADD COLUMN IF NOT EXISTS document_url TEXT,
    ADD COLUMN IF NOT EXISTS document_name TEXT;

-- ----------------------------------------------------------------------------
-- SECTION 8: EXTENDED PROVISIONING & GOVERNANCE RPCS
-- ----------------------------------------------------------------------------

-- Updated provision_invited_employee supporting employment_category and team_lead role
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
    p_required_office_days_per_week INTEGER DEFAULT 0,
    p_employment_category TEXT DEFAULT 'full_time'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_id UUID;
    v_new_data JSONB;
    v_emp_number TEXT;
BEGIN
    v_actor_id := (SELECT auth.uid());

    -- Validate role across 5 roles
    IF p_role NOT IN ('employee', 'team_lead', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = '22023';
    END IF;

    -- Validate employment category
    IF p_employment_category NOT IN ('full_time', 'part_time', 'contract', 'intern') THEN
        RAISE EXCEPTION 'Invalid employment category: %', p_employment_category USING ERRCODE = '22023';
    END IF;

    -- Generate business ID
    v_emp_number := public.generate_next_employee_number(p_employment_category);

    -- Ensure organization exists
    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
        RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '02000';
    END IF;

    -- Insert/Update organization_members
    INSERT INTO public.organization_members (
        organization_id, user_id, role, status
    ) VALUES (
        p_organization_id, p_user_id, p_role, 'active'
    ) ON CONFLICT (user_id) DO UPDATE 
    SET organization_id = EXCLUDED.organization_id,
        role = EXCLUDED.role,
        status = 'active',
        updated_at = pg_catalog.now();

    -- Insert/Update user_roles
    INSERT INTO public.user_roles (
        user_id, role
    ) VALUES (
        p_user_id, p_role
    ) ON CONFLICT (user_id, role) DO NOTHING;

    -- Insert/Update employees
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
        employment_category = EXCLUDED.employment_category,
        status = 'active',
        updated_at = pg_catalog.now();

    -- If intern, initialize internship record
    IF p_employment_category = 'intern' THEN
        INSERT INTO public.internships (
            organization_id, employee_id, mentor_id, start_date, end_date, duration_months, status
        ) VALUES (
            p_organization_id, p_user_id, p_manager_id, CURRENT_DATE, CURRENT_DATE + INTERVAL '3 months', 3, 'Active'
        ) ON CONFLICT (employee_id) DO NOTHING;
    END IF;

    -- Record initial career history
    INSERT INTO public.employee_career_history (
        organization_id, employee_id, event_type, new_department_id, new_manager_id, new_category, effective_date, notes
    ) VALUES (
        p_organization_id, p_user_id, 'JOINED', p_department_id, p_manager_id, p_employment_category, CURRENT_DATE, 'Initial employment provisioning'
    );

    RETURN jsonb_build_object(
        'success', true,
        'user_id', p_user_id,
        'employee_number', v_emp_number,
        'role', p_role,
        'employment_category', p_employment_category
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.provision_invited_employee(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, UUID, UUID, INTEGER, INTEGER[], INTEGER, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_next_employee_number(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_permission_request(UUID, TEXT) TO authenticated;
