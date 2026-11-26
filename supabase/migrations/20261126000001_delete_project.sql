-- Admin-only task & project deletion RLS policies and SECURITY DEFINER RPCs
DROP POLICY IF EXISTS "projects_delete_policy" ON public.projects;
CREATE POLICY "projects_delete_policy" ON public.projects
    FOR DELETE TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (SELECT public.current_user_role()) = 'admin'
    );

DROP POLICY IF EXISTS "tasks_delete_policy" ON public.tasks;
CREATE POLICY "tasks_delete_policy" ON public.tasks
    FOR DELETE TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (SELECT public.current_user_role()) = 'admin'
    );

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

    DELETE FROM public.projects
    WHERE id = p_project_id
      AND organization_id = v_org_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'PROJECT_DELETED', 'projects', p_project_id, to_jsonb(v_row), NULL
    );

    RETURN jsonb_build_object('success', true, 'deleted_project_id', p_project_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_project(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_project(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.delete_task(
    p_task_id UUID
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
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS NULL OR v_caller_role <> 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only administrators can delete tasks.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    SELECT COALESCE(o.require_mfa_for_privileged, TRUE)
    INTO v_require_mfa
    FROM public.organizations o
    WHERE o.id = v_org_id;

    IF COALESCE(v_require_mfa, TRUE) THEN
        v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
        IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
            RAISE EXCEPTION 'MFA AAL2 verification required for Admin task deletion.' USING ERRCODE = '42501';
        END IF;
    END IF;

    IF p_task_id IS NULL THEN
        RAISE EXCEPTION 'Task ID is required.' USING ERRCODE = '22023';
    END IF;

    SELECT *
    INTO v_row
    FROM public.tasks t
    WHERE t.id = p_task_id
      AND t.organization_id = v_org_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Task not found in caller organization.' USING ERRCODE = 'P0002';
    END IF;

    DELETE FROM public.tasks
    WHERE id = p_task_id
      AND organization_id = v_org_id;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id, v_caller_id, 'TASK_DELETED', 'tasks', p_task_id, to_jsonb(v_row), NULL
    );

    RETURN jsonb_build_object('success', true, 'deleted_task_id', p_task_id);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_task(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_task(UUID) TO authenticated;
