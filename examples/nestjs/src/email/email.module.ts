import { Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common'
import { EmailService } from './email.service'
import { EmailWorker } from './email.worker'

@Module({
  providers: [EmailService, EmailWorker],
  exports: [EmailService],
})
export class EmailModule implements OnApplicationBootstrap, OnApplicationShutdown {
  constructor(private readonly emailWorker: EmailWorker) {}

  onApplicationBootstrap() {
    this.emailWorker.start()
  }

  async onApplicationShutdown() {
    await this.emailWorker.stop()
  }
}
