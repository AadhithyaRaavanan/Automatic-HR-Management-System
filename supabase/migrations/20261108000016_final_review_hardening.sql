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
