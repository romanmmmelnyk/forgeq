import type { Sql } from './client'

export interface Job {
  id: string
  queue_name: string
  type: string
  payload: Record<string, unknown>
  result: Record<string, unknown> | null
  status: 'QUEUED' | 'ACTIVE' | 'COMPLETED' | 'DEAD' | 'CANCELLED'
  priority: number
  attempts: number
  max_attempts: number
  run_at: Date
  locked_by: string | null
  locked_until: Date | null
  idempotency_key: string | null
  failed_reason: string | null
  created_at: Date
  updated_at: Date
  completed_at: Date | null
}

export async function claimNextJob(
  sql: Sql,
  queueName: string,
  workerId: string,
): Promise<Job | null> {
  const [job] = await sql<Job[]>`
    UPDATE "Job"
    SET
      status       = 'ACTIVE',
      attempts     = attempts + 1,
      locked_by    = ${workerId},
      locked_until = NOW() + INTERVAL '30 seconds',
      updated_at   = NOW()
    WHERE id = (
      SELECT id FROM "Job"
      WHERE  status     = 'QUEUED'
        AND  queue_name = ${queueName}
        AND  run_at    <= NOW()
      ORDER BY priority DESC, created_at ASC
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    RETURNING *
  `

  return job ?? null
}
