-- Migration: 20261127000005_fix_user_roles_grants.sql
-- Ensures server-side service_role has explicit table, sequence, and insert/select/update/delete
-- privileges (plus explicit RLS policies) on public.user_roles, public.employees, and related tables.

DO $$
DECLARE
    v_relkind CHAR;
    v_tbl TEXT;
BEGIN
    GRANT USAGE ON SCHEMA public TO service_role, authenticated;
    GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO service_role;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

    BEGIN
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
            GRANT ALL ON TABLES TO service_role;
        ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
            GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO service_role;
    EXCEPTION WHEN insufficient_privilege THEN
        NULL;
    END;

    -- 1. public.user_roles grants & RLS
    SELECT c.relkind INTO v_relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'user_roles';

    IF v_relkind IN ('r', 'p') THEN
        GRANT ALL PRIVILEGES ON TABLE public.user_roles TO service_role;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_roles TO service_role;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.user_roles TO authenticated;

        ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "user_roles_service_role_policy" ON public.user_roles;
        CREATE POLICY "user_roles_service_role_policy" ON public.user_roles
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);

        DROP POLICY IF EXISTS "user_roles_select_policy" ON public.user_roles;
        CREATE POLICY "user_roles_select_policy" ON public.user_roles
        FOR SELECT TO authenticated
        USING (
            user_id = (SELECT auth.uid())
            OR (SELECT public.current_user_role()) IN ('hr', 'admin')
        );

        DROP POLICY IF EXISTS "user_roles_admin_manage_policy" ON public.user_roles;
        CREATE POLICY "user_roles_admin_manage_policy" ON public.user_roles
        FOR ALL TO authenticated
        USING ((SELECT public.current_user_role()) IN ('admin', 'hr'))
        WITH CHECK ((SELECT public.current_user_role()) IN ('admin', 'hr'));
    ELSIF v_relkind = 'v' THEN
        GRANT SELECT ON public.user_roles TO authenticated, service_role;
    END IF;

    -- 2. public.employees explicit service_role grants & RLS
    SELECT c.relkind INTO v_relkind
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'employees';

    IF v_relkind IN ('r', 'p') THEN
        GRANT ALL PRIVILEGES ON TABLE public.employees TO service_role;
        GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.employees TO service_role;
        GRANT SELECT, INSERT ON TABLE public.employees TO authenticated;

        -- Ensure nullable organizational columns remain optional when unassigned
        BEGIN
            ALTER TABLE public.employees ALTER COLUMN department_id DROP NOT NULL;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;
        BEGIN
            ALTER TABLE public.employees ALTER COLUMN job_title_id DROP NOT NULL;
        EXCEPTION WHEN OTHERS THEN NULL;
        END;

        ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;

        DROP POLICY IF EXISTS "employees_service_role_policy" ON public.employees;
        CREATE POLICY "employees_service_role_policy" ON public.employees
        FOR ALL TO service_role
        USING (true)
        WITH CHECK (true);

        DROP POLICY IF EXISTS "employees_insert_policy" ON public.employees;
        CREATE POLICY "employees_insert_policy" ON public.employees
        FOR INSERT TO authenticated
        WITH CHECK ((SELECT public.current_user_role()) IN ('hr', 'admin'));
    ELSIF v_relkind = 'v' THEN
        GRANT SELECT ON public.employees TO authenticated, service_role;
    END IF;

    -- 3. Supporting provisioning & EMS tables
    FOREACH v_tbl IN ARRAY ARRAY[
        'public.organization_members',
        'public.onboarding_profiles',
        'public.departments',
        'public.job_titles',
        'public.locations',
        'public.audit_logs',
        'public.holidays',
        'public.attendance_days',
        'public.attendance_sessions',
        'public.notifications'
    ]
    LOOP
        IF to_regclass(v_tbl) IS NOT NULL THEN
            EXECUTE format('GRANT ALL PRIVILEGES ON TABLE %s TO service_role', v_tbl);
            EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %s TO service_role', v_tbl);
        END IF;
    END LOOP;
END $$;
