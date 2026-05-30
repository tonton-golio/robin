import { listBrainPages, listOutputs } from '@/lib/catalog';
import { ownerPossessive } from '@/lib/config';

export const dynamic = 'force-dynamic';

export default async function AboutPage() {
  const [pages, outputs] = await Promise.all([listBrainPages(), listOutputs()]);
  const ownerPoss = ownerPossessive(); // "<owner>'s" or "your"
  const counts = {
    brain: pages.length,
    out: outputs.length,
    decisions: pages.filter((p) => p.type === 'decision').length,
    tasks: pages.filter((p) => p.type === 'task').length,
  };

  return (
    <article className="about-page">
      <h1>About Robin</h1>
      <p className="lede">
        Robin is {ownerPoss} second brain — a continuously growing, self-cleaning
        knowledge base with a browser interface for deep dives.
      </p>

      <p>
        Everything is local-first and stored as plain files. Sources land in <code>inbox/</code>,
        durable knowledge lives as HTML pages in <code>brain/</code>, generated artifacts go
        to <code>out/</code>, and operational logs append to <code>logs/</code>.
      </p>

      <h2>How it works</h2>

      <div className="about-flow">
        <div className="about-flow-box"><strong>inbox/</strong><span>raw sources</span></div>
        <div className="about-flow-box"><strong>ingest →</strong><span>classify, extract</span></div>
        <div className="about-flow-box"><strong>brain/</strong><span>durable HTML</span></div>
        <div className="about-flow-box"><strong>promote →</strong><span>learn, memory</span></div>
        <div className="about-flow-box"><strong>out/</strong><span>briefs &amp; decks</span></div>
      </div>

      <p>
        The browser app you&apos;re looking at serves brain pages, runs the chat, captures
        annotations, and triggers skills. Skills live in <code>.claude/skills/</code> and
        run inside the Claude Code agent — they handle ingest, the morning brief, end-of-day
        consolidation, and weekly review.
      </p>

      <h2>The layers</h2>

      <div className="about-layers">
        <div className="about-layer">
          <code>inbox/</code>
          <span>Captured source material. Immutable; raw markdown or transcripts.</span>
          <span className="about-layer-count">raw</span>
        </div>
        <div className="about-layer">
          <code>brain/</code>
          <span>Durable knowledge. HTML pages with blocks + frontmatter + wikilinks.</span>
          <span className="about-layer-count">{counts.brain} pages</span>
        </div>
        <div className="about-layer">
          <code>memory/</code>
          <span>Append-only recall ledger (<code>brain/memory/events.jsonl</code>).</span>
          <span className="about-layer-count">ledger</span>
        </div>
        <div className="about-layer">
          <code>out/</code>
          <span>Generated HTML artifacts — briefs, reports, meeting notes, decks.</span>
          <span className="about-layer-count">{counts.out} files</span>
        </div>
        <div className="about-layer">
          <code>logs/</code>
          <span>Operational append-only logs: changelog, ingest, repo activity.</span>
          <span className="about-layer-count">append-only</span>
        </div>
      </div>

      <h2>The rhythm</h2>
      <p>
        The day starts with <code>/morning-brief</code>, new sources get ingested with
        <code> /ingest-source</code> or <code> /ingest-meeting</code>, durable insight is captured
        with <code> /learn</code>, and the day is consolidated with <code> /remsleep</code>. The
        weekly review runs on Mondays.
      </p>

      <h2>Stack</h2>
      <p>
        Next.js 16 · React 19 · Tailwind 4 · SQLite FTS5 + vector search ·
        Force-directed graph (Canvas) · Claude Code skills · MCP server · single-user, local-only.
      </p>

      <h2>Why this exists</h2>
      <p>
        Knowledge work runs on context that&apos;s easy to lose: decisions, numbers, people, open
        threads. Robin keeps the things you shouldn&apos;t have to remember, prepares what
        you&apos;ll need before you ask, and pushes back when the thinking is loose. The brain is
        the substrate the agent works in — nothing more, nothing less.
      </p>
    </article>
  );
}
