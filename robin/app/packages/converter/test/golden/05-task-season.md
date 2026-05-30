---
type: task
summary: "Add a `batch` tag on the shared-shelf photos so the most-recently-donated item's photo shows first when the shelf list syncs. A quick fix until the records can hold a real donation date."
status: open
priority: p2
due: 2026-06-30
owner: Casey Morgan
project: tool-library
category: shelf-photos
source: meeting
created: 2026-05-05
updated: 2026-05-05
tags: [task, beacon, photos, data-structure, proposal]
---

# Add batch tag to shared-shelf photos

**Goal**: The tool library's [[markers/photo-boards|Photo Boards]] writes shelf photos with a `batch` tag. On sync, the newest-batch photo moves to the front. No records change — a quick bridge, not a full donation-date overhaul.

**Why**: Volunteers keep pushing the newest donations' photos up by hand because the shelf order is by category, not by date. The `batch` tag is a quick bridge, not a records overhaul.

**Next action**: Casey Morgan folds the tag into the next photo-board pass. Coordinate with the shelf-list owner for the ordering at sync time.

**Notes**:
- Main value: the shelf shows what's actually on it now.
- Limitation accepted: a borrower browsing only the older shelves won't see a newer photo.

> Source: [[meetings/shelf-labels-and-category-mismatch]]
