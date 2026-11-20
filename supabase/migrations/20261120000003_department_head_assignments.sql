-- Migration: 20261120000003_department_head_assignments.sql
-- Department Head Assignment Management & Historical Audit Tracking

-- 1. Create department_head_assignments table if not exists
CREATE TABLE IF NOT EXISTS public.department_head_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    department_id UUID NOT NULL REFERENCES public.departments(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    job_title_id UUID REFERENCES public.job_titles(id) ON DELETE SET NULL,
    designation TEXT NOT NULL DEFAULT 'Department Head',
    effective_start_date DATE NOT NULL DEFAULT CURRENT_DATE,
    effective_end_date DATE DEFAULT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    assigned_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- 2. Partial Unique Index: Strictly enforce ONE active Department Head per department
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_active_department_head 
ON public.department_head_assignments (department_id) 
WHERE is_active = true;

-- 3. Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_dept_head_assign_org ON public.department_head_assignments (organization_id);
CREATE INDEX IF NOT EXISTS idx_dept_head_assign_dept ON public.department_head_assignments (department_id);
CREATE INDEX IF NOT EXISTS idx_dept_head_assign_emp ON public.department_head_assignments (employee_id);
CREATE INDEX IF NOT EXISTS idx_dept_head_assign_active ON public.department_head_assignments (is_active);

-- 4. Enable Row Level Security
ALTER TABLE public.department_head_assignments ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "dept_head_assign_view" ON public.department_head_assignments;
    CREATE POLICY "dept_head_assign_view"
    ON public.department_head_assignments
    FOR SELECT
    TO authenticated
    USING (true);

    DROP POLICY IF EXISTS "dept_head_assign_admin_hr" ON public.department_head_assignments;
    CREATE POLICY "dept_head_assign_admin_hr"
    ON public.department_head_assignments
    FOR ALL
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.organization_members om
            WHERE om.user_id = auth.uid()
              AND om.role IN ('admin', 'hr')
              AND om.status = 'active'
        )
    );
END $$;
