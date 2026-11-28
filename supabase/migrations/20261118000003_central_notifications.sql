-- ============================================================================
-- Migration: 20261118000003_central_notifications.sql
-- Description: Central Notification System (tables, RLS, indexes, publication)
-- ============================================================================

-- 1. Notifications Table
CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    link TEXT,
    entity_type TEXT,
    entity_id TEXT,
    actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    read_at TIMESTAMPTZ NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    dedupe_key TEXT NULL
);

ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS link TEXT,
    ADD COLUMN IF NOT EXISTS entity_type TEXT,
    ADD COLUMN IF NOT EXISTS entity_id TEXT,
    ADD COLUMN IF NOT EXISTS actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS dedupe_key TEXT NULL;

-- Partial Unique Index for deduplication per user
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_user_dedupe
    ON public.notifications (user_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL;

-- Query & Performance Indexes
CREATE INDEX IF NOT EXISTS idx_notifications_user_read_created
    ON public.notifications (user_id, read_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created
    ON public.notifications (user_id, created_at DESC);

-- 2. Notification Preferences Table
CREATE TABLE IF NOT EXISTS public.notification_preferences (
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    type_group TEXT NOT NULL,
    in_app BOOLEAN NOT NULL DEFAULT true,
    email BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (user_id, type_group)
);

-- 3. Row Level Security (RLS)
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

-- Notifications RLS
DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
CREATE POLICY "Users can select own notifications"
    ON public.notifications FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notifications read_at" ON public.notifications;
CREATE POLICY "Users can update own notifications read_at"
    ON public.notifications FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Preferences RLS
DROP POLICY IF EXISTS "Users can select own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can select own notification preferences"
    ON public.notification_preferences FOR SELECT
    USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own notification preferences" ON public.notification_preferences;
CREATE POLICY "Users can update own notification preferences"
    ON public.notification_preferences FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- 4. Enable Supabase Realtime for Notifications Table
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables 
        WHERE pubname = 'supabase_realtime' 
          AND schemaname = 'public' 
          AND tablename = 'notifications'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        NULL;
END $$;
