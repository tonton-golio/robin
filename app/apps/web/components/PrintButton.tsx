'use client';

import { useCallback, useState } from 'react';
import { Printer } from 'lucide-react';

interface PrintButtonProps {
  /** Accessible label / tooltip; defaults to a generic export label. */
  label?: string;
}

/**
 * Export-to-PDF control for reader-rendered out/ artifacts (reports).
 *
 * Reports render through PageWorkspace → FlowPageView as app DOM (their own
 * <style>/<script> are stripped on the way in), so there is no iframe to print.
 * We trigger the browser's own print dialog; the @media print rules in
 * globals.css isolate the <article data-robin-doc>, hide the rails/topbar/
 * toolbars, set page margins, and keep figures/tables from splitting across
 * pages. The user picks "Save as PDF" in the dialog — nothing is written to the
 * vault.
 */
export function PrintButton({ label = 'Export PDF' }: PrintButtonProps) {
  const [hint, setHint] = useState(false);

  const onClick = useCallback(() => {
    setHint(true);
    setTimeout(() => setHint(false), 2200);
    // Defer so the toast paints before the (blocking) print dialog opens.
    setTimeout(() => window.print(), 50);
  }, []);

  return (
    <>
      <button type="button" className="robin-print-btn" onClick={onClick} title={`${label} (choose “Save as PDF”)`}>
        <Printer size={14} strokeWidth={1.6} />
        <span>PDF</span>
      </button>
      {hint ? (
        <span className="robin-print-hint" role="status">
          Opening print dialog — choose “Save as PDF”
        </span>
      ) : null}
    </>
  );
}
