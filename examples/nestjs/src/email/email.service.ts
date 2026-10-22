import { Injectable } from '@nestjs/common'
import { ForgeQueue } from '@forgeq/core'

type WelcomeEmailPayload = {
  to: string
  username: string
}

@Injectable()
export class EmailService {
  private queue = new ForgeQueue({
    connection: { url: process.env.DATABASE_URL! },
    name: 'emails',
  })

  async sendWelcome(to: string, username: string) {
    return this.queue.add<WelcomeEmailPayload>(
      'send-welcome',
      { to, username },
      {
        attempts: 5,
        idempotencyKey: `welcome-${to}`,
      }
    )
  }
}
