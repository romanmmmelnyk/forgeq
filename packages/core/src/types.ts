export interface ConnectionOptions {
  url: string
}

export interface AddOptions {
  attempts?: number
  delay?: number          // ms, delay this task
  priority?: number
  idempotencyKey?: string
}

export interface WorkerOptions {
  connection: ConnectionOptions
  concurrency?: number    // how many tasks at the same time (default: 1)
  pollInterval?: number   // ms (default: 1000)
}

export type JobHandler<T = Record<string, unknown>> = (job: {
  id: string
  type: string
  data: T
  attempts: number
}) => Promise<void>
