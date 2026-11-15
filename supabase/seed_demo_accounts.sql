-- ============================================================================
-- Supabase Cloud Seed Script: RemoteHR Demo Accounts
-- Password for all accounts: DemoPassword123!
-- Paste and run this script in the Supabase Studio > SQL Editor of your project
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Ensure Default Organization (Acme Corp)
INSERT INTO public.organizations (id, name, slug, work_mode, timezone, require_mfa_for_privileged)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'Acme Corp',
    'acme-corp',
    'hybrid',
    'UTC',
    false
) ON CONFLICT (id) DO UPDATE SET require_mfa_for_privileged = false;

-- 2. Auth Users & Passwords
DO $$
DECLARE
    pwd_hash TEXT := crypt('DemoPassword123!', gen_salt('bf'));
BEGIN
    -- Super Admin: Sarah Connor
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000001',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'admin@remotehr.io', pwd_hash, NOW(),
        '{"provider":"email","providers":["email"],"user_role":"admin"}'::jsonb,
        '{"full_name":"Sarah Connor"}'::jsonb,
        NOW(), NOW()
    ) ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, raw_app_meta_data = EXCLUDED.raw_app_meta_data;

    -- HR Ops: Marcus Vance
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'hr@remotehr.io', pwd_hash, NOW(),
        '{"provider":"email","providers":["email"],"user_role":"hr"}'::jsonb,
        '{"full_name":"Marcus Vance"}'::jsonb,
        NOW(), NOW()
    ) ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, raw_app_meta_data = EXCLUDED.raw_app_meta_data;

    -- Engineering Manager: Alex Morgan
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000003',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'manager@remotehr.io', pwd_hash, NOW(),
        '{"provider":"email","providers":["email"],"user_role":"manager"}'::jsonb,
        '{"full_name":"Alex Morgan"}'::jsonb,
        NOW(), NOW()
    ) ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, raw_app_meta_data = EXCLUDED.raw_app_meta_data;

    -- Employee: James Sullivan
    INSERT INTO auth.users (
        id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
        raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) VALUES (
        '00000000-0000-0000-0000-000000000004',
        '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated',
        'employee@remotehr.io', pwd_hash, NOW(),
        '{"provider":"email","providers":["email"],"user_role":"employee"}'::jsonb,
        '{"full_name":"James Sullivan"}'::jsonb,
        NOW(), NOW()
    ) ON CONFLICT (id) DO UPDATE SET encrypted_password = EXCLUDED.encrypted_password, raw_app_meta_data = EXCLUDED.raw_app_meta_data;

    UPDATE auth.users
    SET confirmation_token = COALESCE(confirmation_token, ''),
        recovery_token = COALESCE(recovery_token, ''),
        email_change_token_new = COALESCE(email_change_token_new, ''),
        email_change_token_current = COALESCE(email_change_token_current, ''),
        email_change = COALESCE(email_change, ''),
        reauthentication_token = COALESCE(reauthentication_token, '');
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'Skipping direct auth.users creation if insufficient permissions: %', SQLERRM;
END $$;

-- 3. Identities (for GoTrue v2 email provider match)
INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
VALUES 
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '{"sub":"00000000-0000-0000-0000-000000000001","email":"admin@remotehr.io"}'::jsonb, 'email', 'admin@remotehr.io', NOW(), NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000002', '{"sub":"00000000-0000-0000-0000-000000000002","email":"hr@remotehr.io"}'::jsonb, 'email', 'hr@remotehr.io', NOW(), NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000003', '{"sub":"00000000-0000-0000-0000-000000000003","email":"manager@remotehr.io"}'::jsonb, 'email', 'manager@remotehr.io', NOW(), NOW(), NOW()),
    ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000004', '{"sub":"00000000-0000-0000-0000-000000000004","email":"employee@remotehr.io"}'::jsonb, 'email', 'employee@remotehr.io', NOW(), NOW(), NOW())
ON CONFLICT (id, provider) DO NOTHING;

-- 4. Organization Memberships
INSERT INTO public.organization_members (user_id, organization_id, role, status, shift_start_time, shift_end_time)
VALUES 
    ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', 'admin', 'active', '09:00:00', '17:00:00'),
    ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'hr', 'active', '09:00:00', '17:00:00'),
    ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', 'manager', 'active', '09:00:00', '17:00:00'),
    ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000001', 'employee', 'active', '09:00:00', '17:00:00')
ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active';

-- 5. Employees Directory
INSERT INTO public.employees (id, full_name, email, timezone, work_target_minutes, status, joined_on)
VALUES 
    ('00000000-0000-0000-0000-000000000001', 'Sarah Connor', 'admin@remotehr.io', 'America/New_York', 480, 'active', '2024-01-01'),
    ('00000000-0000-0000-0000-000000000002', 'Marcus Vance', 'hr@remotehr.io', 'America/Chicago', 480, 'active', '2024-01-01'),
    ('00000000-0000-0000-0000-000000000003', 'Alex Morgan', 'manager@remotehr.io', 'America/Los_Angeles', 480, 'active', '2024-01-01'),
    ('00000000-0000-0000-0000-000000000004', 'James Sullivan', 'employee@remotehr.io', 'America/New_York', 480, 'active', '2024-01-01')
ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, status = 'active';
