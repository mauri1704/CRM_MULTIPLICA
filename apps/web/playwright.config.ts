import { defineConfig, devices } from '@playwright/test';

/**
 * E2E contra la API real y la interfaz compilada. Requiere la base de desarrollo migrada y con
 * el seed de demostración (`pnpm db:deploy && pnpm db:seed`).
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    locale: 'es-PE',
    timezoneId: 'America/Lima',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'escritorio', use: { ...devices['Desktop Chrome'] }, grepInvert: /@movil/ },
    { name: 'movil', use: { ...devices['Pixel 7'] }, grep: /@movil/ },
  ],
  webServer: [
    {
      // Las pruebas inician sesión muchas veces seguidas desde la misma IP.
      command: 'AUTH_RATE_LIMIT_PER_MINUTE=1000 pnpm --filter @crm/api start',
      url: 'http://localhost:3001/api/v1/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'pnpm build && pnpm preview',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
    },
  ],
});
