"use client";

import type React from "react";
import { useEffect } from "react";

// Error boundary for the outputs gallery. A failed out/ read or edit-stream
// parse lands here with a real Retry (never confusable with the empty state,
// which is a calm card; this one is bordered red per the signal-red rule).
export default function OutputsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.ReactElement {
  useEffect(() => {
    // Surface for the console/observability; the UI stays calm.
    console.error("[outputs] gallery failed to load", error);
  }, [error]);

  return (
    <div className="out-page">
      <span className="r-bar">Out</span>
      <div className="out-state out-state--err" role="alert">
        <p className="out-state-t">Couldn’t load the ledger.</p>
        <p>
          One of <code className="out-call">listOutputs()</code>,{" "}
          <code className="out-call">listEdits()</code> or the annotation log failed. This is a load
          error, not an empty library — your artifacts are still on disk.
        </p>
        <p className="out-state-m reason">{error.message || "unknown error"}</p>
        <div className="out-state-actions">
          <button type="button" className="r-btn r-btn--primary" onClick={() => reset()}>
            Retry
          </button>
          <a className="r-btn" href="/health">
            Open Health
          </a>
        </div>
      </div>
    </div>
  );
}
