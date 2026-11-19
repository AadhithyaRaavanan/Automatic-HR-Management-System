-- Migration: 20261120000002_job_titles_department_scoping.sql
-- Allow department-specific job titles and identical role names across different departments

DO $$
BEGIN
    -- 1. Drop the legacy global (organization_id, title_name) unique constraint if present
    ALTER TABLE public.job_titles DROP CONSTRAINT IF EXISTS uq_job_titles_org_title;

    -- 2. Drop the index if existed previously
    DROP INDEX IF EXISTS public.uq_job_titles_org_dept_title;
    DROP INDEX IF EXISTS public.idx_job_titles_org_dept_title;

    -- 3. Create unique index on (organization_id, department_id, title_name) 
    -- handling NULL department_id (company-wide) via COALESCE
    CREATE UNIQUE INDEX idx_job_titles_org_dept_title
    ON public.job_titles (organization_id, COALESCE(department_id, '00000000-0000-0000-0000-000000000000'::uuid), title_name);

    -- 4. Ensure index on department_id exists for fast lookups
    CREATE INDEX IF NOT EXISTS idx_job_titles_department ON public.job_titles (department_id);
END $$;
