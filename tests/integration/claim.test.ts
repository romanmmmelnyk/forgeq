import { createClient, claimNextJob } from '../../packages/postgres/src'

const DATABASE_URL = process.env.DATABASE_URL!
const sql = createClient(DATABASE_URL)

beforeEach(async () => {
  await sql`DELETE FROM "Job"`
})

afterAll(async () => {
  await sql`DELETE FROM "Job"`
  await sql.end()
})

async function insertJob(type: string, priority = 0) {
  const [job] = await sql`
    INSERT INTO "Job" (queue_name, type, payload)
    VALUES ('test', ${type}, '{}')
    RETURNING *
  `
  return job
}

test('повертає null якщо черга порожня', async () => {
  const job = await claimNextJob(sql, 'test', 'worker-1')
  expect(job).toBeNull()
})

test('повертає задачу і переводить в ACTIVE', async () => {
  await insertJob('send-email')

  const job = await claimNextJob(sql, 'test', 'worker-1')

  expect(job).not.toBeNull()
  expect(job!.status).toBe('ACTIVE')
  expect(job!.locked_by).toBe('worker-1')
  expect(job!.locked_until).not.toBeNull()
  expect(job!.attempts).toBe(1)
})

test('10 воркерів паралельно — кожна задача береться рівно одним', async () => {
  // додаємо 5 задач
  for (let i = 0; i < 5; i++) {
    await insertJob(`job-${i}`)
  }

  // 10 воркерів одночасно намагаються взяти задачу
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      claimNextJob(sql, 'test', `worker-${i}`)
    )
  )

  const claimed = results.filter(Boolean)
  const ids = claimed.map(j => j!.id)
  const uniqueIds = new Set(ids)

  // 5 задач взято, 5 воркерів отримали null
  expect(claimed).toHaveLength(5)
  // жодна задача не взята двічі
  expect(uniqueIds.size).toBe(5)
})
