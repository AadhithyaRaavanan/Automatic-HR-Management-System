-- ============================================================================
-- Migration: 20261128000001_atomic_reviews_and_auth_challenges.sql
-- Description:
-- 1. Idempotent leave balance adjustments index for monthly accrual safety.
-- 2. Tighten permission_requests SELECT RLS policy with strict organization scope.
-- 3. Service-callable atomic review RPCs with pending precondition, concurrency
--    locking (FOR UPDATE), idempotency keys, delegation, month lock guards,
--    and attendance recalculation (recalculate_day).
-- 4. Multi-instance durable auth recovery challenges & rate limits tables/RPCs.
-- ============================================================================

-- 1. Leave Balance Adjustments Idempotency Column & Unique Guard
ALTER TABLE public.leave_balance_adjustments
    ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_leave_balance_adjustments_org_idemp
    ON public.leave_balance_adjustments (organization_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- 2. Tighten permission_requests RLS with organization_id isolation
DO $$
BEGIN
    IF to_regclass('public.permission_requests') IS NOT NULL THEN
        EXECUTE 'DROP POLICY IF EXISTS "permission_requests_select_policy" ON public.permission_requests';
        EXECUTE $policy$
            CREATE POLICY "permission_requests_select_policy" ON public.permission_requests
                FOR SELECT TO authenticated
                USING (
                    organization_id = (SELECT public.current_org_id())
                    AND (
                        employee_id = (SELECT auth.uid())
                        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
                        OR EXISTS (
                            SELECT 1 FROM public.employees e
                            WHERE e.id = permission_requests.employee_id
                              AND e.organization_id = permission_requests.organization_id
                              AND (
                                  e.manager_id = (SELECT auth.uid())
                                  OR EXISTS (
                                      SELECT 1 FROM public.departments d
                                      WHERE d.id = e.department_id
                                        AND d.organization_id = e.organization_id
                                        AND d.department_head_id = (SELECT auth.uid())
                                  )
                              )
                        )
                        OR EXISTS (
                            SELECT 1 FROM public.approval_delegations ad
                            WHERE ad.organization_id = permission_requests.organization_id
                              AND ad.delegate_id = (SELECT auth.uid())
                              AND ad.is_active = TRUE
                              AND ad.revoked_at IS NULL
                              AND CURRENT_DATE BETWEEN ad.starts_on AND ad.ends_on
                        )
                    )
                )
        $policy$;
    END IF;
END $$;

-- 3. Organization-scoped approver + delegation resolver
CREATE OR REPLACE FUNCTION public.can_approve_for_in_org(
    p_approver_id UUID,
    p_employee_id UUID,
    p_organization_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_approver_role TEXT;
    v_emp_org UUID;
    v_emp_manager UUID;
    v_emp_dept UUID;
    v_delegator_id UUID;
    v_delegator_can BOOLEAN := FALSE;
BEGIN
    IF p_approver_id IS NULL OR p_employee_id IS NULL OR p_organization_id IS NULL THEN
        RETURN FALSE;
    END IF;
    IF p_approver_id = p_employee_id THEN
        RETURN FALSE;
    END IF;

    SELECT om.role INTO v_approver_role
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = p_approver_id
      AND om.organization_id = p_organization_id
      AND om.status = 'active'
      AND o.status IN ('active', 'trial')
    LIMIT 1;

    IF v_approver_role IS NULL THEN
        RETURN FALSE;
    END IF;

    SELECT e.organization_id, e.manager_id, e.department_id
    INTO v_emp_org, v_emp_manager, v_emp_dept
    FROM public.employees e
    WHERE e.id = p_employee_id
      AND e.organization_id = p_organization_id
    LIMIT 1;

    IF v_emp_org IS NULL THEN
        RETURN FALSE;
    END IF;

    IF v_approver_role IN ('hr', 'admin') THEN
        RETURN TRUE;
    END IF;

    IF v_emp_manager = p_approver_id THEN
        RETURN TRUE;
    END IF;

    IF v_emp_dept IS NOT NULL AND EXISTS (
        SELECT 1 FROM public.departments d
        WHERE d.id = v_emp_dept
          AND d.organization_id = p_organization_id
          AND d.department_head_id = p_approver_id
    ) THEN
        RETURN TRUE;
    END IF;

    -- Active delegation check within organization & active date range
    FOR v_delegator_id IN
        SELECT ad.delegator_id
        FROM public.approval_delegations ad
        JOIN public.organization_members dom
          ON dom.user_id = ad.delegator_id
         AND dom.organization_id = ad.organization_id
         AND dom.status = 'active'
        WHERE ad.organization_id = p_organization_id
          AND ad.delegate_id = p_approver_id
          AND ad.is_active = TRUE
          AND ad.revoked_at IS NULL
          AND CURRENT_DATE BETWEEN ad.starts_on AND ad.ends_on
          AND ad.delegator_id <> p_employee_id
    LOOP
        SELECT (
            dom.role IN ('hr', 'admin')
            OR v_emp_manager = v_delegator_id
            OR (
                v_emp_dept IS NOT NULL AND EXISTS (
                    SELECT 1 FROM public.departments d2
                    WHERE d2.id = v_emp_dept
                      AND d2.organization_id = p_organization_id
                      AND d2.department_head_id = v_delegator_id
                )
            )
        ) INTO v_delegator_can
        FROM public.organization_members dom
        WHERE dom.user_id = v_delegator_id
          AND dom.organization_id = p_organization_id
          AND dom.status = 'active'
        LIMIT 1;

        IF COALESCE(v_delegator_can, FALSE) THEN
            RETURN TRUE;
        END IF;
    END LOOP;

    RETURN FALSE;
END;
$$;

REVOKE ALL ON FUNCTION public.can_approve_for_in_org(UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_approve_for_in_org(UUID, UUID, UUID) TO service_role;

-- 4. Atomic Service Leave Review RPC
CREATE OR REPLACE FUNCTION public.service_review_leave_request(
    p_actor_id UUID,
    p_organization_id UUID,
    p_request_id UUID,
    p_action TEXT,
    p_review_note TEXT,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing_idemp RECORD;
    v_actor_role TEXT;
    v_request RECORD;
    v_target_emp RECORD;
    v_p_start DATE;
    v_p_end DATE;
    v_balance RECORD;
    v_locked BOOLEAN := FALSE;
    v_punched BOOLEAN := FALSE;
    v_weekly_offs INTEGER[] := '{0, 6}'::INTEGER[];
    v_curr DATE;
    v_dow INTEGER;
    v_other_approvers_count INTEGER := 0;
    v_has_active_manager BOOLEAN := FALSE;
    v_can_approve BOOLEAN := FALSE;
    v_target_status TEXT;
    v_result JSONB;
BEGIN
    IF p_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Invalid action: %', p_action USING ERRCODE = '22023';
    END IF;

    IF p_review_note IS NULL OR char_length(pg_catalog.btrim(p_review_note)) < 5 THEN
        RAISE EXCEPTION 'A decision note of at least 5 characters is required.' USING ERRCODE = '22023';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_body INTO v_existing_idemp
        FROM public.idempotency_keys
        WHERE key = p_idempotency_key
          AND user_id = p_actor_id
          AND endpoint = '/api/leave/review';
        IF FOUND THEN
            RETURN v_existing_idemp.response_body || jsonb_build_object('idempotent_replay', true);
        END IF;
    END IF;

    SELECT om.role INTO v_actor_role
    FROM public.organization_members om
    WHERE om.user_id = p_actor_id
      AND om.organization_id = p_organization_id
      AND om.status = 'active'
    LIMIT 1;

    IF v_actor_role IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_request
    FROM public.leave_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_request IS NULL THEN
        RAISE EXCEPTION 'Leave request not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_request.organization_id IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Forbidden: Leave request belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    IF v_request.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Conflict: Leave request has already been %.', v_request.status USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_target_emp
    FROM public.employees
    WHERE id = v_request.employee_id
      AND organization_id = p_organization_id;

    -- Separation of duties with single-admin organization fallback
    IF v_request.employee_id = p_actor_id THEN
        IF v_actor_role = 'admin' THEN
            SELECT COUNT(*) INTO v_other_approvers_count
            FROM public.organization_members
            WHERE organization_id = p_organization_id
              AND user_id IS DISTINCT FROM p_actor_id
              AND status = 'active'
              AND role IN ('admin', 'hr');

            IF v_target_emp.manager_id IS NOT NULL THEN
                SELECT EXISTS (
                    SELECT 1 FROM public.organization_members
                    WHERE organization_id = p_organization_id
                      AND user_id = v_target_emp.manager_id
                      AND status = 'active'
                ) INTO v_has_active_manager;
            END IF;

            IF v_other_approvers_count = 0 AND NOT v_has_active_manager THEN
                v_can_approve := TRUE;
            ELSE
                RAISE EXCEPTION 'Separation of duties: You cannot approve or reject your own leave request.' USING ERRCODE = '42501';
            END IF;
        ELSE
            RAISE EXCEPTION 'Separation of duties: You cannot approve or reject your own leave request.' USING ERRCODE = '42501';
        END IF;
    ELSE
        v_can_approve := public.can_approve_for_in_org(p_actor_id, v_request.employee_id, p_organization_id);
        IF NOT v_can_approve THEN
            RAISE EXCEPTION 'Forbidden: You are not authorized or delegated to review leave for this employee.' USING ERRCODE = '42501';
        END IF;
    END IF;

    v_target_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;

    IF p_action = 'approve' THEN
        -- Month lock guard
        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = p_organization_id
              AND employee_id = v_request.employee_id
              AND work_date BETWEEN v_request.start_date AND v_request.end_date
              AND locked = TRUE
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot approve leave: selected dates include a locked attendance period.' USING ERRCODE = '22023';
        END IF;

        -- Existing session conflict check
        IF v_target_emp.primary_location_id IS NOT NULL THEN
            SELECT weekly_off_days INTO v_weekly_offs
            FROM public.locations
            WHERE id = v_target_emp.primary_location_id;
        END IF;
        IF v_weekly_offs IS NULL THEN
            SELECT weekly_off_days INTO v_weekly_offs
            FROM public.attendance_policies
            WHERE organization_id = p_organization_id
            LIMIT 1;
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
                    WHERE organization_id = p_organization_id
                      AND employee_id = v_request.employee_id
                      AND work_date = v_curr
                ) INTO v_punched;

                IF v_punched AND v_request.day_part = 'full' THEN
                    RAISE EXCEPTION 'Employee already has attendance logged on %: cannot approve full-day leave.', v_curr USING ERRCODE = '22023';
                END IF;
            END IF;
            v_curr := v_curr + 1;
        END LOOP;

        -- Lock and deduct leave balance atomically
        SELECT period_start, period_end INTO v_p_start, v_p_end
        FROM public.get_organization_leave_period(p_organization_id, v_request.start_date);

        SELECT * INTO v_balance
        FROM public.leave_balances
        WHERE organization_id = p_organization_id
          AND employee_id = v_request.employee_id
          AND leave_type_id = v_request.leave_type_id
          AND period_start = v_p_start
          AND period_end = v_p_end
        FOR UPDATE;

        IF v_balance IS NOT NULL THEN
            IF (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used) < v_request.total_days THEN
                RAISE EXCEPTION 'Insufficient leave balance. Available: %, Requested: %',
                    (v_balance.allocated + v_balance.carried_forward + v_balance.adjusted - v_balance.used),
                    v_request.total_days
                    USING ERRCODE = '22023';
            END IF;

            UPDATE public.leave_balances
            SET used = used + v_request.total_days,
                updated_at = pg_catalog.now()
            WHERE id = v_balance.id;

            INSERT INTO public.leave_balance_adjustments (
                organization_id, employee_id, leave_type_id, adjusted_by, amount, reason, idempotency_key
            ) VALUES (
                p_organization_id,
                v_request.employee_id,
                v_request.leave_type_id,
                p_actor_id,
                -v_request.total_days,
                'Leave approved: ' || p_request_id::text,
                'leave_approve:' || p_request_id::text
            )
            ON CONFLICT (organization_id, idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING;
        END IF;
    END IF;

    UPDATE public.leave_requests
    SET status = v_target_status,
        review_note = pg_catalog.btrim(p_review_note),
        reviewed_by = p_actor_id,
        reviewed_at = pg_catalog.now(),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id
      AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conflict: Leave request state changed concurrently.' USING ERRCODE = 'P0001';
    END IF;

    IF p_action = 'approve' THEN
        v_curr := v_request.start_date;
        WHILE v_curr <= v_request.end_date LOOP
            PERFORM public.recalculate_day(v_request.employee_id, v_curr);
            v_curr := v_curr + 1;
        END LOOP;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        p_organization_id,
        p_actor_id,
        CASE WHEN p_action = 'approve' THEN 'LEAVE_APPROVED' ELSE 'LEAVE_REJECTED' END,
        'leave_requests',
        p_request_id,
        jsonb_build_object('status', v_request.status),
        jsonb_build_object(
            'status', v_target_status,
            'total_days', v_request.total_days,
            'review_note', pg_catalog.btrim(p_review_note),
            'reviewed_by', p_actor_id,
            'reviewed_at', pg_catalog.now()
        )
    );

    v_result := jsonb_build_object(
        'success', true,
        'status', v_target_status,
        'review_note', pg_catalog.btrim(p_review_note),
        'employee_id', v_request.employee_id,
        'start_date', v_request.start_date,
        'end_date', v_request.end_date
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (key, user_id, endpoint, response_body, response_status)
        VALUES (p_idempotency_key, p_actor_id, '/api/leave/review', v_result, 200)
        ON CONFLICT (key) DO NOTHING;
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.service_review_leave_request(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_review_leave_request(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

-- 5. Atomic Service Regularization Review RPC (uses timestamps + recalculate_day)
CREATE OR REPLACE FUNCTION public.service_review_regularization_request(
    p_actor_id UUID,
    p_organization_id UUID,
    p_request_id UUID,
    p_action TEXT,
    p_review_note TEXT,
    p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_existing_idemp RECORD;
    v_actor_role TEXT;
    v_req RECORD;
    v_emp_org UUID;
    v_locked BOOLEAN := FALSE;
    v_target_status TEXT;
    v_old_day JSONB;
    v_new_day JSONB;
    v_result JSONB;
BEGIN
    IF p_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Invalid action: %', p_action USING ERRCODE = '22023';
    END IF;

    IF p_review_note IS NULL OR char_length(pg_catalog.btrim(p_review_note)) < 5 THEN
        RAISE EXCEPTION 'A decision note of at least 5 characters is required.' USING ERRCODE = '22023';
    END IF;

    IF p_idempotency_key IS NOT NULL THEN
        SELECT response_body INTO v_existing_idemp
        FROM public.idempotency_keys
        WHERE key = p_idempotency_key
          AND user_id = p_actor_id
          AND endpoint = '/api/requests/review';
        IF FOUND THEN
            RETURN v_existing_idemp.response_body || jsonb_build_object('idempotent_replay', true);
        END IF;
    END IF;

    SELECT om.role INTO v_actor_role
    FROM public.organization_members om
    WHERE om.user_id = p_actor_id
      AND om.organization_id = p_organization_id
      AND om.status = 'active'
    LIMIT 1;

    IF v_actor_role IS NULL THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.regularization_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_req IS NULL THEN
        RAISE EXCEPTION 'Regularization request not found.' USING ERRCODE = 'P0002';
    END IF;

    SELECT organization_id INTO v_emp_org
    FROM public.employees
    WHERE id = v_req.employee_id;

    IF COALESCE(v_req.organization_id, v_emp_org) IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Forbidden: Regularization request belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    IF v_req.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Conflict: Regularization request has already been %.', v_req.status USING ERRCODE = 'P0001';
    END IF;

    IF v_req.employee_id = p_actor_id THEN
        RAISE EXCEPTION 'Separation of duties: You cannot approve or reject your own request.' USING ERRCODE = '42501';
    END IF;

    IF NOT public.can_approve_for_in_org(p_actor_id, v_req.employee_id, p_organization_id) THEN
        RAISE EXCEPTION 'Forbidden: You are not authorized or delegated to review requests for this employee.' USING ERRCODE = '42501';
    END IF;

    v_target_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;

    IF p_action = 'approve' THEN
        IF v_req.requested_in IS NULL OR v_req.requested_out IS NULL OR v_req.requested_out <= v_req.requested_in THEN
            RAISE EXCEPTION 'Invalid regularization timestamps: check-out must be after check-in.' USING ERRCODE = '22023';
        END IF;

        SELECT EXISTS (
            SELECT 1 FROM public.attendance_days
            WHERE organization_id = p_organization_id
              AND employee_id = v_req.employee_id
              AND work_date = v_req.work_date
              AND locked = TRUE
        ) INTO v_locked;

        IF v_locked THEN
            RAISE EXCEPTION 'Cannot approve regularization: attendance day % is locked.', v_req.work_date USING ERRCODE = '22023';
        END IF;

        SELECT to_jsonb(ad.*) INTO v_old_day
        FROM public.attendance_days ad
        WHERE employee_id = v_req.employee_id AND work_date = v_req.work_date;

        INSERT INTO public.attendance_sessions (
            organization_id, employee_id, work_date, check_in_at, check_out_at, source, note
        ) VALUES (
            p_organization_id,
            v_req.employee_id,
            v_req.work_date,
            v_req.requested_in,
            v_req.requested_out,
            'manual',
            'Regularized: ' || COALESCE(v_req.reason, '')
        );
    END IF;

    UPDATE public.regularization_requests
    SET status = v_target_status,
        review_note = pg_catalog.btrim(p_review_note),
        reviewed_by = p_actor_id,
        reviewed_at = pg_catalog.now()
    WHERE id = p_request_id
      AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conflict: Regularization request state changed concurrently.' USING ERRCODE = 'P0001';
    END IF;

    IF p_action = 'approve' THEN
        PERFORM public.recalculate_day(v_req.employee_id, v_req.work_date);

        SELECT to_jsonb(ad.*) INTO v_new_day
        FROM public.attendance_days ad
        WHERE employee_id = v_req.employee_id AND work_date = v_req.work_date;
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        p_organization_id,
        p_actor_id,
        CASE WHEN p_action = 'approve' THEN 'REGULARIZATION_APPROVED' ELSE 'REGULARIZATION_REJECTED' END,
        'regularization_requests',
        p_request_id,
        jsonb_build_object('status', v_req.status, 'day', v_old_day),
        jsonb_build_object(
            'status', v_target_status,
            'review_note', pg_catalog.btrim(p_review_note),
            'reviewed_by', p_actor_id,
            'reviewed_at', pg_catalog.now(),
            'day', v_new_day
        )
    );

    v_result := jsonb_build_object(
        'success', true,
        'status', v_target_status,
        'review_note', pg_catalog.btrim(p_review_note),
        'employee_id', v_req.employee_id,
        'work_date', v_req.work_date,
        'total_minutes', COALESCE((v_new_day->>'total_minutes')::integer, NULL)
    );

    IF p_idempotency_key IS NOT NULL THEN
        INSERT INTO public.idempotency_keys (key, user_id, endpoint, response_body, response_status)
        VALUES (p_idempotency_key, p_actor_id, '/api/requests/review', v_result, 200)
        ON CONFLICT (key) DO NOTHING;
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.service_review_regularization_request(UUID, UUID, UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_review_regularization_request(UUID, UUID, UUID, TEXT, TEXT, TEXT) TO service_role;

-- 6. Atomic Service Permission Review RPC
CREATE OR REPLACE FUNCTION public.service_review_permission_request(
    p_actor_id UUID,
    p_organization_id UUID,
    p_request_id UUID,
    p_action TEXT,
    p_review_note TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_actor_role TEXT;
    v_req RECORD;
    v_target_status TEXT;
BEGIN
    IF p_action NOT IN ('approve', 'reject') THEN
        RAISE EXCEPTION 'Invalid action: %', p_action USING ERRCODE = '22023';
    END IF;

    SELECT om.role INTO v_actor_role
    FROM public.organization_members om
    WHERE om.user_id = p_actor_id
      AND om.organization_id = p_organization_id
      AND om.status = 'active'
    LIMIT 1;

    IF v_actor_role IS NULL OR v_actor_role NOT IN ('admin', 'hr', 'manager', 'team_lead') THEN
        RAISE EXCEPTION 'Forbidden: Insufficient permissions to review permission requests.' USING ERRCODE = '42501';
    END IF;

    SELECT * INTO v_req
    FROM public.permission_requests
    WHERE id = p_request_id
    FOR UPDATE;

    IF v_req IS NULL THEN
        RAISE EXCEPTION 'Permission request not found.' USING ERRCODE = 'P0002';
    END IF;

    IF v_req.organization_id IS DISTINCT FROM p_organization_id THEN
        RAISE EXCEPTION 'Forbidden: Permission request belongs to another organization.' USING ERRCODE = '42501';
    END IF;

    IF v_req.status IS DISTINCT FROM 'pending' THEN
        RAISE EXCEPTION 'Conflict: Permission request has already been %.', v_req.status USING ERRCODE = 'P0001';
    END IF;

    IF v_req.employee_id = p_actor_id THEN
        RAISE EXCEPTION 'Separation of duties: You cannot review your own permission request.' USING ERRCODE = '42501';
    END IF;

    IF v_actor_role NOT IN ('admin', 'hr')
       AND v_actor_role <> 'team_lead'
       AND NOT public.can_approve_for_in_org(p_actor_id, v_req.employee_id, p_organization_id) THEN
        RAISE EXCEPTION 'Forbidden: Not authorized or delegated to review this employee permission request.' USING ERRCODE = '42501';
    END IF;

    v_target_status := CASE WHEN p_action = 'approve' THEN 'approved' ELSE 'rejected' END;

    UPDATE public.permission_requests
    SET status = v_target_status,
        reviewed_by = p_actor_id,
        reviewed_at = pg_catalog.now(),
        review_note = NULLIF(pg_catalog.btrim(COALESCE(p_review_note, '')), ''),
        updated_at = pg_catalog.now()
    WHERE id = p_request_id
      AND status = 'pending';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Conflict: Permission request state changed concurrently.' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        p_organization_id,
        p_actor_id,
        CASE WHEN p_action = 'approve' THEN 'PERMISSION_APPROVED' ELSE 'PERMISSION_REJECTED' END,
        'permission_requests',
        p_request_id,
        jsonb_build_object('status', v_req.status),
        jsonb_build_object('status', v_target_status, 'review_note', p_review_note, 'reviewed_by', p_actor_id)
    );

    RETURN jsonb_build_object(
        'success', true,
        'request_id', p_request_id,
        'status', v_target_status,
        'employee_id', v_req.employee_id,
        'permission_date', v_req.permission_date,
        'duration_minutes', v_req.duration_minutes
    );
END;
$$;

REVOKE ALL ON FUNCTION public.service_review_permission_request(UUID, UUID, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_review_permission_request(UUID, UUID, UUID, TEXT, TEXT) TO service_role;

-- 7. Bounded Per-Org Idempotent Leave Accrual RPC
CREATE OR REPLACE FUNCTION public.service_accrue_org_leave_balances(
    p_organization_id UUID,
    p_year INTEGER,
    p_month INTEGER,
    p_batch_limit INTEGER DEFAULT 100,
    p_offset INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_ref_date DATE;
    v_p_start DATE;
    v_p_end DATE;
    v_year_month TEXT;
    v_emp RECORD;
    v_lt RECORD;
    v_credit NUMERIC(5, 2);
    v_idemp_key TEXT;
    v_inserted BOOLEAN;
    v_emp_count INTEGER := 0;
    v_processed INTEGER := 0;
    v_skipped INTEGER := 0;
    v_credited_ids UUID[] := '{}';
BEGIN
    v_ref_date := make_date(p_year, p_month, 1);
    v_year_month := to_char(v_ref_date, 'YYYY-MM');

    SELECT period_start, period_end INTO v_p_start, v_p_end
    FROM public.get_organization_leave_period(p_organization_id, v_ref_date);

    FOR v_emp IN
        SELECT id
        FROM public.employees
        WHERE organization_id = p_organization_id
          AND status = 'active'
        ORDER BY created_at ASC, id ASC
        LIMIT GREATEST(COALESCE(p_batch_limit, 100), 1)
        OFFSET GREATEST(COALESCE(p_offset, 0), 0)
    LOOP
        v_emp_count := v_emp_count + 1;

        FOR v_lt IN
            SELECT
                lt.id AS leave_type_id,
                lt.code,
                lp.yearly_quota,
                lp.monthly_cap
            FROM public.leave_types lt
            LEFT JOIN public.leave_policies lp
              ON lp.organization_id = lt.organization_id
             AND lp.leave_type_id = lt.id
            WHERE lt.organization_id = p_organization_id
              AND lt.is_active = TRUE
              AND lt.is_paid = TRUE
        LOOP
            v_credit := CASE
                WHEN v_lt.monthly_cap IS NOT NULL AND v_lt.monthly_cap > 0 THEN LEAST(v_lt.monthly_cap, COALESCE(NULLIF(ROUND(COALESCE(v_lt.yearly_quota, 12) / 12.0, 2), 0), 1.0))
                WHEN v_lt.yearly_quota IS NOT NULL AND v_lt.yearly_quota > 0 THEN ROUND(v_lt.yearly_quota / 12.0, 2)
                ELSE 1.0
            END;

            IF v_credit <= 0 THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            v_idemp_key := format('monthly_accrual:%s:%s:%s:%s', v_year_month, p_organization_id, v_emp.id, v_lt.leave_type_id);

            -- Attempt to record ledger line first; unique index guarantees idempotency across retries
            BEGIN
                INSERT INTO public.leave_balance_adjustments (
                    organization_id, employee_id, leave_type_id, adjusted_by, amount, reason, idempotency_key
                ) VALUES (
                    p_organization_id,
                    v_emp.id,
                    v_lt.leave_type_id,
                    v_emp.id,
                    v_credit,
                    format('Automated monthly %s allocation for %s', v_lt.code, v_year_month),
                    v_idemp_key
                );
                v_inserted := TRUE;
            EXCEPTION WHEN unique_violation THEN
                v_inserted := FALSE;
            END;

            IF NOT v_inserted THEN
                v_skipped := v_skipped + 1;
                CONTINUE;
            END IF;

            INSERT INTO public.leave_balances (
                organization_id, employee_id, leave_type_id, period_start, period_end, allocated, used, carried_forward, adjusted
            ) VALUES (
                p_organization_id, v_emp.id, v_lt.leave_type_id, v_p_start, v_p_end, v_credit, 0, 0, 0
            )
            ON CONFLICT (organization_id, employee_id, leave_type_id, period_start, period_end)
            DO UPDATE SET
                allocated = public.leave_balances.allocated + EXCLUDED.allocated,
                updated_at = pg_catalog.now();

            v_processed := v_processed + 1;
            IF NOT (v_emp.id = ANY(v_credited_ids)) THEN
                v_credited_ids := array_append(v_credited_ids, v_emp.id);
            END IF;
        END LOOP;
    END LOOP;

    RETURN jsonb_build_object(
        'batch_employees', v_emp_count,
        'processed', v_processed,
        'skipped', v_skipped,
        'credited_employee_ids', to_jsonb(v_credited_ids),
        'year_month', v_year_month
    );
END;
$$;

REVOKE ALL ON FUNCTION public.service_accrue_org_leave_balances(UUID, INTEGER, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_accrue_org_leave_balances(UUID, INTEGER, INTEGER, INTEGER, INTEGER) TO service_role;

-- 8. Durable Multi-Instance Auth Recovery Challenges & Rate Limit Store
CREATE TABLE IF NOT EXISTS public.auth_recovery_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
    purpose TEXT NOT NULL CHECK (purpose IN ('mfa_recovery', 'password_reset', 'email_verify', 'password_change_reauth')),
    code_hash TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    consumed_by_ip TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_auth_recovery_challenges_active
    ON public.auth_recovery_challenges (user_id, purpose, created_at DESC)
    WHERE consumed_at IS NULL;

ALTER TABLE public.auth_recovery_challenges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_recovery_challenges FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.auth_rate_limits (
    key TEXT PRIMARY KEY,
    attempts INTEGER NOT NULL DEFAULT 0,
    locked_until TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

ALTER TABLE public.auth_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.auth_rate_limits FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.consume_auth_recovery_challenge(
    p_user_id UUID,
    p_purpose TEXT,
    p_code_hash TEXT,
    p_token_hash TEXT DEFAULT NULL,
    p_ip TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_challenge RECORD;
BEGIN
    SELECT * INTO v_challenge
    FROM public.auth_recovery_challenges
    WHERE user_id = p_user_id
      AND purpose = p_purpose
      AND consumed_at IS NULL
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_challenge IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
    END IF;

    IF v_challenge.expires_at <= pg_catalog.now() THEN
        UPDATE public.auth_recovery_challenges
        SET consumed_at = pg_catalog.now(),
            consumed_by_ip = COALESCE(p_ip, 'expired')
        WHERE id = v_challenge.id;
        RETURN jsonb_build_object('ok', false, 'reason', 'expired');
    END IF;

    IF v_challenge.attempts >= v_challenge.max_attempts THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'too_many_attempts');
    END IF;

    IF v_challenge.code_hash IS DISTINCT FROM p_code_hash
       OR (p_token_hash IS NOT NULL AND v_challenge.token_hash IS DISTINCT FROM p_token_hash) THEN
        UPDATE public.auth_recovery_challenges
        SET attempts = attempts + 1
        WHERE id = v_challenge.id;
        RETURN jsonb_build_object('ok', false, 'reason', 'invalid_code', 'attempts', v_challenge.attempts + 1);
    END IF;

    UPDATE public.auth_recovery_challenges
    SET consumed_at = pg_catalog.now(),
        consumed_by_ip = p_ip
    WHERE id = v_challenge.id
      AND consumed_at IS NULL;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'reason', 'already_consumed');
    END IF;

    -- Supersede any older active challenges of same user + purpose
    UPDATE public.auth_recovery_challenges
    SET consumed_at = pg_catalog.now(),
        consumed_by_ip = COALESCE(p_ip, 'superseded')
    WHERE user_id = p_user_id
      AND purpose = p_purpose
      AND consumed_at IS NULL
      AND id <> v_challenge.id;

    RETURN jsonb_build_object('ok', true, 'challenge_id', v_challenge.id);
END;
$$;

REVOKE ALL ON FUNCTION public.consume_auth_recovery_challenge(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_auth_recovery_challenge(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- 8. Support multi-organization memberships per user while preserving cross-tenant guards
ALTER TABLE public.organization_members
    DROP CONSTRAINT IF EXISTS organization_members_user_id_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.organization_members'::regclass
          AND conname = 'organization_members_org_user_key'
    ) THEN
        ALTER TABLE public.organization_members
            ADD CONSTRAINT organization_members_org_user_key UNIQUE (organization_id, user_id);
    END IF;
END $$;

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
    ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = p_role, status = 'active', updated_at = pg_catalog.now();

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
    WHERE user_id = p_user_id
    ORDER BY CASE WHEN organization_id = p_organization_id THEN 0 ELSE 1 END
    LIMIT 1;

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
    ) ON CONFLICT (organization_id, user_id) DO UPDATE
    SET role = EXCLUDED.role,
        department_id = EXCLUDED.department_id,
        status = 'active',
        updated_at = pg_catalog.now();

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

-- 9. Revoke PUBLIC/anon execute on approve_permission_request & scope employee_onboarding_audit to organization_id
DO $$
BEGIN
    IF to_regprocedure('public.approve_permission_request(uuid,text)') IS NOT NULL THEN
        REVOKE ALL ON FUNCTION public.approve_permission_request(UUID, TEXT) FROM PUBLIC, anon;
        GRANT EXECUTE ON FUNCTION public.approve_permission_request(UUID, TEXT) TO authenticated;
    END IF;
END $$;

DO $$
BEGIN
    IF to_regclass('public.employee_onboarding_audit') IS NOT NULL THEN
        ALTER TABLE public.employee_onboarding_audit
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;

        UPDATE public.employee_onboarding_audit a
        SET organization_id = e.organization_id
        FROM public.employees e
        WHERE a.organization_id IS NULL
          AND e.id = a.employee_id;

        UPDATE public.employee_onboarding_audit a
        SET organization_id = om.organization_id
        FROM public.organization_members om
        WHERE a.organization_id IS NULL
          AND om.user_id = a.employee_id;

        CREATE INDEX IF NOT EXISTS idx_onboarding_audit_org_emp
            ON public.employee_onboarding_audit(organization_id, employee_id);

        DROP POLICY IF EXISTS "onboarding_audit_select_own_or_admin" ON public.employee_onboarding_audit;
        CREATE POLICY "onboarding_audit_select_own_or_admin" ON public.employee_onboarding_audit
            FOR SELECT TO authenticated
            USING (
                (
                    organization_id = (SELECT public.current_org_id())
                    AND (
                        employee_id = (SELECT auth.uid())
                        OR (SELECT public.current_user_role()) IN ('hr', 'admin')
                    )
                )
                OR (
                    organization_id IS NULL
                    AND employee_id = (SELECT auth.uid())
                )
            );
    END IF;
END $$;

-- 10. Revoke PUBLIC/anon EXECUTE on all remaining SECURITY DEFINER helper/trigger functions & scope idempotency_keys
DO $$
DECLARE
    v_fn TEXT;
BEGIN
    FOREACH v_fn IN ARRAY ARRAY[
        'public.provision_invited_employee(uuid,uuid,text,text,text,text,text,uuid,uuid,uuid,integer,integer[],integer,text)',
        'public.generate_next_employee_number(text)',
        'public.trg_derive_kpi_reviews_org_id()',
        'public.trg_derive_kpi_emp_org_id()'
    ]
    LOOP
        IF to_regprocedure(v_fn) IS NOT NULL THEN
            EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon', v_fn);
        END IF;
    END LOOP;
END $$;

DO $$
BEGIN
    IF to_regclass('public.idempotency_keys') IS NOT NULL THEN
        ALTER TABLE public.idempotency_keys
            ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE;
    END IF;
END $$;

-- 11. Restore hardened current_user_role(), multi-day leave constraint, and complete notifications_type_check
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

REVOKE ALL ON FUNCTION public.current_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.current_user_role() TO authenticated, service_role;

ALTER TABLE public.leave_requests DROP CONSTRAINT IF EXISTS chk_leave_request_half_day_single_date;
ALTER TABLE public.leave_requests ADD CONSTRAINT chk_leave_request_half_day_single_date
    CHECK (day_part = 'full' OR start_date = end_date);

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
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
        'kpi_review',
        'onboarding_submission',
        'onboarding_status'
    )
);
