-- Idempotency keys storage for safe mutations (punches, leave, regularizations)
CREATE TABLE IF NOT EXISTS public.idempotency_keys (
  key text PRIMARY KEY,
  user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  response_body jsonb NOT NULL,
  response_status int NOT NULL DEFAULT 200,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_idempotency_user_created 
  ON public.idempotency_keys(user_id, created_at DESC);

ALTER TABLE public.idempotency_keys ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'idempotency_keys' AND policyname = 'Users can select own idempotency keys'
  ) THEN
    CREATE POLICY "Users can select own idempotency keys"
      ON public.idempotency_keys FOR SELECT
      USING (auth.uid() = user_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'idempotency_keys' AND policyname = 'Users can insert own idempotency keys'
  ) THEN
    CREATE POLICY "Users can insert own idempotency keys"
      ON public.idempotency_keys FOR INSERT
      WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;
