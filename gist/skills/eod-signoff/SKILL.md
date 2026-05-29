---
name: eod-signoff
description: End-of-day written standup. Investigates the day across code (git/PRs), comms (Slack/email/calendar), and the internal record (changelog, memory, tasks, meetings). Drafts a two-section signoff and posts to the team channel after explicit confirmation.
---

# /eod-signoff

## Purpose

Draft an end-of-day standup post summarizing what happened, post to the team standup channel after the user explicitly confirms.

Requires:
- Slack MCP (for posting).
- Email MCP (optional, for sent-message context).
- GitHub CLI (`gh`) for PR/issue history.
- Local git repos for commit history.

## When to use

- End of day, before signing off.
- Manually when the team needs a status update.

## Configuration (from `config.yaml`)

- `team_standup_channel` — the channel to post to.
- `user_name`, `email` — for identity resolution.

## Steps

1. **Resolve identity.** Detect:
   - Local git user (`git config user.email`, `user.name`).
   - GitHub user via `gh api user`.
   - Slack user ID from config.

2. **Investigate in parallel.** Dispatch three sub-agents:

   **Record investigator (primary).**
   - Read entries dated today from `logs/changelog.md`.
   - Read today's `logs/meetings/*.html`.
   - Read memory events created today (`brain/memory/events.jsonl` lines with `created_at` today).
   - Read task movement: tasks created today, tasks marked done today.
   - Returns: structured summary of what {{USER_NAME}}'s own record shows.

   **Code investigator.**
   - For each repo path in config / repos: `git log --since="midnight"` with diff stats.
   - `gh search prs --author=@me --updated=YYYY-MM-DD` — PRs merged or updated today.
   - `gh pr list --search "review-requested:@me"` — PRs awaiting your review.
   - Full commit history with diffs (not author-only listings — see all commits).
   - Returns: structured summary of code work.

   **Comms investigator.**
   - Read whole Slack threads the user participated in today (not just snippets).
   - Read email sent today.
   - Read calendar events that happened today.
   - Returns: structured summary of communications.

3. **Synthesize.** Compose a two-section draft:

   **Section 1 — "The day, abridged"** (top, business outcomes):
   - 2–4 bullets.
   - One line each.
   - No PR numbers, no function names, no commit SHAs.
   - Exec-readable. Outcomes, not activities.

   **Section 2 — "Mostly harmless details"** (optional, technical):
   - 3–5 bullets.
   - PRs, functions, modules, infra changes.
   - Slightly more detail for engineering-curious readers.
   - Optional but encouraged for technical days.

   The voice should be consistent. Pick a style and stick to it (deadpan, formal, witty — your call). Default to dry and concise.

4. **Show the draft + ask.**
   ```
   --- DRAFT ---
   {message body}

   — {{AGENT_NAME}} ({{USER_NAME}}'s agent)
   --- END DRAFT ---

   Post to {{TEAM_STANDUP_CHANNEL}}? (yes / edit / no)
   ```

5. **Wait.** Do NOT post automatically. This is draft-first regardless of how the user phrased the request.

6. **On explicit "yes" / "go":** Post to `team_standup_channel`. Include the signature line.

7. **Report what was posted:**
   - Channel.
   - First line of the message.
   - Confirmation that signature was included.

## Output shape

- The draft is the main artifact. Could be 5–15 lines.
- The post-send report is one or two lines.

## Edge cases

- **No team_standup_channel configured.** Halt with a clear error and ask the user to configure it.
- **Quiet day (no code, light comms).** Still produce a brief draft. Even "blocked on X, focused on Y" is valuable for the team.
- **Sensitive content** (a draft references confidential info). Surface to user; ask if it should be paraphrased.
- **User says "edit".** Apply edits, re-show draft, re-ask.
- **User says "no".** Don't post. Done.

## Side effects

- Reads git history, GitHub, Slack, email.
- Posts to Slack only on explicit confirmation.
- Does NOT edit `brain/`.

## Notes

- The "Hitchhiker's Guide" voice or any specific tone is up to you. Pick something that fits the team's culture and your sense of humor (or lack thereof). Consistency matters more than the specific tone.
- This skill is *useful* but not *essential*. Skip if your team doesn't do daily written standups.
