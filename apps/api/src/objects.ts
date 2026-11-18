import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { GridFSBucket, type Db } from 'mongodb'

export interface Objects {
  put(key: string, data: Uint8Array): Promise<void>
  get(key: string): Promise<Uint8Array>
  remove(key: string): Promise<void>
}

const allowedKey = /^[a-z0-9_-]+(?:\/[a-z0-9_-]+)*(?:\.[a-z0-9]+)?$/
function check(key: string) {
  if (!allowedKey.test(key)) throw new Error('Invalid object key')
  return key
}

export function mongoObjects(database: Db): Objects {
  const bucket = new GridFSBucket(database, { bucketName: 'monitoring_objects' })
  return {
    async put(key, data) {
      const upload = bucket.openUploadStream(check(key))
      try { await pipeline(Readable.from([data]), upload) }
      catch (error) { await upload.abort().catch(() => {}); throw error }
    },
    async get(key) {
      const chunks: Buffer[] = []
      for await (const chunk of bucket.openDownloadStreamByName(check(key))) chunks.push(chunk)
      return Buffer.concat(chunks)
    },
    async remove(key) {
      for await (const file of bucket.find({ filename: check(key) })) await bucket.delete(file._id)
    },
  }
}
export function openObjects(): Objects {
  const bucket = process.env.S3_BUCKET
  if (bucket) {
    const client = new S3Client({ region: process.env.AWS_REGION || 'us-east-1', endpoint: process.env.S3_ENDPOINT || undefined, forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false' })
    const key = (name: string) => ({ Bucket: bucket, Key: 'monitoring/' + check(name) })
    return {
      async put(name, data) { await client.send(new PutObjectCommand({ ...key(name), Body: data })) },
      async get(name) {
        const result = await client.send(new GetObjectCommand(key(name)))
        if (!result.Body) throw new Error('Missing object')
        return result.Body.transformToByteArray()
      },
      async remove(name) { await client.send(new DeleteObjectCommand(key(name))) },
    }
  }
  const root = resolve(process.env.OBJECT_DIR || '.local/objects')
  const path = (key: string) => resolve(root, check(key))
  return {
    async put(key, data) { const file = path(key); await mkdir(dirname(file), { recursive: true }); await writeFile(file, data) },
    get: key => readFile(path(key)),
    remove: key => rm(path(key), { force: true }),
  }
}
