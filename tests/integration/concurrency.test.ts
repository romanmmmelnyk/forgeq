import { createClient } from '../../packages/postgres/src'
import { ForgeQueue, ForgeWorker } from '../../packages/core/src'

const CONNECTION = { url: process.env.DATABASE_URL! }
const sql = createClient(CONNECTION.url)

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

beforeEach(async () => {
  await sql`DELETE FROM "Job"`
})

afterAll(async () => {
  await sql`DELETE FROM "Job"`
  await sql.end()
})

test('задачі виконуються у порядку пріоритету', async () => {
  const queue = new ForgeQueue({ connection: CONNECTION, name: 'test' })
  const order: number[] = []

  await queue.add('task', { n: 1 }, { priority: 1 })
  await queue.add('task', { n: 99 }, { priority: 99 })
  await queue.add('task', { n: 10 }, { priority: 10 })

  const worker = new ForgeWorker(
    'test',
    async (job) => { order.push((job.data as any).n) },
    { connection: CONNECTION, concurrency: 1, pollInterval: 50 },
  )

  worker.start()
  await sleep(600)
  await worker.stop()
  await queue.close()

  expect(order).toEqual([99, 10, 1])
})

test('задача з delay не виконується до runAt', async () => {
  const queue = new ForgeQueue({ connection: CONNECTION, name: 'test' })
  const executed: string[] = []

  await queue.add('delayed', {}, { delay: 500 })

  const worker = new ForgeWorker(
    'test',
    async (job) => { executed.push(job.type) },
    { connection: CONNECTION, pollInterval: 50 },
  )

  worker.start()

  await sleep(200)
  expect(executed).toHaveLength(0)

  await sleep(500)
  expect(executed).toHaveLength(1)

  await worker.stop()
  await queue.close()
})

test('два add() з однаковим idempotencyKey створюють одну задачу', async () => {
  const queue = new ForgeQueue({ connection: CONNECTION, name: 'test' })

  const job1 = await queue.add('email', { to: 'user@example.com' }, { idempotencyKey: 'welcome-123' })
  const job2 = await queue.add('email', { to: 'user@example.com' }, { idempotencyKey: 'welcome-123' })

  expect(job1).not.toBeNull()
  expect(job2).toBeNull()

  const [{ count }] = await sql`SELECT COUNT(*)::int as count FROM "Job"`
  expect(count).toBe(1)

  await queue.close()
})

test('воркер не перевищує ліміт одночасних задач', async () => {
  const queue = new ForgeQueue({ connection: CONNECTION, name: 'test' })
  let maxConcurrent = 0
  let current = 0

  for (let i = 0; i < 10; i++) {
    await queue.add('slow', {})
  }

  const worker = new ForgeWorker(
    'test',
    async () => {
      current++
      maxConcurrent = Math.max(maxConcurrent, current)
      await sleep(100)
      current--
    },
    { connection: CONNECTION, concurrency: 3, pollInterval: 50 },
  )

  worker.start()
  await sleep(800)
  await worker.stop()
  await queue.close()

  expect(maxConcurrent).toBeLessThanOrEqual(3)
  expect(maxConcurrent).toBe(3)
})

test('stop() чекає поки активні задачі завершаться', async () => {
  const queue = new ForgeQueue({ connection: CONNECTION, name: 'test' })
  const completed: string[] = []

  await queue.add('long-job', {})

  const worker = new ForgeWorker(
    'test',
    async (job) => {
      await sleep(300)
      completed.push(job.id)
    },
    { connection: CONNECTION, pollInterval: 50 },
  )

  worker.start()
  await sleep(100)

  await worker.stop()

  expect(completed).toHaveLength(1)

  const result = await queue.getJob(completed[0])
  expect(result.status).toBe('COMPLETED')

  await queue.close()
})
