'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createPage } from '@/lib/actions/page';
import {
  PageHeader,
  Button,
  Input,
  Field,
  ErrorBanner,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui';

const FOLDERS = ['brain', 'out'];
const PAGE_TYPES = [
  'note', 'task', 'person', 'project', 'knowledge', 'understanding',
  'meeting', 'brief', 'report', 'index', 'template', 'skill', 'playbook',
];

export function NewPageClient(): React.ReactElement {
  const router = useRouter();
  const [folder, setFolder] = useState('brain');
  const [slug, setSlug] = useState('');
  const [type, setType] = useState('note');
  const [summary, setSummary] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const slugified = slug
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/^-+|-+$/g, '');

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slugified) {
      setError('Slug is required');
      return;
    }

    setCreating(true);
    setError('');

    try {
      const result = await createPage({
        folder,
        slug: slugified,
        type,
        frontmatter: { type, summary: summary || undefined },
        blocks: [{ kind: 'heading', level: 1, content: [{ kind: 'text', text: slug || slugified }] }],
      });

      if (!result.ok) {
        if (result.error === 'conflict') {
          setError(`Page "${slugified}" already exists in ${folder}`);
        } else {
          setError(result.error ?? 'Failed to create page');
        }
        setCreating(false);
        return;
      }

      // Navigate to edit the new page
      const editPath = `/${folder}/${slugified}/edit`;
      router.push(editPath);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create page');
      setCreating(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-[460px] px-5 py-16">
      <div className="w-full">
        <PageHeader eyebrow="New" title="Create a page." compact />

        <form onSubmit={(e) => void handleCreate(e)} className="grid gap-4">
          <Field label="Folder">
            <Select value={folder} onValueChange={setFolder}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FOLDERS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Title / slug">
            <Input
              type="text"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              placeholder="My new page"
              autoFocus
            />
            {slugified && slug !== slugified ? (
              <p className="font-mono text-xs text-muted-foreground">slug: {slugified}</p>
            ) : null}
          </Field>

          <Field label="Type">
            <Select value={type} onValueChange={setType}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PAGE_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Summary" hint="(optional)">
            <Input
              type="text"
              value={summary}
              onChange={(e) => setSummary(e.target.value)}
              placeholder="One-line summary"
            />
          </Field>

          {error ? <ErrorBanner>{error}</ErrorBanner> : null}

          <div className="flex gap-2.5 pt-1">
            <Button type="button" variant="ghost" onClick={() => router.back()} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={creating || !slugified} className="flex-1">
              {creating ? 'Creating…' : 'Create & edit'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
