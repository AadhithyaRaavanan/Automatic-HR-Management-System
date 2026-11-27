-- Migration: 20261127000003_sync_employees_and_fix_rls.sql
-- 1. Sync active organization_members (including tenant admins) into public.employees
--    so /ems/employees and /employees stay in sync with /admin/users.
-- 2. Ensure authenticated members in the same org_id (or single-tenant schemas
--    without organization_id on a table) can read employees and own notifications /
--    attendance_* records without 403 Forbidden or 42703 errors.

DO $$
DECLARE
    v_has_org_members BOOLEAN := to_regclass('public.organization_members') IS NOT NULL;
    v_has_emp_org_col BOOLEAN;
    v_has_emp_dept_col BOOLEAN;
    v_has_emp_title_col BOOLEAN;
    v_has_emp_shift_col BOOLEAN;
    v_has_emp_onb_col BOOLEAN;
BEGIN
    IF v_has_org_members AND to_regclass('public.employees') IS NOT NULL THEN
        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'organization_id'
        ) INTO v_has_emp_org_col;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'department_id'
        ) INTO v_has_emp_dept_col;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'job_title_id'
        ) INTO v_has_emp_title_col;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'shift_start_time'
        ) INTO v_has_emp_shift_col;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'onboarding_completed'
        ) INTO v_has_emp_onb_col;

        IF v_has_emp_org_col AND v_has_emp_dept_col AND v_has_emp_title_col AND v_has_emp_shift_col AND v_has_emp_onb_col THEN
            INSERT INTO public.employees (
                id,
                organization_id,
                email,
                full_name,
                status,
                work_mode,
                timezone,
                department_id,
                job_title_id,
                shift_start_time,
                shift_end_time,
                onboarding_completed
            )
            SELECT
                om.user_id,
                om.organization_id,
                u.email,
                COALESCE(
                    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
                    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
                    split_part(u.email, '@', 1)
                ),
                'active',
                'remote',
                COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'timezone'), ''), 'Asia/Kolkata'),
                om.department_id,
                om.job_title_id,
                COALESCE(om.shift_start_time, '09:00:00'::time),
                COALESCE(om.shift_end_time, '17:00:00'::time),
                true
            FROM public.organization_members om
            JOIN auth.users u ON u.id = om.user_id
            WHERE om.status = 'active'
              AND u.email IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM public.employees e WHERE e.id = om.user_id
              )
            ON CONFLICT (id) DO NOTHING;
        ELSE
            INSERT INTO public.employees (id, email, full_name, status, timezone)
            SELECT
                om.user_id,
                u.email,
                COALESCE(
                    NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
                    NULLIF(TRIM(u.raw_user_meta_data->>'name'), ''),
                    split_part(u.email, '@', 1)
                ),
                'active',
                COALESCE(NULLIF(TRIM(u.raw_user_meta_data->>'timezone'), ''), 'Asia/Kolkata')
            FROM public.organization_members om
            JOIN auth.users u ON u.id = om.user_id
            WHERE om.status = 'active'
              AND u.email IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM public.employees e WHERE e.id = om.user_id
              )
            ON CONFLICT (id) DO NOTHING;
        END IF;
    END IF;
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping auth.users employee sync: %', SQLERRM;
END $$;

-- 2. Grants & schema-adaptive RLS policies
DO $$
DECLARE
    v_has_current_org BOOLEAN := to_regprocedure('public.current_org_id()') IS NOT NULL;
    v_has_current_role BOOLEAN := to_regprocedure('public.current_user_role()') IS NOT NULL;
    v_emp_has_org BOOLEAN;
    v_notif_has_org BOOLEAN;
    v_sess_has_org BOOLEAN;
    v_days_has_org BOOLEAN;
BEGIN
    IF to_regclass('public.employees') IS NOT NULL THEN
        GRANT SELECT ON public.employees TO authenticated;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'organization_id'
        ) INTO v_emp_has_org;

        DROP POLICY IF EXISTS "employees_select_policy" ON public.employees;
        IF v_emp_has_org AND v_has_current_org THEN
            EXECUTE $pol$
                CREATE POLICY "employees_select_policy" ON public.employees
                FOR SELECT TO authenticated
                USING (
                    id = (SELECT auth.uid())
                    OR organization_id = (SELECT public.current_org_id())
                )
            $pol$;
        ELSE
            EXECUTE $pol$
                CREATE POLICY "employees_select_policy" ON public.employees
                FOR SELECT TO authenticated
                USING (true)
            $pol$;
        END IF;
    END IF;

    IF to_regclass('public.notifications') IS NOT NULL THEN
        GRANT SELECT, UPDATE ON public.notifications TO authenticated;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'organization_id'
        ) INTO v_notif_has_org;

        DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
        DROP POLICY IF EXISTS "Users can update own notifications read_at" ON public.notifications;
        DROP POLICY IF EXISTS "notifications_select_policy" ON public.notifications;
        DROP POLICY IF EXISTS "notifications_update_policy" ON public.notifications;

        IF v_notif_has_org AND v_has_current_org THEN
            EXECUTE $pol$
                CREATE POLICY "notifications_select_policy" ON public.notifications
                FOR SELECT TO authenticated
                USING (
                    user_id = (SELECT auth.uid())
                    AND (
                        organization_id IS NULL
                        OR organization_id = (SELECT public.current_org_id())
                    )
                )
            $pol$;
            EXECUTE $pol$
                CREATE POLICY "notifications_update_policy" ON public.notifications
                FOR UPDATE TO authenticated
                USING (
                    user_id = (SELECT auth.uid())
                    AND (
                        organization_id IS NULL
                        OR organization_id = (SELECT public.current_org_id())
                    )
                )
                WITH CHECK (
                    user_id = (SELECT auth.uid())
                    AND (
                        organization_id IS NULL
                        OR organization_id = (SELECT public.current_org_id())
                    )
                )
            $pol$;
        ELSE
            EXECUTE $pol$
                CREATE POLICY "notifications_select_policy" ON public.notifications
                FOR SELECT TO authenticated
                USING (user_id = (SELECT auth.uid()))
            $pol$;
            EXECUTE $pol$
                CREATE POLICY "notifications_update_policy" ON public.notifications
                FOR UPDATE TO authenticated
                USING (user_id = (SELECT auth.uid()))
                WITH CHECK (user_id = (SELECT auth.uid()))
            $pol$;
        END IF;
    END IF;

    IF to_regclass('public.attendance_sessions') IS NOT NULL THEN
        GRANT SELECT ON public.attendance_sessions TO authenticated;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'attendance_sessions' AND column_name = 'organization_id'
        ) INTO v_sess_has_org;

        DROP POLICY IF EXISTS "attendance_sessions_select_policy" ON public.attendance_sessions;
        IF v_sess_has_org AND v_has_current_org AND v_has_current_role THEN
            EXECUTE $pol$
                CREATE POLICY "attendance_sessions_select_policy" ON public.attendance_sessions
                FOR SELECT TO authenticated
                USING (
                    employee_id = (SELECT auth.uid())
                    OR (
                        organization_id = (SELECT public.current_org_id())
                        AND (
                            employee_id IN (
                                SELECT employees.id
                                FROM public.employees
                                WHERE employees.manager_id = (SELECT auth.uid())
                            )
                            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
                        )
                    )
                )
            $pol$;
        ELSIF v_has_current_role THEN
            EXECUTE $pol$
                CREATE POLICY "attendance_sessions_select_policy" ON public.attendance_sessions
                FOR SELECT TO authenticated
                USING (
                    employee_id = (SELECT auth.uid())
                    OR employee_id IN (
                        SELECT employees.id
                        FROM public.employees
                        WHERE employees.manager_id = (SELECT auth.uid())
                    )
                    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
                )
            $pol$;
        ELSE
            EXECUTE $pol$
                CREATE POLICY "attendance_sessions_select_policy" ON public.attendance_sessions
                FOR SELECT TO authenticated
                USING (employee_id = (SELECT auth.uid()))
            $pol$;
        END IF;
    END IF;

    IF to_regclass('public.attendance_days') IS NOT NULL THEN
        GRANT SELECT ON public.attendance_days TO authenticated;

        SELECT EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'attendance_days' AND column_name = 'organization_id'
        ) INTO v_days_has_org;

        DROP POLICY IF EXISTS "attendance_days_select_policy" ON public.attendance_days;
        IF v_days_has_org AND v_has_current_org AND v_has_current_role THEN
            EXECUTE $pol$
                CREATE POLICY "attendance_days_select_policy" ON public.attendance_days
                FOR SELECT TO authenticated
                USING (
                    employee_id = (SELECT auth.uid())
                    OR (
                        organization_id = (SELECT public.current_org_id())
                        AND (
                            employee_id IN (
                                SELECT employees.id
                                FROM public.employees
                                WHERE employees.manager_id = (SELECT auth.uid())
                            )
                            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
                        )
                    )
                )
            $pol$;
        ELSIF v_has_current_role THEN
            EXECUTE $pol$
                CREATE POLICY "attendance_days_select_policy" ON public.attendance_days
                FOR SELECT TO authenticated
                USING (
                    employee_id = (SELECT auth.uid())
                    OR employee_id IN (
                        SELECT employees.id
                        FROM public.employees
                        WHERE employees.manager_id = (SELECT auth.uid())
                    )
                    OR (SELECT public.current_user_role()) IN ('hr', 'admin')
                )
            $pol$;
        ELSE
            EXECUTE $pol$
                CREATE POLICY "attendance_days_select_policy" ON public.attendance_days
                FOR SELECT TO authenticated
                USING (employee_id = (SELECT auth.uid()))
            $pol$;
        END IF;
    END IF;
END $$;
