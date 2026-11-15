import { describe, expect, it } from 'vitest';
import { discoverChunkUrls } from '../../src/import/discover.js';

describe('discoverChunkUrls', () => {
  it('finds unique chunk scripts in page HTML and makes them absolute', () => {
    const html = `<script src="/_next/static/chunks/app/(main)/editor/page-abc.js"></script>
      <script src="/_next/static/chunks/2653-123.js" async></script>
      self.__next_f.push(["/_next/static/chunks/2653-123.js"])`;
    expect(discoverChunkUrls(html, 'https://example.test')).toEqual([
      'https://example.test/_next/static/chunks/app/(main)/editor/page-abc.js',
      'https://example.test/_next/static/chunks/2653-123.js',
    ]);
  });
});
