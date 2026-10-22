import { createClient, type Sql } from '@forgeq/postgres'
import type { ConnectionOptions, AddOptions } from './types'

export class ForgeQueue {
  private sql: Sql
  private queueName: string

  constructor(options: { connection: ConnectionOptions; name: string }) {
    this.sql = createClient(options.connection.url)
    this.queueName = options.name
  }

  async add<T extends Record<string, unknown> = Record<string, unknown>>(
    type: string,
    payload: T,
    options: AddOptions = {},
  ) {
    const runAt = options.delay
      ? new Date(Date.now() + options.delay)
      : new Date()

    const [job] = await this.sql`
      INSERT INTO "Job" (
        queue_name,
        type,
        payload,
        max_attempts,
        priority,
        run_at,
        idempotency_key
      ) VALUES (
        ${this.queueName},
        ${type},
        ${payload as any},
        ${options.attempts ?? 3},
        ${options.priority ?? 0},
        ${runAt},
        ${options.idempotencyKey ?? null}
      )
      ON CONFLICT (queue_name, idempotency_key)
        WHERE idempotency_key IS NOT NULL
        DO NOTHING
      RETURNING *
    `

    return job ?? null
  }

  async getJob(id: string) {
    const [job] = await this.sql`
      SELECT * FROM "Job" WHERE id = ${id}
    `
    return job ?? null
  }

  async cancel(id: string) {
    const [job] = await this.sql`
      UPDATE "Job"
      SET status = 'CANCELLED', updated_at = NOW()
      WHERE id = ${id} AND status = 'QUEUED'
      RETURNING *
    `
    return job ?? null
  }

  async close() {
    await this.sql.end()
  }
}
