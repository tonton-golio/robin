import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appendJsonlObject,
  appendJsonlObjectOnce,
  durableCopyNew,
  hashHtml,
  listPendingMutations,
  recoverPendingMutations,
  VaultConflictError,
  withVaultLocks,
  writeWithHistory,
} from "../src/index.js";

function editEvent(input: {
  id: string;
  event?: "edit.saved" | "edit.moved";
  targetPath: string;
  sourcePath?: string;
  afterHash: string;
}) {
  const ts = "2026-07-25T10:00:00.000Z";
  return {
    id: input.id,
    event: input.event ?? "edit.saved",
    page_path: input.targetPath,
    ...(input.sourcePath ? { previous_path: input.sourcePath } : {}),
    ts,
    origin: "cli" as const,
    before_hash: hashHtml("<p>before</p>"),
    after_hash: input.afterHash,
    status: "open",
    schema_version: 2,
    kind: "brain",
    transaction_id: input.id,
    snapshot: ".history/brain/source.html/prior.html",
  };
}

describe("durable, coordinated writes", () => {
  let vault: string;

  beforeEach(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-durability-"));
    await fs.mkdir(path.join(vault, "brain"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(vault, { recursive: true, force: true });
  });

  it("enforces compare-and-swap and leaves newer bytes untouched", async () => {
    const target = path.join(vault, "brain", "page.html");
    await writeWithHistory({
      absolutePath: target,
      html: "<p>current</p>",
      vaultRoot: vault,
    });

    await expect(
      writeWithHistory({
        absolutePath: target,
        html: "<p>stale writer</p>",
        vaultRoot: vault,
        expectedHash: hashHtml("<p>older</p>"),
      }),
    ).rejects.toBeInstanceOf(VaultConflictError);

    expect(await fs.readFile(target, "utf8")).toBe("<p>current</p>");
  });

  it("supports create-only CAS with expectedHash=null", async () => {
    const target = path.join(vault, "brain", "new.html");
    await expect(
      writeWithHistory({
        absolutePath: target,
        html: "<p>new</p>",
        vaultRoot: vault,
        expectedHash: null,
      }),
    ).resolves.toMatchObject({ written: true });

    await expect(
      writeWithHistory({
        absolutePath: target,
        html: "<p>replacement</p>",
        vaultRoot: vault,
        expectedHash: null,
      }),
    ).rejects.toBeInstanceOf(VaultConflictError);
  });

  it("rejects lifecycle-only event kinds at the normal write boundary", async () => {
    const target = path.join(vault, "brain", "invalid-event.html");
    await expect(
      writeWithHistory({
        absolutePath: target,
        html: "<p>must not be labeled as deleted</p>",
        vaultRoot: vault,
        eventKind: "edit.deleted" as never,
      }),
    ).rejects.toThrow(/invalid_write_event_kind/);
    await expect(fs.access(target)).rejects.toThrow();
  });

  it("repairs a missing trailing newline and keeps concurrent JSONL rows distinct", async () => {
    const relative = "inbox/robin/test/events.jsonl";
    const absolute = path.join(vault, ...relative.split("/"));
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, JSON.stringify({ id: "legacy" }), "utf8");

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        appendJsonlObject(vault, relative, { id: `event-${index}` }),
      ),
    );

    const rows = (await fs.readFile(absolute, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { id: string });
    expect(rows).toHaveLength(21);
    expect(new Set(rows.map((row) => row.id)).size).toBe(21);
  });

  it("atomically suppresses duplicate identified events across concurrent appenders", async () => {
    const relative = "inbox/robin/edits/2026-07.jsonl";
    const outcomes = await Promise.all(
      Array.from({ length: 12 }, () =>
        appendJsonlObjectOnce(vault, relative, { id: "edit-once", event: "edit.saved" }, "id"),
      ),
    );

    expect(outcomes.filter(Boolean)).toHaveLength(1);
    const rows = (await fs.readFile(path.join(vault, ...relative.split("/")), "utf8"))
      .trim()
      .split("\n");
    expect(rows).toHaveLength(1);
  });

  it("rejects a duplicate JSONL identity with a different payload", async () => {
    const relative = "inbox/robin/edits/2026-07.jsonl";
    await appendJsonlObjectOnce(
      vault,
      relative,
      { id: "immutable-event", event: "edit.saved" },
      "id",
    );
    await expect(
      appendJsonlObjectOnce(
        vault,
        relative,
        { id: "immutable-event", event: "edit.deleted" },
        "id",
      ),
    ).rejects.toThrow(/jsonl_identity_conflict/);
  });

  it("removes the recovery receipt after a fully successful write", async () => {
    await writeWithHistory({
      absolutePath: path.join(vault, "brain", "page.html"),
      html: "<p>complete</p>",
      vaultRoot: vault,
    });
    expect(await listPendingMutations(vault)).toEqual([]);
  });

  it("keeps a receipt when canonical bytes commit but the event append fails", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "robin-events-outside-"));
    try {
      await fs.mkdir(path.join(vault, "inbox", "robin"), { recursive: true });
      await fs.symlink(outside, path.join(vault, "inbox", "robin", "edits"), "dir");
      const target = path.join(vault, "brain", "page.html");

      await expect(
        writeWithHistory({
          absolutePath: target,
          html: "<p>visible</p>",
          vaultRoot: vault,
        }),
      ).rejects.toThrow(/vault_path_(?:escape|symlink)/);

      expect(await fs.readFile(target, "utf8")).toBe("<p>visible</p>");
      const pending = await listPendingMutations(vault);
      expect(pending).toHaveLength(1);
      expect(pending[0]?.receipt?.operation).toBe("write");
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("recovers a committed write by finalizing its missing audit event", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "robin-recovery-outside-"));
    const editsLink = path.join(vault, "inbox", "robin", "edits");
    try {
      await fs.mkdir(path.dirname(editsLink), { recursive: true });
      await fs.symlink(outside, editsLink, "dir");
      const target = path.join(vault, "brain", "recover.html");

      await expect(
        writeWithHistory({
          absolutePath: target,
          html: "<p>committed</p>",
          vaultRoot: vault,
        }),
      ).rejects.toThrow(/vault_path_(?:escape|symlink)/);
      await fs.unlink(editsLink);

      const inspection = await recoverPendingMutations(vault);
      expect(inspection).toHaveLength(1);
      expect(inspection[0]?.status).toBe("ready");

      const repaired = await recoverPendingMutations(vault, { repair: true });
      expect(repaired[0]?.status).toBe("recovered");
      expect(await listPendingMutations(vault)).toEqual([]);
      const eventFile = path.join(
        vault,
        "inbox",
        "robin",
        "edits",
        `${new Date().toISOString().slice(0, 7)}.jsonl`,
      );
      expect((await fs.readFile(eventFile, "utf8")).trim().split("\n")).toHaveLength(1);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("refuses to append through a JSONL symlink that escapes the vault", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "robin-jsonl-outside-"));
    try {
      const outsideFile = path.join(outside, "events.jsonl");
      await fs.writeFile(outsideFile, '{"id":"outside"}\n', "utf8");
      const insideDir = path.join(vault, "inbox", "robin");
      await fs.mkdir(insideDir, { recursive: true });
      await fs.symlink(outsideFile, path.join(insideDir, "events.jsonl"));

      await expect(
        appendJsonlObject(vault, "inbox/robin/events.jsonl", { id: "escape" }),
      ).rejects.toThrow(/vault_path_(?:escape|symlink)/);
      expect(await fs.readFile(outsideFile, "utf8")).toBe('{"id":"outside"}\n');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects an in-vault symlink alias so one inode cannot get two lock keys", async () => {
    const realDirectory = path.join(vault, "brain", "real");
    await fs.mkdir(realDirectory, { recursive: true });
    await fs.symlink(realDirectory, path.join(vault, "brain", "alias"), "dir");

    await expect(
      writeWithHistory({
        absolutePath: path.join(vault, "brain", "alias", "page.html"),
        html: "<p>aliased</p>",
        vaultRoot: vault,
      }),
    ).rejects.toThrow(/vault_path_symlink/);
    await expect(fs.access(path.join(realDirectory, "page.html"))).rejects.toThrow();
  });

  it("enforces immutable v0.3 identity at the shared write boundary", async () => {
    const target = path.join(vault, "brain", "identity.html");
    const page = (id: string, version = "0.3") =>
      `<!doctype html><html><head><meta name="robin:version" content="${version}">` +
      `<meta name="robin:id" content="${id}"></head>` +
      `<body><article data-robin-doc><p>${id}</p></article></body></html>`;
    const firstId = "6c8ecb66-1f08-5eb0-b8b8-43c2e9db8c5b";
    const replacementId = "54a57ea5-e5c6-5e8b-aab7-6e73e3b8e1bf";
    await writeWithHistory({
      absolutePath: target,
      html: page(firstId),
      vaultRoot: vault,
      expectedHash: null,
    });

    await expect(
      writeWithHistory({
        absolutePath: target,
        html: page(replacementId),
        vaultRoot: vault,
      }),
    ).rejects.toThrow(/robin_identity_conflict/);
    await expect(
      writeWithHistory({
        absolutePath: target,
        html: page(firstId, "0.2"),
        vaultRoot: vault,
      }),
    ).rejects.toThrow(/requires version 0.3|cannot be downgraded/);

    await fs.writeFile(target, page(firstId, "0.4"));
    const validV02 = page(firstId, "0.2").replace(
      `<meta name="robin:id" content="${firstId}">`,
      "",
    );
    await expect(
      writeWithHistory({
        absolutePath: target,
        html: validV02,
        vaultRoot: vault,
      }),
    ).rejects.toThrow(/cannot rewrite unsupported prior robin:version 0\.4/);
  });

  it("does not treat body metadata as canonical v0.3 identity", async () => {
    const target = path.join(vault, "brain", "body-meta.html");
    const page =
      "<!doctype html><html><head>" +
      '<meta name="robin:version" content="0.2"></head><body>' +
      '<article data-robin-doc><meta name="robin:version" content="0.3">' +
      '<meta name="robin:id" content="00000000-0000-5000-8000-000000000000">' +
      "</article></body></html>";
    await expect(
      writeWithHistory({
        absolutePath: target,
        html: page,
        vaultRoot: vault,
        expectedHash: null,
      }),
    ).resolves.toMatchObject({ written: true });
  });

  it("does not steal an old-looking lock owned by a live process", async () => {
    const relative = "inbox/robin/test/events.jsonl";
    const key = `jsonl:${relative}`;
    const lockName = createHash("sha256").update(key).digest("hex");
    const lockPath = path.join(vault, ".robin", "locks", `${lockName}.lock`);
    await fs.mkdir(lockPath, { recursive: true });
    await fs.writeFile(
      path.join(lockPath, "owner.json"),
      `${JSON.stringify({ pid: process.pid, token: randomUUID() })}\n`,
      "utf8",
    );
    const staleTime = new Date(Date.now() - 60_000);
    await fs.utimes(lockPath, staleTime, staleTime);

    await expect(
      withVaultLocks(vault, [key], () => Promise.resolve(), { timeoutMs: 40, staleAfterMs: 1 }),
    ).rejects.toThrow(/vault_lock_timeout/);
  });

  it("normalizes canonically equivalent Unicode lock keys", async () => {
    let active = 0;
    let maximumActive = 0;
    const run = (key: string) =>
      withVaultLocks(vault, [key], async () => {
        active += 1;
        maximumActive = Math.max(maximumActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      });

    await Promise.all([run("page:brain/café.html"), run("page:brain/cafe\u0301.html")]);
    expect(maximumActive).toBe(1);
  });

  it("treats a receipt whose filename and transaction id disagree as invalid", async () => {
    const receiptId = randomUUID();
    const differentId = randomUUID();
    const targetPath = "brain/recover.html";
    const html = "<p>committed</p>";
    await fs.writeFile(path.join(vault, targetPath), html, "utf8");
    const transactions = path.join(vault, ".robin", "transactions");
    await fs.mkdir(transactions, { recursive: true });
    const event = editEvent({
      id: differentId,
      targetPath,
      afterHash: hashHtml(html),
    });
    await fs.writeFile(
      path.join(transactions, `${receiptId}.json`),
      `${JSON.stringify({
        schema_version: 1,
        transaction_id: differentId,
        operation: "write",
        created_at: event.ts,
        target_path: targetPath,
        event,
      })}\n`,
      "utf8",
    );

    const result = await recoverPendingMutations(vault, { repair: true });
    expect(result).toMatchObject([{ transactionId: receiptId, status: "invalid" }]);
    await expect(fs.access(path.join(transactions, `${receiptId}.json`))).resolves.toBeUndefined();
  });

  it("rejects non-canonical receipt UUIDs and impossible calendar timestamps", async () => {
    const transactions = path.join(vault, ".robin", "transactions");
    await fs.mkdir(transactions, { recursive: true });
    const cases = [
      {
        id: "123E4567-E89B-42D3-A456-426614174000",
        createdAt: "2026-07-25T10:00:00Z",
      },
      {
        id: randomUUID(),
        createdAt: "2026-02-30T10:00:00Z",
      },
    ];
    for (const { id, createdAt } of cases) {
      const event = {
        ...editEvent({
          id,
          targetPath: "brain/recover.html",
          afterHash: hashHtml("<p>committed</p>"),
        }),
        ts: createdAt,
      };
      await fs.writeFile(
        path.join(transactions, `${id}.json`),
        `${JSON.stringify({
          schema_version: 1,
          transaction_id: id,
          operation: "write",
          created_at: createdAt,
          target_path: "brain/recover.html",
          event,
        })}\n`,
        "utf8",
      );
    }

    const results = await recoverPendingMutations(vault, { repair: true });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "invalid")).toBe(true);
  });

  it("will not finalize a move receipt while the original source still exists", async () => {
    const id = randomUUID();
    const sourcePath = "brain/source.html";
    const targetPath = "brain/target.html";
    const html = "<p>same bytes</p>";
    await fs.writeFile(path.join(vault, sourcePath), html, "utf8");
    await fs.writeFile(path.join(vault, targetPath), html, "utf8");
    const snapshot = path.join(vault, ".history", "brain", "source.html", "prior.html");
    await fs.mkdir(path.dirname(snapshot), { recursive: true });
    await fs.writeFile(snapshot, "<p>before</p>", "utf8");
    const transactions = path.join(vault, ".robin", "transactions");
    await fs.mkdir(transactions, { recursive: true });
    const event = editEvent({
      id,
      event: "edit.moved",
      targetPath,
      sourcePath,
      afterHash: hashHtml(html),
    });
    await fs.writeFile(
      path.join(transactions, `${id}.json`),
      `${JSON.stringify({
        schema_version: 1,
        transaction_id: id,
        operation: "move",
        created_at: event.ts,
        target_path: targetPath,
        source_path: sourcePath,
        event,
      })}\n`,
      "utf8",
    );

    const result = await recoverPendingMutations(vault, { repair: true });
    expect(result).toMatchObject([{ transactionId: id, status: "incomplete" }]);
    await expect(fs.access(path.join(transactions, `${id}.json`))).resolves.toBeUndefined();
  });

  it("will not clear a receipt when its event id has a different ledger payload", async () => {
    const id = randomUUID();
    const targetPath = "brain/recover.html";
    const html = "<p>committed</p>";
    await fs.writeFile(path.join(vault, targetPath), html, "utf8");
    const snapshot = path.join(vault, ".history", "brain", "recover.html", "prior.html");
    await fs.mkdir(path.dirname(snapshot), { recursive: true });
    await fs.writeFile(snapshot, "<p>before</p>", "utf8");
    const transactions = path.join(vault, ".robin", "transactions");
    await fs.mkdir(transactions, { recursive: true });
    const event = editEvent({ id, targetPath, afterHash: hashHtml(html) });
    await fs.writeFile(
      path.join(transactions, `${id}.json`),
      `${JSON.stringify({
        schema_version: 1,
        transaction_id: id,
        operation: "write",
        created_at: event.ts,
        target_path: targetPath,
        event,
      })}\n`,
      "utf8",
    );
    const ledger = path.join(vault, "inbox", "robin", "edits", "2026-07.jsonl");
    await fs.mkdir(path.dirname(ledger), { recursive: true });
    await fs.writeFile(ledger, `${JSON.stringify({ ...event, summary: "other payload" })}\n`);

    expect(await recoverPendingMutations(vault)).toMatchObject([{ status: "invalid" }]);
    expect(await recoverPendingMutations(vault, { repair: true })).toMatchObject([
      { status: "invalid" },
    ]);
    await expect(fs.access(path.join(transactions, `${id}.json`))).resolves.toBeUndefined();
  });

  it("re-proves canonical bytes before clearing a receipt whose event already exists", async () => {
    const id = randomUUID();
    const targetPath = "brain/recover.html";
    const intended = "<p>intended</p>";
    await fs.writeFile(path.join(vault, targetPath), "<p>diverged</p>", "utf8");
    const snapshot = path.join(vault, ".history", "brain", "source.html", "prior.html");
    await fs.mkdir(path.dirname(snapshot), { recursive: true });
    await fs.writeFile(snapshot, "<p>before</p>", "utf8");
    const transactions = path.join(vault, ".robin", "transactions");
    await fs.mkdir(transactions, { recursive: true });
    const event = editEvent({ id, targetPath, afterHash: hashHtml(intended) });
    await fs.writeFile(
      path.join(transactions, `${id}.json`),
      `${JSON.stringify({
        schema_version: 1,
        transaction_id: id,
        operation: "write",
        created_at: event.ts,
        target_path: targetPath,
        event,
      })}\n`,
      "utf8",
    );
    const ledger = path.join(vault, "inbox", "robin", "edits", "2026-07.jsonl");
    await fs.mkdir(path.dirname(ledger), { recursive: true });
    await fs.writeFile(ledger, `${JSON.stringify(event)}\n`, "utf8");

    expect(await recoverPendingMutations(vault, { repair: true })).toMatchObject([
      { status: "incomplete" },
    ]);
    await expect(fs.access(path.join(transactions, `${id}.json`))).resolves.toBeUndefined();
  });

  it("refuses to repair overlapping valid receipts", async () => {
    const ids = [randomUUID(), randomUUID()];
    const targetPath = "brain/shared.html";
    const html = "<p>shared</p>";
    await fs.writeFile(path.join(vault, targetPath), html, "utf8");
    const snapshot = path.join(vault, ".history", "brain", "source.html", "prior.html");
    await fs.mkdir(path.dirname(snapshot), { recursive: true });
    await fs.writeFile(snapshot, "<p>before</p>", "utf8");
    const transactions = path.join(vault, ".robin", "transactions");
    await fs.mkdir(transactions, { recursive: true });
    for (const id of ids) {
      const event = editEvent({ id, targetPath, afterHash: hashHtml(html) });
      await fs.writeFile(
        path.join(transactions, `${id}.json`),
        `${JSON.stringify({
          schema_version: 1,
          transaction_id: id,
          operation: "write",
          created_at: event.ts,
          target_path: targetPath,
          event,
        })}\n`,
        "utf8",
      );
    }

    const results = await recoverPendingMutations(vault, { repair: true });
    expect(results).toHaveLength(2);
    expect(results.every((result) => result.status === "invalid")).toBe(true);
    expect(results.every((result) => result.detail.includes(targetPath))).toBe(true);
    for (const id of ids) {
      await expect(fs.access(path.join(transactions, `${id}.json`))).resolves.toBeUndefined();
    }
  });

  it("supports nested re-entrant path locks for multi-page workflows", async () => {
    const calls: string[] = [];
    await withVaultLocks(vault, ["page:brain/a.html", "page:brain/b.html"], async () => {
      calls.push("outer");
      await withVaultLocks(vault, ["page:brain/a.html"], async () => {
        calls.push("inner");
      });
    });
    expect(calls).toEqual(["outer", "inner"]);
  });

  it("durably copies binary data to a create-only destination", async () => {
    const source = path.join(vault, "source.bin");
    const destination = path.join(vault, "inbox", "audio", "capture.bin");
    await fs.writeFile(source, Buffer.from([0, 1, 2, 255]));

    await durableCopyNew(source, destination);
    expect(await fs.readFile(destination)).toEqual(Buffer.from([0, 1, 2, 255]));

    await fs.writeFile(source, Buffer.from([9]));
    await expect(durableCopyNew(source, destination)).rejects.toMatchObject({ code: "EEXIST" });
    expect(await fs.readFile(destination)).toEqual(Buffer.from([0, 1, 2, 255]));
  });
});
