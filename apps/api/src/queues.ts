import { Queue, Worker } from 'bullmq'

const connection = (value: string) => {
  const url = new URL(value)
  if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') throw new Error('REDIS_URL harus memakai redis atau rediss.')
  return { host: url.hostname, port: Number(url.port || 6379), username: url.username ? decodeURIComponent(url.username) : undefined, password: url.password ? decodeURIComponent(url.password) : undefined, db: Number(url.pathname.slice(1) || 0), tls: url.protocol === 'rediss:' ? {} : undefined, maxRetriesPerRequest: null }
}

export class JobQueue {
  private readonly redis = process.env.REDIS_URL ? connection(process.env.REDIS_URL) : undefined
  private readonly queue?: Queue<{ id: string }>
  constructor(private readonly name: string) {
    if (!this.redis) return
    this.queue = new Queue(name, { connection: this.redis, defaultJobOptions: { removeOnComplete: 100, removeOnFail: 100 } })
    this.queue.on('error', () => console.error(`Koneksi antrean ${name} belum tersedia.`))
  }
  send(id: string) {
    if (this.queue) void this.queue.add('process', { id }, { jobId: id }).catch(() => console.error(`Pekerjaan ${this.name} akan dipulihkan dari penyimpanan.`))
  }
  start(work: (id?: string) => Promise<void>) {
    if (this.redis) {
      const worker = new Worker<{ id: string }>(this.name, job => work(job.data.id), { connection: this.redis, concurrency: 1 })
      worker.on('error', () => console.error(`Koneksi worker ${this.name} terganggu.`))
    }
    // Polling juga memulihkan job yang tercatat ketika Redis sedang putus.
    const timer = setInterval(() => void work().catch(() => console.error(`Pekerjaan ${this.name} tidak dapat diambil.`)), 900)
    timer.unref()
  }
}
