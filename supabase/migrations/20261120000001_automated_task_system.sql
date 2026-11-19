-- Migration: 20261120000001_automated_task_system.sql
-- Description: Automated Task Creation System (Task Types, Templates, Recurrences, Auto Due Dates)

-- ============================================================================
-- 1. TASK TYPES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.task_types (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    department_id UUID REFERENCES public.departments(id) ON DELETE SET NULL,
    name TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(name)) >= 1),
    default_priority TEXT NOT NULL DEFAULT 'medium' CHECK (default_priority IN ('low', 'medium', 'high', 'urgent')),
    default_estimate_minutes INTEGER CHECK (default_estimate_minutes IS NULL OR (default_estimate_minutes >= 1 AND default_estimate_minutes <= 1440)),
    due_rule_working_days INTEGER CHECK (due_rule_working_days IS NULL OR (due_rule_working_days >= 0 AND due_rule_working_days <= 30)),
    description_template TEXT,
    checklist JSONB NOT NULL DEFAULT '[]'::jsonb,
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX IF NOT EXISTS idx_task_types_org_dept
    ON public.task_types (organization_id, department_id, is_active, sort_order);

REVOKE ALL ON TABLE public.task_types FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_types TO authenticated, service_role;

ALTER TABLE public.task_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_task_types_select ON public.task_types;
CREATE POLICY p_task_types_select ON public.task_types
    FOR SELECT TO authenticated
    USING (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
    );

DROP POLICY IF EXISTS p_task_types_insert ON public.task_types;
CREATE POLICY p_task_types_insert ON public.task_types
    FOR INSERT TO authenticated
    WITH CHECK (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND public.current_user_role() IN ('hr', 'admin')
    );

DROP POLICY IF EXISTS p_task_types_update ON public.task_types;
CREATE POLICY p_task_types_update ON public.task_types
    FOR UPDATE TO authenticated
    USING (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND public.current_user_role() IN ('hr', 'admin')
    )
    WITH CHECK (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND public.current_user_role() IN ('hr', 'admin')
    );

DROP POLICY IF EXISTS p_task_types_delete ON public.task_types;
CREATE POLICY p_task_types_delete ON public.task_types
    FOR DELETE TO authenticated
    USING (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND public.current_user_role() IN ('hr', 'admin')
    );


-- ============================================================================
-- 2. EXTEND TASKS TABLE WITH NULLABLE COLUMNS
-- ============================================================================
ALTER TABLE public.tasks
    ADD COLUMN IF NOT EXISTS task_type_id UUID REFERENCES public.task_types(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS recurrence_id UUID,
    ADD COLUMN IF NOT EXISTS auto_due_suggested BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_tasks_org_type
    ON public.tasks (organization_id, task_type_id);

CREATE INDEX IF NOT EXISTS idx_tasks_org_recurrence
    ON public.tasks (organization_id, recurrence_id);


-- ============================================================================
-- 3. TASK RECURRENCES TABLE
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.task_recurrences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    task_type_id UUID REFERENCES public.task_types(id) ON DELETE SET NULL,
    title TEXT NOT NULL CHECK (char_length(pg_catalog.btrim(title)) >= 2),
    description TEXT,
    priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
    estimate_minutes INTEGER CHECK (estimate_minutes IS NULL OR (estimate_minutes >= 0 AND estimate_minutes <= 100000)),
    assignee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_by UUID NOT NULL REFERENCES public.employees(id) ON DELETE RESTRICT,
    frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'every_n_working_days')),
    interval_n INTEGER NOT NULL DEFAULT 1 CHECK (interval_n >= 1),
    weekday INTEGER CHECK (weekday IS NULL OR (weekday >= 0 AND weekday <= 6)),
    day_of_month INTEGER CHECK (day_of_month IS NULL OR (day_of_month >= 1 AND day_of_month <= 31)),
    next_run_date DATE NOT NULL,
    last_created_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    end_date DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_tasks_recurrence'
    ) THEN
        ALTER TABLE public.tasks
            ADD CONSTRAINT fk_tasks_recurrence
            FOREIGN KEY (recurrence_id) REFERENCES public.task_recurrences(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_task_recurrences_org_run
    ON public.task_recurrences (organization_id, is_active, next_run_date);

CREATE INDEX IF NOT EXISTS idx_task_recurrences_creator
    ON public.task_recurrences (organization_id, created_by);

REVOKE ALL ON TABLE public.task_recurrences FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.task_recurrences TO authenticated, service_role;

ALTER TABLE public.task_recurrences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS p_task_recurrences_select ON public.task_recurrences;
CREATE POLICY p_task_recurrences_select ON public.task_recurrences
    FOR SELECT TO authenticated
    USING (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND (created_by = (SELECT auth.uid()) OR public.current_user_role() IN ('hr', 'admin'))
    );

DROP POLICY IF EXISTS p_task_recurrences_insert ON public.task_recurrences;
CREATE POLICY p_task_recurrences_insert ON public.task_recurrences
    FOR INSERT TO authenticated
    WITH CHECK (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND (created_by = (SELECT auth.uid()) OR public.current_user_role() IN ('hr', 'admin'))
    );

DROP POLICY IF EXISTS p_task_recurrences_update ON public.task_recurrences;
CREATE POLICY p_task_recurrences_update ON public.task_recurrences
    FOR UPDATE TO authenticated
    USING (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND (created_by = (SELECT auth.uid()) OR public.current_user_role() IN ('hr', 'admin'))
    )
    WITH CHECK (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND (created_by = (SELECT auth.uid()) OR public.current_user_role() IN ('hr', 'admin'))
    );

DROP POLICY IF EXISTS p_task_recurrences_delete ON public.task_recurrences;
CREATE POLICY p_task_recurrences_delete ON public.task_recurrences
    FOR DELETE TO authenticated
    USING (
        organization_id = public.current_org_id()
        AND public.is_active_org_member()
        AND (created_by = (SELECT auth.uid()) OR public.current_user_role() IN ('hr', 'admin'))
    );


-- ============================================================================
-- 4. SUGGESTED DUE DATE CALCULATOR (ASIA/KOLKATA WORKING DAYS)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.calculate_suggested_due_date(
    p_working_days INTEGER,
    p_org_id UUID DEFAULT NULL,
    p_start_date DATE DEFAULT NULL
)
RETURNS DATE
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
    v_curr DATE;
    v_added INTEGER := 0;
    v_dow INTEGER;
    v_is_holiday BOOLEAN;
BEGIN
    v_org_id := COALESCE(p_org_id, public.current_org_id());
    v_curr := COALESCE(p_start_date, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE);

    IF p_working_days IS NULL OR p_working_days <= 0 THEN
        RETURN v_curr;
    END IF;

    WHILE v_added < p_working_days LOOP
        v_curr := v_curr + 1;
        v_dow := EXTRACT(DOW FROM v_curr)::INTEGER;

        -- 0 = Sunday, 6 = Saturday
        IF v_dow != 0 AND v_dow != 6 THEN
            SELECT EXISTS (
                SELECT 1 FROM public.holidays
                WHERE organization_id = v_org_id
                  AND date = v_curr
                  AND is_active = TRUE
            ) INTO v_is_holiday;

            IF NOT v_is_holiday THEN
                v_added := v_added + 1;
            END IF;
        END IF;
    END LOOP;

    RETURN v_curr;
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_suggested_due_date(INTEGER, UUID, DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calculate_suggested_due_date(INTEGER, UUID, DATE) TO authenticated, service_role;


-- ============================================================================
-- 5. EXTENDED CREATE_TASK RPC (BACKWARD COMPATIBLE)
-- ============================================================================
DROP FUNCTION IF EXISTS public.create_task(TEXT, TEXT, UUID, TEXT, DATE, INTEGER, UUID, UUID);
DROP FUNCTION IF EXISTS public.create_task(TEXT, TEXT, UUID, TEXT, DATE, INTEGER, UUID, UUID, UUID, UUID, BOOLEAN);

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


-- ============================================================================
-- 6. RECURRING TASK DISPATCH RPC (IDEMPOTENT, ASIA/KOLKATA AWARE)
-- ============================================================================
CREATE OR REPLACE FUNCTION public.dispatch_recurring_tasks(p_today DATE DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_today DATE;
    v_rec RECORD;
    v_task_id UUID;
    v_created_count INTEGER := 0;
    v_deactivated_count INTEGER := 0;
    v_assignee_active BOOLEAN;
    v_next_date DATE;
    v_due_date DATE;
    v_due_working_days INTEGER;
    v_day_of_month INTEGER;
    v_month_start DATE;
    v_days_in_month INTEGER;
BEGIN
    v_today := COALESCE(p_today, (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::DATE);

    FOR v_rec IN
        SELECT tr.*, tt.due_rule_working_days
        FROM public.task_recurrences tr
        LEFT JOIN public.task_types tt ON tt.id = tr.task_type_id
        WHERE tr.is_active = TRUE
          AND tr.next_run_date <= v_today
          AND (tr.end_date IS NULL OR tr.next_run_date <= tr.end_date)
    LOOP
        -- Check if assignee is inactive
        IF v_rec.assignee_id IS NOT NULL THEN
            SELECT (status = 'active') INTO v_assignee_active
            FROM public.employees
            WHERE id = v_rec.assignee_id
              AND organization_id = v_rec.organization_id;

            IF v_assignee_active IS DISTINCT FROM TRUE THEN
                -- Deactivate recurrence and notify creator once
                UPDATE public.task_recurrences
                SET is_active = FALSE, updated_at = pg_catalog.now()
                WHERE id = v_rec.id;

                INSERT INTO public.notifications (
                    organization_id, user_id, type, title, body, link, metadata
                ) VALUES (
                    v_rec.organization_id,
                    v_rec.created_by,
                    'task_recurrence_paused',
                    'Recurring Task Paused',
                    'Recurring task "' || v_rec.title || '" was paused because its assignee is no longer active.',
                    '/tasks',
                    jsonb_build_object('recurrence_id', v_rec.id)
                );

                v_deactivated_count := v_deactivated_count + 1;
                CONTINUE;
            END IF;
        END IF;

        -- Idempotency check: Don't create two tasks for the same recurrence on the same run date
        IF EXISTS (
            SELECT 1 FROM public.tasks
            WHERE recurrence_id = v_rec.id
              AND (created_at AT TIME ZONE 'Asia/Kolkata')::DATE = v_today
        ) THEN
            -- Task already generated today, advance next_run_date if not advanced
            CONTINUE;
        END IF;

        -- Calculate due date if type has working days rule
        v_due_date := NULL;
        IF v_rec.due_rule_working_days IS NOT NULL AND v_rec.due_rule_working_days > 0 THEN
            v_due_date := public.calculate_suggested_due_date(v_rec.due_rule_working_days, v_rec.organization_id, v_today);
        END IF;

        -- Create next task
        INSERT INTO public.tasks (
            organization_id, title, description, creator_id, assignee_id,
            status, priority, due_date, estimated_minutes,
            task_type_id, recurrence_id, auto_due_suggested
        ) VALUES (
            v_rec.organization_id, v_rec.title, v_rec.description, v_rec.created_by, v_rec.assignee_id,
            'todo', v_rec.priority, v_due_date, v_rec.estimate_minutes,
            v_rec.task_type_id, v_rec.id, (v_due_date IS NOT NULL)
        )
        RETURNING id INTO v_task_id;

        INSERT INTO public.task_events (
            organization_id, task_id, actor_id, event_type, to_status, new_assignee_id, metadata
        ) VALUES (
            v_rec.organization_id, v_task_id, v_rec.created_by, 'created', 'todo', v_rec.assignee_id,
            jsonb_build_object('recurring', true, 'recurrence_id', v_rec.id)
        );

        IF v_rec.assignee_id IS NOT NULL AND v_rec.assignee_id IS DISTINCT FROM v_rec.created_by THEN
            INSERT INTO public.notifications (
                organization_id, user_id, type, title, body, link, metadata
            ) VALUES (
                v_rec.organization_id,
                v_rec.assignee_id,
                'task_assigned',
                'New Task Assigned',
                'You have been assigned "' || v_rec.title || '"' || CASE WHEN v_due_date IS NOT NULL THEN ' (Due ' || v_due_date::text || ')' ELSE '' END || '.',
                '/tasks?task=' || v_task_id::text,
                jsonb_build_object('task_id', v_task_id, 'assigned_by', v_rec.created_by, 'due_date', v_due_date)
            );
        END IF;

        -- Calculate next_run_date
        v_next_date := v_today;
        IF v_rec.frequency = 'daily' THEN
            -- next working day
            v_next_date := public.calculate_suggested_due_date(1, v_rec.organization_id, v_today);
        ELSIF v_rec.frequency = 'weekly' THEN
            v_next_date := v_today + (COALESCE(v_rec.interval_n, 1) * 7);
        ELSIF v_rec.frequency = 'monthly' THEN
            v_month_start := (date_trunc('month', v_today) + (COALESCE(v_rec.interval_n, 1) || ' month')::interval)::date;
            v_days_in_month := EXTRACT(DAY FROM (date_trunc('month', v_month_start) + interval '1 month - 1 day'))::integer;
            v_day_of_month := LEAST(COALESCE(v_rec.day_of_month, EXTRACT(DAY FROM v_today)::integer), v_days_in_month);
            v_next_date := v_month_start + (v_day_of_month - 1);
        ELSIF v_rec.frequency = 'every_n_working_days' THEN
            v_next_date := public.calculate_suggested_due_date(COALESCE(v_rec.interval_n, 1), v_rec.organization_id, v_today);
        ELSE
            v_next_date := v_today + 1;
        END IF;

        -- Update recurrence record
        UPDATE public.task_recurrences
        SET last_created_task_id = v_task_id,
            next_run_date = v_next_date,
            is_active = CASE WHEN v_rec.end_date IS NOT NULL AND v_next_date > v_rec.end_date THEN FALSE ELSE TRUE END,
            updated_at = pg_catalog.now()
        WHERE id = v_rec.id;

        v_created_count := v_created_count + 1;
    END LOOP;

    RETURN jsonb_build_object(
        'created_tasks', v_created_count,
        'deactivated_recurrences', v_deactivated_count,
        'date', v_today
    );
END;
$$;

REVOKE ALL ON FUNCTION public.dispatch_recurring_tasks(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dispatch_recurring_tasks(DATE) TO authenticated, service_role;


-- ============================================================================
-- 7. SEED STARTER TASK TYPES FOR EVERY ORGANIZATION
-- ============================================================================
DO $$
DECLARE
    v_org RECORD;
    v_tech_dept_id UUID;
    v_hr_dept_id UUID;
BEGIN
    FOR v_org IN SELECT id FROM public.organizations LOOP
        -- Match departments
        SELECT id INTO v_tech_dept_id
        FROM public.departments
        WHERE organization_id = v_org.id
          AND (name ILIKE '%tech%' OR name ILIKE '%technology%')
        LIMIT 1;

        SELECT id INTO v_hr_dept_id
        FROM public.departments
        WHERE organization_id = v_org.id
          AND (name ILIKE '%human resources%' OR name ILIKE '%hr%')
        LIMIT 1;

        -- Technology Starter Types
        INSERT INTO public.task_types (
            organization_id, department_id, name, default_priority, default_estimate_minutes,
            due_rule_working_days, description_template, checklist, sort_order
        ) VALUES
        (
            v_org.id, v_tech_dept_id, 'Bug fix', 'high', 120, 2,
            E'What\'s broken:\n\nSteps to reproduce:\n1. \n2. \n\nExpected result:\n\nWhere (page or link):',
            '["Reproduce issue", "Write fix", "Test edge cases", "Review changes"]'::jsonb, 10
        ),
        (
            v_org.id, v_tech_dept_id, 'New feature', 'medium', 480, 5,
            E'Feature goal:\n\nUser story:\n\nAcceptance criteria:\n- \n\nTechnical design notes:',
            '["Design spec", "Frontend implementation", "Backend implementation", "QA verification"]'::jsonb, 20
        ),
        (
            v_org.id, v_tech_dept_id, 'Code review', 'high', 60, 1,
            E'PR / Branch link:\n\nSummary of changes:\n\nAreas to focus on:',
            '["Review diff", "Check tests", "Approve or comment"]'::jsonb, 30
        ),
        (
            v_org.id, v_tech_dept_id, 'Deployment', 'urgent', 120, 1,
            E'Target environment:\n\nRelease tag / commit:\n\nMigration steps:\n\nVerification checklist:',
            '["Pre-deploy checks", "Run migration", "Verify health", "Rollback plan"]'::jsonb, 40
        ),
        (
            v_org.id, v_tech_dept_id, 'Research', 'low', 240, 5,
            E'Research objective:\n\nOptions to evaluate:\n\nDeliverable format:',
            '["Problem statement", "Evaluate options", "Summary doc"]'::jsonb, 50
        ),
        (
            v_org.id, v_tech_dept_id, 'Documentation', 'low', 120, 3,
            E'Feature or workflow documented:\n\nTarget audience:\n\nKey sections:',
            '["Draft content", "Review screenshots", "Publish"]'::jsonb, 60
        )
        ON CONFLICT DO NOTHING;

        -- Human Resources Starter Types
        INSERT INTO public.task_types (
            organization_id, department_id, name, default_priority, default_estimate_minutes,
            due_rule_working_days, description_template, checklist, sort_order
        ) VALUES
        (
            v_org.id, v_hr_dept_id, 'Candidate screening', 'medium', 60, 2,
            E'Candidate name:\n\nRole applied for:\n\nResume / portfolio link:\n\nKey qualifications:',
            '["Review resume", "Conduct screening call", "Submit feedback"]'::jsonb, 110
        ),
        (
            v_org.id, v_hr_dept_id, 'Interview round', 'high', 60, 2,
            E'Candidate name:\n\nInterview round & focus:\n\nPanel members:\n\nMeeting link:',
            '["Prepare questions", "Conduct interview", "Fill scorecard"]'::jsonb, 120
        ),
        (
            v_org.id, v_hr_dept_id, 'Onboarding review', 'high', 60, 2,
            E'Employee name:\n\nDepartment:\n\nStart date:\n\nChecklist status:',
            '["Check document submission", "Verify identity info", "Provision access", "Send welcome kit"]'::jsonb, 130
        ),
        (
            v_org.id, v_hr_dept_id, 'Policy update', 'medium', 240, 5,
            E'Policy name:\n\nReason for update:\n\nAffected departments:\n\nEffective date:',
            '["Draft policy change", "Legal/compliance review", "Publish to portal"]'::jsonb, 140
        ),
        (
            v_org.id, v_hr_dept_id, 'Exit formalities', 'high', 120, 2,
            E'Employee name:\n\nLast working day:\n\nAsset handover status:\n\nExit interview notes:',
            '["Handover review", "Revoke credentials", "Final settlement check", "Exit interview"]'::jsonb, 150
        )
        ON CONFLICT DO NOTHING;

        -- General Starter Types (department_id IS NULL)
        INSERT INTO public.task_types (
            organization_id, department_id, name, default_priority, default_estimate_minutes,
            due_rule_working_days, description_template, checklist, sort_order
        ) VALUES
        (
            v_org.id, NULL, 'Meeting follow-up', 'medium', 30, 1,
            E'Meeting title & date:\n\nAttendees:\n\nKey decisions:\n\nAction items:',
            '["Review notes", "Send summary", "Track action items"]'::jsonb, 210
        ),
        (
            v_org.id, NULL, 'Report', 'medium', 120, 3,
            E'Report title / period:\n\nKey metrics to cover:\n\nDistribution list:',
            '["Collect data", "Draft report", "Review and share"]'::jsonb, 220
        ),
        (
            v_org.id, NULL, 'Admin work', 'low', 60, 2,
            E'Objective:\n\nDetails:\n\nDeadline / urgency:',
            '["Gather requirements", "Complete task", "Confirm completion"]'::jsonb, 230
        ),
        (
            v_org.id, NULL, 'Other', 'medium', NULL,
            NULL, NULL, '[]'::jsonb, 240
        )
        ON CONFLICT DO NOTHING;
    END LOOP;
END $$;
