/**
 * Playwright configuration — placeholder.
 * The Playwright agent will fill this in during Phase 2 testing.
 *
 * @see https://playwright.dev/docs/test-configuration
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PlaywrightConfig = any;

const config: PlaywrightConfig = {
  testDir: '../../tests/web',
  use: {
    baseURL: 'http://localhost:8400',
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:8400',
    reuseExistingServer: true,
  },
};

export default config;
