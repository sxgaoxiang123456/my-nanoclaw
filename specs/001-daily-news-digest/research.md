# Research: AI 技术知识日报 Agent

**Date**: 2026-05-15
**Feature**: daily-news-digest

---

## Decision: 抓取脚本使用 Bun 原生运行时 + fast-xml-parser

**Rationale**:
- NanoClaw 容器内已预装 Bun 运行时（`bun src/index.ts` 是容器启动命令）
- Bun 原生支持 `fetch` API 和文件系统操作，无需额外 HTTP 库
- `fast-xml-parser` 是社区最广泛使用的 Node.js XML 解析库，支持 RSS/Atom 容错解析
- 不需要引入 `axios`、`node-fetch` 等额外 HTTP 库，保持依赖最小

**Alternatives considered**:
- `xml2js`: 更老的库，API 不够现代，错误处理较弱
- 手写正则解析 RSS: 过于脆弱，维护成本高
- `feedparser` (npm): 依赖较多，需要 Node.js stream API，Bun 兼容性待验证

---

## Decision: HN API 采用分批并发策略

**Rationale**:
- HN Firebase API 无官方文档化的 rate limit，但社区经验表明约 1 req/IP/s 是安全阈值
- 31 次请求（1 topstories + 30 items）全并发可能触发 429
- 完全串行需要 ~30s，太慢
- 分批并发（每批 5 条，间隔 200ms）总耗时约 6~8s，在 5 分钟目标内，且 rate limit 风险可控

**Alternatives considered**:
- 全并发：最快但风险最高
- 全串行：最安全但太慢
- 使用 HN Algolia API (`hn.algolia.com`)：支持搜索和过滤，但热门内容不如官方 API 实时

---

## Decision: 使用 NanoClaw 内置 scheduling 模块而非外部 cron

**Rationale**:
- NanoClaw 已提供完整的任务调度系统（`schedule_task` MCP 工具 + Host Sweep + Recurrence）
- 任务状态持久化在 SQLite 中，容器重启后自动恢复
- 不需要引入 `node-cron`、`bree` 等外部调度库
- 与 Agent 生命周期（wake/sleep）深度集成

**Alternatives considered**:
- Host 层面 cron job：需要修改后端代码，违反"不修改后端"约束
- 容器内 `setInterval`：容器销毁后丢失，无法持久化
- 外部调度服务（如 AWS EventBridge）：引入不必要的外部依赖

---

## Decision: 使用 Claude Structured Output 约束替代重试兜底

**Rationale**:
- Claude SDK 支持 function calling 和 tool use，可以定义 JSON schema
- 结构化输出比自由文本 + 重试更可靠，从根本上解决格式偏离问题
- Agent 将结构化 JSON 转换为 Markdown，格式化逻辑确定可控
- 如果 structured output 失败，仍然保留原始标题列表兜底

**Alternatives considered**:
- 提示词工程 + 重试：依赖 LLM 配合，不稳定
- 使用 Zod 在容器内校验后重试：增加一次 LLM 调用，成本更高
- 接受非标准输出：用户体验差

---

## Decision: 所有变更限于 `groups/cli-with-muyu/` 目录内

**Rationale**:
- NanoClaw 的架构设计就是 Agent Group 级别的功能隔离
- group 目录下的文件随容器挂载，Agent 可直接访问
- `container.json` 允许声明额外 npm 依赖，无需修改容器镜像
- 不修改后端源码意味着升级 NanoClaw 时不会冲突

**Alternatives considered**:
- 修改 `src/modules/` 添加新模块：功能更强大，但违反约束，增加维护成本
- 在 Host 层面添加定时脚本：需要修改后端启动逻辑
- 独立微服务：过度设计，增加部署复杂度

---

## Decision: WeChat 通道使用 iLink Bot API

**Rationale**:
- NanoClaw 已提供 `add-wechat` skill，封装了 iLink Bot 的接入
- iLink Bot 是腾讯官方个人微信号方案，支持长轮询，无需 webhook
- 与其他方案（WeCom 企业微信、微信公众号）相比，iLink Bot 更接近"个人微信"的使用场景
- 消息格式支持 Markdown（部分渲染），与日报文本格式兼容

**Alternatives considered**:
- WeCom 企业微信：需要企业资质，不适合个人使用
- 微信公众号：需要注册服务号/订阅号，开发复杂度高
- 第三方微信机器人（如 itchat）：存在封号风险，非官方方案
