/**
 * Cross-process durability primitives for Robin's file-backed vault.
 *
 * The vault has several writers (web, MCP, CLI, and direct agent processes).
 * Module-level promise chains only serialize one process, so all canonical
 * mutations and JSONL appends coordinate through atomic lock directories under
 * the gitignored `.robin/` sidecar.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_LOCK_TIMEOUT_MS = 10_000;
const DEFAULT_STALE_LOCK_MS = 5 * 60_000;

export interface VaultLockOptions {
  timeoutMs?: number;
  staleAfterMs?: number;
}

/** A compare-and-swap precondition failed because the page changed meanwhile. */
export class VaultConflictError extends Error {
  readonly expectedHash: string | null;
  readonly actualHash: string | null;

  constructor(expectedHash: string | null, actualHash: string | null) {
    super(
      `vault_conflict: expected ${expectedHash ?? "<missing>"}, ` +
        `found ${actualHash ?? "<missing>"}`,
    );
    this.name = "VaultConflictError";
    this.expectedHash = expectedHash;
    this.actualHash = actualHash;
  }
}

/**
 * realpath the given path, or — when it does not exist yet — the nearest
 * existing ancestor. This catches symlinked parents before mkdir/write.
 */
async function realpathNearestExisting(candidate: string): Promise<string> {
  let current = path.resolve(candidate);
  for (;;) {
    try {
      return await fs.realpath(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`vault_path_escape: no existing ancestor for ${candidate}`);
      }
      current = parent;
    }
  }
}

/**
 * Refuse a path whose resolved parent escapes the resolved vault root. When
 * the target already exists, resolve it too: append-mode opens follow file
 * symlinks, so checking only the parent would allow a JSONL symlink to escape.
 */
export async function assertVaultContained(vaultRoot: string, absolutePath: string): Promise<void> {
  const lexicalRoot = path.resolve(vaultRoot);
  const lexicalTarget = path.resolve(absolutePath);
  if (lexicalTarget !== lexicalRoot && !lexicalTarget.startsWith(`${lexicalRoot}${path.sep}`)) {
    throw new Error(`vault_path_escape: refusing lexical path outside vault: ${absolutePath}`);
  }

  // Reject aliases, even when a symlink still points inside the vault. Aliased
  // paths would produce different lock/event keys for the same inode and break
  // CAS serialization. The configured vault root itself may be a symlink, but
  // no component beneath it may be one.
  const relativeParts = path.relative(lexicalRoot, lexicalTarget).split(path.sep).filter(Boolean);
  let component = lexicalRoot;
  for (const part of relativeParts) {
    component = path.join(component, part);
    try {
      if ((await fs.lstat(component)).isSymbolicLink()) {
        throw new Error(`vault_path_symlink: refusing aliased vault path: ${absolutePath}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }

  const realRoot = await fs.realpath(vaultRoot);
  const contained = (candidate: string) =>
    candidate === realRoot || candidate.startsWith(realRoot + path.sep);
  const realParent = await realpathNearestExisting(path.dirname(absolutePath));
  if (!contained(realParent)) {
    throw new Error(`vault_path_escape: refusing to write outside the vault root: ${absolutePath}`);
  }
  try {
    const realTarget = await fs.realpath(absolutePath);
    if (!contained(realTarget)) {
      throw new Error(
        `vault_path_escape: refusing to follow target outside the vault root: ${absolutePath}`,
      );
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/** fsync a directory after a rename/unlink so the directory entry is durable. */
export async function fsyncDirectory(directory: string): Promise<void> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    // Some filesystems/platforms reject directory fsync. Do not weaken normal
    // writes there, but surface unexpected failures on platforms that support it.
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EINVAL" && code !== "ENOTSUP" && code !== "EISDIR") throw error;
  } finally {
    await handle?.close().catch(() => {});
  }
}

/** Create each missing directory component and fsync its parent entry. */
async function ensureDirectoryDurable(directory: string, mode = 0o700): Promise<void> {
  const missing: string[] = [];
  let current = path.resolve(directory);
  for (;;) {
    try {
      const stat = await fs.stat(current);
      if (!stat.isDirectory()) throw new Error(`not_a_directory: ${current}`);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      missing.unshift(current);
      const parent = path.dirname(current);
      if (parent === current) throw error;
      current = parent;
    }
  }
  for (const item of missing) {
    try {
      await fs.mkdir(item, { mode });
      await fsyncDirectory(path.dirname(item));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
}

/** Write a new file, fsync its bytes, then fsync the containing directory. */
export async function durableWriteNew(
  absolutePath: string,
  contents: string,
  mode = 0o600,
): Promise<void> {
  const directory = path.dirname(absolutePath);
  await ensureDirectoryDurable(directory);
  const temporaryPath = `${absolutePath}.tmp.${crypto.randomUUID()}`;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(temporaryPath, "wx", mode);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.link(temporaryPath, absolutePath);
    await fs.unlink(temporaryPath);
    await fsyncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Copy arbitrary bytes to a create-only destination without exposing a partial
 * final file. The copy is staged beside the destination, fsynced, hard-linked
 * into place atomically, then the staging name is removed.
 */
export async function durableCopyNew(
  sourcePath: string,
  destinationPath: string,
  mode = 0o600,
): Promise<void> {
  const directory = path.dirname(destinationPath);
  await ensureDirectoryDurable(directory);
  const temporaryPath = `${destinationPath}.tmp.${crypto.randomUUID()}`;
  try {
    await fs.copyFile(sourcePath, temporaryPath, fsConstants.COPYFILE_EXCL);
    await fs.chmod(temporaryPath, mode);
    const handle = await fs.open(temporaryPath, "r");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    // link(2) is create-exclusive and the staging file is in the same
    // directory/filesystem, so the final name appears atomically.
    await fs.link(temporaryPath, destinationPath);
    await fs.unlink(temporaryPath);
    await fsyncDirectory(directory);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Atomically replace a file with durable bytes. Returns the temporary path so a
 * caller can include it in diagnostics if replacement fails.
 */
export async function durableReplace(absolutePath: string, contents: string): Promise<void> {
  await ensureDirectoryDurable(path.dirname(absolutePath));
  const temporaryPath = `${absolutePath}.tmp.${crypto.randomUUID()}`;
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await fs.rename(temporaryPath, absolutePath);
    await fsyncDirectory(path.dirname(absolutePath));
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

function lockName(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock(
  vaultRoot: string,
  key: string,
  options: VaultLockOptions,
): Promise<() => Promise<void>> {
  const locksRoot = path.join(vaultRoot, ".robin", "locks");
  await assertVaultContained(vaultRoot, locksRoot);
  await ensureDirectoryDurable(locksRoot);

  const lockPath = path.join(locksRoot, `${lockName(key)}.lock`);
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_LOCK_MS;
  const deadline = Date.now() + timeoutMs;
  const ownerToken = crypto.randomUUID();
  const ownerPath = path.join(lockPath, "owner.json");
  let waitMs = 15;

  for (;;) {
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      try {
        await fs.writeFile(
          ownerPath,
          `${JSON.stringify({
            pid: process.pid,
            token: ownerToken,
            created_at: new Date().toISOString(),
          })}\n`,
          { encoding: "utf8", flag: "wx", mode: 0o600 },
        );
      } catch (error) {
        await fs.rm(lockPath, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
      return async () => {
        const owner = await readLockOwner(ownerPath);
        if (!owner || owner.token !== ownerToken) return;
        await fs.unlink(ownerPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
        await fs.rmdir(lockPath).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") throw error;
        });
      };
    } catch (error) {
      const errno = error as NodeJS.ErrnoException;
      if (errno.code !== "EEXIST") throw error;

      const stat = await fs.stat(lockPath).catch(() => null);
      if (stat && Date.now() - stat.mtimeMs > staleAfterMs) {
        // Never steal a lock from a live process merely because a long
        // mutation, debugger pause, or machine sleep exceeded the age limit.
        // The PID marker makes stale cleanup conservative: PID reuse may delay
        // cleanup, but it cannot create overlapping canonical writers.
        const owner = await readLockOwner(ownerPath);
        if (!owner || !isProcessAlive(owner.pid)) {
          const stalePath = `${lockPath}.stale.${crypto.randomUUID()}`;
          try {
            await fs.rename(lockPath, stalePath);
            await fs.rm(stalePath, { recursive: true, force: true });
            continue;
          } catch (cleanupError) {
            if ((cleanupError as NodeJS.ErrnoException).code !== "ENOENT") throw cleanupError;
          }
        }
      }
      if (Date.now() >= deadline) {
        throw new Error(`vault_lock_timeout: ${key}`);
      }
      await sleep(waitMs);
      waitMs = Math.min(200, Math.ceil(waitMs * 1.5));
    }
  }
}

interface LockOwner {
  pid: number;
  token: string;
}

async function readLockOwner(ownerPath: string): Promise<LockOwner | null> {
  try {
    const candidate = JSON.parse(await fs.readFile(ownerPath, "utf8")) as Partial<LockOwner>;
    const pid = candidate.pid;
    return typeof pid === "number" &&
      Number.isInteger(pid) &&
      pid > 0 &&
      typeof candidate.token === "string"
      ? { pid, token: candidate.token }
      : null;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

interface LockLease {
  active: boolean;
}

/**
 * Nested page workflows need to acquire their complete path set once, then call
 * normal writeWithHistory operations without deadlocking on the same locks.
 * Async-local leases make those nested acquisitions re-entrant while preserving
 * filesystem locks across processes. A lease is marked inactive on release so
 * detached async work cannot incorrectly inherit a lock that has ended.
 */
const lockContext = new AsyncLocalStorage<Map<string, LockLease>>();

/**
 * Hold one or more named vault locks. Keys are sorted before acquisition to
 * prevent deadlocks when an operation (move/archive) touches two paths. Nested
 * calls in the same awaited workflow reuse active locks.
 */
export async function withVaultLocks<T>(
  vaultRoot: string,
  keys: string[],
  action: () => Promise<T>,
  options: VaultLockOptions = {},
): Promise<T> {
  const parent = lockContext.getStore();
  const vaultScope = path.resolve(vaultRoot);
  const scoped = (key: string) => `${vaultScope}\0${key}`;
  const releases: Array<() => Promise<void>> = [];
  // APFS/HFS commonly aliases case and canonically equivalent Unicode names.
  // Normalize every key, and case-fold on macOS, so two lexical spellings of
  // the same filesystem path cannot bypass cross-process serialization. On a
  // case-sensitive macOS volume this may serialize unrelated names, which is a
  // safe (and rare) loss of concurrency rather than a correctness risk.
  const canonicalKey = (key: string) => {
    const normalized = key.normalize("NFC");
    return process.platform === "darwin" ? normalized.toLowerCase() : normalized;
  };
  const ordered = [...new Set(keys.map(canonicalKey))].sort();
  const acquired: Array<{ scopedKey: string; lease: LockLease }> = [];
  const context = new Map(parent);
  try {
    for (const key of ordered) {
      const scopedKey = scoped(key);
      if (parent?.get(scopedKey)?.active) continue;
      releases.push(await acquireLock(vaultRoot, key, options));
      const lease = { active: true };
      acquired.push({ scopedKey, lease });
      context.set(scopedKey, lease);
    }
    return await lockContext.run(context, action);
  } finally {
    for (const { lease } of acquired) lease.active = false;
    for (const release of releases.reverse()) {
      await release();
    }
  }
}

/**
 * Cross-process-safe JSONL append. Repairs a missing trailing newline before
 * appending, writes exactly one validated object, and fsyncs the file.
 */
function serializeJsonlObject(value: unknown): {
  object: Record<string, unknown>;
  serialized: string;
} {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("jsonl_value_must_be_object");
  }
  return {
    object: value as Record<string, unknown>,
    serialized: JSON.stringify(value),
  };
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, candidate) => {
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      return Object.fromEntries(
        Object.entries(candidate as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    return candidate;
  });
}

async function resolveJsonlPath(vaultRoot: string, vaultRelativePath: string): Promise<string> {
  const normalized = vaultRelativePath.split("/").filter(Boolean);
  const absolutePath = path.join(vaultRoot, ...normalized);
  await assertVaultContained(vaultRoot, absolutePath);
  return absolutePath;
}

async function appendSerializedJsonl(absolutePath: string, serialized: string): Promise<void> {
  const directory = path.dirname(absolutePath);
  await ensureDirectoryDurable(directory);
  const handle = await fs.open(absolutePath, "a+", 0o600);
  try {
    await handle.chmod(0o600);
    const stat = await handle.stat();
    if (stat.size > 0) {
      const lastByte = Buffer.alloc(1);
      await handle.read(lastByte, 0, 1, stat.size - 1);
      if (lastByte[0] !== 0x0a) {
        await handle.writeFile("\n");
      }
    }
    await handle.writeFile(`${serialized}\n`);
    await handle.sync();
  } finally {
    await handle.close();
  }
  // Required when the append created a new month-bucket file (and harmless for
  // an existing one): do not remove a mutation receipt until the ledger's
  // directory entry is durable too.
  await fsyncDirectory(directory);
}

export async function appendJsonlObject(
  vaultRoot: string,
  vaultRelativePath: string,
  value: unknown,
): Promise<void> {
  const { serialized } = serializeJsonlObject(value);
  const absolutePath = await resolveJsonlPath(vaultRoot, vaultRelativePath);
  await withVaultLocks(vaultRoot, [`jsonl:${vaultRelativePath}`], async () => {
    await assertVaultContained(vaultRoot, absolutePath);
    await appendSerializedJsonl(absolutePath, serialized);
  });
}

/**
 * Idempotent JSONL append for uniquely identified records. The existence check
 * and append share the same cross-process lock, so concurrent crash-recovery
 * workers cannot append the same transaction event twice.
 */
export async function appendJsonlObjectOnce(
  vaultRoot: string,
  vaultRelativePath: string,
  value: unknown,
  identityField: string,
): Promise<boolean> {
  const { object, serialized } = serializeJsonlObject(value);
  const identity = object[identityField];
  if (typeof identity !== "string" || !identity) {
    throw new TypeError(`jsonl_identity_field_missing: ${identityField}`);
  }
  const absolutePath = await resolveJsonlPath(vaultRoot, vaultRelativePath);

  return withVaultLocks(vaultRoot, [`jsonl:${vaultRelativePath}`], async () => {
    await assertVaultContained(vaultRoot, absolutePath);
    const current = await fs.readFile(absolutePath, "utf8").catch((error) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
      throw error;
    });
    for (const line of current.split("\n")) {
      if (!line.trim()) continue;
      let candidate: Record<string, unknown>;
      try {
        candidate = JSON.parse(line) as Record<string, unknown>;
      } catch {
        // Integrity validation reports malformed historical rows. They must not
        // make a recovery worker guess that a different identity already exists.
        continue;
      }
      if (candidate[identityField] === identity) {
        if (canonicalJson(candidate) !== canonicalJson(object)) {
          throw new Error(`jsonl_identity_conflict: ${identityField}=${identity}`);
        }
        // A prior process may have exposed the row but died before fsync.
        // Re-establish durability before recovery removes its only receipt.
        const handle = await fs.open(absolutePath, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fsyncDirectory(path.dirname(absolutePath));
        return false;
      }
    }
    await appendSerializedJsonl(absolutePath, serialized);
    return true;
  });
}
