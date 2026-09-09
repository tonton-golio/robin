import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex h-full items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold text-[var(--ink)] mb-3">404</h1>
        <p className="text-[var(--muted)] mb-6">Page not found in the vault.</p>
        <Link
          href="/"
          className="text-sm text-[var(--link)] transition-colors hover:underline"
        >
          ← Back to brain index
        </Link>
      </div>
    </div>
  );
}
