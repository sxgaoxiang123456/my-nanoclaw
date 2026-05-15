import { describe, expect, test } from 'bun:test';
import { deduplicate } from './dedup';
import type { RawItem } from '../types';

function makeItem(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: 'test-1',
    title: 'Test Title',
    url: 'https://example.com/article',
    source: 'Test Source',
    sourceId: 'test-source',
    publishedAt: '2026-05-15T00:00:00Z',
    categoryHint: 'ai-model',
    ...overrides,
  };
}

describe('deduplicate', () => {
  test('empty array → returns empty array', () => {
    expect(deduplicate([])).toEqual([]);
  });

  test('no duplicates → returns same array', () => {
    const items = [
      makeItem({ id: 'a', title: 'Title A', url: 'https://a.com/1' }),
      makeItem({ id: 'b', title: 'Title B', url: 'https://b.com/2' }),
    ];
    expect(deduplicate(items)).toEqual(items);
  });

  test('duplicate URLs (same URL, different source) → keeps first', () => {
    const items = [
      makeItem({ id: 'a', title: 'Title A', url: 'https://example.com/article', source: 'Source A' }),
      makeItem({ id: 'b', title: 'Title B', url: 'https://example.com/article', source: 'Source B' }),
    ];
    const result = deduplicate(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  test('duplicate titles (different URLs) → keeps first', () => {
    const items = [
      makeItem({ id: 'a', title: 'Same Title', url: 'https://a.com/1' }),
      makeItem({ id: 'b', title: 'Same Title', url: 'https://b.com/2' }),
    ];
    const result = deduplicate(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  test('both URL and title duplicates → keeps first', () => {
    const items = [
      makeItem({ id: 'a', title: 'Dup', url: 'https://example.com/dup' }),
      makeItem({ id: 'b', title: 'Dup', url: 'https://example.com/dup' }),
      makeItem({ id: 'c', title: 'Dup', url: 'https://example.com/dup' }),
    ];
    const result = deduplicate(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  test('URL normalization (http vs https, trailing slash) → treats as same', () => {
    const items = [
      makeItem({ id: 'a', title: 'Title A', url: 'https://example.com/article' }),
      makeItem({ id: 'b', title: 'Title B', url: 'http://example.com/article' }),
      makeItem({ id: 'c', title: 'Title C', url: 'https://example.com/article/' }),
    ];
    const result = deduplicate(items);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('a');
  });

  test('mixed case titles are NOT duplicates (exact match only)', () => {
    const items = [
      makeItem({ id: 'a', title: 'Hello World', url: 'https://a.com/1' }),
      makeItem({ id: 'b', title: 'hello world', url: 'https://b.com/2' }),
    ];
    const result = deduplicate(items);
    expect(result).toHaveLength(2);
  });
});
