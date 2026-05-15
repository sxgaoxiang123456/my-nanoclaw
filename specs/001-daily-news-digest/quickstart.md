# Quickstart: AI 技术知识日报 Agent

**Feature**: daily-news-digest | **Branch**: `001-daily-news-digest`

---

## Prerequisites

1. NanoClaw v2 已安装并运行
2. `cli-with-muyu` Agent Group 已初始化
3. 用户已绑定微信（通过 `/add-wechat` skill）

---

## Installation Steps

### Step 1: 添加 WeChat 通道（如未添加）

在 NanoClaw 主界面执行：

```
/add-wechat
```

按提示完成 iLink Bot 二维码扫描绑定。

### Step 2: 创建日报模块文件

在 `groups/cli-with-muyu/` 目录下创建以下文件：

```
groups/cli-with-muyu/
├── .claude-fragments/module-daily-digest.md   # 日报工作流指令
├── daily-digest/
│   ├── fetch.ts                                 # 抓取脚本
│   ├── sources.json                             # 源配置
│   ├── types.ts                                 # 类型定义
│   ├── lib/
│   │   ├── hn-fetcher.ts                        # HN 抓取器
│   │   ├── rss-fetcher.ts                       # RSS 抓取器
│   │   └── dedup.ts                             # 去重逻辑
│   └── data/
│       └── .gitignore                           # 忽略运行时数据
```

### Step 3: 更新 container.json

在 `groups/cli-with-muyu/container.json` 中添加依赖：

```json
{
  "packages": {
    "npm": ["fast-xml-parser"]
  }
}
```

### Step 4: 更新 CLAUDE.md

在 `groups/cli-with-muyu/CLAUDE.md` 中追加引用：

```markdown
@./.claude-fragments/module-agents.md
@./.claude-fragments/module-core.md
@./.claude-fragments/module-interactive.md
@./.claude-fragments/module-scheduling.md
@./.claude-fragments/module-self-mod.md
@./.claude-fragments/skill-onecli-gateway.md
@./.claude-fragments/module-daily-digest.md   # <-- 新增
```

### Step 5: 初始化定时任务

唤醒 Agent 并发送指令：

```
请帮我设置每天 9:00 的 AI 技术日报定时任务
```

Agent 会自动调用 `schedule_task` MCP 工具完成配置。

---

## Manual Testing

### 测试 1: 验证抓取脚本

在容器内执行：

```bash
cd /workspace/agent/daily-digest
bun run fetch.ts
cat data/raw.json
```

期望输出：包含 `totalItems` > 0 的 JSON，每个 item 有 title、url、source。

### 测试 2: 验证日报生成

向 Agent 发送：

```
请立即生成一份 AI 技术日报
```

期望结果：数分钟后收到微信推送的格式化日报。

### 测试 3: 验证定时任务

向 Agent 发送：

```
请查看日报任务状态
```

期望结果：Agent 返回下次执行时间（如"下次执行：明天 09:00 CST"）。

### 测试 4: 验证单源故障容错

修改 `sources.json`，将某个源 URL 改为无效地址，重新执行抓取。

期望结果：其他源正常抓取，日报仍正常生成，日志记录失败源。

---

## Troubleshooting

| 问题 | 排查步骤 |
|------|---------|
| 微信收不到日报 | 检查 iLink Bot 是否在线；检查 messaging group 配置 |
| 抓取结果为空 | 检查网络连接；检查 sources.json 中 URL 是否有效 |
| HN 抓取超时 | 检查是否有代理/防火墙限制；查看 fetch.log |
| 日报格式异常 | 检查 LLM structured output 是否正常；查看 Agent 日志 |
| 定时任务未触发 | 检查 `list_tasks` 输出；检查 Host Sweep 日志 |

---

## Rollback

如需停用日报功能：

1. 向 Agent 发送：`请取消日报定时任务`
2. 或手动删除 `inbound.db` 中 `name='daily-digest'` 的任务记录
3. 可选：移除 `CLAUDE.md` 中的 `@./.claude-fragments/module-daily-digest.md` 引用
