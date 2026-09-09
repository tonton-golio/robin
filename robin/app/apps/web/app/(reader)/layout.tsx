import React from 'react';

/**
 * Reader routes share a lightweight scrolling document boundary. Files,
 * outline, connections, and history belong to the Living Workspace shell.
 */
export default function ReaderLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return (
    <div className="r-vault-root">
      <div className="r-vault-body">{children}</div>
    </div>
  );
}
