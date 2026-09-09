import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POST as ingestMeeting } from "@/app/api/ingest/meeting/route";
import { POST as resolveJudgment } from "@/app/api/intervention/resolve/route";
import { POST as saveMeeting } from "@/app/api/meeting/save-transcript/route";
import { getTodaySnapshot } from "./today";

let vault = "";
const meetingId = "cap-beacon-launch-20260720";
const testNow = new Date("2026-07-20T12:00:00.000Z");

function jsonRequest(url: string, body: unknown): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const capture = {
  meetingId,
  slug: "beacon-launch-alignment",
  title: "Beacon launch alignment",
  summary: "The team set a launch date, assigned the revised plan, and raised a budget conflict.",
  attendees: "Alex, Sam",
  durationSec: 1800,
  transcript: `## Summary

Beacon launches August 1. Alex will send Sam the revised plan. The budget was corrected.

## Transcript

**Sam:** Beacon launches August 1. Alex, please send me the revised plan by July 24. The budget is $120k, not $100k.`,
  signals: {
    decisions: [{ id: "launch-date", text: "Beacon launches August 1", evidenceState: "reported" }],
    commitments: [
      {
        id: "revised-plan",
        text: "Send Sam the revised plan",
        owner: "Alex",
        due: "2026-07-24",
        evidenceState: "reported",
      },
    ],
    conflicts: [
      {
        id: "budget",
        subject: "Beacon budget",
        existingValue: "$100k",
        proposedValue: "$120k",
        question: "Which budget should Robin use for Beacon?",
      },
    ],
  },
};

describe.sequential("reviewed meeting chief-of-staff loop", () => {
  beforeAll(async () => {
    vault = await fs.mkdtemp(path.join(os.tmpdir(), "robin-meeting-loop-"));
    process.env.ROBIN_VAULT = vault;
    process.env.ROBIN_OWNER = "Alex";
    await fs.mkdir(path.join(vault, "brain", "projects"), { recursive: true });
    await fs.mkdir(path.join(vault, "logs"), { recursive: true });
    await fs.writeFile(path.join(vault, "logs", "ingest-log.md"), "# Ingest Log\n", "utf8");
    await fs.writeFile(path.join(vault, "logs", "changelog.md"), "# Changelog\n", "utf8");
    await fs.writeFile(
      path.join(vault, "brain", "projects", "beacon.html"),
      `<!doctype html>
<html><head><meta charset="utf-8"><title>Beacon</title>
<meta name="robin:path" content="brain/projects/beacon.html">
<meta name="robin:slug" content="beacon"><meta name="robin:type" content="project">
<meta name="robin:updated" content="2026-07-19T00:00:00Z">
</head><body><article data-robin-doc><h1 data-block="heading">Beacon</h1>
<p data-block="paragraph">Approved budget: $100k.</p></article></body></html>`,
      "utf8",
    );
  });

  afterAll(async () => {
    delete process.env.ROBIN_VAULT;
    delete process.env.ROBIN_OWNER;
    await fs.rm(vault, { recursive: true, force: true });
  });

  it("deduplicates concurrent capture and rejects a divergent replay", async () => {
    const responses = await Promise.all([
      saveMeeting(jsonRequest("http://robin.test/api/meeting/save-transcript", capture)),
      saveMeeting(jsonRequest("http://robin.test/api/meeting/save-transcript", capture)),
    ]);
    const bodies = await Promise.all(
      responses.map(
        (response) => response.json() as Promise<{ path: string; deduplicated: boolean }>,
      ),
    );
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(bodies.map((body) => body.deduplicated).sort()).toEqual([false, true]);
    expect(new Set(bodies.map((body) => body.path)).size).toBe(1);
    expect(await fs.readdir(path.join(vault, "inbox", "meetings"))).toHaveLength(1);

    const divergent = await saveMeeting(
      jsonRequest("http://robin.test/api/meeting/save-transcript", {
        ...capture,
        summary: "Changed after capture.",
      }),
    );
    expect(divergent.status).toBe(409);
  });

  it("compiles idempotently and projects one durable judgment into Today", async () => {
    const source = (await fs.readdir(path.join(vault, "inbox", "meetings")))[0];
    expect(source).toBeDefined();
    if (!source) throw new Error("meeting capture was not persisted");
    const sourcePath = `inbox/meetings/${source}`;
    const first = await ingestMeeting(
      jsonRequest("http://robin.test/api/ingest/meeting", { path: sourcePath }),
    );
    const firstBody = (await first.json()) as {
      compiled: {
        decisions: Array<{ path: string; written: boolean }>;
        commitments: Array<{ path: string; written: boolean }>;
        interventions: Array<{ path: string; written: boolean }>;
      };
    };
    expect(first.status).toBe(200);
    expect(firstBody.compiled.decisions).toHaveLength(1);
    expect(firstBody.compiled.commitments).toHaveLength(1);
    expect(firstBody.compiled.interventions).toHaveLength(1);

    const editDir = path.join(vault, "inbox", "robin", "edits");
    const editFile = (await fs.readdir(editDir))[0];
    expect(editFile).toBeDefined();
    if (!editFile) throw new Error("meeting ingest did not create an edit ledger");
    const editsBeforeReplay = (await fs.readFile(path.join(editDir, editFile), "utf8"))
      .trim()
      .split("\n").length;
    const replay = await ingestMeeting(
      jsonRequest("http://robin.test/api/ingest/meeting", { path: sourcePath }),
    );
    const replayBody = (await replay.json()) as typeof firstBody;
    expect(replay.status).toBe(200);
    expect(
      [
        ...replayBody.compiled.decisions,
        ...replayBody.compiled.commitments,
        ...replayBody.compiled.interventions,
      ].every((item) => !item.written),
    ).toBe(true);
    const editsAfterReplay = (await fs.readFile(path.join(editDir, editFile), "utf8"))
      .trim()
      .split("\n").length;
    expect(editsAfterReplay).toBe(editsBeforeReplay);

    const today = await getTodaySnapshot(testNow);
    expect(today.inbox).toEqual([]);
    expect(today.needsYou).toHaveLength(1);
    expect(today.overview.followThrough.watching).toHaveLength(1);
    expect(today.overview.followThrough.watching[0]).toMatchObject({
      statement: "Send Sam the revised plan",
      owner: "Alex",
      due: "2026-07-24",
    });
    expect(today.overview.followThrough.changes.some((change) => change.kind === "commitment-created")).toBe(
      true,
    );
    expect(today.needsYou[0]).toMatchObject({
      existingValue: "$100k",
      proposedValue: "$120k",
      targetTitle: "Beacon",
    });
  });

  it("persists explicit judgment, project history, and an empty Needs You state", async () => {
    const today = await getTodaySnapshot(testNow);
    const judgment = today.needsYou[0];
    expect(judgment).toBeDefined();
    if (!judgment) throw new Error("meeting conflict did not create a judgment");
    const response = await resolveJudgment(
      jsonRequest("http://robin.test/api/intervention/resolve", {
        path: judgment.path,
        resolution: "proposed",
      }),
    );
    const body = (await response.json()) as { alreadyResolved: boolean; targetUpdated: boolean };
    expect(response.status).toBe(200);
    expect(body).toMatchObject({ alreadyResolved: false, targetUpdated: true });
    expect(
      await fs.readFile(path.join(vault, "brain", "projects", "beacon.html"), "utf8"),
    ).toContain("$120k");
    const afterResolution = await getTodaySnapshot(testNow);
    expect(afterResolution.needsYou).toEqual([]);
    expect(
      afterResolution.overview.followThrough.changes.some(
        (change) => change.kind === "decision-confirmed" && change.summary.includes("$120k"),
      ),
    ).toBe(true);

    const replay = await resolveJudgment(
      jsonRequest("http://robin.test/api/intervention/resolve", {
        path: judgment.path,
        resolution: "proposed",
      }),
    );
    expect(await replay.json()).toMatchObject({ alreadyResolved: true, targetUpdated: false });
  });
});
