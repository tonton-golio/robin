---
title: Seed exchange
type: project
status: active
tags: [synthetic, garden]
---

# Seed exchange

Synthetic project fixture for a fictional community garden.

## Goal

Arrange a table where visitors can exchange spare seed packets.

| Item | Planned | Ready |
| --- | ---: | ---: |
| Trays | 3 | 2 |
| Blank labels | 12 | 12 |

### Setup

- Use a covered table.
- Sort packets by plant type.
  - Flowers on the left.
  - Herbs on the right.

Track preparation in [[05-task-season]]. Use `packet_count` for the sample inventory field.

```json
{"tray": "herbs", "packets": 4}
```

## Sample plant cards

- [[rosemary]]
- [[basil]]
- [[thyme]]
- [[sage]]
- [[mint]]
- [[parsley]]
- [[dill]]
- [[chives]]
- [[marigold]]
- [[cosmos]]
- [[sunflower]]
- [[nasturtium]]
