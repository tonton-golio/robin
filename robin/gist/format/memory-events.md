# Memory events (`brain/memory/events.jsonl`)

`brain/memory/events.jsonl` is an append-only stream of compact recall events. It is **not** a database. It is **not** a replacement for canonical brain pages. It is a sidecar layer of small recall cues — preferences, corrections, dated facts, source-of-truth notes — that the agent consults early in retrieval.

This document is the schema reference. For the conceptual role of memory events, see [`../concepts/05-two-memory-layers.md`](../concepts/05-two-memory-layers.md).

## The file shape

One JSON object per line. No header. No trailing comma. Files are open-ended; new lines append at the end.

Three event kinds:

```jsonl
{"event":"memory.saved","memory":{...}}
{"event":"memory.seen","id":"…","seen_at":"…"}
{"event":"memory.resolved","id":"…","status":"…","resolved_at":"…","resolution":"…"}
```

## `memory.saved` — the primary event

Emitted when a new memory is captured.

```json
{
  "event": "memory.saved",
  "memory": {
    "id": "mem_20260528_eur-not-usd",
    "type": "preference",
    "tier": "semantic",
    "status": "active",
    "confidence": "high",
    "scope": "global",
    "subject": "Costs in EUR",
    "summary": "Always denominate costs in EUR, not USD. Convert at ~0.92 €/$ when sources give USD.",
    "body": "Optional longer narrative…",
    "tags": ["finance", "preference"],
    "links": ["brain/decisions/2026-05-04-currency-convention.html"],
    "sources": [
      {
        "kind": "conversation",
        "ref": "session-2026-05-28",
        "captured_at": "2026-05-28T14:32:00Z",
        "quote": "use EUR not USD when discussing costs"
      }
    ],
    "created_at": "2026-05-28T14:32:00Z",
    "updated_at": "2026-05-28T14:32:00Z",
    "last_seen_at": "2026-05-28T14:32:00Z",
    "seen_count": 1,
    "supersedes": [],
    "fingerprint": "sha256:…"
  }
}
```

### Memory fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `id` | string | yes | UUID or `mem_<YYYYMMDD>_<slug>`. Globally unique. |
| `type` | enum | yes | `preference` \| `correction` \| `decision` \| `pattern` \| `procedure` \| `project` \| `person` \| `repo` \| `task` \| `other`. |
| `tier` | enum | yes | `working` \| `episodic` \| `semantic` \| `procedural`. |
| `status` | enum | yes | `tentative` \| `active` \| `superseded` \| `rejected` \| `archived`. New memories default to `active`. |
| `confidence` | enum | no | `low` \| `medium` \| `high`. Optional. |
| `scope` | string | yes | `global` \| `brain/<path>` \| `project:<slug>` \| `repo:<slug>`. |
| `subject` | string | yes | Short identifier. Surfaced in search. |
| `summary` | string | yes | 1–2 sentences. Used as the primary recall surface. |
| `body` | string | no | Longer narrative if needed. |
| `tags` | string[] | no | Keyword array. |
| `links` | string[] | no | Vault-relative paths to related brain pages. |
| `sources` | object[] | yes | Provenance array. See below. |
| `created_at` | ISO-8601 UTC | yes | Set on first emit. |
| `updated_at` | ISO-8601 UTC | yes | Bumped on any change. |
| `last_seen_at` | ISO-8601 UTC | no | Updated on `memory.seen` events. |
| `seen_count` | integer | no | Increment on duplicate-merge or `memory.seen`. |
| `supersedes` | string[] | no | Array of prior memory IDs this replaces. |
| `fingerprint` | string | no | Deterministic hash for deduplication. |

### Sources sub-shape

```json
{
  "kind": "manual" | "annotation" | "conversation" | "meeting" | "tool" | "repo",
  "ref": "session-2026-05-28" | "inbox/meetings/…" | "repos/<repo>/path/to/file:42",
  "captured_at": "2026-05-28T14:32:00Z",
  "quote": "optional verbatim excerpt"
}
```

## Tier semantics

| Tier | What goes here |
|---|---|
| `working` | Observations from the current session. May not survive long. |
| `episodic` | Session summaries. "On 2026-05-28 we decided X." |
| `semantic` | Facts, preferences, decisions. "We use EUR." "Always commit to main here." |
| `procedural` | Workflows, rules, calibrations. "When deploying X, do Y." |

Most durable memories are `semantic` or `procedural`. `working` and `episodic` are short-lived; `/remsleep` often archives them or promotes them.

## Status lifecycle

```
tentative → active → superseded
                  ↘ rejected
                  ↘ archived
```

- **`tentative`** — captured but not yet validated. Useful for "I think we agreed X but check."
- **`active`** — current. The default.
- **`superseded`** — replaced by a later memory. The `supersedes` array on the new memory links back.
- **`rejected`** — captured but proven wrong. Kept for history.
- **`archived`** — no longer relevant. Kept for history.

## `memory.seen` — touch event

Emitted when the agent reads / matches against an existing memory.

```json
{"event":"memory.seen","id":"mem_20260528_eur-not-usd","seen_at":"2026-05-29T09:14:00Z"}
```

Useful for decay tracking: stale, never-touched memories are candidates for archival.

## `memory.resolved` — lifecycle change

Emitted when a memory's status changes (e.g., when a tentative memory is confirmed, or an active one is rejected).

```json
{
  "event": "memory.resolved",
  "id": "mem_20260528_eur-not-usd",
  "status": "superseded",
  "resolved_at": "2026-06-10T11:00:00Z",
  "resolution": "Updated convention now uses GBP for UK customers; see new memory mem_20260610_gbp-for-uk."
}
```

## Deduplication

Before writing a new memory, compute a fingerprint over normalized content (subject + summary + scope + type). If a memory with the same fingerprint already exists:

- If `merge: true` is set on the save call, increment `seen_count` and update `last_seen_at` on the existing memory instead of appending a duplicate.
- Otherwise, append the duplicate (deliberate over-capture, accepted noise).

## What goes here (and what does not)

**Goes here:**

- "Use EUR for cost discussions." (preference, semantic)
- "The translation channel is `#proj-translations` not `#translation`." (correction, semantic)
- "Tasks page status may drift behind code; verify against the repo." (procedural)
- "Stakeholder X prefers Loom recordings over written docs." (preference, semantic)
- "Last week's outage was caused by a missing env var, not the deploy itself." (correction, episodic → semantic over time)

**Does NOT go here:**

- A new person's bio. → `brain/people/<bucket>/<slug>.html`
- A 4-paragraph explanation of how the deploy pipeline works. → `brain/playbooks/<slug>.html`
- A new active project. → `brain/projects/<slug>/`
- A code change. → the code, plus optional `brain/repos/<repo>.html` note.

**Rule of thumb:** if it fits in two sentences and is a recall cue, it's a memory event. If it needs more, it's a page.

## Authoring memory events

Most memory events are written by skills (`/learn`, `/ingest-source`, `/ingest-meeting`) via the MCP `memory.save` tool. You rarely hand-write JSONL.

If you do write by hand:

1. Compute a unique `id`.
2. Set `created_at`, `updated_at`, `last_seen_at` to the current ISO-8601 UTC.
3. Provide at least one `source` with `kind: "manual"`.
4. Append a single line to `brain/memory/events.jsonl`. Never modify existing lines.

## Pruning

Memory events accumulate. Over time you'll have hundreds.

Periodic curation (typically done by `/remsleep` weekly):

- Memories with `status: archived` older than 90 days can move to a separate archive file (`brain/memory/events-archive.jsonl`) to keep the active file lean. Append, never delete.
- `superseded` memories stay forever — the supersession chain is the audit trail.
- Duplicate detection over time should consolidate near-duplicates by merging `seen_count`.

## A small example file

```jsonl
{"event":"memory.saved","memory":{"id":"mem_20260101_main-not-branches","type":"procedure","tier":"procedural","status":"active","scope":"repo:second-brain","subject":"Work on main in this repo","summary":"In this repo, commit directly to main. No feature branches.","sources":[{"kind":"manual","ref":"setup","captured_at":"2026-01-01T10:00:00Z"}],"created_at":"2026-01-01T10:00:00Z","updated_at":"2026-01-01T10:00:00Z","last_seen_at":"2026-01-01T10:00:00Z","seen_count":1,"fingerprint":"sha256:abc…"}}
{"event":"memory.saved","memory":{"id":"mem_20260203_eur-costs","type":"preference","tier":"semantic","status":"active","scope":"global","subject":"Costs in EUR","summary":"Use EUR (not USD) when discussing costs.","sources":[{"kind":"conversation","ref":"session-2026-02-03","captured_at":"2026-02-03T14:00:00Z"}],"created_at":"2026-02-03T14:00:00Z","updated_at":"2026-02-03T14:00:00Z","last_seen_at":"2026-02-03T14:00:00Z","seen_count":1,"fingerprint":"sha256:def…"}}
{"event":"memory.seen","id":"mem_20260203_eur-costs","seen_at":"2026-02-15T09:30:00Z"}
```

See also:

- [`page-format.md`](./page-format.md) — page-level format.
- [`../concepts/05-two-memory-layers.md`](../concepts/05-two-memory-layers.md) — when to use memory events vs. pages vs. auto-memory.
