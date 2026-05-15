# Implementation Plan: AI 技术知识日报 Agent

**Branch**: `001-daily-news-digest` | **Date**: 2026-05-15 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `specs/001-daily-news-digest/spec.md`

## Summary

在 NanoClaw v2 的 `cli-with-muyu` Agent Group 中构建一个知识日报 Agent 功能。每天早上 9:00（Asia/Shanghai），系统自动抓取 Hacker News API 和配置的 RSS 技术博客源，使用 LLM 筛选并摘要 5~6 条 AI 领域热点新闻，按主题自动分类为 2~3 个板块，最终通过个人微信推送给用户。

**技术策略**：优先复用 NanoClaw v2 已有能力（定时任务调度、消息投递、通道管理、SQLite 持久化、Claude Provider LLM 调用），仅在 Agent Group 目录内新增抓取脚本和配置，不修改后端源码。

---

## Technical Context

| 维度 | 详情 |
|------|------|
| **Host 语言/版本** | Node.js >= 20, TypeScript 5.7, pnpm 10.33.0 |
| **Container 语言/版本** | Bun 运行时, TypeScript 5.7 |
| **Host 已有依赖** | `better-sqlite3@11.10.0` (SQLite), `cron-parser@5.5.0` (cron 解析), `chat@4.24.0` (Chat SDK), `@clack/*` (CLI 交互) |
| **Container 已有依赖** | `@anthropic-ai/claude-agent-sdk@0.2.116` (LLM 调用), `@modelcontextprotocol/sdk@1.12.1` (MCP 工具), `zod@4.0.0` (类型校验), `cron-parser@5.0.0` (cron 解析) |
| **新增依赖** | `fast-xml-parser` (RSS XML 解析) — 通过 `container.json` 的 `packages.npm` 声明 |
| **存储** | NanoClaw 内置 SQLite (`inbound.db` / `outbound.db`) + 容器文件系统 (`/workspace/agent/daily-digest/data/`) |
| **测试** | Host: `vitest`; Container: `bun test` |
| **目标平台** | NanoClaw v2 Docker 容器环境 |
| **项目类型** | Agent Group 功能扩展（非独立项目） |
| **性能目标** | 单条日报生成耗时 <= 5 分钟（从定时触发到微信送达） |
| **约束** | 不修改 NanoClaw v2 后端源码；所有变更限于 `groups/cli-with-muyu/` 目录内 |
| **规模/范围** | 单用户日报推送；5 个数据源；5~6 条日报条目 |

---

## Constitution Check

**Gates**（基于用户约束与 NanoClaw 架构原则）：

| # | 原则 | 检查项 | 状态 |
|---|------|--------|------|
| 1 | **源码复用优先** | 是否优先复用 NanoClaw 已有模块，避免重复开发？ | 通过 — 定时任务复用 `scheduling` 模块，消息推送复用 `delivery` + `send_message` MCP，通道复用 `channel-registry` + `add-wechat` skill |
| 2 | **不修改后端** | 是否所有变更限于 Agent Group 目录内？ | 通过 — 所有新增文件位于 `groups/cli-with-muyu/`，仅修改 `container.json` 和 `CLAUDE.md` |
| 3 | **TDD 规范** | 是否为每个功能模块定义了可测试的验收标准？ | 通过 — Spec 中每个 FR 和 User Story 都有明确的 Acceptance Criteria |
| 4 | **最小依赖** | 新增依赖是否必要且最小？ | 通过 — 仅需 `fast-xml-parser` 一个 npm 包用于 RSS 解析 |
| 5 | **容器兼容** | 新增代码是否兼容 Bun 运行时和容器沙箱环境？ | 通过 — 脚本使用 Bun 原生 `fetch` 和文件 API，不依赖容器外资源 |

---

## Project Structure

### Documentation (this feature)

```text
specs/001-daily-news-digest/
├── plan.md              # 本文档
├── research.md          # Phase 0 调研结论
├── data-model.md        # 数据模型定义
├── quickstart.md        # 快速启动指南
└── contracts/
    └── fetch-script.md  # fetch.ts 脚本接口契约
```

### Source Code (Agent Group 目录)

所有新增/修改文件均位于 `groups/cli-with-muyu/` 目录内，不触及 NanoClaw v2 后端源码：

```text
groups/cli-with-muyu/
├── CLAUDE.md                          # [修改] 追加日报工作流指令
├── container.json                     # [修改] 添加 fast-xml-parser 依赖
├── CLAUDE.local.md                    # [已有] 每 group 本地配置
├── .claude-shared.md -> /app/CLAUDE.md # [已有] 全局共享
├── .claude-fragments/                 # [已有] CLAUDE.md 模块化片段
│   ├── module-agents.md               # [已有]
│   ├── module-core.md                 # [已有]
│   ├── module-interactive.md          # [已有]
│   ├── module-scheduling.md           # [已有]
│   ├── module-self-mod.md             # [已有]
│   ├── skill-onecli-gateway.md        # [已有]
│   └── module-daily-digest.md         # [新增] 日报模块工作流指令片段
└── daily-digest/                      # [新增] 日报脚本目录
    ├── fetch.ts                       # [新增] RSS/HN 抓取与解析脚本
    ├── sources.json                   # [新增] 数据源配置
    ├── types.ts                       # [新增] 共享类型定义
    ├── lib/
    │   ├── hn-fetcher.ts              # [新增] HN API 抓取器
    │   ├── rss-fetcher.ts             # [新增] RSS 抓取器
    │   └── dedup.ts                   # [新增] 去重逻辑
    └── data/                          # [新增] 运行时数据（.gitignore）
        └── .gitignore                 # [新增] 忽略 raw.json / fetch.log
```

**结构决策说明**：
- 采用**模块化脚本**结构而非单体脚本，将 HN 抓取、RSS 抓取、去重逻辑拆分为独立模块，便于单元测试和后续扩展。
- `daily-digest/` 目录直接放在 group 根目录下，Agent 可通过绝对路径 `/workspace/agent/daily-digest/` 访问（容器内 group 目录挂载到 `/workspace/agent/`）。
- 使用 `.claude-fragments/module-daily-digest.md` 存放日报工作流指令，通过 CLAUDE.md 的 `@` 引用语法组合，符合 NanoClaw 的模块化文档规范。

---

## Data Flow

### 完整数据流向（定时任务触发）

```
[每天 09:00 CST]
    │
    ▼
Host Sweep (60s 间隔)
  检测 inbound.db messages_in 表中
  process_after <= now 且 kind='task' 的 daily-digest 任务
    │
    ▼
wakeContainer(session)
  Docker 启动 cli-with-muyu 容器
    │
    ▼
Agent 轮询 inbound.db
  发现 daily-digest 任务
    │
    ▼
Step 1: 执行抓取脚本
  Bash: bun run /workspace/agent/daily-digest/fetch.ts
    │
    ├── HN Fetcher: 分批并发抓取 top 30 stories
    │   (每批 5 条，间隔 200ms，429 退避重试 3 次)
    │
    ├── RSS Fetcher: 串行抓取 4 个 RSS 源
    │   (每个源 fetchLimit 条，User-Agent 标识)
    │
    ├── Deduplicator: normalized URL + 标题完全匹配去重
    │
    └── 写入 /workspace/agent/daily-digest/data/raw.json
    │
    ▼
Step 2: Agent 读取 raw.json
  Read: /workspace/agent/daily-digest/data/raw.json
    │
    ▼
Step 3: LLM 摘要与分类（单次调用）
  Claude Provider → Claude Agent SDK
    │
    ├── 输入: raw.json (筛选后约 20~30 条的 title + description)
    ├── 提示: 结构化输出约束 (JSON schema)
    │   - 筛选 5~6 条（优先昨日，不足放宽 48h）
    │   - 自动分类为 2~3 个主题板块
    │   - 每条: title + summary(2~3句) + url
    ├── 输出: 结构化 JSON
    │
    └── Agent 将 JSON 转换为 Markdown 日报文本
    │
    ▼
Step 4: 检查 2 小时去重窗口
  查询最近 2 小时内是否已有成功发送的日报
    │
    ├── 是 → 跳过本次任务，记录原因
    │
    └── 否 → 继续推送
    │
    ▼
Step 5: 微信推送
  send_message MCP 工具
    │
    ├── 写入 outbound.db messages_out 表
    │
    ├── Host delivery 轮询 (1s / 60s)
    │
    ├── WeChat Adapter (iLink Bot API)
    │
    └── 用户个人微信收到日报
    │
    ▼
Step 6: 任务完成
  标记 inbound.db 任务状态 = 'completed'
  若 recurring: 计算下次执行时间，插入新 pending 任务
  容器进入 idle（30min 后自动终止）
```

### 手动触发数据流向

与定时任务相同，区别仅在于触发源：
- 用户通过 CLI 或微信向 Agent 发送"生成日报"指令
- Agent 直接执行 Step 1~5，不经过定时任务调度
- Step 4 的 2 小时去重窗口仍然生效，防止与即将到达的定时任务重复

---

## Integration Strategy

### 1. 定时任务调度 — 复用 NanoClaw Scheduling 模块

**已有能力**：
- Host: `src/modules/scheduling/`（任务调度、recurrence 处理、DB 操作）
- Container: `mcp-tools/scheduling.ts`（`schedule_task` / `list_tasks` / `cancel_task` 等 MCP 工具）
- 任务存储在 `inbound.db` 的 `messages_in` 表中（`kind='task'`）

**复用方式**：
- Agent 通过 `schedule_task` MCP 工具设置 cron 任务：
  ```json
  {
    "name": "daily-digest",
    "recurrence": "0 9 * * *",
    "timezone": "Asia/Shanghai",
    "content": "生成 AI 技术日报并推送到微信",
    "script": "bun run /workspace/agent/daily-digest/fetch.ts"
  }
  ```
- Host Sweep 每 60 秒检测到期任务，自动唤醒容器执行
- Recurrence 模块自动计算下次执行时间，无需额外开发

### 2. 消息推送 — 复用 NanoClaw Delivery + Channel 系统

**已有能力**：
- Host: `src/delivery.ts`（outbound 轮询、消息投递）
- Host: `src/channels/channel-registry.ts`（通道注册与路由）
- Container: `mcp-tools/core.ts`（`send_message` MCP 工具）

**复用方式**：
- Agent 调用 `send_message` MCP 工具，目标为微信 messaging group
- Host delivery 轮询 outbound.db，通过 WeChat adapter 投递
- WeChat 通道通过 `add-wechat` skill 安装（使用 iLink Bot API）

### 3. LLM 调用 — 复用 Claude Provider

**已有能力**：
- Container: `providers/claude.ts`（Claude Agent SDK 封装）
- 支持 tool use、function calling、structured output
- Agent 通过对话上下文调用 LLM，无需直接调用 API

**复用方式**：
- 在 `module-daily-digest.md` 中定义日报生成工作流指令
- Agent 执行工作流时自动调用 Claude Provider
- 使用 JSON schema / function calling 约束输出格式

### 4. 数据持久化 — 复用 SQLite + 容器文件系统

**已有能力**：
- Host: `better-sqlite3` 操作 `inbound.db` / `outbound.db`
- Container: `/workspace/agent/` 目录读写持久化

**复用方式**：
- 任务状态：NanoClaw 内置 SQLite 管理
- 抓取数据：`raw.json` 写入 `/workspace/agent/daily-digest/data/`
- 源配置：`sources.json` 存放在 group 目录下，随容器启动挂载

### 5. 通道接入 — 复用 add-wechat Skill

**已有能力**：
- `.claude/skills/add-wechat/` 提供 WeChat channel 安装
- iLink Bot API 支持个人微信号，长轮询 + 二维码认证

**复用方式**：
- 执行 `/add-wechat` skill 安装 WeChat adapter
- 配置 messaging group 关联 cli-with-muyu agent group
- 用户扫码完成 iLink Bot 绑定

---

## Risk Assessment

| # | 风险点 | 影响 | 可能性 | 缓解策略 |
|---|--------|------|--------|---------|
| 1 | **HN API 限流** | 抓取失败，日报内容减少 | 中 | 分批并发（每批 5 条，间隔 200ms），429 退避重试 3 次 |
| 2 | **RSS 源格式非标准** | 解析失败，单源内容丢失 | 中 | 使用 `fast-xml-parser` 的容错模式；解析失败时正则兜底提取 `<item>` |
| 3 | **RSS 源地址变更** | 长期失效，日报内容减少 | 低 | `sources.json` 可配置，用户可自行更新源地址 |
| 4 | **LLM Token 超限** | 摘要失败，发送原始标题列表 | 低 | 预过滤只保留近 48h 内容；超限则随机采样 30 条 |
| 5 | **微信 iLink Bot 连接不稳定** | 推送失败，用户收不到日报 | 中 | delivery 层自动重试；多次失败后 CLI 通道告警 |
| 6 | **微信限流（429）** | 消息延迟或丢失 | 低 | 退避重试；单条日报消息量小，触发限流概率低 |
| 7 | **LLM 输出格式仍偏离** | 日报格式不统一 | 低 | Structured output 约束；失败则原始标题兜底 |
| 8 | **容器启动延迟** | 日报送达时间晚于 9:00 | 低 | Sweep 60s 间隔最大延迟 60s；容器启动通常 < 10s |
| 9 | **时区配置错误** | 日报在不正确的时间推送 | 低 | 使用 NanoClaw 全局 `TIMEZONE` 配置；cron-parser 带 tz 参数 |
| 10 | **fast-xml-parser 安装失败** | RSS 无法解析 | 低 | `container.json` 声明依赖；容器启动时自动安装 |
| 11 | **结构化输出约束不支持** | LLM 格式无法强制 | 低 | Claude SDK 支持 function calling / tool use；可定义 JSON schema |
| 12 | **手动触发与定时任务重复** | 用户短时间内收到两份日报 | 中 | 2 小时去重窗口；已作为 Edge Case 在 Spec 中明确 |

---

## Complexity Tracking

本项目无 Constitution 违规。所有复杂度均为最小必要：

| 决策 | 理由 | 拒绝的更简单方案 |
|------|------|-----------------|
| 模块化脚本（hn-fetcher + rss-fetcher + dedup）| 独立可测、单源失败不影响其他 | 单体 fetch.ts（测试困难、错误隔离差） |
| 结构化输出约束（JSON schema）| 根本解决格式偏离问题 | 重试修正（依赖 LLM 配合，不稳定） |
| 分批并发 HN 抓取 | 平衡速度和限流风险 | 全并发（限流风险）/ 全串行（太慢） |
| 2 小时去重窗口 | 防止重复打扰，同时允许用户在不同半天手动触发 | 严格日限（不够灵活）/ 不去重（可能重复） |
