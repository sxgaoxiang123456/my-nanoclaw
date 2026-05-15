import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import { fetchHN } from './hn-fetcher';
import type { RawItem } from '../types';

// Save original fetch
let originalFetch: typeof globalThis.fetch;

// Mock fetch helper: returns a function that tracks calls and returns configured responses
function createMockFetch(responses: Map<string, { status?: number; body?: unknown; delay?: number }>) {
  return async (url: string) => {
    const config = responses.get(url);
    if (!config) {
      return new Response(null, { status: 404 });
    }

    if (config.delay) {
      await new Promise((r) => setTimeout(r, config.delay));
    }

    const status = config.status ?? 200;
    if (status === 429) {
      return new Response(null, { status: 429 });
    }

    return new Response(JSON.stringify(config.body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  };
}

describe('fetchHN', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns RawItems from topstories and item details', async () => {
    const responses = new Map([
      ['https://hacker-news.firebaseio.com/v0/topstories.json', { body: [1, 2, 3] }],
      ['https://hacker-news.firebaseio.com/v0/item/1.json', { body: { id: 1, title: 'Story One', url: 'https://one.com', score: 100, time: 1609459200, by: 'alice' } }],
      ['https://hacker-news.firebaseio.com/v0/item/2.json', { body: { id: 2, title: 'Story Two', url: 'https://two.com', score: 50, time: 1609459260, by: 'bob' } }],
      ['https://hacker-news.firebaseio.com/v0/item/3.json', { body: { id: 3, title: 'Story Three', url: 'https://three.com', score: 25, time: 1609459320, by: 'carol' } }],
    ]);

    globalThis.fetch = createMockFetch(responses);

    const items = await fetchHN(3);

    expect(items).toHaveLength(3);
    expect(items[0].id).toBe('hn-0');
    expect(items[0].title).toBe('Story One');
    expect(items[0].url).toBe('https://one.com');
    expect(items[0].source).toBe('Hacker News');
    expect(items[0].sourceId).toBe('hackernews');
    expect(items[0].categoryHint).toBe('tech');
    expect(items[0].publishedAt).toBe('2021-01-01T00:00:00.000Z');
    expect(items[0].score).toBe(100);

    expect(items[1].id).toBe('hn-1');
    expect(items[2].id).toBe('hn-2');
  });

  test('batch concurrency: fetches in batches of 5 with 200ms delay', async () => {
    const storyIds = Array.from({ length: 12 }, (_, i) => i + 1);
    const responses = new Map<string, { body?: unknown }>();

    responses.set('https://hacker-news.firebaseio.com/v0/topstories.json', { body: storyIds });
    for (const id of storyIds) {
      responses.set(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        body: { id, title: `Story ${id}`, url: `https://story${id}.com`, score: id * 10, time: 1609459200, by: 'user' },
      });
    }

    globalThis.fetch = createMockFetch(responses);

    const start = Date.now();
    const items = await fetchHN(12);
    const elapsed = Date.now() - start;

    expect(items).toHaveLength(12);
    // 12 items = 3 batches of 5, 5, 2. 2 delays between batches = ~400ms minimum
    // Allow some tolerance for test environment
    expect(elapsed).toBeGreaterThanOrEqual(350);
  });

  test('429 response triggers exponential backoff retry', async () => {
    let item1Calls = 0;
    const mockFetch = async (url: string) => {
      if (url === 'https://hacker-news.firebaseio.com/v0/topstories.json') {
        return new Response(JSON.stringify([1]), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url === 'https://hacker-news.firebaseio.com/v0/item/1.json') {
        item1Calls++;
        if (item1Calls < 3) {
          return new Response(null, { status: 429 });
        }
        return new Response(
          JSON.stringify({ id: 1, title: 'Retry Story', url: 'https://retry.com', score: 10, time: 1609459200, by: 'user' }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(null, { status: 404 });
    };

    globalThis.fetch = mockFetch;

    const start = Date.now();
    const items = await fetchHN(1);
    const elapsed = Date.now() - start;

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Retry Story');
    expect(item1Calls).toBe(3); // initial + 2 retries (3rd succeeds)
    // Backoff: 1s + 2s = ~3s total delay. Allow tolerance.
    expect(elapsed).toBeGreaterThanOrEqual(2500);
  });

  test('item without URL uses HN item page fallback', async () => {
    const responses = new Map([
      ['https://hacker-news.firebaseio.com/v0/topstories.json', { body: [1] }],
      ['https://hacker-news.firebaseio.com/v0/item/1.json', { body: { id: 1, title: 'Ask HN: Something', score: 5, time: 1609459200, by: 'user' } }],
    ]);

    globalThis.fetch = createMockFetch(responses);

    const items = await fetchHN(1);

    expect(items).toHaveLength(1);
    expect(items[0].url).toBe('https://news.ycombinator.com/item?id=1');
  });

  test('limit=2 returns only 2 items even if topstories has more', async () => {
    const responses = new Map([
      ['https://hacker-news.firebaseio.com/v0/topstories.json', { body: [1, 2, 3, 4, 5] }],
      ['https://hacker-news.firebaseio.com/v0/item/1.json', { body: { id: 1, title: 'Story 1', url: 'https://1.com', score: 10, time: 1609459200, by: 'user' } }],
      ['https://hacker-news.firebaseio.com/v0/item/2.json', { body: { id: 2, title: 'Story 2', url: 'https://2.com', score: 20, time: 1609459200, by: 'user' } }],
    ]);

    globalThis.fetch = createMockFetch(responses);

    const items = await fetchHN(2);

    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Story 1');
    expect(items[1].title).toBe('Story 2');
  });

  test('network error returns empty array (graceful degradation)', async () => {
    globalThis.fetch = async () => {
      throw new Error('Network failure');
    };

    const items = await fetchHN(5);

    expect(items).toEqual([]);
  });

  test('item without title is skipped with console warning', async () => {
    const responses = new Map([
      ['https://hacker-news.firebaseio.com/v0/topstories.json', { body: [1, 2] }],
      ['https://hacker-news.firebaseio.com/v0/item/1.json', { body: { id: 1, score: 10, time: 1609459200, by: 'user' } }], // no title
      ['https://hacker-news.firebaseio.com/v0/item/2.json', { body: { id: 2, title: 'Valid Story', url: 'https://valid.com', score: 20, time: 1609459200, by: 'user' } }],
    ]);

    globalThis.fetch = createMockFetch(responses);

    const items = await fetchHN(2);

    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Valid Story');
  });
});
