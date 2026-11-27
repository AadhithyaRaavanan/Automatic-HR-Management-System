-- ============================================================================
-- Migration: Department / Individual Project Assignment & Department Head Scoping
-- ============================================================================
-- 1. Extend public.projects with `incharge_id`, `department_ids`, and `assignment_type`.
-- 2. Backfill existing department-linked projects so `department_ids` and
--    `incharge_id` (from `departments.department_head_id`) stay consistent.
-- 3. Update `tasks_select_policy` so Department Heads & Project Incharges can
--    see tasks within their assigned projects and department members.
-- 4. Update `create_project(TEXT, UUID, TEXT, TEXT)` (preserving signature) to
--    auto-populate `assignment_type`, `department_ids`, and lock `incharge_id`
--    to the department head when the department already has an assigned head.
-- 5. Update `create_task(...)` and `assign_task(UUID, UUID)` so:
--    - Department Heads can assign existing tasks to members of their department.
--    - Department Heads can create new tasks ONLY inside projects assigned to
--      them and assign them only to members of their department (or self).
-- ============================================================================

ALTER TABLE public.projects
    ADD COLUMN IF NOT EXISTS incharge_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS department_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
    ADD COLUMN IF NOT EXISTS assignment_type TEXT NOT NULL DEFAULT 'company';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'projects_assignment_type_check'
          AND conrelid = 'public.projects'::regclass
    ) THEN
        ALTER TABLE public.projects
            ADD CONSTRAINT projects_assignment_type_check
            CHECK (assignment_type IN ('company', 'department', 'individual'));
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_incharge
    ON public.projects (organization_id, incharge_id)
    WHERE incharge_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_projects_department_ids_gin
    ON public.projects USING GIN (department_ids);

-- Backfill existing department-scoped projects cleanly
UPDATE public.projects p
SET assignment_type = 'department',
    department_ids = ARRAY[p.department_id],
    incharge_id = COALESCE(p.incharge_id, d.department_head_id)
FROM public.departments d
WHERE p.department_id = d.id
  AND p.department_id IS NOT NULL
  AND COALESCE(array_length(p.department_ids, 1), 0) = 0;

-- Update tasks_select_policy to include Department Head & Project Incharge visibility
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

-- Preserve exact 4-param create_project signature while auto-locking department head Incharge
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
    v_dept_head_id UUID;
    v_assignment_type TEXT := 'company';
    v_dept_ids UUID[] := '{}'::uuid[];
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

    IF p_department_id IS NOT NULL THEN
        SELECT d.department_head_id INTO v_dept_head_id
        FROM public.departments d
        WHERE d.id = p_department_id AND d.organization_id = v_org_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Department not found in caller organization.' USING ERRCODE = '42501';
        END IF;

        v_assignment_type := 'department';
        v_dept_ids := ARRAY[p_department_id];
    END IF;

    v_code := NULLIF(pg_catalog.btrim(COALESCE(p_code, '')), '');
    v_desc := NULLIF(pg_catalog.btrim(COALESCE(p_description, '')), '');

    INSERT INTO public.projects (
        organization_id, department_id, department_ids, incharge_id, assignment_type, name, code, description, created_by
    ) VALUES (
        v_org_id, p_department_id, v_dept_ids, v_dept_head_id, v_assignment_type, v_name, v_code, v_desc, v_caller_id
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

-- Update create_task with Department Head project-scoping & department-member assignment rules
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
    v_assignee_dept UUID;
    v_headed_dept_ids UUID[];
    v_is_dept_head BOOLEAN := FALSE;
    v_proj_row RECORD;
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

    SELECT COALESCE(array_agg(d.id), '{}'::uuid[])
    INTO v_headed_dept_ids
    FROM public.departments d
    WHERE d.organization_id = v_org_id
      AND d.department_head_id = v_caller_id;

    v_is_dept_head := COALESCE(array_length(v_headed_dept_ids, 1), 0) > 0;

    IF v_caller_role = 'employee'
       AND NOT v_is_dept_head
       AND p_assignee_id IS NOT NULL
       AND p_assignee_id IS DISTINCT FROM v_caller_id THEN
        RAISE EXCEPTION 'Forbidden: Employees cannot assign tasks to other employees.' USING ERRCODE = '42501';
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

    IF p_project_id IS NOT NULL THEN
        SELECT p.id, p.organization_id, p.incharge_id, p.department_id, p.department_ids
        INTO v_proj_row
        FROM public.projects p
        WHERE p.id = p_project_id AND p.organization_id = v_org_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Forbidden: Project does not belong to caller organization.' USING ERRCODE = '42501';
        END IF;
    END IF;

    -- Department heads (non-HR/Admin) can only create tasks inside projects assigned to them
    IF v_is_dept_head AND v_caller_role NOT IN ('hr', 'admin') THEN
        IF p_project_id IS NULL THEN
            RAISE EXCEPTION 'Forbidden: Department heads can only create tasks inside projects assigned to them.' USING ERRCODE = '42501';
        END IF;

        IF NOT (
            v_proj_row.incharge_id = v_caller_id
            OR (
                (v_proj_row.incharge_id IS NULL OR COALESCE(array_length(v_proj_row.department_ids, 1), 0) > 1)
                AND (
                    v_proj_row.department_id = ANY(v_headed_dept_ids)
                    OR v_proj_row.department_ids && v_headed_dept_ids
                )
            )
        ) THEN
            RAISE EXCEPTION 'Forbidden: Department heads can only create tasks inside projects assigned to them.' USING ERRCODE = '42501';
        END IF;
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
        SELECT e.manager_id, e.department_id
        INTO v_assignee_mgr, v_assignee_dept
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

        IF v_is_dept_head AND v_caller_role NOT IN ('hr', 'admin') THEN
            IF p_assignee_id IS DISTINCT FROM v_caller_id
               AND (v_assignee_dept IS NULL OR NOT (v_assignee_dept = ANY(v_headed_dept_ids))) THEN
                RAISE EXCEPTION 'Forbidden: Department heads can only assign tasks to members of their department.' USING ERRCODE = '42501';
            END IF;
        ELSIF v_caller_role = 'manager'
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

-- Update assign_task to let Department Heads reassign existing tasks in their department/project to department members
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
