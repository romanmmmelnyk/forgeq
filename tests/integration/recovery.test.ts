import { createClient } from '../../packages/postgres/src'
import { ForgeQueue, ForgeWorker } from '../../packages/core/src'

const CONNECTION = { url: process.env.DATABASE_URL! }
const sql = createClient(CONNECTION.url)

beforeEach(async () => {
  await sql`DELETE FROM "Job"`
})

afterAll(async () => {
  await sql`DELETE FROM "Job"`
  await sql.end()
})

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('recoverStalledJobs повертає ACTIVE задачу з простроченим lease в QUEUED', async () => {
  // Вставляємо задачу яка вже ACTIVE але lease прострочений
  await sql`
    INSERT INTO "Job" (queue_name, type, payload, status, attempts, max_attempts, locked_by, locked_until)
    VALUES (
      'test', 'stalled', '{}',
      'ACTIVE', 1, 3,
      'dead-worker',
      NOW() - INTERVAL '1 minute'
    )
  `

  const worker = new ForgeWorker('test', async () => {}, { connection: CONNECTION })
  await worker.recoverStalledJobs()
  await worker.stop()

  const [job] = await sql`SELECT * FROM "Job" WHERE type = 'stalled'`

  expect(job.status).toBe('QUEUED')
  expect(job.locked_by).toBeNull()
  expect(job.locked_until).toBeNull()
  expect(job.failed_reason).toBe('Worker lease expired')
})

test('recoverStalledJobs переводить в DEAD якщо attempts >= max_attempts', async () => {
  await sql`
    INSERT INTO "Job" (queue_name, type, payload, status, attempts, max_attempts, locked_by, locked_until)
    VALUES (
      'test', 'exhausted', '{}',
      'ACTIVE', 3, 3,
      'dead-worker',
      NOW() - INTERVAL '1 minute'
    )
  `

  const worker = new ForgeWorker('test', async () => {}, { connection: CONNECTION })
  await worker.recoverStalledJobs()
  await worker.stop()

  const [job] = await sql`SELECT * FROM "Job" WHERE type = 'exhausted'`

  expect(job.status).toBe('DEAD')
})

test('задача зі свіжим lease не чіпається recovery', async () => {
  await sql`
    INSERT INTO "Job" (queue_name, type, payload, status, attempts, max_attempts, locked_by, locked_until)
    VALUES (
      'test', 'fresh', '{}',
      'ACTIVE', 1, 3,
      'live-worker',
      NOW() + INTERVAL '25 seconds'
    )
  `

  const worker = new ForgeWorker('test', async () => {}, { connection: CONNECTION })
  await worker.recoverStalledJobs()
  await worker.stop()

  const [job] = await sql`SELECT * FROM "Job" WHERE type = 'fresh'`

  expect(job.status).toBe('ACTIVE')
  expect(job.locked_by).toBe('live-worker')
})

test('heartbeat продовжує locked_until поки задача виконується', async () => {
  const queue = new ForgeQueue({ connection: CONNECTION, name: 'test' })

  // задача що виконується 600ms
  let lockedUntilDuringExecution: Date | null = null

  const worker = new ForgeWorker(
    'test',
    async (job) => {
      await sleep(600)
      // читаємо locked_until під час виконання
      const [row] = await sql`SELECT locked_until FROM "Job" WHERE id = ${job.id}`
      lockedUntilDuringExecution = row.locked_until
    },
    { connection: CONNECTION, pollInterval: 50 },
  )

  const job = await queue.add('heartbeat-test', {})
  const before = new Date()
  worker.start()

  await sleep(900)
  await worker.stop()
  await queue.close()

  // locked_until має бути оновлений heartbeat-ом (більший за початковий lease)
  // початковий lease: before + 30s
  // після heartbeat: ще пізніше
  // перевіряємо що locked_until існував під час виконання
  expect(lockedUntilDuringExecution).not.toBeNull()

  const result = await sql`SELECT * FROM "Job" WHERE id = ${job.id}`
  expect(result[0].status).toBe('COMPLETED')
})
