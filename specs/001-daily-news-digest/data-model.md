# Data Model: AI 技术知识日报 Agent

**Date**: 2026-05-15
**Feature**: daily-news-digest

---

## Entity: SourceConfig

定义一个数据抓取源的配置信息。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 源唯一标识，如 `"anthropic-blog"` |
| `name` | string | 是 | 源显示名称，如 `"Anthropic Blog"` |
| `type` | enum | 是 | `"api"` 或 `"rss"` |
| `url` | string | 是 | 抓取地址 |
| `categoryHint` | string | 是 | 分类倾向提示，如 `"ai-model"` |
| `fetchLimit` | number | 是 | 该源最大抓取条数 |

**持久化**: `groups/cli-with-muyu/daily-digest/sources.json`

---

## Entity: RawItem

从数据源抓取的原始内容条目。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `id` | string | 是 | 源标识 + 序号，如 `"hn-0"` |
| `title` | string | 是 | 文章标题 |
| `url` | string | 是 | 原文链接 |
| `source` | string | 是 | 来源显示名称 |
| `sourceId` | string | 是 | 来源 ID |
| `publishedAt` | string (ISO 8601) | 是 | 发布时间 |
| `description` | string | 否 | RSS 摘要或描述 |
| `score` | number | 否 | HN 投票数（仅 HN） |
| `categoryHint` | string | 是 | 来源预设分类提示 |

**持久化**: `/workspace/agent/daily-digest/data/raw.json`（运行时生成）

---

## Entity: DailyDigest

一次日报生成的最终产物。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `generatedAt` | string (ISO 8601) | 是 | 生成时间 |
| `sections` | Section[] | 是 | 板块列表 |

### Entity: Section

日报中的一个主题板块。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `name` | string | 是 | 板块名称，如 `"AI 大模型进展"` |
| `items` | DigestItem[] | 是 | 该板块下的条目 |

### Entity: DigestItem

日报中的一条摘要条目。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `title` | string | 是 | 原文标题 |
| `summary` | string | 是 | 2~3 句话核心摘要 |
| `url` | string | 是 | 原文链接 |
| `source` | string | 是 | 来源名称 |

**持久化**: 临时存在于 Agent 对话上下文中，最终转换为 Markdown 文本通过 `send_message` 推送

---

## Entity: FetchResult

抓取脚本的输出结构。

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `generatedAt` | string (ISO 8601) | 是 | 抓取完成时间 |
| `totalSources` | number | 是 | 配置源总数 |
| `totalItems` | number | 是 | 去重后总条目数 |
| `items` | RawItem[] | 是 | 去重后的原始条目列表 |

**持久化**: `/workspace/agent/daily-digest/data/raw.json`

---

## Data Relationships

```
SourceConfig (1..N) ──fetches──> RawItem (M) ──dedup──> RawItem[] (unique)
                                      │
                                      ▼
                               LLM筛选+摘要+分类
                                      │
                                      ▼
                               DailyDigest (1)
                                      │
                                      ▼
                               Markdown 文本
                                      │
                                      ▼
                               send_message ──> 微信
```

---

## State Transitions: ScheduledTask

利用 NanoClaw 内置的任务状态机：

```
                        [schedule_task]
                             │
                             ▼
                        ┌─────────┐
                        │ pending │
                        └────┬────┘
                             │ Host Sweep 检测到期
                             ▼
                        ┌───────────┐
                        │ processing│
                        └─────┬─────┘
                              │ 执行完成
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        ┌──────────┐   ┌──────────┐   ┌──────────┐
        │completed │   │  failed  │   │  paused  │
        └────┬─────┘   └────┬─────┘   └────┬─────┘
             │              │              │
             ▼              ▼              ▼
    [recurrence]      [max retries]    [resume_task]
    计算下次执行         触发告警？         恢复为 pending
```

---

## Validation Rules

1. `sources.json` 必须至少包含 1 个有效源配置
2. 每个 `SourceConfig.url` 必须是有效 HTTP/HTTPS URL
3. `RawItem.title` 不能为空字符串
4. `RawItem.url` 必须是有效 URL
5. `DailyDigest.sections` 长度必须在 1~3 之间
6. 每个 `Section.items` 长度必须在 1~3 之间
7. `DigestItem.summary` 长度不超过 200 字符
