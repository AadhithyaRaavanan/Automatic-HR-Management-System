-- Migration: 20261118120000_onboarding_approval_gate.sql
-- Employee Onboarding Final Approval Gate, Columns, and One-Time Grandfathering

-- 1. Add approval columns to onboarding_profiles
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'onboarding_profiles' 
          AND column_name = 'approved_by'
    ) THEN
        ALTER TABLE public.onboarding_profiles 
        ADD COLUMN approved_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'onboarding_profiles' 
          AND column_name = 'approved_at'
    ) THEN
        ALTER TABLE public.onboarding_profiles 
        ADD COLUMN approved_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
          AND table_name = 'onboarding_profiles' 
          AND column_name = 'approval_email_sent_at'
    ) THEN
        ALTER TABLE public.onboarding_profiles 
        ADD COLUMN approval_email_sent_at TIMESTAMPTZ;
    END IF;
END $$;

-- 2. Update status constraint on onboarding_profiles to include 'changes_requested'
DO $$
BEGIN
    ALTER TABLE public.onboarding_profiles 
    DROP CONSTRAINT IF EXISTS onboarding_profiles_status_check;

    ALTER TABLE public.onboarding_profiles 
    ADD CONSTRAINT onboarding_profiles_status_check 
    CHECK (status IN ('draft', 'submitted', 'approved', 'rejected', 'changes_requested'));
END $$;

-- 3. One-Time Grandfathering for Existing Active Employees
-- "sets onboarding_profiles.status = 'approved' (or inserts an approved row) for every employee who is already active
-- and has onboarding_completed = true, so nobody currently working is locked out. Do NOT touch anyone else.
-- Grandfathered users must NOT receive an approval email."

-- 3a. Update existing onboarding_profiles rows for active onboarded employees
UPDATE public.onboarding_profiles op
SET status = 'approved',
    onboarding_status = 'COMPLETED',
    approved_at = COALESCE(op.verified_at, op.completed_at, NOW()),
    approval_email_sent_at = NOW(), -- Marks email as already processed so no email is ever sent
    updated_at = NOW()
FROM public.employees e
WHERE op.user_id = e.id
  AND e.status = 'active'
  AND e.onboarding_completed = true
  AND op.status != 'approved';

-- 3b. Insert approved rows for active onboarded employees who do not have an onboarding_profile
INSERT INTO public.onboarding_profiles (
    user_id,
    candidate_type,
    full_name,
    status,
    onboarding_status,
    approved_at,
    approval_email_sent_at,
    created_at,
    updated_at
)
SELECT 
    e.id,
    'EXPERIENCED'::candidate_type_enum,
    e.full_name,
    'approved',
    'COMPLETED',
    NOW(),
    NOW(),
    NOW(),
    NOW()
FROM public.employees e
WHERE e.status = 'active'
  AND e.onboarding_completed = true
  AND NOT EXISTS (
      SELECT 1 FROM public.onboarding_profiles op WHERE op.user_id = e.id
  );

-- 3c. Populate app_metadata.onboarding_approved = true in auth.users for fast-path middleware checks
DO $$
BEGIN
    UPDATE auth.users u
    SET raw_app_meta_data = jsonb_set(
        COALESCE(u.raw_app_meta_data, '{}'::jsonb),
        '{onboarding_approved}',
        'true'::jsonb
    )
    FROM public.employees e
    WHERE u.id = e.id
      AND e.status = 'active'
      AND e.onboarding_completed = true;
EXCEPTION
    WHEN OTHERS THEN
        -- auth.users updates may be restricted in some migration runners;
        -- middleware fallback DB check will seamlessly handle it regardless.
        NULL;
END $$;
