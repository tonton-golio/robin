import { defineConfig } from '@playwright/test';
import path from 'node:path';

export default defineConfig({
  testDir: './specs',
  webServer: {
    command: 'npm run dev --workspace=@robin/web',
    cwd: path.resolve(__dirname, '..'),
    port: 8400,
    timeout: 120_000,
    reuseExistingServer: process.env['PW_REUSE_EXISTING_SERVER'] === '1',
    env: {
      ROBIN_VAULT:
        process.env['ROBIN_VAULT_TEST'] ??
        path.resolve(__dirname, 'fixtures/vault'),
      ROBIN_EMBED_MODE: 'stub',
      ROBIN_WHISPER_MODE: 'stub',
      ROBIN_XAI_MODE: 'stub',
    },
  },
  use: { baseURL: 'http://localhost:8400' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
