import type React from "react";

// Skeleton for the ledger. Twelve rows at the exact final row height, with bars
// in the real column positions, so nothing reflows on hydration. The control
// stack (search, census, sort line, legend) is skeletoned at its real heights
// too — leaving it out dropped the whole ledger ~140px the moment data arrived.
// No fake group headers: grouping is data-dependent, and faking it would be a
// guess. The old hero slogan is gone from here too — it was duplicated
// verbatim, and false.
const ROWS = Array.from({ length: 12 });

export default function OutputsLoading(): React.ReactElement {
  return (
    <div className="out-page">
      <div className="out-main">
        <header className="out-head">
          <span className="r-bar">Out</span>
          <h1 className="r-stepped">Artifacts made for other people</h1>
          <p className="out-ceiling r-mono">
            Robin can prove who wrote it and what was edited. It cannot prove it was sent.
          </p>
        </header>

        <div className="out-loadnote" role="status" aria-live="polite">
          <span>
            listing base/out/ · reading robin meta · reading edit log · reading annotations
          </span>
        </div>

        <div aria-hidden>
          <div className="out-searchrow">
            <span className="out-searchbox">
              <span className="out-mag">⌕</span>
              <span className="out-skelinput">
                <span className="out-bar out-bar--w2" />
              </span>
            </span>
          </div>
          <div className="out-census">
            <span className="out-bar out-bar--text out-bar--w3" />
          </div>
          <div className="out-sortline">
            <span className="out-bar out-bar--text out-bar--w2" />
          </div>
          <p className="out-legend r-mono">
            <span className="out-bar out-bar--text out-bar--w2" />
          </p>
        </div>

        <ul className="out-led out-skel" aria-hidden>
          {ROWS.map((_, i) => (
            <li key={i}>
              <div className="out-row out-rowskel">
                <span className="out-for">
                  <span className="out-bar" />
                </span>
                <span className="out-rowtitle">
                  <span className="out-bar" />
                </span>
                <span className="out-extent">
                  <span className="out-bar" />
                </span>
                <span className="out-statecell">
                  <span className="out-bar" />
                </span>
                <span className="out-date">
                  <span className="out-bar" />
                </span>
                <span className="out-flags" />
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
