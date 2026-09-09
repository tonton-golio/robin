import type { Metadata } from 'next';
import '@/styles/globals.css';
import { LivingWorkspaceShell } from '@/components/shell/LivingWorkspaceShell';

export const metadata: Metadata = {
  title: 'Robin',
  description: 'Your local second brain.',
};

/**
 * Runs before first paint to avoid a light/dark flash: read the saved theme
 * (localStorage 'robin-theme') and stamp `data-theme` on <html> so tokens.css
 * resolves the right palette immediately. Quiet Slate is dark-first, so with
 * no stored preference we default to 'dark' rather than reading
 * prefers-color-scheme; a stored preference always wins.
 * Kept tiny + defensive (private-mode localStorage can throw).
 */
const THEME_BOOTSTRAP = `(function(){try{var t=localStorage.getItem('robin-theme');if(t!=='light'&&t!=='dark'){t='dark';}document.documentElement.dataset.theme=t;}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
      </head>
      <body>
        <LivingWorkspaceShell>{children}</LivingWorkspaceShell>
      </body>
    </html>
  );
}
