import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-slate-700 mb-3">404</h1>
        <p className="text-slate-400 mb-6">Page not found in the vault.</p>
        <Link
          href="/"
          className="text-sm text-[var(--signal-cyan)] transition-colors hover:underline"
        >
          ← Back to brain index
        </Link>
      </div>
    </div>
  );
}
