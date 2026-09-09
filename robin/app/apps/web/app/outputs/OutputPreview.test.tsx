import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { OutputPreview } from './OutputPreview';

it('renders encoded static images and preserves the video badge without loading live content', () => {
  for (const file of ['report.html', 'clip.mp4', 'deck.pdf']) {
    const html = renderToStaticMarkup(<OutputPreview path={`out/${file}`} poster="out/cover #1.poster.jpg" />);
    expect(html).toContain('/api/file/out/cover%20%231.poster.jpg');
    expect(html).not.toMatch(/<(iframe|video)\b/);
    expect(html.includes('output-tile-play')).toBe(file === 'clip.mp4');
  }
});

it('keeps unrendered tiles lightweight and supports direct images', () => {
  const fallback = renderToStaticMarkup(<OutputPreview path="out/report.html" />);
  expect(fallback).not.toMatch(/<(iframe|video|img)\b/);
  expect(fallback).toContain('<svg');
  expect(renderToStaticMarkup(<OutputPreview path="out/photo.jpg" />)).toContain('/api/file/out/photo.jpg');
});
