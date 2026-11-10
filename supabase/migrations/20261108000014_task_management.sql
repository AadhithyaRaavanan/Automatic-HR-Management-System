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

