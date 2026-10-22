CREATE TYPE job_status AS ENUM (
  'QUEUED',
  'ACTIVE',
  'COMPLETED',
  'DEAD',
  'CANCELLED'
);

CREATE TABLE "Job" (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_name       TEXT        NOT NULL,
  type             TEXT        NOT NULL,
  payload          JSONB       NOT NULL DEFAULT '{}',
  result           JSONB,

  status           job_status  NOT NULL DEFAULT 'QUEUED',
  priority         INTEGER     NOT NULL DEFAULT 0,
  attempts         INTEGER     NOT NULL DEFAULT 0,
  max_attempts     INTEGER     NOT NULL DEFAULT 3,

  run_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by        TEXT,
  locked_until     TIMESTAMPTZ,

  idempotency_key  TEXT,
  failed_reason    TEXT,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ
);

-- для claim query: шукаємо QUEUED задачі по черзі, сортуємо по пріоритету і часу
CREATE INDEX idx_job_claim
  ON "Job" (queue_name, status, run_at, priority DESC)
  WHERE status = 'QUEUED';

-- для recovery loop: шукаємо ACTIVE задачі з простроченим lease
CREATE INDEX idx_job_recovery
  ON "Job" (status, locked_until)
  WHERE status = 'ACTIVE';

-- для idempotency: унікальна пара черга + ключ
CREATE UNIQUE INDEX idx_job_idempotency
  ON "Job" (queue_name, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
