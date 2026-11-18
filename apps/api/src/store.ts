import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { MongoClient, type ClientSession, type Collection, type Db } from 'mongodb'
import { mongoObjects, type Objects } from './objects'

type Entry = { _id: string; value: unknown; revision?: number }
export class Records {
  readonly changed = new Map<string, unknown>()
  constructor(private readonly values: Map<string, unknown>) {}
  get<T>(key: string) { return this.values.get(key) as T | undefined }
  list<T>(prefix: string) {
    return [...this.values].filter(([key]) => key.startsWith(prefix)).map(([, value]) => value as T)
  }
  put<T>(key: string, value: T) {
    this.values.set(key, value)
    this.changed.set(key, value)
  }
  delete(key: string) {
    this.values.delete(key)
    this.changed.set(key, undefined)
  }
}
export interface Store {
  objects?: Objects
  read<T>(action: (records: Records) => T): Promise<T>
  write<T>(action: (records: Records) => T): Promise<T>
}

class LocalStore implements Store {
  private readonly db: DatabaseSync
  constructor(file: string) {
    mkdirSync(dirname(file), { recursive: true })
    this.db = new DatabaseSync(file)
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000; CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY, body TEXT NOT NULL)')
  }
  private records() {
    const rows = this.db.prepare('SELECT key, body FROM records').all()
    return new Records(new Map(rows.map(row => [String(row.key), JSON.parse(String(row.body))])))
  }
  async read<T>(action: (records: Records) => T) { return action(this.records()) }
  async write<T>(action: (records: Records) => T) {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const records = this.records()
      const result = action(records)
      const upsert = this.db.prepare('INSERT INTO records (key, body) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET body = excluded.body')
      const remove = this.db.prepare('DELETE FROM records WHERE key = ?')
      for (const [key, value] of records.changed) {
        if (value === undefined) remove.run(key)
        else upsert.run(key, JSON.stringify(value))
      }
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

class MongoStore implements Store {
  private readonly collection: Collection<Entry>
  readonly objects?: Objects
  constructor(private readonly client: MongoClient, database: Db, serverless: boolean) {
    this.collection = database.collection<Entry>('monitoring_records')
    if (serverless && !process.env.S3_BUCKET) this.objects = mongoObjects(database)
  }
  private async records(session?: ClientSession) {
    const entries = await this.collection.find({ _id: { $ne: '_serialization' } }, { session }).toArray()
    return new Records(new Map(entries.map(entry => [entry._id, entry.value])))
  }
  async read<T>(action: (records: Records) => T) { return action(await this.records()) }
  async write<T>(action: (records: Records) => T) {
    return this.client.withSession(session => session.withTransaction(async () => {
      await this.collection.updateOne({ _id: '_serialization' }, { $inc: { revision: 1 } }, { upsert: true, session })
      const records = await this.records(session)
      const result = action(records)
      for (const [key, value] of records.changed) {
        if (value === undefined) await this.collection.deleteOne({ _id: key }, { session })
        else await this.collection.updateOne({ _id: key }, { $set: { value } }, { upsert: true, session })
      }
      return result
    }))
  }
}

export async function openStore({ serverless = false } = {}): Promise<Store> {
  const uri = process.env.MONGO_URI || process.env.MONGODB_URI
  if (uri) {
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, ignoreUndefined: true })
    try {
      await client.connect()
      const database = client.db(process.env.MONGO_DB || 'bps_monitoring')
      await database.collection<Entry>('monitoring_records')
        .updateOne({ _id: '_serialization' }, { $setOnInsert: { value: 0 } }, { upsert: true })
      return new MongoStore(client, database, serverless)
    } catch (error) {
      await client.close()
      throw error
    }
  }
  if (serverless || process.env.NODE_ENV === 'production') throw new Error('MONGO_URI atau MONGODB_URI replica set wajib untuk mode produksi.')
  return new LocalStore(resolve(process.env.MONITORING_DB || '.local/monitoring.sqlite'))
}
