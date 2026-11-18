import { defineConfig, devices } from '@playwright/test'
import { randomUUID } from 'node:crypto'

const port = Number(process.env.TEST_PORT || 3321)
const origin = `http://127.0.0.1:${port}`
export default defineConfig({
  testDir: 'tests/e2e', workers: 1, timeout: 70_000,
  use: { ...devices['Desktop Chrome'], baseURL: origin, channel: process.platform === 'win32' ? 'chrome' : undefined, trace: 'retain-on-failure' },
  webServer: {
    command: 'npm run start', url: `${origin}/api/health`, timeout: 30_000, reuseExistingServer: false,
    env: { API_PORT: String(port), MONITORING_DB: `.local/e2e/${randomUUID()}.sqlite`, OBJECT_DIR: '.local/e2e/exports', RENDER_ORIGIN: origin, NODE_ENV: 'test', ADMIN_EMAIL: 'admin@example.test', ADMIN_PASSWORD: '' },
  },
})
