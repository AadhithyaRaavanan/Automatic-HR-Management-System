-- Update delete_project RPC and projects FK so deleting a project permanently deletes all linked tasks (Admin-only).

DO $$
DECLARE
    v_constraint_name TEXT;
BEGIN
    SELECT tc.constraint_name
    INTO v_constraint_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name
     AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND tc.table_name = 'tasks'
      AND kcu.column_name = 'project_id'
      AND ccu.table_schema = 'public'
      AND ccu.table_name = 'projects'
    LIMIT 1;

    IF v_constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.tasks DROP CONSTRAINT %I', v_constraint_name);
    END IF;

    ALTER TABLE public.tasks
        ADD CONSTRAINT tasks_project_id_fkey
        FOREIGN KEY (project_id)
        REFERENCES public.projects(id)
        ON DELETE CASCADE;
END $$;

CREATE OR REPLACE FUNCTION public.delete_project(
    p_project_id UUID
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
    v_require_mfa BOOLEAN;
    v_row RECORD;
    v_deleted_tasks_count INTEGER := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can delete projects.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT COALESCE(o.require_mfa_for_privileged, TRUE)
    INTO v_require_mfa
    FROM public.organizations o
    WHERE o.id = v_org_id;

    IF COALESCE(v_require_mfa, TRUE) THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for Admin project deletion.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_project_id IS NULL THEN
        RAISE EXCEPTION 'Project ID is required.' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_row
    FROM public.projects p
    WHERE p.id = p_project_id
      AND p.organization_id = v_org_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Project not found in caller organization.' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.tasks
    WHERE project_id = p_project_id
      AND organization_id = v_org_id;

    GET DIAGNOSTICS v_deleted_tasks_count = ROW_COUNT;

    DELETE FROM public.projects
    WHERE id = p_project_id
      AND organization_id = v_org_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'PROJECT_DELETED',
        'projects',
        p_project_id,
        to_jsonb(v_row) || jsonb_build_object('deleted_tasks_count', v_deleted_tasks_count),
        NULL
    );

    RETURN jsonb_build_object(
        'success', true,
        'deleted_project_id', p_project_id,
        'deleted_tasks_count', v_deleted_tasks_count
    );
END;
$$;

REVOKE ALL ON FUNCTION public.delete_project(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project(UUID) TO authenticated;
