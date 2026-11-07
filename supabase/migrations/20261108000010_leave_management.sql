-- ============================================================================
-- Migration 10: Comprehensive Tenant-Scoped Leave Management Module
--
-- Features:
-- 1. Tenant-scoped tables: leave_types, leave_policies, leave_balances,
--    leave_requests, leave_balance_adjustments, company_days_off
-- 2. Organization settings: leave_year_start_month (1-12), combined_monthly_leave_cap
-- 3. Working days calculation: excludes weekly offs (from location/default) & holidays
-- 4. Overlap protection: GiST exclusion constraint on active daterange
-- 5. Concurrency & Balance safety: SELECT ... FOR UPDATE on leave_balances
-- 6. Month-locking protection: refuses approval/cancellation touching locked months
-- 7. Separation of duties: no self-approval, HR cannot approve/assign/adjust for self
-- 8. Pro-rating: allocate_yearly_balances pro-rates for mid-year joiners
-- 9. Complete RLS policies, zero direct client writes, audited RPCs
-- ============================================================================

-- Enable btree_gist extension for composite GiST exclusion constraints
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ----------------------------------------------------------------------------
-- SECTION 1: Organization Settings for Leave Management
-- ----------------------------------------------------------------------------
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS leave_year_start_month INTEGER NOT NULL DEFAULT 1
        CHECK (leave_year_start_month BETWEEN 1 AND 12),
    ADD COLUMN IF NOT EXISTS combined_monthly_leave_cap NUMERIC(5, 2) DEFAULT NULL
        CHECK (combined_monthly_leave_cap IS NULL OR combined_monthly_leave_cap > 0);

-- ----------------------------------------------------------------------------
-- SECTION 2: Leave Module Tables
-- ----------------------------------------------------------------------------

-- 1. Leave Types
CREATE TABLE IF NOT EXISTS public.leave_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    description TEXT,
    is_paid BOOLEAN NOT NULL DEFAULT TRUE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_leave_type_code_per_org UNIQUE (organization_id, code)
);

-- 2. Leave Policies
CREATE TABLE IF NOT EXISTS public.leave_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
    yearly_quota NUMERIC(5, 2) NOT NULL DEFAULT 12 CHECK (yearly_quota >= 0),
    monthly_cap NUMERIC(5, 2) DEFAULT NULL CHECK (monthly_cap IS NULL OR monthly_cap > 0),
    carry_forward_max NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (carry_forward_max >= 0),
    probation_allowed BOOLEAN NOT NULL DEFAULT TRUE,
    effective_from DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_policy_per_leave_type UNIQUE (organization_id, leave_type_id)
);

-- 3. Leave Balances
CREATE TABLE IF NOT EXISTS public.leave_balances (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    allocated NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (allocated >= 0),
    used NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (used >= 0),
    carried_forward NUMERIC(5, 2) NOT NULL DEFAULT 0 CHECK (carried_forward >= 0),
    adjusted NUMERIC(5, 2) NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_leave_balance UNIQUE (organization_id, employee_id, leave_type_id, period_start, period_end),
    CONSTRAINT chk_period_validity CHECK (period_start <= period_end)
);

-- 4. Leave Requests
CREATE TABLE IF NOT EXISTS public.leave_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE RESTRICT,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    day_part TEXT NOT NULL DEFAULT 'full' CHECK (day_part IN ('full', 'first_half', 'second_half')),
    total_days NUMERIC(5, 2) NOT NULL CHECK (total_days > 0),
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
    reviewed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_leave_request_dates CHECK (start_date <= end_date),
    CONSTRAINT exclude_overlapping_leave_requests EXCLUDE USING gist (
        employee_id WITH =,
        daterange(start_date, end_date, '[]') WITH &&
    ) WHERE (status IN ('pending', 'approved'))
);

-- 5. Leave Balance Adjustments
CREATE TABLE IF NOT EXISTS public.leave_balance_adjustments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    leave_type_id UUID NOT NULL REFERENCES public.leave_types(id) ON DELETE CASCADE,
    adjusted_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    amount NUMERIC(5, 2) NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 6. Company Days Off
CREATE TABLE IF NOT EXISTS public.company_days_off (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    department_id UUID REFERENCES public.departments(id) ON DELETE CASCADE,
    date DATE NOT NULL,
    title TEXT NOT NULL,
    declared_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_company_day_off UNIQUE (organization_id, department_id, date)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_leave_balances_emp ON public.leave_balances (organization_id, employee_id, leave_type_id);
CREATE INDEX IF NOT EXISTS idx_leave_requests_emp ON public.leave_requests (organization_id, employee_id, status);
CREATE INDEX IF NOT EXISTS idx_leave_requests_dates ON public.leave_requests (organization_id, start_date, end_date);

-- ----------------------------------------------------------------------------
-- SECTION 3: Helper Functions
-- ----------------------------------------------------------------------------

-- Calculates working days for an employee between two dates
-- Excludes weekly offs (from primary location or default {0, 6}) and holidays/company days off
CREATE OR REPLACE FUNCTION public.calculate_working_days(
    p_employee_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_day_part TEXT DEFAULT 'full'
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
    v_dept_id UUID;
    v_loc_id UUID;
    v_weekly_offs INTEGER[];
    v_curr DATE;
    v_dow INTEGER;
    v_count NUMERIC := 0;
    v_is_holiday BOOLEAN;
BEGIN
    IF p_start_date > p_end_date THEN
        RETURN 0;
    END IF;

    -- If half day, start and end date must match
    IF p_day_part IN ('first_half', 'second_half') THEN
        IF p_start_date != p_end_date THEN
            RAISE EXCEPTION 'Half day leave must have identical start and end dates.' USING ERRCODE = '22023';
        END IF;
    END IF;

    SELECT organization_id, department_id, primary_location_id
    INTO v_org_id, v_dept_id, v_loc_id
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN 0;
    END IF;

    IF v_loc_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.locations WHERE id = v_loc_id;
    END IF;
    IF v_weekly_offs IS NULL THEN
        v_weekly_offs := '{0, 6}'::INTEGER[]; -- Default Sunday (0) and Saturday (6)
    END IF;

    v_curr := p_start_date;
    WHILE v_curr <= p_end_date LOOP
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;

        -- Check if current day is a weekly off
        IF NOT (v_dow = ANY(v_weekly_offs)) THEN
            -- Check holidays table
            SELECT EXISTS (
                SELECT 1 FROM public.holidays
                WHERE organization_id = v_org_id AND date = v_curr
            ) INTO v_is_holiday;

            -- Check company days off
            IF NOT v_is_holiday THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.company_days_off
                    WHERE organization_id = v_org_id
                      AND date = v_curr
                      AND (department_id IS NULL OR department_id = v_dept_id)
                ) INTO v_is_holiday;
            END IF;

            IF NOT v_is_holiday THEN
                IF p_day_part IN ('first_half', 'second_half') THEN
                    v_count := v_count + 0.5;
                ELSE
                    v_count := v_count + 1.0;
                END IF;
            END IF;
        END IF;

        v_curr := v_curr + 1;
    END LOOP;

    RETURN v_count;
END;
$$;

-- Returns the leave period (period_start, period_end) for an organization and given date
CREATE OR REPLACE FUNCTION public.get_organization_leave_period(
    p_organization_id UUID,
    p_date DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE (period_start DATE, period_end DATE)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_start_month INTEGER;
    v_year INTEGER;
    v_p_start DATE;
    v_p_end DATE;
BEGIN
    SELECT leave_year_start_month INTO v_start_month
    FROM public.organizations
    WHERE id = p_organization_id;

    IF v_start_month IS NULL THEN
        v_start_month := 1;
    END IF;

    v_year := EXTRACT(YEAR FROM p_date)::INTEGER;

    IF EXTRACT(MONTH FROM p_date)::INTEGER < v_start_month THEN
        v_p_start := MAKE_DATE(v_year - 1, v_start_month, 1);
    ELSE
        v_p_start := MAKE_DATE(v_year, v_start_month, 1);
    END IF;

    v_p_end := (v_p_start + INTERVAL '1 year' - INTERVAL '1 day')::DATE;

    RETURN QUERY SELECT v_p_start, v_p_end;
END;
$$;

-- ----------------------------------------------------------------------------
-- SECTION 4: Leave RPC Functions
-- ----------------------------------------------------------------------------

-- 1. request_leave
CREATE OR REPLACE FUNCTION public.request_leave(
    p_leave_type_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_day_part TEXT DEFAULT 'full',
    p_reason TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_total_days NUMERIC;
    v_p_start DATE;
    v_p_end DATE;
    v_balance RECORD;
    v_policy RECORD;
    v_combined_cap NUMERIC;
    v_request_id UUID;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Invalid date range: start_date must be before or equal to end_date.' USING ERRCODE = '22023';
    END IF;

    IF p_day_part NOT IN ('full', 'first_half', 'second_half') THEN
        RAISE EXCEPTION 'Invalid day_part: must be full, first_half, or second_half.' USING ERRCODE = '22023';
    END IF;

    -- Calculate working days excluding weekly offs and holidays
    v_total_days := public.calculate_working_days(v_caller_id, p_start_date, p_end_date, p_day_part);
    IF v_total_days <= 0 THEN
        RAISE EXCEPTION 'Selected date range contains 0 working days (all dates are holidays or weekly offs).' USING ERRCODE = '22023';
    END IF;

    -- Get leave period boundary
    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, p_start_date);

    -- Lock and check balance
    SELECT * INTO v_balance
    FROM public.leave_balances
    WHERE organization_id = v_caller_org
      AND employee_id = v_caller_id
      AND leave_type_id = p_leave_type_id
      AND period_start = v_p_start
      AND period_end = v_p_end
    FOR UPDATE;

    -- Retrieve policy
    SELECT * INTO v_policy
    FROM public.leave_policies
    WHERE organization_id = v_caller_org
      AND leave_type_id = p_leave_type_id;

    -- If balance row exists and quota is enforced, check balance
    IF v_balance IS NOT NULL THEN
        IF (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_total_days THEN
            RAISE EXCEPTION 'Insufficient leave balance. Available: %, Requested: %',
                (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used), v_total_days
                USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Check monthly cap for this type and combined monthly cap, splitting ranges spanning months
    DECLARE
        v_loop_date DATE := p_start_date;
        v_cur_m_start DATE;
        v_cur_m_end DATE;
        v_slice_start DATE;
        v_slice_end DATE;
        v_slice_days NUMERIC;
        v_month_used NUMERIC;
        v_combined_used NUMERIC;
    BEGIN
        SELECT combined_monthly_leave_cap INTO v_combined_cap
        FROM public.organizations
        WHERE id = v_caller_org;

        WHILE v_loop_date <= p_end_date LOOP
            v_cur_m_start := MAKE_DATE(EXTRACT(YEAR FROM v_loop_date)::INT, EXTRACT(MONTH FROM v_loop_date)::INT, 1);
            v_cur_m_end := (v_cur_m_start + INTERVAL '1 month' - INTERVAL '1 day')::DATE;
            v_slice_start := GREATEST(p_start_date, v_cur_m_start);
            v_slice_end := LEAST(p_end_date, v_cur_m_end);

            v_slice_days := public.calculate_working_days(v_caller_id, v_slice_start, v_slice_end, p_day_part);

            IF v_slice_days > 0 THEN
                -- 1. Check per-type monthly cap if configured
                IF v_policy.monthly_cap IS NOT NULL THEN
                    SELECT COALESCE(SUM(total_days), 0) INTO v_month_used
                    FROM public.leave_requests
                    WHERE organization_id = v_caller_org
                      AND employee_id = v_caller_id
                      AND leave_type_id = p_leave_type_id
                      AND status IN ('pending', 'approved')
                      AND start_date <= v_cur_m_end
                      AND end_date >= v_cur_m_start;

                    IF (v_month_used + v_slice_days) > v_policy.monthly_cap THEN
                        RAISE EXCEPTION 'Monthly leave cap exceeded for %: Cap is % days, requested in this month is % days.',
                            v_policy.leave_type_id, v_policy.monthly_cap, (v_month_used + v_slice_days)
                            USING ERRCODE = '22023';
                    END IF;
                END IF;

                -- 2. Check combined monthly cap if configured
                IF v_combined_cap IS NOT NULL THEN
                    SELECT COALESCE(SUM(total_days), 0) INTO v_combined_used
                    FROM public.leave_requests
                    WHERE organization_id = v_caller_org
                      AND employee_id = v_caller_id
                      AND status IN ('pending', 'approved')
                      AND start_date <= v_cur_m_end
                      AND end_date >= v_cur_m_start;

                    IF (v_combined_used + v_slice_days) > v_combined_cap THEN
                        RAISE EXCEPTION 'Combined monthly leave cap exceeded: Cap is % days, requested in this month is % days.',
                            v_combined_cap, (v_combined_used + v_slice_days)
                            USING ERRCODE = '22023';
                    END IF;
                END IF;
            END IF;

            v_loop_date := v_cur_m_end + 1;
        END LOOP;
    END;

    -- Insert leave request
    INSERT INTO public.leave_requests (
        organization_id, employee_id, leave_type_id, start_date, end_date,
        day_part, total_days, reason, status
    ) VALUES (
        v_caller_org, v_caller_id, p_leave_type_id, p_start_date, p_end_date,
        p_day_part, v_total_days, p_reason, 'pending'
    ) RETURNING id INTO v_request_id;

    v_new_data := jsonb_build_object(
        'request_id', v_request_id,
        'leave_type_id', p_leave_type_id,
        'start_date', p_start_date,
        'end_date', p_end_date,
        'total_days', v_total_days,
        'day_part', p_day_part
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_REQUESTED', 'leave_requests', v_request_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'total_days', v_total_days);
END;
$$;

-- 2. approve_leave
CREATE OR REPLACE FUNCTION public.approve_leave(
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
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_request RECORD;
    v_target_emp RECORD;
    v_p_start DATE;
    v_p_end DATE;
    v_balance RECORD;
    v_curr DATE;
    v_dow INTEGER;
    v_weekly_offs INTEGER[] := '{0, 6}'::INTEGER[];
    v_loc_id UUID;
    v_is_holiday BOOLEAN;
    v_punched BOOLEAN;
    v_locked BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    -- Lock and retrieve leave request
    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.status != 'pending' THEN
        RAISE EXCEPTION 'Leave request cannot be approved: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    -- Separation of duties: Nobody approves their own leave
    IF v_request.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: You cannot approve your own leave request.' USING ERRCODE = '42501';
    END IF;

    -- Retrieve target employee info
    SELECT * INTO v_target_emp
    FROM public.employees
    WHERE id = v_request.employee_id;

    -- Role verification
    IF v_caller_role = 'employee' THEN
        RAISE EXCEPTION 'Forbidden: Employees cannot approve leave requests.' USING ERRCODE = '42501';
    ELSIF v_caller_role = 'manager' THEN
        -- Managers can only approve direct reports
        IF v_target_emp.manager_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only approve leave for direct reports.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave approval.' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Refuse approval if any date touches a locked month
    SELECT EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE organization_id = v_caller_org
          AND employee_id = v_request.employee_id
          AND work_date BETWEEN v_request.start_date AND v_request.end_date
          AND locked = true
    ) INTO v_locked;

    IF v_locked THEN
        RAISE EXCEPTION 'Cannot approve leave: includes locked month dates.' USING ERRCODE = '22023';
    END IF;

    -- Retrieve location weekly offs
    IF v_target_emp.primary_location_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs
        FROM public.locations
        WHERE id = v_target_emp.primary_location_id;
        IF v_weekly_offs IS NULL THEN
            v_weekly_offs := '{0, 6}'::INTEGER[];
        END IF;
    END IF;

    -- Check if employee already punched in on any full leave day
    v_curr := v_request.start_date;
    WHILE v_curr <= v_request.end_date LOOP
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;
        IF NOT (v_dow = ANY(v_weekly_offs)) THEN
            SELECT EXISTS (
                SELECT 1 FROM public.attendance_sessions
                WHERE organization_id = v_caller_org
                  AND employee_id = v_request.employee_id
                  AND work_date = v_curr
            ) INTO v_punched;

            IF v_punched AND v_request.day_part = 'full' THEN
                RAISE EXCEPTION 'Employee already punched in on %: cannot approve full day leave.', v_curr USING ERRCODE = '22023';
            END IF;
        END IF;
        v_curr := v_curr + 1;
    END LOOP;

    -- Deduct balance atomically
    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, v_request.start_date);

    SELECT * INTO v_balance
    FROM public.leave_balances
    WHERE organization_id = v_caller_org
      AND employee_id = v_request.employee_id
      AND leave_type_id = v_request.leave_type_id
      AND period_start = v_p_start
      AND period_end = v_p_end
    FOR UPDATE;

    IF v_balance IS NOT NULL THEN
        IF (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_request.total_days THEN
            RAISE EXCEPTION 'Insufficient leave balance to approve request. Available: %, Requested: %',
                (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used), v_request.total_days
                USING ERRCODE = '22023';
        END IF;

        UPDATE public.leave_balances
        SET used = used + v_request.total_days,
            updated_at = pg_catalog.now()
        WHERE id = v_balance.id;
    END IF;

    -- Update leave request
    UPDATE public.leave_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note,
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    -- Synchronize attendance_days status = 'leave' for work dates
    v_curr := v_request.start_date;
    WHILE v_curr <= v_request.end_date LOOP
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;
        IF NOT (v_dow = ANY(v_weekly_offs)) THEN
            -- Check not holiday
            SELECT EXISTS (
                SELECT 1 FROM public.holidays
                WHERE organization_id = v_caller_org AND date = v_curr
            ) INTO v_is_holiday;

            IF NOT v_is_holiday THEN
                INSERT INTO public.attendance_days (
                    organization_id, employee_id, work_date, total_minutes, status, locked
                ) VALUES (
                    v_caller_org, v_request.employee_id, v_curr,
                    CASE WHEN v_request.day_part IN ('first_half', 'second_half') THEN 240 ELSE 0 END,
                    'leave', false
                )
                ON CONFLICT (employee_id, work_date) DO UPDATE
                SET status = 'leave',
                    updated_at = pg_catalog.now()
                WHERE attendance_days.locked = false;
            END IF;
        END IF;
        v_curr := v_curr + 1;
    END LOOP;

    -- Audit log
    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_APPROVED', 'leave_requests', p_request_id,
        jsonb_build_object('status', 'pending'),
        jsonb_build_object('status', 'approved', 'total_days', v_request.total_days, 'reviewed_by', v_caller_id)
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'approved');
END;
$$;

-- 3. reject_leave
CREATE OR REPLACE FUNCTION public.reject_leave(
    p_request_id UUID,
    p_review_note TEXT
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
    v_request RECORD;
    v_target_emp RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.status != 'pending' THEN
        RAISE EXCEPTION 'Leave request cannot be rejected: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    IF v_request.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: You cannot reject your own leave request.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target_emp FROM public.employees WHERE id = v_request.employee_id;

    IF v_caller_role = 'employee' THEN
        RAISE EXCEPTION 'Forbidden: Employees cannot reject leave requests.' USING ERRCODE = '42501';
    ELSIF v_caller_role = 'manager' THEN
        IF v_target_emp.manager_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only reject leave for direct reports.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave rejection.' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.leave_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note,
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_REJECTED', 'leave_requests', p_request_id,
        jsonb_build_object('status', 'pending'),
        jsonb_build_object('status', 'rejected', 'note', p_review_note, 'reviewed_by', v_caller_id)
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'rejected');
END;
$$;

-- 4. cancel_leave
CREATE OR REPLACE FUNCTION public.cancel_leave(
    p_request_id UUID,
    p_reason TEXT DEFAULT NULL
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
    v_request RECORD;
    v_p_start DATE;
    v_p_end DATE;
    v_locked BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    -- Only employee who created it or HR/Admin at aal2 can cancel
    IF v_caller_role = 'employee' AND v_request.employee_id != v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: You cannot cancel another employee leave request.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role IN ('hr', 'admin') AND v_request.employee_id != v_caller_id THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required to cancel employee leave.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_request.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'Leave request cannot be cancelled: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    -- If approved, check locked months
    IF v_request.status = 'approved' THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = v_caller_org
              AND employee_id = v_request.employee_id
              AND work_date BETWEEN v_request.start_date AND v_request.end_date
              AND locked = true
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot cancel leave: touches locked month dates.' USING ERRCODE = '22023';
        END IF;

        -- Restore balance
        SELECT period_start, period_end INTO v_p_start, v_p_end
        FROM public.get_organization_leave_period(v_caller_org, v_request.start_date);

        UPDATE public.leave_balances
        SET used = GREATEST(0, used - v_request.total_days),
            updated_at = pg_catalog.now()
        WHERE organization_id = v_caller_org
          AND employee_id = v_request.employee_id
          AND leave_type_id = v_request.leave_type_id
          AND period_start = v_p_start
          AND period_end = v_p_end;

        -- Revert attendance_days from status = 'leave'
        UPDATE public.attendance_days
        SET status = 'absent',
            total_minutes = 0,
            updated_at = pg_catalog.now()
        WHERE organization_id = v_caller_org
          AND employee_id = v_request.employee_id
          AND work_date BETWEEN v_request.start_date AND v_request.end_date
          AND status = 'leave'
          AND locked = false;
    END IF;

    UPDATE public.leave_requests
    SET status = 'cancelled',
        cancelled_at = pg_catalog.now(),
        review_note = COALESCE(p_reason, review_note),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_CANCELLED', 'leave_requests', p_request_id,
        jsonb_build_object('status', v_request.status),
        jsonb_build_object('status', 'cancelled', 'cancelled_by', v_caller_id, 'reason', p_reason)
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'cancelled');
END;
$$;

-- 5. hr_assign_leave
CREATE OR REPLACE FUNCTION public.hr_assign_leave(
    p_employee_ids UUID[],
    p_leave_type_id UUID,
    p_start_date DATE,
    p_end_date DATE,
    p_day_part TEXT DEFAULT 'full',
    p_reason TEXT DEFAULT '',
    p_override_balance BOOLEAN DEFAULT FALSE
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
    v_emp_id UUID;
    v_total_days NUMERIC;
    v_p_start DATE;
    v_p_end DATE;
    v_balance RECORD;
    v_req_id UUID;
    v_assigned_count INTEGER := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can assign leave.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for assigning leave.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    -- Separation of duties: HR cannot assign leave for themselves
    IF v_caller_id = ANY(p_employee_ids) THEN
        RAISE EXCEPTION 'Separation of duties: HR and Admins cannot assign leave for themselves.' USING ERRCODE = '42501';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, p_start_date);

    FOREACH v_emp_id IN ARRAY p_employee_ids LOOP
        -- Verify employee belongs to caller org
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_emp_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Employee % does not belong to caller organization.', v_emp_id USING ERRCODE = '22023';
        END IF;

        v_total_days := public.calculate_working_days(v_emp_id, p_start_date, p_end_date, p_day_part);
        IF v_total_days > 0 THEN
            -- Check balance if not overriding
            IF NOT p_override_balance THEN
                SELECT * INTO v_balance
                FROM public.leave_balances
                WHERE organization_id = v_caller_org
                  AND employee_id = v_emp_id
                  AND leave_type_id = p_leave_type_id
                  AND period_start = v_p_start
                  AND period_end = v_p_end
                FOR UPDATE;

                IF v_balance IS NOT NULL AND (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_total_days THEN
                    RAISE EXCEPTION 'Insufficient balance for employee %: Available %, Requested %',
                        v_emp_id, (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used), v_total_days
                        USING ERRCODE = '22023';
                END IF;
            END IF;

            -- Deduct balance
            UPDATE public.leave_balances
            SET used = used + v_total_days,
                updated_at = pg_catalog.now()
            WHERE organization_id = v_caller_org
              AND employee_id = v_emp_id
              AND leave_type_id = p_leave_type_id
              AND period_start = v_p_start
              AND period_end = v_p_end;

            -- Insert direct approved request
            INSERT INTO public.leave_requests (
                organization_id, employee_id, leave_type_id, start_date, end_date,
                day_part, total_days, reason, status, reviewed_by, reviewed_at
            ) VALUES (
                v_caller_org, v_emp_id, p_leave_type_id, p_start_date, p_end_date,
                p_day_part, v_total_days, p_reason, 'approved', v_caller_id, pg_catalog.now()
            ) RETURNING id INTO v_req_id;

            -- Attendance sync
            INSERT INTO public.audit_logs (
                organization_id, actor_id, action, table_name, record_id, old_data, new_data
            ) VALUES (
                v_caller_org, v_caller_id, 'LEAVE_ASSIGNED', 'leave_requests', v_req_id,
                NULL,
                jsonb_build_object(
                    'employee_id', v_emp_id,
                    'leave_type_id', p_leave_type_id,
                    'total_days', v_total_days,
                    'assigned_by', v_caller_id
                )
            );

            v_assigned_count := v_assigned_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'assigned_count', v_assigned_count);
END;
$$;

-- 6. hr_adjust_balance
CREATE OR REPLACE FUNCTION public.hr_adjust_balance(
    p_employee_id UUID,
    p_leave_type_id UUID,
    p_amount NUMERIC,
    p_reason TEXT
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
    v_p_start DATE;
    v_p_end DATE;
    v_bal_id UUID;
    v_adj_id UUID;
    v_old_adj NUMERIC := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can adjust leave balances.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to adjust leave balances.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    -- Separation of duties: HR cannot adjust their own leave balance
    IF p_employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: HR and Admins cannot adjust their own leave balance.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Employee does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, CURRENT_DATE);

    -- Lock or create balance row
    SELECT id, adjusted INTO v_bal_id, v_old_adj
    FROM public.leave_balances
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND leave_type_id = p_leave_type_id
      AND period_start = v_p_start
      AND period_end = v_p_end
    FOR UPDATE;

    IF v_bal_id IS NULL THEN
        INSERT INTO public.leave_balances (
            organization_id, employee_id, leave_type_id, period_start, period_end, allocated, adjusted
        ) VALUES (
            v_caller_org, p_employee_id, p_leave_type_id, v_p_start, v_p_end, 0, p_amount
        ) RETURNING id INTO v_bal_id;
    ELSE
        UPDATE public.leave_balances
        SET adjusted = adjusted + p_amount,
            updated_at = pg_catalog.now()
        WHERE id = v_bal_id;
    END IF;

    -- Record adjustment
    INSERT INTO public.leave_balance_adjustments (
        organization_id, employee_id, leave_type_id, adjusted_by, amount, reason
    ) VALUES (
        v_caller_org, p_employee_id, p_leave_type_id, v_caller_id, p_amount, p_reason
    ) RETURNING id INTO v_adj_id;

    -- Audit log
    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_BALANCE_ADJUSTED', 'leave_balances', v_bal_id,
        jsonb_build_object('adjusted', v_old_adj),
        jsonb_build_object('adjusted', v_old_adj + p_amount, 'adjustment_amount', p_amount, 'reason', p_reason)
    );

    RETURN jsonb_build_object('success', true, 'balance_id', v_bal_id, 'new_adjustment', v_old_adj + p_amount);
END;
$$;

-- 7. allocate_yearly_balances
CREATE OR REPLACE FUNCTION public.allocate_yearly_balances(
    p_organization_id UUID DEFAULT NULL,
    p_year INTEGER DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_target_org UUID;
    v_org RECORD;
    v_emp RECORD;
    v_policy RECORD;
    v_p_start DATE;
    v_p_end DATE;
    v_hire_date DATE;
    v_months_remaining NUMERIC;
    v_quota NUMERIC;
    v_carry_fwd NUMERIC;
    v_prev_bal RECORD;
    v_allocated_count INTEGER := 0;
BEGIN
    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS NOT NULL THEN
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Forbidden: Only HR and Admins can allocate yearly balances.' USING ERRCODE = '42501';
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for allocating balances.' USING ERRCODE = '42501';
        END IF;

        v_target_org := COALESCE(p_organization_id, v_caller_org);
        IF v_target_org != v_caller_org THEN
            RAISE EXCEPTION 'Cannot allocate balances for another organization.' USING ERRCODE = '42501';
        END IF;
    ELSE
        -- Cron or service-role invocation
        v_target_org := p_organization_id;
    END IF;

    FOR v_org IN SELECT * FROM public.organizations WHERE (v_target_org IS NULL OR id = v_target_org) LOOP
        -- Compute leave period
        SELECT period_start, period_end INTO v_p_start, v_p_end
        FROM public.get_organization_leave_period(v_org.id, CURRENT_DATE);

        -- Iterate active employees
        FOR v_emp IN SELECT * FROM public.employees WHERE organization_id = v_org.id AND status = 'active' LOOP
            -- Iterate leave policies
            FOR v_policy IN SELECT * FROM public.leave_policies WHERE organization_id = v_org.id LOOP
                -- Pro-rating calculation for mid-year joiners
                v_hire_date := v_emp.created_at::DATE;
                IF v_hire_date > v_p_start AND v_hire_date <= v_p_end THEN
                    -- Calculate whole months remaining in period
                    v_months_remaining := LEAST(12, GREATEST(1, (EXTRACT(YEAR FROM v_p_end) - EXTRACT(YEAR FROM v_hire_date))::INTEGER * 12 + (EXTRACT(MONTH FROM v_p_end) - EXTRACT(MONTH FROM v_hire_date))::INTEGER + 1));
                    v_quota := ROUND((v_policy.yearly_quota * (v_months_remaining / 12.0)), 1);
                ELSE
                    v_quota := v_policy.yearly_quota;
                END IF;

                -- Carry forward calculation from previous period
                v_carry_fwd := 0;
                IF v_policy.carry_forward_max > 0 THEN
                    SELECT * INTO v_prev_bal
                    FROM public.leave_balances
                    WHERE organization_id = v_org.id
                      AND employee_id = v_emp.id
                      AND leave_type_id = v_policy.leave_type_id
                      AND period_end = (v_p_start - INTERVAL '1 day')::DATE;

                    IF v_prev_bal IS NOT NULL THEN
                        v_carry_fwd := LEAST(
                            v_policy.carry_forward_max,
                            GREATEST(0, (v_prev_bal.allocated + v_prev_bal.carried_forward + v_prev_bal.adjusted - v_prev_bal.used))
                        );
                    END IF;
                END IF;

                -- Upsert balance
                INSERT INTO public.leave_balances (
                    organization_id, employee_id, leave_type_id, period_start, period_end,
                    allocated, carried_forward, used, adjusted
                ) VALUES (
                    v_org.id, v_emp.id, v_policy.leave_type_id, v_p_start, v_p_end,
                    v_quota, v_carry_fwd, 0, 0
                )
                ON CONFLICT (organization_id, employee_id, leave_type_id, period_start, period_end)
                DO UPDATE SET allocated = EXCLUDED.allocated,
                              carried_forward = EXCLUDED.carried_forward,
                              updated_at = pg_catalog.now();

                v_allocated_count := v_allocated_count + 1;
            END LOOP;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object('success', true, 'allocated_count', v_allocated_count);
END;
$$;

-- 8. declare_company_day_off
CREATE OR REPLACE FUNCTION public.declare_company_day_off(
    p_date DATE,
    p_title TEXT,
    p_department_id UUID DEFAULT NULL
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
    v_off_id UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can declare company days off.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to declare company days off.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_department_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_department_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Department does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    -- Insert into company_days_off
    INSERT INTO public.company_days_off (
        organization_id, department_id, date, title, declared_by
    ) VALUES (
        v_caller_org, p_department_id, p_date, p_title, v_caller_id
    ) RETURNING id INTO v_off_id;

    -- Also mirror into holidays table for system-wide awareness
    INSERT INTO public.holidays (
        organization_id, date, name, region
    ) VALUES (
        v_caller_org, p_date, p_title, 'COMPANY_DAY_OFF'
    ) ON CONFLICT (organization_id, date) DO UPDATE SET name = EXCLUDED.name;

    -- Audit log
    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'COMPANY_DAY_OFF_DECLARED', 'company_days_off', v_off_id,
        NULL,
        jsonb_build_object('date', p_date, 'title', p_title, 'department_id', p_department_id)
    );

    RETURN jsonb_build_object('success', true, 'day_off_id', v_off_id);
END;
$$;

-- ----------------------------------------------------------------------------
-- SECTION 5: Row Level Security & Explicit Grants
-- ----------------------------------------------------------------------------

-- Revoke all by default
REVOKE ALL ON public.leave_types FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.leave_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.leave_balances FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.leave_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.leave_balance_adjustments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.company_days_off FROM PUBLIC, anon, authenticated;

-- Grants to authenticated: SELECT only
GRANT SELECT ON public.leave_types TO authenticated;
GRANT SELECT ON public.leave_policies TO authenticated;
GRANT SELECT ON public.leave_balances TO authenticated;
GRANT SELECT ON public.leave_requests TO authenticated;
GRANT SELECT ON public.leave_balance_adjustments TO authenticated;
GRANT SELECT ON public.company_days_off TO authenticated;

-- Revoke all function execution from PUBLIC and anon by default
REVOKE ALL ON FUNCTION public.request_leave(UUID, DATE, DATE, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_leave(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_leave(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_leave(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_assign_leave(UUID[], UUID, DATE, DATE, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.hr_adjust_balance(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.allocate_yearly_balances(UUID, INTEGER) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.declare_company_day_off(DATE, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.calculate_working_days(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.get_organization_leave_period(UUID, DATE) FROM PUBLIC, anon;

-- Grant EXECUTE on RPCs
GRANT EXECUTE ON FUNCTION public.request_leave(UUID, DATE, DATE, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_leave(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_leave(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_leave(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_assign_leave(UUID[], UUID, DATE, DATE, TEXT, TEXT, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.hr_adjust_balance(UUID, UUID, NUMERIC, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.allocate_yearly_balances(UUID, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.declare_company_day_off(DATE, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_working_days(UUID, DATE, DATE, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_organization_leave_period(UUID, DATE) TO authenticated;

-- Enable RLS on all leave tables
ALTER TABLE public.leave_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leave_balance_adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_days_off ENABLE ROW LEVEL SECURITY;

-- 1. leave_types
CREATE POLICY "leave_types_select_policy" ON public.leave_types
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "enforce_active_org_membership_leave_types" ON public.leave_types
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_leave_types" ON public.leave_types
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE 
            WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
            ELSE true 
        END
    );

-- 2. leave_policies
CREATE POLICY "leave_policies_select_policy" ON public.leave_policies
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "enforce_active_org_membership_leave_policies" ON public.leave_policies
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_leave_policies" ON public.leave_policies
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE 
            WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
            ELSE true 
        END
    );

-- 3. leave_balances
CREATE POLICY "leave_balances_select_policy" ON public.leave_balances
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
                    WHERE e.id = leave_balances.employee_id
                      AND e.manager_id = (SELECT auth.uid())
                )
            )
        )
    );

CREATE POLICY "enforce_active_org_membership_leave_balances" ON public.leave_balances
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_leave_balances" ON public.leave_balances
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE 
            WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
            ELSE true 
        END
    );

-- 4. leave_requests
CREATE POLICY "leave_requests_select_policy" ON public.leave_requests
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
                    WHERE e.id = leave_requests.employee_id
                      AND e.manager_id = (SELECT auth.uid())
                )
            )
        )
    );

CREATE POLICY "enforce_active_org_membership_leave_requests" ON public.leave_requests
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_leave_requests" ON public.leave_requests
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE 
            WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
            ELSE true 
        END
    );

-- 5. leave_balance_adjustments
CREATE POLICY "leave_balance_adjustments_select_policy" ON public.leave_balance_adjustments
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            employee_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
        )
    );

CREATE POLICY "enforce_active_org_membership_leave_balance_adjustments" ON public.leave_balance_adjustments
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_leave_balance_adjustments" ON public.leave_balance_adjustments
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE 
            WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
            ELSE true 
        END
    );

-- 6. company_days_off
CREATE POLICY "company_days_off_select_policy" ON public.company_days_off
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "enforce_active_org_membership_company_days_off" ON public.company_days_off
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_company_days_off" ON public.company_days_off
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE 
            WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
            ELSE true 
        END
    );

-- ----------------------------------------------------------------------------
-- SECTION 6: Seed Default Leave Types & Policies for Existing Organizations
-- ----------------------------------------------------------------------------
DO $$
DECLARE
    r RECORD;
    v_casual_id UUID;
    v_sick_id UUID;
    v_unpaid_id UUID;
BEGIN
    FOR r IN SELECT id FROM public.organizations LOOP
        -- 1. Casual Leave
        INSERT INTO public.leave_types (organization_id, name, code, description, is_paid)
        VALUES (r.id, 'Casual Leave', 'CASUAL', 'General personal and planned absence', TRUE)
        ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_casual_id;

        -- 2. Sick Leave
        INSERT INTO public.leave_types (organization_id, name, code, description, is_paid)
        VALUES (r.id, 'Sick Leave', 'SICK', 'Medical recovery and health emergencies', TRUE)
        ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_sick_id;

        -- 3. Unpaid Leave
        INSERT INTO public.leave_types (organization_id, name, code, description, is_paid)
        VALUES (r.id, 'Unpaid Leave', 'UNPAID', 'Extended leave without pay', FALSE)
        ON CONFLICT (organization_id, code) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_unpaid_id;

        -- Policies
        INSERT INTO public.leave_policies (organization_id, leave_type_id, yearly_quota, monthly_cap, carry_forward_max)
        VALUES (r.id, v_casual_id, 12, 2.0, 5)
        ON CONFLICT (organization_id, leave_type_id) DO NOTHING;

        INSERT INTO public.leave_policies (organization_id, leave_type_id, yearly_quota, monthly_cap, carry_forward_max)
        VALUES (r.id, v_sick_id, 10, 3.0, 3)
        ON CONFLICT (organization_id, leave_type_id) DO NOTHING;

        INSERT INTO public.leave_policies (organization_id, leave_type_id, yearly_quota, monthly_cap, carry_forward_max)
        VALUES (r.id, v_unpaid_id, 30, NULL, 0)
        ON CONFLICT (organization_id, leave_type_id) DO NOTHING;
    END LOOP;
END;
$$;
