-- Migration: 20261107000008_multi_tenancy_and_workforce.sql
-- Description: Multi-Tenancy & Workforce Foundation
--              1. Organizations, organization_members, platform_admins, support_access_grants
--              2. Deterministic default org backfill on existing tables
--              3. Locations, shift templates, shift assignments (with exclusion constraint)
--              4. Workforce columns (work_mode, location_id, shift_id, work_location, overtime)
--              5. Tenant-scoped RLS policies & Custom Access Token Hook
--              6. Organization signup RPC

CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- ============================================================================
-- 1. Organizations & Member Tables
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.organizations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    domain TEXT,
    work_mode TEXT NOT NULL DEFAULT 'hybrid' CHECK (work_mode IN ('remote', 'office', 'hybrid')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'trial', 'cancelled')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Deterministic Default Organization for Backfill
INSERT INTO public.organizations (id, name, slug, work_mode, status)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Primary Enterprise',
    'primary',
    'hybrid',
    'active'
)
ON CONFLICT (id) DO NOTHING;

-- Canonical Organization Members Table (Single Source of Truth for Tenant Roles)
CREATE TABLE IF NOT EXISTS public.organization_members (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('employee', 'manager', 'hr', 'admin')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, organization_id)
);

-- Platform Admins (Vendor Operators - Zero Ambient Tenant Access)
CREATE TABLE IF NOT EXISTS public.platform_admins (
    user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Time-Limited Consented Support Access Grants
CREATE TABLE IF NOT EXISTS public.support_access_grants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    platform_admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    reason TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    granted_by UUID NOT NULL REFERENCES auth.users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================================
-- 2. Locations & Shift Infrastructure
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.locations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    address TEXT,
    city TEXT,
    country TEXT,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    working_hours INTEGER NOT NULL DEFAULT 480,
    weekly_off_days INTEGER[] NOT NULL DEFAULT '{0, 6}',
    allowed_ip_ranges TEXT[] DEFAULT '{}',
    geofence_latitude DOUBLE PRECISION,
    geofence_longitude DOUBLE PRECISION,
    geofence_radius_meters INTEGER NOT NULL DEFAULT 150,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.shift_templates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    code TEXT NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    grace_minutes INTEGER NOT NULL DEFAULT 15,
    half_day_minutes INTEGER NOT NULL DEFAULT 240,
    full_day_minutes INTEGER NOT NULL DEFAULT 480,
    break_duration_minutes INTEGER NOT NULL DEFAULT 60,
    crosses_midnight BOOLEAN NOT NULL DEFAULT FALSE,
    is_night_shift BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (organization_id, code)
);

CREATE TABLE IF NOT EXISTS public.employee_shift_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    shift_template_id UUID NOT NULL REFERENCES public.shift_templates(id) ON DELETE RESTRICT,
    day_of_week INTEGER CHECK (day_of_week BETWEEN 0 AND 6),
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT exclude_overlapping_shifts EXCLUDE USING gist (
        employee_id WITH =,
        daterange(effective_from, coalesce(effective_to, '9999-12-31'::date), '[]') WITH &&
    )
);

CREATE TABLE IF NOT EXISTS public.privacy_acknowledgments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
    policy_version TEXT NOT NULL,
    enabled_methods TEXT[] NOT NULL DEFAULT '{}',
    acknowledged_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ip_address TEXT,
    UNIQUE (organization_id, employee_id, policy_version)
);

-- ============================================================================
-- 3. Deterministic Backfill of Existing Tables
-- ============================================================================

-- A. employees
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS primary_location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS work_mode TEXT CHECK (work_mode IN ('remote', 'office', 'hybrid'));
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS expected_office_days INTEGER[] DEFAULT '{1, 3}';
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS required_office_days_per_week INTEGER DEFAULT 2;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS kiosk_pin_hash TEXT;

UPDATE public.employees 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.employees ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.employees DROP CONSTRAINT IF EXISTS fk_employees_organization;
ALTER TABLE public.employees ADD CONSTRAINT fk_employees_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- B. Migrate user_roles into organization_members
INSERT INTO public.organization_members (user_id, organization_id, role, created_at)
SELECT user_id, '00000000-0000-0000-0000-000000000001', role, created_at
FROM public.user_roles
ON CONFLICT (user_id, organization_id) DO NOTHING;

-- Create compatibility view for legacy queries
DROP VIEW IF EXISTS public.user_roles CASCADE;
CREATE OR REPLACE VIEW public.user_roles AS 
SELECT user_id, role, created_at FROM public.organization_members;

-- C. attendance_policies
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS work_mode TEXT NOT NULL DEFAULT 'hybrid' CHECK (work_mode IN ('remote', 'office', 'hybrid'));
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS shift_start_time TIME NOT NULL DEFAULT '09:30:00';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS weekly_off_days INTEGER[] NOT NULL DEFAULT '{0, 6}';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS allowed_methods TEXT[] NOT NULL DEFAULT '{"web"}';
ALTER TABLE public.attendance_policies ADD COLUMN IF NOT EXISTS leave_year_start_month INTEGER NOT NULL DEFAULT 1;

UPDATE public.attendance_policies 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_policies ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_policies DROP CONSTRAINT IF EXISTS fk_policies_organization;
ALTER TABLE public.attendance_policies ADD CONSTRAINT fk_policies_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- D. attendance_sessions
ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_sessions ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;

UPDATE public.attendance_sessions 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_sessions ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS fk_sessions_organization;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT fk_sessions_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- Update source constraint
ALTER TABLE public.attendance_sessions DROP CONSTRAINT IF EXISTS attendance_sessions_source_check;
ALTER TABLE public.attendance_sessions ADD CONSTRAINT attendance_sessions_source_check 
    CHECK (source IN ('web', 'office_ip', 'rotating_qr', 'geofence', 'kiosk', 'auto', 'manual'));

-- E. attendance_days
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS organization_id UUID;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.locations(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS shift_id UUID REFERENCES public.shift_templates(id) ON DELETE SET NULL;
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS work_location TEXT CHECK (work_location IN ('office', 'remote'));
ALTER TABLE public.attendance_days ADD COLUMN IF NOT EXISTS overtime_minutes INTEGER NOT NULL DEFAULT 0;

UPDATE public.attendance_days 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.attendance_days ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.attendance_days DROP CONSTRAINT IF EXISTS fk_days_organization;
ALTER TABLE public.attendance_days ADD CONSTRAINT fk_days_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- F. regularization_requests
ALTER TABLE public.regularization_requests ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.regularization_requests 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.regularization_requests ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.regularization_requests DROP CONSTRAINT IF EXISTS fk_requests_organization;
ALTER TABLE public.regularization_requests ADD CONSTRAINT fk_requests_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- G. notifications
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.notifications 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.notifications ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS fk_notifications_organization;
ALTER TABLE public.notifications ADD CONSTRAINT fk_notifications_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- H. holidays
ALTER TABLE public.holidays ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.holidays 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.holidays ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.holidays DROP CONSTRAINT IF EXISTS fk_holidays_organization;
ALTER TABLE public.holidays ADD CONSTRAINT fk_holidays_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- I. audit_logs
ALTER TABLE public.audit_logs ADD COLUMN IF NOT EXISTS organization_id UUID;

UPDATE public.audit_logs 
SET organization_id = '00000000-0000-0000-0000-000000000001' 
WHERE organization_id IS NULL;

ALTER TABLE public.audit_logs ALTER COLUMN organization_id SET NOT NULL;
ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS fk_audit_organization;
ALTER TABLE public.audit_logs ADD CONSTRAINT fk_audit_organization 
    FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;

-- ============================================================================
-- 4. Custom Access Token JWT Hook Update (Organization-Aware)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.custom_access_token_hook(event JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_claims JSONB;
    v_user_id UUID;
    v_org_id UUID;
    v_user_role TEXT;
    v_org_status TEXT;
    v_is_platform_admin BOOLEAN := FALSE;
BEGIN
    v_user_id := (event->>'user_id')::uuid;
    v_claims := event->'claims';

    -- Check if user is platform admin
    SELECT EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = v_user_id)
    INTO v_is_platform_admin;

    -- Fetch primary organization membership and status
    SELECT om.organization_id, om.role, o.status
    INTO v_org_id, v_user_role, v_org_status
    FROM public.organization_members om
    JOIN public.organizations o ON o.id = om.organization_id
    WHERE om.user_id = v_user_id
    ORDER BY om.created_at ASC
    LIMIT 1;

    -- Inject claims
    v_claims := jsonb_set(v_claims, '{user_role}', to_jsonb(coalesce(v_user_role, 'employee')));
    v_claims := jsonb_set(v_claims, '{is_platform_admin}', to_jsonb(v_is_platform_admin));

    IF v_org_id IS NOT NULL THEN
        v_claims := jsonb_set(v_claims, '{organization_id}', to_jsonb(v_org_id::text));
        v_claims := jsonb_set(v_claims, '{organization_status}', to_jsonb(v_org_status));
    END IF;

    event := jsonb_set(event, '{claims}', v_claims);
    RETURN event;
END;
$$;

-- ============================================================================
-- 5. Multi-Tenant Row Level Security Policies
-- ============================================================================

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_access_grants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shift_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_shift_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.privacy_acknowledgments ENABLE ROW LEVEL SECURITY;

-- Helper macro function for tenant boundary evaluation
CREATE OR REPLACE FUNCTION public.current_organization_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT coalesce(
        ((SELECT auth.jwt())->>'organization_id')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
    );
$$;

-- Organizations
DROP POLICY IF EXISTS "tenant_organizations_policy" ON public.organizations;
CREATE POLICY "tenant_organizations_policy" ON public.organizations
FOR ALL TO authenticated
USING (
    id = public.current_organization_id()
    OR (SELECT coalesce(((SELECT auth.jwt())->>'is_platform_admin')::boolean, FALSE)) = TRUE
);

-- Organization Members
DROP POLICY IF EXISTS "tenant_members_policy" ON public.organization_members;
CREATE POLICY "tenant_members_policy" ON public.organization_members
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
    OR (SELECT coalesce(((SELECT auth.jwt())->>'is_platform_admin')::boolean, FALSE)) = TRUE
);

-- Locations
DROP POLICY IF EXISTS "tenant_locations_policy" ON public.locations;
CREATE POLICY "tenant_locations_policy" ON public.locations
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- Shift Templates
DROP POLICY IF EXISTS "tenant_shifts_policy" ON public.shift_templates;
CREATE POLICY "tenant_shifts_policy" ON public.shift_templates
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- Employee Shift Assignments
DROP POLICY IF EXISTS "tenant_shift_assignments_policy" ON public.employee_shift_assignments;
CREATE POLICY "tenant_shift_assignments_policy" ON public.employee_shift_assignments
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- Re-apply tenant isolation to Employees
DROP POLICY IF EXISTS "tenant_employees_isolation" ON public.employees;
CREATE POLICY "tenant_employees_isolation" ON public.employees
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- Re-apply tenant isolation to Attendance Sessions
DROP POLICY IF EXISTS "tenant_sessions_isolation" ON public.attendance_sessions;
CREATE POLICY "tenant_sessions_isolation" ON public.attendance_sessions
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- Re-apply tenant isolation to Attendance Days
DROP POLICY IF EXISTS "tenant_days_isolation" ON public.attendance_days;
CREATE POLICY "tenant_days_isolation" ON public.attendance_days
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- Re-apply tenant isolation to Regularization Requests
DROP POLICY IF EXISTS "tenant_requests_isolation" ON public.regularization_requests;
CREATE POLICY "tenant_requests_isolation" ON public.regularization_requests
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- Re-apply tenant isolation to Notifications
DROP POLICY IF EXISTS "tenant_notifications_isolation" ON public.notifications;
CREATE POLICY "tenant_notifications_isolation" ON public.notifications
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
    AND user_id = (SELECT auth.uid())
);

-- Re-apply tenant isolation to Holidays
DROP POLICY IF EXISTS "tenant_holidays_isolation" ON public.holidays;
CREATE POLICY "tenant_holidays_isolation" ON public.holidays
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- Re-apply tenant isolation to Audit Logs
DROP POLICY IF EXISTS "tenant_audit_isolation" ON public.audit_logs;
CREATE POLICY "tenant_audit_isolation" ON public.audit_logs
FOR ALL TO authenticated
USING (
    organization_id = public.current_organization_id()
);

-- ============================================================================
-- 6. Composite Tenant Performance Indexes
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_emp_org_status ON public.employees(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_emp_org_loc ON public.employees(organization_id, primary_location_id);
CREATE INDEX IF NOT EXISTS idx_sessions_org_emp_date ON public.attendance_sessions(organization_id, employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_days_org_emp_date ON public.attendance_days(organization_id, employee_id, work_date);
CREATE INDEX IF NOT EXISTS idx_requests_org_status ON public.regularization_requests(organization_id, status);
CREATE INDEX IF NOT EXISTS idx_audit_org_created ON public.audit_logs(organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shifts_org_code ON public.shift_templates(organization_id, code);
CREATE INDEX IF NOT EXISTS idx_loc_org_code ON public.locations(organization_id, code);

-- ============================================================================
-- 7. Organization Signup Function
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_organization_signup(
    p_org_name TEXT,
    p_slug TEXT,
    p_admin_user_id UUID,
    p_admin_name TEXT,
    p_admin_email TEXT,
    p_work_mode TEXT DEFAULT 'hybrid'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org_id UUID;
    v_clean_slug TEXT;
    v_reserved_slugs TEXT[] := ARRAY['admin', 'api', 'platform', 'app', 'support', 'billing', 'demo', 'system', 'login', 'signup', 'help'];
BEGIN
    v_clean_slug := pg_catalog.lower(pg_catalog.trim(p_slug));

    IF v_clean_slug = ANY(v_reserved_slugs) THEN
        RAISE EXCEPTION 'Slug "%" is reserved by the platform. Please choose another workspace slug.', v_clean_slug;
    END IF;

    IF EXISTS (SELECT 1 FROM public.organizations WHERE slug = v_clean_slug) THEN
        RAISE EXCEPTION 'Workspace slug "%" is already taken. Please choose another.', v_clean_slug;
    END IF;

    -- Create Organization
    INSERT INTO public.organizations (name, slug, work_mode, status)
    VALUES (p_org_name, v_clean_slug, p_work_mode, 'active')
    RETURNING id INTO v_org_id;

    -- Create Default Organization Member (Admin)
    INSERT INTO public.organization_members (user_id, organization_id, role)
    VALUES (p_admin_user_id, v_org_id, 'admin');

    -- Create Employee Profile
    INSERT INTO public.employees (
        id,
        organization_id,
        full_name,
        email,
        work_mode,
        status,
        work_target_minutes,
        joined_on
    ) VALUES (
        p_admin_user_id,
        v_org_id,
        p_admin_name,
        p_admin_email,
        p_work_mode,
        'active',
        480,
        CURRENT_DATE
    );

    -- Create Default Attendance Policy for Organization
    INSERT INTO public.attendance_policies (
        organization_id,
        work_mode,
        grace_minutes,
        half_day_minutes,
        absent_minutes,
        auto_checkout_time,
        is_active
    ) VALUES (
        v_org_id,
        p_work_mode,
        15,
        240,
        120,
        '23:59:00',
        TRUE
    );

    -- Audit log
    INSERT INTO public.audit_logs (organization_id, actor_id, action, table_name, record_id, new_data)
    VALUES (
        v_org_id,
        p_admin_user_id,
        'CREATE_ORGANIZATION',
        'organizations',
        v_org_id,
        pg_catalog.jsonb_build_object('name', p_org_name, 'slug', v_clean_slug)
    );

    RETURN pg_catalog.jsonb_build_object(
        'success', TRUE,
        'organization_id', v_org_id,
        'slug', v_clean_slug
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_signup(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_organization_signup(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_organization_signup(TEXT, TEXT, UUID, TEXT, TEXT, TEXT) TO authenticated;
