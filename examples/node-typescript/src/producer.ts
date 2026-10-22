import { ForgeQueue } from '@forgeq/core'

type EmailJob = {
  to: string
  subject: string
  body: string
}

const queue = new ForgeQueue({
  connection: { url: process.env.DATABASE_URL! },
  name: 'emails',
})

async function main() {
  await queue.add<EmailJob>(
    'send-welcome',
    {
      to: 'user@example.com',
      subject: 'Welcome!',
      body: 'Thanks for signing up.',
    },
    {
      attempts: 5,
      idempotencyKey: 'welcome-user-42',
    }
  )

  await queue.add<EmailJob>(
    'send-invoice',
    {
      to: 'billing@example.com',
      subject: 'Invoice #1234',
      body: 'Please find your invoice attached.',
    },
    {
      delay: 60_000,
      priority: 10,
    }
  )

  await queue.close()
}

main()
