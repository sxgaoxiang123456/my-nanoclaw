# 模块：AI 技术知识日报 (Daily Digest)

## 模块概述

本模块为 NanoClaw v2 的 "AI 技术知识日报 Agent" 功能，负责每天早上自动抓取 Hacker News 和 RSS 技术源，经 LLM 筛选、摘要、分类后，通过微信推送给用户。

本 fragment 被 `groups/cli-with-muyu/CLAUDE.md` 引用，用于指导 Agent 执行日报生成工作流。

---

## 工作流步骤

Agent 按以下顺序执行日报生成：

### Step 1: 执行数据抓取

运行抓取脚本，收集原始数据：

```bash
bun run /workspace/agent/daily-digest/fetch.ts
```

该脚本负责：
- 抓取 Hacker News API 热门条目
- 抓取配置的 RSS 技术源
- 将结果写入 `data/raw.json`
- 对抓取结果进行初步去重（normalized URL + 标题匹配）

### Step 2: 读取原始数据

读取抓取结果：

```bash
cat /workspace/agent/daily-digest/data/raw.json
```

`raw.json` 结构示例：

```json
{
  "fetchedAt": "2026-05-15T08:30:00+08:00",
  "sources": {
    "hackernews": [...],
    "rss": [...]
  },
  "items": [
    {
      "title": "...",
      "url": "...",
      "source": "hackernews",
      "publishedAt": "2026-05-14T10:00:00Z"
    }
  ]
}
```

### Step 3: LLM 筛选与摘要

使用 LLM 对原始条目进行筛选、摘要和分类。必须通过 structured output（JSON schema）约束输出格式。

**Prompt 模板：**

```
你是一位 AI 技术编辑。请从以下技术新闻中筛选出 5~6 条最值得关注的 AI/技术热点，生成日报。

## 筛选规则
1. 优先选择昨日（前一天 0:00-24:00 CST）发布的内容
2. 若昨日内容不足 5 条，放宽至近 48 小时
3. 若仍不足，允许减少条目数（最少 3 条）
4. 去重：相同 URL 或高度相似的标题只保留一条

## 输出要求
- 将条目自动分类为 2~3 个主题板块（如：大模型、AI 基础设施、开源工具等）
- 每条包含：标题、2~3 句话摘要、原文链接、来源
- 摘要用中文撰写，简明扼要，突出技术亮点
- 单条摘要生成失败时，保留标题和链接，摘要标注"[摘要生成失败]"

## 输入数据
{raw_items_json}

请严格按照以下 JSON Schema 返回结果，不要添加任何其他文本：
```

### Step 4: 检查 2 小时去重窗口

在推送前，检查最近 2 小时内是否已发送过日报：

1. 读取去重记录文件 `/workspace/agent/daily-digest/data/sent-digests.jsonl`
2. 检查最后一条记录的 `sentAt` 时间戳
3. 若 `now - sentAt < 2 小时`，则跳过本次执行，记录日志：
   ```
   [SKIP] 2 小时内已发送日报，跳过本次 (last sent at: {timestamp})
   ```
4. 若超过 2 小时或记录不存在，继续执行推送

### Step 5: 微信推送

使用 `send_message` MCP tool 将日报推送给用户。

**推送内容格式：**

```
AI 技术日报 - {日期}

【{板块1名称}】
1. {标题}
   {摘要}
   {原文链接}

2. {标题}
   {摘要}
   {原文链接}

【{板块2名称}】
...

---
共 {N} 条 | 来源: HN, RSS
```

推送成功后，记录发送日志到 `sent-digests.jsonl`：

```json
{"sentAt":"2026-05-15T09:00:00+08:00","itemCount":6,"sections":["大模型","开源工具"],"items":[{"title":"GPT-5 技术报告发布","summary":"OpenAI 发布了 GPT-5 的技术报告，展示了在推理能力和多模态理解上的重大提升。","url":"https://openai.com/research/gpt-5","source":"hackernews"}]}
```

---

## Structured Output JSON Schema

LLM 必须返回符合以下 JSON Schema 的结构化数据：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "DailyDigest",
  "type": "object",
  "required": ["generatedAt", "sections"],
  "properties": {
    "generatedAt": {
      "type": "string",
      "format": "date-time",
      "description": "日报生成时间，ISO 8601 格式，带时区"
    },
    "sections": {
      "type": "array",
      "minItems": 2,
      "maxItems": 3,
      "description": "主题板块列表",
      "items": {
        "$ref": "#/definitions/Section"
      }
    }
  },
  "definitions": {
    "Section": {
      "type": "object",
      "required": ["name", "items"],
      "properties": {
        "name": {
          "type": "string",
          "description": "板块名称，如：大模型、AI 基础设施、开源工具"
        },
        "items": {
          "type": "array",
          "minItems": 1,
          "description": "该板块下的条目列表",
          "items": {
            "$ref": "#/definitions/DigestItem"
          }
        }
      }
    },
    "DigestItem": {
      "type": "object",
      "required": ["title", "summary", "url", "source"],
      "properties": {
        "title": {
          "type": "string",
          "description": "文章标题"
        },
        "summary": {
          "type": "string",
          "description": "2~3 句话中文摘要，或 \"[摘要生成失败]\""
        },
        "url": {
          "type": "string",
          "format": "uri",
          "description": "原文链接"
        },
        "source": {
          "type": "string",
          "enum": ["hackernews", "rss"],
          "description": "数据来源"
        }
      }
    }
  }
}
```

**输出示例：**

```json
{
  "generatedAt": "2026-05-15T09:00:00+08:00",
  "sections": [
    {
      "name": "大模型",
      "items": [
        {
          "title": "GPT-5 技术报告发布",
          "summary": "OpenAI 发布了 GPT-5 的技术报告，展示了在推理能力和多模态理解上的重大提升。新模型在数学和代码任务上准确率提高了 23%。",
          "url": "https://openai.com/research/gpt-5",
          "source": "hackernews"
        }
      ]
    },
    {
      "name": "开源工具",
      "items": [
        {
          "title": "New AI Dev Tool Released",
          "summary": "一款新的 AI 辅助开发工具开源，支持自动代码审查和智能补全。项目一周内获得 5k+ GitHub Stars。",
          "url": "https://github.com/example/ai-dev-tool",
          "source": "rss"
        }
      ]
    }
  ]
}
```

---

## 筛选规则

1. **时间优先级**
   - 第一优先级：昨日（前一天 0:00-24:00 CST）发布的内容
   - 第二优先级：近 48 小时内发布的内容
   - 若仍不足 5 条，允许减少至最少 3 条

2. **内容相关性**
   - 优先 AI、机器学习、大模型、开发者工具等技术话题
   - 排除纯商业新闻、非技术类内容

3. **去重规则**
   - 相同 normalized URL 的条目只保留一条
   - 标题相似度 > 85% 的条目视为重复，保留发布时间较早的一条
   - 去重范围：本次抓取的所有数据源之间

---

## 分类规则

1. **自动分类**
   - 由 LLM 根据内容主题自动归类
   - 分为 2~3 个板块

2. **板块命名**
   - 使用简洁的中文名称
   - 常见板块示例：大模型、AI 基础设施、开源工具、研究前沿、产品动态
   - 根据当日内容动态调整，不强制固定板块

3. **分配原则**
   - 每个板块至少包含 1 条内容
   - 尽量均衡分配，避免某个板块条目过多

---

## 去重与防重发

1. **2 小时去重窗口**
   - 每次推送前检查 `sent-digests.jsonl`
   - 若 2 小时内已发送，跳过本次执行
   - 防止定时任务重叠或手动触发导致的重复推送

2. **内容去重**
   - 同一篇文章在不同数据源出现时只保留一条
   - 使用 normalized URL（去除跟踪参数）进行匹配
   - 标题相似度匹配作为兜底

---

## 错误处理与降级策略

### 1. 数据源不可用

若 HN API 或 RSS 源全部不可用：
- 记录错误日志
- 向用户发送降级消息：
  ```
  AI 技术日报 - {日期}

  今日数据源暂不可用，无法生成日报。
  请稍后重试或访问以下站点手动浏览：
  - https://news.ycombinator.com
  - https://github.com/trending
  ```

### 2. LLM 筛选/摘要失败

- 单条摘要失败：保留标题和链接，摘要标注 `"[摘要生成失败]"`
- 全部摘要失败：发送原始标题列表兜底
- LLM 输出格式偏离：
  - 尝试解析 JSON，失败则使用正则提取关键信息
  - 若结构化约束完全失败，发送原始标题列表

### 3. HN API 限流

- 抓取脚本内置分批并发 + 退避重试机制
- 遇到 429 状态码时，按指数退避等待后重试
- 最多重试 3 次

### 4. 微信推送失败

- 记录失败日志
- 保留日报内容到 `data/failed-digests/` 目录
- 下次执行时尝试重发未成功的日报

---

## 定时触发

- 每天早上 9:00 (Asia/Shanghai) 自动执行
- 通过系统 cron 或调度服务触发 Agent 执行本工作流
- 支持手动触发（用于测试或补发），详见下方「手动触发日报」章节

---

## 任务状态查询

用户询问日报任务状态时，使用 `list_tasks` MCP tool 查询当前任务信息。

### 查询步骤

1. 调用 `list_tasks` 获取当前所有任务
2. 过滤出名称包含 `daily-digest` 或 `daily_digest` 的任务
3. 读取任务状态信息

### 返回信息

向用户返回以下信息：

| 字段 | 说明 |
|------|------|
| 任务名称 | 日报任务的标识名称 |
| 下次执行时间 | 定时任务的下次触发时间（如：2026-05-16 09:00 CST） |
| 最近执行结果 | 最近一次执行的状态：成功 / 失败 / 跳过（2 小时去重） |
| 最近发送时间 | 最近成功推送日报的时间 |

### 示例响应

```
日报任务状态：
- 任务名称：daily-digest-morning
- 下次执行：2026-05-16 09:00 (Asia/Shanghai)
- 最近发送：2026-05-15 09:00
- 最近结果：成功（推送 6 条内容，2 个板块）
```

若最近执行因 2 小时去重窗口而跳过：

```
日报任务状态：
- 任务名称：daily-digest-morning
- 下次执行：2026-05-16 09:00 (Asia/Shanghai)
- 最近发送：2026-05-15 09:00
- 最近结果：跳过（2 小时内已发送，last sent at: 2026-05-15 09:00）
```

---

## 手动触发日报

用户要求「立即生成日报」或「手动触发日报」时，执行以下工作流。

### 触发条件

- 用户明确表达手动触发意图（如："现在发一份日报"、"立即生成"、"手动触发"）
- 2 小时去重窗口**仍然适用**，防止重复推送

### 执行步骤

手动触发与定时任务共用同一套工作流，执行顺序如下：

**Step 1: 检查 2 小时去重窗口**

首先检查 `sent-digests.jsonl`，若 2 小时内已发送：
- 向用户说明情况：「2 小时内已发送过日报（上次发送时间：{timestamp}），为避免重复暂跳过了本次手动触发。如需查看最新日报，可查阅历史消息。」
- 记录日志：`[SKIP][MANUAL] 2 小时内已发送日报，跳过手动触发 (last sent at: {timestamp})`
- **终止执行**

若超过 2 小时，继续下一步。

**Step 2: 执行数据抓取**

```bash
bun run /workspace/agent/daily-digest/fetch.ts
```

**Step 3: 读取原始数据**

```bash
cat /workspace/agent/daily-digest/data/raw.json
```

**Step 4: LLM 筛选与摘要**

使用与定时任务相同的 Prompt 模板和 JSON Schema（见上文 Step 3）。

**Step 5: 微信推送**

使用 `send_message` MCP tool 推送日报，格式与定时任务一致。

推送成功后记录发送日志到 `sent-digests.jsonl`：

```json
{"sentAt":"2026-05-15T14:30:00+08:00","itemCount":6,"sections":["大模型","开源工具"],"trigger":"manual","items":[{"title":"GPT-5 技术报告发布","summary":"OpenAI 发布了 GPT-5 的技术报告，展示了在推理能力和多模态理解上的重大提升。","url":"https://openai.com/research/gpt-5","source":"hackernews"}]}
```

注意：手动触发记录中增加 `"trigger":"manual"` 字段，以便区分定时触发和手动触发。

### 与定时任务的关系

- 手动触发**不影响**原有定时任务的调度计划
- 下次定时任务仍按原 cron 规则执行
- 手动触发后，若定时任务在 2 小时内触发，会因去重窗口而跳过

### 示例对话

**用户**：现在发一份日报给我

**Agent**：
1. 检查 `sent-digests.jsonl` → 确认超过 2 小时
2. 执行 fetch.ts → 获取 raw.json
3. LLM 筛选摘要 → 生成结构化日报
4. send_message 推送
5. 回复用户：「日报已生成并推送，共 6 条内容。下次定时任务仍将于明日 09:00 执行。」

