-- Enforce strict employee self-assignment on create_task and assign_task RPCs.
-- Employees can only create tasks assigned to themselves and can only self-claim unassigned tasks.

CREATE OR REPLACE FUNCTION public.create_task(
    p_title TEXT,
    p_description TEXT DEFAULT NULL,
    p_assignee_id UUID DEFAULT NULL,
    p_priority TEXT DEFAULT 'medium',
    p_due_date DATE DEFAULT NULL,
    p_estimated_minutes INTEGER DEFAULT NULL,
    p_project_id UUID DEFAULT NULL,
    p_parent_task_id UUID DEFAULT NULL,
    p_task_type_id UUID DEFAULT NULL,
    p_recurrence_id UUID DEFAULT NULL,
    p_auto_due_suggested BOOLEAN DEFAULT FALSE
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

    IF v_caller_role = 'employee' AND p_assignee_id IS DISTINCT FROM v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Employees can only assign tasks to themselves.' USING ERRCODE = '42501';
    END IF;

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

    IF p_task_type_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.task_types tt
        WHERE tt.id = p_task_type_id AND tt.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Forbidden: Task type does not belong to caller organization.' USING ERRCODE = '42501';
    END IF;

    IF p_recurrence_id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.task_recurrences tr
        WHERE tr.id = p_recurrence_id AND tr.organization_id = v_org_id
    ) THEN
        RAISE EXCEPTION 'Forbidden: Task recurrence does not belong to caller organization.' USING ERRCODE = '42501';
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

        IF v_caller_role = 'manager'
          AND p_assignee_id IS DISTINCT FROM v_caller_id
          AND v_assignee_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only assign tasks to themselves or direct reports.' USING ERRCODE = '42501';
        END IF;
    END IF;

    INSERT INTO public.tasks (
        organization_id, project_id, parent_task_id, title, description,
        creator_id, assignee_id, status, priority, due_date, estimated_minutes,
        task_type_id, recurrence_id, auto_due_suggested
    ) VALUES (
        v_org_id, p_project_id, p_parent_task_id, v_title, v_desc,
        v_caller_id, p_assignee_id, 'todo', v_priority, p_due_date, p_estimated_minutes,
        p_task_type_id, p_recurrence_id, COALESCE(p_auto_due_suggested, false)
    )
    RETURNING * INTO v_row;

    INSERT INTO public.task_events (
        organization_id, task_id, actor_id, event_type, to_status, new_assignee_id, metadata
    ) VALUES (
        v_org_id, v_row.id, v_caller_id, 'created', 'todo', p_assignee_id,
        jsonb_build_object(
            'priority', v_priority,
            'due_date', p_due_date,
            'task_type_id', p_task_type_id,
            'recurrence_id', p_recurrence_id,
            'auto_due_suggested', p_auto_due_suggested
        )
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
                'Task "' || v_title || '" is due within 24 hours (' || p_due_date::text || ').',
                '/tasks?task=' || v_row.id::text,
                jsonb_build_object('task_id', v_row.id, 'due_date', p_due_date::text)
            );
        END IF;
    END IF;

    RETURN to_jsonb(v_row);
END;
$$;

REVOKE ALL ON FUNCTION public.create_task(TEXT, TEXT, UUID, TEXT, DATE, INTEGER, UUID, UUID, UUID, UUID, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_task(TEXT, TEXT, UUID, TEXT, DATE, INTEGER, UUID, UUID, UUID, UUID, BOOLEAN) TO authenticated, service_role;

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

    IF v_caller_role = 'employee' THEN
        IF p_assignee_id IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Employees can only assign tasks to themselves.' USING ERRCODE = '42501';
        END IF;
        IF v_old_row.assignee_id IS NOT NULL THEN
            RAISE EXCEPTION 'Forbidden: Employees cannot reassign tasks that are already assigned.' USING ERRCODE = '42501';
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
