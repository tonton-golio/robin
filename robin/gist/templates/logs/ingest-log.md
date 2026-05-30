# Ingest log

Append-only record mapping `inbox/` sources to their derived `brain/` and `out/` outputs.

## Entry format

```markdown
## YYYY-MM-DDTHH:MM:SSZ — <classification> — <slug>
source: <inbox-path>
outputs: <comma-separated brain/out paths>
entities: <names mentioned and linked>
```

**Classifications:** `meeting` | `interview` | `strategy-doc` | `org-doc` | `technical-doc` | `communication-export` | `personal-notes` | `reference` | `annotations`.

---

<!-- New entries below. Newest at top. -->
