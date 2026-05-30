# Report template

Used by `/check-calendar`, `/check-slack`, `/check-email`, `/check-tasks`, and any skill that surfaces a compact daily report.

The goal is consistent shape across skills so the user can scan output quickly.

## Section shape

```markdown
### <Topic>

<Optional 1-line context.>

**Needs response (N)** *(if any)*
- (Item) — `[link or context]`
- (Item) — `[link or context]`

**Wiki gaps (N)** *(if any)*
- (Item) — `[what to capture]`

**FYI / important** *(optional)*
- (Item)

**Filtered** *(optional)*
N noise items skipped.
```

## Conventions

- **Topic heading** uses `###` (level 3). This nests cleanly inside a parent skill's report.
- **Counts in parens.** "Needs response (3)" lets the user gauge size before reading.
- **Empty sections collapse.** If there are zero needs-response items, omit the section entirely.
- **Wiki gaps section** is for things the agent noticed should be captured durably but hasn't yet. The user can decide to follow up.
- **Filtered count.** Don't enumerate noise; just count it.

## Example output (a `/check-email` run)

```markdown
### Email

**Needs response (2)**
- [Alex] Q3 capacity check — wants headcount estimate by Thursday.
- [Pat] CMS migration question — blocked on credentials.

**Wiki gaps (1)**
- New vendor "Acme CDN" mentioned in Sam's note — no brain page yet.

**Filtered** 14 noise items skipped (newsletters, calendar invites, automation).
```

## Multi-topic composition

When `/morning-brief` orchestrates multiple sub-skills, each emits a section using the template, then they compose:

```markdown
## Morning brief — 2026-05-28

### Schedule
...

### Tasks
...

### Email
...

### Slack
...

### Reflection
...
```

Each section is self-contained and short. The brief stays under 50 lines.

## What NOT to include

- Long quotes. Summaries, not transcripts.
- Pagination summaries. ("Scanned 200 messages.") Count noise; don't narrate scan effort.
- Hedging. "I think this might need a response." If unsure, mark it FYI; if sure, mark it Needs response.
- Bot output verbatim. Filter or summarize.
