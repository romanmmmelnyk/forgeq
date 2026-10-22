import { createClient, claimNextJob, type Sql } from '@forgeq/postgres'
import type { WorkerOptions, JobHandler } from './types'
import { randomUUID } from 'crypto'

const LEASE_DURATION_MS = 30_000
const HEARTBEAT_INTERVAL_MS = 10_000
const RECOVERY_INTERVAL_MS = 30_000

function getRetryDelay(attempt: number): number {
  const base = 1_000
  const max = 60_000
  const exp = Math.min(max, base * 2 ** (attempt - 1))
  const jitter = Math.random() * exp * 0.2
  return exp + jitter
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export class ForgeWorker<T extends Record<string, unknown> = Record<string, unknown>> {
  private sql: Sql
  private queueName: string
  private handler: JobHandler<T>
  private concurrency: number
  private pollInterval: number
  private workerId: string
  private running = false
  private activeCount = 0

  constructor(queueName: string, handler: JobHandler<T>, options: WorkerOptions) {
    this.sql = createClient(options.connection.url)
    this.queueName = queueName
    this.handler = handler
    this.concurrency = options.concurrency ?? 1
    this.pollInterval = options.pollInterval ?? 1000
    this.workerId = `worker-${randomUUID()}`
  }

  start() {
    this.running = true
    this.pollLoop()
    this.recoveryLoop()
  }

  async stop() {
    this.running = false
    while (this.activeCount > 0) {
      await sleep(100)
    }
    await this.sql.end()
  }

  private pollLoop() {
    ;(async () => {
      while (this.running) {
        if (this.activeCount < this.concurrency) {
          const job = await claimNextJob(this.sql, this.queueName, this.workerId)

          if (job) {
            this.activeCount++
            this.execute(job).finally(() => this.activeCount--)
          } else {
            await sleep(this.pollInterval)
          }
        } else {
          await sleep(100)
        }
      }
    })()
  }

  private recoveryLoop() {
    ;(async () => {
      while (this.running) {
        await sleep(RECOVERY_INTERVAL_MS)
        if (!this.running) break
        await this.recoverStalledJobs()
      }
    })()
  }

  public async recoverStalledJobs() {
    await this.sql`
      UPDATE "Job"
      SET
        status        = CASE
                          WHEN attempts >= max_attempts THEN 'DEAD'::job_status
                          ELSE 'QUEUED'::job_status
                        END,
        locked_by     = NULL,
        locked_until  = NULL,
        failed_reason = 'Worker lease expired',
        updated_at    = NOW()
      WHERE status      = 'ACTIVE'
        AND locked_until < NOW()
    `
  }

  private async execute(job: Awaited<ReturnType<typeof claimNextJob>> & object) {
    const heartbeat = setInterval(async () => {
      await this.sql`
        UPDATE "Job"
        SET
          locked_until = NOW() + ${`${LEASE_DURATION_MS / 1000} seconds`}::interval,
          updated_at   = NOW()
        WHERE id = ${job.id} AND status = 'ACTIVE'
      `
    }, HEARTBEAT_INTERVAL_MS)

    try {
      await this.handler({
        id: job.id,
        type: job.type,
        data: job.payload as T,
        attempts: job.attempts,
      })

      clearInterval(heartbeat)

      await this.sql`
        UPDATE "Job"
        SET status = 'COMPLETED', completed_at = NOW(), updated_at = NOW()
        WHERE id = ${job.id}
      `
    } catch (err) {
      clearInterval(heartbeat)

      const reason = err instanceof Error ? err.message : String(err)

      if (job.attempts >= job.max_attempts) {
        await this.sql`
          UPDATE "Job"
          SET
            status        = 'DEAD',
            failed_reason = ${reason},
            updated_at    = NOW()
          WHERE id = ${job.id}
        `
      } else {
        const delay = getRetryDelay(job.attempts)
        const runAt = new Date(Date.now() + delay)

        await this.sql`
          UPDATE "Job"
          SET
            status        = 'QUEUED',
            failed_reason = ${reason},
            locked_by     = NULL,
            locked_until  = NULL,
            run_at        = ${runAt},
            updated_at    = NOW()
          WHERE id = ${job.id}
        `
      }
    }
  }
}
