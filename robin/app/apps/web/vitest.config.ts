import { defineConfig } from 'vitest/config';
import path from 'node:path';

// Minimal config: node environment + the same `@/` path alias the app's
// tsconfig defines, so tests can import modules that use `@/lib/...` (e.g. the
// edit-store / revert action, which read the vault via `@/lib/vault`).
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic' } },
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname),
    },
  },
});
