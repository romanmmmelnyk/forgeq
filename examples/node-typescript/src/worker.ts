import { ForgeWorker } from '@forgeq/core'

type EmailJob = {
  to: string
  subject: string
  body: string
}

const worker = new ForgeWorker<EmailJob>(
  'emails',
  async (job) => {
    console.log(`[${job.type}] Sending to ${job.data.to}`)

    await sendEmail({
      to: job.data.to,
      subject: job.data.subject,
      body: job.data.body,
    })

    console.log(`[${job.type}] Done`)
  },
  {
    connection: { url: process.env.DATABASE_URL! },
    concurrency: 5,
  }
)

async function sendEmail(params: { to: string; subject: string; body: string }) {
  await new Promise(resolve => setTimeout(resolve, 100))
}

process.on('SIGTERM', async () => {
  await worker.stop()
  process.exit(0)
})

worker.start()
console.log('Worker started')
