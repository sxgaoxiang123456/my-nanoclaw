import type { SourceConfig, RawItem } from '../types';

/**
 * 将各种日期格式统一转为 ISO 8601（UTC）
 */
function normalizeDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString();

  // 尝试直接解析（Atom ISO 格式、RFC 2822 等）
  let date = new Date(dateStr);
  if (!isNaN(date.getTime())) {
    return date.toISOString();
  }

  // RSS 常见格式: "Mon, 12 May 2026 08:00:00 GMT"
  const rssMatch = dateStr.match(
    /^\w{3},\s+(\d{1,2})\s+(\w{3})\s+(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*(\w+)?$/
  );
  if (rssMatch) {
    const [, day, monthStr, year, hour, minute, second, tz] = rssMatch;
    const months: Record<string, string> = {
      Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
      Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
    };
    const month = months[monthStr];
    if (month) {
      const isoStr = `${year}-${month}-${day.padStart(2, '0')}T${hour}:${minute}:${second}`;
      date = new Date(isoStr + (tz ? ` ${tz}` : ' UTC'));
      if (!isNaN(date.getTime())) {
        return date.toISOString();
      }
    }
  }

  // 兜底：返回当前时间
  return new Date().toISOString();
}

/**
 * 从 XML 文本中提取标签内容（非贪婪匹配，忽略属性）
 */
function extractTag(xml: string, tagName: string): string | undefined {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, 'i');
  const match = xml.match(regex);
  return match?.[1]?.trim();
}

/**
 * 从自闭合标签中提取属性值
 */
function extractAttr(xml: string, tagName: string, attrName: string): string | undefined {
  const regex = new RegExp(`<${tagName}[^>]*${attrName}=["']([^"']+)["'][^>]*\\/?>`, 'i');
  const match = xml.match(regex);
  return match?.[1]?.trim();
}

function makeRawItem(
  index: number,
  source: SourceConfig,
  title: string,
  url: string,
  dateStr: string,
  description?: string,
): RawItem | null {
  if (!title || !url) return null;
  return {
    id: `${source.id}-${index}`,
    title,
    url,
    source: source.name,
    sourceId: source.id,
    publishedAt: normalizeDate(dateStr),
    description: description || undefined,
    categoryHint: source.categoryHint,
  };
}

/**
 * 解析 RSS 2.0 XML
 */
function parseRSS(xmlText: string, source: SourceConfig): RawItem[] {
  const items: RawItem[] = [];
  const itemRegex = /<item[\s\S]*?<\/item>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = itemRegex.exec(xmlText)) !== null && items.length < source.fetchLimit) {
    const block = match[0];
    const item = makeRawItem(
      index,
      source,
      extractTag(block, 'title') ?? '',
      extractTag(block, 'link') ?? '',
      extractTag(block, 'pubDate') ?? '',
      extractTag(block, 'description'),
    );
    if (item) {
      items.push(item);
      index++;
    }
  }

  return items;
}

/**
 * 解析 Atom XML
 */
function parseAtom(xmlText: string, source: SourceConfig): RawItem[] {
  const items: RawItem[] = [];
  const entryRegex = /<entry[\s\S]*?<\/entry>/gi;
  let match: RegExpExecArray | null;
  let index = 0;

  while ((match = entryRegex.exec(xmlText)) !== null && items.length < source.fetchLimit) {
    const block = match[0];

    // Atom <link> 的 href 在属性中，也可能在文本内容中
    let url = extractAttr(block, 'link', 'href') ?? '';
    if (!url) {
      url = extractTag(block, 'link') ?? '';
    }

    const item = makeRawItem(
      index,
      source,
      extractTag(block, 'title') ?? '',
      url,
      extractTag(block, 'published') ?? extractTag(block, 'updated') ?? '',
      extractTag(block, 'summary') ?? extractTag(block, 'content'),
    );
    if (item) {
      items.push(item);
      index++;
    }
  }

  return items;
}

/**
 * 检测 XML 格式类型
 */
function detectFormat(xmlText: string): 'rss' | 'atom' | 'unknown' {
  const trimmed = xmlText.trim().toLowerCase();
  if (trimmed.includes('<rss') || trimmed.includes('<channel>')) {
    return 'rss';
  }
  if (trimmed.includes('<feed') || trimmed.includes('<entry>')) {
    return 'atom';
  }
  return 'unknown';
}

/**
 * 抓取并解析 RSS/Atom 源
 */
export async function fetchRSS(source: SourceConfig): Promise<RawItem[]> {
  const response = await fetch(source.url, {
    headers: {
      'User-Agent': 'NanoClaw-DailyDigest/1.0',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP error ${response.status}: ${response.statusText}`);
  }

  const text = await response.text();
  const format = detectFormat(text);

  let items: RawItem[] = [];

  if (format === 'rss') {
    items = parseRSS(text, source);
  } else if (format === 'atom') {
    items = parseAtom(text, source);
  }

  // 如果格式检测失败或解析结果为空，尝试 RSS 正则回退（许多损坏的 feed 仍含 <item>）
  if (items.length === 0) {
    items = parseRSS(text, source);
  }

  if (items.length === 0) {
    throw new Error(`Failed to parse RSS/Atom feed from ${source.url}: no items found`);
  }

  return items;
}
