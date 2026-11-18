import './config'
import { createApp } from './bootstrap'

const { app, monitoring, exports } = await createApp()
const port = Number(process.env.API_PORT || 3001)
await app.listen(port, process.env.API_HOST || '127.0.0.1')
if (process.env.JOBS_PROCESS !== 'worker') { monitoring.startImports(); exports.start() }
console.log(`Monitoring API · http://127.0.0.1:${port}/api/health`)
