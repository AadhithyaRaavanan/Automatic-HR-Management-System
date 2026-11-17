-- Migration: 20261117000001_onboarding_system_v2.sql
-- Complete Employee Onboarding, Document Verification, and Notification System

-- 1. Create Onboarding Status Enum if not existing, or widen column constraint
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'onboarding_status_enum') THEN
        CREATE TYPE onboarding_status_enum AS ENUM (
            'NOT_STARTED',
            'IN_PROGRESS',
            'READY_TO_SUBMIT',
            'SUBMITTED',
            'UNDER_REVIEW',
            'CORRECTION_REQUIRED',
            'RESUBMITTED',
            'VERIFIED',
            'COMPLETED'
        );
    END IF;
END $$;

-- 2. Enhance onboarding_profiles table with comprehensive fields
DO $$
BEGIN
    -- Drop old status check if present
    ALTER TABLE public.onboarding_profiles DROP CONSTRAINT IF EXISTS onboarding_profiles_status_check;

    -- Add missing columns to onboarding_profiles
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'onboarding_status') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN onboarding_status TEXT NOT NULL DEFAULT 'NOT_STARTED';
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'highest_qualification') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN highest_qualification TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'has_experience') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN has_experience BOOLEAN DEFAULT false;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'emergency_contact_name') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN emergency_contact_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'emergency_contact_relationship') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN emergency_contact_relationship TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'emergency_contact_phone') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN emergency_contact_phone TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'bank_branch') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN bank_branch TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'experience_explanation') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN experience_explanation TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'verified_by') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN verified_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'verified_at') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN verified_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'completed_at') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN completed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'drive_folder_id') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN drive_folder_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_profiles' AND column_name = 'declaration_agreed') THEN
        ALTER TABLE public.onboarding_profiles ADD COLUMN declaration_agreed BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 3. Enhance onboarding_documents table for document-level verification
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'document_name') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN document_name TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'document_status') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN document_status TEXT NOT NULL DEFAULT 'pending' CHECK (document_status IN ('pending', 'approved', 'rejected'));
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'rejection_reason') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN rejection_reason TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'reviewed_by') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN reviewed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'reviewed_at') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN reviewed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'drive_file_id') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN drive_file_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'drive_folder_id') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN drive_folder_id TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'salary_month') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN salary_month TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'salary_year') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN salary_year TEXT;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'onboarding_documents' AND column_name = 'explanation') THEN
        ALTER TABLE public.onboarding_documents ADD COLUMN explanation TEXT;
    END IF;
END $$;

-- 4. Audit Log Table for Onboarding
CREATE TABLE IF NOT EXISTS public.employee_onboarding_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    employee_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    previous_status TEXT,
    new_status TEXT,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_audit_emp ON public.employee_onboarding_audit(employee_id);
ALTER TABLE public.employee_onboarding_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "onboarding_audit_select_own_or_admin" ON public.employee_onboarding_audit;
END $$;

CREATE POLICY "onboarding_audit_select_own_or_admin" ON public.employee_onboarding_audit
    FOR SELECT TO authenticated
    USING (
        auth.uid() = employee_id OR
        (SELECT public.current_user_role()) IN ('hr', 'admin') OR
        EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.role IN ('admin', 'hr')) OR
        EXISTS (SELECT 1 FROM public.organization_members om WHERE om.user_id = auth.uid() AND om.role IN ('admin', 'hr'))
    );

-- 5. Expand notifications check constraint to allow onboarding notifications
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
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
        'task_completed',
        'kpi_review',
        'onboarding_submission',
        'onboarding_status'
    )
);
