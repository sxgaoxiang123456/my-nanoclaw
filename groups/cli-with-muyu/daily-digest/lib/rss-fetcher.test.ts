import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { fetchRSS } from './rss-fetcher';
import type { SourceConfig } from '../types';

const mockSource = (overrides: Partial<SourceConfig> = {}): SourceConfig => ({
  id: 'test-source',
  name: 'Test Source',
  type: 'rss',
  url: 'https://example.com/feed.xml',
  categoryHint: 'ai-model',
  fetchLimit: 10,
  ...overrides,
});

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetch(responseText: string, status = 200) {
  globalThis.fetch = async () =>
    new Response(responseText, {
      status,
      headers: { 'Content-Type': 'application/xml' },
    });
}

const rss20XML = `<?xml version="1.0"?>
<rss version="2.0">
  <channel>
    <title>Test Feed</title>
    <item>
      <title>Article One</title>
      <link>https://example.com/1</link>
      <description>First article description</description>
      <pubDate>Mon, 12 May 2026 08:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Article Two</title>
      <link>https://example.com/2</link>
      <description>Second article description</description>
      <pubDate>Tue, 13 May 2026 10:30:00 +0000</pubDate>
    </item>
    <item>
      <title>Article Three</title>
      <link>https://example.com/3</link>
      <pubDate>Wed, 14 May 2026 15:00:00 UTC</pubDate>
    </item>
  </channel>
</rss>`;

const atomXML = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Feed</title>
  <entry>
    <title>Atom Entry One</title>
    <link href="https://example.com/a1"/>
    <summary>First atom summary</summary>
    <published>2026-05-12T08:00:00Z</published>
  </entry>
  <entry>
    <title>Atom Entry Two</title>
    <link href="https://example.com/a2"/>
    <summary>Second atom summary</summary>
    <published>2026-05-13T10:30:00+00:00</published>
  </entry>
  <entry>
    <title>Atom Entry Three</title>
    <link href="https://example.com/a3"/>
    <published>2026-05-14T15:00:00.000Z</published>
  </entry>
</feed>`;

describe('fetchRSS', () => {
  test('RSS 2.0 XML response → returns parsed RawItems', async () => {
    mockFetch(rss20XML);
    const items = await fetchRSS(mockSource());

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: 'test-source-0',
      title: 'Article One',
      url: 'https://example.com/1',
      source: 'Test Source',
      sourceId: 'test-source',
      description: 'First article description',
      categoryHint: 'ai-model',
    });
    expect(items[0].publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    expect(items[1]).toMatchObject({
      id: 'test-source-1',
      title: 'Article Two',
      url: 'https://example.com/2',
      description: 'Second article description',
    });

    expect(items[2]).toMatchObject({
      id: 'test-source-2',
      title: 'Article Three',
      url: 'https://example.com/3',
    });
    expect(items[2].description).toBeUndefined();
  });

  test('Atom XML response → returns parsed RawItems', async () => {
    mockFetch(atomXML);
    const items = await fetchRSS(mockSource());

    expect(items).toHaveLength(3);
    expect(items[0]).toMatchObject({
      id: 'test-source-0',
      title: 'Atom Entry One',
      url: 'https://example.com/a1',
      source: 'Test Source',
      sourceId: 'test-source',
      description: 'First atom summary',
      categoryHint: 'ai-model',
    });
    expect(items[0].publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);

    expect(items[1]).toMatchObject({
      id: 'test-source-1',
      title: 'Atom Entry Two',
      url: 'https://example.com/a2',
      description: 'Second atom summary',
    });

    expect(items[2]).toMatchObject({
      id: 'test-source-2',
      title: 'Atom Entry Three',
      url: 'https://example.com/a3',
    });
    expect(items[2].description).toBeUndefined();
  });

  test('fetchLimit=2 returns only 2 items', async () => {
    mockFetch(rss20XML);
    const items = await fetchRSS(mockSource({ fetchLimit: 2 }));
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Article One');
    expect(items[1].title).toBe('Article Two');
  });

  test('Malformed XML with regex fallback → still returns items', async () => {
    const malformed = `<rss><channel>
      <item><title>Bad XML</title><link>https://example.com/bad</link><description>desc</description><pubDate>Mon, 12 May 2026 08:00:00 GMT</pubDate></item>
      <item><title>Also Bad</title><link>https://example.com/bad2</link><pubDate>Tue, 13 May 2026 10:30:00 +0000</pubDate></item>
    </channel></rss>`;
    mockFetch(malformed);
    const items = await fetchRSS(mockSource());
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items[0].title).toBe('Bad XML');
  });

  test('Completely invalid XML (no items) → throws error', async () => {
    mockFetch('<html><body>Not a feed</body></html>');
    await expect(fetchRSS(mockSource())).rejects.toThrow();
  });

  test('Date parsing: RSS pubDate converted to ISO 8601', async () => {
    mockFetch(rss20XML);
    const items = await fetchRSS(mockSource());
    expect(items[0].publishedAt).toBe('2026-05-12T08:00:00.000Z');
    expect(items[1].publishedAt).toBe('2026-05-13T10:30:00.000Z');
    expect(items[2].publishedAt).toBe('2026-05-14T15:00:00.000Z');
  });
});
