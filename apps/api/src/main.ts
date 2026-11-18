import 'reflect-metadata'
import './config'
import { ArgumentsHost, Catch, HttpException, Module, type ExceptionFilter } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import type { NestExpressApplication } from '@nestjs/platform-express'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NextFunction, Request, Response } from 'express'
import { ControllerRoutes } from './controller'
import { Exports } from './exports'
import { Monitoring } from './monitoring'
import { openStore } from './store'

@Catch()
class Errors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp()
    const response = context.getResponse<Response>()
    if (response.headersSent) return
    const status = error instanceof HttpException ? error.getStatus() : 500
    const detail = error instanceof HttpException ? error.getResponse() : undefined
    const requestId = response.getHeader('x-request-id')
    if (status >= 500 && !(error instanceof HttpException)) console.error(`API ${requestId}:`, error instanceof Error ? error.name : 'Unexpected error')
    const known = detail && typeof detail === 'object' && 'code' in detail ? detail : null
    const message = status === 413 ? 'Berkas terlalu besar. Maksimum 4 MB per slot.' : status === 404 ? 'Halaman tidak ditemukan.' : status >= 500 ? 'Terjadi gangguan pada layanan.' : 'Permintaan tidak dapat diproses.'
    response.status(status).json({ code: 'REQUEST_FAILED', message, retryable: status >= 500, ...known, requestId })
  }
}

const store = await openStore()
const monitoring = new Monitoring(store)
await monitoring.initialize()
const exports = new Exports(monitoring)
@Module({ controllers: [ControllerRoutes], providers: [{ provide: Monitoring, useValue: monitoring }, { provide: Exports, useValue: exports }] })
class AppModule {}

const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn'] })
app.setGlobalPrefix('api')
app.useGlobalFilters(new Errors())
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('X-Request-Id', randomUUID())
  if (req.path.startsWith('/api/') && !['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    const origin = req.get('origin')
    const allowed = process.env.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`
    if (req.get('x-monitoring-request') !== '1' || (origin && origin !== allowed)) {
      res.status(403).json({ code: 'CSRF_REJECTED', message: 'Asal permintaan tidak diizinkan.', retryable: false, requestId: res.getHeader('x-request-id') })
      return
    }
  }
  if (req.path.startsWith('/api/internal/') || req.path.startsWith('/api/d/') || req.path.startsWith('/d/') || req.path.startsWith('/bagikan')) res.setHeader('X-Robots-Tag', 'noindex, nofollow')
  next()
})

const web = resolve('dist/web')
if (existsSync(web)) {
  app.useStaticAssets(web, { index: false })
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (req.method !== 'GET' || req.path.startsWith('/api') || req.path.startsWith('/assets/')) return next()
    return res.sendFile(resolve(web, 'index.html'))
  })
}
const port = Number(process.env.API_PORT || 3001)
await app.listen(port, process.env.API_HOST || '127.0.0.1')
if (process.env.JOBS_PROCESS !== 'worker') { monitoring.startImports(); exports.start() }
console.log(`Monitoring API · http://127.0.0.1:${port}/api/health`)
