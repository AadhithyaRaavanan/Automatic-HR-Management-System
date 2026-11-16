-- Migration: 20261107000001_initial_schema.sql
-- Description: Core tables, indexes, constraints, and audit log system for Attendance Module

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Employees Table
CREATE TABLE IF NOT EXISTS public.employees (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    full_name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    avatar_url TEXT,
    manager_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    work_target_minutes INTEGER NOT NULL DEFAULT 480, -- 8 hours standard
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'on_leave', 'probation', 'exited')),
    joined_on DATE NOT NULL DEFAULT CURRENT_DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. User Roles Table (Separated from user metadata for strict security)
CREATE TABLE IF NOT EXISTS public.user_roles (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, role)
);

-- 3. Attendance Policies
CREATE TABLE IF NOT EXISTS public.attendance_policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    grace_minutes INTEGER NOT NULL DEFAULT 15,
    half_day_minutes INTEGER NOT NULL DEFAULT 240, -- 4 hours
    absent_minutes INTEGER NOT NULL DEFAULT 120,   -- less than 2 hours
    auto_checkout_time TIME NOT NULL DEFAULT '23:59:00',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Attendance Sessions (Raw check-in and check-out intervals)
CREATE TABLE IF NOT EXISTS public.attendance_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    check_in_at TIMESTAMPTZ NOT NULL,
    check_out_at TIMESTAMPTZ,
    source TEXT NOT NULL DEFAULT 'web' CHECK (source IN ('web', 'auto', 'manual')),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Crucial: Partial unique index allowing only ONE active/open session per employee
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_open_session 
ON public.attendance_sessions (employee_id) 
WHERE check_out_at IS NULL;

-- 5. Attendance Days (Consolidated daily summary)
CREATE TABLE IF NOT EXISTS public.attendance_days (
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    total_minutes INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'absent' CHECK (status IN ('present', 'half_day', 'absent', 'holiday', 'weekend', 'leave')),
    is_late BOOLEAN NOT NULL DEFAULT FALSE,
    locked BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (employee_id, work_date)
);

-- 6. Regularization Requests
CREATE TABLE IF NOT EXISTS public.regularization_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    work_date DATE NOT NULL,
    requested_in TIMESTAMPTZ NOT NULL,
    requested_out TIMESTAMPTZ NOT NULL,
    reason TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    reviewed_at TIMESTAMPTZ,
    review_note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Notifications
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('missed_checkout', 'request_status', 'policy_update', 'reminder')),
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 8. Holidays
CREATE TABLE IF NOT EXISTS public.holidays (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL UNIQUE,
    name TEXT NOT NULL,
    region TEXT NOT NULL DEFAULT 'GLOBAL',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. Audit Logs
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    table_name TEXT NOT NULL,
    record_id UUID NOT NULL,
    old_data JSONB,
    new_data JSONB,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance Indexes (Optimized for composite filters & RLS lookups)
CREATE INDEX IF NOT EXISTS idx_employees_manager ON public.employees (manager_id);
CREATE INDEX IF NOT EXISTS idx_sessions_emp_date ON public.attendance_sessions (employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_days_emp_date ON public.attendance_days (employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_days_locked ON public.attendance_days (locked) WHERE locked = FALSE;
CREATE INDEX IF NOT EXISTS idx_requests_emp_date ON public.regularization_requests (employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_requests_status ON public.regularization_requests (status);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON public.notifications (user_id) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor ON public.audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);



-- Migration: 20261107000002_custom_access_token_hook.sql
-- Description: Custom Access Token Hook to inject user_role into JWT claims

-- Helper function to fetch the role of a user
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT role FROM public.user_roles WHERE user_id = p_user_id LIMIT 1;
$$;

-- Supabase Custom Access Token Hook
-- Supabase Auth executes this function before minting the JWT
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    claims JSONB;
    user_role TEXT;
    target_user_id UUID;
BEGIN
    target_user_id := (event->>'user_id')::UUID;
    
    -- Lookup the assigned role from user_roles table
    SELECT role INTO user_role 
    FROM public.user_roles 
    WHERE user_id = target_user_id 
    LIMIT 1;

    -- Default to 'employee' if no explicit role has been assigned
    IF user_role IS NULL THEN
        user_role := 'employee';
    END IF;

    claims := event->'claims';
    -- Inject user_role into claims
    claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
    
    -- Reassign claims to event payload
    event := jsonb_set(event, '{claims}', claims);
    
    RETURN event;
END;
$$;

-- Permissions for the auth hook
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM authenticated, anon, public;



-- Migration: 20261107000003_rls_policies.sql
-- Description: Strict deny-by-default Row Level Security policies with (select auth.uid()) subqueries

-- Fast helper function to resolve current user's role
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.user_role', true), ''),
        (SELECT role FROM public.user_roles WHERE user_id = (SELECT auth.uid()) LIMIT 1),
        'employee'
    );
$$;

-- Enable RLS on all tables
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regularization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

---------------------------------------------------------
-- 1. EMPLOYEES TABLE POLICIES
---------------------------------------------------------
-- SELECT: Employee reads own, Manager reads own + direct reports, HR/Admin read all
CREATE POLICY "employees_select_policy"
ON public.employees
FOR SELECT
TO authenticated
USING (
    id = (SELECT auth.uid())
    OR manager_id = (SELECT auth.uid())
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
);

-- UPDATE: HR/Admin can update all fields; Employee can update own timezone
CREATE POLICY "employees_update_policy"
ON public.employees
FOR UPDATE
TO authenticated
USING (
    id = (SELECT auth.uid())
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    id = (SELECT auth.uid())
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
);

-- INSERT: HR / Admin only
CREATE POLICY "employees_insert_policy"
ON public.employees
FOR INSERT
TO authenticated
WITH CHECK (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
);

-- DELETE: Admin only
CREATE POLICY "employees_delete_policy"
ON public.employees
FOR DELETE
TO authenticated
USING (
    (SELECT public.current_user_role()) = 'admin'
);

---------------------------------------------------------
-- 2. USER ROLES POLICIES
---------------------------------------------------------
-- SELECT: User reads own role, HR/Admin read all
CREATE POLICY "user_roles_select_policy"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
    user_id = (SELECT auth.uid())
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
);

-- INSERT/UPDATE/DELETE: Admin only
CREATE POLICY "user_roles_admin_manage_policy"
ON public.user_roles
FOR ALL
TO authenticated
USING (
    (SELECT public.current_user_role()) = 'admin'
)
WITH CHECK (
    (SELECT public.current_user_role()) = 'admin'
);

---------------------------------------------------------
-- 3. ATTENDANCE SESSIONS POLICIES
---------------------------------------------------------
-- SELECT: Employee reads own, Manager reads own + reports, HR/Admin read all
CREATE POLICY "attendance_sessions_select_policy"
ON public.attendance_sessions
FOR SELECT
TO authenticated
USING (
    employee_id = (SELECT auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE manager_id = (SELECT auth.uid()))
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
);

-- Direct client INSERT/UPDATE/DELETE are strictly DENIED
-- All session modifications MUST pass through RPC functions (check_in, check_out, approve_regularization)
-- HR/Admin retain emergency override privileges
CREATE POLICY "attendance_sessions_admin_override"
ON public.attendance_sessions
FOR ALL
TO authenticated
USING (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
);

---------------------------------------------------------
-- 4. ATTENDANCE DAYS POLICIES
---------------------------------------------------------
-- SELECT: Employee reads own, Manager reads own + reports, HR/Admin read all
CREATE POLICY "attendance_days_select_policy"
ON public.attendance_days
FOR SELECT
TO authenticated
USING (
    employee_id = (SELECT auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE manager_id = (SELECT auth.uid()))
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
);

-- Direct client mutations DENIED; recalculate_day() handles updates with SECURITY DEFINER
CREATE POLICY "attendance_days_admin_override"
ON public.attendance_days
FOR ALL
TO authenticated
USING (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
);

---------------------------------------------------------
-- 5. REGULARIZATION REQUESTS POLICIES
---------------------------------------------------------
-- SELECT: Employee reads own, Manager reads direct reports + own, HR/Admin read all
CREATE POLICY "regularization_requests_select_policy"
ON public.regularization_requests
FOR SELECT
TO authenticated
USING (
    employee_id = (SELECT auth.uid())
    OR employee_id IN (SELECT id FROM public.employees WHERE manager_id = (SELECT auth.uid()))
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
);

-- INSERT: Employee can insert their own request with status 'pending'
CREATE POLICY "regularization_requests_insert_policy"
ON public.regularization_requests
FOR INSERT
TO authenticated
WITH CHECK (
    employee_id = (SELECT auth.uid())
    AND status = 'pending'
);

-- UPDATE: Manager can review requests from direct reports; HR/Admin can review all
CREATE POLICY "regularization_requests_review_policy"
ON public.regularization_requests
FOR UPDATE
TO authenticated
USING (
    employee_id IN (SELECT id FROM public.employees WHERE manager_id = (SELECT auth.uid()))
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    employee_id IN (SELECT id FROM public.employees WHERE manager_id = (SELECT auth.uid()))
    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
);

---------------------------------------------------------
-- 6. NOTIFICATIONS POLICIES
---------------------------------------------------------
-- SELECT: Users read only their own notifications
CREATE POLICY "notifications_select_policy"
ON public.notifications
FOR SELECT
TO authenticated
USING (
    user_id = (SELECT auth.uid())
);

-- UPDATE: Users can mark their own notifications as read
CREATE POLICY "notifications_update_policy"
ON public.notifications
FOR UPDATE
TO authenticated
USING (
    user_id = (SELECT auth.uid())
)
WITH CHECK (
    user_id = (SELECT auth.uid())
);

---------------------------------------------------------
-- 7. HOLIDAYS POLICIES
---------------------------------------------------------
-- SELECT: All authenticated employees can view holidays
CREATE POLICY "holidays_select_policy"
ON public.holidays
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) IS NOT NULL
);

-- INSERT/UPDATE/DELETE: HR / Admin only
CREATE POLICY "holidays_admin_manage_policy"
ON public.holidays
FOR ALL
TO authenticated
USING (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
);

---------------------------------------------------------
-- 8. ATTENDANCE POLICIES
---------------------------------------------------------
-- SELECT: All authenticated users can view active policies
CREATE POLICY "attendance_policies_select_policy"
ON public.attendance_policies
FOR SELECT
TO authenticated
USING (
    (SELECT auth.uid()) IS NOT NULL
);

-- INSERT/UPDATE/DELETE: HR / Admin only
CREATE POLICY "attendance_policies_admin_policy"
ON public.attendance_policies
FOR ALL
TO authenticated
USING (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
);

---------------------------------------------------------
-- 9. AUDIT LOGS POLICIES
---------------------------------------------------------
-- SELECT: HR and Admin only
CREATE POLICY "audit_logs_select_policy"
ON public.audit_logs
FOR SELECT
TO authenticated
USING (
    (SELECT public.current_user_role()) IN ('hr', 'admin')
);

-- Direct client mutations strictly DENIED; system triggers insert audit records



-- Migration: 20261107000004_attendance_rpcs.sql
-- Description: Core Attendance Stored Procedures (check_in, check_out, recalculate_day, lock_month)

---------------------------------------------------------
-- 1. RECALCULATE DAY FUNCTION
---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recalculate_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_is_locked BOOLEAN := FALSE;
    v_total_minutes INTEGER := 0;
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_emp_tz TEXT := 'UTC';
    v_is_holiday BOOLEAN := FALSE;
    v_is_weekend BOOLEAN := FALSE;
    v_grace_minutes INTEGER := 15;
    v_half_day_minutes INTEGER := 240;
    v_full_day_target INTEGER := 480;
    v_earliest_in TIMESTAMPTZ;
    v_expected_start TIME := '09:00:00';
    v_actual_start_time TIME;
BEGIN
    -- Check if day is already locked
    SELECT locked INTO v_is_locked
    FROM public.attendance_days
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    IF v_is_locked = TRUE THEN
        -- Locked records cannot be modified
        RETURN;
    END IF;

    -- Fetch employee timezone and work target
    SELECT timezone, work_target_minutes INTO v_emp_tz, v_full_day_target
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_emp_tz IS NULL THEN
        v_emp_tz := 'UTC';
    END IF;

    IF v_full_day_target IS NULL THEN
        v_full_day_target := 480;
    END IF;

    -- Fetch active policy configurations
    SELECT grace_minutes, half_day_minutes
    INTO v_grace_minutes, v_half_day_minutes
    FROM public.attendance_policies
    WHERE is_active = TRUE
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_grace_minutes IS NULL THEN
        v_grace_minutes := 15;
    END IF;
    IF v_half_day_minutes IS NULL THEN
        v_half_day_minutes := 240;
    END IF;

    -- Check if date is a scheduled public holiday
    IF EXISTS (SELECT 1 FROM public.holidays WHERE date = p_work_date) THEN
        v_is_holiday := TRUE;
    END IF;

    -- Check if date falls on weekend (ISO DOW: 6 = Saturday, 7 = Sunday)
    IF EXTRACT(ISODOW FROM p_work_date) IN (6, 7) THEN
        v_is_weekend := TRUE;
    END IF;

    -- Aggregate total minutes from closed sessions
    SELECT 
        COALESCE(SUM(ROUND(EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60.0)), 0)::INTEGER,
        MIN(check_in_at)
    INTO v_total_minutes, v_earliest_in
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id 
      AND work_date = p_work_date
      AND check_out_at IS NOT NULL;

    -- Evaluate Late Arrival
    IF v_earliest_in IS NOT NULL THEN
        -- Convert earliest check in timestamp to employee local time
        v_actual_start_time := (v_earliest_in AT TIME ZONE v_emp_tz)::TIME;
        IF v_actual_start_time > (v_expected_start + (v_grace_minutes || ' minutes')::INTERVAL) THEN
            v_is_late := TRUE;
        END IF;
    END IF;

    -- Categorize day status based on minutes and company policies
    IF v_total_minutes >= (v_full_day_target - v_grace_minutes) THEN
        v_status := 'present';
    ELSIF v_total_minutes >= v_half_day_minutes THEN
        v_status := 'half_day';
    ELSIF v_is_holiday THEN
        v_status := 'holiday';
    ELSIF v_is_weekend THEN
        v_status := 'weekend';
    ELSE
        -- Check if employee has an open ongoing session today
        IF EXISTS (
            SELECT 1 FROM public.attendance_sessions
            WHERE employee_id = p_employee_id 
              AND work_date = p_work_date
              AND check_out_at IS NULL
        ) THEN
            v_status := 'present';
        ELSE
            v_status := 'absent';
        END IF;
    END IF;

    -- Upsert consolidated daily summary
    INSERT INTO public.attendance_days (
        employee_id,
        work_date,
        total_minutes,
        status,
        is_late,
        locked,
        updated_at
    )
    VALUES (
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_status,
        v_is_late,
        FALSE,
        NOW()
    )
    ON CONFLICT (employee_id, work_date)
    DO UPDATE SET
        total_minutes = EXCLUDED.total_minutes,
        status = EXCLUDED.status,
        is_late = EXCLUDED.is_late,
        updated_at = NOW();

END;
$$;

---------------------------------------------------------
-- 2. CHECK IN RPC FUNCTION
---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_in(
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_emp_tz TEXT := 'UTC';
    v_work_date DATE;
    v_server_now TIMESTAMPTZ := NOW();
    v_session_id UUID;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Fetch employee timezone to calculate correct work_date
    SELECT timezone INTO v_emp_tz
    FROM public.employees
    WHERE id = v_user_id;

    IF v_emp_tz IS NULL THEN
        v_emp_tz := 'UTC';
    END IF;

    -- Server authoritative work_date in employee local time
    v_work_date := (v_server_now AT TIME ZONE v_emp_tz)::DATE;

    -- Check if an active open session already exists
    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = v_user_id AND check_out_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Active session already exists. Please check out first.';
    END IF;

    -- Insert new session
    INSERT INTO public.attendance_sessions (
        employee_id,
        work_date,
        check_in_at,
        source,
        note
    )
    VALUES (
        v_user_id,
        v_work_date,
        v_server_now,
        'web',
        p_note
    )
    RETURNING id INTO v_session_id;

    -- Trigger day recalculation
    PERFORM public.recalculate_day(v_user_id, v_work_date);

    RETURN jsonb_build_object(
        'session_id', v_session_id,
        'check_in_at', v_server_now,
        'work_date', v_work_date
    );
END;
$$;

---------------------------------------------------------
-- 3. CHECK OUT RPC FUNCTION
---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.check_out()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_user_id UUID;
    v_session_id UUID;
    v_check_in_at TIMESTAMPTZ;
    v_server_now TIMESTAMPTZ := NOW();
    v_final_check_out TIMESTAMPTZ;
    v_work_date DATE;
    v_duration_minutes INTEGER;
    v_max_duration INTERVAL := INTERVAL '16 hours';
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    -- Locate active open session
    SELECT id, check_in_at, work_date
    INTO v_session_id, v_check_in_at, v_work_date
    FROM public.attendance_sessions
    WHERE employee_id = v_user_id AND check_out_at IS NULL
    FOR UPDATE;

    IF v_session_id IS NULL THEN
        RAISE EXCEPTION 'No active session found to check out.';
    END IF;

    -- Cap maximum continuous session length at 16 hours
    IF (v_server_now - v_check_in_at) > v_max_duration THEN
        v_final_check_out := v_check_in_at + v_max_duration;
    ELSE
        v_final_check_out := v_server_now;
    END IF;

    -- Calculate duration minutes
    v_duration_minutes := ROUND(EXTRACT(EPOCH FROM (v_final_check_out - v_check_in_at)) / 60.0)::INTEGER;

    -- Update session
    UPDATE public.attendance_sessions
    SET check_out_at = v_final_check_out
    WHERE id = v_session_id;

    -- Trigger day recalculation
    PERFORM public.recalculate_day(v_user_id, v_work_date);

    RETURN jsonb_build_object(
        'session_id', v_session_id,
        'check_out_at', v_final_check_out,
        'duration_minutes', v_duration_minutes,
        'work_date', v_work_date
    );
END;
$$;

---------------------------------------------------------
-- 4. LOCK MONTH FUNCTION (HR / Admin Only)
---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_role TEXT;
    v_count INTEGER := 0;
BEGIN
    v_role := public.current_user_role();
    IF v_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Access denied. HR or Admin role required.';
    END IF;

    -- Lock all attendance days for specified month
    UPDATE public.attendance_days
    SET locked = TRUE, updated_at = NOW()
    WHERE EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month
      AND locked = FALSE;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- Audit log entry
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        table_name,
        record_id,
        new_data
    )
    VALUES (
        auth.uid(),
        'LOCK_MONTH',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'records_locked', v_count)
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'records_locked', v_count,
        'year', p_year,
        'month', p_month
    );
END;
$$;

-- Grant execution to authenticated users
GRANT EXECUTE ON FUNCTION public.check_in(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_out() TO authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_day(UUID, DATE) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_month(INTEGER, INTEGER) TO authenticated;


-- Migration: 20261107000005_regularization_rpcs.sql
-- Description: Regularization approval and rejection workflows with audit logging

---------------------------------------------------------
-- 1. APPROVE REGULARIZATION RPC FUNCTION
---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.approve_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role TEXT;
    v_req RECORD;
    v_emp RECORD;
    v_old_day RECORD;
    v_new_day RECORD;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_actor_role := public.current_user_role();

    -- Lock the regularization request row
    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_req.id IS NULL THEN
        RAISE EXCEPTION 'Regularization request not found';
    END IF;

    IF v_req.status != 'pending' THEN
        RAISE EXCEPTION 'Request has already been %', v_req.status;
    END IF;

    -- Fetch employee information
    SELECT id, manager_id, full_name, email INTO v_emp
    FROM public.employees
    WHERE id = v_req.employee_id;

    -- Verify Authorization: Direct Manager or HR / Admin
    IF v_actor_role NOT IN ('hr', 'admin') AND (v_emp.manager_id IS NULL OR v_emp.manager_id != v_actor_id) THEN
        RAISE EXCEPTION 'Access denied. Only the direct reporting manager or HR/Admin can approve this request.';
    END IF;

    -- Capture previous day summary for audit log
    SELECT * INTO v_old_day
    FROM public.attendance_days
    WHERE employee_id = v_req.employee_id AND work_date = v_req.work_date;

    -- Insert or update the manual attendance session
    INSERT INTO public.attendance_sessions (
        employee_id,
        work_date,
        check_in_at,
        check_out_at,
        source,
        note
    )
    VALUES (
        v_req.employee_id,
        v_req.work_date,
        v_req.requested_in,
        v_req.requested_out,
        'manual',
        'Regularization: ' || v_req.reason
    );

    -- Update request status
    UPDATE public.regularization_requests
    SET status = 'approved',
        reviewed_by = v_actor_id,
        reviewed_at = NOW(),
        review_note = p_review_note
    WHERE id = p_request_id;

    -- Recalculate attendance day
    PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

    -- Capture new day summary for audit log
    SELECT * INTO v_new_day
    FROM public.attendance_days
    WHERE employee_id = v_req.employee_id AND work_date = v_req.work_date;

    -- Record Audit Log entry
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        table_name,
        record_id,
        old_data,
        new_data
    )
    VALUES (
        v_actor_id,
        'REGULARIZATION_APPROVED',
        'attendance_days',
        p_request_id,
        row_to_json(v_old_day)::jsonb,
        row_to_json(v_new_day)::jsonb
    );

    -- Dispatch in-app notification to employee
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body
    )
    VALUES (
        v_req.employee_id,
        'request_status',
        'Regularization Approved',
        'Your attendance request for ' || v_req.work_date || ' was approved.'
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'status', 'approved',
        'request_id', p_request_id,
        'work_date', v_req.work_date
    );
END;
$$;

---------------------------------------------------------
-- 2. REJECT REGULARIZATION RPC FUNCTION
---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reject_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_actor_id UUID;
    v_actor_role TEXT;
    v_req RECORD;
    v_emp RECORD;
BEGIN
    v_actor_id := auth.uid();
    IF v_actor_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    v_actor_role := public.current_user_role();

    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_req.id IS NULL THEN
        RAISE EXCEPTION 'Regularization request not found';
    END IF;

    IF v_req.status != 'pending' THEN
        RAISE EXCEPTION 'Request has already been %', v_req.status;
    END IF;

    SELECT id, manager_id INTO v_emp
    FROM public.employees
    WHERE id = v_req.employee_id;

    IF v_actor_role NOT IN ('hr', 'admin') AND (v_emp.manager_id IS NULL OR v_emp.manager_id != v_actor_id) THEN
        RAISE EXCEPTION 'Access denied. Only the direct reporting manager or HR/Admin can reject this request.';
    END IF;

    -- Update request status
    UPDATE public.regularization_requests
    SET status = 'rejected',
        reviewed_by = v_actor_id,
        reviewed_at = NOW(),
        review_note = p_review_note
    WHERE id = p_request_id;

    -- Record Audit Log entry
    INSERT INTO public.audit_logs (
        actor_id,
        action,
        table_name,
        record_id,
        old_data,
        new_data
    )
    VALUES (
        v_actor_id,
        'REGULARIZATION_REJECTED',
        'regularization_requests',
        p_request_id,
        jsonb_build_object('status', 'pending'),
        jsonb_build_object('status', 'rejected', 'note', p_review_note)
    );

    -- Dispatch notification
    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body
    )
    VALUES (
        v_req.employee_id,
        'request_status',
        'Regularization Declined',
        COALESCE(p_review_note, 'Your attendance request for ' || v_req.work_date || ' was not approved.')
    );

    RETURN jsonb_build_object(
        'success', TRUE,
        'status', 'rejected',
        'request_id', p_request_id
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.approve_regularization(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_regularization(UUID, TEXT) TO authenticated;



-- Migration: 20261107000006_cron_jobs.sql
-- Description: Automated Background Jobs for Auto-Checkout and Nightly Attendance Finalization

-- Enable pg_cron if available on the PostgreSQL instance
CREATE EXTENSION IF NOT EXISTS "pg_cron";

---------------------------------------------------------
-- 1. AUTO-CHECKOUT BACKGROUND PROCEDURE
---------------------------------------------------------
-- Closes sessions that remained open past 23:59 or 16 hours
CREATE OR REPLACE FUNCTION public.cron_auto_checkout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_closed_count INTEGER := 0;
    v_rec RECORD;
    v_checkout_time TIMESTAMPTZ;
BEGIN
    FOR v_rec IN
        SELECT id, employee_id, work_date, check_in_at
        FROM public.attendance_sessions
        WHERE check_out_at IS NULL
          AND (NOW() - check_in_at) >= INTERVAL '12 hours'
    LOOP
        -- Cap check_out_at at 8 hours after check-in or midnight
        v_checkout_time := v_rec.check_in_at + INTERVAL '8 hours';
        IF v_checkout_time > NOW() THEN
            v_checkout_time := NOW();
        END IF;

        UPDATE public.attendance_sessions
        SET check_out_at = v_checkout_time,
            source = 'auto',
            note = COALESCE(note, '') || ' [System Auto-Checkout at Day End]'
        WHERE id = v_rec.id;

        -- Recalculate employee's day
        PERFORM public.recalculate_day(v_rec.employee_id, v_rec.work_date);

        -- Dispatch in-app warning notification
        INSERT INTO public.notifications (
            user_id,
            type,
            title,
            body
        )
        VALUES (
            v_rec.employee_id,
            'missed_checkout',
            'Missed Checkout Recorded',
            'Your session on ' || v_rec.work_date || ' was auto-closed. Please apply for regularization if adjustments are needed.'
        );

        v_closed_count := v_closed_count + 1;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

---------------------------------------------------------
-- 2. NIGHTLY BATCH FINALIZE PROCEDURE
---------------------------------------------------------
-- Marks absent for active employees who did not record any punch on past workdays
CREATE OR REPLACE FUNCTION public.cron_nightly_finalize()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_yesterday DATE := CURRENT_DATE - 1;
    v_marked_count INTEGER := 0;
    v_emp RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_is_weekend BOOLEAN := FALSE;
BEGIN
    -- Check if yesterday was holiday or weekend
    IF EXISTS (SELECT 1 FROM public.holidays WHERE date = v_yesterday) THEN
        v_is_holiday := TRUE;
    END IF;

    IF EXTRACT(ISODOW FROM v_yesterday) IN (6, 7) THEN
        v_is_weekend := TRUE;
    END IF;

    -- Iterate active confirmed employees
    FOR v_emp IN
        SELECT id FROM public.employees WHERE status = 'active'
    LOOP
        -- Check if an attendance record exists for yesterday
        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_days 
            WHERE employee_id = v_emp.id AND work_date = v_yesterday
        ) THEN
            INSERT INTO public.attendance_days (
                employee_id,
                work_date,
                total_minutes,
                status,
                is_late,
                locked
            )
            VALUES (
                v_emp.id,
                v_yesterday,
                0,
                CASE 
                    WHEN v_is_holiday THEN 'holiday'
                    WHEN v_is_weekend THEN 'weekend'
                    ELSE 'absent'
                END,
                FALSE,
                FALSE
            );
            v_marked_count := v_marked_count + 1;
        END IF;
    END LOOP;

    RETURN v_marked_count;
END;
$$;

-- Schedule jobs using pg_cron (if extension exists)
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Run Auto-Checkout at 23:59 every night
        PERFORM cron.schedule(
            'nightly-auto-checkout',
            '59 23 * * *',
            'SELECT public.cron_auto_checkout();'
        );

        -- Run Finalize Batch at 01:00 AM every night
        PERFORM cron.schedule(
            'nightly-finalize-attendance',
            '0 1 * * *',
            'SELECT public.cron_nightly_finalize();'
        );
    END IF;
END $$;



-- Migration: 20261107000007_security_and_mfa.sql
-- Description: Security Hardening: SET search_path = '', Revoke EXECUTE from PUBLIC/anon,
--              Restrictive AAL2 MFA policies for HR/Admin across all public tables,
--              Separation of Duties, schema qualifications, and can_approve_for() helper.

-- 1. Schema Extensions on notifications table
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS link TEXT;
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS metadata JSONB;

-- 2. Fast helper: current_user_role() with search_path = ''
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
        'employee'
    );
$$;

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_user_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;

-- 3. Fast helper: get_user_role(UUID) with search_path = ''
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role FROM public.user_roles WHERE user_id = p_user_id LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_user_role(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_user_role(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;

-- 4. Supabase Custom Access Token Hook with search_path = ''
CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    claims JSONB;
    user_role TEXT;
    target_user_id UUID;
BEGIN
    target_user_id := (event->>'user_id')::UUID;
    
    SELECT role INTO user_role 
    FROM public.user_roles 
    WHERE user_id = target_user_id 
    LIMIT 1;

    IF user_role IS NULL THEN
        user_role := 'employee';
    END IF;

    claims := event->'claims';
    claims := pg_catalog.jsonb_set(claims, '{user_role}', pg_catalog.to_jsonb(user_role));
    event := pg_catalog.jsonb_set(event, '{claims}', claims);
    
    RETURN event;
END;
$$;

-- Critical: ensure supabase_auth_admin retains execution permission
GRANT USAGE ON SCHEMA public TO supabase_auth_admin;
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;
REVOKE EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) FROM authenticated, anon, PUBLIC;

-- 5. Approval authority helper: can_approve_for(UUID, UUID)
CREATE OR REPLACE FUNCTION public.can_approve_for(
    p_approver_id UUID,
    p_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_approver_role TEXT;
    v_is_direct_manager BOOLEAN := FALSE;
BEGIN
    SELECT role INTO v_approver_role 
    FROM public.user_roles 
    WHERE user_id = p_approver_id;

    IF v_approver_role IN ('hr', 'admin') THEN
        RETURN TRUE;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.employees 
        WHERE id = p_employee_id AND manager_id = p_approver_id
    ) INTO v_is_direct_manager;

    IF v_is_direct_manager THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_approve_for(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_approve_for(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.can_approve_for(UUID, UUID) TO authenticated;

-- 6. Hardened check_in with search_path = '' and AAL2 on privileged overrides
DROP FUNCTION IF EXISTS public.check_in(UUID, TEXT);
CREATE OR REPLACE FUNCTION public.check_in(
    p_employee_id UUID,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_target_id UUID := coalesce(p_employee_id, (SELECT auth.uid()));
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
    v_today DATE;
    v_now TIMESTAMPTZ := pg_catalog.now();
    v_session_id UUID;
    v_policy RECORD;
    v_shift_start TIMESTAMPTZ;
    v_is_late BOOLEAN := FALSE;
    v_existing_open UUID;
    v_emp_timezone TEXT;
    v_emp_status TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    -- If caller checking in for another employee, require HR/Admin role AND AAL2
    IF v_caller_id <> v_target_id THEN
        SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Unauthorized check-in attempt for another employee.';
        END IF;

        IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative check-in override.';
        END IF;
    END IF;

    -- Verify employee status
    SELECT status, timezone INTO v_emp_status, v_emp_timezone 
    FROM public.employees 
    WHERE id = v_target_id;

    IF v_emp_status IS NULL THEN
        RAISE EXCEPTION 'Employee record not found.';
    END IF;

    IF v_emp_status <> 'active' THEN
        RAISE EXCEPTION 'Inactive or exited employees cannot check in.';
    END IF;

    v_today := (v_now AT TIME ZONE COALESCE(v_emp_timezone, 'UTC'))::date;

    -- Check open session
    SELECT id INTO v_existing_open
    FROM public.attendance_sessions
    WHERE employee_id = v_target_id AND check_out_at IS NULL;

    IF v_existing_open IS NOT NULL THEN
        RAISE EXCEPTION 'Active session already open. Check out first before starting a new session.';
    END IF;

    -- Check attendance policy
    SELECT * INTO v_policy 
    FROM public.attendance_policies 
    WHERE is_active = TRUE 
    LIMIT 1;

    IF v_policy IS NOT NULL THEN
        v_shift_start := (v_today::text || ' 09:30:00')::timestamptz;
        IF v_now > (v_shift_start + (v_policy.grace_minutes || ' minutes')::interval) THEN
            v_is_late := TRUE;
        END IF;
    END IF;

    -- Insert session
    INSERT INTO public.attendance_sessions (
        employee_id,
        work_date,
        check_in_at,
        source,
        note
    ) VALUES (
        v_target_id,
        v_today,
        v_now,
        'web',
        p_note
    ) RETURNING id INTO v_session_id;

    -- Upsert attendance day
    INSERT INTO public.attendance_days (
        employee_id,
        work_date,
        total_minutes,
        status,
        is_late,
        locked
    ) VALUES (
        v_target_id,
        v_today,
        0,
        'present',
        v_is_late,
        FALSE
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE
    SET is_late = EXCLUDED.is_late OR attendance_days.is_late,
        status = CASE 
            WHEN attendance_days.status = 'absent' THEN 'present' 
            ELSE attendance_days.status 
        END,
        updated_at = v_now;

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'session_id', v_session_id,
        'check_in_at', v_now,
        'work_date', v_today,
        'is_late', v_is_late
    );
END;
$$;

-- Single parameter overload for backward compatibility with frontend: check_in(p_note)
CREATE OR REPLACE FUNCTION public.check_in(p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.check_in(NULL, p_note);
$$;

REVOKE ALL ON FUNCTION public.check_in(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.check_in(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_in(TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_in(TEXT) TO authenticated;

-- 7. Hardened check_out with search_path = '' and AAL2 on privileged overrides
DROP FUNCTION IF EXISTS public.check_out(UUID, UUID);
CREATE OR REPLACE FUNCTION public.check_out(
    p_employee_id UUID,
    p_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID := (SELECT auth.uid());
    v_target_id UUID := coalesce(p_employee_id, (SELECT auth.uid()));
    v_caller_role TEXT;
    v_now TIMESTAMPTZ := pg_catalog.now();
    v_session RECORD;
    v_duration_minutes INTEGER;
    v_capped_duration INTEGER;
    v_today DATE;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    IF v_caller_id <> v_target_id THEN
        SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Unauthorized check-out attempt.';
        END IF;

        IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative check-out override.';
        END IF;
    END IF;

    IF p_session_id IS NOT NULL THEN
        SELECT * INTO v_session
        FROM public.attendance_sessions
        WHERE id = p_session_id AND employee_id = v_target_id AND check_out_at IS NULL;
    ELSE
        SELECT * INTO v_session
        FROM public.attendance_sessions
        WHERE employee_id = v_target_id AND check_out_at IS NULL
        ORDER BY check_in_at DESC
        LIMIT 1;
    END IF;

    IF v_session IS NULL THEN
        RAISE EXCEPTION 'No matching open session found to check out.';
    END IF;

    v_duration_minutes := pg_catalog.round(EXTRACT(EPOCH FROM (v_now - v_session.check_in_at)) / 60)::integer;
    v_capped_duration := LEAST(GREATEST(v_duration_minutes, 1), 960);
    v_today := v_session.work_date;

    UPDATE public.attendance_sessions
    SET check_out_at = v_now
    WHERE id = v_session.id;

    PERFORM public.recalculate_day(v_target_id, v_today);

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'session_id', v_session.id,
        'check_out_at', v_now,
        'work_date', v_today,
        'duration_minutes', v_capped_duration
    );
END;
$$;

-- Zero parameter overload for backward compatibility with frontend: check_out()
CREATE OR REPLACE FUNCTION public.check_out()
RETURNS JSONB
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.check_out(NULL, NULL);
$$;

REVOKE ALL ON FUNCTION public.check_out(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_out(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.check_out(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.check_out() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_out() FROM anon;
GRANT EXECUTE ON FUNCTION public.check_out() TO authenticated;

-- 8. Hardened recalculate_day with search_path = ''
CREATE OR REPLACE FUNCTION public.recalculate_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total_minutes INTEGER := 0;
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_policy RECORD;
    v_is_locked BOOLEAN := FALSE;
BEGIN
    SELECT locked INTO v_is_locked 
    FROM public.attendance_days 
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    IF v_is_locked = TRUE THEN
        RETURN;
    END IF;

    SELECT coalesce(pg_catalog.sum(
        pg_catalog.round(EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60)
    )::integer, 0)
    INTO v_total_minutes
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id 
      AND work_date = p_work_date 
      AND check_out_at IS NOT NULL;

    SELECT * INTO v_policy 
    FROM public.attendance_policies 
    WHERE is_active = TRUE 
    LIMIT 1;

    IF v_policy IS NOT NULL THEN
        IF v_total_minutes >= v_policy.half_day_minutes THEN
            v_status := 'present';
        ELSIF v_total_minutes >= v_policy.absent_minutes THEN
            v_status := 'half_day';
        ELSE
            v_status := 'absent';
        END IF;
    ELSE
        IF v_total_minutes >= 240 THEN
            v_status := 'present';
        ELSE
            v_status := 'absent';
        END IF;
    END IF;

    SELECT coalesce(is_late, FALSE) INTO v_is_late
    FROM public.attendance_days
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    v_is_late := coalesce(v_is_late, FALSE);

    INSERT INTO public.attendance_days (
        employee_id,
        work_date,
        total_minutes,
        status,
        is_late,
        locked,
        updated_at
    ) VALUES (
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_status,
        v_is_late,
        FALSE,
        pg_catalog.now()
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE
    SET total_minutes = EXCLUDED.total_minutes,
        status = CASE 
            WHEN attendance_days.status = 'leave' THEN 'leave'
            WHEN attendance_days.status = 'holiday' THEN 'holiday'
            ELSE EXCLUDED.status 
        END,
        updated_at = pg_catalog.now();
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_day(UUID, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.recalculate_day(UUID, DATE) FROM anon;
GRANT EXECUTE ON FUNCTION public.recalculate_day(UUID, DATE) TO authenticated;

-- 9. Hardened lock_month and unlock_month with AAL2 verification
CREATE OR REPLACE FUNCTION public.lock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_rows_locked INTEGER;
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can lock attendance months.';
    END IF;

    IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to lock attendance months.';
    END IF;

    v_start_date := pg_catalog.make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + INTERVAL '1 month - 1 day')::date;

    UPDATE public.attendance_days
    SET locked = TRUE,
        updated_at = pg_catalog.now()
    WHERE work_date >= v_start_date AND work_date <= v_end_date;

    GET DIAGNOSTICS v_rows_locked = ROW_COUNT;

    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_id,
        'LOCK_MONTH',
        'attendance_days',
        v_caller_id,
        pg_catalog.jsonb_build_object(
            'year', p_year,
            'month', p_month,
            'rows_locked', v_rows_locked
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'year', p_year,
        'month', p_month,
        'rows_locked', v_rows_locked
    );
END;
$$;

REVOKE ALL ON FUNCTION public.lock_month(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lock_month(INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.lock_month(INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.unlock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_start_date DATE;
    v_end_date DATE;
    v_rows_unlocked INTEGER;
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
    IF v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Administrators can unlock attendance months.';
    END IF;

    IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to unlock attendance months.';
    END IF;

    v_start_date := pg_catalog.make_date(p_year, p_month, 1);
    v_end_date := (v_start_date + INTERVAL '1 month - 1 day')::date;

    UPDATE public.attendance_days
    SET locked = FALSE,
        updated_at = pg_catalog.now()
    WHERE work_date >= v_start_date AND work_date <= v_end_date;

    GET DIAGNOSTICS v_rows_unlocked = ROW_COUNT;

    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_id,
        'UNLOCK_MONTH',
        'attendance_days',
        v_caller_id,
        pg_catalog.jsonb_build_object(
            'year', p_year,
            'month', p_month,
            'rows_unlocked', v_rows_unlocked
        )
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'year', p_year,
        'month', p_month,
        'rows_unlocked', v_rows_unlocked
    );
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_month(INTEGER, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.unlock_month(INTEGER, INTEGER) FROM anon;
GRANT EXECUTE ON FUNCTION public.unlock_month(INTEGER, INTEGER) TO authenticated;

-- 10. Hardened approve_regularization with Separation of Duties & AAL2
CREATE OR REPLACE FUNCTION public.approve_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
    v_can_approve BOOLEAN;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    SELECT * INTO v_req 
    FROM public.regularization_requests 
    WHERE id = p_request_id;

    IF v_req IS NULL THEN
        RAISE EXCEPTION 'Regularization request not found.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Request is already finalized (status: %).', v_req.status;
    END IF;

    -- Anti-collusion: Separation of duties prevents approving own request
    IF v_req.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot approve your own regularization request.';
    END IF;

    -- Authority check
    v_can_approve := public.can_approve_for(v_caller_id, v_req.employee_id);
    IF NOT v_can_approve THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to approve requests for this employee.';
    END IF;

    -- HR & Admin require AAL2
    SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
    IF v_caller_role IN ('hr', 'admin') THEN
        IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative approvals.';
        END IF;
    END IF;

    -- Insert corrected synthetic punch session
    INSERT INTO public.attendance_sessions (
        employee_id,
        work_date,
        check_in_at,
        check_out_at,
        source,
        note
    ) VALUES (
        v_req.employee_id,
        v_req.work_date,
        v_req.requested_in,
        v_req.requested_out,
        'manual',
        'Regularization Approved: ' || COALESCE(v_req.reason, '')
    );

    UPDATE public.regularization_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id;

    PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body,
        link
    ) VALUES (
        v_req.employee_id,
        'request_status',
        'Regularization Approved',
        'Your punch correction for ' || v_req.work_date::text || ' was approved.',
        '/attendance'
    );

    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_id,
        'APPROVE_REGULARIZATION',
        'regularization_requests',
        p_request_id,
        pg_catalog.jsonb_build_object('status', 'pending'),
        pg_catalog.jsonb_build_object('status', 'approved', 'review_note', p_review_note)
    );

    RETURN pg_catalog.jsonb_build_object('success', TRUE, 'request_id', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.approve_regularization(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.approve_regularization(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.approve_regularization(UUID, TEXT) TO authenticated;

-- 11. Hardened reject_regularization with Separation of Duties & AAL2
CREATE OR REPLACE FUNCTION public.reject_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID := (SELECT auth.uid());
    v_caller_role TEXT;
    v_can_approve BOOLEAN;
BEGIN
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Unauthenticated';
    END IF;

    SELECT * INTO v_req 
    FROM public.regularization_requests 
    WHERE id = p_request_id;

    IF v_req IS NULL THEN
        RAISE EXCEPTION 'Regularization request not found.';
    END IF;

    IF v_req.status <> 'pending' THEN
        RAISE EXCEPTION 'Request is already finalized (status: %).', v_req.status;
    END IF;

    -- Anti-collusion: Separation of duties prevents rejecting own request
    IF v_req.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot reject your own regularization request.';
    END IF;

    -- Authority check
    v_can_approve := public.can_approve_for(v_caller_id, v_req.employee_id);
    IF NOT v_can_approve THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to reject requests for this employee.';
    END IF;

    -- HR & Admin require AAL2
    SELECT role INTO v_caller_role FROM public.user_roles WHERE user_id = v_caller_id;
    IF v_caller_role IN ('hr', 'admin') THEN
        IF COALESCE((SELECT auth.jwt())->>'aal', 'aal1') <> 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative rejections.';
        END IF;
    END IF;

    UPDATE public.regularization_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id;

    INSERT INTO public.notifications (
        user_id,
        type,
        title,
        body,
        link
    ) VALUES (
        v_req.employee_id,
        'request_status',
        'Regularization Declined',
        COALESCE(p_review_note, 'Your attendance request for ' || v_req.work_date::text || ' was not approved.'),
        '/attendance'
    );

    INSERT INTO public.audit_logs (actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_id,
        'REJECT_REGULARIZATION',
        'regularization_requests',
        p_request_id,
        pg_catalog.jsonb_build_object('status', 'pending'),
        pg_catalog.jsonb_build_object('status', 'rejected', 'note', p_review_note)
    );

    RETURN pg_catalog.jsonb_build_object('success', TRUE, 'request_id', p_request_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reject_regularization(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_regularization(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.reject_regularization(UUID, TEXT) TO authenticated;

-- 12. Hardened cron jobs with search_path = ''
CREATE OR REPLACE FUNCTION public.cron_auto_checkout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_closed_count INTEGER := 0;
    v_rec RECORD;
    v_checkout_time TIMESTAMPTZ;
BEGIN
    FOR v_rec IN
        SELECT id, employee_id, work_date, check_in_at
        FROM public.attendance_sessions
        WHERE check_out_at IS NULL
          AND (pg_catalog.now() - check_in_at) >= INTERVAL '12 hours'
    LOOP
        v_checkout_time := v_rec.check_in_at + INTERVAL '8 hours';
        IF v_checkout_time > pg_catalog.now() THEN
            v_checkout_time := pg_catalog.now();
        END IF;

        UPDATE public.attendance_sessions
        SET check_out_at = v_checkout_time,
            source = 'auto',
            note = COALESCE(note, '') || ' [System Auto-Checkout at Day End]'
        WHERE id = v_rec.id;

        PERFORM public.recalculate_day(v_rec.employee_id, v_rec.work_date);

        INSERT INTO public.notifications (
            user_id,
            type,
            title,
            body
        ) VALUES (
            v_rec.employee_id,
            'missed_checkout',
            'Missed Checkout Recorded',
            'Your session on ' || v_rec.work_date::text || ' was auto-closed. Please apply for regularization if adjustments are needed.'
        );

        v_closed_count := v_closed_count + 1;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_auto_checkout() FROM anon;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout() TO authenticated;

CREATE OR REPLACE FUNCTION public.cron_nightly_finalize()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_yesterday DATE := (pg_catalog.now() - INTERVAL '1 day')::date;
    v_marked_count INTEGER := 0;
    v_emp RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_is_weekend BOOLEAN := FALSE;
BEGIN
    IF EXISTS (SELECT 1 FROM public.holidays WHERE date = v_yesterday) THEN
        v_is_holiday := TRUE;
    END IF;

    IF EXTRACT(ISODOW FROM v_yesterday) IN (6, 7) THEN
        v_is_weekend := TRUE;
    END IF;

    FOR v_emp IN
        SELECT id FROM public.employees WHERE status = 'active'
    LOOP
        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_days 
            WHERE employee_id = v_emp.id AND work_date = v_yesterday
        ) THEN
            INSERT INTO public.attendance_days (
                employee_id,
                work_date,
                total_minutes,
                status,
                is_late,
                locked,
                created_at,
                updated_at
            ) VALUES (
                v_emp.id,
                v_yesterday,
                0,
                CASE 
                    WHEN v_is_holiday THEN 'holiday'
                    WHEN v_is_weekend THEN 'weekend'
                    ELSE 'absent'
                END,
                FALSE,
                FALSE,
                pg_catalog.now(),
                pg_catalog.now()
            );
            v_marked_count := v_marked_count + 1;
        END IF;
    END LOOP;

    RETURN v_marked_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_nightly_finalize() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cron_nightly_finalize() FROM anon;
GRANT EXECUTE ON FUNCTION public.cron_nightly_finalize() TO authenticated;

-- 13. RESTRICTIVE AAL2 MFA Policies across all public tables for HR & Admin
-- AS RESTRICTIVE policies must evaluate to TRUE in addition to permissive policies.
-- By evaluating against JWT claims (auth.jwt()->>'user_role' and auth.jwt()->>'aal'),
-- they operate with zero subquery overhead and prevent recursive lockouts.

DO $$
BEGIN
    -- 13.1 employees
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'employees' AND policyname = 'enforce_mfa_aal2_employees') THEN
        CREATE POLICY "enforce_mfa_aal2_employees" ON public.employees
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.2 user_roles
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'user_roles' AND policyname = 'enforce_mfa_aal2_user_roles') THEN
        CREATE POLICY "enforce_mfa_aal2_user_roles" ON public.user_roles
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.3 attendance_policies
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_policies' AND policyname = 'enforce_mfa_aal2_attendance_policies') THEN
        CREATE POLICY "enforce_mfa_aal2_attendance_policies" ON public.attendance_policies
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.4 audit_logs
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'audit_logs' AND policyname = 'enforce_mfa_aal2_audit_logs') THEN
        CREATE POLICY "enforce_mfa_aal2_audit_logs" ON public.audit_logs
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.5 attendance_sessions (for direct emergency admin modifications)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_sessions' AND policyname = 'enforce_mfa_aal2_attendance_sessions') THEN
        CREATE POLICY "enforce_mfa_aal2_attendance_sessions" ON public.attendance_sessions
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.6 attendance_days (for direct updates by HR / Admin)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'attendance_days' AND policyname = 'enforce_mfa_aal2_attendance_days') THEN
        CREATE POLICY "enforce_mfa_aal2_attendance_days" ON public.attendance_days
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.7 regularization_requests (for direct updates by HR / Admin)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'regularization_requests' AND policyname = 'enforce_mfa_aal2_regularization_requests') THEN
        CREATE POLICY "enforce_mfa_aal2_regularization_requests" ON public.regularization_requests
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;

    -- 13.8 holidays (for holiday schedule mutations by HR / Admin)
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'holidays' AND policyname = 'enforce_mfa_aal2_holidays') THEN
        CREATE POLICY "enforce_mfa_aal2_holidays" ON public.holidays
        AS RESTRICTIVE FOR ALL TO authenticated
        USING (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        )
        WITH CHECK (
            CASE 
                WHEN COALESCE((SELECT (auth.jwt())->>'user_role'), '') IN ('hr', 'admin') 
                THEN COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1') = 'aal2'
                ELSE TRUE 
            END
        );
    END IF;
END $$;

-- 14. Shared Persistent Rate Limiting Table
-- Replaces ephemeral in-memory storage with multi-node, serverless-safe shared persistence
CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 1,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_rate_limits FROM PUBLIC;
REVOKE ALL ON TABLE public.auth_rate_limits FROM anon;
REVOKE ALL ON TABLE public.auth_rate_limits FROM authenticated;
GRANT ALL ON TABLE public.auth_rate_limits TO service_role;



-- ============================================================================
-- Migration: 20261107000008_multi_tenancy_and_workforce.sql
-- Description: Phase 2 Multi-Tenancy & Workforce Foundation
--   Section 1: Schema Extensions (btree_gist)
--   Section 2: Organizations & Organization Members (Canonical Tenancy)
--   Section 3: Workforce Scheduling & Hardware Infrastructure (locations, shifts, kiosk)
--   Section 4: Operational Compliance & Resilience (privacy_acknowledgments, cron_run_state)
--   Section 5: Deterministic Tenant Backfill (organization_id NOT NULL across all tables)
--   Section 6: User Roles Migration & Deprecation (Explicit drops without CASCADE)
--   Section 7: Automatic Organization Derivation Triggers
--   Section 8: Tenant Context Helpers & custom_access_token_hook
--   Section 9: Core Scoped Attendance RPCs (recalculate_day, check_in, check_out, lock/unlock, regularization)
--   Section 10: Service-Role Verified Punch RPC (punch_verified)
--   Section 11: Member Administration RPCs with Last-Admin Advisory Lock
--   Section 12: Defense-in-Depth Triggers (Field Protection & IP Range Gate)
--   Section 13: Strict Privilege Hardening (Revokes & Column-Level Grants)
--   Section 14: Per-Command Role-Gated & Active Membership RLS Policies
--   Section 15: Administrative Organization Provisioning (admin_create_organization)
-- ============================================================================

-- ============================================================================
-- SECTION 1: Schema Extensions
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "btree_gist" WITH SCHEMA extensions;

-- ============================================================================
-- SECTION 2: Organizations & Organization Members Infrastructure
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    domain TEXT,
    work_mode TEXT NOT NULL DEFAULT 'remote' CHECK (work_mode IN ('remote', 'office', 'hybrid')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Deterministic Default Organization for Backfilled Demo Data
INSERT INTO public.organizations (id, name, slug, work_mode, status, timezone)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'demo',
    'demo',
    'remote',
    'active',
    'UTC'
)
ON CONFLICT (id) DO UPDATE SET 
    name = 'demo', 
    slug = 'demo', 
    work_mode = 'remote',
    status = 'active';

-- Canonical Organization Members Table (Single Source of Truth, Single Org Per User)
CREATE TABLE IF NOT EXISTS public.organization_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr', 'admin')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'invited')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- ============================================================================
-- SECTION 3: Locations, Shifts & Hardware Infrastructure
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT,
    city TEXT,
    country TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    working_hours INTEGER NOT NULL DEFAULT 480,
    weekly_off_days INTEGER[] NOT NULL DEFAULT '{0, 6}',
    allowed_ip_ranges TEXT[] DEFAULT '{}',
    geofence_latitude DOUBLE PRECISION,
    geofence_longitude DOUBLE PRECISION,
    geofence_radius_meters INTEGER NOT NULL DEFAULT 150,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_location_code_per_org UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.shift_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    grace_minutes INTEGER NOT NULL DEFAULT 15,
    half_day_minutes INTEGER NOT NULL DEFAULT 240,
    full_day_minutes INTEGER NOT NULL DEFAULT 480,
    break_duration_minutes INTEGER NOT NULL DEFAULT 60,
    crosses_midnight BOOLEAN NOT NULL DEFAULT FALSE,
    is_night_shift BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_shift_code_per_org UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.employee_shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE RESTRICT,
    day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT exclude_overlapping_shifts EXCLUDE USING gist (
        employee_id WITH =,
        daterange(effective_from, coalesce(effective_to, '9999-12-31'::date), '[]') WITH &&
    )
);

CREATE TABLE IF NOT EXISTS public.kiosk_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL REFERENCES public.locations(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    enrollment_token_hash TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Dedicated PIN credentials table with ZERO read grants to authenticated or public
CREATE TABLE IF NOT EXISTS public.kiosk_credentials (
    employee_id UUID PRIMARY KEY REFERENCES public.employees(id) ON DELETE CASCADE,
    pin_hash TEXT NOT NULL,
    failed_attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- ============================================================================
-- SECTION 4: Operational Compliance & Resilience Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.privacy_acknowledgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    policy_version TEXT NOT NULL,
    enabled_methods TEXT[] NOT NULL DEFAULT '{}',
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    ip_address TEXT,
    CONSTRAINT uq_privacy_ack UNIQUE (organization_id, employee_id, policy_version)
);

-- Background Cron Run State with surrogate key and sentinel NOT NULL location_id
CREATE TABLE IF NOT EXISTS public.cron_run_state (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    job_name TEXT NOT NULL,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    location_id UUID NOT NULL DEFAULT '00000000-0000-0000-0000-000000000000'::uuid,
    target_date DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('success', 'failed')),
    error_message TEXT,
    executed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_cron_run_state UNIQUE (job_name, organization_id, location_id, target_date)
);

-- ============================================================================
-- SECTION 5: Deterministic Tenant Backfill (organization_id NOT NULL)
-- ============================================================================

-- A. employees
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS primary_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS work_mode TEXT CHECK (work_mode IN ('remote', 'office', 'hybrid'));
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS expected_office_days INTEGER[] DEFAULT '{1, 3}';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS required_office_days_per_week INTEGER DEFAULT 2;

UPDATE public.employees 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.employees ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.employees ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS fk_employees_organization;
ALTER TABLE public.employees ADD CONSTRAINT fk_employees_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- B. attendance_policies
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS work_mode TEXT NOT NULL DEFAULT 'remote' CHECK (work_mode IN ('remote', 'office', 'hybrid'));
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS shift_start_time TIME NOT NULL DEFAULT '09:00:00';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS weekly_off_days INTEGER[] NOT NULL DEFAULT '{0, 6}';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS allowed_methods TEXT[] NOT NULL DEFAULT '{"web"}';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS leave_year_start_month INTEGER NOT NULL DEFAULT 1;

UPDATE public.attendance_policies 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_policies ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_policies ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.attendance_policies DROP CONSTRAINT IF EXISTS fk_policies_organization;
ALTER TABLE public.attendance_policies ADD CONSTRAINT fk_policies_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- C. attendance_sessions
ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;

UPDATE public.attendance_sessions 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_sessions ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS fk_sessions_organization;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT fk_sessions_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_source_check;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_source_check 
    CHECK (source IN ('web', 'office_ip', 'rotating_qr', 'geofence', 'kiosk', 'auto', 'manual'));

-- D. attendance_days
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shift_templates(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS work_location TEXT CHECK (work_location IN ('office', 'remote'));
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER NOT NULL DEFAULT 0;

UPDATE public.attendance_days 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_days ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_days ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.attendance_days DROP CONSTRAINT IF EXISTS fk_days_organization;
ALTER TABLE public.attendance_days ADD CONSTRAINT fk_days_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- E. regularization_requests
ALTER TABLE public.regularization_requests ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.regularization_requests 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.regularization_requests ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.regularization_requests ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.regularization_requests DROP CONSTRAINT IF EXISTS fk_requests_organization;
ALTER TABLE public.regularization_requests ADD CONSTRAINT fk_requests_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- F. notifications
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.notifications 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.notifications ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.notifications ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS fk_notifications_organization;
ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- G. holidays
ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.holidays 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.holidays ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.holidays ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS fk_holidays_organization;
ALTER TABLE public.holidays ADD CONSTRAINT fk_holidays_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- H. audit_logs
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.audit_logs 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.audit_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.audit_logs ALTER COLUMN organization_id SET DEFAULT '00000000-0000-0000-0000-000000000001'::uuid;
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS fk_audit_organization;
ALTER TABLE public.audit_logs ADD CONSTRAINT fk_audit_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ============================================================================
-- SECTION 6: User Roles Migration & Deprecation (Explicit drops without CASCADE)
-- ============================================================================

-- Step 1: Copy existing roles into organization_members
INSERT INTO public.organization_members (user_id, organization_id, role, created_at)
SELECT user_id, '00000000-0000-0000-0000-000000000001'::uuid, role, created_at
FROM public.user_roles
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;

-- Step 2: Explicitly drop dependent policies on user_roles
DROP POLICY IF EXISTS "user_roles_select_policy" ON public.user_roles;
DROP POLICY IF EXISTS "enforce_mfa_aal2_user_roles" ON public.user_roles;

-- Step 3: Tenant Context Helpers
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT om.organization_id
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = (SELECT auth.uid())
      AND om.status = 'active'
      AND o.status IN ('active', 'trial')
      AND (
          NULLIF((auth.jwt())->>'organization_id', '') IS NULL
          OR om.organization_id = NULLIF((auth.jwt())->>'organization_id', '')::uuid
      )
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.current_org_id();
$$;

CREATE OR REPLACE FUNCTION public.is_active_org_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1 
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = (SELECT auth.uid())
          AND om.organization_id = public.current_org_id()
          AND om.status = 'active'
          AND o.status IN ('active', 'trial')
    );
$$;

-- Step 4: Update role-checking functions (NO default 'employee' for users without membership)
CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
BEGIN
    SELECT role INTO v_role
    FROM public.organization_members
    WHERE user_id = p_user_id
    LIMIT 1;

    RETURN v_role;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT role 
    FROM public.organization_members 
    WHERE user_id = (SELECT auth.uid()) 
      AND organization_id = public.current_org_id() 
      AND status = 'active'
    LIMIT 1;
$$;

-- Step 4: Safely drop table public.user_roles WITHOUT CASCADE
DROP TABLE public.user_roles;

-- Step 5: Recreate user_roles as a strictly read-only compatibility view with security_invoker = true
CREATE VIEW public.user_roles WITH (security_invoker = true) AS
    SELECT user_id, role, created_at FROM public.organization_members;

REVOKE ALL ON public.user_roles FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.user_roles TO authenticated, service_role;

-- ============================================================================
-- SECTION 7: Automatic organization_id Derivation Triggers
-- ============================================================================

CREATE OR REPLACE FUNCTION public.trg_derive_session_org_id()
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
        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_session_org_id_before_insert ON public.attendance_sessions;
CREATE TRIGGER set_session_org_id_before_insert
BEFORE INSERT ON public.attendance_sessions
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_session_org_id();

CREATE OR REPLACE FUNCTION public.trg_derive_day_org_id()
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
        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_day_org_id_before_insert ON public.attendance_days;
CREATE TRIGGER set_day_org_id_before_insert
BEFORE INSERT ON public.attendance_days
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_day_org_id();

CREATE OR REPLACE FUNCTION public.trg_derive_request_org_id()
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
        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_request_org_id_before_insert ON public.regularization_requests;
CREATE TRIGGER set_request_org_id_before_insert
BEFORE INSERT ON public.regularization_requests
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_request_org_id();

CREATE OR REPLACE FUNCTION public.trg_derive_notification_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        SELECT organization_id INTO NEW.organization_id
        FROM public.employees
        WHERE id = NEW.user_id;
        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_notification_org_id_before_insert ON public.notifications;
CREATE TRIGGER set_notification_org_id_before_insert
BEFORE INSERT ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_notification_org_id();

CREATE OR REPLACE FUNCTION public.trg_derive_audit_log_org_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF NEW.organization_id IS NULL THEN
        IF NEW.actor_id IS NOT NULL THEN
            SELECT organization_id INTO NEW.organization_id
            FROM public.employees
            WHERE id = NEW.actor_id;
        END IF;

        IF NEW.organization_id IS NULL THEN
            NEW.organization_id := '00000000-0000-0000-0000-000000000001'::uuid;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_audit_log_org_id_before_insert ON public.audit_logs;
CREATE TRIGGER set_audit_log_org_id_before_insert
BEFORE INSERT ON public.audit_logs
FOR EACH ROW EXECUTE FUNCTION public.trg_derive_audit_log_org_id();

REVOKE ALL ON FUNCTION public.trg_derive_session_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_derive_day_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_derive_request_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_derive_notification_org_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.trg_derive_audit_log_org_id() FROM PUBLIC, anon;

-- ============================================================================
-- SECTION 8: custom_access_token_hook
-- ============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_claims JSONB;
    v_user_id UUID;
    v_org_id UUID;
    v_user_role TEXT;
    v_org_status TEXT;
BEGIN
    v_user_id := (event->>'user_id')::uuid;
    v_claims := event->'claims';

    -- Fetch primary organization membership and status
    SELECT om.organization_id, om.role, o.status
    INTO v_org_id, v_user_role, v_org_status
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_user_id
    LIMIT 1;

    -- Strictly refuse tokens ONLY if organization is suspended or cancelled
    IF v_org_status IN ('suspended', 'cancelled') THEN
        RAISE EXCEPTION 'Organization account is %: access denied.', v_org_status;
    END IF;

    -- If no membership row found: permit login, NO user_role, NO organization_id claim
    IF v_org_id IS NULL THEN
        v_claims := v_claims - 'user_role' - 'organization_id' - 'organization_status';
    ELSE
        -- Inject role, organization_id, and organization_status (active or trial)
        v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(v_user_role));
        v_claims := jsonb_set(v_claims, '{organization_id}', to_jsonb(v_org_id::text));
        v_claims := jsonb_set(v_claims, '{organization_status}', to_jsonb(v_org_status));
    END IF;

    event := jsonb_set(event, '{claims}', v_claims);
    RETURN event;
END;
$$;

REVOKE ALL ON FUNCTION public.custom_access_token_hook(JSONB) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.custom_access_token_hook(JSONB) TO service_role;
GRANT ALL ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin;

-- ============================================================================
-- SECTION 9: Scoped Core Attendance RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.recalculate_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total_minutes INTEGER := 0;
    v_sessions_count INTEGER := 0;
    v_first_in TIMESTAMPTZ;
    v_last_out TIMESTAMPTZ;
    v_open_sessions INTEGER := 0;
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_overtime_minutes INTEGER := 0;
    v_work_location TEXT := 'remote';
    v_policy RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_day_of_week INTEGER;
    v_is_weekend BOOLEAN := FALSE;
    v_target_minutes INTEGER := 480;
    v_org_id UUID;
    v_work_mode TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_effective_tz TEXT;
BEGIN
    SELECT 
        e.organization_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        COALESCE(e.work_target_minutes, 480)
    INTO 
        v_org_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_target_minutes
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id 
          AND (check_in_at AT TIME ZONE COALESCE(v_emp_tz, v_org_tz, 'UTC'))::date = p_work_date
          AND (location_id IS NOT NULL OR source IN ('office_ip', 'rotating_qr', 'kiosk'))
    ) THEN
        v_work_location := 'office';
    ELSE
        v_work_location := 'remote';
    END IF;

    v_effective_tz := CASE 
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN 
            CASE 
                WHEN v_work_location = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
    END;

    SELECT * INTO v_policy 
    FROM public.attendance_policies 
    WHERE organization_id = v_org_id
    LIMIT 1;

    SELECT 
        COALESCE(SUM(
            CASE 
                WHEN check_out_at IS NOT NULL 
                THEN EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60
                ELSE EXTRACT(EPOCH FROM (pg_catalog.now() - check_in_at)) / 60
            END
        ), 0)::INTEGER,
        COUNT(*),
        MIN(check_in_at),
        MAX(check_out_at),
        COUNT(*) FILTER (WHERE check_out_at IS NULL)
    INTO 
        v_total_minutes,
        v_sessions_count,
        v_first_in,
        v_last_out,
        v_open_sessions
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id 
      AND (check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date;

    SELECT EXISTS (
        SELECT 1 FROM public.holidays 
        WHERE organization_id = v_org_id AND date = p_work_date
    ) INTO v_is_holiday;

    v_day_of_week := EXTRACT(DOW FROM p_work_date)::INTEGER;
    v_is_weekend := v_day_of_week IN (0, 6);

    IF v_first_in IS NOT NULL THEN
        DECLARE
            v_expected_start TIME := '09:00:00'::time;
            v_grace INTEGER := COALESCE(v_policy.grace_minutes, 15);
            v_actual_time TIME := (v_first_in AT TIME ZONE v_effective_tz)::time;
        BEGIN
            IF v_actual_time > (v_expected_start + (v_grace || ' minutes')::interval) THEN
                v_is_late := TRUE;
            END IF;
        END;
    END IF;

    IF v_is_holiday THEN
        v_status := 'holiday';
    ELSIF v_is_weekend THEN
        v_status := 'weekend';
    ELSIF v_sessions_count = 0 THEN
        v_status := 'absent';
    ELSIF v_total_minutes >= COALESCE(v_policy.half_day_minutes, 240) AND v_total_minutes < v_target_minutes THEN
        v_status := 'half_day';
    ELSIF v_total_minutes >= v_target_minutes THEN
        v_status := 'present';
        v_overtime_minutes := GREATEST(0, v_total_minutes - v_target_minutes);
    ELSE
        v_status := 'half_day';
    END IF;

    INSERT INTO public.attendance_days (
        organization_id,
        employee_id,
        work_date,
        total_minutes,
        overtime_minutes,
        status,
        is_late,
        locked,
        updated_at
    ) VALUES (
        v_org_id,
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_overtime_minutes,
        v_status,
        v_is_late,
        FALSE,
        pg_catalog.now()
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        total_minutes = EXCLUDED.total_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes,
        status = EXCLUDED.status,
        is_late = EXCLUDED.is_late,
        updated_at = EXCLUDED.updated_at;

    RETURN;
END;
$$;

-- check_in (Self)
CREATE OR REPLACE FUNCTION public.check_in(
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_employee_id UUID;
    v_org_id UUID;
    v_allowed_methods TEXT[];
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
BEGIN
    v_employee_id := (SELECT auth.uid());
    IF v_employee_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
    END IF;

    SELECT e.organization_id, COALESCE(p.allowed_methods, '{"web"}'), COALESCE(e.timezone, o.timezone, 'UTC')
    INTO v_org_id, v_allowed_methods, v_effective_tz
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.attendance_policies p ON p.organization_id = e.organization_id
    WHERE e.id = v_employee_id;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee record not found');
    END IF;

    IF NOT ('web' = ANY(v_allowed_methods)) THEN
        RAISE EXCEPTION 'Direct web check-in is disabled for this organization. Physical verification required.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions 
        WHERE employee_id = v_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have an active open session');
    END IF;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    INSERT INTO public.attendance_sessions (
        organization_id,
        employee_id,
        work_date,
        check_in_at,
        source,
        note
    ) VALUES (
        v_org_id,
        v_employee_id,
        v_work_date,
        pg_catalog.now(),
        'web',
        p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(v_employee_id, v_work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_org_id,
        v_employee_id,
        'CHECK_IN',
        'attendance_sessions',
        v_session_id,
        jsonb_build_object('source', 'web', 'note', p_note)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

-- check_in (Administrative Override)
CREATE OR REPLACE FUNCTION public.check_in(
    p_employee_id UUID,
    p_note TEXT DEFAULT NULL
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
    v_target_org UUID;
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
    END IF;

    IF v_caller_id != p_employee_id THEN
        v_caller_role := public.current_user_role();
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized check-in attempt for another employee.');
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RETURN jsonb_build_object('success', false, 'error', 'MFA AAL2 verification required for administrative check-in override.');
        END IF;

        v_caller_org := public.current_org_id();
        SELECT organization_id INTO v_target_org FROM public.employees WHERE id = p_employee_id;

        IF v_target_org IS NULL OR v_caller_org != v_target_org THEN
            RETURN jsonb_build_object('success', false, 'error', 'Target employee not found in your organization.');
        END IF;
    END IF;

    SELECT organization_id, timezone INTO v_target_org, v_effective_tz
    FROM public.employees WHERE id = p_employee_id;

    IF v_target_org IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Target employee not found');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions 
        WHERE employee_id = p_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee already has an active open session');
    END IF;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, source, note
    ) VALUES (
        v_target_org, p_employee_id, v_work_date, pg_catalog.now(), 'manual', p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(p_employee_id, v_work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_target_org, v_caller_id, 'CHECK_IN_OVERRIDE', 'attendance_sessions', v_session_id,
        jsonb_build_object('employee_id', p_employee_id, 'source', 'manual', 'note', p_note)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

-- check_out
CREATE OR REPLACE FUNCTION public.check_out()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_employee_id UUID;
    v_session_id UUID;
    v_check_in_at TIMESTAMPTZ;
    v_org_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
BEGIN
    v_employee_id := (SELECT auth.uid());
    IF v_employee_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Unauthenticated');
    END IF;

    SELECT id, check_in_at, organization_id INTO v_session_id, v_check_in_at, v_org_id
    FROM public.attendance_sessions
    WHERE employee_id = v_employee_id AND check_out_at IS NULL
    ORDER BY check_in_at DESC
    LIMIT 1;

    IF v_session_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active session found to check out');
    END IF;

    UPDATE public.attendance_sessions
    SET check_out_at = pg_catalog.now()
    WHERE id = v_session_id;

    SELECT timezone INTO v_effective_tz FROM public.employees WHERE id = v_employee_id;
    v_work_date := (v_check_in_at AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    PERFORM public.recalculate_day(v_employee_id, v_work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id)
    VALUES (v_org_id, v_employee_id, 'CHECK_OUT', 'attendance_sessions', v_session_id);

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

-- lock_month
CREATE OR REPLACE FUNCTION public.lock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can lock attendance months.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to lock attendance months.';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = TRUE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'LOCK_MONTH',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'records_locked', v_count)
    );

    RETURN jsonb_build_object('success', true, 'records_locked', v_count);
END;
$$;

-- unlock_month
CREATE OR REPLACE FUNCTION public.unlock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role != 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Administrators can unlock attendance months.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to unlock attendance months.';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = FALSE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'UNLOCK_MONTH',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'records_unlocked', v_count)
    );

    RETURN jsonb_build_object('success', true, 'records_unlocked', v_count);
END;
$$;

-- approve_regularization
CREATE OR REPLACE FUNCTION public.approve_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_req 
    FROM public.regularization_requests 
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    -- Strict Tenant isolation check
    v_caller_org := public.current_org_id();
    IF v_req.organization_id != v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    -- Separation of duties: No self-approval by HR or anyone
    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot approve your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization approval.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to approve requests for this employee.';
    END IF;

    UPDATE public.regularization_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, check_out_at, source, note
    ) VALUES (
        v_req.organization_id, v_req.employee_id, v_req.work_date, v_req.requested_in, v_req.requested_out, 'manual',
        'Regularized: ' || COALESCE(v_req.reason, '')
    );

    PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_req.organization_id, v_caller_id, 'APPROVE_REGULARIZATION', 'regularization_requests', p_request_id,
        jsonb_build_object('employee_id', v_req.employee_id, 'work_date', v_req.work_date)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

-- reject_regularization
CREATE OR REPLACE FUNCTION public.reject_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    SELECT * INTO v_req 
    FROM public.regularization_requests 
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    -- Strict Tenant isolation check
    v_caller_org := public.current_org_id();
    IF v_req.organization_id != v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status != 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    -- Separation of duties: No self-rejection
    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot reject your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal != 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization review.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to review requests for this employee.';
    END IF;

    UPDATE public.regularization_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id)
    VALUES (v_req.organization_id, v_caller_id, 'REJECT_REGULARIZATION', 'regularization_requests', p_request_id);

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Multi-Tenant Background Cron Functions
CREATE OR REPLACE FUNCTION public.cron_auto_checkout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session RECORD;
    v_closed_count INTEGER := 0;
    v_error_count INTEGER := 0;
BEGIN
    FOR v_session IN 
        SELECT s.id, s.employee_id, s.check_in_at, s.organization_id, e.timezone
        FROM public.attendance_sessions s
        JOIN public.employees e ON e.id = s.employee_id
        WHERE s.check_out_at IS NULL
          AND s.check_in_at < (pg_catalog.now() - INTERVAL '12 hours')
    LOOP
        BEGIN
            UPDATE public.attendance_sessions
            SET check_out_at = pg_catalog.now(),
                source = 'auto',
                note = COALESCE(note, '') || ' [Auto-closed by nightly cron]'
            WHERE id = v_session.id;

            PERFORM public.recalculate_day(
                v_session.employee_id,
                (v_session.check_in_at AT TIME ZONE COALESCE(v_session.timezone, 'UTC'))::date
            );

            v_closed_count := v_closed_count + 1;
        EXCEPTION WHEN OTHERS THEN
            v_error_count := v_error_count + 1;
        END;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

-- ============================================================================
-- SECTION 10: Service-Role Verified Punch RPC (punch_verified)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.punch_verified(
    p_employee_id UUID,
    p_source TEXT,
    p_location_id UUID DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
    v_emp_status TEXT;
    v_org_status TEXT;
    v_loc_org_id UUID;
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_work_mode TEXT;
BEGIN
    IF p_source NOT IN ('office_ip', 'rotating_qr', 'geofence', 'kiosk') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid verified source type');
    END IF;

    SELECT 
        e.organization_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        e.status,
        o.status,
        l.organization_id
    INTO 
        v_org_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_emp_status, v_org_status, v_loc_org_id
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = p_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee or Organization not found');
    END IF;

    IF COALESCE(v_emp_status, 'active') != 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee is inactive');
    END IF;

    IF v_org_status NOT IN ('active', 'trial') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Organization is not active');
    END IF;

    IF p_location_id IS NOT NULL AND (v_loc_org_id IS NULL OR v_loc_org_id != v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Location does not belong to employee organization');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee already has an active open session');
    END IF;

    v_effective_tz := CASE 
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN 
            CASE 
                WHEN p_location_id IS NOT NULL OR p_source IN ('office_ip', 'rotating_qr', 'kiosk')
                THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_loc_tz, v_org_tz, 'UTC')
    END;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    INSERT INTO public.attendance_sessions (
        organization_id,
        employee_id,
        location_id,
        work_date,
        check_in_at,
        source,
        note
    ) VALUES (
        v_org_id,
        p_employee_id,
        p_location_id,
        v_work_date,
        pg_catalog.now(),
        p_source,
        p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(p_employee_id, v_work_date);

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, new_data
    ) VALUES (
        v_org_id,
        p_employee_id,
        'VERIFIED_PUNCH',
        'attendance_sessions',
        v_session_id,
        jsonb_build_object('source', p_source, 'location_id', p_location_id, 'note', p_note)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'work_date', v_work_date);
END;
$$;

REVOKE ALL ON FUNCTION public.punch_verified(UUID, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.punch_verified(UUID, TEXT, UUID, TEXT) TO service_role;

-- ============================================================================
-- SECTION 11: Member Administration & Employee Governance RPCs with Last-Admin Advisory Lock
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_add_org_member(
    p_organization_id UUID,
    p_user_id UUID,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_aal TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Derive caller's organization strictly from caller's active admin membership
    SELECT organization_id INTO v_caller_org
    FROM public.organization_members
    WHERE user_id = v_caller_id AND role = 'admin' AND status = 'active'
    LIMIT 1;

    IF v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can add organization members.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.';
    END IF;

    -- Reject any mismatch with caller's own organization
    IF p_organization_id IS NOT NULL AND p_organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    IF p_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role;
    END IF;

    -- Transaction-level advisory lock serializes member mutations
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    -- Re-verify caller's active admin role after acquiring advisory lock
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_caller_org, p_user_id, p_role, 'active')
    ON CONFLICT (user_id) DO UPDATE 
    SET organization_id = v_caller_org, role = p_role, status = 'active', updated_at = pg_catalog.now();

    -- Audit log entry
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_org,
        v_caller_id,
        'MEMBER_ADDED',
        'organization_members',
        p_user_id,
        jsonb_build_object('user_id', p_user_id, 'role', p_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_org_member_role(
    p_organization_id UUID,
    p_user_id UUID,
    p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Derive caller's organization strictly from caller's active admin membership
    SELECT organization_id INTO v_caller_org
    FROM public.organization_members
    WHERE user_id = v_caller_id AND role = 'admin' AND status = 'active'
    LIMIT 1;

    IF v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can update member roles.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.';
    END IF;

    -- Reject any mismatch with caller's own organization
    IF p_organization_id IS NOT NULL AND p_organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    IF p_new_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_new_role;
    END IF;

    -- Per-org advisory lock serializes concurrent role modifications
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    -- Re-verify caller's active admin role after acquiring advisory lock
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_current_role
    FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id AND status = 'active';

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    -- Last-admin protection & self-demotion rule
    IF v_current_role = 'admin' AND p_new_role != 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot demote yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot demote the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    UPDATE public.organization_members
    SET role = p_new_role, updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    -- Audit log entry
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_org,
        v_caller_id,
        'MEMBER_ROLE_UPDATED',
        'organization_members',
        p_user_id,
        jsonb_build_object('user_id', p_user_id, 'old_role', v_current_role, 'new_role', p_new_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_org_member(
    p_organization_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Derive caller's organization strictly from caller's active admin membership
    SELECT organization_id INTO v_caller_org
    FROM public.organization_members
    WHERE user_id = v_caller_id AND role = 'admin' AND status = 'active'
    LIMIT 1;

    IF v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can remove organization members.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.';
    END IF;

    -- Reject any mismatch with caller's own organization
    IF p_organization_id IS NOT NULL AND p_organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    -- Per-org advisory lock serializes concurrent member removals
    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    -- Re-verify caller's active admin role after acquiring advisory lock
    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_current_role
    FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    -- Last admin protection & self-removal check
    IF v_current_role = 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot remove yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot remove the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    DELETE FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    -- Audit log entry
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_caller_org,
        v_caller_id,
        'MEMBER_REMOVED',
        'organization_members',
        p_user_id,
        jsonb_build_object('user_id', p_user_id, 'removed_role', v_current_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Privileged HR/Admin RPC for creating employee records
CREATE OR REPLACE FUNCTION public.admin_create_employee(
    p_user_id UUID,
    p_email TEXT,
    p_full_name TEXT DEFAULT 'New Employee',
    p_role TEXT DEFAULT 'employee',
    p_manager_id UUID DEFAULT NULL,
    p_work_mode TEXT DEFAULT 'remote',
    p_primary_location_id UUID DEFAULT NULL
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
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and administrators can create employees.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create employees.';
    END IF;

    v_caller_org := public.current_org_id();

    -- Add membership
    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_caller_org, p_user_id, p_role, 'active')
    ON CONFLICT (user_id) DO UPDATE SET organization_id = v_caller_org, role = p_role, status = 'active';

    -- Add employee profile
    INSERT INTO public.employees (
        id, organization_id, email,
        full_name, manager_id, work_mode, primary_location_id, status
    ) VALUES (
        p_user_id, v_caller_org, p_email,
        COALESCE(p_full_name, 'New Employee'),
        p_manager_id, p_work_mode, p_primary_location_id, 'active'
    )
    ON CONFLICT (id) DO UPDATE SET organization_id = v_caller_org, work_mode = p_work_mode;

    -- Audit log entry
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (v_caller_org, v_caller_id, 'EMPLOYEE_CREATED', 'employees', p_user_id, jsonb_build_object('email', p_email, 'role', p_role));

    RETURN jsonb_build_object('success', true);
END;
$$;

-- Privileged HR/Admin RPC for updating employee governance attributes
CREATE OR REPLACE FUNCTION public.admin_update_employee(
    p_employee_id UUID,
    p_manager_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_work_mode TEXT DEFAULT NULL,
    p_primary_location_id UUID DEFAULT NULL,
    p_work_target_minutes INTEGER DEFAULT NULL,
    p_expected_office_days INTEGER[] DEFAULT NULL,
    p_required_office_days_per_week INTEGER DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL
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
    v_emp RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    -- Authoritative role check from organization_members
    v_caller_role := public.current_user_role();
    IF v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and administrators can update employee governance attributes.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal != 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for employee administrative updates.';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT * INTO v_emp
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_emp.id IS NULL THEN
        RAISE EXCEPTION 'Employee not found.';
    END IF;

    IF v_emp.organization_id != v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Target employee belongs to another organization.';
    END IF;

    -- Verify location belongs to same org if updating
    IF p_primary_location_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.locations 
            WHERE id = p_primary_location_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Invalid primary_location_id: Location does not belong to this organization.';
        END IF;
    END IF;

    -- Verify manager belongs to same org if updating
    IF p_manager_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.employees 
            WHERE id = p_manager_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Invalid manager_id: Manager does not belong to this organization.';
        END IF;
    END IF;

    -- Apply updates
    UPDATE public.employees
    SET 
        manager_id = COALESCE(p_manager_id, manager_id),
        status = COALESCE(p_status, status),
        work_mode = COALESCE(p_work_mode, work_mode),
        primary_location_id = COALESCE(p_primary_location_id, primary_location_id),
        work_target_minutes = COALESCE(p_work_target_minutes, work_target_minutes),
        expected_office_days = COALESCE(p_expected_office_days, expected_office_days),
        required_office_days_per_week = COALESCE(p_required_office_days_per_week, required_office_days_per_week),
        timezone = COALESCE(p_timezone, timezone),
        updated_at = pg_catalog.now()
    WHERE id = p_employee_id;

    -- Audit log entry
    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, new_data
    ) VALUES (
        v_caller_org,
        v_caller_id,
        'EMPLOYEE_UPDATED',
        'employees',
        p_employee_id,
        jsonb_build_object(
            'manager_id', p_manager_id,
            'status', p_status,
            'work_mode', p_work_mode,
            'primary_location_id', p_primary_location_id,
            'work_target_minutes', p_work_target_minutes,
            'expected_office_days', p_expected_office_days,
            'required_office_days_per_week', p_required_office_days_per_week,
            'timezone', p_timezone
        )
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_org_member(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_add_org_member(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_remove_org_member(UUID, UUID) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_remove_org_member(UUID, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_create_employee(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_create_employee(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.admin_update_employee(UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) FROM PUBLIC, anon;
GRANT ALL ON FUNCTION public.admin_update_employee(UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) TO authenticated, service_role;

-- ============================================================================
-- SECTION 12: Defense-in-Depth Triggers (Field Protection & IP Range Gate)
-- ============================================================================

-- Protect employee governance fields against direct API tampering
CREATE OR REPLACE FUNCTION public.trg_protect_employee_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
BEGIN
    IF NEW.organization_id != OLD.organization_id THEN
        RAISE EXCEPTION 'organization_id cannot be changed.';
    END IF;

    v_role := public.current_user_role();
    IF v_role NOT IN ('hr', 'admin') THEN
        IF NEW.manager_id IS DISTINCT FROM OLD.manager_id OR
           NEW.status IS DISTINCT FROM OLD.status OR
           NEW.work_mode IS DISTINCT FROM OLD.work_mode OR
           NEW.primary_location_id IS DISTINCT FROM OLD.primary_location_id OR
           NEW.work_target_minutes IS DISTINCT FROM OLD.work_target_minutes OR
           NEW.expected_office_days IS DISTINCT FROM OLD.expected_office_days OR
           NEW.required_office_days_per_week IS DISTINCT FROM OLD.required_office_days_per_week OR
           NEW.timezone IS DISTINCT FROM OLD.timezone THEN
            RAISE EXCEPTION 'Permission denied: Employees cannot modify administrative attributes.';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_employee_fields_before_update ON public.employees;
CREATE TRIGGER protect_employee_fields_before_update
BEFORE UPDATE ON public.employees
FOR EACH ROW EXECUTE FUNCTION public.trg_protect_employee_fields();

REVOKE ALL ON FUNCTION public.trg_protect_employee_fields() FROM PUBLIC, anon;

-- Protect location allowed_ip_ranges on both INSERT and UPDATE (Admin-only modification)
CREATE OR REPLACE FUNCTION public.trg_protect_location_ip_ranges()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.allowed_ip_ranges IS NOT NULL AND NEW.allowed_ip_ranges != '{}'::text[] THEN
            IF public.current_user_role() != 'admin' THEN
                RAISE EXCEPTION 'Permission denied: Only administrators can specify allowed_ip_ranges.';
            END IF;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.allowed_ip_ranges IS DISTINCT FROM OLD.allowed_ip_ranges THEN
            IF public.current_user_role() != 'admin' THEN
                RAISE EXCEPTION 'Permission denied: Only administrators can modify allowed_ip_ranges.';
            END IF;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_location_ip_ranges_before_update ON public.locations;
DROP TRIGGER IF EXISTS protect_location_ip_ranges_before_write ON public.locations;
CREATE TRIGGER protect_location_ip_ranges_before_write
BEFORE INSERT OR UPDATE ON public.locations
FOR EACH ROW EXECUTE FUNCTION public.trg_protect_location_ip_ranges();

REVOKE ALL ON FUNCTION public.trg_protect_location_ip_ranges() FROM PUBLIC, anon;

-- Enforce server timestamp and self-identity on privacy acknowledgments
CREATE OR REPLACE FUNCTION public.trg_set_privacy_acknowledgment_defaults()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    NEW.acknowledged_at := pg_catalog.now();
    NEW.policy_version := COALESCE(NEW.policy_version, 'v1.0');
    IF NEW.employee_id != (SELECT auth.uid()) AND public.current_user_role() NOT IN ('service_role') THEN
        RAISE EXCEPTION 'Cannot acknowledge privacy for another employee.';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_privacy_acknowledgment_defaults ON public.privacy_acknowledgments;
CREATE TRIGGER set_privacy_acknowledgment_defaults
BEFORE INSERT ON public.privacy_acknowledgments
FOR EACH ROW EXECUTE FUNCTION public.trg_set_privacy_acknowledgment_defaults();

REVOKE ALL ON FUNCTION public.trg_set_privacy_acknowledgment_defaults() FROM PUBLIC, anon;

-- ============================================================================
-- SECTION 13: Strict Privilege Hardening (Revokes & Column-Level Grants)
-- ============================================================================

-- 0. Revoke default privileges in schema public for future objects created by migration owner
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON ROUTINES FROM PUBLIC, anon, authenticated;';
    EXECUTE 'ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;';
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- 1. Revoke default permissive table grants from anon and authenticated across ALL public tables
REVOKE ALL ON public.organizations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.organization_members FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.locations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.shift_templates FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.employee_shift_assignments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kiosk_devices FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.kiosk_credentials FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.privacy_acknowledgments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.cron_run_state FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.employees FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_policies FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_sessions FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.attendance_days FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.regularization_requests FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.notifications FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.holidays FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.audit_logs FROM PUBLIC, anon, authenticated;

-- Service role retains full administrative privileges
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;

-- 2. Strictly grant ONLY authorized operations to authenticated:

-- organizations: SELECT by members, UPDATE limited columns by admin, NO DELETE via API
GRANT SELECT ON public.organizations TO authenticated;
GRANT UPDATE (name, domain, work_mode, timezone) ON public.organizations TO authenticated;

-- organization_members: writes strictly through admin RPCs with advisory lock
GRANT SELECT ON public.organization_members TO authenticated;

-- locations: SELECT, INSERT, UPDATE, DELETE (IP ranges protected by trigger)
GRANT SELECT, INSERT, UPDATE, DELETE ON public.locations TO authenticated;

-- shift_templates & shift_assignments
GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_templates TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_shift_assignments TO authenticated;

-- kiosk_devices: Admin-only management, enrollment_token_hash HIDDEN from SELECT for non-admins
GRANT SELECT (id, organization_id, location_id, device_name, is_active, created_at) ON public.kiosk_devices TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.kiosk_devices TO authenticated;

-- privacy_acknowledgments: self INSERT only, immutable append-only
GRANT SELECT, INSERT ON public.privacy_acknowledgments TO authenticated;

-- attendance_sessions & attendance_days: WRITES ONLY THROUGH RPCs
GRANT SELECT ON public.attendance_sessions TO authenticated;
GRANT SELECT ON public.attendance_days TO authenticated;

-- regularization_requests: Self INSERT, SELECT, decisions strictly through RPCs
GRANT SELECT, INSERT ON public.regularization_requests TO authenticated;

-- notifications: SELECT own, UPDATE read_at only
GRANT SELECT ON public.notifications TO authenticated;
GRANT UPDATE (read_at) ON public.notifications TO authenticated;

-- holidays
GRANT SELECT, INSERT, UPDATE, DELETE ON public.holidays TO authenticated;

-- attendance_policies
GRANT SELECT, UPDATE ON public.attendance_policies TO authenticated;

-- audit_logs: Read-only for HR/Admin
GRANT SELECT ON public.audit_logs TO authenticated;

-- employees: authenticated has SELECT only at table level, and UPDATE only on non-administrative self-service attributes
GRANT SELECT ON public.employees TO authenticated;
GRANT UPDATE (full_name, avatar_url) ON public.employees TO authenticated;

-- 3. Routine privileges: Revoke all from PUBLIC and anon, grant ONLY required RPCs to authenticated
REVOKE ALL ON ALL ROUTINES IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL ROUTINES IN SCHEMA public TO service_role;

GRANT EXECUTE ON FUNCTION public.check_in(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_in(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_out() TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_regularization(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reject_regularization(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lock_month(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_month(INTEGER, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_org_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_organization_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_org_member() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_org_member(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_org_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_create_employee(UUID, TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_employee(UUID, UUID, TEXT, TEXT, UUID, INTEGER, INTEGER[], INTEGER, TEXT) TO authenticated;

-- custom_access_token_hook is called by supabase_auth_admin and service_role
GRANT EXECUTE ON FUNCTION public.custom_access_token_hook(JSONB) TO supabase_auth_admin, service_role;

-- 4. Sequences: Revoke all from PUBLIC and anon
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated, service_role;


-- ============================================================================
-- SECTION 14: Per-Command Role-Gated, Subquery-Optimized & Active Membership RLS Policies
-- ============================================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kiosk_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_acknowledgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cron_run_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attendance_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.regularization_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.holidays ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 1. organizations
CREATE POLICY "tenant_organizations_select_policy" ON public.organizations
FOR SELECT TO authenticated
USING (id = (SELECT public.current_org_id()));

CREATE POLICY "tenant_organizations_update_policy" ON public.organizations
FOR UPDATE TO authenticated
USING (id = (SELECT public.current_org_id()) AND (SELECT public.current_user_role()) = 'admin')
WITH CHECK (id = (SELECT public.current_org_id()) AND (SELECT public.current_user_role()) = 'admin');

CREATE POLICY "enforce_mfa_aal2_organizations" ON public.organizations
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_organizations" ON public.organizations
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 2. organization_members
CREATE POLICY "tenant_members_select_policy" ON public.organization_members
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        user_id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "enforce_mfa_aal2_organization_members" ON public.organization_members
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_members" ON public.organization_members
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 3. locations
CREATE POLICY "tenant_locations_select_policy" ON public.locations
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "tenant_locations_insert_policy" ON public.locations
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_locations_update_policy" ON public.locations
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_locations_delete_policy" ON public.locations
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
);

CREATE POLICY "enforce_mfa_aal2_locations" ON public.locations
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_locations" ON public.locations
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 4. shift_templates
CREATE POLICY "tenant_shift_templates_select_policy" ON public.shift_templates
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "tenant_shift_templates_insert_policy" ON public.shift_templates
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_shift_templates_update_policy" ON public.shift_templates
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_shift_templates_delete_policy" ON public.shift_templates
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_mfa_aal2_shift_templates" ON public.shift_templates
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_shift_templates" ON public.shift_templates
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 5. employee_shift_assignments
CREATE POLICY "tenant_shift_assignments_select_policy" ON public.employee_shift_assignments
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "tenant_shift_assignments_insert_policy" ON public.employee_shift_assignments
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_shift_assignments_update_policy" ON public.employee_shift_assignments
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "tenant_shift_assignments_delete_policy" ON public.employee_shift_assignments
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_mfa_aal2_shift_assignments" ON public.employee_shift_assignments
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_shift_assignments" ON public.employee_shift_assignments
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 6. kiosk_devices (writes strictly admin-only at aal2)
CREATE POLICY "tenant_kiosk_devices_select_policy" ON public.kiosk_devices
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "tenant_kiosk_devices_insert_policy" ON public.kiosk_devices
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
);

CREATE POLICY "tenant_kiosk_devices_update_policy" ON public.kiosk_devices
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
);

CREATE POLICY "tenant_kiosk_devices_delete_policy" ON public.kiosk_devices
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) = 'admin'
);

CREATE POLICY "enforce_mfa_aal2_kiosk_devices" ON public.kiosk_devices
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_kiosk_devices" ON public.kiosk_devices
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 7. privacy_acknowledgments
CREATE POLICY "tenant_privacy_acknowledgments_select_policy" ON public.privacy_acknowledgments
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "tenant_privacy_acknowledgments_insert_policy" ON public.privacy_acknowledgments
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND employee_id = (SELECT auth.uid())
);

CREATE POLICY "enforce_mfa_aal2_privacy_acknowledgments" ON public.privacy_acknowledgments
AS RESTRICTIVE FOR ALL TO authenticated
USING (
    CASE 
        WHEN (SELECT public.current_user_role()) IN ('hr', 'admin') THEN (COALESCE((auth.jwt())->>'aal', 'aal1') = 'aal2')
        ELSE true 
    END
);

CREATE POLICY "enforce_active_org_membership_privacy_acknowledgments" ON public.privacy_acknowledgments
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 8. employees
DROP POLICY IF EXISTS "employees_select_policy" ON public.employees;
DROP POLICY IF EXISTS "employees_insert_policy" ON public.employees;
DROP POLICY IF EXISTS "employees_update_policy" ON public.employees;
DROP POLICY IF EXISTS "employees_delete_policy" ON public.employees;
DROP POLICY IF EXISTS "enforce_active_org_membership_employees" ON public.employees;

CREATE POLICY "employees_select_policy" ON public.employees
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        id = (SELECT auth.uid())
        OR manager_id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "employees_update_policy" ON public.employees
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (
        id = (SELECT auth.uid())
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "enforce_active_org_membership_employees" ON public.employees
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 9. attendance_policies
DROP POLICY IF EXISTS "attendance_policies_select_policy" ON public.attendance_policies;
DROP POLICY IF EXISTS "attendance_policies_admin_policy" ON public.attendance_policies;
DROP POLICY IF EXISTS "enforce_active_org_membership_attendance_policies" ON public.attendance_policies;

CREATE POLICY "attendance_policies_select_policy" ON public.attendance_policies
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "attendance_policies_admin_policy" ON public.attendance_policies
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_active_org_membership_attendance_policies" ON public.attendance_policies
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 10. attendance_sessions (Writes strictly via RPC)
DROP POLICY IF EXISTS "attendance_sessions_select_policy" ON public.attendance_sessions;
DROP POLICY IF EXISTS "attendance_sessions_admin_override" ON public.attendance_sessions;
DROP POLICY IF EXISTS "enforce_active_org_membership_attendance_sessions" ON public.attendance_sessions;

CREATE POLICY "attendance_sessions_select_policy" ON public.attendance_sessions
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR employee_id IN (
            SELECT employees.id
            FROM public.employees
            WHERE employees.manager_id = (SELECT auth.uid())
        )
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "enforce_active_org_membership_attendance_sessions" ON public.attendance_sessions
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 11. attendance_days
DROP POLICY IF EXISTS "attendance_days_select_policy" ON public.attendance_days;
DROP POLICY IF EXISTS "attendance_days_admin_override" ON public.attendance_days;
DROP POLICY IF EXISTS "enforce_active_org_membership_attendance_days" ON public.attendance_days;

CREATE POLICY "attendance_days_select_policy" ON public.attendance_days
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR employee_id IN (
            SELECT employees.id
            FROM public.employees
            WHERE employees.manager_id = (SELECT auth.uid())
        )
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "enforce_active_org_membership_attendance_days" ON public.attendance_days
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 12. regularization_requests (Status decisions strictly via RPC)
DROP POLICY IF EXISTS "regularization_requests_select_policy" ON public.regularization_requests;
DROP POLICY IF EXISTS "regularization_requests_insert_policy" ON public.regularization_requests;
DROP POLICY IF EXISTS "regularization_requests_review_policy" ON public.regularization_requests;
DROP POLICY IF EXISTS "enforce_active_org_membership_regularization_requests" ON public.regularization_requests;

CREATE POLICY "regularization_requests_select_policy" ON public.regularization_requests
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (
        employee_id = (SELECT auth.uid())
        OR employee_id IN (
            SELECT employees.id
            FROM public.employees
            WHERE employees.manager_id = (SELECT auth.uid())
        )
        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
    )
);

CREATE POLICY "regularization_requests_insert_policy" ON public.regularization_requests
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND employee_id = (SELECT auth.uid())
    AND status = 'pending'
    AND reviewed_by IS NULL
    AND reviewed_at IS NULL
    AND review_note IS NULL
);

CREATE POLICY "enforce_active_org_membership_regularization_requests" ON public.regularization_requests
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 13. notifications
DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_policy" ON public.notifications;
DROP POLICY IF EXISTS "enforce_active_org_membership_notifications" ON public.notifications;

CREATE POLICY "notifications_select_policy" ON public.notifications
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND user_id = (SELECT auth.uid())
);

CREATE POLICY "notifications_update_policy" ON public.notifications
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND user_id = (SELECT auth.uid())
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND user_id = (SELECT auth.uid())
);

CREATE POLICY "enforce_active_org_membership_notifications" ON public.notifications
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 14. holidays
DROP POLICY IF EXISTS "holidays_select_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_admin_manage_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_insert_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_update_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_delete_policy" ON public.holidays;
DROP POLICY IF EXISTS "enforce_active_org_membership_holidays" ON public.holidays;

CREATE POLICY "holidays_select_policy" ON public.holidays
FOR SELECT TO authenticated
USING (organization_id = (SELECT public.current_org_id()));

CREATE POLICY "holidays_insert_policy" ON public.holidays
FOR INSERT TO authenticated
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "holidays_update_policy" ON public.holidays
FOR UPDATE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
)
WITH CHECK (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "holidays_delete_policy" ON public.holidays
FOR DELETE TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_active_org_membership_holidays" ON public.holidays
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- 15. audit_logs (SELECT only by HR/Admin)
DROP POLICY IF EXISTS "audit_logs_select_policy" ON public.audit_logs;
DROP POLICY IF EXISTS "enforce_active_org_membership_audit_logs" ON public.audit_logs;

CREATE POLICY "audit_logs_select_policy" ON public.audit_logs
FOR SELECT TO authenticated
USING (
    organization_id = (SELECT public.current_org_id())
    AND (SELECT public.current_user_role()) IN ('hr', 'admin')
);

CREATE POLICY "enforce_active_org_membership_audit_logs" ON public.audit_logs
AS RESTRICTIVE FOR ALL TO authenticated
USING ((SELECT public.is_active_org_member()));

-- ============================================================================
-- SECTION 15: Administrative Organization Provisioning RPC
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_create_organization(
    p_name TEXT,
    p_slug TEXT,
    p_work_mode TEXT DEFAULT 'remote',
    p_timezone TEXT DEFAULT 'UTC'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
BEGIN
    INSERT INTO public.organizations (name, slug, work_mode, timezone)
    VALUES (p_name, p_slug, p_work_mode, p_timezone)
    RETURNING id INTO v_org_id;

    INSERT INTO public.attendance_policies (
        organization_id, work_mode, timezone, shift_start_time,
        grace_minutes, half_day_minutes, auto_checkout_time
    ) VALUES (
        v_org_id, p_work_mode, p_timezone, '09:00:00'::time, 15, 240, '20:00:00'::time
    );

    RETURN v_org_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_create_organization(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT ALL ON FUNCTION public.admin_create_organization(TEXT, TEXT, TEXT, TEXT) TO service_role;


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


-- ============================================================================
-- Migration 11: Security Hardening, Suspended-Member Isolation, RPC Reconciliation & Leave Fixes
--
-- Covers Section 0 requirements:
-- 0b: Separate current_org_id() org-resolution from active-membership check in is_active_org_member()
--     so RESTRICTIVE enforce_active_org_membership_* policies are genuinely load-bearing;
--     enforce is_active_org_member() at the top of every authenticated RPC.
-- 0c: Harden provision_invited_employee against cross-organization user hijacking.
-- 0d: Drop unhardened check_out(UUID, UUID); fix can_approve_for() & cron_nightly_finalize();
--     unify audit_logs.action names to UPPER_SNAKE <ENTITY>_<PAST_TENSE> convention;
--     ensure old_data & new_data population on mutations; enforce admin-only checks.
-- 0e: Fix holidays per-org uniqueness; allow complementary half-day leaves (first_half + second_half)
--     via leave_slot_range() exclusion constraint; route cancel_leave, approve_leave,
--     hr_assign_leave through recalculate_day() (no direct status writes, no 'regular',
--     never mark future days 'absent'); add locked-day checks on approve_regularization &
--     hr_assign_leave; add sole-admin organization leave approval fallback.
-- ============================================================================

-- ============================================================================
-- SECTION 1: Fix Holidays Per-Organization Unique Constraint
-- ============================================================================
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS holidays_date_key;
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS uq_holidays_org_date;
ALTER TABLE public.holidays ADD CONSTRAINT uq_holidays_org_date UNIQUE (organization_id, date);

-- ============================================================================
-- SECTION 2: Tenant & Active-Membership Helper Separation (0b)
-- ============================================================================
-- current_org_id() resolves the tenant org_id (without filtering om.status = 'active')
-- so PERMISSIVE policies resolve the tenant scope and RESTRICTIVE
-- enforce_active_org_membership_* policies strictly enforce om.status = 'active'.
CREATE OR REPLACE FUNCTION public.current_org_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT om.organization_id
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = (SELECT auth.uid())
      AND o.status IN ('active', 'trial')
      AND (
          NULLIF((auth.jwt())->>'organization_id', '') IS NULL
          OR om.organization_id = NULLIF((auth.jwt())->>'organization_id', '')::uuid
      )
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT public.current_org_id();
$$;

CREATE OR REPLACE FUNCTION public.is_active_org_member()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.organizations o ON o.id = om.organization_id
        WHERE om.user_id = (SELECT auth.uid())
          AND om.organization_id = public.current_org_id()
          AND om.status = 'active'
          AND o.status IN ('active', 'trial')
    );
$$;

CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT om.role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = (SELECT auth.uid())
      AND om.organization_id = public.current_org_id()
      AND om.status = 'active'
      AND o.status IN ('active', 'trial')
    LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_caller_id UUID;
    v_caller_org UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;

        v_caller_org := public.current_org_id();
        SELECT om.role INTO v_role
        FROM public.organization_members om
        WHERE om.user_id = p_user_id
          AND om.organization_id = v_caller_org
          AND om.status = 'active'
        LIMIT 1;

        RETURN v_role;
    END IF;

    -- System / service_role lookup when auth.uid() is NULL
    SELECT om.role INTO v_role
    FROM public.organization_members om
    WHERE om.user_id = p_user_id
      AND om.status = 'active'
    LIMIT 1;

    RETURN v_role;
END;
$$;

-- Drop legacy unhardened check_out(UUID, UUID) overload (0d)
DROP FUNCTION IF EXISTS public.check_out(UUID, UUID);

-- Fix can_approve_for(UUID, UUID): query organization_members (not dropped user_roles) + active + same org
CREATE OR REPLACE FUNCTION public.can_approve_for(
    p_approver_id UUID,
    p_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_approver_org UUID;
    v_approver_role TEXT;
    v_emp_org UUID;
    v_emp_manager UUID;
BEGIN
    IF p_approver_id IS NULL OR p_employee_id IS NULL OR p_approver_id = p_employee_id THEN
        RETURN FALSE;
    END IF;

    SELECT om.organization_id, om.role
    INTO v_approver_org, v_approver_role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = p_approver_id
      AND om.status = 'active'
      AND o.status IN ('active', 'trial')
    LIMIT 1;

    IF v_approver_org IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT e.organization_id, e.manager_id
    INTO v_emp_org, v_emp_manager
    FROM public.employees e
    WHERE e.id = p_employee_id;

    IF v_emp_org IS NULL OR v_emp_org IS DISTINCT FROM v_approver_org THEN
        RETURN FALSE;
    END IF;

    IF v_approver_role IN ('hr', 'admin') THEN
        RETURN TRUE;
    END IF;

    IF v_approver_role = 'manager' AND v_emp_manager = p_approver_id THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_approve_for(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve_for(UUID, UUID) TO service_role;

-- ============================================================================
-- SECTION 3: Half-Day Overlap Rule (0e)
-- ============================================================================
-- Allows first_half + second_half on the same date while blocking same-slot
-- or full-day overlaps for pending/approved requests.
CREATE OR REPLACE FUNCTION public.leave_slot_range(
    p_start DATE,
    p_end DATE,
    p_day_part TEXT
)
RETURNS int4range
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT CASE
        WHEN p_day_part = 'first_half' THEN
            pg_catalog.int4range((p_start - DATE '2000-01-01')::integer * 2, (p_start - DATE '2000-01-01')::integer * 2 + 1, '[)')
        WHEN p_day_part = 'second_half' THEN
            pg_catalog.int4range((p_start - DATE '2000-01-01')::integer * 2 + 1, (p_start - DATE '2000-01-01')::integer * 2 + 2, '[)')
        ELSE
            pg_catalog.int4range((p_start - DATE '2000-01-01')::integer * 2, (p_end - DATE '2000-01-01')::integer * 2 + 2, '[)')
    END;
$$;

REVOKE ALL ON FUNCTION public.leave_slot_range(DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.leave_slot_range(DATE, DATE, TEXT) TO authenticated, service_role;

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS chk_leave_request_half_day_single_date;
ALTER TABLE public.leave_requests ADD CONSTRAINT chk_leave_request_half_day_single_date
    CHECK (day_part = 'full' OR start_date = end_date);

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS exclude_overlapping_leave_requests;
ALTER TABLE public.leave_requests ADD CONSTRAINT exclude_overlapping_leave_requests
    EXCLUDE USING gist (
        employee_id WITH =,
        public.leave_slot_range(start_date, end_date, day_part) WITH &&
    ) WHERE (status IN ('pending', 'approved'));

-- ============================================================================
-- SECTION 4: Hardened provision_invited_employee (0c)
-- ============================================================================
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
    v_existing_member_org UUID;
    v_existing_emp_org UUID;
    v_new_data JSONB;
BEGIN
    v_actor_id := (SELECT auth.uid());

    IF p_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role USING ERRCODE = '22023';
    END IF;

    IF p_work_mode NOT IN ('remote', 'office', 'hybrid') THEN
        RAISE EXCEPTION 'Invalid work mode: %', p_work_mode USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE id = p_organization_id) THEN
        RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '02000';
    END IF;

    -- Prevent cross-organization user hijacking
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

    INSERT INTO public.organization_members (
        organization_id, user_id, role, status
    ) VALUES (
        p_organization_id, p_user_id, p_role, 'active'
    ) ON CONFLICT (user_id) DO UPDATE
    SET role = EXCLUDED.role,
        status = 'active',
        updated_at = pg_catalog.now()
    WHERE public.organization_members.organization_id = p_organization_id;

    INSERT INTO public.employees (
        id, organization_id, email, full_name, work_mode, timezone,
        department_id, manager_id, primary_location_id,
        work_target_minutes, expected_office_days, required_office_days_per_week, status
    ) VALUES (
        p_user_id, p_organization_id, p_email, p_full_name, p_work_mode, p_timezone,
        p_department_id, p_manager_id, p_primary_location_id,
        p_work_target_minutes, p_expected_office_days, p_required_office_days_per_week, 'active'
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
        status = 'active',
        updated_at = pg_catalog.now()
    WHERE public.employees.organization_id = p_organization_id;

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
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
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

-- ============================================================================
-- SECTION 5: Unified recalculate_day(), cron_auto_checkout(), cron_nightly_finalize()
-- ============================================================================
CREATE OR REPLACE FUNCTION public.recalculate_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total_minutes INTEGER := 0;
    v_sessions_count INTEGER := 0;
    v_first_in TIMESTAMPTZ;
    v_last_out TIMESTAMPTZ;
    v_open_sessions INTEGER := 0;
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_overtime_minutes INTEGER := 0;
    v_work_location TEXT := 'remote';
    v_policy RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_is_company_day_off BOOLEAN := FALSE;
    v_day_of_week INTEGER;
    v_weekly_offs INTEGER[];
    v_is_weekend BOOLEAN := FALSE;
    v_target_minutes INTEGER := 480;
    v_org_id UUID;
    v_dept_id UUID;
    v_work_mode TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_loc_weekly_offs INTEGER[];
    v_effective_tz TEXT;
    v_local_today DATE;
    v_is_locked BOOLEAN := FALSE;
    v_has_full_leave BOOLEAN := FALSE;
    v_has_first_half BOOLEAN := FALSE;
    v_has_second_half BOOLEAN := FALSE;
BEGIN
    -- Never overwrite locked attendance days
    SELECT locked INTO v_is_locked
    FROM public.attendance_days
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    IF COALESCE(v_is_locked, FALSE) THEN
        RETURN;
    END IF;

    SELECT
        e.organization_id,
        e.department_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        COALESCE(e.work_target_minutes, 480),
        l.weekly_off_days
    INTO
        v_org_id, v_dept_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_target_minutes, v_loc_weekly_offs
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id
          AND (check_in_at AT TIME ZONE COALESCE(v_emp_tz, v_org_tz, 'UTC'))::date = p_work_date
          AND (location_id IS NOT NULL OR source IN ('office_ip', 'rotating_qr', 'kiosk'))
    ) THEN
        v_work_location := 'office';
    ELSE
        v_work_location := 'remote';
    END IF;

    v_effective_tz := CASE
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN
            CASE
                WHEN v_work_location = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
    END;

    v_local_today := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    SELECT * INTO v_policy
    FROM public.attendance_policies
    WHERE organization_id = v_org_id
    LIMIT 1;

    SELECT
        COALESCE(SUM(
            CASE
                WHEN check_out_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60
                ELSE EXTRACT(EPOCH FROM (pg_catalog.now() - check_in_at)) / 60
            END
        ), 0)::INTEGER,
        COUNT(*),
        MIN(check_in_at),
        MAX(check_out_at),
        COUNT(*) FILTER (WHERE check_out_at IS NULL)
    INTO
        v_total_minutes,
        v_sessions_count,
        v_first_in,
        v_last_out,
        v_open_sessions
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id
      AND (check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date;

    SELECT EXISTS (
        SELECT 1 FROM public.holidays
        WHERE organization_id = v_org_id AND date = p_work_date
    ) INTO v_is_holiday;

    SELECT EXISTS (
        SELECT 1 FROM public.company_days_off
        WHERE organization_id = v_org_id
          AND date = p_work_date
          AND (department_id IS NULL OR department_id = v_dept_id)
    ) INTO v_is_company_day_off;

    v_weekly_offs := COALESCE(v_loc_weekly_offs, v_policy.weekly_off_days, '{0, 6}'::INTEGER[]);
    v_day_of_week := EXTRACT(DOW FROM p_work_date)::INTEGER;
    v_is_weekend := v_day_of_week = ANY(v_weekly_offs);

    -- Check approved leave requests covering p_work_date
    SELECT
        COALESCE(bool_or(day_part = 'full'), FALSE),
        COALESCE(bool_or(day_part = 'first_half'), FALSE),
        COALESCE(bool_or(day_part = 'second_half'), FALSE)
    INTO v_has_full_leave, v_has_first_half, v_has_second_half
    FROM public.leave_requests
    WHERE organization_id = v_org_id
      AND employee_id = p_employee_id
      AND status = 'approved'
      AND p_work_date BETWEEN start_date AND end_date;

    IF v_first_in IS NOT NULL THEN
        DECLARE
            v_expected_start TIME := COALESCE(v_policy.shift_start_time, '09:00:00'::time);
            v_grace INTEGER := COALESCE(v_policy.grace_minutes, 15);
            v_actual_time TIME := (v_first_in AT TIME ZONE v_effective_tz)::time;
        BEGIN
            IF v_actual_time > (v_expected_start + (v_grace || ' minutes')::interval) THEN
                v_is_late := TRUE;
            END IF;
        END;
    END IF;

    IF v_is_holiday OR v_is_company_day_off THEN
        v_status := 'holiday';
    ELSIF v_is_weekend THEN
        v_status := 'weekend';
    ELSIF v_has_full_leave OR (v_has_first_half AND v_has_second_half) THEN
        v_status := 'leave';
    ELSIF (v_has_first_half OR v_has_second_half) AND v_sessions_count = 0 THEN
        v_status := 'leave';
        v_total_minutes := COALESCE(v_policy.half_day_minutes, 240);
    ELSIF v_sessions_count = 0 THEN
        -- Never mark future days 'absent'; remove non-locked placeholder rows when leave is cancelled
        IF p_work_date > v_local_today THEN
            DELETE FROM public.attendance_days
            WHERE employee_id = p_employee_id
              AND work_date = p_work_date
              AND locked = FALSE;
            RETURN;
        END IF;
        v_status := 'absent';
    ELSIF v_total_minutes >= v_target_minutes THEN
        v_status := 'present';
        v_overtime_minutes := GREATEST(0, v_total_minutes - v_target_minutes);
    ELSE
        v_status := 'half_day';
    END IF;

    INSERT INTO public.attendance_days (
        organization_id,
        employee_id,
        work_date,
        total_minutes,
        overtime_minutes,
        status,
        is_late,
        locked,
        updated_at
    ) VALUES (
        v_org_id,
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_overtime_minutes,
        v_status,
        v_is_late,
        FALSE,
        pg_catalog.now()
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        total_minutes = EXCLUDED.total_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes,
        status = EXCLUDED.status,
        is_late = EXCLUDED.is_late,
        updated_at = EXCLUDED.updated_at
    WHERE public.attendance_days.locked = FALSE;

    RETURN;
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_auto_checkout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session RECORD;
    v_closed_count INTEGER := 0;
    v_work_date DATE;
BEGIN
    FOR v_session IN
        SELECT s.id, s.employee_id, s.check_in_at, s.organization_id, COALESCE(e.timezone, o.timezone, 'UTC') AS eff_tz
        FROM public.attendance_sessions s
        JOIN public.employees e ON e.id = s.employee_id
        JOIN public.organizations o ON o.id = s.organization_id
        WHERE s.check_out_at IS NULL
          AND s.check_in_at < (pg_catalog.now() - INTERVAL '12 hours')
    LOOP
        v_work_date := (v_session.check_in_at AT TIME ZONE COALESCE(v_session.eff_tz, 'UTC'))::date;

        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE employee_id = v_session.employee_id
              AND work_date = v_work_date
              AND locked = TRUE
        ) THEN
            UPDATE public.attendance_sessions
            SET check_out_at = pg_catalog.now(),
                source = 'auto',
                note = COALESCE(note, '') || ' [Auto-closed by nightly cron]'
            WHERE id = v_session.id;

            PERFORM public.recalculate_day(v_session.employee_id, v_work_date);
            v_closed_count := v_closed_count + 1;
        END IF;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.cron_nightly_finalize()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_marked_count INTEGER := 0;
    v_emp RECORD;
    v_yesterday DATE;
BEGIN
    FOR v_emp IN
        SELECT
            e.id,
            COALESCE(e.timezone, o.timezone, 'UTC') AS eff_tz
        FROM public.employees e
        JOIN public.organizations o ON o.id = e.organization_id
        WHERE e.status = 'active'
          AND o.status IN ('active', 'trial')
    LOOP
        v_yesterday := ((pg_catalog.now() AT TIME ZONE COALESCE(v_emp.eff_tz, 'UTC'))::date - 1);

        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE employee_id = v_emp.id AND work_date = v_yesterday
        ) THEN
            PERFORM public.recalculate_day(v_emp.id, v_yesterday);
            v_marked_count := v_marked_count + 1;
        END IF;
    END LOOP;

    RETURN v_marked_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout() TO service_role;
REVOKE ALL ON FUNCTION public.cron_nightly_finalize() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_nightly_finalize() TO service_role;

-- ============================================================================
-- SECTION 6: Core Attendance & Regularization RPC Hardening + Unified Audits
-- ============================================================================
CREATE OR REPLACE FUNCTION public.check_in(
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_employee_id UUID;
    v_org_id UUID;
    v_allowed_methods TEXT[];
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_new_data JSONB;
BEGIN
    v_employee_id := (SELECT auth.uid());
    IF v_employee_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT e.organization_id, COALESCE(p.allowed_methods, '{"web"}'), COALESCE(e.timezone, o.timezone, 'UTC')
    INTO v_org_id, v_allowed_methods, v_effective_tz
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.attendance_policies p ON p.organization_id = e.organization_id
    WHERE e.id = v_employee_id;

    IF v_org_id IS NULL OR v_org_id IS DISTINCT FROM public.current_org_id() THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee record not found');
    END IF;

    IF NOT ('web' = ANY(v_allowed_methods)) THEN
        RAISE EXCEPTION 'Direct web check-in is disabled for this organization. Physical verification required.';
    END IF;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE employee_id = v_employee_id AND work_date = v_work_date AND locked = TRUE
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attendance day is locked');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = v_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'You already have an active open session');
    END IF;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, source, note
    ) VALUES (
        v_org_id, v_employee_id, v_work_date, pg_catalog.now(), 'web', p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(v_employee_id, v_work_date);

    v_new_data := jsonb_build_object('employee_id', v_employee_id, 'work_date', v_work_date, 'source', 'web', 'note', p_note);
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_org_id, v_employee_id, 'ATTENDANCE_CHECKED_IN', 'attendance_sessions', v_session_id, NULL, v_new_data);

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_in(
    p_employee_id UUID,
    p_note TEXT DEFAULT NULL
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
    v_target_org UUID;
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_id IS DISTINCT FROM p_employee_id THEN
        v_caller_role := public.current_user_role();
        IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
            RETURN jsonb_build_object('success', false, 'error', 'Unauthorized check-in attempt for another employee.');
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RETURN jsonb_build_object('success', false, 'error', 'MFA AAL2 verification required for administrative check-in override.');
        END IF;

        v_caller_org := public.current_org_id();
        SELECT organization_id INTO v_target_org FROM public.employees WHERE id = p_employee_id;

        IF v_target_org IS NULL OR v_caller_org IS NULL OR v_caller_org IS DISTINCT FROM v_target_org THEN
            RETURN jsonb_build_object('success', false, 'error', 'Target employee not found in your organization.');
        END IF;
    END IF;

    SELECT e.organization_id, COALESCE(e.timezone, o.timezone, 'UTC')
    INTO v_target_org, v_effective_tz
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    WHERE e.id = p_employee_id;

    IF v_target_org IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Target employee not found');
    END IF;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE employee_id = p_employee_id AND work_date = v_work_date AND locked = TRUE
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attendance day is locked');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee already has an active open session');
    END IF;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, source, note
    ) VALUES (
        v_target_org, p_employee_id, v_work_date, pg_catalog.now(), 'manual', p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(p_employee_id, v_work_date);

    v_new_data := jsonb_build_object('employee_id', p_employee_id, 'work_date', v_work_date, 'source', 'manual', 'note', p_note);
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_target_org, v_caller_id, 'ATTENDANCE_CHECK_IN_OVERRIDDEN', 'attendance_sessions', v_session_id, NULL, v_new_data);

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.check_out()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_employee_id UUID;
    v_session_id UUID;
    v_check_in_at TIMESTAMPTZ;
    v_org_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_now TIMESTAMPTZ := pg_catalog.now();
BEGIN
    v_employee_id := (SELECT auth.uid());
    IF v_employee_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT id, check_in_at, organization_id INTO v_session_id, v_check_in_at, v_org_id
    FROM public.attendance_sessions
    WHERE employee_id = v_employee_id AND check_out_at IS NULL
    ORDER BY check_in_at DESC
    LIMIT 1;

    IF v_session_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'No active session found to check out');
    END IF;

    SELECT COALESCE(e.timezone, o.timezone, 'UTC')
    INTO v_effective_tz
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    WHERE e.id = v_employee_id;

    v_work_date := (v_check_in_at AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE employee_id = v_employee_id AND work_date = v_work_date AND locked = TRUE
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Attendance day is locked');
    END IF;

    UPDATE public.attendance_sessions
    SET check_out_at = v_now
    WHERE id = v_session_id;

    PERFORM public.recalculate_day(v_employee_id, v_work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_org_id,
        v_employee_id,
        'ATTENDANCE_CHECKED_OUT',
        'attendance_sessions',
        v_session_id,
        jsonb_build_object('check_out_at', NULL, 'work_date', v_work_date),
        jsonb_build_object('check_out_at', v_now, 'work_date', v_work_date)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.punch_verified(
    p_employee_id UUID,
    p_source TEXT,
    p_location_id UUID DEFAULT NULL,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
    v_emp_status TEXT;
    v_org_status TEXT;
    v_loc_org_id UUID;
    v_session_id UUID;
    v_work_date DATE;
    v_effective_tz TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_work_mode TEXT;
BEGIN
    IF p_source NOT IN ('office_ip', 'rotating_qr', 'geofence', 'kiosk') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Invalid verified source type');
    END IF;

    SELECT
        e.organization_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        e.status,
        o.status,
        l.organization_id
    INTO
        v_org_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_emp_status, v_org_status, v_loc_org_id
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = p_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee or Organization not found');
    END IF;

    IF COALESCE(v_emp_status, 'active') IS DISTINCT FROM 'active' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee is inactive');
    END IF;

    IF v_org_status NOT IN ('active', 'trial') THEN
        RETURN jsonb_build_object('success', false, 'error', 'Organization is not active');
    END IF;

    IF p_location_id IS NOT NULL AND (v_loc_org_id IS NULL OR v_loc_org_id IS DISTINCT FROM v_org_id) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Location does not belong to employee organization');
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id AND check_out_at IS NULL
    ) THEN
        RETURN jsonb_build_object('success', false, 'error', 'Employee already has an active open session');
    END IF;

    v_effective_tz := CASE
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN
            CASE
                WHEN p_location_id IS NOT NULL OR p_source IN ('office_ip', 'rotating_qr', 'kiosk')
                THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_loc_tz, v_org_tz, 'UTC')
    END;

    v_work_date := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, location_id, work_date, check_in_at, source, note
    ) VALUES (
        v_org_id, p_employee_id, p_location_id, v_work_date, pg_catalog.now(), p_source, p_note
    ) RETURNING id INTO v_session_id;

    PERFORM public.recalculate_day(p_employee_id, v_work_date);

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        p_employee_id,
        'ATTENDANCE_PUNCH_VERIFIED',
        'attendance_sessions',
        v_session_id,
        NULL,
        jsonb_build_object('source', p_source, 'location_id', p_location_id, 'work_date', v_work_date, 'note', p_note)
    );

    RETURN jsonb_build_object('success', true, 'session_id', v_session_id, 'work_date', v_work_date);
END;
$$;

CREATE OR REPLACE FUNCTION public.lock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role IS NULL OR v_user_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can lock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to lock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = TRUE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month
      AND locked = FALSE;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'MONTH_LOCKED',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', false),
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', true, 'records_locked', v_count)
    );

    RETURN jsonb_build_object('success', true, 'records_locked', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.unlock_month(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Administrators can unlock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to unlock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = FALSE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month
      AND locked = TRUE;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'MONTH_UNLOCKED',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', true),
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', false, 'records_unlocked', v_count)
    );

    RETURN jsonb_build_object('success', true, 'records_unlocked', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL OR v_req.organization_id IS DISTINCT FROM v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status IS DISTINCT FROM 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot approve your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization approval.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to approve requests for this employee.';
    END IF;

    -- Locked month check
    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE organization_id = v_req.organization_id
          AND employee_id = v_req.employee_id
          AND work_date = v_req.work_date
          AND locked = TRUE
    ) THEN
        RAISE EXCEPTION 'Cannot approve regularization: attendance day % is locked.', v_req.work_date USING ERRCODE = '22023';
    END IF;

    v_old_data := to_jsonb(v_req);

    UPDATE public.regularization_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id
    RETURNING to_jsonb(regularization_requests.*) INTO v_new_data;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, check_out_at, source, note
    ) VALUES (
        v_req.organization_id, v_req.employee_id, v_req.work_date, v_req.requested_in, v_req.requested_out, 'manual',
        'Regularized: ' || COALESCE(v_req.reason, '')
    );

    PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_req.organization_id, v_caller_id, 'REGULARIZATION_APPROVED', 'regularization_requests', p_request_id,
        v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL OR v_req.organization_id IS DISTINCT FROM v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status IS DISTINCT FROM 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot reject your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization review.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to review requests for this employee.';
    END IF;

    v_old_data := to_jsonb(v_req);

    UPDATE public.regularization_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id
    RETURNING to_jsonb(regularization_requests.*) INTO v_new_data;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_req.organization_id, v_caller_id, 'REGULARIZATION_REJECTED', 'regularization_requests', p_request_id, v_old_data, v_new_data);

    RETURN jsonb_build_object('success', true);
END;
$$;

-- ============================================================================
-- SECTION 7: Hardened Leave Helpers & RPCs (0b, 0d, 0e)
-- ============================================================================
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
    v_caller_id UUID;
    v_caller_org UUID;
    v_org_id UUID;
    v_dept_id UUID;
    v_loc_id UUID;
    v_weekly_offs INTEGER[];
    v_curr DATE;
    v_dow INTEGER;
    v_count NUMERIC := 0;
    v_is_holiday BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;
        v_caller_org := public.current_org_id();
    END IF;

    IF p_start_date > p_end_date THEN
        RETURN 0;
    END IF;

    IF p_day_part IN ('first_half', 'second_half') AND p_start_date != p_end_date THEN
        RAISE EXCEPTION 'Half day leave must have identical start and end dates.' USING ERRCODE = '22023';
    END IF;

    SELECT organization_id, department_id, primary_location_id
    INTO v_org_id, v_dept_id, v_loc_id
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN 0;
    END IF;

    IF v_caller_id IS NOT NULL AND v_org_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Employee does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_loc_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.locations WHERE id = v_loc_id;
    END IF;
    IF v_weekly_offs IS NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.attendance_policies WHERE organization_id = v_org_id LIMIT 1;
    END IF;
    IF v_weekly_offs IS NULL THEN
        v_weekly_offs := '{0, 6}'::INTEGER[];
    END IF;

    v_curr := p_start_date;
    WHILE v_curr <= p_end_date LOOP
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;

        IF NOT (v_dow = ANY(v_weekly_offs)) THEN
            SELECT EXISTS (
                SELECT 1 FROM public.holidays
                WHERE organization_id = v_org_id AND date = v_curr
            ) INTO v_is_holiday;

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
    v_caller_id UUID;
    v_start_month INTEGER;
    v_year INTEGER;
    v_p_start DATE;
    v_p_end DATE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;
        IF p_organization_id IS DISTINCT FROM public.current_org_id() THEN
            RAISE EXCEPTION 'Cross-tenant violation: Organization does not match caller membership.' USING ERRCODE = '42501';
        END IF;
    END IF;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Invalid date range: start_date must be before or equal to end_date.' USING ERRCODE = '22023';
    END IF;

    IF p_day_part NOT IN ('full', 'first_half', 'second_half') THEN
        RAISE EXCEPTION 'Invalid day_part: must be full, first_half, or second_half.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.leave_types
        WHERE id = p_leave_type_id AND organization_id = v_caller_org AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Invalid or inactive leave type for caller organization.' USING ERRCODE = '22023';
    END IF;

    v_total_days := public.calculate_working_days(v_caller_id, p_start_date, p_end_date, p_day_part);
    IF v_total_days <= 0 THEN
        RAISE EXCEPTION 'Selected date range contains 0 working days (all dates are holidays or weekly offs).' USING ERRCODE = '22023';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, p_start_date);

    SELECT * INTO v_balance
    FROM public.leave_balances
    WHERE organization_id = v_caller_org
      AND employee_id = v_caller_id
      AND leave_type_id = p_leave_type_id
      AND period_start = v_p_start
      AND period_end = v_p_end
    FOR UPDATE;

    SELECT * INTO v_policy
    FROM public.leave_policies
    WHERE organization_id = v_caller_org
      AND leave_type_id = p_leave_type_id;

    IF v_balance IS NOT NULL THEN
        IF (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_total_days THEN
            RAISE EXCEPTION 'Insufficient leave balance. Available: %, Requested: %',
                (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used), v_total_days
                USING ERRCODE = '22023';
        END IF;
    END IF;

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
    v_punched BOOLEAN;
    v_locked BOOLEAN;
    v_other_approvers_count INTEGER := 0;
    v_has_active_manager BOOLEAN := FALSE;
    v_sole_admin_fallback BOOLEAN := FALSE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Leave request cannot be approved: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target_emp
    FROM public.employees
    WHERE id = v_request.employee_id;

    -- Separation of duties with single-admin organization founder fallback
    IF v_request.employee_id = v_caller_id THEN
        IF v_caller_role = 'admin' THEN
            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 verification required for sole-admin leave approval fallback.' USING ERRCODE = '42501';
            END IF;

            SELECT COUNT(*) INTO v_other_approvers_count
            FROM public.organization_members
            WHERE organization_id = v_caller_org
              AND user_id IS DISTINCT FROM v_caller_id
              AND status = 'active'
              AND role IN ('admin', 'hr');

            IF v_target_emp.manager_id IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.organization_members
                    WHERE organization_id = v_caller_org
                      AND user_id = v_target_emp.manager_id
                      AND status = 'active'
                ) INTO v_has_active_manager;
            END IF;

            IF v_other_approvers_count = 0 AND NOT v_has_active_manager THEN
                v_sole_admin_fallback := TRUE;
            ELSE
                RAISE EXCEPTION 'Separation of duties: You cannot approve your own leave request.' USING ERRCODE = '42501';
            END IF;
        ELSE
            RAISE EXCEPTION 'Separation of duties: You cannot approve your own leave request.' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF v_caller_role IS NULL OR v_caller_role = 'employee' THEN
            RAISE EXCEPTION 'Forbidden: Employees cannot approve leave requests.' USING ERRCODE = '42501';
        ELSIF v_caller_role = 'manager' THEN
            IF v_target_emp.manager_id IS DISTINCT FROM v_caller_id THEN
                RAISE EXCEPTION 'Forbidden: Managers can only approve leave for direct reports.' USING ERRCODE = '42501';
            END IF;
        ELSIF v_caller_role IN ('hr', 'admin') THEN
            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave approval.' USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE organization_id = v_caller_org
          AND employee_id = v_request.employee_id
          AND work_date BETWEEN v_request.start_date AND v_request.end_date
          AND locked = TRUE
    ) INTO v_locked;

    IF v_locked THEN
        RAISE EXCEPTION 'Cannot approve leave: includes locked month dates.' USING ERRCODE = '22023';
    END IF;

    IF v_target_emp.primary_location_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs
        FROM public.locations
        WHERE id = v_target_emp.primary_location_id;
    END IF;
    IF v_weekly_offs IS NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs
        FROM public.attendance_policies
        WHERE organization_id = v_caller_org LIMIT 1;
    END IF;
    IF v_weekly_offs IS NULL THEN
        v_weekly_offs := '{0, 6}'::INTEGER[];
    END IF;

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

    UPDATE public.leave_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = COALESCE(p_review_note, CASE WHEN v_sole_admin_fallback THEN 'Auto-approved via sole-admin organization fallback' ELSE NULL END),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    -- Synchronize attendance_days via recalculate_day() (no direct status writes)
    v_curr := v_request.start_date;
    WHILE v_curr <= v_request.end_date LOOP
        PERFORM public.recalculate_day(v_request.employee_id, v_curr);
        v_curr := v_curr + 1;
    END LOOP;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_APPROVED', 'leave_requests', p_request_id,
        jsonb_build_object('status', 'pending'),
        jsonb_build_object(
            'status', 'approved',
            'total_days', v_request.total_days,
            'reviewed_by', v_caller_id,
            'sole_admin_fallback', v_sole_admin_fallback
        )
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'approved', 'sole_admin_fallback', v_sole_admin_fallback);
END;
$$;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Leave request cannot be rejected: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    IF v_request.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: You cannot reject your own leave request.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_target_emp FROM public.employees WHERE id = v_request.employee_id;

    IF v_caller_role IS NULL OR v_caller_role = 'employee' THEN
        RAISE EXCEPTION 'Forbidden: Employees cannot reject leave requests.' USING ERRCODE = '42501';
    ELSIF v_caller_role = 'manager' THEN
        IF v_target_emp.manager_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only reject leave for direct reports.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
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
    v_was_approved BOOLEAN;
    v_curr DATE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.employee_id IS DISTINCT FROM v_caller_id THEN
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Forbidden: You cannot cancel another employee leave request.' USING ERRCODE = '42501';
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required to cancel employee leave.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_request.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'Leave request cannot be cancelled: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    v_was_approved := (v_request.status = 'approved');

    IF v_was_approved THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = v_caller_org
              AND employee_id = v_request.employee_id
              AND work_date BETWEEN v_request.start_date AND v_request.end_date
              AND locked = TRUE
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot cancel leave: touches locked month dates.' USING ERRCODE = '22023';
        END IF;

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
    END IF;

    UPDATE public.leave_requests
    SET status = 'cancelled',
        cancelled_at = pg_catalog.now(),
        review_note = COALESCE(p_reason, review_note),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    -- Recalculate each day via recalculate_day() AFTER setting leave status='cancelled'
    IF v_was_approved THEN
        v_curr := v_request.start_date;
        WHILE v_curr <= v_request.end_date LOOP
            PERFORM public.recalculate_day(v_request.employee_id, v_curr);
            v_curr := v_curr + 1;
        END LOOP;
    END IF;

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
    v_curr DATE;
    v_locked BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can assign leave.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for assigning leave.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF v_caller_id = ANY(p_employee_ids) THEN
        RAISE EXCEPTION 'Separation of duties: HR and Admins cannot assign leave for themselves.' USING ERRCODE = '42501';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, p_start_date);

    FOREACH v_emp_id IN ARRAY p_employee_ids LOOP
        IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_emp_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Employee % does not belong to caller organization.', v_emp_id USING ERRCODE = '22023';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = v_caller_org
              AND employee_id = v_emp_id
              AND work_date BETWEEN p_start_date AND p_end_date
              AND locked = TRUE
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot assign leave for employee %: includes locked month dates.', v_emp_id USING ERRCODE = '22023';
        END IF;

        v_total_days := public.calculate_working_days(v_emp_id, p_start_date, p_end_date, p_day_part);
        IF v_total_days > 0 THEN
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

            UPDATE public.leave_balances
            SET used = used + v_total_days,
                updated_at = pg_catalog.now()
            WHERE organization_id = v_caller_org
              AND employee_id = v_emp_id
              AND leave_type_id = p_leave_type_id
              AND period_start = v_p_start
              AND period_end = v_p_end;

            INSERT INTO public.leave_requests (
                organization_id, employee_id, leave_type_id, start_date, end_date,
                day_part, total_days, reason, status, reviewed_by, reviewed_at
            ) VALUES (
                v_caller_org, v_emp_id, p_leave_type_id, p_start_date, p_end_date,
                p_day_part, v_total_days, p_reason, 'approved', v_caller_id, pg_catalog.now()
            ) RETURNING id INTO v_req_id;

            -- Sync attendance_days via recalculate_day()
            v_curr := p_start_date;
            WHILE v_curr <= p_end_date LOOP
                PERFORM public.recalculate_day(v_emp_id, v_curr);
                v_curr := v_curr + 1;
            END LOOP;

            INSERT INTO public.audit_logs (
                organization_id, actor_id, action, table_name, record_id, old_data, new_data
            ) VALUES (
                v_caller_org, v_caller_id, 'LEAVE_ASSIGNED', 'leave_requests', v_req_id,
                NULL,
                jsonb_build_object(
                    'employee_id', v_emp_id,
                    'leave_type_id', p_leave_type_id,
                    'start_date', p_start_date,
                    'end_date', p_end_date,
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can adjust leave balances.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to adjust leave balances.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: HR and Admins cannot adjust their own leave balance.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Employee does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, CURRENT_DATE);

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

    INSERT INTO public.leave_balance_adjustments (
        organization_id, employee_id, leave_type_id, adjusted_by, amount, reason
    ) VALUES (
        v_caller_org, p_employee_id, p_leave_type_id, v_caller_id, p_amount, p_reason
    ) RETURNING id INTO v_adj_id;

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
    v_caller_id UUID;
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
    v_caller_id := (SELECT auth.uid());

    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;

        v_caller_role := public.current_user_role();
        v_caller_org := public.current_org_id();

        IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Forbidden: Only HR and Admins can allocate yearly balances.' USING ERRCODE = '42501';
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for allocating balances.' USING ERRCODE = '42501';
        END IF;

        v_target_org := COALESCE(p_organization_id, v_caller_org);
        IF v_target_org IS DISTINCT FROM v_caller_org THEN
            RAISE EXCEPTION 'Cannot allocate balances for another organization.' USING ERRCODE = '42501';
        END IF;
    ELSE
        v_target_org := p_organization_id;
    END IF;

    FOR v_org IN SELECT * FROM public.organizations WHERE (v_target_org IS NULL OR id = v_target_org) LOOP
        SELECT period_start, period_end INTO v_p_start, v_p_end
        FROM public.get_organization_leave_period(v_org.id, CURRENT_DATE);

        FOR v_emp IN SELECT * FROM public.employees WHERE organization_id = v_org.id AND status = 'active' LOOP
            FOR v_policy IN SELECT * FROM public.leave_policies WHERE organization_id = v_org.id LOOP
                v_hire_date := v_emp.created_at::DATE;
                IF v_hire_date > v_p_start AND v_hire_date <= v_p_end THEN
                    v_months_remaining := LEAST(12, GREATEST(1, (EXTRACT(YEAR FROM v_p_end) - EXTRACT(YEAR FROM v_hire_date))::INTEGER * 12 + (EXTRACT(MONTH FROM v_p_end) - EXTRACT(MONTH FROM v_hire_date))::INTEGER + 1));
                    v_quota := ROUND((v_policy.yearly_quota * (v_months_remaining / 12.0)), 1);
                ELSE
                    v_quota := v_policy.yearly_quota;
                END IF;

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

    IF v_caller_id IS NOT NULL THEN
        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_target_org, v_caller_id, 'LEAVE_BALANCES_ALLOCATED', 'leave_balances', v_target_org,
            NULL, jsonb_build_object('allocated_count', v_allocated_count, 'year', p_year)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'allocated_count', v_allocated_count);
END;
$$;

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
    v_emp RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can declare company days off.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to declare company days off.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_department_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM public.departments WHERE id = p_department_id AND organization_id = v_caller_org) THEN
            RAISE EXCEPTION 'Department does not belong to caller organization.' USING ERRCODE = '22023';
        END IF;
    END IF;

    INSERT INTO public.company_days_off (
        organization_id, department_id, date, title, declared_by
    ) VALUES (
        v_caller_org, p_department_id, p_date, p_title, v_caller_id
    ) RETURNING id INTO v_off_id;

    -- Mirror into holidays only for organization-wide declarations
    IF p_department_id IS NULL THEN
        INSERT INTO public.holidays (
            organization_id, date, name, region
        ) VALUES (
            v_caller_org, p_date, p_title, 'COMPANY_DAY_OFF'
        ) ON CONFLICT (organization_id, date) DO UPDATE SET name = EXCLUDED.name;
    END IF;

    -- Recalculate unlocked days for affected employees if day already materialized or in the past/today
    FOR v_emp IN
        SELECT e.id, COALESCE(e.timezone, o.timezone, 'UTC') AS eff_tz
        FROM public.employees e
        JOIN public.organizations o ON o.id = e.organization_id
        WHERE e.organization_id = v_caller_org
          AND e.status = 'active'
          AND (p_department_id IS NULL OR e.department_id = p_department_id)
    LOOP
        IF p_date <= (pg_catalog.now() AT TIME ZONE COALESCE(v_emp.eff_tz, 'UTC'))::date
           OR EXISTS (SELECT 1 FROM public.attendance_days WHERE employee_id = v_emp.id AND work_date = p_date AND locked = FALSE) THEN
            PERFORM public.recalculate_day(v_emp.id, p_date);
        END IF;
    END LOOP;

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

-- ============================================================================
-- SECTION 8: Membership & Admin Governance RPC Active-Membership Enforcement (0b, 0d)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.admin_add_org_member(
    p_organization_id UUID,
    p_user_id UUID,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can add organization members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    IF p_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = p_user_id AND organization_id IS DISTINCT FROM v_caller_org
    ) THEN
        RAISE EXCEPTION 'Cross-tenant violation: Target user belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_caller_org, p_user_id, p_role, 'active')
    ON CONFLICT (user_id) DO UPDATE
    SET role = p_role, status = 'active', updated_at = pg_catalog.now()
    WHERE public.organization_members.organization_id = v_caller_org;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_ADDED', 'organization_members', p_user_id,
        NULL, jsonb_build_object('user_id', p_user_id, 'role', p_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_org_member_role(
    p_organization_id UUID,
    p_user_id UUID,
    p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can update member roles.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    IF p_new_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_new_role;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_current_role
    FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id AND status = 'active';

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    IF v_current_role = 'admin' AND p_new_role != 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot demote yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot demote the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    UPDATE public.organization_members
    SET role = p_new_role, updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_ROLE_UPDATED', 'organization_members', p_user_id,
        jsonb_build_object('user_id', p_user_id, 'role', v_current_role),
        jsonb_build_object('user_id', p_user_id, 'old_role', v_current_role, 'new_role', p_new_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_org_member(
    p_organization_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can remove organization members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NOT NULL AND p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role, to_jsonb(m.*) INTO v_current_role, v_old_data
    FROM public.organization_members m
    WHERE m.organization_id = v_caller_org AND m.user_id = p_user_id;

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    IF v_current_role = 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot remove yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot remove the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    DELETE FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_REMOVED', 'organization_members', p_user_id,
        v_old_data,
        jsonb_build_object('user_id', p_user_id, 'removed_role', v_current_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_update_employee(
    p_employee_id UUID,
    p_manager_id UUID DEFAULT NULL,
    p_status TEXT DEFAULT NULL,
    p_work_mode TEXT DEFAULT NULL,
    p_primary_location_id UUID DEFAULT NULL,
    p_work_target_minutes INTEGER DEFAULT NULL,
    p_expected_office_days INTEGER[] DEFAULT NULL,
    p_required_office_days_per_week INTEGER DEFAULT NULL,
    p_timezone TEXT DEFAULT NULL
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
    v_emp RECORD;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and administrators can update employee governance attributes.';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for employee administrative updates.';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT * INTO v_emp
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_emp.id IS NULL THEN
        RAISE EXCEPTION 'Employee not found.';
    END IF;

    IF v_emp.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Target employee belongs to another organization.';
    END IF;

    IF p_primary_location_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.locations
            WHERE id = p_primary_location_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Invalid primary_location_id: Location does not belong to this organization.';
        END IF;
    END IF;

    IF p_manager_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM public.employees
            WHERE id = p_manager_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Invalid manager_id: Manager does not belong to this organization.';
        END IF;
    END IF;

    v_old_data := to_jsonb(v_emp);

    UPDATE public.employees
    SET
        manager_id = COALESCE(p_manager_id, manager_id),
        status = COALESCE(p_status, status),
        work_mode = COALESCE(p_work_mode, work_mode),
        primary_location_id = COALESCE(p_primary_location_id, primary_location_id),
        work_target_minutes = COALESCE(p_work_target_minutes, work_target_minutes),
        expected_office_days = COALESCE(p_expected_office_days, expected_office_days),
        required_office_days_per_week = COALESCE(p_required_office_days_per_week, required_office_days_per_week),
        timezone = COALESCE(p_timezone, timezone),
        updated_at = pg_catalog.now()
    WHERE id = p_employee_id
    RETURNING to_jsonb(employees.*) INTO v_new_data;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'EMPLOYEE_UPDATED', 'employees', p_employee_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can modify employee governance.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
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

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'EMPLOYEE_UPDATED', 'employees', p_employee_id, v_old_data, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'employee_id', p_employee_id);
END;
$$;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can deactivate members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for member deactivation.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('org_members_' || v_caller_org::text));

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

    IF v_target_org IS NULL OR v_target_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Member not found in caller organization.' USING ERRCODE = '02000';
    END IF;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can create departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
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
        'name', p_name, 'code', p_code,
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can update departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(d.*)
    INTO v_dept_org, v_old_data
    FROM public.departments d
    WHERE id = p_department_id;

    IF v_dept_org IS NULL OR v_dept_org IS DISTINCT FROM v_caller_org THEN
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can delete departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(d.*)
    INTO v_dept_org, v_old_data
    FROM public.departments d
    WHERE id = p_department_id;

    IF v_dept_org IS NULL OR v_dept_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Department not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    UPDATE public.departments SET parent_department_id = NULL WHERE parent_department_id = p_department_id;
    UPDATE public.employees SET department_id = NULL WHERE department_id = p_department_id;
    DELETE FROM public.departments WHERE id = p_department_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'DEPARTMENT_DELETED', 'departments', p_department_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'department_id', p_department_id);
END;
$$;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can create locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    INSERT INTO public.locations (
        organization_id, name, code, address, timezone, working_hours, weekly_off_days
    ) VALUES (
        v_caller_org, p_name, p_code, p_address, p_timezone, p_working_hours, p_weekly_off_days
    ) RETURNING id INTO v_loc_id;

    v_new_data := jsonb_build_object(
        'name', p_name, 'code', p_code, 'address', p_address,
        'timezone', p_timezone, 'working_hours', p_working_hours, 'weekly_off_days', p_weekly_off_days
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LOCATION_CREATED', 'locations', v_loc_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'location_id', v_loc_id);
END;
$$;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(l.*)
    INTO v_loc_org, v_old_data
    FROM public.locations l
    WHERE id = p_location_id;

    IF v_loc_org IS NULL OR v_loc_org IS DISTINCT FROM v_caller_org THEN
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can delete locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete locations.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(l.*)
    INTO v_loc_org, v_old_data
    FROM public.locations l
    WHERE id = p_location_id;

    IF v_loc_org IS NULL OR v_loc_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Location not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    UPDATE public.employees SET primary_location_id = NULL WHERE primary_location_id = p_location_id;
    DELETE FROM public.locations WHERE id = p_location_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LOCATION_DELETED', 'locations', p_location_id, v_old_data, NULL
    );

    RETURN jsonb_build_object('success', true, 'location_id', p_location_id);
END;
$$;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can create shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to create shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    INSERT INTO public.shift_templates (
        organization_id, name, code, start_time, end_time, break_duration_minutes, grace_minutes
    ) VALUES (
        v_caller_org, p_name, p_code, p_start_time, p_end_time, p_break_minutes, p_grace_minutes
    ) RETURNING id INTO v_shift_id;

    v_new_data := jsonb_build_object(
        'name', p_name, 'code', p_code,
        'start_time', p_start_time, 'end_time', p_end_time,
        'break_minutes', p_break_minutes, 'grace_minutes', p_grace_minutes
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'SHIFT_CREATED', 'shift_templates', v_shift_id, NULL, v_new_data
    );

    RETURN jsonb_build_object('success', true, 'shift_template_id', v_shift_id);
END;
$$;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(s.*)
    INTO v_shift_org, v_old_data
    FROM public.shift_templates s
    WHERE id = p_shift_id;

    IF v_shift_org IS NULL OR v_shift_org IS DISTINCT FROM v_caller_org THEN
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can delete shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to delete shift templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(s.*)
    INTO v_shift_org, v_old_data
    FROM public.shift_templates s
    WHERE id = p_shift_id;

    IF v_shift_org IS NULL OR v_shift_org IS DISTINCT FROM v_caller_org THEN
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can assign shifts.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to assign shifts.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF NOT EXISTS (SELECT 1 FROM public.employees WHERE id = p_employee_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Employee does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.shift_templates WHERE id = p_shift_template_id AND organization_id = v_caller_org) THEN
        RAISE EXCEPTION 'Shift template does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.employee_shift_assignments
    SET effective_to = p_effective_from - 1
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND (effective_to IS NULL OR effective_to >= p_effective_from)
      AND effective_from < p_effective_from;

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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update organization settings.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can update attendance policy.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
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



-- ============================================================================
-- Migration 12: Section 1 - HR Attendance Tools & Employee Experience
-- ============================================================================
-- Covers:
-- 1. Profile fields (phone, emergency_contact, onboarding_completed_at),
--    column-level grants, hardened protection triggers, complete_onboarding(),
--    and private 'avatars' Storage bucket (200 KB max, MIME allowlist, per-user RLS).
-- 2. HR attendance corrections (`hr_correct_attendance`), Month-End Close
--    checklist (`get_month_close_checklist`), and reason-mandatory
--    `unlock_month(p_year, p_month, p_reason)`.
-- 3. DB-driven `holidays` (local_name, holiday_type, is_active, RPC-only writes)
--    and global `holiday_templates` catalog (with 'India - Tamil Nadu' copy-on-import).
-- 4. Approval delegations (`approval_delegations`), updated `can_approve_for()`,
--    delegation-aware RLS & leave/regularization approval RPCs.
-- 5. Real notifications across RPCs + triggers, expanded type constraint,
--    and private per-user Supabase Realtime channel broadcast + RLS policy.
-- ============================================================================

-- ============================================================================
-- 1. PROFILE, ONBOARDING, & PRIVATE AVATARS STORAGE BUCKET
-- ============================================================================

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS phone TEXT,
    ADD COLUMN IF NOT EXISTS emergency_contact TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_completed_at TIMESTAMPTZ;

REVOKE UPDATE ON public.employees FROM authenticated;
GRANT UPDATE (full_name, avatar_url, phone, emergency_contact) ON public.employees TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_protect_employee_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_role TEXT;
BEGIN
    IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
        RAISE EXCEPTION 'organization_id cannot be changed.' USING ERRCODE = '42501';
    END IF;

    v_uid := (SELECT auth.uid());
    IF v_uid IS NOT NULL THEN
        v_role := public.current_user_role();
        IF v_role IS DISTINCT FROM 'hr' AND v_role IS DISTINCT FROM 'admin' THEN
            IF NEW.manager_id IS DISTINCT FROM OLD.manager_id OR
               NEW.status IS DISTINCT FROM OLD.status OR
               NEW.work_mode IS DISTINCT FROM OLD.work_mode OR
               NEW.primary_location_id IS DISTINCT FROM OLD.primary_location_id OR
               NEW.work_target_minutes IS DISTINCT FROM OLD.work_target_minutes OR
               NEW.expected_office_days IS DISTINCT FROM OLD.expected_office_days OR
               NEW.required_office_days_per_week IS DISTINCT FROM OLD.required_office_days_per_week OR
               NEW.department_id IS DISTINCT FROM OLD.department_id OR
               NEW.timezone IS DISTINCT FROM OLD.timezone OR
               NEW.email IS DISTINCT FROM OLD.email OR
               NEW.joined_on IS DISTINCT FROM OLD.joined_on THEN
                RAISE EXCEPTION 'Permission denied: Employees cannot modify administrative attributes.' USING ERRCODE = '42501';
            END IF;

            IF NEW.onboarding_completed_at IS DISTINCT FROM OLD.onboarding_completed_at AND
               pg_catalog.current_setting('app.onboarding_rpc', true) IS DISTINCT FROM '1' THEN
                RAISE EXCEPTION 'Permission denied: onboarding_completed_at must be updated via complete_onboarding().' USING ERRCODE = '42501';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_employee_field_protection()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_uid UUID;
    v_role TEXT;
BEGIN
    v_uid := (SELECT auth.uid());
    IF v_uid IS NULL THEN
        RETURN NEW;
    END IF;

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

    IF (NEW.onboarding_completed_at IS DISTINCT FROM OLD.onboarding_completed_at) AND
       pg_catalog.current_setting('app.onboarding_rpc', true) IS DISTINCT FROM '1' THEN
        IF v_role IS DISTINCT FROM 'hr' AND v_role IS DISTINCT FROM 'admin' THEN
            RAISE EXCEPTION 'Forbidden: onboarding_completed_at must be updated via complete_onboarding().' USING ERRCODE = '42501';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_onboarding()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_prev TIMESTAMPTZ;
    v_completed_at TIMESTAMPTZ;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT onboarding_completed_at INTO v_prev
    FROM public.employees
    WHERE id = v_caller_id
      AND organization_id = v_caller_org
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Employee profile not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_prev IS NOT NULL THEN
        RETURN jsonb_build_object(
            'success', true,
            'already_completed', true,
            'onboarding_completed_at', v_prev
        );
    END IF;

    PERFORM pg_catalog.set_config('app.onboarding_rpc', '1', true);

    UPDATE public.employees
    SET onboarding_completed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = v_caller_id
      AND organization_id = v_caller_org
    RETURNING onboarding_completed_at INTO v_completed_at;

    PERFORM pg_catalog.set_config('app.onboarding_rpc', '', true);

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org,
        v_caller_id,
        'ONBOARDING_COMPLETED',
        'employees',
        v_caller_id,
        jsonb_build_object('onboarding_completed_at', NULL),
        jsonb_build_object('onboarding_completed_at', v_completed_at)
    );

    RETURN jsonb_build_object(
        'success', true,
        'already_completed', false,
        'onboarding_completed_at', v_completed_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_onboarding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_onboarding() TO authenticated;

-- Private Storage bucket 'avatars': 200 KB max, JPEG/PNG/WebP only
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'avatars',
    'avatars',
    FALSE,
    204800,
    ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 204800,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "avatars_select_policy" ON storage.objects;
DROP POLICY IF EXISTS "avatars_insert_policy" ON storage.objects;
DROP POLICY IF EXISTS "avatars_update_policy" ON storage.objects;
DROP POLICY IF EXISTS "avatars_delete_policy" ON storage.objects;

CREATE POLICY "avatars_select_policy" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    );

CREATE POLICY "avatars_insert_policy" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    );

CREATE POLICY "avatars_update_policy" ON storage.objects
    FOR UPDATE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    )
    WITH CHECK (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    );

CREATE POLICY "avatars_delete_policy" ON storage.objects
    FOR DELETE TO authenticated
    USING (
        bucket_id = 'avatars'
        AND (storage.foldername(name))[1] = (SELECT auth.uid())::text
        AND (SELECT public.is_active_org_member())
    );

-- ============================================================================
-- 2. NOTIFICATIONS: EXPAND TYPE CONSTRAINT + REALTIME BROADCAST + RLS
-- ============================================================================

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (
        type IN (
            'missed_checkout',
            'request_status',
            'policy_update',
            'reminder',
            'leave_requested',
            'leave_status',
            'attendance_corrected',
            'delegation',
            'task_assigned',
            'task_due_soon',
            'task_overdue'
        )
    );

CREATE OR REPLACE FUNCTION public.trg_broadcast_notification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    PERFORM realtime.send(
        jsonb_build_object(
            'id', NEW.id,
            'user_id', NEW.user_id,
            'organization_id', NEW.organization_id,
            'type', NEW.type,
            'title', NEW.title,
            'body', NEW.body,
            'link', NEW.link,
            'read_at', NEW.read_at,
            'created_at', NEW.created_at
        ),
        'notification_created',
        'notifications:user:' || NEW.user_id::text,
        TRUE
    );
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_broadcast_notification() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS broadcast_notification_after_insert ON public.notifications;
CREATE TRIGGER broadcast_notification_after_insert
    AFTER INSERT ON public.notifications
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_broadcast_notification();

DROP POLICY IF EXISTS "realtime_notifications_user_select_policy" ON realtime.messages;
CREATE POLICY "realtime_notifications_user_select_policy"
    ON realtime.messages
    FOR SELECT
    TO authenticated
    USING (
        realtime.topic() = ('notifications:user:' || (SELECT auth.uid())::text)
        AND (topic IS NULL OR topic = ('notifications:user:' || (SELECT auth.uid())::text))
        AND (SELECT public.is_active_org_member())
    );

CREATE OR REPLACE FUNCTION public.trg_notify_regularization_submitted()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_emp_name TEXT;
    v_manager_id UUID;
BEGIN
    SELECT e.full_name, e.manager_id
    INTO v_emp_name, v_manager_id
    FROM public.employees e
    WHERE e.id = NEW.employee_id;

    IF v_manager_id IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.user_id = v_manager_id
          AND om.organization_id = NEW.organization_id
          AND om.status = 'active'
    ) THEN
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            NEW.organization_id,
            v_manager_id,
            'request_status',
            'Regularization Request Submitted',
            COALESCE(v_emp_name, 'Team member') || ' requested punch correction for ' || NEW.work_date::text || '.',
            '/requests',
            jsonb_build_object('request_id', NEW.id, 'employee_id', NEW.employee_id, 'work_date', NEW.work_date)
        );
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_notify_regularization_submitted() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS notify_regularization_submitted_after_insert ON public.regularization_requests;
CREATE TRIGGER notify_regularization_submitted_after_insert
    AFTER INSERT ON public.regularization_requests
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_notify_regularization_submitted();

CREATE OR REPLACE FUNCTION public.cron_auto_checkout()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_session RECORD;
    v_closed_count INTEGER := 0;
    v_work_date DATE;
BEGIN
    FOR v_session IN
        SELECT s.id, s.employee_id, s.check_in_at, s.organization_id, COALESCE(e.timezone, o.timezone, 'UTC') AS eff_tz
        FROM public.attendance_sessions s
        JOIN public.employees e ON e.id = s.employee_id
        JOIN public.organizations o ON o.id = s.organization_id
        WHERE s.check_out_at IS NULL
          AND s.check_in_at < (pg_catalog.now() - INTERVAL '12 hours')
    LOOP
        v_work_date := (v_session.check_in_at AT TIME ZONE COALESCE(v_session.eff_tz, 'UTC'))::date;

        IF NOT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE employee_id = v_session.employee_id
              AND work_date = v_work_date
              AND locked = TRUE
        ) THEN
            UPDATE public.attendance_sessions
            SET check_out_at = pg_catalog.now(),
                source = 'auto',
                note = COALESCE(note, '') || ' [Auto-closed by nightly cron]'
            WHERE id = v_session.id;

            PERFORM public.recalculate_day(v_session.employee_id, v_work_date);

            INSERT INTO public.notifications (
                organization_id, user_id, type, title, body, link, metadata
            ) VALUES (
                v_session.organization_id,
                v_session.employee_id,
                'missed_checkout',
                'Missed Checkout Auto-Closed',
                'Your open shift from ' || v_work_date::text || ' exceeded 12 hours and was automatically closed. Submit a regularization if needed.',
                '/requests',
                jsonb_build_object('session_id', v_session.id, 'work_date', v_work_date)
            );

            v_closed_count := v_closed_count + 1;
        END IF;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout() TO service_role;

-- ============================================================================
-- 3. MONTH-END CLOSE CHECKLIST, UNLOCK REASON, & HR ATTENDANCE CORRECTIONS
-- ============================================================================

DROP FUNCTION IF EXISTS public.unlock_month(INTEGER, INTEGER);

CREATE OR REPLACE FUNCTION public.unlock_month(
    p_year INTEGER,
    p_month INTEGER,
    p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_role TEXT;
    v_caller_id UUID;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_reason TEXT;
    v_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_user_role := public.current_user_role();
    IF v_user_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only Administrators can unlock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to unlock attendance months.' USING ERRCODE = '42501';
    END IF;

    v_reason := pg_catalog.btrim(COALESCE(p_reason, ''));
    IF v_reason = '' THEN
        RAISE EXCEPTION 'Reason is required when unlocking an attendance month.' USING ERRCODE = '22023';
    END IF;

    IF p_year < 2000 OR p_year > 2100 OR p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'Invalid year or month parameter.' USING ERRCODE = '22023';
    END IF;

    v_org_id := public.current_org_id();

    UPDATE public.attendance_days
    SET locked = FALSE,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
      AND EXTRACT(YEAR FROM work_date) = p_year
      AND EXTRACT(MONTH FROM work_date) = p_month
      AND locked = TRUE;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_org_id,
        v_caller_id,
        'MONTH_UNLOCKED',
        'attendance_days',
        gen_random_uuid(),
        jsonb_build_object('year', p_year, 'month', p_month, 'locked', true),
        jsonb_build_object(
            'year', p_year,
            'month', p_month,
            'locked', false,
            'records_unlocked', v_count,
            'reason', v_reason
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'records_unlocked', v_count,
        'reason', v_reason
    );
END;
$$;

REVOKE ALL ON FUNCTION public.unlock_month(INTEGER, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unlock_month(INTEGER, INTEGER, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_month_close_checklist(
    p_year INTEGER,
    p_month INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_start DATE;
    v_end DATE;
    v_open_count INTEGER := 0;
    v_reg_count INTEGER := 0;
    v_leave_count INTEGER := 0;
    v_locked_count INTEGER := 0;
    v_unlocked_count INTEGER := 0;
    v_total_days_count INTEGER := 0;
    v_open_items JSONB := '[]'::jsonb;
    v_reg_items JSONB := '[]'::jsonb;
    v_leave_items JSONB := '[]'::jsonb;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can inspect month-end close checklists.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to inspect month-end close checklists.' USING ERRCODE = '42501';
    END IF;

    IF p_year < 2000 OR p_year > 2100 OR p_month < 1 OR p_month > 12 THEN
        RAISE EXCEPTION 'Invalid year or month parameter.' USING ERRCODE = '22023';
    END IF;

    v_org_id := public.current_org_id();
    v_start := pg_catalog.make_date(p_year, p_month, 1);
    v_end := (v_start + INTERVAL '1 month' - INTERVAL '1 day')::date;

    SELECT COUNT(*)::int INTO v_open_count
    FROM public.attendance_sessions s
    WHERE s.organization_id = v_org_id
      AND s.check_out_at IS NULL
      AND s.work_date BETWEEN v_start AND v_end;

    SELECT COALESCE(jsonb_agg(sub ORDER BY sub.work_date, sub.check_in_at), '[]'::jsonb)
    INTO v_open_items
    FROM (
        SELECT s.id, s.employee_id, e.full_name AS employee_name, s.work_date, s.check_in_at
        FROM public.attendance_sessions s
        JOIN public.employees e ON e.id = s.employee_id
        WHERE s.organization_id = v_org_id
          AND s.check_out_at IS NULL
          AND s.work_date BETWEEN v_start AND v_end
        ORDER BY s.work_date, s.check_in_at
        LIMIT 25
    ) sub;

    SELECT COUNT(*)::int INTO v_reg_count
    FROM public.regularization_requests r
    WHERE r.organization_id = v_org_id
      AND r.status = 'pending'
      AND r.work_date BETWEEN v_start AND v_end;

    SELECT COALESCE(jsonb_agg(sub ORDER BY sub.work_date, sub.created_at), '[]'::jsonb)
    INTO v_reg_items
    FROM (
        SELECT r.id, r.employee_id, e.full_name AS employee_name, r.work_date, r.reason, r.created_at
        FROM public.regularization_requests r
        JOIN public.employees e ON e.id = r.employee_id
        WHERE r.organization_id = v_org_id
          AND r.status = 'pending'
          AND r.work_date BETWEEN v_start AND v_end
        ORDER BY r.work_date, r.created_at
        LIMIT 25
    ) sub;

    SELECT COUNT(*)::int INTO v_leave_count
    FROM public.leave_requests lr
    WHERE lr.organization_id = v_org_id
      AND lr.status = 'pending'
      AND lr.start_date <= v_end
      AND lr.end_date >= v_start;

    SELECT COALESCE(jsonb_agg(sub ORDER BY sub.start_date, sub.created_at), '[]'::jsonb)
    INTO v_leave_items
    FROM (
        SELECT lr.id, lr.employee_id, e.full_name AS employee_name, lr.start_date, lr.end_date, lr.total_days, lr.reason, lr.created_at
        FROM public.leave_requests lr
        JOIN public.employees e ON e.id = lr.employee_id
        WHERE lr.organization_id = v_org_id
          AND lr.status = 'pending'
          AND lr.start_date <= v_end
          AND lr.end_date >= v_start
        ORDER BY lr.start_date, lr.created_at
        LIMIT 25
    ) sub;

    SELECT
        COUNT(*) FILTER (WHERE locked = TRUE)::int,
        COUNT(*) FILTER (WHERE locked = FALSE)::int,
        COUNT(*)::int
    INTO v_locked_count, v_unlocked_count, v_total_days_count
    FROM public.attendance_days d
    WHERE d.organization_id = v_org_id
      AND d.work_date BETWEEN v_start AND v_end;

    RETURN jsonb_build_object(
        'year', p_year,
        'month', p_month,
        'period_start', v_start,
        'period_end', v_end,
        'open_sessions_count', v_open_count,
        'open_sessions', v_open_items,
        'pending_regularizations_count', v_reg_count,
        'pending_regularizations', v_reg_items,
        'pending_leaves_count', v_leave_count,
        'pending_leaves', v_leave_items,
        'locked_days_count', v_locked_count,
        'unlocked_days_count', v_unlocked_count,
        'total_days_count', v_total_days_count,
        'is_month_locked', (v_locked_count > 0 AND v_unlocked_count = 0),
        'ready_to_lock', (v_open_count = 0 AND v_reg_count = 0 AND v_leave_count = 0)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_month_close_checklist(INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_month_close_checklist(INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_correct_attendance(
    p_employee_id UUID,
    p_work_date DATE,
    p_sessions JSONB,
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
    v_reason TEXT;
    v_target RECORD;
    v_effective_tz TEXT;
    v_is_locked BOOLEAN := FALSE;
    v_old_sessions JSONB := '[]'::jsonb;
    v_old_day JSONB := NULL;
    v_new_sessions JSONB := '[]'::jsonb;
    v_new_day JSONB := NULL;
    v_elem JSONB;
    v_in TIMESTAMPTZ;
    v_out TIMESTAMPTZ;
    v_loc_id UUID;
    v_note TEXT;
    v_parsed_ranges TSTZRANGE[] := ARRAY[]::TSTZRANGE[];
    v_curr_range TSTZRANGE;
    v_existing_range TSTZRANGE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can perform direct attendance corrections.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for attendance corrections.' USING ERRCODE = '42501';
    END IF;

    IF p_employee_id IS NULL OR p_work_date IS NULL THEN
        RAISE EXCEPTION 'Employee ID and work date are required.' USING ERRCODE = '22023';
    END IF;

    IF p_employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot correct your own attendance.' USING ERRCODE = '42501';
    END IF;

    v_reason := pg_catalog.btrim(COALESCE(p_reason, ''));
    IF v_reason = '' THEN
        RAISE EXCEPTION 'Reason is mandatory for HR attendance corrections.' USING ERRCODE = '22023';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT
        e.id,
        e.organization_id,
        e.timezone AS emp_tz,
        COALESCE(e.work_mode, o.work_mode, 'remote') AS eff_work_mode,
        o.timezone AS org_tz,
        l.timezone AS loc_tz
    INTO v_target
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_target IS NULL OR v_target.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant or unknown target: Employee does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    v_effective_tz := CASE
        WHEN v_target.eff_work_mode = 'office' THEN COALESCE(v_target.loc_tz, v_target.org_tz, 'UTC')
        ELSE COALESCE(v_target.emp_tz, v_target.org_tz, 'UTC')
    END;

    SELECT locked INTO v_is_locked
    FROM public.attendance_days
    WHERE organization_id = v_caller_org
      AND employee_id = p_employee_id
      AND work_date = p_work_date
    FOR UPDATE;

    IF COALESCE(v_is_locked, FALSE) THEN
        RAISE EXCEPTION 'Attendance day % is locked. An administrator must unlock the month before corrections can be applied.', p_work_date USING ERRCODE = '22023';
    END IF;

    IF p_sessions IS NULL OR jsonb_typeof(p_sessions) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'p_sessions must be a JSON array.' USING ERRCODE = '22023';
    END IF;

    IF jsonb_array_length(p_sessions) > 20 THEN
        RAISE EXCEPTION 'Too many sessions provided for a single day (max 20).' USING ERRCODE = '22023';
    END IF;

    -- Snapshot old_data before mutation
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'check_in_at', s.check_in_at,
        'check_out_at', s.check_out_at,
        'source', s.source,
        'note', s.note
    ) ORDER BY s.check_in_at), '[]'::jsonb)
    INTO v_old_sessions
    FROM public.attendance_sessions s
    WHERE s.organization_id = v_caller_org
      AND s.employee_id = p_employee_id
      AND (s.work_date = p_work_date OR (s.check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date);

    SELECT jsonb_build_object(
        'status', d.status,
        'total_minutes', d.total_minutes,
        'overtime_minutes', d.overtime_minutes,
        'is_late', d.is_late,
        'locked', d.locked
    )
    INTO v_old_day
    FROM public.attendance_days d
    WHERE d.organization_id = v_caller_org
      AND d.employee_id = p_employee_id
      AND d.work_date = p_work_date;

    -- Validate all sessions before writing anything
    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_sessions)
    LOOP
        IF jsonb_typeof(v_elem) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Each session entry must be a JSON object.' USING ERRCODE = '22023';
        END IF;

        BEGIN
            v_in := NULLIF(v_elem->>'check_in_at', '')::timestamptz;
            v_out := NULLIF(v_elem->>'check_out_at', '')::timestamptz;
        EXCEPTION WHEN OTHERS THEN
            RAISE EXCEPTION 'Invalid ISO timestamp in p_sessions.' USING ERRCODE = '22023';
        END;

        IF v_in IS NULL OR v_out IS NULL OR v_out <= v_in THEN
            RAISE EXCEPTION 'Each session requires valid check_in_at and check_out_at with check_out_at > check_in_at.' USING ERRCODE = '22023';
        END IF;

        IF (v_in AT TIME ZONE v_effective_tz)::date IS DISTINCT FROM p_work_date THEN
            RAISE EXCEPTION 'Session check_in_at (%) does not fall on work_date % in employee timezone %.', v_in, p_work_date, v_effective_tz USING ERRCODE = '22023';
        END IF;

        IF NULLIF(v_elem->>'location_id', '') IS NOT NULL THEN
            BEGIN
                v_loc_id := (v_elem->>'location_id')::uuid;
            EXCEPTION WHEN OTHERS THEN
                RAISE EXCEPTION 'Invalid location_id UUID in p_sessions.' USING ERRCODE = '22023';
            END;
            IF NOT EXISTS (
                SELECT 1 FROM public.locations
                WHERE id = v_loc_id AND organization_id = v_caller_org
            ) THEN
                RAISE EXCEPTION 'Location does not belong to caller organization.' USING ERRCODE = '42501';
            END IF;
        END IF;

        v_curr_range := tstzrange(v_in, v_out, '[)');
        FOREACH v_existing_range IN ARRAY v_parsed_ranges
        LOOP
            IF v_curr_range && v_existing_range THEN
                RAISE EXCEPTION 'Corrected attendance sessions cannot overlap.' USING ERRCODE = '22023';
            END IF;
        END LOOP;
        v_parsed_ranges := array_append(v_parsed_ranges, v_curr_range);
    END LOOP;

    -- Replace day's sessions
    DELETE FROM public.attendance_sessions s
    WHERE s.organization_id = v_caller_org
      AND s.employee_id = p_employee_id
      AND (s.work_date = p_work_date OR (s.check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date);

    FOR v_elem IN SELECT * FROM jsonb_array_elements(p_sessions)
    LOOP
        v_in := (v_elem->>'check_in_at')::timestamptz;
        v_out := (v_elem->>'check_out_at')::timestamptz;
        v_loc_id := CASE WHEN NULLIF(v_elem->>'location_id', '') IS NOT NULL THEN (v_elem->>'location_id')::uuid ELSE NULL END;
        v_note := COALESCE(NULLIF(pg_catalog.btrim(v_elem->>'note'), ''), 'HR Correction: ' || v_reason);

        INSERT INTO public.attendance_sessions (
            organization_id, employee_id, work_date, check_in_at, check_out_at, source, location_id, note
        ) VALUES (
            v_caller_org, p_employee_id, p_work_date, v_in, v_out, 'manual', v_loc_id, v_note
        );
    END LOOP;

    -- Recompute canonical attendance_days row
    PERFORM public.recalculate_day(p_employee_id, p_work_date);

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'check_in_at', s.check_in_at,
        'check_out_at', s.check_out_at,
        'source', s.source,
        'note', s.note
    ) ORDER BY s.check_in_at), '[]'::jsonb)
    INTO v_new_sessions
    FROM public.attendance_sessions s
    WHERE s.organization_id = v_caller_org
      AND s.employee_id = p_employee_id
      AND (s.work_date = p_work_date OR (s.check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date);

    SELECT jsonb_build_object(
        'status', d.status,
        'total_minutes', d.total_minutes,
        'overtime_minutes', d.overtime_minutes,
        'is_late', d.is_late,
        'locked', d.locked
    )
    INTO v_new_day
    FROM public.attendance_days d
    WHERE d.organization_id = v_caller_org
      AND d.employee_id = p_employee_id
      AND d.work_date = p_work_date;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org,
        v_caller_id,
        'ATTENDANCE_CORRECTED',
        'attendance_days',
        p_employee_id,
        jsonb_build_object(
            'employee_id', p_employee_id,
            'work_date', p_work_date,
            'day', v_old_day,
            'sessions', v_old_sessions
        ),
        jsonb_build_object(
            'employee_id', p_employee_id,
            'work_date', p_work_date,
            'reason', v_reason,
            'day', v_new_day,
            'sessions', v_new_sessions
        )
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_caller_org,
        p_employee_id,
        'attendance_corrected',
        'Attendance Corrected',
        'Your attendance record for ' || p_work_date::text || ' was adjusted by HR/Admin. Reason: ' || v_reason,
        '/attendance',
        jsonb_build_object('work_date', p_work_date, 'corrected_by', v_caller_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'employee_id', p_employee_id,
        'work_date', p_work_date,
        'day', v_new_day,
        'sessions', v_new_sessions
    );
END;
$$;

REVOKE ALL ON FUNCTION public.hr_correct_attendance(UUID, DATE, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_correct_attendance(UUID, DATE, JSONB, TEXT) TO authenticated;

-- ============================================================================
-- 4. DB-DRIVEN HOLIDAYS & GLOBAL HOLIDAY_TEMPLATES CATALOG
-- ============================================================================

ALTER TABLE public.holidays
    ADD COLUMN IF NOT EXISTS local_name TEXT,
    ADD COLUMN IF NOT EXISTS holiday_type TEXT NOT NULL DEFAULT 'public' CHECK (holiday_type IN ('public', 'company', 'special')),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE,
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now();

-- Backfill split English + Local Script from legacy "English (தமிழ்)" format
UPDATE public.holidays
SET
    local_name = COALESCE(local_name, pg_catalog.btrim(substring(name FROM '\(([^)]+)\)\s*$'))),
    name = pg_catalog.btrim(regexp_replace(name, '\s*\(([^)]+)\)\s*$', ''))
WHERE local_name IS NULL
  AND name ~ '\([^)]+\)\s*$';

-- Enforce RPC-only writes on holidays
REVOKE INSERT, UPDATE, DELETE ON public.holidays FROM authenticated;
DROP POLICY IF EXISTS "holidays_insert_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_update_policy" ON public.holidays;
DROP POLICY IF EXISTS "holidays_delete_policy" ON public.holidays;

CREATE TABLE IF NOT EXISTS public.holiday_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_code TEXT NOT NULL,
    template_name TEXT NOT NULL,
    region_code TEXT NOT NULL,
    template_year INTEGER NULL CHECK (template_year IS NULL OR template_year BETWEEN 2000 AND 2100),
    month_num INTEGER NOT NULL CHECK (month_num BETWEEN 1 AND 12),
    day_num INTEGER NOT NULL CHECK (day_num BETWEEN 1 AND 31),
    name TEXT NOT NULL,
    local_name TEXT,
    holiday_type TEXT NOT NULL DEFAULT 'public' CHECK (holiday_type IN ('public', 'company', 'special')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_holiday_templates_code_year_date
    ON public.holiday_templates (template_code, COALESCE(template_year, 0), month_num, day_num);

REVOKE ALL ON TABLE public.holiday_templates FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.holiday_templates TO authenticated;

ALTER TABLE public.holiday_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "holiday_templates_select_policy" ON public.holiday_templates;
DROP POLICY IF EXISTS "enforce_active_org_membership_holiday_templates" ON public.holiday_templates;

CREATE POLICY "holiday_templates_select_policy" ON public.holiday_templates
    FOR SELECT TO authenticated
    USING (true);

CREATE POLICY "enforce_active_org_membership_holiday_templates" ON public.holiday_templates
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

-- Seed global holiday templates ('India - Tamil Nadu', 'India - National', 'United States - Federal')
INSERT INTO public.holiday_templates (template_code, template_name, region_code, template_year, month_num, day_num, name, local_name, holiday_type)
VALUES
    -- India - Tamil Nadu (Fixed Annual Dates)
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 1, 'New Year''s Day', 'ஆங்கிலப் புத்தாண்டு', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 14, 'Bhogi Festival', 'போகிப் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 15, 'Thai Pongal', 'தைப்பொங்கல்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 16, 'Thiruvalluvar Day / Mattu Pongal', 'திருவள்ளுவர் தினம் / மாட்டுப் பொங்கல்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 1, 17, 'Uzhavar Thirunal', 'உழவர் திருநாள்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', NULL, 1, 26, 'Republic Day', 'குடியரசு தினம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', NULL, 4, 14, 'Tamil New Year & Dr. Ambedkar Jayanti', 'தமிழ்ப் புத்தாண்டு / அம்பேத்கர் ஜெயந்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', NULL, 5, 1, 'May Day / Labour Day', 'உழைப்பாளர் தினம் - மே தினம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', NULL, 8, 15, 'Independence Day', 'சுதந்திர தினம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', NULL, 10, 2, 'Gandhi Jayanti', 'காந்தி ஜெயந்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'GLOBAL', NULL, 12, 25, 'Christmas Day', 'கிறிஸ்துமஸ் பண்டிகை', 'public'),
    -- India - Tamil Nadu (2026 Lunar/Variable Dates)
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 2, 1, 'Thaipusam', 'தைப்பூசம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2026, 3, 20, 'Ramzan / Eid-ul-Fitr', 'ரம்ஜான் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'GLOBAL', 2026, 4, 3, 'Good Friday', 'புனித வெள்ளி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2026, 5, 27, 'Bakrid / Eid-al-Adha', 'பக்ரீத் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2026, 6, 26, 'Muharram', 'மொஹரம் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 9, 4, 'Krishna Jayanthi / Gokulashtami', 'கிருஷ்ண ஜெயந்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 9, 14, 'Vinayakar Chathurthi', 'விநாயகர் சதுர்த்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2026, 9, 25, 'Milad-un-Nabi', 'நபிகள் நாயகம் பிறந்த நாள்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 10, 19, 'Ayutha Pooja / Saraswathi Pooja', 'ஆயுத பூஜை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 10, 20, 'Vijaya Dasami', 'விஜயதசமி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2026, 11, 8, 'Deepavali', 'தீபாவளி பண்டிகை', 'public'),
    -- India - Tamil Nadu (2027 Lunar/Variable Dates)
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 1, 22, 'Thaipusam', 'தைப்பூசம்', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2027, 3, 10, 'Ramzan / Eid-ul-Fitr', 'ரம்ஜான் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'GLOBAL', 2027, 3, 26, 'Good Friday', 'புனித வெள்ளி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2027, 5, 17, 'Bakrid / Eid-al-Adha', 'பக்ரீத் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'IN', 2027, 6, 16, 'Muharram', 'மொஹரம் பண்டிகை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 8, 25, 'Krishna Jayanthi / Gokulashtami', 'கிருஷ்ண ஜெயந்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 9, 4, 'Vinayakar Chathurthi', 'விநாயகர் சதுர்த்தி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 10, 8, 'Ayutha Pooja / Saraswathi Pooja', 'ஆயுத பூஜை', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 10, 9, 'Vijaya Dasami', 'விஜயதசமி', 'public'),
    ('IN_TN', 'India - Tamil Nadu', 'TN', 2027, 10, 29, 'Deepavali', 'தீபாவளி பண்டிகை', 'public'),
    -- India - National Gazetted
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 1, 1, 'New Year''s Day', NULL, 'public'),
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 1, 26, 'Republic Day', 'गणतंत्र दिवस', 'public'),
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 5, 1, 'Labour Day', NULL, 'public'),
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 8, 15, 'Independence Day', 'स्वतंत्रता दिवस', 'public'),
    ('IN_NAT', 'India - National Gazetted', 'IN', NULL, 10, 2, 'Gandhi Jayanti', 'गांधी जयंती', 'public'),
    ('IN_NAT', 'India - National Gazetted', 'GLOBAL', NULL, 12, 25, 'Christmas Day', NULL, 'public'),
    -- United States - Federal
    ('US_FED', 'United States - Federal', 'US', NULL, 1, 1, 'New Year''s Day', NULL, 'public'),
    ('US_FED', 'United States - Federal', 'US', NULL, 6, 19, 'Juneteenth National Independence Day', NULL, 'public'),
    ('US_FED', 'United States - Federal', 'US', NULL, 7, 4, 'Independence Day', NULL, 'public'),
    ('US_FED', 'United States - Federal', 'US', NULL, 11, 11, 'Veterans Day', NULL, 'public'),
    ('US_FED', 'United States - Federal', 'US', NULL, 12, 25, 'Christmas Day', NULL, 'public')
ON CONFLICT DO NOTHING;

-- Update recalculate_day & calculate_working_days to respect holidays.is_active = TRUE
CREATE OR REPLACE FUNCTION public.recalculate_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total_minutes INTEGER := 0;
    v_sessions_count INTEGER := 0;
    v_first_in TIMESTAMPTZ;
    v_last_out TIMESTAMPTZ;
    v_open_sessions INTEGER := 0;
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_overtime_minutes INTEGER := 0;
    v_work_location TEXT := 'remote';
    v_policy RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_is_company_day_off BOOLEAN := FALSE;
    v_day_of_week INTEGER;
    v_weekly_offs INTEGER[];
    v_is_weekend BOOLEAN := FALSE;
    v_target_minutes INTEGER := 480;
    v_org_id UUID;
    v_dept_id UUID;
    v_work_mode TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_loc_weekly_offs INTEGER[];
    v_effective_tz TEXT;
    v_local_today DATE;
    v_is_locked BOOLEAN := FALSE;
    v_has_full_leave BOOLEAN := FALSE;
    v_has_first_half BOOLEAN := FALSE;
    v_has_second_half BOOLEAN := FALSE;
BEGIN
    SELECT locked INTO v_is_locked
    FROM public.attendance_days
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    IF COALESCE(v_is_locked, FALSE) THEN
        RETURN;
    END IF;

    SELECT
        e.organization_id,
        e.department_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        COALESCE(e.work_target_minutes, 480),
        l.weekly_off_days
    INTO
        v_org_id, v_dept_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_target_minutes, v_loc_weekly_offs
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id
          AND (check_in_at AT TIME ZONE COALESCE(v_emp_tz, v_org_tz, 'UTC'))::date = p_work_date
          AND (location_id IS NOT NULL OR source IN ('office_ip', 'rotating_qr', 'kiosk'))
    ) THEN
        v_work_location := 'office';
    ELSE
        v_work_location := 'remote';
    END IF;

    v_effective_tz := CASE
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN
            CASE
                WHEN v_work_location = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
    END;

    v_local_today := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    SELECT * INTO v_policy
    FROM public.attendance_policies
    WHERE organization_id = v_org_id
    LIMIT 1;

    SELECT
        COALESCE(SUM(
            CASE
                WHEN check_out_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60
                ELSE EXTRACT(EPOCH FROM (pg_catalog.now() - check_in_at)) / 60
            END
        ), 0)::INTEGER,
        COUNT(*),
        MIN(check_in_at),
        MAX(check_out_at),
        COUNT(*) FILTER (WHERE check_out_at IS NULL)
    INTO
        v_total_minutes,
        v_sessions_count,
        v_first_in,
        v_last_out,
        v_open_sessions
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id
      AND (check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date;

    SELECT EXISTS (
        SELECT 1 FROM public.holidays
        WHERE organization_id = v_org_id
          AND date = p_work_date
          AND is_active = TRUE
    ) INTO v_is_holiday;

    SELECT EXISTS (
        SELECT 1 FROM public.company_days_off
        WHERE organization_id = v_org_id
          AND date = p_work_date
          AND (department_id IS NULL OR department_id = v_dept_id)
    ) INTO v_is_company_day_off;

    v_weekly_offs := COALESCE(v_loc_weekly_offs, v_policy.weekly_off_days, '{0, 6}'::INTEGER[]);
    v_day_of_week := EXTRACT(DOW FROM p_work_date)::INTEGER;
    v_is_weekend := v_day_of_week = ANY(v_weekly_offs);

    SELECT
        COALESCE(bool_or(day_part = 'full'), FALSE),
        COALESCE(bool_or(day_part = 'first_half'), FALSE),
        COALESCE(bool_or(day_part = 'second_half'), FALSE)
    INTO v_has_full_leave, v_has_first_half, v_has_second_half
    FROM public.leave_requests
    WHERE organization_id = v_org_id
      AND employee_id = p_employee_id
      AND status = 'approved'
      AND p_work_date BETWEEN start_date AND end_date;

    IF v_first_in IS NOT NULL THEN
        DECLARE
            v_expected_start TIME := COALESCE(v_policy.shift_start_time, '09:00:00'::time);
            v_grace INTEGER := COALESCE(v_policy.grace_minutes, 15);
            v_actual_time TIME := (v_first_in AT TIME ZONE v_effective_tz)::time;
        BEGIN
            IF v_actual_time > (v_expected_start + (v_grace || ' minutes')::interval) THEN
                v_is_late := TRUE;
            END IF;
        END;
    END IF;

    IF v_is_holiday OR v_is_company_day_off THEN
        v_status := 'holiday';
    ELSIF v_is_weekend THEN
        v_status := 'weekend';
    ELSIF v_has_full_leave OR (v_has_first_half AND v_has_second_half) THEN
        v_status := 'leave';
    ELSIF (v_has_first_half OR v_has_second_half) AND v_sessions_count = 0 THEN
        v_status := 'leave';
        v_total_minutes := COALESCE(v_policy.half_day_minutes, 240);
    ELSIF v_sessions_count = 0 THEN
        IF p_work_date > v_local_today THEN
            DELETE FROM public.attendance_days
            WHERE employee_id = p_employee_id
              AND work_date = p_work_date
              AND locked = FALSE;
            RETURN;
        END IF;
        v_status := 'absent';
    ELSIF v_total_minutes >= v_target_minutes THEN
        v_status := 'present';
        v_overtime_minutes := GREATEST(0, v_total_minutes - v_target_minutes);
    ELSE
        v_status := 'half_day';
    END IF;

    INSERT INTO public.attendance_days (
        organization_id,
        employee_id,
        work_date,
        total_minutes,
        overtime_minutes,
        status,
        is_late,
        locked,
        updated_at
    ) VALUES (
        v_org_id,
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_overtime_minutes,
        v_status,
        v_is_late,
        FALSE,
        pg_catalog.now()
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        total_minutes = EXCLUDED.total_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes,
        status = EXCLUDED.status,
        is_late = EXCLUDED.is_late,
        updated_at = EXCLUDED.updated_at
    WHERE public.attendance_days.locked = FALSE;

    RETURN;
END;
$$;

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
    v_caller_id UUID;
    v_caller_org UUID;
    v_org_id UUID;
    v_dept_id UUID;
    v_loc_id UUID;
    v_weekly_offs INTEGER[];
    v_curr DATE;
    v_dow INTEGER;
    v_count NUMERIC := 0;
    v_is_holiday BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;
        v_caller_org := public.current_org_id();
    END IF;

    IF p_start_date > p_end_date THEN
        RETURN 0;
    END IF;

    IF p_day_part IN ('first_half', 'second_half') AND p_start_date != p_end_date THEN
        RAISE EXCEPTION 'Half day leave must have identical start and end dates.' USING ERRCODE = '22023';
    END IF;

    SELECT organization_id, department_id, primary_location_id
    INTO v_org_id, v_dept_id, v_loc_id
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN 0;
    END IF;

    IF v_caller_id IS NOT NULL AND v_org_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Employee does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_loc_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.locations WHERE id = v_loc_id;
    END IF;
    IF v_weekly_offs IS NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.attendance_policies WHERE organization_id = v_org_id LIMIT 1;
    END IF;
    IF v_weekly_offs IS NULL THEN
        v_weekly_offs := '{0, 6}'::INTEGER[];
    END IF;

    v_curr := p_start_date;
    WHILE v_curr <= p_end_date LOOP
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;

        IF NOT (v_dow = ANY(v_weekly_offs)) THEN
            SELECT EXISTS (
                SELECT 1 FROM public.holidays
                WHERE organization_id = v_org_id
                  AND date = v_curr
                  AND is_active = TRUE
            ) INTO v_is_holiday;

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

CREATE OR REPLACE FUNCTION public.create_holiday(
    p_date DATE,
    p_name TEXT,
    p_local_name TEXT DEFAULT NULL,
    p_region TEXT DEFAULT 'GLOBAL',
    p_holiday_type TEXT DEFAULT 'public'
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
    v_org_id UUID;
    v_name TEXT;
    v_local_name TEXT;
    v_region TEXT;
    v_type TEXT;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can create holidays.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to manage holidays.' USING ERRCODE = '42501';
    END IF;

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF p_date IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Holiday date and name are required.' USING ERRCODE = '22023';
    END IF;

    v_type := COALESCE(NULLIF(pg_catalog.btrim(p_holiday_type), ''), 'public');
    IF v_type NOT IN ('public', 'company', 'special') THEN
        RAISE EXCEPTION 'Invalid holiday_type: must be public, company, or special.' USING ERRCODE = '22023';
    END IF;

    v_region := COALESCE(NULLIF(pg_catalog.btrim(p_region), ''), 'GLOBAL');
    v_local_name := NULLIF(pg_catalog.btrim(COALESCE(p_local_name, '')), '');
    v_org_id := public.current_org_id();

    IF EXISTS (
        SELECT 1 FROM public.holidays
        WHERE organization_id = v_org_id AND date = p_date
    ) THEN
        RAISE EXCEPTION 'A holiday already exists for date %.', p_date USING ERRCODE = '23505';
    END IF;

    INSERT INTO public.holidays (
        organization_id, date, name, local_name, region, holiday_type, is_active, updated_at
    ) VALUES (
        v_org_id, p_date, v_name, v_local_name, v_region, v_type, TRUE, pg_catalog.now()
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'HOLIDAY_CREATED',
        'holidays',
        v_row.id,
        NULL,
        to_jsonb(v_row)
    );

    RETURN jsonb_build_object('success', true, 'holiday', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.create_holiday(DATE, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_holiday(DATE, TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_holiday(
    p_holiday_id UUID,
    p_date DATE,
    p_name TEXT,
    p_local_name TEXT DEFAULT NULL,
    p_region TEXT DEFAULT 'GLOBAL',
    p_holiday_type TEXT DEFAULT 'public',
    p_is_active BOOLEAN DEFAULT TRUE
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
    v_org_id UUID;
    v_old_row RECORD;
    v_new_row RECORD;
    v_name TEXT;
    v_local_name TEXT;
    v_region TEXT;
    v_type TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can update holidays.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to manage holidays.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.holidays
    WHERE id = p_holiday_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Holiday not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF p_date IS NULL OR v_name = '' THEN
        RAISE EXCEPTION 'Holiday date and name are required.' USING ERRCODE = '22023';
    END IF;

    v_type := COALESCE(NULLIF(pg_catalog.btrim(p_holiday_type), ''), 'public');
    IF v_type NOT IN ('public', 'company', 'special') THEN
        RAISE EXCEPTION 'Invalid holiday_type: must be public, company, or special.' USING ERRCODE = '22023';
    END IF;

    v_region := COALESCE(NULLIF(pg_catalog.btrim(p_region), ''), 'GLOBAL');
    v_local_name := NULLIF(pg_catalog.btrim(COALESCE(p_local_name, '')), '');

    IF EXISTS (
        SELECT 1 FROM public.holidays
        WHERE organization_id = v_org_id AND date = p_date AND id IS DISTINCT FROM p_holiday_id
    ) THEN
        RAISE EXCEPTION 'Another holiday already exists for date %.', p_date USING ERRCODE = '23505';
    END IF;

    UPDATE public.holidays
    SET date = p_date,
        name = v_name,
        local_name = v_local_name,
        region = v_region,
        holiday_type = v_type,
        is_active = COALESCE(p_is_active, TRUE),
        updated_at = pg_catalog.now()
    WHERE id = p_holiday_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'HOLIDAY_UPDATED',
        'holidays',
        p_holiday_id,
        to_jsonb(v_old_row),
        to_jsonb(v_new_row)
    );

    RETURN jsonb_build_object('success', true, 'holiday', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.update_holiday(UUID, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_holiday(UUID, DATE, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_holiday(
    p_holiday_id UUID
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
    v_org_id UUID;
    v_old_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can delete holidays.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to manage holidays.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.holidays
    WHERE id = p_holiday_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Holiday not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    DELETE FROM public.holidays WHERE id = p_holiday_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'HOLIDAY_DELETED',
        'holidays',
        p_holiday_id,
        to_jsonb(v_old_row),
        NULL
    );

    RETURN jsonb_build_object('success', true, 'deleted_id', p_holiday_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_holiday(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_holiday(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.import_holiday_template(
    p_template_code TEXT,
    p_year INTEGER
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
    v_org_id UUID;
    v_tpl RECORD;
    v_target_date DATE;
    v_inserted INTEGER := 0;
    v_skipped INTEGER := 0;
    v_row_id UUID;
    v_code TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can import holiday templates.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to import holiday templates.' USING ERRCODE = '42501';
    END IF;

    v_code := pg_catalog.btrim(COALESCE(p_template_code, ''));
    IF p_year IS NULL OR p_year < 2000 OR p_year > 2100 THEN
        RAISE EXCEPTION 'Invalid target year for holiday template import.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.holiday_templates
        WHERE template_code = v_code
    ) THEN
        RAISE EXCEPTION 'Unknown holiday template code: %', v_code USING ERRCODE = '22023';
    END IF;

    v_org_id := public.current_org_id();

    FOR v_tpl IN
        SELECT *
        FROM public.holiday_templates
        WHERE template_code = v_code
          AND (template_year IS NULL OR template_year = p_year)
        ORDER BY month_num, day_num
    LOOP
        BEGIN
            v_target_date := pg_catalog.make_date(p_year, v_tpl.month_num, v_tpl.day_num);
        EXCEPTION WHEN OTHERS THEN
            v_skipped := v_skipped + 1;
            CONTINUE;
        END;

        v_row_id := NULL;
        INSERT INTO public.holidays (
            organization_id, date, name, local_name, region, holiday_type, is_active, updated_at
        ) VALUES (
            v_org_id, v_target_date, v_tpl.name, v_tpl.local_name, v_tpl.region_code, v_tpl.holiday_type, TRUE, pg_catalog.now()
        )
        ON CONFLICT (organization_id, date) DO NOTHING
        RETURNING id INTO v_row_id;

        IF v_row_id IS NOT NULL THEN
            v_inserted := v_inserted + 1;
        ELSE
            v_skipped := v_skipped + 1;
        END IF;
    END LOOP;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'HOLIDAY_TEMPLATE_IMPORTED',
        'holidays',
        v_org_id,
        NULL,
        jsonb_build_object(
            'template_code', v_code,
            'year', p_year,
            'inserted_count', v_inserted,
            'skipped_count', v_skipped
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'template_code', v_code,
        'year', p_year,
        'inserted_count', v_inserted,
        'skipped_count', v_skipped
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_holiday_template(TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.import_holiday_template(TEXT, INTEGER) TO authenticated;

-- ============================================================================
-- 5. APPROVAL DELEGATIONS & NOTIFICATION-EMITTING WORKFLOW RPCS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.approval_delegations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    delegator_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    delegate_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    starts_on DATE NOT NULL,
    ends_on DATE NOT NULL,
    reason TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    revoked_at TIMESTAMPTZ,
    revoked_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_approval_delegations_not_self CHECK (delegator_id <> delegate_id),
    CONSTRAINT chk_approval_delegations_dates CHECK (ends_on >= starts_on)
);

CREATE INDEX IF NOT EXISTS idx_approval_delegations_lookup
    ON public.approval_delegations (organization_id, delegator_id, delegate_id, starts_on, ends_on)
    WHERE is_active = TRUE AND revoked_at IS NULL;

REVOKE ALL ON TABLE public.approval_delegations FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.approval_delegations TO authenticated;

ALTER TABLE public.approval_delegations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enforce_active_org_membership_approval_delegations" ON public.approval_delegations;
DROP POLICY IF EXISTS "enforce_mfa_aal2_approval_delegations" ON public.approval_delegations;
DROP POLICY IF EXISTS "approval_delegations_select_policy" ON public.approval_delegations;

CREATE POLICY "enforce_active_org_membership_approval_delegations" ON public.approval_delegations
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_approval_delegations" ON public.approval_delegations
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "approval_delegations_select_policy" ON public.approval_delegations
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            delegator_id = (SELECT auth.uid())
            OR delegate_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
        )
    );

CREATE OR REPLACE FUNCTION public.can_approve_for(
    p_approver_id UUID,
    p_employee_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_approver_org UUID;
    v_approver_role TEXT;
    v_emp_org UUID;
    v_emp_manager UUID;
BEGIN
    IF p_approver_id IS NULL OR p_employee_id IS NULL OR p_approver_id = p_employee_id THEN
        RETURN FALSE;
    END IF;

    SELECT om.organization_id, om.role
    INTO v_approver_org, v_approver_role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = p_approver_id
      AND om.status = 'active'
      AND o.status IN ('active', 'trial')
    LIMIT 1;

    IF v_approver_org IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT e.organization_id, e.manager_id
    INTO v_emp_org, v_emp_manager
    FROM public.employees e
    WHERE e.id = p_employee_id;

    IF v_emp_org IS NULL OR v_emp_org IS DISTINCT FROM v_approver_org THEN
        RETURN FALSE;
    END IF;

    IF v_approver_role IN ('hr', 'admin') THEN
        RETURN TRUE;
    END IF;

    IF v_approver_role = 'manager' AND v_emp_manager = p_approver_id THEN
        RETURN TRUE;
    END IF;

    IF v_emp_manager IS NOT NULL AND EXISTS (
        SELECT 1
        FROM public.approval_delegations d
        JOIN public.organization_members mgr_om
          ON mgr_om.user_id = d.delegator_id
         AND mgr_om.organization_id = d.organization_id
         AND mgr_om.status = 'active'
        WHERE d.organization_id = v_approver_org
          AND d.delegator_id = v_emp_manager
          AND d.delegate_id = p_approver_id
          AND d.is_active = TRUE
          AND d.revoked_at IS NULL
          AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on
    ) THEN
        RETURN TRUE;
    END IF;

    RETURN FALSE;
END;
$$;

-- RLS-safe delegation check bound strictly to auth.uid() (never takes arbitrary approver UUID)
CREATE OR REPLACE FUNCTION public.is_active_delegated_approver(
    p_delegator_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR p_delegator_id IS NULL OR v_caller_id = p_delegator_id THEN
        RETURN FALSE;
    END IF;

    IF NOT public.is_active_org_member() THEN
        RETURN FALSE;
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL THEN
        RETURN FALSE;
    END IF;

    RETURN EXISTS (
        SELECT 1
        FROM public.approval_delegations d
        JOIN public.organization_members mgr_om
          ON mgr_om.user_id = d.delegator_id
         AND mgr_om.organization_id = d.organization_id
         AND mgr_om.status = 'active'
        JOIN public.organizations o
          ON o.id = d.organization_id
         AND o.status IN ('active', 'trial')
        WHERE d.organization_id = v_caller_org
          AND d.delegator_id = p_delegator_id
          AND d.delegate_id = v_caller_id
          AND d.is_active = TRUE
          AND d.revoked_at IS NULL
          AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on
    );
END;
$$;

REVOKE ALL ON FUNCTION public.is_active_delegated_approver(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_active_delegated_approver(UUID) TO authenticated;

-- Update SELECT policies so delegates can read team employees, leave_requests, and regularization_requests
DROP POLICY IF EXISTS "employees_select_policy" ON public.employees;
CREATE POLICY "employees_select_policy" ON public.employees
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            id = (SELECT auth.uid())
            OR manager_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR (SELECT public.is_active_delegated_approver(manager_id))
        )
    );

DROP POLICY IF EXISTS "leave_requests_select_policy" ON public.leave_requests;
CREATE POLICY "leave_requests_select_policy" ON public.leave_requests
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            employee_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR EXISTS (
                SELECT 1
                FROM public.employees e
                WHERE e.id = leave_requests.employee_id
                  AND e.organization_id = leave_requests.organization_id
                  AND (
                      e.manager_id = (SELECT auth.uid())
                      OR (SELECT public.is_active_delegated_approver(e.manager_id))
                  )
            )
        )
    );

DROP POLICY IF EXISTS "regularization_requests_select_policy" ON public.regularization_requests;
CREATE POLICY "regularization_requests_select_policy" ON public.regularization_requests
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            employee_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR EXISTS (
                SELECT 1
                FROM public.employees e
                WHERE e.id = regularization_requests.employee_id
                  AND e.organization_id = regularization_requests.organization_id
                  AND (
                      e.manager_id = (SELECT auth.uid())
                      OR (SELECT public.is_active_delegated_approver(e.manager_id))
                  )
            )
        )
    );

CREATE OR REPLACE FUNCTION public.create_approval_delegation(
    p_manager_id UUID,
    p_delegate_id UUID,
    p_starts_on DATE,
    p_ends_on DATE,
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
    v_org_id UUID;
    v_manager_id UUID;
    v_manager_role TEXT;
    v_reason TEXT;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_org_id := public.current_org_id();

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin delegation management.' USING ERRCODE = '42501';
        END IF;
        v_manager_id := COALESCE(p_manager_id, v_caller_id);
    ELSIF v_caller_role = 'manager' THEN
        IF p_manager_id IS NOT NULL AND p_manager_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only delegate their own approvals.' USING ERRCODE = '42501';
        END IF;
        v_manager_id := v_caller_id;
    ELSE
        RAISE EXCEPTION 'Forbidden: Employees cannot create approval delegations.' USING ERRCODE = '42501';
    END IF;

    IF p_delegate_id IS NULL OR p_starts_on IS NULL OR p_ends_on IS NULL THEN
        RAISE EXCEPTION 'Delegate and valid start/end dates are required.' USING ERRCODE = '22023';
    END IF;

    IF v_manager_id = p_delegate_id THEN
        RAISE EXCEPTION 'Self-delegation is not allowed.' USING ERRCODE = '22023';
    END IF;

    IF p_ends_on < p_starts_on THEN
        RAISE EXCEPTION 'Delegation end date must be on or after start date.' USING ERRCODE = '22023';
    END IF;

    SELECT om.role INTO v_manager_role
    FROM public.organization_members om
    WHERE om.user_id = v_manager_id
      AND om.organization_id = v_org_id
      AND om.status = 'active';

    IF v_manager_role IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Delegator must be an active member of caller organization.' USING ERRCODE = '42501';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.organization_members om
        JOIN public.employees e ON e.id = om.user_id AND e.organization_id = om.organization_id
        WHERE om.user_id = p_delegate_id
          AND om.organization_id = v_org_id
          AND om.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Delegate must be an active member of caller organization.' USING ERRCODE = '42501';
    END IF;

    v_reason := NULLIF(pg_catalog.btrim(COALESCE(p_reason, '')), '');

    INSERT INTO public.approval_delegations (
        organization_id, delegator_id, delegate_id, starts_on, ends_on, reason, created_by
    ) VALUES (
        v_org_id, v_manager_id, p_delegate_id, p_starts_on, p_ends_on, v_reason, v_caller_id
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'APPROVAL_DELEGATION_CREATED',
        'approval_delegations',
        v_row.id,
        NULL,
        to_jsonb(v_row)
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_org_id,
        p_delegate_id,
        'delegation',
        'Approval Authority Delegated',
        'You have been assigned approval coverage from ' || p_starts_on::text || ' through ' || p_ends_on::text || '.',
        '/requests',
        jsonb_build_object('delegation_id', v_row.id, 'delegator_id', v_manager_id, 'starts_on', p_starts_on, 'ends_on', p_ends_on)
    );

    RETURN jsonb_build_object('success', true, 'delegation', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.create_approval_delegation(UUID, UUID, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_approval_delegation(UUID, UUID, DATE, DATE, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_approval_delegation(
    p_delegation_id UUID
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
    v_org_id UUID;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.approval_delegations
    WHERE id = p_delegation_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Approval delegation not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin delegation management.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role = 'manager' THEN
        IF v_old_row.delegator_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only revoke their own delegations.' USING ERRCODE = '42501';
        END IF;
    ELSE
        RAISE EXCEPTION 'Forbidden: Insufficient permissions to revoke delegations.' USING ERRCODE = '42501';
    END IF;

    IF NOT v_old_row.is_active THEN
        RETURN jsonb_build_object('success', true, 'already_revoked', true, 'delegation', to_jsonb(v_old_row));
    END IF;

    UPDATE public.approval_delegations
    SET is_active = FALSE,
        revoked_at = pg_catalog.now(),
        revoked_by = v_caller_id,
        updated_at = pg_catalog.now()
    WHERE id = p_delegation_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'APPROVAL_DELEGATION_REVOKED',
        'approval_delegations',
        p_delegation_id,
        to_jsonb(v_old_row),
        to_jsonb(v_new_row)
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_org_id,
        v_new_row.delegate_id,
        'delegation',
        'Approval Delegation Ended',
        'Your approval delegation (' || v_new_row.starts_on::text || ' to ' || v_new_row.ends_on::text || ') has been revoked.',
        '/requests',
        jsonb_build_object('delegation_id', p_delegation_id, 'revoked_by', v_caller_id)
    );

    RETURN jsonb_build_object('success', true, 'delegation', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_approval_delegation(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_approval_delegation(UUID) TO authenticated;

-- Upgrade workflow RPCs to emit notifications and use can_approve_for()
CREATE OR REPLACE FUNCTION public.approve_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL OR v_req.organization_id IS DISTINCT FROM v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status IS DISTINCT FROM 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot approve your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization approval.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to approve requests for this employee.';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE organization_id = v_req.organization_id
          AND employee_id = v_req.employee_id
          AND work_date = v_req.work_date
          AND locked = TRUE
    ) THEN
        RAISE EXCEPTION 'Cannot approve regularization: attendance day % is locked.', v_req.work_date USING ERRCODE = '22023';
    END IF;

    v_old_data := to_jsonb(v_req);

    UPDATE public.regularization_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id
    RETURNING to_jsonb(regularization_requests.*) INTO v_new_data;

    INSERT INTO public.attendance_sessions (
        organization_id, employee_id, work_date, check_in_at, check_out_at, source, note
    ) VALUES (
        v_req.organization_id, v_req.employee_id, v_req.work_date, v_req.requested_in, v_req.requested_out, 'manual',
        'Regularized: ' || COALESCE(v_req.reason, '')
    );

    PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_req.organization_id, v_caller_id, 'REGULARIZATION_APPROVED', 'regularization_requests', p_request_id,
        v_old_data, v_new_data
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_req.organization_id,
        v_req.employee_id,
        'request_status',
        'Regularization Approved',
        'Your attendance regularization for ' || v_req.work_date::text || ' was approved.',
        '/attendance',
        jsonb_build_object('request_id', p_request_id, 'work_date', v_req.work_date, 'status', 'approved')
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_regularization(
    p_request_id UUID,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_req RECORD;
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_caller_org UUID;
    v_old_data JSONB;
    v_new_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id;

    IF v_req.id IS NULL THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request not found');
    END IF;

    v_caller_org := public.current_org_id();
    IF v_caller_org IS NULL OR v_req.organization_id IS DISTINCT FROM v_caller_org THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request does not belong to your organization');
    END IF;

    IF v_req.status IS DISTINCT FROM 'pending' THEN
        RETURN jsonb_build_object('success', false, 'error', 'Request is not pending');
    END IF;

    IF v_caller_id = v_req.employee_id THEN
        RAISE EXCEPTION 'Separation of duties violation: You cannot reject your own regularization request.';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for administrative regularization review.';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_req.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You do not have permission to review requests for this employee.';
    END IF;

    v_old_data := to_jsonb(v_req);

    UPDATE public.regularization_requests
    SET status = 'rejected',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = p_review_note
    WHERE id = p_request_id
    RETURNING to_jsonb(regularization_requests.*) INTO v_new_data;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (v_req.organization_id, v_caller_id, 'REGULARIZATION_REJECTED', 'regularization_requests', p_request_id, v_old_data, v_new_data);

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_req.organization_id,
        v_req.employee_id,
        'request_status',
        'Regularization Declined',
        'Your attendance regularization for ' || v_req.work_date::text || ' was declined.' || CASE WHEN NULLIF(pg_catalog.btrim(COALESCE(p_review_note, '')), '') IS NOT NULL THEN ' Note: ' || pg_catalog.btrim(p_review_note) ELSE '' END,
        '/requests',
        jsonb_build_object('request_id', p_request_id, 'work_date', v_req.work_date, 'status', 'rejected')
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

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
    v_emp_name TEXT;
    v_manager_id UUID;
    v_notified_ids UUID[] := ARRAY[]::UUID[];
    v_hr_id UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_start_date > p_end_date THEN
        RAISE EXCEPTION 'Invalid date range: start_date must be before or equal to end_date.' USING ERRCODE = '22023';
    END IF;

    IF p_day_part NOT IN ('full', 'first_half', 'second_half') THEN
        RAISE EXCEPTION 'Invalid day_part: must be full, first_half, or second_half.' USING ERRCODE = '22023';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.leave_types
        WHERE id = p_leave_type_id AND organization_id = v_caller_org AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Invalid or inactive leave type for caller organization.' USING ERRCODE = '22023';
    END IF;

    v_total_days := public.calculate_working_days(v_caller_id, p_start_date, p_end_date, p_day_part);
    IF v_total_days <= 0 THEN
        RAISE EXCEPTION 'Selected date range contains 0 working days (all dates are holidays or weekly offs).' USING ERRCODE = '22023';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, p_start_date);

    SELECT * INTO v_balance
    FROM public.leave_balances
    WHERE organization_id = v_caller_org
      AND employee_id = v_caller_id
      AND leave_type_id = p_leave_type_id
      AND period_start = v_p_start
      AND period_end = v_p_end
    FOR UPDATE;

    SELECT * INTO v_policy
    FROM public.leave_policies
    WHERE organization_id = v_caller_org
      AND leave_type_id = p_leave_type_id;

    IF v_balance IS NOT NULL THEN
        IF (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_total_days THEN
            RAISE EXCEPTION 'Insufficient leave balance. Available: %, Requested: %',
                (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used), v_total_days
                USING ERRCODE = '22023';
        END IF;
    END IF;

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

    SELECT full_name, manager_id INTO v_emp_name, v_manager_id
    FROM public.employees WHERE id = v_caller_id;

    IF v_manager_id IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = v_manager_id AND organization_id = v_caller_org AND status = 'active'
    ) THEN
        v_notified_ids := array_append(v_notified_ids, v_manager_id);
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            v_caller_org,
            v_manager_id,
            'leave_requested',
            'Leave Request Pending Review',
            COALESCE(v_emp_name, 'Employee') || ' requested ' || v_total_days || ' day(s) of leave (' || p_start_date::text || ' to ' || p_end_date::text || ').',
            '/requests',
            jsonb_build_object('request_id', v_request_id, 'employee_id', v_caller_id, 'total_days', v_total_days)
        );
    END IF;

    -- Also notify active delegates of the manager if any
    IF v_manager_id IS NOT NULL THEN
        FOR v_hr_id IN
            SELECT DISTINCT d.delegate_id
            FROM public.approval_delegations d
            JOIN public.organization_members om ON om.user_id = d.delegate_id AND om.organization_id = v_caller_org AND om.status = 'active'
            WHERE d.organization_id = v_caller_org
              AND d.delegator_id = v_manager_id
              AND d.is_active = TRUE
              AND d.revoked_at IS NULL
              AND CURRENT_DATE BETWEEN d.starts_on AND d.ends_on
              AND d.delegate_id <> v_caller_id
        LOOP
            IF NOT (v_hr_id = ANY(v_notified_ids)) THEN
                v_notified_ids := array_append(v_notified_ids, v_hr_id);
                INSERT INTO public.notifications (
                    organization_id, user_id, type, title, body, link, metadata
                ) VALUES (
                    v_caller_org,
                    v_hr_id,
                    'leave_requested',
                    'Delegated Leave Request Pending',
                    COALESCE(v_emp_name, 'Employee') || ' submitted leave (' || p_start_date::text || ' to ' || p_end_date::text || ') under your approval delegation.',
                    '/requests',
                    jsonb_build_object('request_id', v_request_id, 'employee_id', v_caller_id, 'delegated', true)
                );
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object('success', true, 'request_id', v_request_id, 'total_days', v_total_days);
END;
$$;

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
    v_punched BOOLEAN;
    v_locked BOOLEAN;
    v_other_approvers_count INTEGER := 0;
    v_has_active_manager BOOLEAN := FALSE;
    v_sole_admin_fallback BOOLEAN := FALSE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Leave request cannot be approved: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_target_emp
    FROM public.employees
    WHERE id = v_request.employee_id;

    -- Separation of duties with single-admin organization founder fallback
    IF v_request.employee_id = v_caller_id THEN
        IF v_caller_role = 'admin' THEN
            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 verification required for sole-admin leave approval fallback.' USING ERRCODE = '42501';
            END IF;

            SELECT COUNT(*) INTO v_other_approvers_count
            FROM public.organization_members
            WHERE organization_id = v_caller_org
              AND user_id IS DISTINCT FROM v_caller_id
              AND status = 'active'
              AND role IN ('admin', 'hr');

            IF v_target_emp.manager_id IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.organization_members
                    WHERE organization_id = v_caller_org
                      AND user_id = v_target_emp.manager_id
                      AND status = 'active'
                ) INTO v_has_active_manager;
            END IF;

            IF v_other_approvers_count = 0 AND NOT v_has_active_manager THEN
                v_sole_admin_fallback := TRUE;
            ELSE
                RAISE EXCEPTION 'Separation of duties: You cannot approve your own leave request.' USING ERRCODE = '42501';
            END IF;
        ELSE
            RAISE EXCEPTION 'Separation of duties: You cannot approve your own leave request.' USING ERRCODE = '42501';
        END IF;
    ELSE
        IF v_caller_role IN ('hr', 'admin') THEN
            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave approval.' USING ERRCODE = '42501';
            END IF;
        ELSIF NOT public.can_approve_for(v_caller_id, v_request.employee_id) THEN
            RAISE EXCEPTION 'Forbidden: You are not authorized or delegated to approve leave for this employee.' USING ERRCODE = '42501';
        END IF;
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.attendance_days
        WHERE organization_id = v_caller_org
          AND employee_id = v_request.employee_id
          AND work_date BETWEEN v_request.start_date AND v_request.end_date
          AND locked = TRUE
    ) INTO v_locked;

    IF v_locked THEN
        RAISE EXCEPTION 'Cannot approve leave: includes locked month dates.' USING ERRCODE = '22023';
    END IF;

    IF v_target_emp.primary_location_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs
        FROM public.locations
        WHERE id = v_target_emp.primary_location_id;
    END IF;
    IF v_weekly_offs IS NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs
        FROM public.attendance_policies
        WHERE organization_id = v_caller_org LIMIT 1;
    END IF;
    IF v_weekly_offs IS NULL THEN
        v_weekly_offs := '{0, 6}'::INTEGER[];
    END IF;

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

    UPDATE public.leave_requests
    SET status = 'approved',
        reviewed_by = v_caller_id,
        reviewed_at = pg_catalog.now(),
        review_note = COALESCE(p_review_note, CASE WHEN v_sole_admin_fallback THEN 'Auto-approved via sole-admin organization fallback' ELSE NULL END),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    v_curr := v_request.start_date;
    WHILE v_curr <= v_request.end_date LOOP
        PERFORM public.recalculate_day(v_request.employee_id, v_curr);
        v_curr := v_curr + 1;
    END LOOP;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_APPROVED', 'leave_requests', p_request_id,
        jsonb_build_object('status', 'pending'),
        jsonb_build_object(
            'status', 'approved',
            'total_days', v_request.total_days,
            'reviewed_by', v_caller_id,
            'sole_admin_fallback', v_sole_admin_fallback
        )
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_caller_org,
        v_request.employee_id,
        'leave_status',
        'Leave Request Approved',
        'Your leave request from ' || v_request.start_date::text || ' to ' || v_request.end_date::text || ' has been approved.',
        '/leave',
        jsonb_build_object('request_id', p_request_id, 'status', 'approved', 'reviewed_by', v_caller_id)
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'approved', 'sole_admin_fallback', v_sole_admin_fallback);
END;
$$;

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
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Leave request cannot be rejected: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    IF v_request.employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: You cannot reject your own leave request.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for elevated leave rejection.' USING ERRCODE = '42501';
        END IF;
    ELSIF NOT public.can_approve_for(v_caller_id, v_request.employee_id) THEN
        RAISE EXCEPTION 'Forbidden: You are not authorized or delegated to reject leave for this employee.' USING ERRCODE = '42501';
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

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_caller_org,
        v_request.employee_id,
        'leave_status',
        'Leave Request Declined',
        'Your leave request from ' || v_request.start_date::text || ' to ' || v_request.end_date::text || ' was declined.' || CASE WHEN NULLIF(pg_catalog.btrim(COALESCE(p_review_note, '')), '') IS NOT NULL THEN ' Reason: ' || pg_catalog.btrim(p_review_note) ELSE '' END,
        '/leave',
        jsonb_build_object('request_id', p_request_id, 'status', 'rejected', 'reviewed_by', v_caller_id)
    );

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'rejected');
END;
$$;

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
    v_was_approved BOOLEAN;
    v_curr DATE;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL OR v_request.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Leave request not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF v_request.employee_id IS DISTINCT FROM v_caller_id THEN
        IF v_caller_role NOT IN ('hr', 'admin') THEN
            RAISE EXCEPTION 'Forbidden: You cannot cancel another employee leave request.' USING ERRCODE = '42501';
        END IF;

        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required to cancel employee leave.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_request.status NOT IN ('pending', 'approved') THEN
        RAISE EXCEPTION 'Leave request cannot be cancelled: current status is %.', v_request.status USING ERRCODE = '22023';
    END IF;

    v_was_approved := (v_request.status = 'approved');

    IF v_was_approved THEN
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = v_caller_org
              AND employee_id = v_request.employee_id
              AND work_date BETWEEN v_request.start_date AND v_request.end_date
              AND locked = TRUE
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot cancel leave: touches locked month dates.' USING ERRCODE = '22023';
        END IF;

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
    END IF;

    UPDATE public.leave_requests
    SET status = 'cancelled',
        cancelled_at = pg_catalog.now(),
        review_note = COALESCE(p_reason, review_note),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id;

    IF v_was_approved THEN
        v_curr := v_request.start_date;
        WHILE v_curr <= v_request.end_date LOOP
            PERFORM public.recalculate_day(v_request.employee_id, v_curr);
            v_curr := v_curr + 1;
        END LOOP;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org, v_caller_id, 'LEAVE_CANCELLED', 'leave_requests', p_request_id,
        jsonb_build_object('status', v_request.status),
        jsonb_build_object('status', 'cancelled', 'cancelled_by', v_caller_id, 'reason', p_reason)
    );

    IF v_request.employee_id IS DISTINCT FROM v_caller_id THEN
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            v_caller_org,
            v_request.employee_id,
            'leave_status',
            'Leave Request Cancelled',
            'Your leave (' || v_request.start_date::text || ' to ' || v_request.end_date::text || ') was cancelled by HR/Admin.',
            '/leave',
            jsonb_build_object('request_id', p_request_id, 'status', 'cancelled', 'cancelled_by', v_caller_id)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'request_id', p_request_id, 'status', 'cancelled');
END;
$$;



-- ============================================================================
-- Migration 13: Section 2 - Retention, Archival & Admin System Health
-- ============================================================================
-- Covers:
-- 1. `public.retention_policies` (per-organization retention settings with enforced
--    floors: >= 18 months attendance_sessions once attendance_days are locked,
--    >= 24 months audit_logs, >= 90 days read notifications) + default backfill & trigger.
-- 2. `public.retention_archives` manifest table + optional `archive_id` pointer on
--    `public.attendance_sessions` (no JSON blobs stored in Postgres) + private
--    `'retention-archives'` Storage bucket & admin-scoped storage RLS.
-- 3. `public.run_retention_cleanup(dry_run boolean default true)` (batched 500 rows,
--    idempotent, verifies locked attendance_days AND storage archive existence BEFORE
--    deleting attendance_sessions, deletes audit_logs & read notifications in 500-row
--    batches, logs RETENTION_CLEANUP_EXECUTED, scheduled weekly via pg_cron).
-- 4. Server-only (`service_role`) archival batch & manifest RPCs:
--    `get_retention_export_batches`, `record_retention_archive`, `run_org_retention_cleanup`.
-- 5. Admin-only AAL2 RPCs: `admin_update_retention_policy`, `get_org_system_health`
--    (strictly tenant-scoped row counts & approximate org storage — never platform DB size),
--    and `get_org_retention_preview`.
-- ============================================================================

-- ============================================================================
-- 1. TABLES & STORAGE BUCKET
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.retention_policies (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    sessions_archive_after_months INTEGER NOT NULL DEFAULT 18
        CHECK (sessions_archive_after_months >= 18 AND sessions_archive_after_months <= 120),
    audit_logs_delete_after_months INTEGER NOT NULL DEFAULT 24
        CHECK (audit_logs_delete_after_months >= 24 AND audit_logs_delete_after_months <= 120),
    read_notifications_delete_after_days INTEGER NOT NULL DEFAULT 90
        CHECK (read_notifications_delete_after_days >= 90 AND read_notifications_delete_after_days <= 3650),
    updated_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Backfill every existing organization
INSERT INTO public.retention_policies (organization_id)
SELECT id FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;

-- Auto-initialize retention_policies whenever a new organization is created
CREATE OR REPLACE FUNCTION public.trg_init_org_retention_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.retention_policies (organization_id)
    VALUES (NEW.id)
    ON CONFLICT (organization_id) DO NOTHING;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_init_org_retention_policy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS init_org_retention_policy_after_insert ON public.organizations;
CREATE TRIGGER init_org_retention_policy_after_insert
    AFTER INSERT ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.trg_init_org_retention_policy();

-- Compact archive manifest table (zero blobs in Postgres; points to Storage .json.gz)
CREATE TABLE IF NOT EXISTS public.retention_archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    archive_month TEXT NOT NULL CHECK (archive_month ~ '^\d{4}-\d{2}$'),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL CHECK (period_end >= period_start),
    storage_bucket TEXT NOT NULL DEFAULT 'retention-archives' CHECK (storage_bucket = 'retention-archives'),
    storage_path TEXT NOT NULL,
    row_count INTEGER NOT NULL CHECK (row_count > 0),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    checksum_sha256 TEXT NOT NULL CHECK (char_length(checksum_sha256) = 64),
    cutoff_at TIMESTAMPTZ NOT NULL,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_retention_archives_org_path UNIQUE (organization_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_retention_archives_org_month
    ON public.retention_archives (organization_id, archive_month DESC, created_at DESC);

ALTER TABLE public.attendance_sessions
    ADD COLUMN IF NOT EXISTS archive_id UUID REFERENCES public.retention_archives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_retention
    ON public.attendance_sessions (organization_id, work_date, id)
    WHERE archive_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_archived_ready
    ON public.attendance_sessions (organization_id, archive_id, work_date, id)
    WHERE archive_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_retention
    ON public.audit_logs (organization_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_notifications_read_retention
    ON public.notifications (organization_id, read_at, id)
    WHERE read_at IS NOT NULL;

-- Strict table grants (RPC-only writes; SELECT only for authenticated under RLS)
REVOKE ALL ON TABLE public.retention_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.retention_policies TO authenticated;

REVOKE ALL ON TABLE public.retention_archives FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.retention_archives TO authenticated;

ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enforce_active_org_membership_retention_policies" ON public.retention_policies;
DROP POLICY IF EXISTS "enforce_mfa_aal2_retention_policies" ON public.retention_policies;
DROP POLICY IF EXISTS "retention_policies_select_policy" ON public.retention_policies;

CREATE POLICY "enforce_active_org_membership_retention_policies" ON public.retention_policies
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_retention_policies" ON public.retention_policies
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "retention_policies_select_policy" ON public.retention_policies
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (SELECT public.current_user_role()) = 'admin'
    );

DROP POLICY IF EXISTS "enforce_active_org_membership_retention_archives" ON public.retention_archives;
DROP POLICY IF EXISTS "enforce_mfa_aal2_retention_archives" ON public.retention_archives;
DROP POLICY IF EXISTS "retention_archives_select_policy" ON public.retention_archives;

CREATE POLICY "enforce_active_org_membership_retention_archives" ON public.retention_archives
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_retention_archives" ON public.retention_archives
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "retention_archives_select_policy" ON public.retention_archives
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (SELECT public.current_user_role()) = 'admin'
    );

-- Private Storage bucket for compressed monthly JSON session archives
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'retention-archives',
    'retention-archives',
    FALSE,
    52428800,
    ARRAY['application/gzip', 'application/x-gzip', 'application/json']
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/gzip', 'application/x-gzip', 'application/json'];

DROP POLICY IF EXISTS "retention_archives_bucket_select_policy" ON storage.objects;

-- Only active AAL2 administrators of the matching organization can read their own archive objects
CREATE POLICY "retention_archives_bucket_select_policy" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'retention-archives'
        AND (storage.foldername(name))[1] = (SELECT public.current_org_id())::text
        AND (SELECT public.is_active_org_member())
        AND (SELECT public.current_user_role()) = 'admin'
        AND COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2'
    );

-- ============================================================================
-- 2. ADMIN RPCs (POLICY UPDATE, SYSTEM HEALTH, DRY-RUN PREVIEW)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_retention_policy(
    p_sessions_months INTEGER,
    p_audit_logs_months INTEGER,
    p_notifications_days INTEGER
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
    v_org_id UUID;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can update retention settings.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for retention policy administration.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    IF p_sessions_months IS NULL OR p_sessions_months < 18 OR p_sessions_months > 120 THEN
        RAISE EXCEPTION 'Invalid retention floor: attendance_sessions retention must be between 18 and 120 months.' USING ERRCODE = '22023';
    END IF;

    IF p_audit_logs_months IS NULL OR p_audit_logs_months < 24 OR p_audit_logs_months > 120 THEN
        RAISE EXCEPTION 'Invalid retention floor: audit_logs retention must be between 24 and 120 months.' USING ERRCODE = '22023';
    END IF;

    IF p_notifications_days IS NULL OR p_notifications_days < 90 OR p_notifications_days > 3650 THEN
        RAISE EXCEPTION 'Invalid retention floor: read notifications retention must be between 90 and 3650 days.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.retention_policies (organization_id)
    VALUES (v_org_id)
    ON CONFLICT (organization_id) DO NOTHING;

    SELECT * INTO v_old_row
    FROM public.retention_policies
    WHERE organization_id = v_org_id
    FOR UPDATE;

    UPDATE public.retention_policies
    SET sessions_archive_after_months = p_sessions_months,
        audit_logs_delete_after_months = p_audit_logs_months,
        read_notifications_delete_after_days = p_notifications_days,
        updated_by = v_caller_id,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'RETENTION_POLICY_UPDATED',
        'retention_policies',
        v_org_id,
        to_jsonb(v_old_row),
        to_jsonb(v_new_row)
    );

    RETURN jsonb_build_object('success', true, 'policy', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_retention_policy(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_retention_policy(INTEGER, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_org_system_health()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
    v_emp_cnt BIGINT := 0; v_emp_bytes BIGINT := 0;
    v_mem_cnt BIGINT := 0; v_mem_bytes BIGINT := 0;
    v_dept_cnt BIGINT := 0; v_dept_bytes BIGINT := 0;
    v_loc_cnt BIGINT := 0; v_loc_bytes BIGINT := 0;
    v_shift_cnt BIGINT := 0; v_shift_bytes BIGINT := 0;
    v_sess_cnt BIGINT := 0; v_sess_bytes BIGINT := 0;
    v_day_cnt BIGINT := 0; v_day_bytes BIGINT := 0;
    v_reg_cnt BIGINT := 0; v_reg_bytes BIGINT := 0;
    v_lt_cnt BIGINT := 0; v_lt_bytes BIGINT := 0;
    v_lb_cnt BIGINT := 0; v_lb_bytes BIGINT := 0;
    v_lr_cnt BIGINT := 0; v_lr_bytes BIGINT := 0;
    v_hol_cnt BIGINT := 0; v_hol_bytes BIGINT := 0;
    v_notif_cnt BIGINT := 0; v_notif_bytes BIGINT := 0;
    v_audit_cnt BIGINT := 0; v_audit_bytes BIGINT := 0;
    v_arch_cnt BIGINT := 0; v_arch_meta_bytes BIGINT := 0;
    v_arch_storage_bytes BIGINT := 0;
    v_total_rows BIGINT := 0;
    v_estimated_db_bytes BIGINT := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can view system health metrics.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to view system health.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    -- Strictly measure THIS tenant's row tuples + ~64B per-row header/index overhead;
    -- NEVER inspect pg_database_size or cluster/platform totals.
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_emp_cnt, v_emp_bytes FROM public.employees t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_mem_cnt, v_mem_bytes FROM public.organization_members t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_dept_cnt, v_dept_bytes FROM public.departments t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_loc_cnt, v_loc_bytes FROM public.locations t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_shift_cnt, v_shift_bytes FROM public.shift_templates t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_sess_cnt, v_sess_bytes FROM public.attendance_sessions t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_day_cnt, v_day_bytes FROM public.attendance_days t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_reg_cnt, v_reg_bytes FROM public.regularization_requests t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_lt_cnt, v_lt_bytes FROM public.leave_types t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_lb_cnt, v_lb_bytes FROM public.leave_balances t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_lr_cnt, v_lr_bytes FROM public.leave_requests t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_hol_cnt, v_hol_bytes FROM public.holidays t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_notif_cnt, v_notif_bytes FROM public.notifications t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_audit_cnt, v_audit_bytes FROM public.audit_logs t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0), COALESCE(SUM(t.byte_size), 0)
      INTO v_arch_cnt, v_arch_meta_bytes, v_arch_storage_bytes FROM public.retention_archives t WHERE t.organization_id = v_org_id;

    v_total_rows :=
        v_emp_cnt + v_mem_cnt + v_dept_cnt + v_loc_cnt + v_shift_cnt +
        v_sess_cnt + v_day_cnt + v_reg_cnt + v_lt_cnt + v_lb_cnt +
        v_lr_cnt + v_hol_cnt + v_notif_cnt + v_audit_cnt + v_arch_cnt;

    v_estimated_db_bytes :=
        v_emp_bytes + v_mem_bytes + v_dept_bytes + v_loc_bytes + v_shift_bytes +
        v_sess_bytes + v_day_bytes + v_reg_bytes + v_lt_bytes + v_lb_bytes +
        v_lr_bytes + v_hol_bytes + v_notif_bytes + v_audit_bytes + v_arch_meta_bytes;

    RETURN jsonb_build_object(
        'organization_id', v_org_id,
        'scope', 'organization_only',
        'total_rows', v_total_rows,
        'estimated_db_bytes', v_estimated_db_bytes,
        'archive_storage_bytes', v_arch_storage_bytes,
        'tables', jsonb_build_array(
            jsonb_build_object('table_name', 'attendance_sessions', 'row_count', v_sess_cnt, 'estimated_bytes', v_sess_bytes),
            jsonb_build_object('table_name', 'attendance_days', 'row_count', v_day_cnt, 'estimated_bytes', v_day_bytes),
            jsonb_build_object('table_name', 'audit_logs', 'row_count', v_audit_cnt, 'estimated_bytes', v_audit_bytes),
            jsonb_build_object('table_name', 'notifications', 'row_count', v_notif_cnt, 'estimated_bytes', v_notif_bytes),
            jsonb_build_object('table_name', 'employees', 'row_count', v_emp_cnt, 'estimated_bytes', v_emp_bytes),
            jsonb_build_object('table_name', 'organization_members', 'row_count', v_mem_cnt, 'estimated_bytes', v_mem_bytes),
            jsonb_build_object('table_name', 'leave_requests', 'row_count', v_lr_cnt, 'estimated_bytes', v_lr_bytes),
            jsonb_build_object('table_name', 'leave_balances', 'row_count', v_lb_cnt, 'estimated_bytes', v_lb_bytes),
            jsonb_build_object('table_name', 'regularization_requests', 'row_count', v_reg_cnt, 'estimated_bytes', v_reg_bytes),
            jsonb_build_object('table_name', 'holidays', 'row_count', v_hol_cnt, 'estimated_bytes', v_hol_bytes),
            jsonb_build_object('table_name', 'departments', 'row_count', v_dept_cnt, 'estimated_bytes', v_dept_bytes),
            jsonb_build_object('table_name', 'locations', 'row_count', v_loc_cnt, 'estimated_bytes', v_loc_bytes),
            jsonb_build_object('table_name', 'shift_templates', 'row_count', v_shift_cnt, 'estimated_bytes', v_shift_bytes),
            jsonb_build_object('table_name', 'leave_types', 'row_count', v_lt_cnt, 'estimated_bytes', v_lt_bytes),
            jsonb_build_object('table_name', 'retention_archives', 'row_count', v_arch_cnt, 'estimated_bytes', v_arch_meta_bytes)
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_system_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_system_health() TO authenticated;

-- ============================================================================
-- 3. SERVICE-ROLE EXPORT BATCH & ARCHIVE RECORDING + DRY-RUN PREVIEW
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_retention_export_batches(
    p_organization_id UUID DEFAULT NULL,
    p_batch_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit INTEGER;
    v_org RECORD;
    v_sess_months INTEGER;
    v_cutoff_ts TIMESTAMPTZ;
    v_cutoff_date DATE;
    v_batches JSONB := '[]'::jsonb;
    v_month_rec RECORD;
    v_batch_json JSONB;
BEGIN
    v_limit := LEAST(GREATEST(COALESCE(p_batch_limit, 500), 1), 500);

    FOR v_org IN
        SELECT o.id,
               GREATEST(COALESCE(rp.sessions_archive_after_months, 18), 18) AS sessions_months
        FROM public.organizations o
        LEFT JOIN public.retention_policies rp ON rp.organization_id = o.id
        WHERE (p_organization_id IS NULL OR o.id = p_organization_id)
        ORDER BY o.created_at ASC
    LOOP
        v_sess_months := v_org.sessions_months;
        v_cutoff_ts := pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months);
        v_cutoff_date := v_cutoff_ts::date;

        FOR v_month_rec IN
            WITH eligible AS (
                SELECT s.id,
                       s.employee_id,
                       e.email AS employee_email,
                       e.full_name AS employee_name,
                       s.work_date,
                       pg_catalog.to_char(s.work_date, 'YYYY-MM') AS archive_month,
                       s.check_in_at,
                       s.check_out_at,
                       s.source,
                       s.note,
                       s.location_id,
                       s.created_at,
                       d.status AS day_status,
                       d.total_minutes AS day_total_minutes,
                       d.locked AS day_locked
                FROM public.attendance_sessions s
                JOIN public.attendance_days d
                  ON d.organization_id = s.organization_id
                 AND d.employee_id = s.employee_id
                 AND d.work_date = s.work_date
                LEFT JOIN public.employees e
                  ON e.id = s.employee_id
                WHERE s.organization_id = v_org.id
                  AND d.locked = TRUE
                  AND s.work_date < v_cutoff_date
                  AND s.check_in_at < v_cutoff_ts
                  AND (
                      s.archive_id IS NULL
                      OR NOT EXISTS (
                          SELECT 1
                          FROM public.retention_archives ra
                          JOIN storage.objects so
                            ON so.bucket_id = ra.storage_bucket
                           AND so.name = ra.storage_path
                          WHERE ra.id = s.archive_id
                            AND ra.organization_id = v_org.id
                      )
                  )
                ORDER BY s.work_date ASC, s.id ASC
                LIMIT v_limit
            )
            SELECT archive_month,
                   MIN(work_date) AS period_start,
                   MAX(work_date) AS period_end,
                   pg_catalog.jsonb_agg(id ORDER BY work_date ASC, id ASC) AS session_ids,
                   pg_catalog.jsonb_agg(
                       jsonb_build_object(
                           'id', id,
                           'employee_id', employee_id,
                           'employee_email', employee_email,
                           'employee_name', employee_name,
                           'work_date', work_date,
                           'check_in_at', check_in_at,
                           'check_out_at', check_out_at,
                           'source', source,
                           'note', note,
                           'location_id', location_id,
                           'day_status', day_status,
                           'day_total_minutes', day_total_minutes,
                           'day_locked', day_locked,
                           'created_at', created_at
                       )
                       ORDER BY work_date ASC, id ASC
                   ) AS sessions,
                   COUNT(*)::integer AS row_count
            FROM eligible
            GROUP BY archive_month
            ORDER BY archive_month ASC
        LOOP
            v_batch_json := jsonb_build_object(
                'organization_id', v_org.id,
                'archive_month', v_month_rec.archive_month,
                'period_start', v_month_rec.period_start,
                'period_end', v_month_rec.period_end,
                'cutoff_at', v_cutoff_ts,
                'row_count', v_month_rec.row_count,
                'session_ids', v_month_rec.session_ids,
                'sessions', v_month_rec.sessions
            );
            v_batches := v_batches || jsonb_build_array(v_batch_json);
        END LOOP;
    END LOOP;

    RETURN v_batches;
END;
$$;

REVOKE ALL ON FUNCTION public.get_retention_export_batches(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_retention_export_batches(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.record_retention_archive(
    p_organization_id UUID,
    p_archive_month TEXT,
    p_period_start DATE,
    p_period_end DATE,
    p_cutoff_at TIMESTAMPTZ,
    p_storage_path TEXT,
    p_byte_size BIGINT,
    p_checksum_sha256 TEXT,
    p_session_ids UUID[],
    p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_archive_id UUID;
    v_matched_count INTEGER := 0;
    v_sess_months INTEGER;
    v_cutoff_ts TIMESTAMPTZ;
    v_cutoff_date DATE;
    v_linked_count INTEGER := 0;
    v_row RECORD;
BEGIN
    IF p_organization_id IS NULL OR p_archive_month IS NULL OR p_storage_path IS NULL THEN
        RAISE EXCEPTION 'Organization, archive month, and storage path are required.' USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.btrim(p_archive_month) !~ '^\d{4}-\d{2}$' THEN
        RAISE EXCEPTION 'archive_month must match YYYY-MM.' USING ERRCODE = '22023';
    END IF;

    IF p_session_ids IS NULL OR pg_catalog.cardinality(p_session_ids) = 0 THEN
        RAISE EXCEPTION 'At least one eligible session ID is required to record an archive.' USING ERRCODE = '22023';
    END IF;

    IF p_byte_size IS NULL OR p_byte_size <= 0 THEN
        RAISE EXCEPTION 'Positive archive byte_size is required.' USING ERRCODE = '22023';
    END IF;

    IF p_checksum_sha256 IS NULL OR char_length(p_checksum_sha256) <> 64 THEN
        RAISE EXCEPTION '64-character SHA-256 hex checksum is required.' USING ERRCODE = '22023';
    END IF;

    -- Export-Before-Deletion proof: archive MUST already exist inside the private Storage bucket under org prefix!
    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects so
        WHERE so.bucket_id = 'retention-archives'
          AND so.name = p_storage_path
          AND (storage.foldername(so.name))[1] = p_organization_id::text
    ) THEN
        RAISE EXCEPTION 'Storage invariant violation: object "%" must exist in bucket retention-archives before recording manifest.', p_storage_path
            USING ERRCODE = '22023';
    END IF;

    SELECT GREATEST(COALESCE(rp.sessions_archive_after_months, 18), 18)
      INTO v_sess_months
    FROM public.retention_policies rp
    WHERE rp.organization_id = p_organization_id;

    v_sess_months := COALESCE(v_sess_months, 18);
    v_cutoff_ts := COALESCE(p_cutoff_at, pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months));
    -- Guarantee cutoff never violates org floor even if older timestamp passed
    IF v_cutoff_ts > (pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months)) THEN
        v_cutoff_ts := pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months);
    END IF;
    v_cutoff_date := v_cutoff_ts::date;

    SELECT COUNT(*)::integer INTO v_matched_count
    FROM public.attendance_sessions s
    JOIN public.attendance_days d
      ON d.organization_id = s.organization_id
     AND d.employee_id = s.employee_id
     AND d.work_date = s.work_date
    WHERE s.id = ANY(p_session_ids)
      AND s.organization_id = p_organization_id
      AND d.locked = TRUE
      AND pg_catalog.to_char(s.work_date, 'YYYY-MM') = p_archive_month
      AND s.work_date < v_cutoff_date
      AND s.check_in_at < v_cutoff_ts;

    IF v_matched_count = 0 THEN
        RAISE EXCEPTION 'No eligible locked old attendance_sessions matched provided IDs for archive month %.', p_archive_month
            USING ERRCODE = '22023';
    END IF;

    -- Idempotent on duplicate storage_path
    SELECT id INTO v_archive_id
    FROM public.retention_archives
    WHERE organization_id = p_organization_id
      AND storage_path = p_storage_path;

    IF v_archive_id IS NULL THEN
        INSERT INTO public.retention_archives (
            organization_id, archive_month, period_start, period_end,
            storage_bucket, storage_path, row_count, byte_size, checksum_sha256,
            cutoff_at, created_by
        ) VALUES (
            p_organization_id, p_archive_month, p_period_start, p_period_end,
            'retention-archives', p_storage_path, v_matched_count, p_byte_size, p_checksum_sha256,
            v_cutoff_ts, p_created_by
        )
        RETURNING * INTO v_row;

        v_archive_id := v_row.id;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            p_organization_id,
            p_created_by,
            'RETENTION_ARCHIVE_CREATED',
            'retention_archives',
            v_archive_id,
            NULL,
            to_jsonb(v_row)
        );
    END IF;

    UPDATE public.attendance_sessions s
    SET archive_id = v_archive_id
    FROM public.attendance_days d
    WHERE s.id = ANY(p_session_ids)
      AND s.organization_id = p_organization_id
      AND d.organization_id = s.organization_id
      AND d.employee_id = s.employee_id
      AND d.work_date = s.work_date
      AND d.locked = TRUE
      AND pg_catalog.to_char(s.work_date, 'YYYY-MM') = p_archive_month
      AND s.work_date < v_cutoff_date
      AND s.check_in_at < v_cutoff_ts;

    GET DIAGNOSTICS v_linked_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'archive_id', v_archive_id,
        'linked_sessions', v_linked_count,
        'storage_path', p_storage_path
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_retention_archive(UUID, TEXT, DATE, DATE, TIMESTAMPTZ, TEXT, BIGINT, TEXT, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_retention_archive(UUID, TEXT, DATE, DATE, TIMESTAMPTZ, TEXT, BIGINT, TEXT, UUID[], UUID) TO service_role;

-- Per-organization retention cleanup engine (batched 500 rows, idempotent)
CREATE OR REPLACE FUNCTION public.run_org_retention_cleanup(
    p_organization_id UUID,
    dry_run BOOLEAN DEFAULT TRUE,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_batch_size CONSTANT INTEGER := 500;
    v_max_batches CONSTANT INTEGER := 200;
    v_sess_months INTEGER := 18;
    v_audit_months INTEGER := 24;
    v_notif_days INTEGER := 90;
    v_sess_cutoff_ts TIMESTAMPTZ;
    v_sess_cutoff_date DATE;
    v_audit_cutoff TIMESTAMPTZ;
    v_notif_cutoff TIMESTAMPTZ;

    v_sessions_locked_eligible INTEGER := 0;
    v_sessions_archived_ready INTEGER := 0;
    v_sessions_unarchived_skipped INTEGER := 0;
    v_sessions_unlocked_skipped INTEGER := 0;
    v_audit_logs_eligible INTEGER := 0;
    v_notifications_eligible INTEGER := 0;
    v_notifications_unread_skipped INTEGER := 0;

    v_sessions_deleted INTEGER := 0;
    v_audits_deleted INTEGER := 0;
    v_notifs_deleted INTEGER := 0;
    v_sessions_batches INTEGER := 0;
    v_audits_batches INTEGER := 0;
    v_notifs_batches INTEGER := 0;
    v_step_deleted INTEGER := 0;
    v_batch_ids UUID[];
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'organization_id is required.' USING ERRCODE = '22023';
    END IF;

    SELECT
        GREATEST(COALESCE(rp.sessions_archive_after_months, 18), 18),
        GREATEST(COALESCE(rp.audit_logs_delete_after_months, 24), 24),
        GREATEST(COALESCE(rp.read_notifications_delete_after_days, 90), 90)
    INTO v_sess_months, v_audit_months, v_notif_days
    FROM public.organizations o
    LEFT JOIN public.retention_policies rp ON rp.organization_id = o.id
    WHERE o.id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '02000';
    END IF;

    v_sess_cutoff_ts := pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months);
    v_sess_cutoff_date := v_sess_cutoff_ts::date;
    v_audit_cutoff := pg_catalog.now() - pg_catalog.make_interval(months => v_audit_months);
    v_notif_cutoff := pg_catalog.now() - pg_catalog.make_interval(days => v_notif_days);

    -- Count attendance_sessions categories strictly scoped to p_organization_id
    SELECT
        COUNT(*) FILTER (WHERE COALESCE(d.locked, FALSE) = TRUE),
        COUNT(*) FILTER (
            WHERE COALESCE(d.locked, FALSE) = TRUE
              AND s.archive_id IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM public.retention_archives ra
                  JOIN storage.objects so
                    ON so.bucket_id = ra.storage_bucket
                   AND so.name = ra.storage_path
                  WHERE ra.id = s.archive_id
                    AND ra.organization_id = p_organization_id
              )
        ),
        COUNT(*) FILTER (WHERE COALESCE(d.locked, FALSE) = FALSE)
    INTO v_sessions_locked_eligible, v_sessions_archived_ready, v_sessions_unlocked_skipped
    FROM public.attendance_sessions s
    LEFT JOIN public.attendance_days d
      ON d.organization_id = s.organization_id
     AND d.employee_id = s.employee_id
     AND d.work_date = s.work_date
    WHERE s.organization_id = p_organization_id
      AND s.work_date < v_sess_cutoff_date
      AND s.check_in_at < v_sess_cutoff_ts;

    v_sessions_unarchived_skipped := GREATEST(0, v_sessions_locked_eligible - v_sessions_archived_ready);

    -- Count eligible audit_logs
    SELECT COUNT(*)::integer INTO v_audit_logs_eligible
    FROM public.audit_logs
    WHERE organization_id = p_organization_id
      AND created_at < v_audit_cutoff;

    -- Count eligible read notifications (and unread skipped)
    SELECT
        COUNT(*) FILTER (WHERE read_at IS NOT NULL AND read_at < v_notif_cutoff)::integer,
        COUNT(*) FILTER (WHERE read_at IS NULL AND created_at < v_notif_cutoff)::integer
    INTO v_notifications_eligible, v_notifications_unread_skipped
    FROM public.notifications
    WHERE organization_id = p_organization_id;

    IF NOT COALESCE(dry_run, TRUE) THEN
        -- Batch 1: Archived & verified attendance_sessions whose days are locked (500/batch)
        LOOP
            EXIT WHEN v_sessions_batches >= v_max_batches;

            SELECT COALESCE(pg_catalog.array_agg(batch.id), '{}'::uuid[])
            INTO v_batch_ids
            FROM (
                SELECT s.id
                FROM public.attendance_sessions s
                JOIN public.attendance_days d
                  ON d.organization_id = s.organization_id
                 AND d.employee_id = s.employee_id
                 AND d.work_date = s.work_date
                JOIN public.retention_archives ra
                  ON ra.id = s.archive_id
                 AND ra.organization_id = s.organization_id
                JOIN storage.objects so
                  ON so.bucket_id = ra.storage_bucket
                 AND so.name = ra.storage_path
                WHERE s.organization_id = p_organization_id
                  AND d.locked = TRUE
                  AND s.work_date < v_sess_cutoff_date
                  AND s.check_in_at < v_sess_cutoff_ts
                ORDER BY s.work_date ASC, s.id ASC
                LIMIT v_batch_size
            ) batch;

            EXIT WHEN pg_catalog.cardinality(v_batch_ids) = 0;

            DELETE FROM public.attendance_sessions
            WHERE organization_id = p_organization_id
              AND id = ANY(v_batch_ids);

            GET DIAGNOSTICS v_step_deleted = ROW_COUNT;
            v_sessions_deleted := v_sessions_deleted + v_step_deleted;
            v_sessions_batches := v_sessions_batches + 1;

            EXIT WHEN v_step_deleted < v_batch_size;
        END LOOP;

        -- Batch 2: Expired audit_logs (500/batch)
        LOOP
            EXIT WHEN v_audits_batches >= v_max_batches;

            SELECT COALESCE(pg_catalog.array_agg(batch.id), '{}'::uuid[])
            INTO v_batch_ids
            FROM (
                SELECT id
                FROM public.audit_logs
                WHERE organization_id = p_organization_id
                  AND created_at < v_audit_cutoff
                ORDER BY created_at ASC, id ASC
                LIMIT v_batch_size
            ) batch;

            EXIT WHEN pg_catalog.cardinality(v_batch_ids) = 0;

            DELETE FROM public.audit_logs
            WHERE organization_id = p_organization_id
              AND id = ANY(v_batch_ids);

            GET DIAGNOSTICS v_step_deleted = ROW_COUNT;
            v_audits_deleted := v_audits_deleted + v_step_deleted;
            v_audits_batches := v_audits_batches + 1;

            EXIT WHEN v_step_deleted < v_batch_size;
        END LOOP;

        -- Batch 3: Expired read notifications (500/batch)
        LOOP
            EXIT WHEN v_notifs_batches >= v_max_batches;

            SELECT COALESCE(pg_catalog.array_agg(batch.id), '{}'::uuid[])
            INTO v_batch_ids
            FROM (
                SELECT id
                FROM public.notifications
                WHERE organization_id = p_organization_id
                  AND read_at IS NOT NULL
                  AND read_at < v_notif_cutoff
                ORDER BY read_at ASC, id ASC
                LIMIT v_batch_size
            ) batch;

            EXIT WHEN pg_catalog.cardinality(v_batch_ids) = 0;

            DELETE FROM public.notifications
            WHERE organization_id = p_organization_id
              AND id = ANY(v_batch_ids);

            GET DIAGNOSTICS v_step_deleted = ROW_COUNT;
            v_notifs_deleted := v_notifs_deleted + v_step_deleted;
            v_notifs_batches := v_notifs_batches + 1;

            EXIT WHEN v_step_deleted < v_batch_size;
        END LOOP;

        IF (v_sessions_deleted + v_audits_deleted + v_notifs_deleted) > 0 OR p_actor_id IS NOT NULL THEN
            INSERT INTO public.audit_logs (
                organization_id, actor_id, action, table_name, record_id, old_data, new_data
            ) VALUES (
                p_organization_id,
                p_actor_id,
                'RETENTION_CLEANUP_EXECUTED',
                'retention_policies',
                p_organization_id,
                jsonb_build_object(
                    'eligible_sessions_archived', v_sessions_archived_ready,
                    'eligible_audit_logs', v_audit_logs_eligible,
                    'eligible_notifications', v_notifications_eligible
                ),
                jsonb_build_object(
                    'dry_run', false,
                    'batch_size', v_batch_size,
                    'deleted', jsonb_build_object(
                        'attendance_sessions', v_sessions_deleted,
                        'audit_logs', v_audits_deleted,
                        'notifications', v_notifs_deleted
                    ),
                    'batches', jsonb_build_object(
                        'attendance_sessions', v_sessions_batches,
                        'audit_logs', v_audits_batches,
                        'notifications', v_notifs_batches
                    ),
                    'skipped_unarchived_sessions', v_sessions_unarchived_skipped,
                    'skipped_unlocked_sessions', v_sessions_unlocked_skipped
                )
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'organization_id', p_organization_id,
        'dry_run', COALESCE(dry_run, TRUE),
        'batch_size', v_batch_size,
        'policy', jsonb_build_object(
            'sessions_archive_after_months', v_sess_months,
            'audit_logs_delete_after_months', v_audit_months,
            'read_notifications_delete_after_days', v_notif_days,
            'sessions_cutoff_at', v_sess_cutoff_ts,
            'audit_logs_cutoff_at', v_audit_cutoff,
            'notifications_cutoff_at', v_notif_cutoff
        ),
        'eligible', jsonb_build_object(
            'attendance_sessions_locked', v_sessions_locked_eligible,
            'attendance_sessions_archived_ready', v_sessions_archived_ready,
            'attendance_sessions_needs_archive', v_sessions_unarchived_skipped,
            'attendance_sessions_unlocked_skipped', v_sessions_unlocked_skipped,
            'audit_logs', v_audit_logs_eligible,
            'notifications_read', v_notifications_eligible,
            'notifications_unread_skipped', v_notifications_unread_skipped
        ),
        'deleted', jsonb_build_object(
            'attendance_sessions', v_sessions_deleted,
            'audit_logs', v_audits_deleted,
            'notifications', v_notifs_deleted
        ),
        'batches', jsonb_build_object(
            'attendance_sessions', v_sessions_batches,
            'audit_logs', v_audits_batches,
            'notifications', v_notifs_batches
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.run_org_retention_cleanup(UUID, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_org_retention_cleanup(UUID, BOOLEAN, UUID) TO service_role;

-- System-wide retention cleanup entrypoint (scheduled weekly via pg_cron)
CREATE OR REPLACE FUNCTION public.run_retention_cleanup(
    dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org RECORD;
    v_org_result JSONB;
    v_org_results JSONB := '[]'::jsonb;
    v_total_elig_sessions INTEGER := 0;
    v_total_elig_audits INTEGER := 0;
    v_total_elig_notifs INTEGER := 0;
    v_total_del_sessions INTEGER := 0;
    v_total_del_audits INTEGER := 0;
    v_total_del_notifs INTEGER := 0;
    v_total_batches INTEGER := 0;
BEGIN
    FOR v_org IN
        SELECT id FROM public.organizations ORDER BY created_at ASC
    LOOP
        v_org_result := public.run_org_retention_cleanup(v_org.id, COALESCE(dry_run, TRUE), NULL);
        v_org_results := v_org_results || jsonb_build_array(v_org_result);

        v_total_elig_sessions := v_total_elig_sessions + COALESCE((v_org_result->'eligible'->>'attendance_sessions_locked')::integer, 0);
        v_total_elig_audits := v_total_elig_audits + COALESCE((v_org_result->'eligible'->>'audit_logs')::integer, 0);
        v_total_elig_notifs := v_total_elig_notifs + COALESCE((v_org_result->'eligible'->>'notifications_read')::integer, 0);

        v_total_del_sessions := v_total_del_sessions + COALESCE((v_org_result->'deleted'->>'attendance_sessions')::integer, 0);
        v_total_del_audits := v_total_del_audits + COALESCE((v_org_result->'deleted'->>'audit_logs')::integer, 0);
        v_total_del_notifs := v_total_del_notifs + COALESCE((v_org_result->'deleted'->>'notifications')::integer, 0);

        v_total_batches := v_total_batches
            + COALESCE((v_org_result->'batches'->>'attendance_sessions')::integer, 0)
            + COALESCE((v_org_result->'batches'->>'audit_logs')::integer, 0)
            + COALESCE((v_org_result->'batches'->>'notifications')::integer, 0);
    END LOOP;

    RETURN jsonb_build_object(
        'dry_run', COALESCE(dry_run, TRUE),
        'batch_size', 500,
        'organizations_processed', pg_catalog.jsonb_array_length(v_org_results),
        'totals', jsonb_build_object(
            'eligible_sessions_locked', v_total_elig_sessions,
            'eligible_audit_logs', v_total_elig_audits,
            'eligible_notifications_read', v_total_elig_notifs,
            'deleted_sessions', v_total_del_sessions,
            'deleted_audit_logs', v_total_del_audits,
            'deleted_notifications', v_total_del_notifs,
            'total_batches', v_total_batches
        ),
        'organizations', v_org_results
    );
END;
$$;

REVOKE ALL ON FUNCTION public.run_retention_cleanup(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_retention_cleanup(BOOLEAN) TO service_role;

-- Authenticated Admin AAL2 wrapper strictly scoped to caller's own organization (dry-run preview only)
CREATE OR REPLACE FUNCTION public.get_org_retention_preview()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_org_id UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can preview retention cleanup.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to preview retention cleanup.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();
    RETURN public.run_org_retention_cleanup(v_org_id, TRUE, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_retention_preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_retention_preview() TO authenticated;

-- ============================================================================
-- 4. WEEKLY PG_CRON SCHEDULE
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-retention-cleanup') THEN
            PERFORM cron.unschedule('weekly-retention-cleanup');
        END IF;

        PERFORM cron.schedule(
            'weekly-retention-cleanup',
            '0 3 * * 0',
            'SELECT public.run_retention_cleanup(false);'
        );
    END IF;
END $$;



-- ============================================================================
-- Migration 14: Section 3 - Task Management System
-- ============================================================================
-- Covers:
-- 1. Tenant-scoped tables (RLS enabled, RPC-only writes, SELECT granted cleanly):
--    `projects`, `tasks`, `task_comments`, `task_time_logs`, `task_events`.
-- 2. Expanded `notifications.type` constraint allowing `task_completed` & `kpi_review`.
-- 3. SECURITY DEFINER RPCs (`SET search_path = ''`, `organization_members` role checks,
--    AAL2 for HR/Admin, strict ownership/assignment/transition checks, UPPER_SNAKE audits):
--    - `create_project`
--    - `create_task`
--    - `assign_task`
--    - `update_task_status`
--    - `complete_task`
--    - `add_task_comment`
--    - `log_task_time`
--    - `cancel_task`
--    - `dispatch_task_due_notifications` (`service_role` only, daily pg_cron '0 8 * * *')
-- ============================================================================

-- Expand notifications type constraint cleanly
ALTER TABLE public.notifications
    DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
    ADD CONSTRAINT notifications_type_check CHECK (
        type IN (
            'missed_checkout',
            'request_status',
            'policy_update',
            'reminder',
            'leave_requested',
            'leave_status',
            'attendance_corrected',
            'delegation',
            'task_assigned',
            'task_due_soon',
            'task_overdue',
            'task_completed',
            'kpi_review'
        )
    );

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    name TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(name)) >= 2),
    code TEXT,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_projects_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_projects_org_dept
    ON public.projects (organization_id, department_id);

CREATE TABLE IF NOT EXISTS public.tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
    parent_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(title)) >= 2),
    description TEXT,
    creator_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    assignee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled')),
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    due_date DATE,
    estimated_minutes INTEGER CHECK (estimated_minutes IS NULL OR (estimated_minutes >= 0 AND estimated_minutes <= 100000)),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_tasks_not_self_parent CHECK (parent_task_id IS DISTINCT FROM id)
);

CREATE INDEX IF NOT EXISTS idx_tasks_org_assignee_status
    ON public.tasks (organization_id, assignee_id, status, due_date);

CREATE INDEX IF NOT EXISTS idx_tasks_org_creator
    ON public.tasks (organization_id, creator_id);

CREATE INDEX IF NOT EXISTS idx_tasks_org_due_open
    ON public.tasks (organization_id, due_date)
    WHERE status IN ('todo', 'in_progress', 'blocked') AND due_date IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_parent
    ON public.tasks (parent_task_id)
    WHERE parent_task_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.task_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    author_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    body TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(body)) >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_task_comments_task
    ON public.task_comments (organization_id, task_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.task_time_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    work_date DATE NOT NULL,
    minutes INTEGER NOT NULL CHECK (minutes > 0 AND minutes <= 1440),
    note TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_task_time_logs_task_date
    ON public.task_time_logs (organization_id, task_id, work_date DESC);

CREATE INDEX IF NOT EXISTS idx_task_time_logs_emp_date
    ON public.task_time_logs (organization_id, employee_id, work_date DESC);

CREATE TABLE IF NOT EXISTS public.task_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    task_id UUID NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    actor_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    event_type TEXT NOT NULL CHECK (
        event_type IN ('created', 'assigned', 'status_changed', 'completed', 'cancelled', 'commented', 'time_logged')
    ),
    from_status TEXT,
    to_status TEXT,
    old_assignee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    new_assignee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_task_events_task
    ON public.task_events (organization_id, task_id, created_at ASC);

-- ============================================================================
-- 2. GRANTS & ROW LEVEL SECURITY
-- ============================================================================

REVOKE ALL ON TABLE public.projects FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.projects TO authenticated;

REVOKE ALL ON TABLE public.tasks FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.tasks TO authenticated;

REVOKE ALL ON TABLE public.task_comments FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_comments TO authenticated;

REVOKE ALL ON TABLE public.task_time_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_time_logs TO authenticated;

REVOKE ALL ON TABLE public.task_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.task_events TO authenticated;

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_time_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_events ENABLE ROW LEVEL SECURITY;

-- projects policies
DROP POLICY IF EXISTS "enforce_active_org_membership_projects" ON public.projects;
DROP POLICY IF EXISTS "enforce_mfa_aal2_projects" ON public.projects;
DROP POLICY IF EXISTS "projects_select_policy" ON public.projects;

CREATE POLICY "enforce_active_org_membership_projects" ON public.projects
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_projects" ON public.projects
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "projects_select_policy" ON public.projects
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

-- tasks policies (employee: own/assigned; manager: own/assigned + direct reports; hr/admin: all in org)
DROP POLICY IF EXISTS "enforce_active_org_membership_tasks" ON public.tasks;
DROP POLICY IF EXISTS "enforce_mfa_aal2_tasks" ON public.tasks;
DROP POLICY IF EXISTS "tasks_select_policy" ON public.tasks;

CREATE POLICY "enforce_active_org_membership_tasks" ON public.tasks
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_tasks" ON public.tasks
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "tasks_select_policy" ON public.tasks
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (
            creator_id = (SELECT auth.uid())
            OR assignee_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
            OR (
                (SELECT public.current_user_role()) = 'manager'
                AND (
                    EXISTS (
                        SELECT 1 FROM public.employees e
                        WHERE e.id = tasks.assignee_id
                          AND e.organization_id = tasks.organization_id
                          AND e.manager_id = (SELECT auth.uid())
                    )
                    OR EXISTS (
                        SELECT 1 FROM public.employees e
                        WHERE e.id = tasks.creator_id
                          AND e.organization_id = tasks.organization_id
                          AND e.manager_id = (SELECT auth.uid())
                    )
                )
            )
        )
    );

-- task_comments policies (inherits task visibility via EXISTS on tasks)
DROP POLICY IF EXISTS "enforce_active_org_membership_task_comments" ON public.task_comments;
DROP POLICY IF EXISTS "enforce_mfa_aal2_task_comments" ON public.task_comments;
DROP POLICY IF EXISTS "task_comments_select_policy" ON public.task_comments;

CREATE POLICY "enforce_active_org_membership_task_comments" ON public.task_comments
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_task_comments" ON public.task_comments
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "task_comments_select_policy" ON public.task_comments
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.id = task_comments.task_id
              AND t.organization_id = task_comments.organization_id
        )
    );

-- task_time_logs policies (inherits task visibility)
DROP POLICY IF EXISTS "enforce_active_org_membership_task_time_logs" ON public.task_time_logs;
DROP POLICY IF EXISTS "enforce_mfa_aal2_task_time_logs" ON public.task_time_logs;
DROP POLICY IF EXISTS "task_time_logs_select_policy" ON public.task_time_logs;

CREATE POLICY "enforce_active_org_membership_task_time_logs" ON public.task_time_logs
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_task_time_logs" ON public.task_time_logs
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "task_time_logs_select_policy" ON public.task_time_logs
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.id = task_time_logs.task_id
              AND t.organization_id = task_time_logs.organization_id
        )
    );

-- task_events policies (inherits task visibility)
DROP POLICY IF EXISTS "enforce_active_org_membership_task_events" ON public.task_events;
DROP POLICY IF EXISTS "enforce_mfa_aal2_task_events" ON public.task_events;
DROP POLICY IF EXISTS "task_events_select_policy" ON public.task_events;

CREATE POLICY "enforce_active_org_membership_task_events" ON public.task_events
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_task_events" ON public.task_events
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "task_events_select_policy" ON public.task_events
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND EXISTS (
            SELECT 1 FROM public.tasks t
            WHERE t.id = task_events.task_id
              AND t.organization_id = task_events.organization_id
        )
    );

-- ============================================================================
-- 3. TASK MANAGEMENT RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_project(
    p_name TEXT,
    p_department_id UUID DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_code TEXT DEFAULT NULL
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
    v_org_id UUID;
    v_name TEXT;
    v_code TEXT;
    v_desc TEXT;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only managers, HR, or administrators can create projects.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin project creation.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_org_id := public.current_org_id();
    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF char_length(v_name) < 2 THEN
        RAISE EXCEPTION 'Project name must be at least 2 characters.' USING ERRCODE = '22023';
    END IF;

    IF p_department_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.departments d
        WHERE d.id = p_department_id AND d.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Department not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    v_code := NULLIF(pg_catalog.btrim(COALESCE(p_code, '')), '');
    v_desc := NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), '');

    INSERT INTO public.projects (
        organization_id, department_id, name, code, description, created_by
    ) VALUES (
        v_org_id, p_department_id, v_name, v_code, v_desc, v_caller_id
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'PROJECT_CREATED', 'projects', v_row.id, NULL, to_jsonb(v_row)
    );

    RETURN jsonb_build_object('success', true, 'project', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.create_project(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_project(TEXT, UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_task(
    p_title TEXT,
    p_description TEXT DEFAULT NULL,
    p_assignee_id UUID DEFAULT NULL,
    p_priority TEXT DEFAULT 'medium',
    p_due_date DATE DEFAULT NULL,
    p_estimated_minutes INTEGER DEFAULT NULL,
    p_project_id UUID DEFAULT NULL,
    p_parent_task_id UUID DEFAULT NULL
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
    v_org_id UUID;
    v_title TEXT;
    v_desc TEXT;
    v_priority TEXT;
    v_assignee_mgr UUID;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin task creation.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_org_id := public.current_org_id();

    v_title := pg_catalog.btrim(COALESCE(p_title, ''));
    IF char_length(v_title) < 2 THEN
        RAISE EXCEPTION 'Task title must be at least 2 characters.' USING ERRCODE = '22023';
    END IF;

    v_desc := NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), '');
    v_priority := COALESCE(NULLIF(pg_catalog.btrim(COALESCE(p_priority, '')), ''), 'medium');
    IF v_priority NOT IN ('low', 'medium', 'high', 'urgent') THEN
        RAISE EXCEPTION 'Invalid priority: must be low, medium, high, or urgent.' USING ERRCODE = '22023';
    END IF;

    IF p_estimated_minutes IS NOT NULL AND (p_estimated_minutes < 0 OR p_estimated_minutes > 100000) THEN
        RAISE EXCEPTION 'estimated_minutes must be between 0 and 100000.' USING ERRCODE = '22023';
    END IF;

    IF p_project_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.id = p_project_id AND p.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Forbidden: Project does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    IF p_parent_task_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.tasks t
        WHERE t.id = p_parent_task_id AND t.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Forbidden: Parent task does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    IF p_assignee_id IS NOT NULL THEN
        SELECT e.manager_id INTO v_assignee_mgr
        FROM public.employees e
        JOIN public.organization_members om
          ON om.user_id = e.id
         AND om.organization_id = e.organization_id
         AND om.status = 'active'
        WHERE e.id = p_assignee_id
          AND e.organization_id = v_org_id
          AND e.status = 'active';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Forbidden: Assignee must be an active member of caller organization.' USING ERRCODE = '42501';
        END IF;

        IF v_caller_role = 'employee' AND p_assignee_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Employees cannot assign tasks to other employees.' USING ERRCODE = '42501';
        ELSIF v_caller_role = 'manager'
          AND p_assignee_id IS DISTINCT FROM v_caller_id
          AND v_assignee_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only assign tasks to themselves or direct reports.' USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO public.tasks (
        organization_id, project_id, parent_task_id, title, description,
        creator_id, assignee_id, status, priority, due_date, estimated_minutes
    ) VALUES (
        v_org_id, p_project_id, p_parent_task_id, v_title, v_desc,
        v_caller_id, p_assignee_id, 'todo', v_priority, p_due_date, p_estimated_minutes
    )
    RETURNING * INTO v_row;

    INSERT INTO public.task_events (
        organization_id, task_id, actor_id, event_type, to_status, new_assignee_id, metadata
    ) VALUES (
        v_org_id, v_row.id, v_caller_id, 'created', 'todo', p_assignee_id,
        jsonb_build_object('priority', v_priority, 'due_date', p_due_date)
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'TASK_CREATED', 'tasks', v_row.id, NULL, to_jsonb(v_row)
    );

    IF p_assignee_id IS NOT NULL AND p_assignee_id IS DISTINCT FROM v_caller_id THEN
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            v_org_id,
            p_assignee_id,
            'task_assigned',
            'New Task Assigned',
            'You have been assigned "' || v_title || '"' || CASE WHEN p_due_date IS NOT NULL THEN ' (Due ' || p_due_date::text || ')' ELSE '' END || '.',
            '/tasks?task=' || v_row.id::text,
            jsonb_build_object('task_id', v_row.id, 'assigned_by', v_caller_id, 'due_date', p_due_date)
        );
    END IF;

    IF p_assignee_id IS NOT NULL AND p_due_date IS NOT NULL THEN
        IF p_due_date < CURRENT_DATE THEN
            INSERT INTO public.notifications (
                organization_id, user_id, type, title, body, link, metadata
            ) VALUES (
                v_org_id,
                p_assignee_id,
                'task_overdue',
                'Overdue Task',
                'Task "' || v_title || '" is past due (' || p_due_date::text || ').',
                '/tasks?task=' || v_row.id::text,
                jsonb_build_object('task_id', v_row.id, 'due_date', p_due_date::text)
            );
        ELSIF p_due_date <= (CURRENT_DATE + 1) THEN
            INSERT INTO public.notifications (
                organization_id, user_id, type, title, body, link, metadata
            ) VALUES (
                v_org_id,
                p_assignee_id,
                'task_due_soon',
                'Task Due Soon',
                'Task "' || v_title || '" is due on ' || p_due_date::text || '.',
                '/tasks?task=' || v_row.id::text,
                jsonb_build_object('task_id', v_row.id, 'due_date', p_due_date::text)
            );
        END IF;
    END IF;

    RETURN jsonb_build_object('success', true, 'task', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.create_task(TEXT, TEXT, UUID, TEXT, DATE, INTEGER, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_task(TEXT, TEXT, UUID, TEXT, DATE, INTEGER, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.assign_task(
    p_task_id UUID,
    p_assignee_id UUID DEFAULT NULL
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
    v_org_id UUID;
    v_old_row RECORD;
    v_new_row RECORD;
    v_cur_assignee_mgr UUID;
    v_new_assignee_mgr UUID;
    v_creator_mgr UUID;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin task assignment.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Task not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_old_row.status IN ('done', 'cancelled') THEN
        RAISE EXCEPTION 'Cannot reassign a task in % status.', v_old_row.status USING ERRCODE = '22023';
    END IF;

    -- Check caller permission to reassign this task
    IF v_caller_role = 'employee' THEN
        -- Employees cannot reassign tasks they do not own (even self-assigning tasks created by others)
        IF v_old_row.creator_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Employees cannot assign or reassign tasks they did not create.' USING ERRCODE = '42501';
        END IF;
        IF p_assignee_id IS NOT NULL AND p_assignee_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Employees cannot assign tasks to other employees.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role = 'manager' THEN
        IF v_old_row.assignee_id IS NOT NULL THEN
            SELECT manager_id INTO v_cur_assignee_mgr FROM public.employees WHERE id = v_old_row.assignee_id;
        END IF;
        SELECT manager_id INTO v_creator_mgr FROM public.employees WHERE id = v_old_row.creator_id;

        IF v_old_row.creator_id IS DISTINCT FROM v_caller_id
           AND v_old_row.assignee_id IS DISTINCT FROM v_caller_id
           AND v_cur_assignee_mgr IS DISTINCT FROM v_caller_id
           AND v_creator_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only assign or reassign tasks within their team.' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Validate target assignee
    IF p_assignee_id IS NOT NULL THEN
        SELECT e.manager_id INTO v_new_assignee_mgr
        FROM public.employees e
        JOIN public.organization_members om
          ON om.user_id = e.id
         AND om.organization_id = e.organization_id
         AND om.status = 'active'
        WHERE e.id = p_assignee_id
          AND e.organization_id = v_org_id
          AND e.status = 'active';

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Forbidden: Target assignee must be an active member of caller organization.' USING ERRCODE = '42501';
        END IF;

        IF v_caller_role = 'manager'
           AND p_assignee_id IS DISTINCT FROM v_caller_id
           AND v_new_assignee_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only assign tasks to themselves or their direct reports.' USING ERRCODE = '42501';
        END IF;
    END IF;

    UPDATE public.tasks
    SET assignee_id = p_assignee_id,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.task_events (
        organization_id, task_id, actor_id, event_type, old_assignee_id, new_assignee_id, metadata
    ) VALUES (
        v_org_id, p_task_id, v_caller_id, 'assigned', v_old_row.assignee_id, p_assignee_id,
        jsonb_build_object('previous_assignee_id', v_old_row.assignee_id, 'new_assignee_id', p_assignee_id)
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'TASK_ASSIGNED', 'tasks', p_task_id, to_jsonb(v_old_row), to_jsonb(v_new_row)
    );

    IF p_assignee_id IS NOT NULL
       AND p_assignee_id IS DISTINCT FROM v_old_row.assignee_id
       AND p_assignee_id IS DISTINCT FROM v_caller_id THEN
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            v_org_id,
            p_assignee_id,
            'task_assigned',
            'Task Assigned to You',
            'Task "' || v_new_row.title || '" has been assigned to you.',
            '/tasks?task=' || p_task_id::text,
            jsonb_build_object('task_id', p_task_id, 'assigned_by', v_caller_id, 'due_date', v_new_row.due_date)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'task', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.assign_task(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.assign_task(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_task_status(
    p_task_id UUID,
    p_new_status TEXT,
    p_note TEXT DEFAULT NULL
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
    v_org_id UUID;
    v_old_row RECORD;
    v_new_row RECORD;
    v_assignee_mgr UUID;
    v_creator_mgr UUID;
    v_note TEXT;
    v_action TEXT;
    v_event_type TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin task updates.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_new_status IS NULL OR p_new_status NOT IN ('todo', 'in_progress', 'blocked', 'done', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid task status: %.', p_new_status USING ERRCODE = '22023';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.tasks
    WHERE id = p_task_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Task not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    -- Authorization matrix
    IF v_caller_role = 'employee' THEN
        IF NOT (
            v_old_row.assignee_id = v_caller_id
            OR (v_old_row.creator_id = v_caller_id AND v_old_row.assignee_id IS NULL)
        ) THEN
            RAISE EXCEPTION 'Forbidden: Employees can only update status on tasks assigned to them or their own unassigned tasks.' USING ERRCODE = '42501';
        END IF;

        IF p_new_status = 'cancelled' AND v_old_row.creator_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Only task creator, manager, HR, or admin can cancel a task.' USING ERRCODE = '42501';
        END IF;

        IF v_old_row.status = 'done' AND v_old_row.creator_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Only task creator, manager, HR, or admin can reopen a completed task.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role = 'manager' THEN
        IF v_old_row.assignee_id IS NOT NULL THEN
            SELECT manager_id INTO v_assignee_mgr FROM public.employees WHERE id = v_old_row.assignee_id;
        END IF;
        SELECT manager_id INTO v_creator_mgr FROM public.employees WHERE id = v_old_row.creator_id;

        IF v_old_row.assignee_id IS DISTINCT FROM v_caller_id
           AND v_old_row.creator_id IS DISTINCT FROM v_caller_id
           AND v_assignee_mgr IS DISTINCT FROM v_caller_id
           AND v_creator_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only update tasks for themselves or their direct reports.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF v_old_row.status = p_new_status THEN
        RETURN jsonb_build_object('success', true, 'unchanged', true, 'task', to_jsonb(v_old_row));
    END IF;

    -- Status transition rules
    IF v_old_row.status = 'cancelled' THEN
        RAISE EXCEPTION 'Invalid transition: Cancelled tasks cannot change status.' USING ERRCODE = '22023';
    END IF;

    IF v_old_row.status = 'blocked' AND p_new_status = 'done' THEN
        RAISE EXCEPTION 'Invalid transition: Blocked tasks must transition to in_progress or todo before completion.' USING ERRCODE = '22023';
    END IF;

    IF v_old_row.status = 'done' AND p_new_status NOT IN ('todo', 'in_progress') THEN
        RAISE EXCEPTION 'Invalid transition: Completed tasks may only be reopened to todo or in_progress.' USING ERRCODE = '22023';
    END IF;

    v_note := NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '');

    UPDATE public.tasks
    SET status = p_new_status,
        started_at = CASE
            WHEN p_new_status IN ('in_progress', 'done') AND started_at IS NULL THEN pg_catalog.now()
            ELSE started_at
        END,
        completed_at = CASE
            WHEN p_new_status = 'done' THEN pg_catalog.now()
            WHEN p_new_status IN ('todo', 'in_progress') THEN NULL
            ELSE completed_at
        END,
        cancelled_at = CASE
            WHEN p_new_status = 'cancelled' THEN pg_catalog.now()
            ELSE cancelled_at
        END,
        updated_at = pg_catalog.now()
    WHERE id = p_task_id
    RETURNING * INTO v_new_row;

    v_event_type := CASE
        WHEN p_new_status = 'done' THEN 'completed'
        WHEN p_new_status = 'cancelled' THEN 'cancelled'
        ELSE 'status_changed'
    END;

    v_action := CASE
        WHEN p_new_status = 'done' THEN 'TASK_COMPLETED'
        WHEN p_new_status = 'cancelled' THEN 'TASK_CANCELLED'
        ELSE 'TASK_STATUS_UPDATED'
    END;

    INSERT INTO public.task_events (
        organization_id, task_id, actor_id, event_type, from_status, to_status, metadata
    ) VALUES (
        v_org_id, p_task_id, v_caller_id, v_event_type, v_old_row.status, p_new_status,
        CASE WHEN v_note IS NOT NULL THEN jsonb_build_object('note', v_note) ELSE '{}'::jsonb END
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, v_action, 'tasks', p_task_id,
        jsonb_build_object('status', v_old_row.status, 'completed_at', v_old_row.completed_at),
        jsonb_build_object('status', v_new_row.status, 'completed_at', v_new_row.completed_at, 'note', v_note)
    );

    IF p_new_status = 'done' AND v_new_row.creator_id IS DISTINCT FROM v_caller_id THEN
        INSERT INTO public.notifications (
            organization_id, user_id, type, title, body, link, metadata
        ) VALUES (
            v_org_id,
            v_new_row.creator_id,
            'task_completed',
            'Task Completed',
            'Task "' || v_new_row.title || '" has been completed.',
            '/tasks?task=' || p_task_id::text,
            jsonb_build_object('task_id', p_task_id, 'completed_by', v_caller_id)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'task', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.update_task_status(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_task_status(UUID, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.complete_task(
    p_task_id UUID,
    p_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN public.update_task_status(p_task_id, 'done', p_note);
END;
$$;

REVOKE ALL ON FUNCTION public.complete_task(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_task(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.cancel_task(
    p_task_id UUID,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    RETURN public.update_task_status(p_task_id, 'cancelled', p_reason);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_task(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_task(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.add_task_comment(
    p_task_id UUID,
    p_body TEXT
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
    v_org_id UUID;
    v_task RECORD;
    v_assignee_mgr UUID;
    v_creator_mgr UUID;
    v_body TEXT;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin comments.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF v_task IS NULL OR v_task.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Task not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role = 'employee' THEN
        IF v_task.creator_id IS DISTINCT FROM v_caller_id AND v_task.assignee_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: You do not have access to comment on this task.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role = 'manager' THEN
        IF v_task.assignee_id IS NOT NULL THEN
            SELECT manager_id INTO v_assignee_mgr FROM public.employees WHERE id = v_task.assignee_id;
        END IF;
        SELECT manager_id INTO v_creator_mgr FROM public.employees WHERE id = v_task.creator_id;
        IF v_task.creator_id IS DISTINCT FROM v_caller_id
           AND v_task.assignee_id IS DISTINCT FROM v_caller_id
           AND v_assignee_mgr IS DISTINCT FROM v_caller_id
           AND v_creator_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only comment on team tasks.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_body := pg_catalog.btrim(COALESCE(p_body, ''));
    IF char_length(v_body) < 1 THEN
        RAISE EXCEPTION 'Comment body cannot be empty.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.task_comments (
        organization_id, task_id, author_id, body
    ) VALUES (
        v_org_id, p_task_id, v_caller_id, v_body
    )
    RETURNING * INTO v_row;

    INSERT INTO public.task_events (
        organization_id, task_id, actor_id, event_type, metadata
    ) VALUES (
        v_org_id, p_task_id, v_caller_id, 'commented', jsonb_build_object('comment_id', v_row.id)
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'TASK_COMMENT_ADDED', 'task_comments', v_row.id, NULL, to_jsonb(v_row)
    );

    RETURN jsonb_build_object('success', true, 'comment', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.add_task_comment(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_task_comment(UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.log_task_time(
    p_task_id UUID,
    p_work_date DATE,
    p_minutes INTEGER,
    p_note TEXT DEFAULT NULL
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
    v_org_id UUID;
    v_task RECORD;
    v_assignee_mgr UUID;
    v_creator_mgr UUID;
    v_note TEXT;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin time logging.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_task FROM public.tasks WHERE id = p_task_id;
    IF v_task IS NULL OR v_task.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: Task not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_task.status = 'cancelled' THEN
        RAISE EXCEPTION 'Cannot log time against a cancelled task.' USING ERRCODE = '22023';
    END IF;

    IF v_caller_role = 'employee' THEN
        IF NOT (
            v_task.assignee_id = v_caller_id
            OR (v_task.creator_id = v_caller_id AND v_task.assignee_id IS NULL)
        ) THEN
            RAISE EXCEPTION 'Forbidden: Employees can only log time on tasks assigned to them.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role = 'manager' THEN
        IF v_task.assignee_id IS NOT NULL THEN
            SELECT manager_id INTO v_assignee_mgr FROM public.employees WHERE id = v_task.assignee_id;
        END IF;
        SELECT manager_id INTO v_creator_mgr FROM public.employees WHERE id = v_task.creator_id;
        IF v_task.creator_id IS DISTINCT FROM v_caller_id
           AND v_task.assignee_id IS DISTINCT FROM v_caller_id
           AND v_assignee_mgr IS DISTINCT FROM v_caller_id
           AND v_creator_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only log time on team tasks.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_work_date IS NULL OR p_minutes IS NULL OR p_minutes <= 0 OR p_minutes > 1440 THEN
        RAISE EXCEPTION 'Valid work_date and minutes (1-1440) are required.' USING ERRCODE = '22023';
    END IF;

    v_note := NULLIF(pg_catalog.btrim(COALESCE(p_note, '')), '');

    INSERT INTO public.task_time_logs (
        organization_id, task_id, employee_id, work_date, minutes, note
    ) VALUES (
        v_org_id, p_task_id, v_caller_id, p_work_date, p_minutes, v_note
    )
    RETURNING * INTO v_row;

    INSERT INTO public.task_events (
        organization_id, task_id, actor_id, event_type, metadata
    ) VALUES (
        v_org_id, p_task_id, v_caller_id, 'time_logged',
        jsonb_build_object('log_id', v_row.id, 'work_date', p_work_date, 'minutes', p_minutes)
    );

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'TASK_TIME_LOGGED', 'task_time_logs', v_row.id, NULL, to_jsonb(v_row)
    );

    RETURN jsonb_build_object('success', true, 'time_log', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.log_task_time(UUID, DATE, INTEGER, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_task_time(UUID, DATE, INTEGER, TEXT) TO authenticated;

-- Service-role due-soon & overdue task notification dispatcher (daily pg_cron + direct verification)
CREATE OR REPLACE FUNCTION public.dispatch_task_due_notifications()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_sent INTEGER := 0;
    v_task RECORD;
    v_type TEXT;
    v_title TEXT;
    v_body TEXT;
BEGIN
    FOR v_task IN
        SELECT t.id, t.organization_id, t.assignee_id, t.title, t.due_date
        FROM public.tasks t
        JOIN public.organizations o ON o.id = t.organization_id AND o.status IN ('active', 'trial')
        JOIN public.organization_members om
          ON om.organization_id = t.organization_id
         AND om.user_id = t.assignee_id
         AND om.status = 'active'
        WHERE t.status IN ('todo', 'in_progress', 'blocked')
          AND t.assignee_id IS NOT NULL
          AND t.due_date IS NOT NULL
          AND t.due_date <= (CURRENT_DATE + 1)
    LOOP
        IF v_task.due_date < CURRENT_DATE THEN
            v_type := 'task_overdue';
            v_title := 'Overdue Task Reminder';
            v_body := 'Task "' || v_task.title || '" was due on ' || v_task.due_date::text || '.';
        ELSE
            v_type := 'task_due_soon';
            v_title := 'Task Due Soon';
            v_body := 'Task "' || v_task.title || '" is due on ' || v_task.due_date::text || '.';
        END IF;

        IF NOT EXISTS (
            SELECT 1 FROM public.notifications n
            WHERE n.organization_id = v_task.organization_id
              AND n.user_id = v_task.assignee_id
              AND n.type = v_type
              AND n.metadata->>'task_id' = v_task.id::text
              AND n.metadata->>'due_date' = v_task.due_date::text
        ) THEN
            INSERT INTO public.notifications (
                organization_id, user_id, type, title, body, link, metadata
            ) VALUES (
                v_task.organization_id,
                v_task.assignee_id,
                v_type,
                v_title,
                v_body,
                '/tasks?task=' || v_task.id::text,
                jsonb_build_object('task_id', v_task.id::text, 'due_date', v_task.due_date::text)
            );
            v_sent := v_sent + 1;
        END IF;
    END LOOP;

    RETURN v_sent;
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_task_due_notifications() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_task_due_notifications() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'daily-task-due-notifications') THEN
            PERFORM cron.unschedule('daily-task-due-notifications');
        END IF;

        PERFORM cron.schedule(
            'daily-task-due-notifications',
            '0 8 * * *',
            'SELECT public.dispatch_task_due_notifications();'
        );
    END IF;
END $$;



-- ============================================================================
-- Migration 15: Section 4 - KPI System (Attendance, Leave & Tasks)
-- ============================================================================
-- Covers:
-- 1. Tenant-scoped tables (RLS enabled, RPC-only writes, SELECT granted cleanly):
--    `kpi_definitions`, `kpi_periods`, `kpi_scores`, `kpi_reviews`.
-- 2. Pure SQL KPI formula function `calculate_kpi_score(numeric, numeric, text)`
--    (IMMUTABLE, handles no data / NULL, zero target, higher_is_better, lower_is_better).
-- 3. Closed-period immutability triggers (`kpi_periods`, `kpi_scores`, `kpi_reviews`).
-- 4. SECURITY DEFINER RPCs (`SET search_path = ''`, role from `organization_members`,
--    AAL2 for HR/Admin, no self-review, UPPER_SNAKE audits, notifications):
--    - `upsert_kpi_definition`
--    - `delete_kpi_definition`
--    - `create_kpi_period`
--    - `compute_kpi_scores`
--    - `close_kpi_period`
--    - `submit_kpi_review`
-- ============================================================================

-- ============================================================================
-- 1. TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.kpi_definitions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(name)) >= 2),
    description TEXT,
    source_metric TEXT NOT NULL CHECK (
        source_metric IN (
            'attendance_on_time_rate',
            'hours_vs_target',
            'absence_days',
            'leave_days_taken',
            'tasks_completed',
            'tasks_on_time_rate',
            'tasks_overdue',
            'avg_task_cycle_days'
        )
    ),
    target_value NUMERIC(12,2) NOT NULL CHECK (target_value >= 0),
    direction TEXT NOT NULL CHECK (direction IN ('higher_is_better', 'lower_is_better')),
    weight NUMERIC(6,2) NOT NULL DEFAULT 1.00 CHECK (weight > 0 AND weight <= 1000),
    applies_to_role TEXT CHECK (applies_to_role IS NULL OR applies_to_role IN ('employee', 'manager', 'hr', 'admin')),
    applies_to_department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_kpi_definitions_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_kpi_definitions_org_active
    ON public.kpi_definitions (organization_id, is_active, source_metric);

CREATE TABLE IF NOT EXISTS public.kpi_periods (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(name)) >= 2),
    period_type TEXT NOT NULL CHECK (period_type IN ('monthly', 'quarterly')),
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    closed_at TIMESTAMPTZ,
    closed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT chk_kpi_periods_dates CHECK (end_date >= start_date),
    CONSTRAINT uq_kpi_periods_org_name UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_kpi_periods_org_status
    ON public.kpi_periods (organization_id, status, start_date DESC);

CREATE TABLE IF NOT EXISTS public.kpi_scores (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES public.kpi_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    kpi_definition_id UUID NOT NULL REFERENCES public.kpi_definitions(id) ON DELETE CASCADE,
    actual_value NUMERIC(12,2) NOT NULL DEFAULT 0,
    target_value NUMERIC(12,2) NOT NULL,
    score NUMERIC(5,2) NOT NULL CHECK (score >= 0 AND score <= 100),
    computed_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_kpi_scores_period_emp_def UNIQUE (period_id, employee_id, kpi_definition_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_scores_org_period_emp
    ON public.kpi_scores (organization_id, period_id, employee_id);

CREATE TABLE IF NOT EXISTS public.kpi_reviews (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    period_id UUID NOT NULL REFERENCES public.kpi_periods(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    reviewer_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    rating NUMERIC(3,1) NOT NULL CHECK (rating >= 1.0 AND rating <= 5.0),
    comment TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(comment)) >= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_kpi_reviews_period_emp UNIQUE (period_id, employee_id),
    CONSTRAINT chk_kpi_reviews_no_self_review CHECK (reviewer_id IS DISTINCT FROM employee_id)
);

CREATE INDEX IF NOT EXISTS idx_kpi_reviews_org_period_emp
    ON public.kpi_reviews (organization_id, period_id, employee_id);

-- ============================================================================
-- 2. GRANTS & ROW LEVEL SECURITY
-- ============================================================================

REVOKE ALL ON TABLE public.kpi_definitions FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kpi_definitions TO authenticated;

REVOKE ALL ON TABLE public.kpi_periods FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kpi_periods TO authenticated;

REVOKE ALL ON TABLE public.kpi_scores FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kpi_scores TO authenticated;

REVOKE ALL ON TABLE public.kpi_reviews FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.kpi_reviews TO authenticated;

ALTER TABLE public.kpi_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.kpi_reviews ENABLE ROW LEVEL SECURITY;

-- kpi_definitions policies
DROP POLICY IF EXISTS "enforce_active_org_membership_kpi_definitions" ON public.kpi_definitions;
DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_definitions" ON public.kpi_definitions;
DROP POLICY IF EXISTS "kpi_definitions_select_policy" ON public.kpi_definitions;

CREATE POLICY "enforce_active_org_membership_kpi_definitions" ON public.kpi_definitions
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_kpi_definitions" ON public.kpi_definitions
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "kpi_definitions_select_policy" ON public.kpi_definitions
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

-- kpi_periods policies
DROP POLICY IF EXISTS "enforce_active_org_membership_kpi_periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_periods" ON public.kpi_periods;
DROP POLICY IF EXISTS "kpi_periods_select_policy" ON public.kpi_periods;

CREATE POLICY "enforce_active_org_membership_kpi_periods" ON public.kpi_periods
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_kpi_periods" ON public.kpi_periods
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "kpi_periods_select_policy" ON public.kpi_periods
    FOR SELECT TO authenticated
    USING (organization_id = (SELECT public.current_org_id()));

-- kpi_scores policies (employee own; manager direct reports; hr/admin all)
DROP POLICY IF EXISTS "enforce_active_org_membership_kpi_scores" ON public.kpi_scores;
DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_scores" ON public.kpi_scores;
DROP POLICY IF EXISTS "kpi_scores_select_policy" ON public.kpi_scores;

CREATE POLICY "enforce_active_org_membership_kpi_scores" ON public.kpi_scores
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_kpi_scores" ON public.kpi_scores
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "kpi_scores_select_policy" ON public.kpi_scores
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
                    WHERE e.id = kpi_scores.employee_id
                      AND e.organization_id = kpi_scores.organization_id
                      AND e.manager_id = (SELECT auth.uid())
                )
            )
        )
    );

-- kpi_reviews policies (employee own; manager direct reports; hr/admin all)
DROP POLICY IF EXISTS "enforce_active_org_membership_kpi_reviews" ON public.kpi_reviews;
DROP POLICY IF EXISTS "enforce_mfa_aal2_kpi_reviews" ON public.kpi_reviews;
DROP POLICY IF EXISTS "kpi_reviews_select_policy" ON public.kpi_reviews;

CREATE POLICY "enforce_active_org_membership_kpi_reviews" ON public.kpi_reviews
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_kpi_reviews" ON public.kpi_reviews
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "kpi_reviews_select_policy" ON public.kpi_reviews
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
                    WHERE e.id = kpi_reviews.employee_id
                      AND e.organization_id = kpi_reviews.organization_id
                      AND e.manager_id = (SELECT auth.uid())
                )
            )
        )
    );

-- ============================================================================
-- 3. PURE SQL SCORING FORMULA FUNCTION
-- ============================================================================

CREATE OR REPLACE FUNCTION public.calculate_kpi_score(
    p_actual NUMERIC,
    p_target NUMERIC,
    p_direction TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_target NUMERIC;
    v_score NUMERIC;
BEGIN
    IF p_direction IS NULL OR p_direction NOT IN ('higher_is_better', 'lower_is_better') THEN
        RAISE EXCEPTION 'Invalid KPI direction: must be higher_is_better or lower_is_better.' USING ERRCODE = '22023';
    END IF;

    -- Edge case: No recorded data (NULL) resolves safely to 0.00
    IF p_actual IS NULL THEN
        RETURN 0.00;
    END IF;

    v_target := COALESCE(p_target, 0);

    IF p_direction = 'higher_is_better' THEN
        IF v_target <= 0 THEN
            RETURN CASE WHEN p_actual > 0 THEN 100.00 ELSE 0.00 END;
        END IF;
        v_score := ROUND(GREATEST(0::numeric, LEAST(100::numeric, (p_actual / v_target) * 100.0)), 2);
        RETURN v_score;
    ELSE
        -- lower_is_better
        IF v_target <= 0 THEN
            IF p_actual <= 0 THEN
                RETURN 100.00;
            END IF;
            RETURN ROUND(GREATEST(0::numeric, 100.0 / (1.0 + p_actual)), 2);
        END IF;

        IF p_actual <= v_target THEN
            RETURN 100.00;
        END IF;

        v_score := ROUND(GREATEST(0::numeric, LEAST(100::numeric, (2.0 - (p_actual / v_target)) * 100.0)), 2);
        RETURN v_score;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_kpi_score(NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_kpi_score(NUMERIC, NUMERIC, TEXT) TO authenticated;

-- ============================================================================
-- 4. CLOSED-PERIOD IMMUTABILITY TRIGGERS
-- ============================================================================

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
    SELECT status INTO v_status FROM public.kpi_periods WHERE id = v_period_id;

    -- Allow CASCADE delete when the entire period itself is open and deleted, otherwise block
    IF v_status = 'closed' THEN
        RAISE EXCEPTION 'KPI records belonging to a closed period are immutable.' USING ERRCODE = '22023';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE ALL ON FUNCTION public.trg_enforce_kpi_closed_immutability() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_kpi_periods_immutable ON public.kpi_periods;
CREATE TRIGGER trg_kpi_periods_immutable
    BEFORE UPDATE OR DELETE ON public.kpi_periods
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_kpi_closed_immutability();

DROP TRIGGER IF EXISTS trg_kpi_scores_immutable ON public.kpi_scores;
CREATE TRIGGER trg_kpi_scores_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.kpi_scores
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_kpi_closed_immutability();

DROP TRIGGER IF EXISTS trg_kpi_reviews_immutable ON public.kpi_reviews;
CREATE TRIGGER trg_kpi_reviews_immutable
    BEFORE INSERT OR UPDATE OR DELETE ON public.kpi_reviews
    FOR EACH ROW EXECUTE FUNCTION public.trg_enforce_kpi_closed_immutability();

-- ============================================================================
-- 5. KPI MANAGEMENT & COMPUTATION RPCs
-- ============================================================================

CREATE OR REPLACE FUNCTION public.upsert_kpi_definition(
    p_name TEXT,
    p_source_metric TEXT,
    p_target_value NUMERIC,
    p_direction TEXT,
    p_weight NUMERIC DEFAULT 1.0,
    p_description TEXT DEFAULT NULL,
    p_applies_to_role TEXT DEFAULT NULL,
    p_applies_to_department_id UUID DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT TRUE,
    p_definition_id UUID DEFAULT NULL
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
    v_org_id UUID;
    v_name TEXT;
    v_desc TEXT;
    v_role_filter TEXT;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can manage KPI definitions.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for KPI definition changes.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF char_length(v_name) < 2 THEN
        RAISE EXCEPTION 'KPI name must be at least 2 characters.' USING ERRCODE = '22023';
    END IF;

    IF p_source_metric IS NULL OR p_source_metric NOT IN (
        'attendance_on_time_rate',
        'hours_vs_target',
        'absence_days',
        'leave_days_taken',
        'tasks_completed',
        'tasks_on_time_rate',
        'tasks_overdue',
        'avg_task_cycle_days'
    ) THEN
        RAISE EXCEPTION 'Invalid KPI source metric: %.', p_source_metric USING ERRCODE = '22023';
    END IF;

    IF p_target_value IS NULL OR p_target_value < 0 THEN
        RAISE EXCEPTION 'target_value must be non-negative.' USING ERRCODE = '22023';
    END IF;

    IF p_direction IS NULL OR p_direction NOT IN ('higher_is_better', 'lower_is_better') THEN
        RAISE EXCEPTION 'direction must be higher_is_better or lower_is_better.' USING ERRCODE = '22023';
    END IF;

    IF p_weight IS NULL OR p_weight <= 0 OR p_weight > 1000 THEN
        RAISE EXCEPTION 'weight must be between 0.01 and 1000.' USING ERRCODE = '22023';
    END IF;

    v_role_filter := NULLIF(pg_catalog.btrim(COALESCE(p_applies_to_role, '')), '');
    IF v_role_filter IS NOT NULL AND v_role_filter NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid applies_to_role: %.', v_role_filter USING ERRCODE = '22023';
    END IF;

    IF p_applies_to_department_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.departments d
        WHERE d.id = p_applies_to_department_id AND d.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Forbidden: Department not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    v_desc := NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), '');

    IF p_definition_id IS NOT NULL THEN
        SELECT * INTO v_old_row
        FROM public.kpi_definitions
        WHERE id = p_definition_id
        FOR UPDATE;

        IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
            RAISE EXCEPTION 'Forbidden: KPI definition not found in caller organization.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.kpi_definitions
        SET name = v_name,
            description = v_desc,
            source_metric = p_source_metric,
            target_value = p_target_value,
            direction = p_direction,
            weight = p_weight,
            applies_to_role = v_role_filter,
            applies_to_department_id = p_applies_to_department_id,
            is_active = COALESCE(p_is_active, TRUE),
            updated_at = pg_catalog.now()
        WHERE id = p_definition_id
        RETURNING * INTO v_new_row;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_org_id, v_caller_id, 'KPI_DEFINITION_UPDATED', 'kpi_definitions', v_new_row.id,
            to_jsonb(v_old_row), to_jsonb(v_new_row)
        );
    ELSE
        INSERT INTO public.kpi_definitions (
            organization_id, name, description, source_metric, target_value, direction,
            weight, applies_to_role, applies_to_department_id, is_active, created_by
        ) VALUES (
            v_org_id, v_name, v_desc, p_source_metric, p_target_value, p_direction,
            p_weight, v_role_filter, p_applies_to_department_id, COALESCE(p_is_active, TRUE), v_caller_id
        )
        RETURNING * INTO v_new_row;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_org_id, v_caller_id, 'KPI_DEFINITION_CREATED', 'kpi_definitions', v_new_row.id,
            NULL, to_jsonb(v_new_row)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'definition', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_kpi_definition(TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, UUID, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_kpi_definition(TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, UUID, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_kpi_definition(
    p_definition_id UUID
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
    v_org_id UUID;
    v_old_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can delete KPI definitions.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for KPI definition deletion.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.kpi_definitions
    WHERE id = p_definition_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI definition not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.kpi_scores ks
        JOIN public.kpi_periods kp ON kp.id = ks.period_id
        WHERE ks.kpi_definition_id = p_definition_id
          AND kp.status = 'closed'
    ) THEN
        RAISE EXCEPTION 'Cannot delete KPI definition referenced by a closed period; deactivate it instead.' USING ERRCODE = '22023';
    END IF;

    DELETE FROM public.kpi_definitions WHERE id = p_definition_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_DEFINITION_DELETED', 'kpi_definitions', p_definition_id,
        to_jsonb(v_old_row), NULL
    );

    RETURN jsonb_build_object('success', true, 'deleted_id', p_definition_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_kpi_definition(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_kpi_definition(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.create_kpi_period(
    p_name TEXT,
    p_period_type TEXT,
    p_start_date DATE,
    p_end_date DATE
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
    v_org_id UUID;
    v_name TEXT;
    v_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can create KPI periods.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for creating KPI periods.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF char_length(v_name) < 2 THEN
        RAISE EXCEPTION 'Period name must be at least 2 characters.' USING ERRCODE = '22023';
    END IF;

    IF p_period_type IS NULL OR p_period_type NOT IN ('monthly', 'quarterly') THEN
        RAISE EXCEPTION 'period_type must be monthly or quarterly.' USING ERRCODE = '22023';
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'end_date must be on or after start_date.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.kpi_periods (
        organization_id, name, period_type, start_date, end_date, status, created_by
    ) VALUES (
        v_org_id, v_name, p_period_type, p_start_date, p_end_date, 'open', v_caller_id
    )
    RETURNING * INTO v_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_PERIOD_CREATED', 'kpi_periods', v_row.id, NULL, to_jsonb(v_row)
    );

    RETURN jsonb_build_object('success', true, 'period', to_jsonb(v_row));
END;
$$;

REVOKE ALL ON FUNCTION public.create_kpi_period(TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_kpi_period(TEXT, TEXT, DATE, DATE) TO authenticated;

CREATE OR REPLACE FUNCTION public.compute_kpi_scores(
    p_period_id UUID
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
    v_org_id UUID;
    v_period RECORD;
    v_emp RECORD;
    v_def RECORD;
    v_actual NUMERIC(12,2);
    v_score NUMERIC(5,2);
    v_written INTEGER := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can compute KPI scores.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for computing KPI scores.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_period
    FROM public.kpi_periods
    WHERE id = p_period_id
    FOR UPDATE;

    IF v_period IS NULL OR v_period.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI period not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_period.status = 'closed' THEN
        RAISE EXCEPTION 'Closed KPI periods are immutable and cannot be recalculated.' USING ERRCODE = '22023';
    END IF;

    -- Wipe previous open-period snapshot rows before writing recomputed snapshots
    DELETE FROM public.kpi_scores WHERE period_id = p_period_id;

    FOR v_emp IN
        SELECT e.id, e.department_id, COALESCE(e.work_target_minutes, 480) AS work_target_minutes, om.role
        FROM public.employees e
        JOIN public.organization_members om
          ON om.user_id = e.id
         AND om.organization_id = e.organization_id
         AND om.status = 'active'
        WHERE e.organization_id = v_org_id
          AND e.status = 'active'
    LOOP
        FOR v_def IN
            SELECT *
            FROM public.kpi_definitions d
            WHERE d.organization_id = v_org_id
              AND d.is_active = TRUE
              AND (d.applies_to_role IS NULL OR d.applies_to_role = v_emp.role)
              AND (d.applies_to_department_id IS NULL OR d.applies_to_department_id = v_emp.department_id)
        LOOP
            v_actual := 0.00;

            IF v_def.source_metric = 'attendance_on_time_rate' THEN
                SELECT COALESCE(
                    ROUND(
                        (COUNT(*) FILTER (WHERE is_late = FALSE)::numeric /
                         NULLIF(COUNT(*)::numeric, 0)) * 100.0,
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date
                  AND ad.status IN ('present', 'half_day');

            ELSIF v_def.source_metric = 'hours_vs_target' THEN
                SELECT COALESCE(
                    ROUND(
                        (COALESCE(SUM(CASE WHEN ad.status IN ('present', 'half_day') THEN ad.total_minutes ELSE 0 END), 0)::numeric /
                         NULLIF((COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day', 'absent'))::numeric * v_emp.work_target_minutes), 0)) * 100.0,
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'absence_days' THEN
                SELECT COUNT(*)::numeric INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date
                  AND ad.status = 'absent';

            ELSIF v_def.source_metric = 'leave_days_taken' THEN
                SELECT COALESCE(
                    ROUND(
                        SUM(
                            CASE
                                WHEN lr.start_date >= v_period.start_date AND lr.end_date <= v_period.end_date
                                THEN lr.total_days
                                ELSE GREATEST(
                                    0,
                                    (LEAST(lr.end_date, v_period.end_date) - GREATEST(lr.start_date, v_period.start_date) + 1)
                                )::numeric
                            END
                        ),
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.leave_requests lr
                WHERE lr.organization_id = v_org_id
                  AND lr.employee_id = v_emp.id
                  AND lr.status = 'approved'
                  AND lr.start_date <= v_period.end_date
                  AND lr.end_date >= v_period.start_date;

            ELSIF v_def.source_metric = 'tasks_completed' THEN
                SELECT COUNT(*)::numeric INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.completed_at::date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'tasks_on_time_rate' THEN
                SELECT COALESCE(
                    ROUND(
                        (COUNT(*) FILTER (WHERE t.completed_at::date <= t.due_date)::numeric /
                         NULLIF(COUNT(*)::numeric, 0)) * 100.0,
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.due_date IS NOT NULL
                  AND t.completed_at::date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'tasks_overdue' THEN
                SELECT COUNT(*)::numeric INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.due_date IS NOT NULL
                  AND (
                      (
                          t.status IN ('todo', 'in_progress', 'blocked')
                          AND t.due_date <= v_period.end_date
                          AND t.due_date < CURRENT_DATE
                      )
                      OR (
                          t.status = 'done'
                          AND t.completed_at IS NOT NULL
                          AND t.completed_at::date BETWEEN v_period.start_date AND v_period.end_date
                          AND t.completed_at::date > t.due_date
                      )
                  );

            ELSIF v_def.source_metric = 'avg_task_cycle_days' THEN
                SELECT COALESCE(
                    ROUND(
                        AVG(
                            GREATEST(
                                0.0,
                                EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.started_at, t.created_at))) / 86400.0
                            )
                        )::numeric,
                        2
                    ),
                    0.00
                ) INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.completed_at::date BETWEEN v_period.start_date AND v_period.end_date;
            END IF;

            v_score := public.calculate_kpi_score(v_actual, v_def.target_value, v_def.direction);

            INSERT INTO public.kpi_scores (
                organization_id, period_id, employee_id, kpi_definition_id,
                actual_value, target_value, score, computed_at
            ) VALUES (
                v_org_id, p_period_id, v_emp.id, v_def.id,
                COALESCE(v_actual, 0.00), v_def.target_value, v_score, pg_catalog.now()
            );

            v_written := v_written + 1;
        END LOOP;
    END LOOP;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_SCORES_COMPUTED', 'kpi_scores', p_period_id,
        NULL, jsonb_build_object('period_id', p_period_id, 'scores_written', v_written)
    );

    RETURN jsonb_build_object('success', true, 'period_id', p_period_id, 'scores_written', v_written);
END;
$$;

REVOKE ALL ON FUNCTION public.compute_kpi_scores(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_kpi_scores(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_kpi_period(
    p_period_id UUID
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
    v_org_id UUID;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can close KPI periods.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for closing KPI periods.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_old_row
    FROM public.kpi_periods
    WHERE id = p_period_id
    FOR UPDATE;

    IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI period not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_old_row.status = 'closed' THEN
        RAISE EXCEPTION 'KPI period is already closed.' USING ERRCODE = '22023';
    END IF;

    UPDATE public.kpi_periods
    SET status = 'closed',
        closed_at = pg_catalog.now(),
        closed_by = v_caller_id,
        updated_at = pg_catalog.now()
    WHERE id = p_period_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_PERIOD_CLOSED', 'kpi_periods', p_period_id,
        to_jsonb(v_old_row), to_jsonb(v_new_row)
    );

    RETURN jsonb_build_object('success', true, 'period', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.close_kpi_period(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.close_kpi_period(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_kpi_review(
    p_period_id UUID,
    p_employee_id UUID,
    p_rating NUMERIC,
    p_comment TEXT
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
    v_org_id UUID;
    v_period RECORD;
    v_emp RECORD;
    v_comment TEXT;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only managers, HR, or administrators can submit KPI reviews.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role IN ('hr', 'admin') THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for HR/Admin KPI reviews.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Separation of duties prevents reviewing your own KPI performance.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_period FROM public.kpi_periods WHERE id = p_period_id;
    IF v_period IS NULL OR v_period.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI period not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_period.status = 'closed' THEN
        RAISE EXCEPTION 'Closed KPI periods are immutable and cannot be reviewed.' USING ERRCODE = '22023';
    END IF;

    SELECT e.* INTO v_emp
    FROM public.employees e
    JOIN public.organization_members om
      ON om.user_id = e.id
     AND om.organization_id = e.organization_id
     AND om.status = 'active'
    WHERE e.id = p_employee_id
      AND e.organization_id = v_org_id;

    IF v_emp IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Target employee not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_role = 'manager' AND v_emp.manager_id IS DISTINCT FROM v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Managers can only submit KPI reviews for direct reports.' USING ERRCODE = '42501';
    END IF;

    IF p_rating IS NULL OR p_rating < 1.0 OR p_rating > 5.0 THEN
        RAISE EXCEPTION 'rating must be between 1.0 and 5.0.' USING ERRCODE = '22023';
    END IF;

    v_comment := pg_catalog.btrim(COALESCE(p_comment, ''));
    IF char_length(v_comment) < 1 THEN
        RAISE EXCEPTION 'Review comment cannot be empty.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_old_row
    FROM public.kpi_reviews
    WHERE period_id = p_period_id AND employee_id = p_employee_id
    FOR UPDATE;

    IF v_old_row IS NOT NULL THEN
        UPDATE public.kpi_reviews
        SET reviewer_id = v_caller_id,
            rating = ROUND(p_rating, 1),
            comment = v_comment,
            updated_at = pg_catalog.now()
        WHERE id = v_old_row.id
        RETURNING * INTO v_new_row;
    ELSE
        INSERT INTO public.kpi_reviews (
            organization_id, period_id, employee_id, reviewer_id, rating, comment
        ) VALUES (
            v_org_id, p_period_id, p_employee_id, v_caller_id, ROUND(p_rating, 1), v_comment
        )
        RETURNING * INTO v_new_row;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_REVIEW_SUBMITTED', 'kpi_reviews', v_new_row.id,
        CASE WHEN v_old_row IS NOT NULL THEN to_jsonb(v_old_row) ELSE NULL END,
        to_jsonb(v_new_row)
    );

    INSERT INTO public.notifications (
        organization_id, user_id, type, title, body, link, metadata
    ) VALUES (
        v_org_id,
        p_employee_id,
        'kpi_review',
        'KPI Review Posted',
        'Your performance review for "' || v_period.name || '" has been submitted (Rating: ' || ROUND(p_rating, 1)::text || '/5).',
        '/kpi?period=' || p_period_id::text,
        jsonb_build_object('period_id', p_period_id, 'review_id', v_new_row.id, 'rating', ROUND(p_rating, 1))
    );

    RETURN jsonb_build_object('success', true, 'review', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.submit_kpi_review(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_kpi_review(UUID, UUID, NUMERIC, TEXT) TO authenticated;



-- ============================================================================
-- Migration 16: Final Review Security Hardening, Timezone-Correct 15-Min Crons,
--               & Automated Retention Archiver Schedule
-- ============================================================================

-- ============================================================================
-- SECTION 1: UUID Argument Cross-Tenant Validation Hardening (Item 1)
-- ============================================================================

-- 1a. hr_adjust_balance: validate p_leave_type_id belongs to v_caller_org
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can adjust leave balances.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to adjust leave balances.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_employee_id = v_caller_id THEN
        RAISE EXCEPTION 'Separation of duties: HR and Admins cannot adjust their own leave balance.' USING ERRCODE = '42501';
    END IF;

    IF p_employee_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.employees WHERE id = p_employee_id AND organization_id = v_caller_org
    ) THEN
        RAISE EXCEPTION 'Employee does not belong to caller organization.' USING ERRCODE = '22023';
    END IF;

    IF p_leave_type_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.leave_types WHERE id = p_leave_type_id AND organization_id = v_caller_org
    ) THEN
        RAISE EXCEPTION 'Cross-tenant violation: Leave type does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, CURRENT_DATE);

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

    INSERT INTO public.leave_balance_adjustments (
        organization_id, employee_id, leave_type_id, adjusted_by, amount, reason
    ) VALUES (
        v_caller_org, p_employee_id, p_leave_type_id, v_caller_id, p_amount, p_reason
    ) RETURNING id INTO v_adj_id;

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

REVOKE ALL ON FUNCTION public.hr_adjust_balance(UUID, UUID, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_adjust_balance(UUID, UUID, NUMERIC, TEXT) TO authenticated;

-- 1b. hr_assign_leave: validate p_leave_type_id belongs to v_caller_org and array/date inputs are valid
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
    v_curr DATE;
    v_locked BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR and Admins can assign leave.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for assigning leave.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_employee_ids IS NULL OR pg_catalog.cardinality(p_employee_ids) = 0 THEN
        RAISE EXCEPTION 'At least one employee_id is required.' USING ERRCODE = '22023';
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_end_date < p_start_date THEN
        RAISE EXCEPTION 'end_date must be on or after start_date.' USING ERRCODE = '22023';
    END IF;

    IF p_leave_type_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM public.leave_types
        WHERE id = p_leave_type_id AND organization_id = v_caller_org AND is_active = TRUE
    ) THEN
        RAISE EXCEPTION 'Forbidden: Active leave type not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_caller_id = ANY(p_employee_ids) THEN
        RAISE EXCEPTION 'Separation of duties: HR and Admins cannot assign leave for themselves.' USING ERRCODE = '42501';
    END IF;

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(v_caller_org, p_start_date);

    FOREACH v_emp_id IN ARRAY p_employee_ids LOOP
        IF v_emp_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.employees WHERE id = v_emp_id AND organization_id = v_caller_org
        ) THEN
            RAISE EXCEPTION 'Employee % does not belong to caller organization.', v_emp_id USING ERRCODE = '22023';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = v_caller_org
              AND employee_id = v_emp_id
              AND work_date BETWEEN p_start_date AND p_end_date
              AND locked = TRUE
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot assign leave for employee %: includes locked month dates.', v_emp_id USING ERRCODE = '22023';
        END IF;

        v_total_days := public.calculate_working_days(v_emp_id, p_start_date, p_end_date, p_day_part);
        IF v_total_days > 0 THEN
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

            UPDATE public.leave_balances
            SET used = used + v_total_days,
                updated_at = pg_catalog.now()
            WHERE organization_id = v_caller_org
              AND employee_id = v_emp_id
              AND leave_type_id = p_leave_type_id
              AND period_start = v_p_start
              AND period_end = v_p_end;

            INSERT INTO public.leave_requests (
                organization_id, employee_id, leave_type_id, start_date, end_date,
                day_part, total_days, reason, status, reviewed_by, reviewed_at
            ) VALUES (
                v_caller_org, v_emp_id, p_leave_type_id, p_start_date, p_end_date,
                p_day_part, v_total_days, p_reason, 'approved', v_caller_id, pg_catalog.now()
            ) RETURNING id INTO v_req_id;

            v_curr := p_start_date;
            WHILE v_curr <= p_end_date LOOP
                PERFORM public.recalculate_day(v_emp_id, v_curr);
                v_curr := v_curr + 1;
            END LOOP;

            INSERT INTO public.audit_logs (
                organization_id, actor_id, action, table_name, record_id, old_data, new_data
            ) VALUES (
                v_caller_org, v_caller_id, 'LEAVE_ASSIGNED', 'leave_requests', v_req_id,
                NULL,
                jsonb_build_object(
                    'employee_id', v_emp_id,
                    'leave_type_id', p_leave_type_id,
                    'start_date', p_start_date,
                    'end_date', p_end_date,
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

REVOKE ALL ON FUNCTION public.hr_assign_leave(UUID[], UUID, DATE, DATE, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_assign_leave(UUID[], UUID, DATE, DATE, TEXT, TEXT, BOOLEAN) TO authenticated;

-- 1c. calculate_working_days: enforce tenant check BEFORE reversed-date shortcut
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
    v_caller_id UUID;
    v_caller_org UUID;
    v_org_id UUID;
    v_dept_id UUID;
    v_loc_id UUID;
    v_weekly_offs INTEGER[];
    v_curr DATE;
    v_dow INTEGER;
    v_count NUMERIC := 0;
    v_is_holiday BOOLEAN;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;
        v_caller_org := public.current_org_id();
    END IF;

    SELECT organization_id, department_id, primary_location_id
    INTO v_org_id, v_dept_id, v_loc_id
    FROM public.employees
    WHERE id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN 0;
    END IF;

    IF v_caller_id IS NOT NULL AND v_org_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Employee does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    IF p_start_date IS NULL OR p_end_date IS NULL OR p_start_date > p_end_date THEN
        RETURN 0;
    END IF;

    IF p_day_part IN ('first_half', 'second_half') AND p_start_date != p_end_date THEN
        RAISE EXCEPTION 'Half day leave must have identical start and end dates.' USING ERRCODE = '22023';
    END IF;

    IF v_loc_id IS NOT NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.locations WHERE id = v_loc_id;
    END IF;
    IF v_weekly_offs IS NULL THEN
        SELECT weekly_off_days INTO v_weekly_offs FROM public.attendance_policies WHERE organization_id = v_org_id LIMIT 1;
    END IF;
    IF v_weekly_offs IS NULL THEN
        v_weekly_offs := '{0, 6}'::INTEGER[];
    END IF;

    v_curr := p_start_date;
    WHILE v_curr <= p_end_date LOOP
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;

        IF NOT (v_dow = ANY(v_weekly_offs)) THEN
            SELECT EXISTS (
                SELECT 1 FROM public.holidays
                WHERE organization_id = v_org_id
                  AND date = v_curr
                  AND is_active = TRUE
            ) INTO v_is_holiday;

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

REVOKE ALL ON FUNCTION public.calculate_working_days(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_working_days(UUID, DATE, DATE, TEXT) TO authenticated;

-- 1d. admin_add_org_member, admin_remove_org_member, admin_update_org_member_role: require explicit non-null org & ERRCODE 42501
CREATE OR REPLACE FUNCTION public.admin_add_org_member(
    p_organization_id UUID,
    p_user_id UUID,
    p_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can add organization members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'organization_id is required.' USING ERRCODE = '22023';
    END IF;

    IF p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.' USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required.' USING ERRCODE = '22023';
    END IF;

    IF p_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_role;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE user_id = p_user_id AND organization_id IS DISTINCT FROM v_caller_org
    ) THEN
        RAISE EXCEPTION 'Cross-tenant violation: Target user belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    INSERT INTO public.organization_members (organization_id, user_id, role, status)
    VALUES (v_caller_org, p_user_id, p_role, 'active')
    ON CONFLICT (user_id) DO UPDATE
    SET role = p_role, status = 'active', updated_at = pg_catalog.now()
    WHERE public.organization_members.organization_id = v_caller_org;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_ADDED', 'organization_members', p_user_id,
        NULL, jsonb_build_object('user_id', p_user_id, 'role', p_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_add_org_member(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_add_org_member(UUID, UUID, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_remove_org_member(
    p_organization_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
    v_old_data JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can remove organization members.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'organization_id is required.' USING ERRCODE = '22023';
    END IF;

    IF p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.' USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required.' USING ERRCODE = '22023';
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role, to_jsonb(m.*) INTO v_current_role, v_old_data
    FROM public.organization_members m
    WHERE m.organization_id = v_caller_org AND m.user_id = p_user_id;

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    IF v_current_role = 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot remove yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot remove the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    DELETE FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_REMOVED', 'organization_members', p_user_id,
        v_old_data,
        jsonb_build_object('user_id', p_user_id, 'removed_role', v_current_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_remove_org_member(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_remove_org_member(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_org_member_role(
    p_organization_id UUID,
    p_user_id UUID,
    p_new_role TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
    v_current_role TEXT;
    v_admin_count INTEGER;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    v_caller_org := public.current_org_id();

    IF v_caller_role IS DISTINCT FROM 'admin' OR v_caller_org IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can update member roles.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for member administration.' USING ERRCODE = '42501';
    END IF;

    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'organization_id is required.' USING ERRCODE = '22023';
    END IF;

    IF p_organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Cannot manage members of another organization.' USING ERRCODE = '42501';
    END IF;

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'user_id is required.' USING ERRCODE = '22023';
    END IF;

    IF p_new_role NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid role: %', p_new_role;
    END IF;

    PERFORM pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtext('org_admin_lock_' || v_caller_org::text)
    );

    IF NOT EXISTS (
        SELECT 1 FROM public.organization_members
        WHERE organization_id = v_caller_org AND user_id = v_caller_id AND role = 'admin' AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'Forbidden: Caller is no longer an active administrator of the organization.' USING ERRCODE = '42501';
    END IF;

    SELECT role INTO v_current_role
    FROM public.organization_members
    WHERE organization_id = v_caller_org AND user_id = p_user_id AND status = 'active';

    IF v_current_role IS NULL THEN
        RAISE EXCEPTION 'Member not found in organization.';
    END IF;

    IF v_current_role = 'admin' AND p_new_role != 'admin' THEN
        SELECT COUNT(*) INTO v_admin_count
        FROM public.organization_members
        WHERE organization_id = v_caller_org AND role = 'admin' AND status = 'active';

        IF v_admin_count <= 1 THEN
            IF v_caller_id = p_user_id THEN
                RAISE EXCEPTION 'Last admin protection: Cannot demote yourself as the last active administrator.';
            ELSE
                RAISE EXCEPTION 'Last admin protection: Cannot demote the last active administrator of the organization.';
            END IF;
        END IF;
    END IF;

    UPDATE public.organization_members
    SET role = p_new_role, updated_at = pg_catalog.now()
    WHERE organization_id = v_caller_org AND user_id = p_user_id;

    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, old_data, new_data)
    VALUES (
        v_caller_org, v_caller_id, 'MEMBER_ROLE_UPDATED', 'organization_members', p_user_id,
        jsonb_build_object('user_id', p_user_id, 'role', v_current_role),
        jsonb_build_object('user_id', p_user_id, 'old_role', v_current_role, 'new_role', p_new_role)
    );

    RETURN jsonb_build_object('success', true);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_org_member_role(UUID, UUID, TEXT) TO authenticated;

-- 1e. admin_update_department: block self-parent cycle
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
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or Admins can update departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to update departments.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    SELECT organization_id, to_jsonb(d.*)
    INTO v_dept_org, v_old_data
    FROM public.departments d
    WHERE id = p_department_id;

    IF v_dept_org IS NULL OR v_dept_org IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Department not found in caller organization.' USING ERRCODE = '02000';
    END IF;

    IF p_parent_department_id IS NOT NULL AND p_parent_department_id = p_department_id THEN
        RAISE EXCEPTION 'A department cannot be its own parent.' USING ERRCODE = '22023';
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

-- ============================================================================
-- SECTION 2: Timezone-Correct Per-Org / Per-Location 15-Min Crons (Item 3)
-- ============================================================================

ALTER TABLE public.cron_run_state
    ADD COLUMN IF NOT EXISTS timezone_key TEXT NOT NULL DEFAULT 'UTC',
    ADD COLUMN IF NOT EXISTS processed_count INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.cron_run_state DROP CONSTRAINT IF EXISTS uq_cron_run_state;
ALTER TABLE public.cron_run_state ADD CONSTRAINT uq_cron_run_state
    UNIQUE (job_name, organization_id, location_id, timezone_key, target_date);

DROP FUNCTION IF EXISTS public.cron_auto_checkout();
DROP FUNCTION IF EXISTS public.cron_nightly_finalize();

-- 2a. Timezone-aware, idempotent, failure-isolated Auto-Checkout Cron
CREATE OR REPLACE FUNCTION public.cron_auto_checkout(
    p_now TIMESTAMPTZ DEFAULT pg_catalog.now()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := COALESCE(p_now, pg_catalog.now());
    v_nil_loc CONSTANT UUID := '00000000-0000-0000-0000-000000000000'::uuid;
    v_closed_count INTEGER := 0;
    v_org RECORD;
    v_scope RECORD;
    v_session RECORD;
    v_local_now TIMESTAMP;
    v_local_date DATE;
    v_local_time TIME;
    v_target_date DATE;
    v_sess_date DATE;
    v_cutoff_ts TIMESTAMPTZ;
    v_checkout_ts TIMESTAMPTZ;
    v_org_closed INTEGER := 0;
    v_scope_closed INTEGER := 0;
    v_err TEXT;
BEGIN
    FOR v_org IN
        SELECT
            o.id,
            COALESCE(o.work_mode, 'remote') AS work_mode,
            COALESCE(NULLIF(o.timezone, ''), 'UTC') AS timezone,
            COALESCE(ap.auto_checkout_time, TIME '23:59:00') AS auto_checkout_time
        FROM public.organizations o
        LEFT JOIN LATERAL (
            SELECT auto_checkout_time
            FROM public.attendance_policies
            WHERE organization_id = o.id
              AND is_active = TRUE
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
        ) ap ON TRUE
        WHERE o.status IN ('active', 'trial')
        ORDER BY o.created_at ASC, o.id ASC
    LOOP
        v_org_closed := 0;

        BEGIN
            FOR v_scope IN
                SELECT DISTINCT scope.loc_key, scope.eff_tz
                FROM (
                    -- Org fallback scope
                    SELECT v_nil_loc AS loc_key, v_org.timezone AS eff_tz
                    UNION
                    -- Active office locations
                    SELECT l.id AS loc_key, COALESCE(NULLIF(l.timezone, ''), v_org.timezone, 'UTC') AS eff_tz
                    FROM public.locations l
                    WHERE l.organization_id = v_org.id
                      AND l.is_active = TRUE
                    UNION
                    -- Active employees' effective scopes
                    SELECT
                        CASE
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(e.primary_location_id, v_nil_loc)
                            ELSE v_nil_loc
                        END AS loc_key,
                        CASE
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                            ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                        END AS eff_tz
                    FROM public.employees e
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE e.organization_id = v_org.id
                      AND e.status = 'active'
                    UNION
                    -- Open sessions' exact resolved scopes (e.g. hybrid employee punching into office location)
                    SELECT
                        CASE
                            WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                            THEN COALESCE(s.location_id, e.primary_location_id, v_nil_loc)
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(e.primary_location_id, v_nil_loc)
                            ELSE v_nil_loc
                        END AS loc_key,
                        CASE
                            WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                            THEN COALESCE(NULLIF(sl.timezone, ''), NULLIF(el.timezone, ''), v_org.timezone, 'UTC')
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                            ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                        END AS eff_tz
                    FROM public.attendance_sessions s
                    JOIN public.employees e ON e.id = s.employee_id
                    LEFT JOIN public.locations sl ON sl.id = s.location_id
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE s.organization_id = v_org.id
                      AND s.check_out_at IS NULL
                ) scope
                ORDER BY scope.loc_key, scope.eff_tz
            LOOP
                v_scope_closed := 0;
                v_local_now := v_now AT TIME ZONE v_scope.eff_tz;
                v_local_date := v_local_now::date;
                v_local_time := v_local_now::time;

                -- Determine the latest local date whose policy auto_checkout_time has passed
                IF v_local_time >= v_org.auto_checkout_time THEN
                    v_target_date := v_local_date;
                ELSE
                    v_target_date := v_local_date - 1;
                END IF;

                -- Strictly idempotent per (job, org, location, timezone, target_date)
                IF EXISTS (
                    SELECT 1 FROM public.cron_run_state crs
                    WHERE crs.job_name = 'auto_checkout'
                      AND crs.organization_id = v_org.id
                      AND crs.location_id = v_scope.loc_key
                      AND crs.timezone_key = v_scope.eff_tz
                      AND crs.target_date = v_target_date
                      AND crs.status = 'success'
                ) THEN
                    CONTINUE;
                END IF;

                FOR v_session IN
                    SELECT
                        s.id,
                        s.employee_id,
                        s.check_in_at
                    FROM public.attendance_sessions s
                    JOIN public.employees e ON e.id = s.employee_id
                    LEFT JOIN public.locations sl ON sl.id = s.location_id
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE s.organization_id = v_org.id
                      AND s.check_out_at IS NULL
                      AND (
                          CASE
                              WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                              THEN COALESCE(s.location_id, e.primary_location_id, v_nil_loc)
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(e.primary_location_id, v_nil_loc)
                              ELSE v_nil_loc
                          END
                      ) = v_scope.loc_key
                      AND (
                          CASE
                              WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                              THEN COALESCE(NULLIF(sl.timezone, ''), NULLIF(el.timezone, ''), v_org.timezone, 'UTC')
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                              ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                          END
                      ) = v_scope.eff_tz
                    ORDER BY s.check_in_at ASC, s.id ASC
                LOOP
                    v_sess_date := (v_session.check_in_at AT TIME ZONE v_scope.eff_tz)::date;
                    IF v_sess_date > v_target_date THEN
                        CONTINUE;
                    END IF;

                    v_cutoff_ts := (v_sess_date + v_org.auto_checkout_time) AT TIME ZONE v_scope.eff_tz;
                    IF v_session.check_in_at >= v_cutoff_ts THEN
                        v_cutoff_ts := ((v_sess_date + 1) + v_org.auto_checkout_time) AT TIME ZONE v_scope.eff_tz;
                    END IF;

                    IF v_cutoff_ts <= v_now THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM public.attendance_days d
                            WHERE d.organization_id = v_org.id
                              AND d.employee_id = v_session.employee_id
                              AND d.work_date = v_sess_date
                              AND d.locked = TRUE
                        ) THEN
                            v_checkout_ts := GREATEST(v_session.check_in_at + INTERVAL '1 minute', LEAST(v_now, v_cutoff_ts));

                            UPDATE public.attendance_sessions
                            SET check_out_at = v_checkout_ts,
                                source = 'auto',
                                note = COALESCE(note, '') || ' [Auto-closed at policy cutoff ' || v_scope.eff_tz || ']'
                            WHERE id = v_session.id;

                            PERFORM public.recalculate_day(v_session.employee_id, v_sess_date);

                            INSERT INTO public.notifications (
                                organization_id, user_id, type, title, body, link, metadata
                            ) VALUES (
                                v_org.id,
                                v_session.employee_id,
                                'missed_checkout',
                                'Missed Checkout Auto-Closed',
                                'Your open shift from ' || v_sess_date::text || ' passed the organization auto-checkout cutoff (' || v_org.auto_checkout_time::text || ' ' || v_scope.eff_tz || ') and was closed automatically.',
                                '/requests',
                                jsonb_build_object(
                                    'session_id', v_session.id,
                                    'work_date', v_sess_date,
                                    'timezone', v_scope.eff_tz,
                                    'cutoff_at', v_cutoff_ts
                                )
                            );

                            v_scope_closed := v_scope_closed + 1;
                            v_org_closed := v_org_closed + 1;
                        END IF;
                    END IF;
                END LOOP;

                INSERT INTO public.cron_run_state (
                    job_name, organization_id, location_id, timezone_key, target_date,
                    status, error_message, processed_count, executed_at
                ) VALUES (
                    'auto_checkout', v_org.id, v_scope.loc_key, v_scope.eff_tz, v_target_date,
                    'success', NULL, v_scope_closed, v_now
                )
                ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
                SET status = 'success',
                    error_message = NULL,
                    processed_count = EXCLUDED.processed_count,
                    executed_at = EXCLUDED.executed_at
                WHERE public.cron_run_state.status IS DISTINCT FROM 'success';
            END LOOP;

            v_closed_count := v_closed_count + v_org_closed;
        EXCEPTION WHEN OTHERS THEN
            v_err := SQLERRM;
            INSERT INTO public.cron_run_state (
                job_name, organization_id, location_id, timezone_key, target_date,
                status, error_message, processed_count, executed_at
            ) VALUES (
                'auto_checkout', v_org.id, v_nil_loc, v_org.timezone,
                (v_now AT TIME ZONE 'UTC')::date, 'failed', v_err, 0, v_now
            )
            ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
            SET status = CASE WHEN public.cron_run_state.status = 'success' THEN 'success' ELSE 'failed' END,
                error_message = COALESCE(EXCLUDED.error_message, public.cron_run_state.error_message),
                executed_at = EXCLUDED.executed_at;
        END;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout(TIMESTAMPTZ) TO service_role;

-- 2b. Timezone-aware, idempotent, failure-isolated Nightly Finalize Cron
CREATE OR REPLACE FUNCTION public.cron_nightly_finalize(
    p_now TIMESTAMPTZ DEFAULT pg_catalog.now()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := COALESCE(p_now, pg_catalog.now());
    v_nil_loc CONSTANT UUID := '00000000-0000-0000-0000-000000000000'::uuid;
    v_finalize_cutoff CONSTANT TIME := TIME '01:00:00';
    v_marked_count INTEGER := 0;
    v_org RECORD;
    v_scope RECORD;
    v_emp RECORD;
    v_local_now TIMESTAMP;
    v_local_date DATE;
    v_local_time TIME;
    v_target_date DATE;
    v_org_marked INTEGER := 0;
    v_scope_marked INTEGER := 0;
    v_err TEXT;
BEGIN
    FOR v_org IN
        SELECT
            o.id,
            COALESCE(o.work_mode, 'remote') AS work_mode,
            COALESCE(NULLIF(o.timezone, ''), 'UTC') AS timezone
        FROM public.organizations o
        WHERE o.status IN ('active', 'trial')
        ORDER BY o.created_at ASC, o.id ASC
    LOOP
        v_org_marked := 0;

        BEGIN
            FOR v_scope IN
                SELECT DISTINCT scope.loc_key, scope.eff_tz
                FROM (
                    SELECT v_nil_loc AS loc_key, v_org.timezone AS eff_tz
                    UNION
                    SELECT l.id AS loc_key, COALESCE(NULLIF(l.timezone, ''), v_org.timezone, 'UTC') AS eff_tz
                    FROM public.locations l
                    WHERE l.organization_id = v_org.id
                      AND l.is_active = TRUE
                    UNION
                    SELECT
                        CASE
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(e.primary_location_id, v_nil_loc)
                            ELSE v_nil_loc
                        END AS loc_key,
                        CASE
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                            ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                        END AS eff_tz
                    FROM public.employees e
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE e.organization_id = v_org.id
                      AND e.status = 'active'
                ) scope
                ORDER BY scope.loc_key, scope.eff_tz
            LOOP
                v_scope_marked := 0;
                v_local_now := v_now AT TIME ZONE v_scope.eff_tz;
                v_local_date := v_local_now::date;
                v_local_time := v_local_now::time;

                -- Only finalize yesterday once local time passes 01:00 AM policy finalize window
                IF v_local_time < v_finalize_cutoff THEN
                    CONTINUE;
                END IF;

                v_target_date := v_local_date - 1;

                IF EXISTS (
                    SELECT 1 FROM public.cron_run_state crs
                    WHERE crs.job_name = 'nightly_finalize'
                      AND crs.organization_id = v_org.id
                      AND crs.location_id = v_scope.loc_key
                      AND crs.timezone_key = v_scope.eff_tz
                      AND crs.target_date = v_target_date
                      AND crs.status = 'success'
                ) THEN
                    CONTINUE;
                END IF;

                FOR v_emp IN
                    SELECT e.id
                    FROM public.employees e
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE e.organization_id = v_org.id
                      AND e.status = 'active'
                      AND (
                          CASE
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(e.primary_location_id, v_nil_loc)
                              ELSE v_nil_loc
                          END
                      ) = v_scope.loc_key
                      AND (
                          CASE
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                              ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                          END
                      ) = v_scope.eff_tz
                LOOP
                    IF NOT EXISTS (
                        SELECT 1 FROM public.attendance_days d
                        WHERE d.organization_id = v_org.id
                          AND d.employee_id = v_emp.id
                          AND d.work_date = v_target_date
                    ) THEN
                        PERFORM public.recalculate_day(v_emp.id, v_target_date);
                        v_scope_marked := v_scope_marked + 1;
                        v_org_marked := v_org_marked + 1;
                    END IF;
                END LOOP;

                INSERT INTO public.cron_run_state (
                    job_name, organization_id, location_id, timezone_key, target_date,
                    status, error_message, processed_count, executed_at
                ) VALUES (
                    'nightly_finalize', v_org.id, v_scope.loc_key, v_scope.eff_tz, v_target_date,
                    'success', NULL, v_scope_marked, v_now
                )
                ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
                SET status = 'success',
                    error_message = NULL,
                    processed_count = EXCLUDED.processed_count,
                    executed_at = EXCLUDED.executed_at
                WHERE public.cron_run_state.status IS DISTINCT FROM 'success';
            END LOOP;

            v_marked_count := v_marked_count + v_org_marked;
        EXCEPTION WHEN OTHERS THEN
            v_err := SQLERRM;
            INSERT INTO public.cron_run_state (
                job_name, organization_id, location_id, timezone_key, target_date,
                status, error_message, processed_count, executed_at
            ) VALUES (
                'nightly_finalize', v_org.id, v_nil_loc, v_org.timezone,
                (v_now AT TIME ZONE 'UTC')::date, 'failed', v_err, 0, v_now
            )
            ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
            SET status = CASE WHEN public.cron_run_state.status = 'success' THEN 'success' ELSE 'failed' END,
                error_message = COALESCE(EXCLUDED.error_message, public.cron_run_state.error_message),
                executed_at = EXCLUDED.executed_at;
        END;
    END LOOP;

    RETURN v_marked_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_nightly_finalize(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_nightly_finalize(TIMESTAMPTZ) TO service_role;

-- ============================================================================
-- SECTION 3: Automated Retention Archive Dispatch + pg_cron Schedules (Item 4)
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pg_net";

CREATE OR REPLACE FUNCTION public.cron_trigger_retention_archive()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_url TEXT;
    v_token TEXT;
    v_req_id BIGINT;
BEGIN
    SELECT decrypted_secret INTO v_url
    FROM vault.decrypted_secrets
    WHERE name = 'retention_archiver_url'
    LIMIT 1;

    IF v_url IS NULL OR pg_catalog.btrim(v_url) = '' THEN
        RETURN jsonb_build_object(
            'dispatched', false,
            'reason', 'Vault secret retention_archiver_url not configured'
        );
    END IF;

    SELECT decrypted_secret INTO v_token
    FROM vault.decrypted_secrets
    WHERE name = 'retention_archiver_token'
    LIMIT 1;

    SELECT net.http_post(
        url := v_url,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || COALESCE(v_token, '')
        ),
        body := jsonb_build_object(
            'trigger', 'pg_cron',
            'scheduled_at', pg_catalog.now()
        )
    ) INTO v_req_id;

    RETURN jsonb_build_object(
        'dispatched', true,
        'request_id', v_req_id,
        'url', v_url
    );
END;
$$;

REVOKE ALL ON FUNCTION public.cron_trigger_retention_archive() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_trigger_retention_archive() TO service_role;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-auto-checkout') THEN
            PERFORM cron.unschedule('nightly-auto-checkout');
        END IF;
        PERFORM cron.schedule(
            'nightly-auto-checkout',
            '*/15 * * * *',
            'SELECT public.cron_auto_checkout();'
        );

        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'nightly-finalize-attendance') THEN
            PERFORM cron.unschedule('nightly-finalize-attendance');
        END IF;
        PERFORM cron.schedule(
            'nightly-finalize-attendance',
            '*/15 * * * *',
            'SELECT public.cron_nightly_finalize();'
        );

        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-retention-archive') THEN
            PERFORM cron.unschedule('weekly-retention-archive');
        END IF;
        PERFORM cron.schedule(
            'weekly-retention-archive',
            '0 2 * * 0',
            'SELECT public.cron_trigger_retention_archive();'
        );

        IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-retention-cleanup') THEN
            PERFORM cron.schedule(
                'weekly-retention-cleanup',
                '0 3 * * 0',
                'SELECT public.run_retention_cleanup(false);'
            );
        END IF;
    END IF;
END $$;


-- ============================================================================
-- Migration 17: Final Security & KPI Accuracy Fixes
--
-- Addresses:
-- 1. Item 2: Restrict `get_user_role(uuid)` to self, active HR, or active Admin
--    (AAL2 required for non-self queries) within the caller's active organization.
-- 2. Item 4(a): Nullable `kpi_scores.actual_value` / `kpi_scores.score` and
--    NULL return in `calculate_kpi_score(NULL, ...)` so metrics with no
--    underlying data produce NULL ("No data" / "Not scored") instead of 0/100.
-- 3. Item 4(b): Convert `tasks.completed_at` and current-date overdue comparisons
--    using each employee's effective timezone (location TZ for office mode,
--    employee TZ -> org TZ fallback otherwise).
-- 4. Item 4(c): `leave_days_taken` calculates working days via
--    `calculate_working_days(...)` across the period-clipped range for
--    straddling leave requests, and excludes `sick` / `statutory` leave types
--    by default (`leave_types.counts_toward_kpi`, configurable per leave type
--    via `hr_update_leave_type_kpi_setting`).
-- 5. Item 4(d): `tasks_overdue` counts open overdue tasks ONCE in the period
--    containing `due_date` (`due_date BETWEEN start_date AND end_date AND
--    due_date < local_today`), preventing repeated carry-over across later months.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- SECTION 1: Restrict get_user_role(uuid) to Self, HR, or Admin
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_user_role(p_user_id UUID)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_role TEXT;
    v_caller_id UUID;
    v_caller_org UUID;
    v_caller_role TEXT;
    v_caller_aal TEXT;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NOT NULL THEN
        IF NOT public.is_active_org_member() THEN
            RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
        END IF;

        v_caller_org := public.current_org_id();
        v_caller_role := public.current_user_role();

        IF p_user_id IS DISTINCT FROM v_caller_id THEN
            IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
                RAISE EXCEPTION 'Forbidden: You may only query your own role unless authorized as HR or admin.' USING ERRCODE = '42501';
            END IF;

            v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
            IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
                RAISE EXCEPTION 'MFA AAL2 required to query another user''s role.' USING ERRCODE = '42501';
            END IF;
        END IF;

        SELECT om.role INTO v_role
        FROM public.organization_members om
        WHERE om.user_id = p_user_id
          AND om.organization_id = v_caller_org
          AND om.status = 'active'
        LIMIT 1;

        RETURN v_role;
    END IF;

    -- System / service_role lookup when auth.uid() is NULL
    SELECT om.role INTO v_role
    FROM public.organization_members om
    WHERE om.user_id = p_user_id
      AND om.status = 'active'
    LIMIT 1;

    RETURN v_role;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_role(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(UUID) TO authenticated, service_role;

-- ----------------------------------------------------------------------------
-- SECTION 2: Leave Type KPI Inclusion Flag & Hardened Configuration RPC
-- ----------------------------------------------------------------------------

ALTER TABLE public.leave_types
    ADD COLUMN IF NOT EXISTS counts_toward_kpi BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE public.leave_types
SET counts_toward_kpi = FALSE
WHERE UPPER(code) IN ('SICK', 'SL', 'STATUTORY', 'MATERNITY', 'PATERNITY', 'BEREAVEMENT', 'MEDICAL')
   OR LOWER(name) ~ '(sick|statutory|medical|maternity|paternity|bereavement|public\s+holiday)';

CREATE OR REPLACE FUNCTION public.hr_update_leave_type_kpi_setting(
    p_leave_type_id UUID,
    p_counts_toward_kpi BOOLEAN
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
    v_old RECORD;
    v_new RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators may configure leave type KPI counting.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 required for configuring leave types.' USING ERRCODE = '42501';
    END IF;

    v_caller_org := public.current_org_id();

    IF p_leave_type_id IS NULL THEN
        RAISE EXCEPTION 'leave_type_id is required.' USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_old
    FROM public.leave_types
    WHERE id = p_leave_type_id
    FOR UPDATE;

    IF v_old IS NULL OR v_old.organization_id IS DISTINCT FROM v_caller_org THEN
        RAISE EXCEPTION 'Cross-tenant violation: Leave type not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    UPDATE public.leave_types
    SET counts_toward_kpi = COALESCE(p_counts_toward_kpi, TRUE),
        updated_at = pg_catalog.now()
    WHERE id = p_leave_type_id
      AND organization_id = v_caller_org
    RETURNING * INTO v_new;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_caller_org,
        v_caller_id,
        'LEAVE_TYPE_KPI_SETTING_UPDATED',
        'leave_types',
        p_leave_type_id,
        jsonb_build_object('code', v_old.code, 'name', v_old.name, 'counts_toward_kpi', v_old.counts_toward_kpi),
        jsonb_build_object('code', v_new.code, 'name', v_new.name, 'counts_toward_kpi', v_new.counts_toward_kpi)
    );

    RETURN jsonb_build_object('success', true, 'leave_type', to_jsonb(v_new));
END;
$$;

REVOKE ALL ON FUNCTION public.hr_update_leave_type_kpi_setting(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.hr_update_leave_type_kpi_setting(UUID, BOOLEAN) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 3: Nullable Unscored KPI Snapshots & NULL-Preserving Scoring
-- ----------------------------------------------------------------------------

ALTER TABLE public.kpi_scores
    ALTER COLUMN actual_value DROP DEFAULT,
    ALTER COLUMN actual_value DROP NOT NULL,
    ALTER COLUMN score DROP NOT NULL;

DO $$
DECLARE
    v_con RECORD;
BEGIN
    FOR v_con IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'public.kpi_scores'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) ~ 'score'
    LOOP
        EXECUTE format('ALTER TABLE public.kpi_scores DROP CONSTRAINT %I', v_con.conname);
    END LOOP;
END $$;

ALTER TABLE public.kpi_scores
    ADD CONSTRAINT kpi_scores_score_check
    CHECK (score IS NULL OR (score >= 0 AND score <= 100));

CREATE OR REPLACE FUNCTION public.calculate_kpi_score(
    p_actual NUMERIC,
    p_target NUMERIC,
    p_direction TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
SET search_path = ''
AS $$
DECLARE
    v_target NUMERIC;
    v_score NUMERIC;
BEGIN
    IF p_direction IS NULL OR p_direction NOT IN ('higher_is_better', 'lower_is_better') THEN
        RAISE EXCEPTION 'Invalid KPI direction: must be higher_is_better or lower_is_better.' USING ERRCODE = '22023';
    END IF;

    -- No underlying data (NULL) must remain NULL ("not scored"), never 0 or 100
    IF p_actual IS NULL THEN
        RETURN NULL;
    END IF;

    v_target := COALESCE(p_target, 0);

    IF p_direction = 'higher_is_better' THEN
        IF v_target <= 0 THEN
            RETURN CASE WHEN p_actual > 0 THEN 100.00 ELSE 0.00 END;
        END IF;
        v_score := ROUND(GREATEST(0::numeric, LEAST(100::numeric, (p_actual / v_target) * 100.0)), 2);
        RETURN v_score;
    ELSE
        -- lower_is_better
        IF v_target <= 0 THEN
            IF p_actual <= 0 THEN
                RETURN 100.00;
            END IF;
            RETURN ROUND(GREATEST(0::numeric, 100.0 / (1.0 + p_actual)), 2);
        END IF;

        IF p_actual <= v_target THEN
            RETURN 100.00;
        END IF;

        v_score := ROUND(GREATEST(0::numeric, LEAST(100::numeric, (2.0 - (p_actual / v_target)) * 100.0)), 2);
        RETURN v_score;
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_kpi_score(NUMERIC, NUMERIC, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_kpi_score(NUMERIC, NUMERIC, TEXT) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 4: Timezone-Correct, Null-Safe & Period-Scoped compute_kpi_scores
-- ----------------------------------------------------------------------------

-- Allow zero weights for informational KPIs (weight >= 0)
ALTER TABLE public.kpi_definitions DROP CONSTRAINT IF EXISTS kpi_definitions_weight_check;
ALTER TABLE public.kpi_definitions ADD CONSTRAINT kpi_definitions_weight_check CHECK (weight >= 0 AND weight <= 1000);

CREATE OR REPLACE FUNCTION public.upsert_kpi_definition(
    p_name TEXT,
    p_source_metric TEXT,
    p_target_value NUMERIC,
    p_direction TEXT,
    p_weight NUMERIC DEFAULT 1.0,
    p_description TEXT DEFAULT NULL,
    p_applies_to_role TEXT DEFAULT NULL,
    p_applies_to_department_id UUID DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT TRUE,
    p_definition_id UUID DEFAULT NULL
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
    v_org_id UUID;
    v_name TEXT;
    v_desc TEXT;
    v_role_filter TEXT;
    v_old_row RECORD;
    v_new_row RECORD;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can manage KPI definitions.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for KPI definition changes.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    v_name := pg_catalog.btrim(COALESCE(p_name, ''));
    IF char_length(v_name) < 2 THEN
        RAISE EXCEPTION 'KPI name must be at least 2 characters.' USING ERRCODE = '22023';
    END IF;

    IF p_source_metric IS NULL OR p_source_metric NOT IN (
        'attendance_on_time_rate',
        'hours_vs_target',
        'absence_days',
        'leave_days_taken',
        'tasks_completed',
        'tasks_on_time_rate',
        'tasks_overdue',
        'avg_task_cycle_days'
    ) THEN
        RAISE EXCEPTION 'Invalid KPI source metric: %.', p_source_metric USING ERRCODE = '22023';
    END IF;

    IF p_target_value IS NULL OR p_target_value < 0 THEN
        RAISE EXCEPTION 'target_value must be non-negative.' USING ERRCODE = '22023';
    END IF;

    IF p_direction IS NULL OR p_direction NOT IN ('higher_is_better', 'lower_is_better') THEN
        RAISE EXCEPTION 'direction must be higher_is_better or lower_is_better.' USING ERRCODE = '22023';
    END IF;

    IF p_weight IS NULL OR p_weight < 0 OR p_weight > 1000 THEN
        RAISE EXCEPTION 'weight must be between 0 and 1000.' USING ERRCODE = '22023';
    END IF;

    v_role_filter := NULLIF(pg_catalog.btrim(COALESCE(p_applies_to_role, '')), '');
    IF v_role_filter IS NOT NULL AND v_role_filter NOT IN ('employee', 'manager', 'hr', 'admin') THEN
        RAISE EXCEPTION 'Invalid applies_to_role: %.', v_role_filter USING ERRCODE = '22023';
    END IF;

    IF p_applies_to_department_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.departments d
        WHERE d.id = p_applies_to_department_id AND d.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Forbidden: Department not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    v_desc := NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), '');

    IF p_definition_id IS NOT NULL THEN
        SELECT * INTO v_old_row
        FROM public.kpi_definitions
        WHERE id = p_definition_id
        FOR UPDATE;

        IF v_old_row IS NULL OR v_old_row.organization_id IS DISTINCT FROM v_org_id THEN
            RAISE EXCEPTION 'Forbidden: KPI definition not found in caller organization.' USING ERRCODE = '42501';
        END IF;

        UPDATE public.kpi_definitions
        SET name = v_name,
            description = v_desc,
            source_metric = p_source_metric,
            target_value = p_target_value,
            direction = p_direction,
            weight = p_weight,
            applies_to_role = v_role_filter,
            applies_to_department_id = p_applies_to_department_id,
            is_active = COALESCE(p_is_active, TRUE),
            updated_at = pg_catalog.now()
        WHERE id = p_definition_id
        RETURNING * INTO v_new_row;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_org_id, v_caller_id, 'KPI_DEFINITION_UPDATED', 'kpi_definitions', v_new_row.id,
            to_jsonb(v_old_row), to_jsonb(v_new_row)
        );
    ELSE
        INSERT INTO public.kpi_definitions (
            organization_id, name, description, source_metric, target_value, direction,
            weight, applies_to_role, applies_to_department_id, is_active, created_by
        ) VALUES (
            v_org_id, v_name, v_desc, p_source_metric, p_target_value, p_direction,
            p_weight, v_role_filter, p_applies_to_department_id, COALESCE(p_is_active, TRUE), v_caller_id
        )
        RETURNING * INTO v_new_row;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            v_org_id, v_caller_id, 'KPI_DEFINITION_CREATED', 'kpi_definitions', v_new_row.id,
            NULL, to_jsonb(v_new_row)
        );
    END IF;

    RETURN jsonb_build_object('success', true, 'definition', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_kpi_definition(TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, UUID, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.upsert_kpi_definition(TEXT, TEXT, NUMERIC, TEXT, NUMERIC, TEXT, TEXT, UUID, BOOLEAN, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.compute_kpi_scores(
    p_period_id UUID
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
    v_org_id UUID;
    v_org_mode TEXT;
    v_org_tz TEXT;
    v_period RECORD;
    v_emp RECORD;
    v_def RECORD;
    v_lr RECORD;
    v_eff_tz TEXT;
    v_local_today DATE;
    v_att_count INTEGER;
    v_any_leave_count INTEGER;
    v_countable_leave_count INTEGER;
    v_leave_days NUMERIC;
    v_overlap_start DATE;
    v_overlap_end DATE;
    v_day_part TEXT;
    v_actual NUMERIC(12,2);
    v_score NUMERIC(5,2);
    v_written INTEGER := 0;
    v_weighted_summary JSONB;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role NOT IN ('hr', 'admin') THEN
        RAISE EXCEPTION 'Forbidden: Only HR or administrators can compute KPI scores.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for computing KPI scores.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT * INTO v_period
    FROM public.kpi_periods
    WHERE id = p_period_id
    FOR UPDATE;

    IF v_period IS NULL OR v_period.organization_id IS DISTINCT FROM v_org_id THEN
        RAISE EXCEPTION 'Forbidden: KPI period not found in caller organization.' USING ERRCODE = '42501';
    END IF;

    IF v_period.status = 'closed' THEN
        RAISE EXCEPTION 'Closed KPI periods are immutable and cannot be recalculated.' USING ERRCODE = '22023';
    END IF;

    SELECT
        COALESCE(o.work_mode, 'remote'),
        COALESCE(NULLIF(o.timezone, ''), 'UTC')
    INTO v_org_mode, v_org_tz
    FROM public.organizations o
    WHERE o.id = v_org_id;

    -- Wipe previous open-period snapshot rows before writing recomputed snapshots
    DELETE FROM public.kpi_scores WHERE period_id = p_period_id;

    FOR v_emp IN
        SELECT
            e.id,
            e.department_id,
            COALESCE(e.work_target_minutes, 480) AS work_target_minutes,
            e.work_mode,
            e.timezone AS emp_timezone,
            l.timezone AS loc_timezone,
            om.role
        FROM public.employees e
        JOIN public.organization_members om
          ON om.user_id = e.id
         AND om.organization_id = e.organization_id
         AND om.status = 'active'
        LEFT JOIN public.locations l
          ON l.id = e.primary_location_id
        WHERE e.organization_id = v_org_id
          AND e.status = 'active'
    LOOP
        -- Resolve employee effective timezone consistently with attendance & nightly crons
        v_eff_tz := CASE
            WHEN COALESCE(v_emp.work_mode, v_org_mode, 'remote') = 'office'
            THEN COALESCE(NULLIF(v_emp.loc_timezone, ''), NULLIF(v_emp.emp_timezone, ''), v_org_tz, 'UTC')
            ELSE COALESCE(NULLIF(v_emp.emp_timezone, ''), v_org_tz, 'UTC')
        END;
        v_local_today := (pg_catalog.now() AT TIME ZONE v_eff_tz)::date;

        FOR v_def IN
            SELECT *
            FROM public.kpi_definitions d
            WHERE d.organization_id = v_org_id
              AND d.is_active = TRUE
              AND (d.applies_to_role IS NULL OR d.applies_to_role = v_emp.role)
              AND (d.applies_to_department_id IS NULL OR d.applies_to_department_id = v_emp.department_id)
        LOOP
            v_actual := NULL;

            IF v_def.source_metric = 'attendance_on_time_rate' THEN
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day')) = 0 THEN NULL
                        ELSE ROUND(
                            (COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day') AND ad.is_late = FALSE)::numeric /
                             COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day'))::numeric) * 100.0,
                            2
                        )
                    END
                INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'hours_vs_target' THEN
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day', 'absent')) = 0
                             OR COALESCE(v_emp.work_target_minutes, 0) <= 0
                        THEN NULL
                        ELSE ROUND(
                            (COALESCE(SUM(CASE WHEN ad.status IN ('present', 'half_day') THEN ad.total_minutes ELSE 0 END), 0)::numeric /
                             (COUNT(*) FILTER (WHERE ad.status IN ('present', 'half_day', 'absent'))::numeric * v_emp.work_target_minutes)) * 100.0,
                            2
                        )
                    END
                INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'absence_days' THEN
                SELECT
                    CASE
                        WHEN COUNT(*) = 0 THEN NULL
                        ELSE COUNT(*) FILTER (WHERE ad.status = 'absent')::numeric
                    END
                INTO v_actual
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'leave_days_taken' THEN
                SELECT COUNT(*)
                INTO v_att_count
                FROM public.attendance_days ad
                WHERE ad.organization_id = v_org_id
                  AND ad.employee_id = v_emp.id
                  AND ad.work_date BETWEEN v_period.start_date AND v_period.end_date;

                SELECT
                    COUNT(*),
                    COUNT(*) FILTER (WHERE COALESCE(lt.counts_toward_kpi, TRUE) = TRUE)
                INTO v_any_leave_count, v_countable_leave_count
                FROM public.leave_requests lr
                JOIN public.leave_types lt ON lt.id = lr.leave_type_id
                WHERE lr.organization_id = v_org_id
                  AND lr.employee_id = v_emp.id
                  AND lr.status = 'approved'
                  AND lr.start_date <= v_period.end_date
                  AND lr.end_date >= v_period.start_date;

                IF v_att_count = 0 AND v_any_leave_count = 0 THEN
                    v_actual := NULL;
                ELSE
                    v_leave_days := 0;
                    IF v_countable_leave_count > 0 THEN
                        FOR v_lr IN
                            SELECT lr.start_date, lr.end_date, lr.day_part
                            FROM public.leave_requests lr
                            JOIN public.leave_types lt ON lt.id = lr.leave_type_id
                            WHERE lr.organization_id = v_org_id
                              AND lr.employee_id = v_emp.id
                              AND lr.status = 'approved'
                              AND COALESCE(lt.counts_toward_kpi, TRUE) = TRUE
                              AND lr.start_date <= v_period.end_date
                              AND lr.end_date >= v_period.start_date
                        LOOP
                            v_overlap_start := GREATEST(v_lr.start_date, v_period.start_date);
                            v_overlap_end := LEAST(v_lr.end_date, v_period.end_date);
                            v_day_part := CASE
                                WHEN v_lr.start_date = v_lr.end_date THEN v_lr.day_part
                                ELSE 'full'
                            END;
                            v_leave_days := v_leave_days + public.calculate_working_days(
                                v_emp.id,
                                v_overlap_start,
                                v_overlap_end,
                                v_day_part
                            );
                        END LOOP;
                    END IF;
                    v_actual := ROUND(v_leave_days, 2);
                END IF;

            ELSIF v_def.source_metric = 'tasks_completed' THEN
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (
                            WHERE t.status <> 'cancelled'
                              AND (
                                  (t.completed_at IS NOT NULL AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date)
                                  OR (t.due_date BETWEEN v_period.start_date AND v_period.end_date)
                              )
                        ) = 0 THEN NULL
                        ELSE COUNT(*) FILTER (
                            WHERE t.status = 'done'
                              AND t.completed_at IS NOT NULL
                              AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date
                        )::numeric
                    END
                INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id;

            ELSIF v_def.source_metric = 'tasks_on_time_rate' THEN
                SELECT
                    ROUND(
                        (COUNT(*) FILTER (WHERE (t.completed_at AT TIME ZONE v_eff_tz)::date <= t.due_date)::numeric /
                         NULLIF(COUNT(*)::numeric, 0)) * 100.0,
                        2
                    )
                INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND t.due_date IS NOT NULL
                  AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date;

            ELSIF v_def.source_metric = 'tasks_overdue' THEN
                -- Single-count period-scoped rule:
                -- * Open overdue tasks (todo/in_progress/blocked) count ONCE in the
                --   period containing their due_date (`due_date BETWEEN start AND end`
                --   and `due_date < employee local today`), never repeated in later periods.
                -- * Late-completed tasks count in the period containing local completion date.
                -- * NULL ("No data") when the employee has no dated tasks due or done in period.
                SELECT
                    CASE
                        WHEN COUNT(*) FILTER (
                            WHERE t.status <> 'cancelled'
                              AND t.due_date IS NOT NULL
                              AND (
                                  t.due_date BETWEEN v_period.start_date AND v_period.end_date
                                  OR (
                                      t.status = 'done'
                                      AND t.completed_at IS NOT NULL
                                      AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date
                                  )
                              )
                        ) = 0 THEN NULL
                        ELSE COUNT(*) FILTER (
                            WHERE t.due_date IS NOT NULL
                              AND (
                                  (
                                      t.status IN ('todo', 'in_progress', 'blocked')
                                      AND t.due_date BETWEEN v_period.start_date AND v_period.end_date
                                      AND t.due_date < v_local_today
                                  )
                                  OR (
                                      t.status = 'done'
                                      AND t.completed_at IS NOT NULL
                                      AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date
                                      AND (t.completed_at AT TIME ZONE v_eff_tz)::date > t.due_date
                                  )
                              )
                        )::numeric
                    END
                INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id;

            ELSIF v_def.source_metric = 'avg_task_cycle_days' THEN
                SELECT
                    ROUND(
                        AVG(
                            GREATEST(
                                0.0,
                                EXTRACT(EPOCH FROM (t.completed_at - COALESCE(t.started_at, t.created_at))) / 86400.0
                            )
                        )::numeric,
                        2
                    )
                INTO v_actual
                FROM public.tasks t
                WHERE t.organization_id = v_org_id
                  AND t.assignee_id = v_emp.id
                  AND t.status = 'done'
                  AND t.completed_at IS NOT NULL
                  AND (t.completed_at AT TIME ZONE v_eff_tz)::date BETWEEN v_period.start_date AND v_period.end_date;
            END IF;

            v_score := public.calculate_kpi_score(v_actual, v_def.target_value, v_def.direction);

            INSERT INTO public.kpi_scores (
                organization_id, period_id, employee_id, kpi_definition_id,
                actual_value, target_value, score, computed_at
            ) VALUES (
                v_org_id, p_period_id, v_emp.id, v_def.id,
                v_actual, v_def.target_value, v_score, pg_catalog.now()
            );

            v_written := v_written + 1;
        END LOOP;
    END LOOP;

    -- Compute normalized weighted total per employee for the period:
    -- Weighted total = SUM(score * weight) / NULLIF(SUM(weight of scored metrics), 0)
    -- Guarded with NULLIF to prevent division-by-zero when all weights are zero or all metrics are unscored.
    SELECT COALESCE(
        jsonb_object_agg(
            emp_weighted.employee_id::text,
            emp_weighted.weighted_score
        ),
        '{}'::jsonb
    )
    INTO v_weighted_summary
    FROM (
        SELECT
            s.employee_id,
            ROUND(
                SUM(s.score * d.weight) / NULLIF(SUM(CASE WHEN s.score IS NOT NULL THEN d.weight ELSE 0 END), 0),
                2
            ) AS weighted_score
        FROM public.kpi_scores s
        JOIN public.kpi_definitions d ON d.id = s.kpi_definition_id
        WHERE s.period_id = p_period_id
          AND s.organization_id = v_org_id
        GROUP BY s.employee_id
    ) emp_weighted;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'KPI_SCORES_COMPUTED', 'kpi_scores', p_period_id,
        NULL, jsonb_build_object(
            'period_id', p_period_id,
            'scores_written', v_written,
            'actor_id', v_caller_id
        )
    );

    RETURN jsonb_build_object(
        'success', true,
        'period_id', p_period_id,
        'scores_written', v_written,
        'weighted_scores', v_weighted_summary
    );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_kpi_scores(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.compute_kpi_scores(UUID) TO authenticated;

-- ----------------------------------------------------------------------------
-- SECTION 5: Unschedule Redundant Standalone Retention Cron
--
-- All automated retention cleanup is orchestrated exclusively through the
-- automated archive pipeline (`weekly-retention-archive` -> Edge Function ->
-- `archiveAndRunRetentionCleanup`), which archives sessions to storage before deletion.
-- The legacy standalone `weekly-retention-cleanup` job is unscheduled to prevent
-- deleting attendance records prior to storage backup.
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_catalog.pg_extension e
        JOIN pg_catalog.pg_namespace n ON n.oid = e.extnamespace
        WHERE e.extname = 'pg_cron'
    ) THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-retention-cleanup') THEN
            PERFORM cron.unschedule('weekly-retention-cleanup');
        END IF;
    END IF;
END;
$$;




-- ============================================================================
-- Migration: 20261114000018_shifts_and_night_shifts.sql
-- Description:
-- 1. Adds shift_start_time and shift_end_time to organization_members and employees.
-- 2. Updates recalculate_day to automatically flag is_late based on assigned shift + grace.
-- 3. Updates cron_auto_checkout to support night shifts crossing midnight (skip active 
--    sessions before their scheduled post-midnight shift end).
-- ============================================================================

-- 1. Add shift columns to organization_members and employees
ALTER TABLE public.organization_members
    ADD COLUMN IF NOT EXISTS shift_start_time TIME NOT NULL DEFAULT '09:00:00',
    ADD COLUMN IF NOT EXISTS shift_end_time TIME NOT NULL DEFAULT '17:00:00';

ALTER TABLE public.employees
    ADD COLUMN IF NOT EXISTS shift_start_time TIME NOT NULL DEFAULT '09:00:00',
    ADD COLUMN IF NOT EXISTS shift_end_time TIME NOT NULL DEFAULT '17:00:00';

-- 2. Overwrite recalculate_day to support member shift times + grace period late calculation
CREATE OR REPLACE FUNCTION public.recalculate_day(
    p_employee_id UUID,
    p_work_date DATE
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_total_minutes INTEGER := 0;
    v_sessions_count INTEGER := 0;
    v_first_in TIMESTAMPTZ;
    v_last_out TIMESTAMPTZ;
    v_open_sessions INTEGER := 0;
    v_status TEXT := 'absent';
    v_is_late BOOLEAN := FALSE;
    v_overtime_minutes INTEGER := 0;
    v_work_location TEXT := 'remote';
    v_policy RECORD;
    v_is_holiday BOOLEAN := FALSE;
    v_is_company_day_off BOOLEAN := FALSE;
    v_day_of_week INTEGER;
    v_weekly_offs INTEGER[];
    v_is_weekend BOOLEAN := FALSE;
    v_target_minutes INTEGER := 480;
    v_org_id UUID;
    v_dept_id UUID;
    v_work_mode TEXT;
    v_emp_tz TEXT;
    v_loc_tz TEXT;
    v_org_tz TEXT;
    v_loc_weekly_offs INTEGER[];
    v_effective_tz TEXT;
    v_local_today DATE;
    v_is_locked BOOLEAN := FALSE;
    v_has_full_leave BOOLEAN := FALSE;
    v_has_first_half BOOLEAN := FALSE;
    v_has_second_half BOOLEAN := FALSE;
    v_member_start TIME;
BEGIN
    SELECT locked INTO v_is_locked
    FROM public.attendance_days
    WHERE employee_id = p_employee_id AND work_date = p_work_date;

    IF COALESCE(v_is_locked, FALSE) THEN
        RETURN;
    END IF;

    SELECT
        e.organization_id,
        e.department_id,
        COALESCE(e.work_mode, o.work_mode, 'remote'),
        e.timezone,
        l.timezone,
        COALESCE(o.timezone, 'UTC'),
        COALESCE(e.work_target_minutes, 480),
        l.weekly_off_days,
        COALESCE(om.shift_start_time, e.shift_start_time, '09:00:00'::time)
    INTO
        v_org_id, v_dept_id, v_work_mode, v_emp_tz, v_loc_tz, v_org_tz, v_target_minutes, v_loc_weekly_offs, v_member_start
    FROM public.employees e
    JOIN public.organizations o ON o.id = e.organization_id
    LEFT JOIN public.organization_members om ON om.user_id = e.id AND om.organization_id = e.organization_id
    LEFT JOIN public.locations l ON l.id = e.primary_location_id
    WHERE e.id = p_employee_id;

    IF v_org_id IS NULL THEN
        RETURN;
    END IF;

    IF EXISTS (
        SELECT 1 FROM public.attendance_sessions
        WHERE employee_id = p_employee_id
          AND (check_in_at AT TIME ZONE COALESCE(v_emp_tz, v_org_tz, 'UTC'))::date = p_work_date
          AND (location_id IS NOT NULL OR source IN ('office_ip', 'rotating_qr', 'kiosk'))
    ) THEN
        v_work_location := 'office';
    ELSE
        v_work_location := 'remote';
    END IF;

    v_effective_tz := CASE
        WHEN v_work_mode = 'remote' THEN COALESCE(v_emp_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
        WHEN v_work_mode = 'hybrid' THEN
            CASE
                WHEN v_work_location = 'office' THEN COALESCE(v_loc_tz, v_org_tz, 'UTC')
                ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
            END
        ELSE COALESCE(v_emp_tz, v_org_tz, 'UTC')
    END;

    v_local_today := (pg_catalog.now() AT TIME ZONE COALESCE(v_effective_tz, 'UTC'))::date;

    SELECT * INTO v_policy
    FROM public.attendance_policies
    WHERE organization_id = v_org_id
    LIMIT 1;

    SELECT
        COALESCE(SUM(
            CASE
                WHEN check_out_at IS NOT NULL
                THEN EXTRACT(EPOCH FROM (check_out_at - check_in_at)) / 60
                ELSE EXTRACT(EPOCH FROM (pg_catalog.now() - check_in_at)) / 60
            END
        ), 0)::INTEGER,
        COUNT(*),
        MIN(check_in_at),
        MAX(check_out_at),
        COUNT(*) FILTER (WHERE check_out_at IS NULL)
    INTO
        v_total_minutes,
        v_sessions_count,
        v_first_in,
        v_last_out,
        v_open_sessions
    FROM public.attendance_sessions
    WHERE employee_id = p_employee_id
      AND (check_in_at AT TIME ZONE v_effective_tz)::date = p_work_date;

    SELECT EXISTS (
        SELECT 1 FROM public.holidays
        WHERE organization_id = v_org_id
          AND date = p_work_date
          AND is_active = TRUE
    ) INTO v_is_holiday;

    SELECT EXISTS (
        SELECT 1 FROM public.company_days_off
        WHERE organization_id = v_org_id
          AND date = p_work_date
          AND (department_id IS NULL OR department_id = v_dept_id)
    ) INTO v_is_company_day_off;

    v_weekly_offs := COALESCE(v_loc_weekly_offs, v_policy.weekly_off_days, '{0, 6}'::INTEGER[]);
    v_day_of_week := EXTRACT(DOW FROM p_work_date)::INTEGER;
    v_is_weekend := v_day_of_week = ANY(v_weekly_offs);

    SELECT
        COALESCE(bool_or(day_part = 'full'), FALSE),
        COALESCE(bool_or(day_part = 'first_half'), FALSE),
        COALESCE(bool_or(day_part = 'second_half'), FALSE)
    INTO v_has_full_leave, v_has_first_half, v_has_second_half
    FROM public.leave_requests
    WHERE organization_id = v_org_id
      AND employee_id = p_employee_id
      AND status = 'approved'
      AND p_work_date BETWEEN start_date AND end_date;

    IF v_first_in IS NOT NULL THEN
        DECLARE
            v_expected_start TIME := COALESCE(v_member_start, v_policy.shift_start_time, '09:00:00'::time);
            v_grace INTEGER := COALESCE(v_policy.grace_minutes, 15);
            v_actual_time TIME := (v_first_in AT TIME ZONE v_effective_tz)::time;
        BEGIN
            IF v_actual_time > (v_expected_start + (v_grace || ' minutes')::interval) THEN
                v_is_late := TRUE;
            END IF;
        END;
    END IF;

    IF v_is_holiday OR v_is_company_day_off THEN
        v_status := 'holiday';
    ELSIF v_is_weekend THEN
        v_status := 'weekend';
    ELSIF v_has_full_leave OR (v_has_first_half AND v_has_second_half) THEN
        v_status := 'leave';
    ELSIF (v_has_first_half OR v_has_second_half) AND v_sessions_count = 0 THEN
        v_status := 'leave';
        v_total_minutes := COALESCE(v_policy.half_day_minutes, 240);
    ELSIF v_sessions_count = 0 THEN
        IF p_work_date > v_local_today THEN
            DELETE FROM public.attendance_days
            WHERE employee_id = p_employee_id
              AND work_date = p_work_date
              AND locked = FALSE;
            RETURN;
        END IF;
        v_status := 'absent';
    ELSIF v_total_minutes >= v_target_minutes THEN
        v_status := 'present';
        v_overtime_minutes := GREATEST(0, v_total_minutes - v_target_minutes);
    ELSE
        v_status := 'half_day';
    END IF;

    INSERT INTO public.attendance_days (
        organization_id,
        employee_id,
        work_date,
        total_minutes,
        overtime_minutes,
        status,
        is_late,
        locked,
        updated_at
    ) VALUES (
        v_org_id,
        p_employee_id,
        p_work_date,
        v_total_minutes,
        v_overtime_minutes,
        v_status,
        v_is_late,
        FALSE,
        pg_catalog.now()
    )
    ON CONFLICT (employee_id, work_date) DO UPDATE SET
        organization_id = EXCLUDED.organization_id,
        total_minutes = EXCLUDED.total_minutes,
        overtime_minutes = EXCLUDED.overtime_minutes,
        status = EXCLUDED.status,
        is_late = EXCLUDED.is_late,
        updated_at = EXCLUDED.updated_at
    WHERE public.attendance_days.locked = FALSE;

    IF EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'attendance_records'
    ) THEN
        UPDATE public.attendance_records
        SET is_late = v_is_late,
            updated_at = pg_catalog.now()
        WHERE user_id = p_employee_id AND work_date = p_work_date;
    END IF;

    RETURN;
END;
$$;

REVOKE ALL ON FUNCTION public.recalculate_day(UUID, DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recalculate_day(UUID, DATE) TO service_role;

-- 3. Overwrite cron_auto_checkout with night shift crossover support
CREATE OR REPLACE FUNCTION public.cron_auto_checkout(
    p_now TIMESTAMPTZ DEFAULT pg_catalog.now()
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_now TIMESTAMPTZ := COALESCE(p_now, pg_catalog.now());
    v_nil_loc CONSTANT UUID := '00000000-0000-0000-0000-000000000000'::uuid;
    v_closed_count INTEGER := 0;
    v_org RECORD;
    v_scope RECORD;
    v_session RECORD;
    v_local_now TIMESTAMP;
    v_local_date DATE;
    v_local_time TIME;
    v_target_date DATE;
    v_sess_date DATE;
    v_cutoff_ts TIMESTAMPTZ;
    v_checkout_ts TIMESTAMPTZ;
    v_org_closed INTEGER := 0;
    v_scope_closed INTEGER := 0;
    v_err TEXT;
BEGIN
    FOR v_org IN
        SELECT
            o.id,
            COALESCE(o.work_mode, 'remote') AS work_mode,
            COALESCE(NULLIF(o.timezone, ''), 'UTC') AS timezone,
            COALESCE(ap.auto_checkout_time, TIME '23:59:00') AS auto_checkout_time
        FROM public.organizations o
        LEFT JOIN LATERAL (
            SELECT auto_checkout_time
            FROM public.attendance_policies
            WHERE organization_id = o.id
              AND is_active = TRUE
            ORDER BY updated_at DESC, created_at DESC
            LIMIT 1
        ) ap ON TRUE
        WHERE o.status IN ('active', 'trial')
        ORDER BY o.created_at ASC, o.id ASC
    LOOP
        v_org_closed := 0;

        BEGIN
            FOR v_scope IN
                SELECT DISTINCT scope.loc_key, scope.eff_tz
                FROM (
                    -- Org fallback scope
                    SELECT v_nil_loc AS loc_key, v_org.timezone AS eff_tz
                    UNION
                    -- Active office locations
                    SELECT l.id AS loc_key, COALESCE(NULLIF(l.timezone, ''), v_org.timezone, 'UTC') AS eff_tz
                    FROM public.locations l
                    WHERE l.organization_id = v_org.id
                      AND l.is_active = TRUE
                    UNION
                    -- Active employees' effective scopes
                    SELECT
                        CASE
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(e.primary_location_id, v_nil_loc)
                            ELSE v_nil_loc
                        END AS loc_key,
                        CASE
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                            ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                        END AS eff_tz
                    FROM public.employees e
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE e.organization_id = v_org.id
                      AND e.status = 'active'
                    UNION
                    -- Open sessions' exact resolved scopes
                    SELECT
                        CASE
                            WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                            THEN COALESCE(s.location_id, e.primary_location_id, v_nil_loc)
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(e.primary_location_id, v_nil_loc)
                            ELSE v_nil_loc
                        END AS loc_key,
                        CASE
                            WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                            THEN COALESCE(NULLIF(sl.timezone, ''), NULLIF(el.timezone, ''), v_org.timezone, 'UTC')
                            WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                            THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                            ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                        END AS eff_tz
                    FROM public.attendance_sessions s
                    JOIN public.employees e ON e.id = s.employee_id
                    LEFT JOIN public.locations sl ON sl.id = s.location_id
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE s.organization_id = v_org.id
                      AND s.check_out_at IS NULL
                ) scope
                ORDER BY scope.loc_key, scope.eff_tz
            LOOP
                v_scope_closed := 0;
                v_local_now := v_now AT TIME ZONE v_scope.eff_tz;
                v_local_date := v_local_now::date;
                v_local_time := v_local_now::time;

                IF v_local_time >= v_org.auto_checkout_time THEN
                    v_target_date := v_local_date;
                ELSE
                    v_target_date := v_local_date - 1;
                END IF;

                IF EXISTS (
                    SELECT 1 FROM public.cron_run_state crs
                    WHERE crs.job_name = 'auto_checkout'
                      AND crs.organization_id = v_org.id
                      AND crs.location_id = v_scope.loc_key
                      AND crs.timezone_key = v_scope.eff_tz
                      AND crs.target_date = v_target_date
                      AND crs.status = 'success'
                ) THEN
                    CONTINUE;
                END IF;

                FOR v_session IN
                    SELECT
                        s.id,
                        s.employee_id,
                        s.check_in_at
                    FROM public.attendance_sessions s
                    JOIN public.employees e ON e.id = s.employee_id
                    LEFT JOIN public.locations sl ON sl.id = s.location_id
                    LEFT JOIN public.locations el ON el.id = e.primary_location_id
                    WHERE s.organization_id = v_org.id
                      AND s.check_out_at IS NULL
                      AND (
                          CASE
                              WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                              THEN COALESCE(s.location_id, e.primary_location_id, v_nil_loc)
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(e.primary_location_id, v_nil_loc)
                              ELSE v_nil_loc
                          END
                      ) = v_scope.loc_key
                      AND (
                          CASE
                              WHEN s.location_id IS NOT NULL OR s.source IN ('office_ip', 'rotating_qr', 'kiosk')
                              THEN COALESCE(NULLIF(sl.timezone, ''), NULLIF(el.timezone, ''), v_org.timezone, 'UTC')
                              WHEN COALESCE(e.work_mode, v_org.work_mode, 'remote') = 'office'
                              THEN COALESCE(NULLIF(el.timezone, ''), NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                              ELSE COALESCE(NULLIF(e.timezone, ''), v_org.timezone, 'UTC')
                          END
                      ) = v_scope.eff_tz
                    ORDER BY s.check_in_at ASC, s.id ASC
                LOOP
                    v_sess_date := (v_session.check_in_at AT TIME ZONE v_scope.eff_tz)::date;
                    IF v_sess_date > v_target_date THEN
                        CONTINUE;
                    END IF;

                    -- Support night shift crossover (shift_end_time < shift_start_time)
                    DECLARE
                        v_shift_start TIME;
                        v_shift_end TIME;
                        v_night_cutoff TIMESTAMPTZ;
                    BEGIN
                        SELECT
                            COALESCE(om.shift_start_time, e.shift_start_time, '09:00:00'::time),
                            COALESCE(om.shift_end_time, e.shift_end_time, '17:00:00'::time)
                        INTO v_shift_start, v_shift_end
                        FROM public.employees e
                        LEFT JOIN public.organization_members om ON om.user_id = e.id AND om.organization_id = e.organization_id
                        WHERE e.id = v_session.employee_id;

                        IF v_shift_end < v_shift_start THEN
                            v_night_cutoff := ((v_sess_date + 1) + v_shift_end) AT TIME ZONE v_scope.eff_tz + INTERVAL '15 minutes';
                            IF v_now < v_night_cutoff THEN
                                CONTINUE;
                            END IF;
                        END IF;
                    END;

                    v_cutoff_ts := (v_sess_date + v_org.auto_checkout_time) AT TIME ZONE v_scope.eff_tz;
                    IF v_session.check_in_at >= v_cutoff_ts THEN
                        v_cutoff_ts := ((v_sess_date + 1) + v_org.auto_checkout_time) AT TIME ZONE v_scope.eff_tz;
                    END IF;

                    IF v_cutoff_ts <= v_now THEN
                        IF NOT EXISTS (
                            SELECT 1 FROM public.attendance_days d
                            WHERE d.organization_id = v_org.id
                              AND d.employee_id = v_session.employee_id
                              AND d.work_date = v_sess_date
                              AND d.locked = TRUE
                        ) THEN
                            v_checkout_ts := GREATEST(v_session.check_in_at + INTERVAL '1 minute', LEAST(v_now, v_cutoff_ts));

                            UPDATE public.attendance_sessions
                            SET check_out_at = v_checkout_ts,
                                source = 'auto',
                                note = COALESCE(note, '') || ' [Auto-closed at policy cutoff ' || v_scope.eff_tz || ']'
                            WHERE id = v_session.id;

                            PERFORM public.recalculate_day(v_session.employee_id, v_sess_date);

                            INSERT INTO public.notifications (
                                organization_id, user_id, type, title, body, link, metadata
                            ) VALUES (
                                v_org.id,
                                v_session.employee_id,
                                'missed_checkout',
                                'Missed Checkout Auto-Closed',
                                'Your open shift from ' || v_sess_date::text || ' passed the organization auto-checkout cutoff (' || v_org.auto_checkout_time::text || ' ' || v_scope.eff_tz || ') and was closed automatically.',
                                '/requests',
                                jsonb_build_object(
                                    'session_id', v_session.id,
                                    'work_date', v_sess_date,
                                    'timezone', v_scope.eff_tz,
                                    'cutoff_at', v_cutoff_ts
                                )
                            );

                            v_scope_closed := v_scope_closed + 1;
                            v_org_closed := v_org_closed + 1;
                        END IF;
                    END IF;
                END LOOP;

                INSERT INTO public.cron_run_state (
                    job_name, organization_id, location_id, timezone_key, target_date,
                    status, error_message, processed_count, executed_at
                ) VALUES (
                    'auto_checkout', v_org.id, v_scope.loc_key, v_scope.eff_tz, v_target_date,
                    'success', NULL, v_scope_closed, v_now
                )
                ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
                SET status = 'success',
                    error_message = NULL,
                    processed_count = EXCLUDED.processed_count,
                    executed_at = EXCLUDED.executed_at
                WHERE public.cron_run_state.status IS DISTINCT FROM 'success';
            END LOOP;

            v_closed_count := v_closed_count + v_org_closed;
        EXCEPTION WHEN OTHERS THEN
            v_err := SQLERRM;
            INSERT INTO public.cron_run_state (
                job_name, organization_id, location_id, timezone_key, target_date,
                status, error_message, processed_count, executed_at
            ) VALUES (
                'auto_checkout', v_org.id, v_nil_loc, v_org.timezone,
                (v_now AT TIME ZONE 'UTC')::date, 'failed', v_err, 0, v_now
            )
            ON CONFLICT (job_name, organization_id, location_id, timezone_key, target_date) DO UPDATE
            SET status = CASE WHEN public.cron_run_state.status = 'success' THEN 'success' ELSE 'failed' END,
                error_message = COALESCE(EXCLUDED.error_message, public.cron_run_state.error_message),
                executed_at = EXCLUDED.executed_at;
        END;
    END LOOP;

    RETURN v_closed_count;
END;
$$;

REVOKE ALL ON FUNCTION public.cron_auto_checkout(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.cron_auto_checkout(TIMESTAMPTZ) TO service_role;


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


