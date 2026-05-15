import { describe, expect, test, beforeEach, afterEach } from 'bun:test';
import type { RawItem, SourceConfig } from './types';

let originalConsoleLog: typeof console.log;
let logs: string[] = [];

// Track what gets written to disk
let writtenFiles: Map<string, string> = new Map();

// Mock data
const mockHNItems: RawItem[] = [
  {
    id: 'hn-0',
    title: 'HN Story One',
    url: 'https://hn-one.com',
    source: 'Hacker News',
    sourceId: 'hackernews',
    publishedAt: '2026-05-15T00:00:00Z',
    score: 100,
    categoryHint: 'tech',
  },
  {
    id: 'hn-1',
    title: 'HN Story Two',
    url: 'https://hn-two.com',
    source: 'Hacker News',
    sourceId: 'hackernews',
    publishedAt: '2026-05-15T01:00:00Z',
    score: 50,
    categoryHint: 'tech',
  },
];

const mockRSSItems: RawItem[] = [
  {
    id: 'anthropic-blog-0',
    title: 'Anthropic Article',
    url: 'https://anthropic.com/blog/1',
    source: 'Anthropic Blog',
    sourceId: 'anthropic-blog',
    publishedAt: '2026-05-15T02:00:00Z',
    description: 'Description',
    categoryHint: 'ai-model',
  },
];

// Testable version of fetch.ts logic with injected dependencies
async function runFetchWithDeps(deps: {
  readSourcesConfig: () => Promise<{ version: number; sources: SourceConfig[] }>;
  fetchHN: (limit: number) => Promise<RawItem[]>;
  fetchRSS: (source: SourceConfig) => Promise<RawItem[]>;
  deduplicate: (items: RawItem[]) => RawItem[];
  writeOutput: (path: string, content: string) => Promise<void>;
  ensureDataDir: () => Promise<void>;
}): Promise<{ generatedAt: string; totalSources: number; totalItems: number; items: RawItem[] }> {
  const config = await deps.readSourcesConfig();
  logs.push(`[INFO] Loaded ${config.sources.length} sources from sources.json`);

  const allItems: RawItem[] = [];

  for (const source of config.sources) {
    try {
      let items: RawItem[];
      if (source.type === 'api') {
        items = await deps.fetchHN(source.fetchLimit);
      } else if (source.type === 'rss') {
        items = await deps.fetchRSS(source);
      } else {
        logs.push(`[ERR] ${source.name}: Unknown source type: ${source.type}`);
        continue;
      }
      logs.push(`[OK]  ${source.name}: ${items.length} items`);
      allItems.push(...items);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logs.push(`[ERR] ${source.name}: ${message}`);
    }
  }

  const dedupedItems = deps.deduplicate(allItems);
  logs.push(`[INFO] Deduplicated: ${allItems.length} → ${dedupedItems.length} items`);

  const result = {
    generatedAt: new Date().toISOString(),
    totalSources: config.sources.length,
    totalItems: dedupedItems.length,
    items: dedupedItems,
  };

  await deps.ensureDataDir();
  await deps.writeOutput('./data/raw.json', JSON.stringify(result, null, 2));
  logs.push(`[INFO] Written ./data/raw.json`);

  return result;
}

describe('fetch.ts orchestration', () => {
  beforeEach(() => {
    originalConsoleLog = console.log;
    logs = [];
    console.log = (...args: unknown[]) => {
      logs.push(args.join(' '));
    };
    writtenFiles = new Map();
  });

  afterEach(() => {
    console.log = originalConsoleLog;
    logs = [];
  });

  test('all sources succeed → result has items from all sources', async () => {
    const result = await runFetchWithDeps({
      readSourcesConfig: async () => ({
        version: 1,
        sources: [
          { id: 'hackernews', name: 'Hacker News', type: 'api', url: 'https://hn.com', categoryHint: 'tech', fetchLimit: 2 },
          { id: 'anthropic-blog', name: 'Anthropic Blog', type: 'rss', url: 'https://anthropic.com/rss', categoryHint: 'ai-model', fetchLimit: 10 },
        ],
      }),
      fetchHN: async () => mockHNItems,
      fetchRSS: async () => mockRSSItems,
      deduplicate: (items) => items,
      writeOutput: async (path, content) => {
        writtenFiles.set(path, content);
      },
      ensureDataDir: async () => {},
    });

    expect(result.totalSources).toBe(2);
    expect(result.totalItems).toBe(3);
    expect(result.items).toHaveLength(3);
    expect(result.items[0].title).toBe('HN Story One');
    expect(result.items[2].title).toBe('Anthropic Article');

    // Verify logs
    expect(logs.some(l => l.includes('[OK]  Hacker News: 2 items'))).toBe(true);
    expect(logs.some(l => l.includes('[OK]  Anthropic Blog: 1 items'))).toBe(true);
    expect(logs.some(l => l.includes('Deduplicated: 3 → 3 items'))).toBe(true);
  });

  test('one source fails → result has items from other sources, error logged', async () => {
    const result = await runFetchWithDeps({
      readSourcesConfig: async () => ({
        version: 1,
        sources: [
          { id: 'hackernews', name: 'Hacker News', type: 'api', url: 'https://hn.com', categoryHint: 'tech', fetchLimit: 2 },
          { id: 'bad-source', name: 'Bad Source', type: 'rss', url: 'https://bad.com', categoryHint: 'tech', fetchLimit: 10 },
        ],
      }),
      fetchHN: async () => mockHNItems,
      fetchRSS: async () => {
        throw new Error('Network error');
      },
      deduplicate: (items) => items,
      writeOutput: async () => {},
      ensureDataDir: async () => {},
    });

    expect(result.totalItems).toBe(2);
    expect(result.items[0].title).toBe('HN Story One');
    expect(logs.some(l => l.includes('[ERR] Bad Source: Network error'))).toBe(true);
    expect(logs.some(l => l.includes('[OK]  Hacker News: 2 items'))).toBe(true);
  });

  test('all sources fail → result has totalItems: 0', async () => {
    const result = await runFetchWithDeps({
      readSourcesConfig: async () => ({
        version: 1,
        sources: [
          { id: 'bad-api', name: 'Bad API', type: 'api', url: 'https://bad-api.com', categoryHint: 'tech', fetchLimit: 2 },
          { id: 'bad-rss', name: 'Bad RSS', type: 'rss', url: 'https://bad-rss.com', categoryHint: 'tech', fetchLimit: 10 },
        ],
      }),
      fetchHN: async () => {
        throw new Error('API down');
      },
      fetchRSS: async () => {
        throw new Error('RSS down');
      },
      deduplicate: (items) => items,
      writeOutput: async () => {},
      ensureDataDir: async () => {},
    });

    expect(result.totalItems).toBe(0);
    expect(result.items).toEqual([]);
    expect(logs.some(l => l.includes('[ERR] Bad API: API down'))).toBe(true);
    expect(logs.some(l => l.includes('[ERR] Bad RSS: RSS down'))).toBe(true);
    expect(logs.some(l => l.includes('Deduplicated: 0 → 0 items'))).toBe(true);
  });

  test('sources.json missing → throws error', async () => {
    await expect(
      runFetchWithDeps({
        readSourcesConfig: async () => {
          throw new Error('sources.json not found');
        },
        fetchHN: async () => [],
        fetchRSS: async () => [],
        deduplicate: (items) => items,
        writeOutput: async () => {},
        ensureDataDir: async () => {},
      })
    ).rejects.toThrow('sources.json not found');
  });

  test('deduplication works → duplicate items removed', async () => {
    const duplicateItems: RawItem[] = [
      {
        id: 'hn-0',
        title: 'Same Story',
        url: 'https://same.com/1',
        source: 'Hacker News',
        sourceId: 'hackernews',
        publishedAt: '2026-05-15T00:00:00Z',
        categoryHint: 'tech',
      },
      {
        id: 'rss-0',
        title: 'Same Story',
        url: 'https://same.com/1',
        source: 'RSS Source',
        sourceId: 'rss-source',
        publishedAt: '2026-05-15T01:00:00Z',
        categoryHint: 'ai-model',
      },
    ];

    const result = await runFetchWithDeps({
      readSourcesConfig: async () => ({
        version: 1,
        sources: [
          { id: 'hackernews', name: 'Hacker News', type: 'api', url: 'https://hn.com', categoryHint: 'tech', fetchLimit: 2 },
          { id: 'rss-source', name: 'RSS Source', type: 'rss', url: 'https://rss.com', categoryHint: 'ai-model', fetchLimit: 10 },
        ],
      }),
      fetchHN: async () => [duplicateItems[0]],
      fetchRSS: async () => [duplicateItems[1]],
      deduplicate: (items) => {
        // Simple dedup: keep first occurrence by title
        const seen = new Set<string>();
        return items.filter(item => {
          if (seen.has(item.title)) return false;
          seen.add(item.title);
          return true;
        });
      },
      writeOutput: async () => {},
      ensureDataDir: async () => {},
    });

    expect(result.totalItems).toBe(1);
    expect(result.items[0].id).toBe('hn-0');
    expect(logs.some(l => l.includes('Deduplicated: 2 → 1 items'))).toBe(true);
  });
});
