import type { RawItem } from '../types';

/**
 * Normalize a URL for deduplication comparison.
 * Removes http:// or https:// prefix and trailing slash.
 */
function normalizeUrl(url: string): string {
  return url
    .replace(/^https?:\/\//, '')
    .replace(/\/$/, '');
}

/**
 * Deduplicate RawItems by normalized URL or exact title match.
 * Preserves original order (keeps first occurrence).
 * Time complexity: O(N)
 */
export function deduplicate(items: RawItem[]): RawItem[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const result: RawItem[] = [];

  for (const item of items) {
    const normalizedUrl = normalizeUrl(item.url);

    if (seenUrls.has(normalizedUrl) || seenTitles.has(item.title)) {
      continue;
    }

    seenUrls.add(normalizedUrl);
    seenTitles.add(item.title);
    result.push(item);
  }

  return result;
}
