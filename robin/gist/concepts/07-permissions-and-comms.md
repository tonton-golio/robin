# 07 — Permissions, communications, and trust calibration

An agent that has your knowledge base and your communication channels can do a lot. Some of that is exactly what you want; some of it is *not what you want, ever*. This document is about getting that boundary right.

## The two communication modes

Robin operates under **two modes** for outbound communication (Slack, email, posting anywhere humans will read it):

### Mode 1: draft-first (default)

**Triggered by:** "help me draft", "write something I can send to X", "how should I word this?", and any phrasing where the action is *deciding what to say*.

**Procedure:**

1. Write a draft.
2. Show it to you.
3. **Wait.**
4. Send only on explicit "send it" / "go ahead" / "yes, post."

Draft-first is conservative. The cost is one extra round trip. The benefit is you never ship something the agent inferred wrongly.

### Mode 2: autonomous

**Triggered by:** imperative verbs that name an outcome: "send", "post", "ping", "reply", "tell", "invite", "give X an answer."

**Procedure:**

1. Synthesize from context.
2. Send directly.
3. Report what was sent.

Autonomous mode is faster. You trust the agent to compose well. The check is the post-send report — you can read what went out and correct course on the next message.

### The choice

The agent must pick a mode from your phrasing alone. The rule:

- **Ambiguous phrasing → draft-first.** "Can you message X about Y?" is ambiguous. Default to drafting.
- **Imperative phrasing → autonomous.** "Send X a note about Y" is imperative. Send directly.

You can promote a draft-first request to autonomous with "go ahead and send it." You can demote an autonomous request with "wait, show me first."

## The never-send-autonomously list

Some recipients always require draft-first, regardless of phrasing. Configure this in `.claude/constitution/communications.md`:

```markdown
## Never send autonomously to:
- {{MANAGER_NAME}}                  # always draft-first
- The board                          # always draft-first
- Hiring candidates                  # always draft-first
- Customers (define "customer")      # always draft-first
```

The list is *yours*. Pick recipients where a misfire costs you more than the speed of autonomous mode is worth.

## The signature line

Every outbound message ends with a consistent signature:

```
— {{AGENT_NAME}} ({{USER_NAME}}'s agent)
```

On its own line. Preceded by a blank line. No variations.

This is important. It makes it **unambiguous** whether you or the agent pressed send. The recipient knows. Trust accrues over time as recipients see that the agent's outputs are competent — but only if they can tell the difference.

When you write a message yourself (without the agent), do not use the signature. When the agent writes, the signature is mandatory.

## Typo and tone discipline

When sending on your behalf:

- **Fix obvious typos silently.** "teh" → "the". Don't ask.
- **Preserve your voice.** If you usually use lowercase Slack messages, keep it. If you cap sentences, cap them. Match.
- **Don't editorialize.** If you said "I'm not sure about this", don't make it "I have some concerns about this." Tone shifts feel like put-on-words to the recipient.
- **Flag cleanup in the post-send report** (autonomous mode) or show the cleaned version (draft-first). You should know what's been changed before it ships.

## The post-send report

After sending (autonomous mode), the agent reports:

- **Channel / recipient.**
- **One-line summary** of what was sent.
- **Cleanup applied** (any typos, tone fixes, redactions).

A good post-send report fits on one screen. It exists so you can spot-check without re-reading the full message.

## Permissions beyond communications

The same trust calibration applies to other side effects:

| Action | Default | Notes |
|---|---|---|
| **Reading any file in the repo** | Always allowed | The brain is for reading. |
| **Writing to `brain/`, `out/`, `logs/`** | Always allowed | These are durable surfaces the agent owns. |
| **Writing to `inbox/`** | Never | Inbox is immutable. |
| **Writing to `.claude/constitution/`** | Confirm first | The agent should not silently rewrite its own law. |
| **Deleting any file** | Confirm first; prefer archive | Use `mv <target> archive/`, not `rm -rf`. |
| **Running shell commands with side effects** | Confirm first | Includes `git push`, `npm publish`, deployment commands. |
| **Sending email/Slack** | See modes above | |
| **Calling external APIs that incur cost** | Confirm first | |

The principle: **looking is free; acting is gated.** Robin reads aggressively. Robin acts deliberately.

## Constitution as trust calibration

The constitution is where you encode trust calibrations that have become stable. Examples that real users add:

- "Don't propose architecture changes unless I ask."
- "Always check Slack before emailing."
- "When committing in this repo, no need to ask first."
- "Don't message anyone after 19:00 my time."

If you find yourself correcting the agent's behavior more than twice on the same thing, **the correction belongs in the constitution.** Not in chat. Not in auto-memory. The constitution is the place where running rules live.

## What the agent should refuse

A well-calibrated agent says no when asked to:

- Send a message it thinks you'll regret (the trigger word: "irreversible").
- Delete brain pages without archiving first.
- Modify `.claude/constitution/` silently.
- Bypass the never-send-autonomously list.
- Run destructive shell commands without confirmation.

The refusal isn't an alarm — it's a pause. "Want me to draft this first?" "Sure I should delete instead of archive?" Most pauses become "yes, do it" or "no, you're right." A few become "good catch, let's reconsider."

## When trust breaks

Sometimes the agent ships the wrong thing. Possible causes:

1. **The constitution was unclear.** Edit it. Specify the case. Future sessions improve.
2. **The agent inferred wrongly from your phrasing.** Recalibrate by tightening the trigger words list in `communications.md`.
3. **You don't actually want this level of automation in this domain.** Move that domain to draft-first by default in `communications.md`.

Trust is a *negotiation*. It is supposed to evolve. The system is designed to make that evolution cheap — edit a Markdown file, start a new session, the agent adapts.

## What this means in practice

- Start conservative. Most communications draft-first. Few autonomous triggers.
- Loosen as trust grows. After a month of clean autonomous sends in low-stakes channels, expand.
- Keep the never-send-autonomously list short but uncompromising. The list is for recipients where a mistake is asymmetric — losing a candidate, embarrassing yourself with a board member, undermining a manager.
- Sign every agent message. The signature is honesty.
- Treat the constitution as living trust calibration. Update it when you correct the agent. The agent re-reads it next session.

This concludes the concepts. Read the [`format/`](../format/) folder next for the strict contract specs, or jump to [`templates/`](../templates/) to start copying scaffolding into your own repo.
