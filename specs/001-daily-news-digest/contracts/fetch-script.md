# Contract: fetch.ts 脚本接口

**Date**: 2026-05-15
**Feature**: daily-news-digest

---

## Overview

`fetch.ts` 是运行在 NanoClaw Agent 容器内的 Bun 脚本，负责抓取 Hacker News API 和配置的 RSS 源，输出标准化的原始数据供 Agent LLM 消费。

**入口**: `bun run /workspace/agent/daily-digest/fetch.ts`
**工作目录**: `/workspace/agent/daily-digest/`
**运行时**: Bun (container 内)

---

## Input

### 配置文件: `sources.json`

```typescript
interface SourceConfig {
  id: string;        // 源唯一标识
  name: string;      // 显示名称
  type: 'api' | 'rss'; // 源类型
  url: string;       // 抓取地址
  categoryHint: string; // 分类倾向
  fetchLimit: number; // 最大抓取条数
}

interface SourcesConfig {
  version: number;   // 配置版本号
  sources: SourceConfig[];
}
```

**示例**:
```json
{
  "version": 1,
  "sources": [
    {
      "id": "hackernews",
      "name": "Hacker News",
      "type": "api",
      "url": "https://hacker-news.firebaseio.com/v0/topstories.json",
      "categoryHint": "tech",
      "fetchLimit": 30
    },
    {
      "id": "anthropic-blog",
      "name": "Anthropic Blog",
      "type": "rss",
      "url": "https://www.anthropic.com/rss.xml",
      "categoryHint": "ai-model",
      "fetchLimit": 10
    }
  ]
}
```

---

## Output

### 文件: `data/raw.json`

```typescript
interface RawItem {
  id: string;           // "{sourceId}-{index}"
  title: string;        // 文章标题
  url: string;          // 原文链接
  source: string;       // 来源显示名称
  sourceId: string;     // 来源 ID
  publishedAt: string;  // ISO 8601 格式
  description?: string; // RSS 摘要
  score?: number;       // HN score
  categoryHint: string; // 分类倾向
}

interface FetchResult {
  generatedAt: string;     // ISO 8601
  totalSources: number;    // 配置源总数
  totalItems: number;      // 去重后条目数
  items: RawItem[];        // 去重后的原始条目
}
```

**示例**:
```json
{
  "generatedAt": "2026-05-15T09:00:00.000Z",
  "totalSources": 5,
  "totalItems": 47,
  "items": [
    {
      "id": "hn-0",
      "title": "Claude 4.7 Released",
      "url": "https://www.anthropic.com/news/claude-4-7",
      "source": "Hacker News",
      "sourceId": "hackernews",
      "publishedAt": "2026-05-14T18:30:00.000Z",
      "score": 342,
      "categoryHint": "tech"
    }
  ]
}
```

---

## Behavior Contract

### 正常流程

1. 读取 `sources.json` 配置
2. 按顺序处理每个 `SourceConfig`：
   - `type === 'api'` → 调用 `hn-fetcher.ts`
   - `type === 'rss'` → 调用 `rss-fetcher.ts`
3. 合并所有抓取结果
4. 调用 `dedup.ts` 去重
5. 写入 `data/raw.json`
6. 打印日志到 stdout（每源抓取条数、去重后总数）

### 错误处理

| 场景 | 行为 |
|------|------|
| 单个源抓取失败 | 打印 `[ERR] {source.name}: {error}`，继续处理其他源 |
| `sources.json` 不存在或格式错误 | 抛出错误，exit code 1 |
| `data/` 目录不存在 | 自动创建 |
| 全部源抓取失败 | 输出 `totalItems: 0` 的空 items 数组 |
| HN API 返回 429 | 指数退避重试最多 3 次（1s → 2s → 4s） |
| RSS XML 解析失败 | 尝试正则提取 `<item>` 标签兜底；仍失败则跳过该源 |

### 性能约束

- 总执行时间 <= 30 秒（在 5 分钟日报生成目标内）
- HN 抓取：分批并发，每批 5 条，批次间隔 200ms
- RSS 抓取：串行执行，避免对多个 RSS 服务器同时施压

### 副作用

- 写入文件 `data/raw.json`（覆盖）
- 可能创建 `data/` 目录
- stdout 输出日志
- 无 stderr（错误通过 stdout 的 `[ERR]` 前缀输出）

---

## Sub-Module Contracts

### hn-fetcher.ts

```typescript
// 输入
interface HNFetcherInput {
  limit: number;  // 抓取前 N 条
}

// 输出
async function fetchHN(limit: number): Promise<RawItem[]>
```

**约束**:
- 内部调用 HN Firebase API (`hacker-news.firebaseio.com`)
- 先获取 `topstories.json`，再获取每个 item 详情
- 分批并发：每批 5 条，批次间隔 200ms
- 429 时指数退避重试 3 次

### rss-fetcher.ts

```typescript
// 输入
interface RSSFetcherInput {
  source: SourceConfig;
}

// 输出
async function fetchRSS(source: SourceConfig): Promise<RawItem[]>
```

**约束**:
- 使用 `fast-xml-parser` 解析 XML
- 设置 User-Agent: `NanoClaw-DailyDigest/1.0`
- 解析失败时尝试正则提取 `<item>` 标签
- 仍失败则抛出错误，由调用方捕获

### dedup.ts

```typescript
// 输入
function deduplicate(items: RawItem[]): RawItem[]

// 去重规则
// 1. normalized URL（去除协议前缀和尾部斜杠）一致 → 重复
// 2. URL 不同但 title 完全匹配 → 重复
// 保留先出现的条目
```

**约束**:
- 时间复杂度 O(N)
- 不改变条目的顺序（保留源内排序）
