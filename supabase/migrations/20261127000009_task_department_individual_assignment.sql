-- ============================================================================
-- Migration: Department / Individual Assignment on Standalone & Project Tasks
-- ============================================================================
-- 1. Extend public.tasks with `department_id`, `department_ids`, and `assignment_type`.
-- 2. Backfill tasks that belong to projects with their project's scope metadata.
-- 3. Update `tasks_select_policy` and `assign_task(UUID, UUID)` so tasks scoped
--    to a department are visible to and reassignable by that department's head.
-- ============================================================================

ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS department_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
    ADD COLUMN IF NOT EXISTS assignment_type TEXT NOT NULL DEFAULT 'company';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'tasks_assignment_type_check'
          AND conrelid = 'public.tasks'::regclass
    ) THEN
        ALTER TABLE public.tasks
            ADD CONSTRAINT tasks_assignment_type_check
            CHECK (assignment_type IN ('company', 'department', 'individual'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_tasks_org_dept
    ON public.tasks (organization_id, department_id)
    WHERE department_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_department_ids_gin
    ON public.tasks USING GIN (department_ids);

UPDATE public.tasks t
SET assignment_type = p.assignment_type,
    department_id = p.department_id,
    department_ids = p.department_ids
FROM public.projects p
WHERE t.project_id = p.id
  AND t.project_id IS NOT NULL;

-- Include direct task department ownership in tasks_select_policy
DROP POLICY IF EXISTS "tasks_select_policy" ON public.tasks;

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
            OR EXISTS (
                SELECT 1
                FROM public.departments d
                WHERE d.organization_id = tasks.organization_id
                  AND d.department_head_id = (SELECT auth.uid())
                  AND (
                      d.id = tasks.department_id
                      OR d.id = ANY(tasks.department_ids)
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM public.projects p
                WHERE p.id = tasks.project_id
                  AND p.organization_id = tasks.organization_id
                  AND (
                      p.incharge_id = (SELECT auth.uid())
                      OR (
                          (p.incharge_id IS NULL OR COALESCE(array_length(p.department_ids, 1), 0) > 1)
                          AND EXISTS (
                              SELECT 1
                              FROM public.departments d
                              WHERE d.organization_id = tasks.organization_id
                                AND d.department_head_id = (SELECT auth.uid())
                                AND (
                                    d.id = p.department_id
                                    OR d.id = ANY(p.department_ids)
                                )
                          )
                      )
                  )
            )
            OR EXISTS (
                SELECT 1
                FROM public.employees e
                JOIN public.departments d
                  ON d.id = e.department_id
                 AND d.organization_id = e.organization_id
                WHERE e.organization_id = tasks.organization_id
                  AND d.department_head_id = (SELECT auth.uid())
                  AND e.id IN (tasks.assignee_id, tasks.creator_id)
            )
        )
    );

-- Update assign_task so Department Heads can also reassign department-scoped tasks directly
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
    v_cur_assignee_dept UUID;
    v_new_assignee_mgr UUID;
    v_new_assignee_dept UUID;
    v_creator_mgr UUID;
    v_creator_dept UUID;
    v_headed_dept_ids UUID[];
    v_is_dept_head BOOLEAN := FALSE;
    v_in_caller_project BOOLEAN := FALSE;
    v_in_caller_task_dept BOOLEAN := FALSE;
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

    SELECT COALESCE(array_agg(d.id), '{}'::uuid[])
    INTO v_headed_dept_ids
    FROM public.departments d
    WHERE d.organization_id = v_org_id
      AND d.department_head_id = v_caller_id;

    v_is_dept_head := COALESCE(array_length(v_headed_dept_ids, 1), 0) > 0;

    IF v_is_dept_head AND v_caller_role NOT IN ('hr', 'admin') THEN
        IF v_old_row.assignee_id IS NOT NULL THEN
            SELECT manager_id, department_id
            INTO v_cur_assignee_mgr, v_cur_assignee_dept
            FROM public.employees
            WHERE id = v_old_row.assignee_id;
        END IF;
        SELECT manager_id, department_id
        INTO v_creator_mgr, v_creator_dept
        FROM public.employees
        WHERE id = v_old_row.creator_id;

        v_in_caller_task_dept :=
            (v_old_row.department_id IS NOT NULL AND v_old_row.department_id = ANY(v_headed_dept_ids))
            OR (v_old_row.department_ids && v_headed_dept_ids);

        IF v_old_row.project_id IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1
                FROM public.projects p
                WHERE p.id = v_old_row.project_id
                  AND p.organization_id = v_org_id
                  AND (
                      p.incharge_id = v_caller_id
                      OR (
                          (p.incharge_id IS NULL OR COALESCE(array_length(p.department_ids, 1), 0) > 1)
                          AND (
                              p.department_id = ANY(v_headed_dept_ids)
                              OR p.department_ids && v_headed_dept_ids
                          )
                      )
                  )
            ) INTO v_in_caller_project;
        END IF;

        IF v_old_row.creator_id IS DISTINCT FROM v_caller_id
           AND v_old_row.assignee_id IS DISTINCT FROM v_caller_id
           AND NOT v_in_caller_task_dept
           AND NOT v_in_caller_project
           AND (v_cur_assignee_dept IS NULL OR NOT (v_cur_assignee_dept = ANY(v_headed_dept_ids)))
           AND (v_creator_dept IS NULL OR NOT (v_creator_dept = ANY(v_headed_dept_ids)))
           AND v_cur_assignee_mgr IS DISTINCT FROM v_caller_id
           AND v_creator_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Department heads can only reassign tasks within their department or assigned projects.' USING ERRCODE = '42501';
        END IF;
    ELSIF v_caller_role = 'employee' THEN
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
        SELECT e.manager_id, e.department_id
        INTO v_new_assignee_mgr, v_new_assignee_dept
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

        IF v_is_dept_head AND v_caller_role NOT IN ('hr', 'admin') THEN
            IF p_assignee_id IS DISTINCT FROM v_caller_id
               AND (v_new_assignee_dept IS NULL OR NOT (v_new_assignee_dept = ANY(v_headed_dept_ids))) THEN
                RAISE EXCEPTION 'Forbidden: Department heads can only assign tasks to members of their department.' USING ERRCODE = '42501';
            END IF;
        ELSIF v_caller_role = 'manager'
           AND p_assignee_id IS DISTINCT FROM v_caller_id
           AND v_new_assignee_mgr IS DISTINCT FROM v_caller_id THEN
            RAISE EXCEPTION 'Forbidden: Managers can only assign tasks to themselves or direct reports.' USING ERRCODE = '42501';
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
