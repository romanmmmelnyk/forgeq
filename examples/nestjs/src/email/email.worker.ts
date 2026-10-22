import { Injectable } from '@nestjs/common'
import { ForgeWorker } from '@forgeq/core'

type EmailPayload = {
  to: string
  username: string
}

@Injectable()
export class EmailWorker {
  private worker = new ForgeWorker<EmailPayload>(
    'emails',
    async (job) => {
      if (job.type === 'send-welcome') {
        await this.sendWelcome(job.data.to, job.data.username)
      }
    },
    {
      connection: { url: process.env.DATABASE_URL! },
      concurrency: 10,
    }
  )

  start() {
    this.worker.start()
  }

  stop() {
    return this.worker.stop()
  }

  private async sendWelcome(to: string, username: string) {
    console.log(`Sending welcome email to ${to} (${username})`)
  }
}
