import { ForgeQueue, ForgeWorker } from '../../packages/core/src'

const CONNECTION = { url: process.env.DATABASE_URL! }

let queue: ForgeQueue
let worker: ForgeWorker

beforeEach(async () => {
  queue = new ForgeQueue({ connection: CONNECTION, name: 'test' })
  // очищаємо таблицю перед кожним тестом
  const { createClient } = await import('../../packages/postgres/src')
  const sql = createClient(CONNECTION.url)
  await sql`DELETE FROM "Job"`
  await sql.end()
})

afterEach(async () => {
  await worker?.stop()
  await queue.close()
})

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('задача виконується і стає COMPLETED', async () => {
  const executed: string[] = []

  worker = new ForgeWorker(
    'test',
    async (job) => { executed.push(job.id) },
    { connection: CONNECTION, pollInterval: 100 },
  )

  const job = await queue.add('noop', { value: 1 })
  worker.start()

  await sleep(500)

  const result = await queue.getJob(job.id)
  expect(result.status).toBe('COMPLETED')
  expect(executed).toContain(job.id)
})

test('при помилці задача повертається в QUEUED з attempts + 1', async () => {
  worker = new ForgeWorker(
    'test',
    async () => { throw new Error('щось пішло не так') },
    { connection: CONNECTION, pollInterval: 100 },
  )

  const job = await queue.add('fail', {}, { attempts: 3 })
  worker.start()

  await sleep(500)

  const result = await queue.getJob(job.id)
  expect(result.status).toBe('QUEUED')
  expect(result.attempts).toBe(1)
  expect(result.failed_reason).toBe('щось пішло не так')
})

test('після вичерпання спроб задача стає DEAD', async () => {
  worker = new ForgeWorker(
    'test',
    async () => { throw new Error('завжди падає') },
    { connection: CONNECTION, pollInterval: 100 },
  )

  // max_attempts = 1, тобто після першої невдачі → DEAD
  const job = await queue.add('always-fail', {}, { attempts: 1 })
  worker.start()

  await sleep(500)

  const result = await queue.getJob(job.id)
  expect(result.status).toBe('DEAD')
})

test('два воркери паралельно — кожна задача виконується рівно раз', async () => {
  const executed: string[] = []
  const handler = async (job: { id: string }) => {
    executed.push(job.id)
    await new Promise(r => setTimeout(r, 50))
  }

  const worker1 = new ForgeWorker('test', handler, { connection: CONNECTION, pollInterval: 50 })
  const worker2 = new ForgeWorker('test', handler, { connection: CONNECTION, pollInterval: 50 })

  for (let i = 0; i < 5; i++) {
    await queue.add(`job-${i}`, {})
  }

  worker1.start()
  worker2.start()

  await sleep(1000)

  await worker1.stop()
  await worker2.stop()

  const unique = new Set(executed)
  expect(executed).toHaveLength(5)
  expect(unique.size).toBe(5)
})
