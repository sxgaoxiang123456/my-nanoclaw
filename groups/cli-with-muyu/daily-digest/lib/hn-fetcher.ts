import type { RawItem } from '../types';

const HN_API_BASE = 'https://hacker-news.firebaseio.com/v0';
const BATCH_SIZE = 5;
const BATCH_DELAY_MS = 200;
const MAX_RETRIES = 3;

/**
 * Fetch with exponential backoff retry on 429 (Too Many Requests).
 * Delays: 1s, 2s, 4s for retries 1, 2, 3.
 */
async function fetchWithRetry(url: string, retries = 0): Promise<Response> {
  const response = await fetch(url);

  if (response.status === 429 && retries < MAX_RETRIES) {
    const delayMs = 1000 * Math.pow(2, retries);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return fetchWithRetry(url, retries + 1);
  }

  return response;
}

/**
 * Fetch a single HN item by ID and map it to RawItem.
 * Returns null if the item has no title (skip invalid items).
 */
async function fetchItem(id: number, index: number): Promise<RawItem | null> {
  try {
    const response = await fetchWithRetry(`${HN_API_BASE}/item/${id}.json`);

    if (!response.ok) {
      console.warn(`[hn-fetcher] Failed to fetch item ${id}: ${response.status}`);
      return null;
    }

    const data = (await response.json()) as {
      id: number;
      title?: string;
      url?: string;
      score?: number;
      time?: number;
      by?: string;
    } | null;

    if (!data) {
      console.warn(`[hn-fetcher] Item ${id} returned null`);
      return null;
    }

    if (!data.title) {
      console.warn(`[hn-fetcher] Skipping item ${id}: missing title`);
      return null;
    }

    const url = data.url || `https://news.ycombinator.com/item?id=${id}`;

    return {
      id: `hn-${index}`,
      title: data.title,
      url,
      source: 'Hacker News',
      sourceId: 'hackernews',
      publishedAt: data.time ? new Date(data.time * 1000).toISOString() : new Date().toISOString(),
      description: undefined,
      score: data.score,
      categoryHint: 'tech',
    };
  } catch (error) {
    console.warn(`[hn-fetcher] Error fetching item ${id}:`, error);
    return null;
  }
}

/**
 * Fetch top stories from Hacker News API.
 * Fetches top story IDs, then fetches item details in batches of 5
 * with 200ms delay between batches.
 *
 * @param limit - Maximum number of stories to fetch
 * @returns Array of RawItem, empty array on total failure
 */
export async function fetchHN(limit: number): Promise<RawItem[]> {
  try {
    const topResponse = await fetchWithRetry(`${HN_API_BASE}/topstories.json`);

    if (!topResponse.ok) {
      console.warn(`[hn-fetcher] Failed to fetch topstories: ${topResponse.status}`);
      return [];
    }

    const storyIds = (await topResponse.json()) as number[];
    const idsToFetch = storyIds.slice(0, limit);

    const results: RawItem[] = [];

    for (let i = 0; i < idsToFetch.length; i += BATCH_SIZE) {
      const batch = idsToFetch.slice(i, i + BATCH_SIZE);
      const batchPromises = batch.map((id, batchIndex) =>
        fetchItem(id, i + batchIndex)
      );

      const batchResults = await Promise.all(batchPromises);

      for (const item of batchResults) {
        if (item) {
          results.push(item);
        }
      }

      // Delay between batches (not after the last batch)
      if (i + BATCH_SIZE < idsToFetch.length) {
        await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
      }
    }

    return results;
  } catch (error) {
    console.warn('[hn-fetcher] Fatal error fetching HN stories:', error);
    return [];
  }
}
