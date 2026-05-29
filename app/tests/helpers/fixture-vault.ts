/**
 * fixture-vault.ts
 *
 * Copies tests/fixtures/vault into a fresh tmpdir for each test run.
 * Returns the absolute path to the copy so tests can point ROBIN_VAULT at it.
 *
 * Usage (in a beforeEach or test fixture):
 *
 *   import { copyFixtureVault } from '../helpers/fixture-vault';
 *
 *   let vaultPath: string;
 *   test.beforeEach(async () => {
 *     vaultPath = await copyFixtureVault();
 *     // Pass vaultPath to the server via ROBIN_VAULT_TEST env if needed.
 *   });
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const FIXTURE_VAULT_SRC = path.resolve(__dirname, '../fixtures/vault');

/**
 * Recursively copy src → dest.
 */
function copyDirSync(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Copy the fixture vault to a unique tmpdir.
 * Returns the absolute path to the copy.
 *
 * Note: Playwright's webServer config is set at config load time, so this
 * function is most useful in tests that spin up a second server instance,
 * or when ROBIN_VAULT_TEST is exported before starting the dev server.
 * For the default Playwright webServer flow, the fixture vault at
 * tests/fixtures/vault is used directly (see playwright.config.ts).
 */
export async function copyFixtureVault(): Promise<string> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-test-vault-'));
  copyDirSync(FIXTURE_VAULT_SRC, tmpDir);
  return tmpDir;
}

/**
 * Remove a tmpdir created by copyFixtureVault.
 * Call in afterEach / afterAll to avoid tmpdir accumulation.
 */
export function cleanupVault(vaultPath: string): void {
  fs.rmSync(vaultPath, { recursive: true, force: true });
}
