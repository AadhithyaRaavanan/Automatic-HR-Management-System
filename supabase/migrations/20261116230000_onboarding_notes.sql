-- Migration: 20261116230000_onboarding_notes.sql
-- Unified migration for decision notes, onboarding schema, profiles, and RLS

-- 1. Add review columns to leave_requests and regularization_requests if not already present
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leave_requests' AND column_name = 'review_note') THEN
        ALTER TABLE public.leave_requests ADD COLUMN review_note TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leave_requests' AND column_name = 'reviewed_by') THEN
        ALTER TABLE public.leave_requests ADD COLUMN reviewed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'leave_requests' AND column_name = 'reviewed_at') THEN
        ALTER TABLE public.leave_requests ADD COLUMN reviewed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'regularization_requests' AND column_name = 'review_note') THEN
        ALTER TABLE public.regularization_requests ADD COLUMN review_note TEXT;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'regularization_requests' AND column_name = 'reviewed_by') THEN
        ALTER TABLE public.regularization_requests ADD COLUMN reviewed_by UUID REFERENCES public.employees(id) ON DELETE SET NULL;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'regularization_requests' AND column_name = 'reviewed_at') THEN
        ALTER TABLE public.regularization_requests ADD COLUMN reviewed_at TIMESTAMPTZ;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'onboarding_completed') THEN
        ALTER TABLE public.employees ADD COLUMN onboarding_completed BOOLEAN DEFAULT false;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'employees' AND column_name = 'tutorial_completed') THEN
        ALTER TABLE public.employees ADD COLUMN tutorial_completed BOOLEAN DEFAULT false;
    END IF;
END $$;

-- 2. Profiles table for auth sync, onboarding and tutorial completion state
CREATE TABLE IF NOT EXISTS public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    onboarding_completed BOOLEAN DEFAULT false,
    tutorial_completed BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index and RLS on profiles
CREATE INDEX IF NOT EXISTS idx_profiles_user_id ON public.profiles(user_id);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "profiles_select_own_or_admin" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_update_own_or_admin" ON public.profiles;
    DROP POLICY IF EXISTS "profiles_insert_own" ON public.profiles;
END $$;

CREATE POLICY "profiles_select_own_or_admin" ON public.profiles
    FOR SELECT TO authenticated
    USING (
        auth.uid() = id OR
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.id = auth.uid() AND (e.user_role IN ('admin', 'hr') OR e.role IN ('admin', 'hr'))
        )
    );

CREATE POLICY "profiles_insert_own" ON public.profiles
    FOR INSERT TO authenticated
    WITH CHECK (auth.uid() = id OR auth.uid() = user_id);

CREATE POLICY "profiles_update_own_or_admin" ON public.profiles
    FOR UPDATE TO authenticated
    USING (
        auth.uid() = id OR
        auth.uid() = user_id OR
        EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.id = auth.uid() AND (e.user_role IN ('admin', 'hr') OR e.role IN ('admin', 'hr'))
        )
    );

-- 3. Candidate Type Enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'candidate_type_enum') THEN
        CREATE TYPE candidate_type_enum AS ENUM ('STUDENT_INTERN', 'GRADUATE_FRESHER', 'EXPERIENCED');
    END IF;
END $$;

-- 4. Onboarding Profiles Table
CREATE TABLE IF NOT EXISTS public.onboarding_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    candidate_type candidate_type_enum NOT NULL,
    -- Personal details
    full_name TEXT,
    phone TEXT,
    personal_email TEXT,
    dob DATE,
    gender TEXT,
    blood_group TEXT,
    current_address TEXT,
    permanent_address TEXT,
    pan_number TEXT,
    aadhaar_number TEXT,
    -- Bank details
    bank_account_holder TEXT,
    bank_account_number TEXT,
    bank_ifsc TEXT,
    bank_name TEXT,
    uan_number TEXT,
    -- Education metadata
    education_details JSONB DEFAULT '{}'::jsonb,
    -- Previous employer details (for EXPERIENCED)
    previous_company_name TEXT,
    previous_designation TEXT,
    previous_start_date DATE,
    previous_end_date DATE,
    previous_hr_email TEXT,
    previous_hr_phone TEXT,
    previous_employee_id TEXT,
    -- Status & storage folder
    status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'submitted', 'approved', 'rejected')),
    submitted_at TIMESTAMPTZ,
    storage_folder TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_onboarding_user_id UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_user ON public.onboarding_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_profiles_status ON public.onboarding_profiles(status);

ALTER TABLE public.onboarding_profiles ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "onboarding_profiles_user_rw" ON public.onboarding_profiles;
    DROP POLICY IF EXISTS "onboarding_profiles_admin_hr_all" ON public.onboarding_profiles;
END $$;

CREATE POLICY "onboarding_profiles_user_rw" ON public.onboarding_profiles
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "onboarding_profiles_admin_hr_all" ON public.onboarding_profiles
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.id = auth.uid() AND (e.user_role IN ('admin', 'hr') OR e.role IN ('admin', 'hr'))
        )
    );

-- 5. Onboarding Documents Table
CREATE TABLE IF NOT EXISTS public.onboarding_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    doc_type TEXT NOT NULL,
    file_name TEXT NOT NULL,
    storage_path TEXT NOT NULL,
    file_size BIGINT DEFAULT 0,
    mime_type TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_onboarding_documents_user ON public.onboarding_documents(user_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_documents_type ON public.onboarding_documents(doc_type);

ALTER TABLE public.onboarding_documents ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
    DROP POLICY IF EXISTS "onboarding_documents_user_rw" ON public.onboarding_documents;
    DROP POLICY IF EXISTS "onboarding_documents_admin_hr_all" ON public.onboarding_documents;
END $$;

CREATE POLICY "onboarding_documents_user_rw" ON public.onboarding_documents
    FOR ALL TO authenticated
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "onboarding_documents_admin_hr_all" ON public.onboarding_documents
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.employees e
            WHERE e.id = auth.uid() AND (e.user_role IN ('admin', 'hr') OR e.role IN ('admin', 'hr'))
        )
    );

-- 6. Storage Bucket setup for onboarding-docs (Private)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'onboarding-docs',
    'onboarding-docs',
    false,
    5242880, -- 5MB limit
    ARRAY['image/jpeg', 'image/png', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE SET
    public = false,
    file_size_limit = 5242880,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'application/pdf'];

DO $$
BEGIN
    DROP POLICY IF EXISTS "onboarding_docs_user_upload" ON storage.objects;
    DROP POLICY IF EXISTS "onboarding_docs_user_view" ON storage.objects;
    DROP POLICY IF EXISTS "onboarding_docs_admin_view" ON storage.objects;
END $$;

CREATE POLICY "onboarding_docs_user_upload" ON storage.objects
    FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'onboarding-docs');

CREATE POLICY "onboarding_docs_user_view" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'onboarding-docs' AND (
            (storage.foldername(name))[1] LIKE '%' || auth.uid()::text || '%' OR
            EXISTS (
                SELECT 1 FROM public.employees e
                WHERE e.id = auth.uid() AND (e.user_role IN ('admin', 'hr') OR e.role IN ('admin', 'hr'))
            )
        )
    );
