import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Express } from 'express'
import { createApp } from '../apps/api/src/bootstrap'

let server: Promise<Express> | undefined

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    server ??= createApp({ serverless: true }).then(async ({ app }) => {
      await app.init()
      return app.getHttpAdapter().getInstance() as Express
    })
    const express = await server
    express(req, res)
  } catch (error) {
    server = undefined
    console.error('Pansus API initialization:', error instanceof Error ? error.name : 'Unexpected error')
    if (res.headersSent) { res.end(); return }
    res.writeHead(503, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ code: 'API_UNAVAILABLE', message: 'Layanan Pansus belum dapat terhubung ke penyimpanan.', retryable: true }))
  }
}
