-- ============================================================================
-- Migration 13: Section 2 - Retention, Archival & Admin System Health
-- ============================================================================
-- Covers:
-- 1. `public.retention_policies` (per-organization retention settings with enforced
--    floors: >= 18 months attendance_sessions once attendance_days are locked,
--    >= 24 months audit_logs, >= 90 days read notifications) + default backfill & trigger.
-- 2. `public.retention_archives` manifest table + optional `archive_id` pointer on
--    `public.attendance_sessions` (no JSON blobs stored in Postgres) + private
--    `'retention-archives'` Storage bucket & admin-scoped storage RLS.
-- 3. `public.run_retention_cleanup(dry_run boolean default true)` (batched 500 rows,
--    idempotent, verifies locked attendance_days AND storage archive existence BEFORE
--    deleting attendance_sessions, deletes audit_logs & read notifications in 500-row
--    batches, logs RETENTION_CLEANUP_EXECUTED, scheduled weekly via pg_cron).
-- 4. Server-only (`service_role`) archival batch & manifest RPCs:
--    `get_retention_export_batches`, `record_retention_archive`, `run_org_retention_cleanup`.
-- 5. Admin-only AAL2 RPCs: `admin_update_retention_policy`, `get_org_system_health`
--    (strictly tenant-scoped row counts & approximate org storage — never platform DB size),
--    and `get_org_retention_preview`.
-- ============================================================================

-- ============================================================================
-- 1. TABLES & STORAGE BUCKET
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.retention_policies (
    organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
    sessions_archive_after_months INTEGER NOT NULL DEFAULT 18
        CHECK (sessions_archive_after_months >= 18 AND sessions_archive_after_months <= 120),
    audit_logs_delete_after_months INTEGER NOT NULL DEFAULT 24
        CHECK (audit_logs_delete_after_months >= 24 AND audit_logs_delete_after_months <= 120),
    read_notifications_delete_after_days INTEGER NOT NULL DEFAULT 90
        CHECK (read_notifications_delete_after_days >= 90 AND read_notifications_delete_after_days <= 3650),
    updated_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

-- Backfill every existing organization
INSERT INTO public.retention_policies (organization_id)
SELECT id FROM public.organizations
ON CONFLICT (organization_id) DO NOTHING;

-- Auto-initialize retention_policies whenever a new organization is created
CREATE OR REPLACE FUNCTION public.trg_init_org_retention_policy()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    INSERT INTO public.retention_policies (organization_id)
    VALUES (NEW.id)
    ON CONFLICT (organization_id) DO NOTHING;
    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trg_init_org_retention_policy() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS init_org_retention_policy_after_insert ON public.organizations;
CREATE TRIGGER init_org_retention_policy_after_insert
    AFTER INSERT ON public.organizations
    FOR EACH ROW EXECUTE FUNCTION public.trg_init_org_retention_policy();

-- Compact archive manifest table (zero blobs in Postgres; points to Storage .json.gz)
CREATE TABLE IF NOT EXISTS public.retention_archives (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
    archive_month TEXT NOT NULL CHECK (archive_month ~ '^\d{4}-\d{2}$'),
    period_start DATE NOT NULL,
    period_end DATE NOT NULL CHECK (period_end >= period_start),
    storage_bucket TEXT NOT NULL DEFAULT 'retention-archives' CHECK (storage_bucket = 'retention-archives'),
    storage_path TEXT NOT NULL,
    row_count INTEGER NOT NULL CHECK (row_count > 0),
    byte_size BIGINT NOT NULL CHECK (byte_size > 0),
    checksum_sha256 TEXT NOT NULL CHECK (char_length(checksum_sha256) = 64),
    cutoff_at TIMESTAMPTZ NOT NULL,
    created_by UUID REFERENCES public.employees(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT uq_retention_archives_org_path UNIQUE (organization_id, storage_path)
);

CREATE INDEX IF NOT EXISTS idx_retention_archives_org_month
    ON public.retention_archives (organization_id, archive_month DESC, created_at DESC);

ALTER TABLE public.attendance_sessions
    ADD COLUMN IF NOT EXISTS archive_id UUID REFERENCES public.retention_archives(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_retention
    ON public.attendance_sessions (organization_id, work_date, id)
    WHERE archive_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_attendance_sessions_archived_ready
    ON public.attendance_sessions (organization_id, archive_id, work_date, id)
    WHERE archive_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_audit_logs_retention
    ON public.audit_logs (organization_id, created_at, id);

CREATE INDEX IF NOT EXISTS idx_notifications_read_retention
    ON public.notifications (organization_id, read_at, id)
    WHERE read_at IS NOT NULL;

-- Strict table grants (RPC-only writes; SELECT only for authenticated under RLS)
REVOKE ALL ON TABLE public.retention_policies FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.retention_policies TO authenticated;

REVOKE ALL ON TABLE public.retention_archives FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.retention_archives TO authenticated;

ALTER TABLE public.retention_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.retention_archives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "enforce_active_org_membership_retention_policies" ON public.retention_policies;
DROP POLICY IF EXISTS "enforce_mfa_aal2_retention_policies" ON public.retention_policies;
DROP POLICY IF EXISTS "retention_policies_select_policy" ON public.retention_policies;

CREATE POLICY "enforce_active_org_membership_retention_policies" ON public.retention_policies
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_retention_policies" ON public.retention_policies
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "retention_policies_select_policy" ON public.retention_policies
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (SELECT public.current_user_role()) = 'admin'
    );

DROP POLICY IF EXISTS "enforce_active_org_membership_retention_archives" ON public.retention_archives;
DROP POLICY IF EXISTS "enforce_mfa_aal2_retention_archives" ON public.retention_archives;
DROP POLICY IF EXISTS "retention_archives_select_policy" ON public.retention_archives;

CREATE POLICY "enforce_active_org_membership_retention_archives" ON public.retention_archives
    AS RESTRICTIVE FOR ALL TO authenticated
    USING ((SELECT public.is_active_org_member()));

CREATE POLICY "enforce_mfa_aal2_retention_archives" ON public.retention_archives
    AS RESTRICTIVE FOR ALL TO authenticated
    USING (
        CASE
            WHEN ((SELECT public.current_user_role()) IN ('hr', 'admin'))
            THEN (COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2')
            ELSE TRUE
        END
    );

CREATE POLICY "retention_archives_select_policy" ON public.retention_archives
    FOR SELECT TO authenticated
    USING (
        organization_id = (SELECT public.current_org_id())
        AND (SELECT public.current_user_role()) = 'admin'
    );

-- Private Storage bucket for compressed monthly JSON session archives
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
    'retention-archives',
    'retention-archives',
    FALSE,
    52428800,
    ARRAY['application/gzip', 'application/x-gzip', 'application/json']
)
ON CONFLICT (id) DO UPDATE SET
    public = FALSE,
    file_size_limit = 52428800,
    allowed_mime_types = ARRAY['application/gzip', 'application/x-gzip', 'application/json'];

DROP POLICY IF EXISTS "retention_archives_bucket_select_policy" ON storage.objects;

-- Only active AAL2 administrators of the matching organization can read their own archive objects
CREATE POLICY "retention_archives_bucket_select_policy" ON storage.objects
    FOR SELECT TO authenticated
    USING (
        bucket_id = 'retention-archives'
        AND (storage.foldername(name))[1] = (SELECT public.current_org_id())::text
        AND (SELECT public.is_active_org_member())
        AND (SELECT public.current_user_role()) = 'admin'
        AND COALESCE(((SELECT auth.jwt())->>'aal'), 'aal1') = 'aal2'
    );

-- ============================================================================
-- 2. ADMIN RPCs (POLICY UPDATE, SYSTEM HEALTH, DRY-RUN PREVIEW)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.admin_update_retention_policy(
    p_sessions_months INTEGER,
    p_audit_logs_months INTEGER,
    p_notifications_days INTEGER
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
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can update retention settings.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required for retention policy administration.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    IF p_sessions_months IS NULL OR p_sessions_months < 18 OR p_sessions_months > 120 THEN
        RAISE EXCEPTION 'Invalid retention floor: attendance_sessions retention must be between 18 and 120 months.' USING ERRCODE = '22023';
    END IF;

    IF p_audit_logs_months IS NULL OR p_audit_logs_months < 24 OR p_audit_logs_months > 120 THEN
        RAISE EXCEPTION 'Invalid retention floor: audit_logs retention must be between 24 and 120 months.' USING ERRCODE = '22023';
    END IF;

    IF p_notifications_days IS NULL OR p_notifications_days < 90 OR p_notifications_days > 3650 THEN
        RAISE EXCEPTION 'Invalid retention floor: read notifications retention must be between 90 and 3650 days.' USING ERRCODE = '22023';
    END IF;

    INSERT INTO public.retention_policies (organization_id)
    VALUES (v_org_id)
    ON CONFLICT (organization_id) DO NOTHING;

    SELECT * INTO v_old_row
    FROM public.retention_policies
    WHERE organization_id = v_org_id
    FOR UPDATE;

    UPDATE public.retention_policies
    SET sessions_archive_after_months = p_sessions_months,
        audit_logs_delete_after_months = p_audit_logs_months,
        read_notifications_delete_after_days = p_notifications_days,
        updated_by = v_caller_id,
        updated_at = pg_catalog.now()
    WHERE organization_id = v_org_id
    RETURNING * INTO v_new_row;

    INSERT INTO public.audit_logs (
        organization_id, actor_id, action, table_name, record_id, old_data, new_data
    ) VALUES (
        v_org_id,
        v_caller_id,
        'RETENTION_POLICY_UPDATED',
        'retention_policies',
        v_org_id,
        to_jsonb(v_old_row),
        to_jsonb(v_new_row)
    );

    RETURN jsonb_build_object('success', true, 'policy', to_jsonb(v_new_row));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_retention_policy(INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_retention_policy(INTEGER, INTEGER, INTEGER) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_org_system_health()
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
    v_emp_cnt BIGINT := 0; v_emp_bytes BIGINT := 0;
    v_mem_cnt BIGINT := 0; v_mem_bytes BIGINT := 0;
    v_dept_cnt BIGINT := 0; v_dept_bytes BIGINT := 0;
    v_loc_cnt BIGINT := 0; v_loc_bytes BIGINT := 0;
    v_shift_cnt BIGINT := 0; v_shift_bytes BIGINT := 0;
    v_sess_cnt BIGINT := 0; v_sess_bytes BIGINT := 0;
    v_day_cnt BIGINT := 0; v_day_bytes BIGINT := 0;
    v_reg_cnt BIGINT := 0; v_reg_bytes BIGINT := 0;
    v_lt_cnt BIGINT := 0; v_lt_bytes BIGINT := 0;
    v_lb_cnt BIGINT := 0; v_lb_bytes BIGINT := 0;
    v_lr_cnt BIGINT := 0; v_lr_bytes BIGINT := 0;
    v_hol_cnt BIGINT := 0; v_hol_bytes BIGINT := 0;
    v_notif_cnt BIGINT := 0; v_notif_bytes BIGINT := 0;
    v_audit_cnt BIGINT := 0; v_audit_bytes BIGINT := 0;
    v_arch_cnt BIGINT := 0; v_arch_meta_bytes BIGINT := 0;
    v_arch_storage_bytes BIGINT := 0;
    v_total_rows BIGINT := 0;
    v_estimated_db_bytes BIGINT := 0;
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can view system health metrics.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to view system health.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();

    -- Strictly measure THIS tenant's row tuples + ~64B per-row header/index overhead;
    -- NEVER inspect pg_database_size or cluster/platform totals.
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_emp_cnt, v_emp_bytes FROM public.employees t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_mem_cnt, v_mem_bytes FROM public.organization_members t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_dept_cnt, v_dept_bytes FROM public.departments t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_loc_cnt, v_loc_bytes FROM public.locations t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_shift_cnt, v_shift_bytes FROM public.shift_templates t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_sess_cnt, v_sess_bytes FROM public.attendance_sessions t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_day_cnt, v_day_bytes FROM public.attendance_days t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_reg_cnt, v_reg_bytes FROM public.regularization_requests t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_lt_cnt, v_lt_bytes FROM public.leave_types t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_lb_cnt, v_lb_bytes FROM public.leave_balances t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_lr_cnt, v_lr_bytes FROM public.leave_requests t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_hol_cnt, v_hol_bytes FROM public.holidays t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_notif_cnt, v_notif_bytes FROM public.notifications t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0)
      INTO v_audit_cnt, v_audit_bytes FROM public.audit_logs t WHERE t.organization_id = v_org_id;
    SELECT COUNT(*), COALESCE(SUM(pg_catalog.pg_column_size(t) + 64), 0), COALESCE(SUM(t.byte_size), 0)
      INTO v_arch_cnt, v_arch_meta_bytes, v_arch_storage_bytes FROM public.retention_archives t WHERE t.organization_id = v_org_id;

    v_total_rows :=
        v_emp_cnt + v_mem_cnt + v_dept_cnt + v_loc_cnt + v_shift_cnt +
        v_sess_cnt + v_day_cnt + v_reg_cnt + v_lt_cnt + v_lb_cnt +
        v_lr_cnt + v_hol_cnt + v_notif_cnt + v_audit_cnt + v_arch_cnt;

    v_estimated_db_bytes :=
        v_emp_bytes + v_mem_bytes + v_dept_bytes + v_loc_bytes + v_shift_bytes +
        v_sess_bytes + v_day_bytes + v_reg_bytes + v_lt_bytes + v_lb_bytes +
        v_lr_bytes + v_hol_bytes + v_notif_bytes + v_audit_bytes + v_arch_meta_bytes;

    RETURN jsonb_build_object(
        'organization_id', v_org_id,
        'scope', 'organization_only',
        'total_rows', v_total_rows,
        'estimated_db_bytes', v_estimated_db_bytes,
        'archive_storage_bytes', v_arch_storage_bytes,
        'tables', jsonb_build_array(
            jsonb_build_object('table_name', 'attendance_sessions', 'row_count', v_sess_cnt, 'estimated_bytes', v_sess_bytes),
            jsonb_build_object('table_name', 'attendance_days', 'row_count', v_day_cnt, 'estimated_bytes', v_day_bytes),
            jsonb_build_object('table_name', 'audit_logs', 'row_count', v_audit_cnt, 'estimated_bytes', v_audit_bytes),
            jsonb_build_object('table_name', 'notifications', 'row_count', v_notif_cnt, 'estimated_bytes', v_notif_bytes),
            jsonb_build_object('table_name', 'employees', 'row_count', v_emp_cnt, 'estimated_bytes', v_emp_bytes),
            jsonb_build_object('table_name', 'organization_members', 'row_count', v_mem_cnt, 'estimated_bytes', v_mem_bytes),
            jsonb_build_object('table_name', 'leave_requests', 'row_count', v_lr_cnt, 'estimated_bytes', v_lr_bytes),
            jsonb_build_object('table_name', 'leave_balances', 'row_count', v_lb_cnt, 'estimated_bytes', v_lb_bytes),
            jsonb_build_object('table_name', 'regularization_requests', 'row_count', v_reg_cnt, 'estimated_bytes', v_reg_bytes),
            jsonb_build_object('table_name', 'holidays', 'row_count', v_hol_cnt, 'estimated_bytes', v_hol_bytes),
            jsonb_build_object('table_name', 'departments', 'row_count', v_dept_cnt, 'estimated_bytes', v_dept_bytes),
            jsonb_build_object('table_name', 'locations', 'row_count', v_loc_cnt, 'estimated_bytes', v_loc_bytes),
            jsonb_build_object('table_name', 'shift_templates', 'row_count', v_shift_cnt, 'estimated_bytes', v_shift_bytes),
            jsonb_build_object('table_name', 'leave_types', 'row_count', v_lt_cnt, 'estimated_bytes', v_lt_bytes),
            jsonb_build_object('table_name', 'retention_archives', 'row_count', v_arch_cnt, 'estimated_bytes', v_arch_meta_bytes)
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_system_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_system_health() TO authenticated;

-- ============================================================================
-- 3. SERVICE-ROLE EXPORT BATCH & ARCHIVE RECORDING + DRY-RUN PREVIEW
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_retention_export_batches(
    p_organization_id UUID DEFAULT NULL,
    p_batch_limit INTEGER DEFAULT 500
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_limit INTEGER;
    v_org RECORD;
    v_sess_months INTEGER;
    v_cutoff_ts TIMESTAMPTZ;
    v_cutoff_date DATE;
    v_batches JSONB := '[]'::jsonb;
    v_month_rec RECORD;
    v_batch_json JSONB;
BEGIN
    v_limit := LEAST(GREATEST(COALESCE(p_batch_limit, 500), 1), 500);

    FOR v_org IN
        SELECT o.id,
               GREATEST(COALESCE(rp.sessions_archive_after_months, 18), 18) AS sessions_months
        FROM public.organizations o
        LEFT JOIN public.retention_policies rp ON rp.organization_id = o.id
        WHERE (p_organization_id IS NULL OR o.id = p_organization_id)
        ORDER BY o.created_at ASC
    LOOP
        v_sess_months := v_org.sessions_months;
        v_cutoff_ts := pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months);
        v_cutoff_date := v_cutoff_ts::date;

        FOR v_month_rec IN
            WITH eligible AS (
                SELECT s.id,
                       s.employee_id,
                       e.email AS employee_email,
                       e.full_name AS employee_name,
                       s.work_date,
                       pg_catalog.to_char(s.work_date, 'YYYY-MM') AS archive_month,
                       s.check_in_at,
                       s.check_out_at,
                       s.source,
                       s.note,
                       s.location_id,
                       s.created_at,
                       d.status AS day_status,
                       d.total_minutes AS day_total_minutes,
                       d.locked AS day_locked
                FROM public.attendance_sessions s
                JOIN public.attendance_days d
                  ON d.organization_id = s.organization_id
                 AND d.employee_id = s.employee_id
                 AND d.work_date = s.work_date
                LEFT JOIN public.employees e
                  ON e.id = s.employee_id
                WHERE s.organization_id = v_org.id
                  AND d.locked = TRUE
                  AND s.work_date < v_cutoff_date
                  AND s.check_in_at < v_cutoff_ts
                  AND (
                      s.archive_id IS NULL
                      OR NOT EXISTS (
                          SELECT 1
                          FROM public.retention_archives ra
                          JOIN storage.objects so
                            ON so.bucket_id = ra.storage_bucket
                           AND so.name = ra.storage_path
                          WHERE ra.id = s.archive_id
                            AND ra.organization_id = v_org.id
                      )
                  )
                ORDER BY s.work_date ASC, s.id ASC
                LIMIT v_limit
            )
            SELECT archive_month,
                   MIN(work_date) AS period_start,
                   MAX(work_date) AS period_end,
                   pg_catalog.jsonb_agg(id ORDER BY work_date ASC, id ASC) AS session_ids,
                   pg_catalog.jsonb_agg(
                       jsonb_build_object(
                           'id', id,
                           'employee_id', employee_id,
                           'employee_email', employee_email,
                           'employee_name', employee_name,
                           'work_date', work_date,
                           'check_in_at', check_in_at,
                           'check_out_at', check_out_at,
                           'source', source,
                           'note', note,
                           'location_id', location_id,
                           'day_status', day_status,
                           'day_total_minutes', day_total_minutes,
                           'day_locked', day_locked,
                           'created_at', created_at
                       )
                       ORDER BY work_date ASC, id ASC
                   ) AS sessions,
                   COUNT(*)::integer AS row_count
            FROM eligible
            GROUP BY archive_month
            ORDER BY archive_month ASC
        LOOP
            v_batch_json := jsonb_build_object(
                'organization_id', v_org.id,
                'archive_month', v_month_rec.archive_month,
                'period_start', v_month_rec.period_start,
                'period_end', v_month_rec.period_end,
                'cutoff_at', v_cutoff_ts,
                'row_count', v_month_rec.row_count,
                'session_ids', v_month_rec.session_ids,
                'sessions', v_month_rec.sessions
            );
            v_batches := v_batches || jsonb_build_array(v_batch_json);
        END LOOP;
    END LOOP;

    RETURN v_batches;
END;
$$;

REVOKE ALL ON FUNCTION public.get_retention_export_batches(UUID, INTEGER) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_retention_export_batches(UUID, INTEGER) TO service_role;

CREATE OR REPLACE FUNCTION public.record_retention_archive(
    p_organization_id UUID,
    p_archive_month TEXT,
    p_period_start DATE,
    p_period_end DATE,
    p_cutoff_at TIMESTAMPTZ,
    p_storage_path TEXT,
    p_byte_size BIGINT,
    p_checksum_sha256 TEXT,
    p_session_ids UUID[],
    p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_archive_id UUID;
    v_matched_count INTEGER := 0;
    v_sess_months INTEGER;
    v_cutoff_ts TIMESTAMPTZ;
    v_cutoff_date DATE;
    v_linked_count INTEGER := 0;
    v_row RECORD;
BEGIN
    IF p_organization_id IS NULL OR p_archive_month IS NULL OR p_storage_path IS NULL THEN
        RAISE EXCEPTION 'Organization, archive month, and storage path are required.' USING ERRCODE = '22023';
    END IF;

    IF pg_catalog.btrim(p_archive_month) !~ '^\d{4}-\d{2}$' THEN
        RAISE EXCEPTION 'archive_month must match YYYY-MM.' USING ERRCODE = '22023';
    END IF;

    IF p_session_ids IS NULL OR pg_catalog.cardinality(p_session_ids) = 0 THEN
        RAISE EXCEPTION 'At least one eligible session ID is required to record an archive.' USING ERRCODE = '22023';
    END IF;

    IF p_byte_size IS NULL OR p_byte_size <= 0 THEN
        RAISE EXCEPTION 'Positive archive byte_size is required.' USING ERRCODE = '22023';
    END IF;

    IF p_checksum_sha256 IS NULL OR char_length(p_checksum_sha256) <> 64 THEN
        RAISE EXCEPTION '64-character SHA-256 hex checksum is required.' USING ERRCODE = '22023';
    END IF;

    -- Export-Before-Deletion proof: archive MUST already exist inside the private Storage bucket under org prefix!
    IF NOT EXISTS (
        SELECT 1
        FROM storage.objects so
        WHERE so.bucket_id = 'retention-archives'
          AND so.name = p_storage_path
          AND (storage.foldername(so.name))[1] = p_organization_id::text
    ) THEN
        RAISE EXCEPTION 'Storage invariant violation: object "%" must exist in bucket retention-archives before recording manifest.', p_storage_path
            USING ERRCODE = '22023';
    END IF;

    SELECT GREATEST(COALESCE(rp.sessions_archive_after_months, 18), 18)
      INTO v_sess_months
    FROM public.retention_policies rp
    WHERE rp.organization_id = p_organization_id;

    v_sess_months := COALESCE(v_sess_months, 18);
    v_cutoff_ts := COALESCE(p_cutoff_at, pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months));
    -- Guarantee cutoff never violates org floor even if older timestamp passed
    IF v_cutoff_ts > (pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months)) THEN
        v_cutoff_ts := pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months);
    END IF;
    v_cutoff_date := v_cutoff_ts::date;

    SELECT COUNT(*)::integer INTO v_matched_count
    FROM public.attendance_sessions s
    JOIN public.attendance_days d
      ON d.organization_id = s.organization_id
     AND d.employee_id = s.employee_id
     AND d.work_date = s.work_date
    WHERE s.id = ANY(p_session_ids)
      AND s.organization_id = p_organization_id
      AND d.locked = TRUE
      AND pg_catalog.to_char(s.work_date, 'YYYY-MM') = p_archive_month
      AND s.work_date < v_cutoff_date
      AND s.check_in_at < v_cutoff_ts;

    IF v_matched_count = 0 THEN
        RAISE EXCEPTION 'No eligible locked old attendance_sessions matched provided IDs for archive month %.', p_archive_month
            USING ERRCODE = '22023';
    END IF;

    -- Idempotent on duplicate storage_path
    SELECT id INTO v_archive_id
    FROM public.retention_archives
    WHERE organization_id = p_organization_id
      AND storage_path = p_storage_path;

    IF v_archive_id IS NULL THEN
        INSERT INTO public.retention_archives (
            organization_id, archive_month, period_start, period_end,
            storage_bucket, storage_path, row_count, byte_size, checksum_sha256,
            cutoff_at, created_by
        ) VALUES (
            p_organization_id, p_archive_month, p_period_start, p_period_end,
            'retention-archives', p_storage_path, v_matched_count, p_byte_size, p_checksum_sha256,
            v_cutoff_ts, p_created_by
        )
        RETURNING * INTO v_row;

        v_archive_id := v_row.id;

        INSERT INTO public.audit_logs (
            organization_id, actor_id, action, table_name, record_id, old_data, new_data
        ) VALUES (
            p_organization_id,
            p_created_by,
            'RETENTION_ARCHIVE_CREATED',
            'retention_archives',
            v_archive_id,
            NULL,
            to_jsonb(v_row)
        );
    END IF;

    UPDATE public.attendance_sessions s
    SET archive_id = v_archive_id
    FROM public.attendance_days d
    WHERE s.id = ANY(p_session_ids)
      AND s.organization_id = p_organization_id
      AND d.organization_id = s.organization_id
      AND d.employee_id = s.employee_id
      AND d.work_date = s.work_date
      AND d.locked = TRUE
      AND pg_catalog.to_char(s.work_date, 'YYYY-MM') = p_archive_month
      AND s.work_date < v_cutoff_date
      AND s.check_in_at < v_cutoff_ts;

    GET DIAGNOSTICS v_linked_count = ROW_COUNT;

    RETURN jsonb_build_object(
        'success', true,
        'archive_id', v_archive_id,
        'linked_sessions', v_linked_count,
        'storage_path', p_storage_path
    );
END;
$$;

REVOKE ALL ON FUNCTION public.record_retention_archive(UUID, TEXT, DATE, DATE, TIMESTAMPTZ, TEXT, BIGINT, TEXT, UUID[], UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_retention_archive(UUID, TEXT, DATE, DATE, TIMESTAMPTZ, TEXT, BIGINT, TEXT, UUID[], UUID) TO service_role;

-- Per-organization retention cleanup engine (batched 500 rows, idempotent)
CREATE OR REPLACE FUNCTION public.run_org_retention_cleanup(
    p_organization_id UUID,
    dry_run BOOLEAN DEFAULT TRUE,
    p_actor_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_batch_size CONSTANT INTEGER := 500;
    v_max_batches CONSTANT INTEGER := 200;
    v_sess_months INTEGER := 18;
    v_audit_months INTEGER := 24;
    v_notif_days INTEGER := 90;
    v_sess_cutoff_ts TIMESTAMPTZ;
    v_sess_cutoff_date DATE;
    v_audit_cutoff TIMESTAMPTZ;
    v_notif_cutoff TIMESTAMPTZ;

    v_sessions_locked_eligible INTEGER := 0;
    v_sessions_archived_ready INTEGER := 0;
    v_sessions_unarchived_skipped INTEGER := 0;
    v_sessions_unlocked_skipped INTEGER := 0;
    v_audit_logs_eligible INTEGER := 0;
    v_notifications_eligible INTEGER := 0;
    v_notifications_unread_skipped INTEGER := 0;

    v_sessions_deleted INTEGER := 0;
    v_audits_deleted INTEGER := 0;
    v_notifs_deleted INTEGER := 0;
    v_sessions_batches INTEGER := 0;
    v_audits_batches INTEGER := 0;
    v_notifs_batches INTEGER := 0;
    v_step_deleted INTEGER := 0;
    v_batch_ids UUID[];
BEGIN
    IF p_organization_id IS NULL THEN
        RAISE EXCEPTION 'organization_id is required.' USING ERRCODE = '22023';
    END IF;

    SELECT
        GREATEST(COALESCE(rp.sessions_archive_after_months, 18), 18),
        GREATEST(COALESCE(rp.audit_logs_delete_after_months, 24), 24),
        GREATEST(COALESCE(rp.read_notifications_delete_after_days, 90), 90)
    INTO v_sess_months, v_audit_months, v_notif_days
    FROM public.organizations o
    LEFT JOIN public.retention_policies rp ON rp.organization_id = o.id
    WHERE o.id = p_organization_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Organization not found.' USING ERRCODE = '02000';
    END IF;

    v_sess_cutoff_ts := pg_catalog.now() - pg_catalog.make_interval(months => v_sess_months);
    v_sess_cutoff_date := v_sess_cutoff_ts::date;
    v_audit_cutoff := pg_catalog.now() - pg_catalog.make_interval(months => v_audit_months);
    v_notif_cutoff := pg_catalog.now() - pg_catalog.make_interval(days => v_notif_days);

    -- Count attendance_sessions categories strictly scoped to p_organization_id
    SELECT
        COUNT(*) FILTER (WHERE COALESCE(d.locked, FALSE) = TRUE),
        COUNT(*) FILTER (
            WHERE COALESCE(d.locked, FALSE) = TRUE
              AND s.archive_id IS NOT NULL
              AND EXISTS (
                  SELECT 1
                  FROM public.retention_archives ra
                  JOIN storage.objects so
                    ON so.bucket_id = ra.storage_bucket
                   AND so.name = ra.storage_path
                  WHERE ra.id = s.archive_id
                    AND ra.organization_id = p_organization_id
              )
        ),
        COUNT(*) FILTER (WHERE COALESCE(d.locked, FALSE) = FALSE)
    INTO v_sessions_locked_eligible, v_sessions_archived_ready, v_sessions_unlocked_skipped
    FROM public.attendance_sessions s
    LEFT JOIN public.attendance_days d
      ON d.organization_id = s.organization_id
     AND d.employee_id = s.employee_id
     AND d.work_date = s.work_date
    WHERE s.organization_id = p_organization_id
      AND s.work_date < v_sess_cutoff_date
      AND s.check_in_at < v_sess_cutoff_ts;

    v_sessions_unarchived_skipped := GREATEST(0, v_sessions_locked_eligible - v_sessions_archived_ready);

    -- Count eligible audit_logs
    SELECT COUNT(*)::integer INTO v_audit_logs_eligible
    FROM public.audit_logs
    WHERE organization_id = p_organization_id
      AND created_at < v_audit_cutoff;

    -- Count eligible read notifications (and unread skipped)
    SELECT
        COUNT(*) FILTER (WHERE read_at IS NOT NULL AND read_at < v_notif_cutoff)::integer,
        COUNT(*) FILTER (WHERE read_at IS NULL AND created_at < v_notif_cutoff)::integer
    INTO v_notifications_eligible, v_notifications_unread_skipped
    FROM public.notifications
    WHERE organization_id = p_organization_id;

    IF NOT COALESCE(dry_run, TRUE) THEN
        -- Batch 1: Archived & verified attendance_sessions whose days are locked (500/batch)
        LOOP
            EXIT WHEN v_sessions_batches >= v_max_batches;

            SELECT COALESCE(pg_catalog.array_agg(batch.id), '{}'::uuid[])
            INTO v_batch_ids
            FROM (
                SELECT s.id
                FROM public.attendance_sessions s
                JOIN public.attendance_days d
                  ON d.organization_id = s.organization_id
                 AND d.employee_id = s.employee_id
                 AND d.work_date = s.work_date
                JOIN public.retention_archives ra
                  ON ra.id = s.archive_id
                 AND ra.organization_id = s.organization_id
                JOIN storage.objects so
                  ON so.bucket_id = ra.storage_bucket
                 AND so.name = ra.storage_path
                WHERE s.organization_id = p_organization_id
                  AND d.locked = TRUE
                  AND s.work_date < v_sess_cutoff_date
                  AND s.check_in_at < v_sess_cutoff_ts
                ORDER BY s.work_date ASC, s.id ASC
                LIMIT v_batch_size
            ) batch;

            EXIT WHEN pg_catalog.cardinality(v_batch_ids) = 0;

            DELETE FROM public.attendance_sessions
            WHERE organization_id = p_organization_id
              AND id = ANY(v_batch_ids);

            GET DIAGNOSTICS v_step_deleted = ROW_COUNT;
            v_sessions_deleted := v_sessions_deleted + v_step_deleted;
            v_sessions_batches := v_sessions_batches + 1;

            EXIT WHEN v_step_deleted < v_batch_size;
        END LOOP;

        -- Batch 2: Expired audit_logs (500/batch)
        LOOP
            EXIT WHEN v_audits_batches >= v_max_batches;

            SELECT COALESCE(pg_catalog.array_agg(batch.id), '{}'::uuid[])
            INTO v_batch_ids
            FROM (
                SELECT id
                FROM public.audit_logs
                WHERE organization_id = p_organization_id
                  AND created_at < v_audit_cutoff
                ORDER BY created_at ASC, id ASC
                LIMIT v_batch_size
            ) batch;

            EXIT WHEN pg_catalog.cardinality(v_batch_ids) = 0;

            DELETE FROM public.audit_logs
            WHERE organization_id = p_organization_id
              AND id = ANY(v_batch_ids);

            GET DIAGNOSTICS v_step_deleted = ROW_COUNT;
            v_audits_deleted := v_audits_deleted + v_step_deleted;
            v_audits_batches := v_audits_batches + 1;

            EXIT WHEN v_step_deleted < v_batch_size;
        END LOOP;

        -- Batch 3: Expired read notifications (500/batch)
        LOOP
            EXIT WHEN v_notifs_batches >= v_max_batches;

            SELECT COALESCE(pg_catalog.array_agg(batch.id), '{}'::uuid[])
            INTO v_batch_ids
            FROM (
                SELECT id
                FROM public.notifications
                WHERE organization_id = p_organization_id
                  AND read_at IS NOT NULL
                  AND read_at < v_notif_cutoff
                ORDER BY read_at ASC, id ASC
                LIMIT v_batch_size
            ) batch;

            EXIT WHEN pg_catalog.cardinality(v_batch_ids) = 0;

            DELETE FROM public.notifications
            WHERE organization_id = p_organization_id
              AND id = ANY(v_batch_ids);

            GET DIAGNOSTICS v_step_deleted = ROW_COUNT;
            v_notifs_deleted := v_notifs_deleted + v_step_deleted;
            v_notifs_batches := v_notifs_batches + 1;

            EXIT WHEN v_step_deleted < v_batch_size;
        END LOOP;

        IF (v_sessions_deleted + v_audits_deleted + v_notifs_deleted) > 0 OR p_actor_id IS NOT NULL THEN
            INSERT INTO public.audit_logs (
                organization_id, actor_id, action, table_name, record_id, old_data, new_data
            ) VALUES (
                p_organization_id,
                p_actor_id,
                'RETENTION_CLEANUP_EXECUTED',
                'retention_policies',
                p_organization_id,
                jsonb_build_object(
                    'eligible_sessions_archived', v_sessions_archived_ready,
                    'eligible_audit_logs', v_audit_logs_eligible,
                    'eligible_notifications', v_notifications_eligible
                ),
                jsonb_build_object(
                    'dry_run', false,
                    'batch_size', v_batch_size,
                    'deleted', jsonb_build_object(
                        'attendance_sessions', v_sessions_deleted,
                        'audit_logs', v_audits_deleted,
                        'notifications', v_notifs_deleted
                    ),
                    'batches', jsonb_build_object(
                        'attendance_sessions', v_sessions_batches,
                        'audit_logs', v_audits_batches,
                        'notifications', v_notifs_batches
                    ),
                    'skipped_unarchived_sessions', v_sessions_unarchived_skipped,
                    'skipped_unlocked_sessions', v_sessions_unlocked_skipped
                )
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'organization_id', p_organization_id,
        'dry_run', COALESCE(dry_run, TRUE),
        'batch_size', v_batch_size,
        'policy', jsonb_build_object(
            'sessions_archive_after_months', v_sess_months,
            'audit_logs_delete_after_months', v_audit_months,
            'read_notifications_delete_after_days', v_notif_days,
            'sessions_cutoff_at', v_sess_cutoff_ts,
            'audit_logs_cutoff_at', v_audit_cutoff,
            'notifications_cutoff_at', v_notif_cutoff
        ),
        'eligible', jsonb_build_object(
            'attendance_sessions_locked', v_sessions_locked_eligible,
            'attendance_sessions_archived_ready', v_sessions_archived_ready,
            'attendance_sessions_needs_archive', v_sessions_unarchived_skipped,
            'attendance_sessions_unlocked_skipped', v_sessions_unlocked_skipped,
            'audit_logs', v_audit_logs_eligible,
            'notifications_read', v_notifications_eligible,
            'notifications_unread_skipped', v_notifications_unread_skipped
        ),
        'deleted', jsonb_build_object(
            'attendance_sessions', v_sessions_deleted,
            'audit_logs', v_audits_deleted,
            'notifications', v_notifs_deleted
        ),
        'batches', jsonb_build_object(
            'attendance_sessions', v_sessions_batches,
            'audit_logs', v_audits_batches,
            'notifications', v_notifs_batches
        )
    );
END;
$$;

REVOKE ALL ON FUNCTION public.run_org_retention_cleanup(UUID, BOOLEAN, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_org_retention_cleanup(UUID, BOOLEAN, UUID) TO service_role;

-- System-wide retention cleanup entrypoint (scheduled weekly via pg_cron)
CREATE OR REPLACE FUNCTION public.run_retention_cleanup(
    dry_run BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_org RECORD;
    v_org_result JSONB;
    v_org_results JSONB := '[]'::jsonb;
    v_total_elig_sessions INTEGER := 0;
    v_total_elig_audits INTEGER := 0;
    v_total_elig_notifs INTEGER := 0;
    v_total_del_sessions INTEGER := 0;
    v_total_del_audits INTEGER := 0;
    v_total_del_notifs INTEGER := 0;
    v_total_batches INTEGER := 0;
BEGIN
    FOR v_org IN
        SELECT id FROM public.organizations ORDER BY created_at ASC
    LOOP
        v_org_result := public.run_org_retention_cleanup(v_org.id, COALESCE(dry_run, TRUE), NULL);
        v_org_results := v_org_results || jsonb_build_array(v_org_result);

        v_total_elig_sessions := v_total_elig_sessions + COALESCE((v_org_result->'eligible'->>'attendance_sessions_locked')::integer, 0);
        v_total_elig_audits := v_total_elig_audits + COALESCE((v_org_result->'eligible'->>'audit_logs')::integer, 0);
        v_total_elig_notifs := v_total_elig_notifs + COALESCE((v_org_result->'eligible'->>'notifications_read')::integer, 0);

        v_total_del_sessions := v_total_del_sessions + COALESCE((v_org_result->'deleted'->>'attendance_sessions')::integer, 0);
        v_total_del_audits := v_total_del_audits + COALESCE((v_org_result->'deleted'->>'audit_logs')::integer, 0);
        v_total_del_notifs := v_total_del_notifs + COALESCE((v_org_result->'deleted'->>'notifications')::integer, 0);

        v_total_batches := v_total_batches
            + COALESCE((v_org_result->'batches'->>'attendance_sessions')::integer, 0)
            + COALESCE((v_org_result->'batches'->>'audit_logs')::integer, 0)
            + COALESCE((v_org_result->'batches'->>'notifications')::integer, 0);
    END LOOP;

    RETURN jsonb_build_object(
        'dry_run', COALESCE(dry_run, TRUE),
        'batch_size', 500,
        'organizations_processed', pg_catalog.jsonb_array_length(v_org_results),
        'totals', jsonb_build_object(
            'eligible_sessions_locked', v_total_elig_sessions,
            'eligible_audit_logs', v_total_elig_audits,
            'eligible_notifications_read', v_total_elig_notifs,
            'deleted_sessions', v_total_del_sessions,
            'deleted_audit_logs', v_total_del_audits,
            'deleted_notifications', v_total_del_notifs,
            'total_batches', v_total_batches
        ),
        'organizations', v_org_results
    );
END;
$$;

REVOKE ALL ON FUNCTION public.run_retention_cleanup(BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_retention_cleanup(BOOLEAN) TO service_role;

-- Authenticated Admin AAL2 wrapper strictly scoped to caller's own organization (dry-run preview only)
CREATE OR REPLACE FUNCTION public.get_org_retention_preview()
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
BEGIN
    v_caller_id := (SELECT auth.uid());
    IF v_caller_id IS NULL OR NOT public.is_active_org_member() THEN
        RAISE EXCEPTION 'Forbidden: Active organization membership required.' USING ERRCODE = '42501';
    END IF;

    v_caller_role := public.current_user_role();
    IF v_caller_role IS DISTINCT FROM 'admin' THEN
        RAISE EXCEPTION 'Forbidden: Only active administrators can preview retention cleanup.' USING ERRCODE = '42501';
    END IF;

    v_caller_aal := COALESCE((SELECT (auth.jwt())->>'aal'), 'aal1');
    IF v_caller_aal IS DISTINCT FROM 'aal2' THEN
        RAISE EXCEPTION 'MFA AAL2 verification required to preview retention cleanup.' USING ERRCODE = '42501';
    END IF;

    v_org_id := public.current_org_id();
    RETURN public.run_org_retention_cleanup(v_org_id, TRUE, NULL);
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_retention_preview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_org_retention_preview() TO authenticated;

-- ============================================================================
-- 4. WEEKLY PG_CRON SCHEDULE
-- ============================================================================

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'weekly-retention-cleanup') THEN
            PERFORM cron.unschedule('weekly-retention-cleanup');
        END IF;

        PERFORM cron.schedule(
            'weekly-retention-cleanup',
            '0 3 * * 0',
            'SELECT public.run_retention_cleanup(false);'
        );
    END IF;
END $$;

