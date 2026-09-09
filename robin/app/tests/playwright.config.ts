import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './specs',
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
