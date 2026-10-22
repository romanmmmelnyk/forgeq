# ForgeQ

Reliable background job queue for Node.js, built on PostgreSQL. No Redis required.

I built this because I wanted to understand how job queues actually work under the hood - not just use BullMQ as a black box. The interesting part isn't "how to send an email in the background", it's "what happens when two workers try to grab the same job at the same time" or "what happens when a worker crashes mid-execution".

---

## Why PostgreSQL and not Redis

Most job queues use Redis. Redis is fast, but it's another dependency, another thing to monitor, another thing that can go down. If you already have PostgreSQL in your stack, you have everything you need.

PostgreSQL gives you `FOR UPDATE SKIP LOCKED` - a way to atomically claim a job row so that no two workers can ever pick up the same job. That's the core of how this works.

---

## Install

```bash
npm install forgeq
```

---

## Usage

```ts
import { ForgeQueue, ForgeWorker } from 'forgeq'

// producer - add jobs from anywhere in your app
const queue = new ForgeQueue({
  connection: { url: process.env.DATABASE_URL },
  name: 'emails',
})

await queue.add('send-welcome', { to: 'user@example.com' }, {
  attempts: 5,
  idempotencyKey: `welcome-${userId}`,
})

// worker - runs in a separate process
const worker = new ForgeWorker('emails', async (job) => {
  await sendEmail(job.data.to)
}, {
  connection: { url: process.env.DATABASE_URL },
  concurrency: 10,
})

worker.start()
```

---

## How it works

When a worker picks up a job, it runs this SQL:

```sql
UPDATE "Job"
SET status = 'ACTIVE', locked_by = $1, locked_until = NOW() + INTERVAL '30 seconds'
WHERE id = (
  SELECT id FROM "Job"
  WHERE status = 'QUEUED' AND run_at <= NOW()
  FOR UPDATE SKIP LOCKED
  LIMIT 1
)
RETURNING *
```

`FOR UPDATE SKIP LOCKED` is the key part - if another worker already locked that row, this worker skips it and grabs the next one. The whole thing is one atomic operation, so there's no race condition.

Workers send a heartbeat every 10 seconds to extend the lock. If a worker crashes, the lock expires after 30 seconds and a recovery loop returns the job to the queue.

---

## Job lifecycle

```
QUEUED → ACTIVE → COMPLETED
                ↘ QUEUED (retry with backoff)
                  ↘ DEAD (max attempts reached)
```

Failed jobs retry with exponential backoff + jitter. After hitting `maxAttempts`, they go to DEAD where you can inspect and replay them manually.

---

## Options

```ts
queue.add('type', payload, {
  attempts: 3,          // max retry attempts (default: 3)
  delay: 5000,          // run after N ms
  priority: 10,         // higher = runs first
  idempotencyKey: '...' // prevents duplicate jobs
})

new ForgeWorker('queue', handler, {
  connection: { url },
  concurrency: 5,       // parallel jobs per worker (default: 1)
  pollInterval: 1000,   // ms between polls when queue is empty (default: 1000)
})
```

---

## What this is not

This is not a production-ready library. It's a learning project - I built it to understand the internals of job queues: atomic claiming, lease-based locking, retry strategies, and recovery under failure.

If you need something production-ready, use [BullMQ](https://bullmq.io/).

---

## Running locally

```bash
# start postgres
docker compose up -d

# run migrations
DATABASE_URL=postgres://forgeq:forgeq@localhost:5433/forgeq npx ts-node packages/postgres/src/migrate.ts

# run tests
DATABASE_URL=postgres://forgeq:forgeq@localhost:5433/forgeq npm test
```

---

## What I learned building this

The hardest part wasn't the queue itself - it was thinking through failure modes. What if the worker crashes after claiming a job but before finishing it? What if two workers start at the exact same millisecond? What if a network partition happens mid-heartbeat?

PostgreSQL row-level locking solves the concurrency problem cleanly. The lease + heartbeat + recovery loop handles crashes. The idempotency key handles duplicate requests from clients.

The thing I'd do differently: I'd add a `JobAttempt` table to store the history of each attempt separately, instead of just keeping `attempts` as a counter. That would make debugging failed jobs much easier.
