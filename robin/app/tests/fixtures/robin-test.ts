import { test as base, expect } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

export interface RobinServer {
  vaultPath: string;
  baseURL: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  restart: (options?: { dropIndex?: boolean }) => Promise<void>;
}

type WorkerFixtures = {
  robinServer: RobinServer;
};

const APP_ROOT = path.resolve(__dirname, '../..');
const WEB_ROOT = path.join(APP_ROOT, 'apps', 'web');
const NEXT_BIN = path.join(APP_ROOT, 'node_modules', 'next', 'dist', 'bin', 'next');
const FIXTURE_VAULT = path.resolve(__dirname, 'vault');

async function freePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForReady(baseURL: string, output: () => string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(baseURL, { redirect: 'manual' });
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Robin server did not become ready: ${lastError}\n${output()}`);
}

async function waitForExit(child: ChildProcess, timeoutMs = 8_000): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await Promise.race([
    new Promise<void>(resolve => child.once('exit', () => resolve())),
    new Promise<void>(resolve => setTimeout(resolve, timeoutMs)),
  ]);
}

export const test = base.extend<{}, WorkerFixtures>({
  robinServer: [async ({}, use) => {
    const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), 'robin-e2e-vault-'));
    fs.cpSync(FIXTURE_VAULT, vaultPath, {
      recursive: true,
      filter: source => path.basename(source) !== '.robin',
    });
    fs.writeFileSync(path.join(vaultPath, '.robin-e2e'), 'disposable test vault\n', 'utf8');

    const httpPort = await freePort();
    const voicePort = await freePort();
    const baseURL = `http://127.0.0.1:${httpPort}`;
    let child: ChildProcess | null = null;
    let logs = '';

    const stop = async () => {
      const running = child;
      if (!running) return;
      child = null;
      if (running.exitCode === null && running.pid) {
        try {
          process.kill(-running.pid, 'SIGTERM');
        } catch {
          running.kill('SIGTERM');
        }
        await waitForExit(running);
      }
      if (running.exitCode === null && running.pid) {
        try {
          process.kill(-running.pid, 'SIGKILL');
        } catch {
          running.kill('SIGKILL');
        }
        await waitForExit(running, 2_000);
      }
    };

    const start = async () => {
      if (child) return;
      logs = '';
      child = spawn(process.execPath, [NEXT_BIN, 'start', '-H', '127.0.0.1', '-p', String(httpPort)], {
        cwd: WEB_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          ROBIN_VAULT: vaultPath,
          ROBIN_OWNER: 'Alex',
          ROBIN_EMBED_MODE: 'stub',
          ROBIN_WHISPER_MODE: 'stub',
          ROBIN_XAI_MODE: 'stub',
          INTERVIEW_WS_PORT: String(voicePort),
          TZ: 'UTC',
        },
      });
      const append = (chunk: Buffer) => {
        logs = `${logs}${chunk.toString('utf8')}`.slice(-20_000);
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      await waitForReady(baseURL, () => logs);
      const resync = await fetch(`${baseURL}/api/resync`, { method: 'POST' });
      if (!resync.ok) throw new Error(`Initial resync failed (${resync.status})\n${logs}`);
    };

    const restart = async (options?: { dropIndex?: boolean }) => {
      await stop();
      if (options?.dropIndex) {
        if (!fs.existsSync(path.join(vaultPath, '.robin-e2e'))) {
          throw new Error('Refusing to remove index from an unmarked vault');
        }
        fs.rmSync(path.join(vaultPath, '.robin'), { recursive: true, force: true });
      }
      await start();
    };

    try {
      await start();
      await use({ vaultPath, baseURL, start, stop, restart });
    } finally {
      await stop();
      if (process.env['ROBIN_KEEP_E2E_VAULT'] !== '1') {
        fs.rmSync(vaultPath, { recursive: true, force: true });
      } else {
        process.stderr.write(`Kept Robin E2E vault: ${vaultPath}\n`);
      }
    }
  }, { scope: 'worker', timeout: 90_000 }],

  baseURL: async ({ robinServer }, use) => {
    await use(robinServer.baseURL);
  },
});

export { expect };
