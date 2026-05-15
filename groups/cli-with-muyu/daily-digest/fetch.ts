import { fetchHN } from './lib/hn-fetcher';
import { fetchRSS } from './lib/rss-fetcher';
import { deduplicate } from './lib/dedup';
import type { SourcesConfig, SourceConfig, RawItem, FetchResult } from './types';

const SOURCES_PATH = './sources.json';
const OUTPUT_PATH = './data/raw.json';

/**
 * Read and parse sources.json configuration.
 * Throws if file doesn't exist or is invalid JSON.
 */
async function readSourcesConfig(): Promise<SourcesConfig> {
  const file = Bun.file(SOURCES_PATH);
  const exists = await file.exists();
  if (!exists) {
    throw new Error(`sources.json not found at ${SOURCES_PATH}`);
  }

  const text = await file.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Invalid JSON in sources.json`);
  }

  // Basic validation
  const config = parsed as SourcesConfig;
  if (typeof config.version !== 'number' || !Array.isArray(config.sources)) {
    throw new Error(`Invalid sources.json format: missing version or sources array`);
  }

  return config;
}

/**
 * Ensure the data/ directory exists.
 */
async function ensureDataDir(): Promise<void> {
  const dir = Bun.file('./data');
  const exists = await dir.exists();
  if (!exists) {
    await Bun.write('./data/.gitkeep', '');
  }
}

/**
 * Fetch items from a single source.
 * Returns items array and logs errors to stdout.
 */
async function fetchFromSource(source: SourceConfig): Promise<RawItem[]> {
  try {
    let items: RawItem[];
    if (source.type === 'api') {
      items = await fetchHN(source.fetchLimit);
    } else if (source.type === 'rss') {
      items = await fetchRSS(source);
    } else {
      console.log(`[ERR] ${source.name}: Unknown source type: ${(source as SourceConfig).type}`);
      return [];
    }
    console.log(`[OK]  ${source.name}: ${items.length} items`);
    return items;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`[ERR] ${source.name}: ${message}`);
    return [];
  }
}

/**
 * Main orchestration: read config, fetch from all sources, deduplicate, write output.
 */
export async function runFetch(): Promise<FetchResult> {
  const config = await readSourcesConfig();
  console.log(`[INFO] Loaded ${config.sources.length} sources from sources.json`);

  const allItems: RawItem[] = [];

  for (const source of config.sources) {
    const items = await fetchFromSource(source);
    allItems.push(...items);
  }

  const dedupedItems = deduplicate(allItems);
  console.log(`[INFO] Deduplicated: ${allItems.length} → ${dedupedItems.length} items`);

  const result: FetchResult = {
    generatedAt: new Date().toISOString(),
    totalSources: config.sources.length,
    totalItems: dedupedItems.length,
    items: dedupedItems,
  };

  await ensureDataDir();
  await Bun.write(OUTPUT_PATH, JSON.stringify(result, null, 2));
  console.log(`[INFO] Written ${OUTPUT_PATH}`);

  return result;
}

// Run if executed directly
if (import.meta.main) {
  runFetch().catch((error) => {
    console.log(`[FATAL] ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
