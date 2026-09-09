import React from 'react';

/**
 * Document skeleton — rendered in the reader body while the next page resolves.
 * Persistent files stay in the application shell; only this slot pulses.
 * Static under prefers-reduced-motion (handled in page-vault.css).
 */
export default function ReaderLoading(): React.ReactElement {
  return (
    <div className="r-vault-doc-grid">
      <div className="r-vault-doc r-vault-skel" aria-hidden>
        <div className="sk" style={{ width: '40%', height: 12, marginTop: 4 }} />
        <div className="sk" style={{ width: '70%', height: 28, marginTop: 16 }} />
        <div className="sk" style={{ width: '90%', height: 34, marginTop: 18 }} />
        <div className="sk" style={{ width: '68%' }} />
        <div className="sk" style={{ width: '74%' }} />
        <div className="sk" style={{ width: '60%' }} />
        <div className="sk" style={{ width: '80%', marginTop: 22 }} />
        <div className="sk" style={{ width: '66%' }} />
      </div>
    </div>
  );
}
