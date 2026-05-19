# NanoClaw v2 后端源码调研报告

> 调研日期：2026-05-18
> 工作目录：/Volumes/Gaoxiang-Data/02_code/nanoclaw-fork/nanoclaw-v2
> 调研范围：daily-news 模块、Agent-to-Agent 机制、Agent 路由、host-sweep 唤醒

---

## 1. daily-news 模块是怎么实现的？

### 1.1 结论：不是多 Agent 协作链，而是「单 Agent + 定时任务 + 外部数据抓取脚本」结构

daily-news 模块位于 `groups/cli-with-muyu/daily-digest/`，它是一个**容器技能（skill）**，由 Andy Agent 通过定时任务触发执行。核心逻辑是一个独立的数据抓取脚本，Agent 本身只负责调用脚本、接收结果、生成摘要并推送。

### 1.2 实现步骤（共 4 步）

**Step 1: 配置读取**
- 文件：`groups/cli-with-muyu/daily-digest/fetch.ts` 第 13-35 行
- 读取 `sources.json` 获取新闻源配置（HN API + RSS 源）

**Step 2: 并行抓取**
- 文件：`groups/cli-with-muyu/daily-digest/fetch.ts` 第 75-84 行
- 遍历所有源，按类型分发：
  - `api` 类型 → `lib/hn-fetcher.ts` 调用 Hacker News Firebase API
  - `rss` 类型 → `lib/rss-fetcher.ts` 抓取并解析 RSS/Atom
- 代码（`fetch.ts:52-70`）：
  ```typescript
  async function fetchFromSource(source: SourceConfig): Promise<RawItem[]> {
    if (source.type === 'api') {
      items = await fetchHN(source.fetchLimit);
    } else if (source.type === 'rss') {
      items = await fetchRSS(source);
    }
  }
  ```

**Step 3: 去重**
- 文件：`groups/cli-with-muyu/daily-digest/lib/dedup.ts` 第 18-36 行
- 按 URL（归一化后）和标题精确匹配去重，保留首次出现
- 代码：
  ```typescript
  export function deduplicate(items: RawItem[]): RawItem[] {
    const seenUrls = new Set<string>();
    const seenTitles = new Set<string>();
    for (const item of items) {
      const normalizedUrl = normalizeUrl(item.url);
      if (seenUrls.has(normalizedUrl) || seenTitles.has(item.title)) continue;
      seenUrls.add(normalizedUrl);
      seenTitles.add(item.title);
      result.push(item);
    }
    return result;
  }
  ```

**Step 4: 结果写入**
- 文件：`groups/cli-with-muyu/daily-digest/fetch.ts` 第 89-98 行
- 将去重后的结果写入 `./data/raw.json`，包含生成时间、源总数、条目总数

### 1.3 关键发现

- **不是多 Agent 协作**：整个流程在一个 Agent（Andy）内完成，没有 create_agent 或 send_message 到其他 Agent
- **定时触发**：通过 `schedule_task` MCP 工具设置 cron 表达式（如 `0 9 * * *`），由 host-sweep 的 recurrence 机制触发（见 `src/modules/scheduling/recurrence.ts`）
- **LLM 摘要生成**：抓取脚本只负责获取原始数据，LLM 摘要和分类是在 Agent 容器内通过 prompt 完成的（由 `poll-loop.ts` 调用 provider.query() 处理）
- **数据源配置**：`sources.json` 中配置了 5 个源（Hacker News、Anthropic Blog、OpenAI Blog、量子位、36氪）

---

## 2. Agent-to-Agent 机制（create_agent）的真实工作方式

### 2.1 完整数据流向

```
[Parent Agent 容器]                    [Host Node.js]                     [Child Agent 容器]
     |                                       |                                    |
     | 1. 调用 create_agent MCP 工具          |                                    |
     |-------------------------------------->|                                    |
     |   writeMessageOut({kind:'system',     |                                    |
     |     action:'create_agent', ...})      |                                    |
     |                                       | 2. delivery.ts 轮询到 system msg   |
     |                                       |    handleSystemAction →            |
     |                                       |    registerDeliveryAction('create_agent')
     |                                       |                                    |
     |                                       | 3. create-agent.ts:                |
     |                                       |    - 创建 agent_groups 行          |
     |                                       |    - initGroupFilesystem()         |
     |                                       |    - 创建双向 agent_destinations   |
     |                                       |    - writeDestinations() 更新投影  |
     |                                       |                                    |
     |                                       | 4. notifyAgent() →                 |
     |<--------------------------------------|    writeSessionMessage() 到 parent |
     |   "Agent created. You can now msg..." |    inbound.db + wakeContainer()    |
     |                                       |                                    |
     | 5. Parent 调用 send_message(to="child")|                                    |
     |   writeMessageOut({channel_type:'agent'})                                  |
     |                                       | 6. delivery.ts 看到 channel_type=  |
     |                                       |    'agent' → routeAgentMessage()   |
     |                                       |    → 写入 child inbound.db + wake  |
     |                                       |                                    |
     |                                       |                         | 7. Child 容器唤醒 |
     |                                       |                         | 读取 messages_in |
```

### 2.2 核心代码路径

**容器侧：create_agent MCP 工具定义**
- 文件：`container/agent-runner/src/mcp-tools/agents.ts` 第 31-64 行
- 代码：
  ```typescript
  export const createAgent: McpToolDefinition = {
    tool: {
      name: 'create_agent',
      description: 'Create a long-lived companion sub-agent...',
      inputSchema: { ... },
    },
    async handler(args) {
      const requestId = generateId();
      writeMessageOut({
        id: requestId,
        kind: 'system',
        content: JSON.stringify({
          action: 'create_agent',
          requestId,
          name,
          instructions: (args.instructions as string) || null,
        }),
      });
      return ok(`Creating agent "${name}". You will be notified when it is ready.`);
    },
  };
  ```
- **关键**：容器不直接创建 Agent，而是写入 `messages_out`（`outbound.db`），由 Host 读取后执行

**Host 侧：delivery 处理 system action**
- 文件：`src/delivery.ts` 第 255-257 行、第 410-425 行
- `deliverMessage` 中 `msg.kind === 'system'` 时调用 `handleSystemAction`
- `handleSystemAction` 通过 `registerDeliveryAction` 注册的处理器表分发

**Host 侧：create_agent 处理器**
- 文件：`src/modules/agent-to-agent/create-agent.ts` 第 37-126 行
- 核心逻辑：
  1. 检查名称冲突（`getDestinationByName`）
  2. 生成唯一 folder 名
  3. 创建 `agent_groups` 行（`createAgentGroup`）
  4. 初始化文件系统（`initGroupFilesystem`）— 生成 CLAUDE.local.md
  5. 插入双向 `agent_destinations` 行
  6. 调用 `writeDestinations()` 将新目的地投影到父容器的 `inbound.db`
  7. 调用 `notifyAgent()` 写回通知消息到父容器的 `inbound.db` 并唤醒

**Host 侧：Agent 间消息路由**
- 文件：`src/modules/agent-to-agent/agent-route.ts` 第 162-207 行
- `routeAgentMessage` 函数：
  - 检查权限（`hasDestination`）
  - 解析目标 session（`resolveTargetSession`）— 三层回退：in_reply_to → peer-affinity → newest active
  - 复制附件（`forwardAttachedFiles`）
  - 写入目标 `inbound.db`（`writeSessionMessage`）
  - 唤醒目标容器（`wakeContainer`）

### 2.3 交互设计要点

- **Fire-and-forget**：`create_agent` 调用立即返回，不等待子 Agent 就绪
- **双向目的地**：创建时自动插入双向 `agent_destinations` 行，parent 和 child 互相可见
- **目的地投影**：`agent_destinations` 是中心 DB 的权威数据，但容器通过 `inbound.db` 的 `destinations` 表本地查询，Host 每次 wake 时调用 `writeDestinations()` 同步
- **文件转发**：Agent 间发送文件时，Host 从源 outbox 复制到目标 inbox（`agent-route.ts:54-99`）

---

## 3. Agent 之间是怎么实现路由的？

### 3.1 消息从用户到 Agent 的完整路径

```
[Channel Adapter] → [router.ts:routeInbound] → [Session] → [inbound.db] → [wakeContainer]
```

### 3.2 router.ts 核心流程

**文件**：`src/router.ts` 第 158-342 行

**Step 1: 消息拦截器**
- 第 161 行：`messageInterceptor` — 权限模块用于捕获多步审批流程中的自由文本回复

**Step 2: 线程策略**
- 第 165-168 行：非线程适配器（Telegram、WhatsApp 等）将 threadId 设为 null

**Step 3: 查找/创建 messaging_group**
- 第 176 行：`getMessagingGroupWithAgentCount` — 单次查询获取 messaging_group + 已连接 Agent 数
- 第 180-206 行：如果不存在且是 mention/DM，自动创建

**Step 4: 发送者解析**
- 第 252 行：`senderResolver` — 权限模块注册，用于 upsert users 行

**Step 5: Fan-out 到每个 wired agent**
- 第 277-329 行：遍历 `messaging_group_agents` 中的每个 agent
- 第 281 行：`evaluateEngage()` — 根据 engage_mode 决定是否触发：
  - `pattern`：正则匹配文本
  - `mention`：必须是 mention
  - `mention-sticky`：mention 或已有活跃 session

**Step 6: 访问控制**
- 第 283 行：`accessGate` — 权限模块注册
- 第 284 行：`senderScopeGate` — 检查 sender_scope

**Step 7: 投递到 Agent**
- 第 287 行：`deliverToAgent()` — 第 397-485 行
  - 解析 session（`resolveSession`）
  - 命令门控（`gateCommand`）
  - 写入 `messages_in`（`writeSessionMessage`）
  - 启动 typing indicator
  - 唤醒容器（`wakeContainer`）

### 3.3 关键代码片段

**Fan-out 循环**（`router.ts:277-329`）：
```typescript
for (const agent of agents) {
  const agentGroup = getAgentGroup(agent.agent_group_id);
  const engages = evaluateEngage(agent, messageText, isMention, mg, event.threadId);
  const accessOk = engages && (!accessGate || accessGate(event, userId, mg, agent.agent_group_id).allowed);
  const scopeOk = engages && (!senderScopeGate || senderScopeGate(event, userId, mg, agent).allowed);

  if (engages && accessOk && scopeOk) {
    await deliverToAgent(agent, agentGroup, mg, event, userId, adapter?.supportsThreads === true, true);
    engagedCount++;
  } else if (agent.ignored_message_policy === 'accumulate' && !(engages && (!accessOk || !scopeOk))) {
    await deliverToAgent(agent, agentGroup, mg, event, userId, adapter?.supportsThreads === true, false);
    accumulatedCount++;
  }
}
```

**Session 解析**（`session-manager.ts:92-133`）：
```typescript
export function resolveSession(
  agentGroupId: string,
  messagingGroupId: string | null,
  threadId: string | null,
  sessionMode: 'shared' | 'per-thread' | 'agent-shared',
): { session: Session; created: boolean } {
  if (sessionMode === 'agent-shared') {
    const existing = findSessionByAgentGroup(agentGroupId);
    if (existing) return { session: existing, created: false };
  }
  // ... 创建新 session
}
```

### 3.4 路由设计要点

- **多 Agent fan-out**：一个 messaging group 可以连接多个 agent，每条消息独立评估是否触发每个 agent
- **Session 隔离级别**：
  - `shared`：一个 messaging group 一个 session
  - `per-thread`：每个 thread 一个 session
  - `agent-shared`：一个 agent group 一个 session（跨 messaging group 共享）
- **消息 ID 命名空间**：同一消息 fan-out 到多个 agent 时，ID 附加 agent_group_id 后缀避免冲突（`router.ts:493-496`）

---

## 4. host-sweep 是串行还是并行的唤醒？

### 4.1 结论：串行唤醒

host-sweep 对每个 session **串行**执行 `sweepSession()`，每个 session 内部的 `wakeContainer()` 也是**串行**调用。

### 4.2 核心代码

**文件**：`src/host-sweep.ts` 第 132-145 行

```typescript
async function sweep(): Promise<void> {
  if (!running) return;
  try {
    const sessions = getActiveSessions();
    for (const session of sessions) {
      await sweepSession(session);  // ← 串行 for...await
    }
  } catch (err) {
    log.error('Host sweep error', { err });
  }
  setTimeout(sweep, SWEEP_INTERVAL_MS);
}
```

**文件**：`src/host-sweep.ts` 第 147-212 行

```typescript
async function sweepSession(session: Session): Promise<void> {
  // ...
  const dueCount = countDueMessages(inDb);
  if (dueCount > 0 && !isContainerRunning(session.id)) {
    log.info('Waking container for due messages', { sessionId: session.id, count: dueCount });
    await wakeContainer(session);  // ← 串行 await
  }
  // ...
}
```

### 4.3 wakeContainer 的并发控制

**文件**：`src/container-runner.ts` 第 83-104 行

```typescript
export function wakeContainer(session: Session): Promise<boolean> {
  if (activeContainers.has(session.id)) {
    return Promise.resolve(true);  // 已在运行，直接返回
  }
  const existing = wakePromises.get(session.id);
  if (existing) {
    return existing;  // 已有唤醒在进行中，复用 promise
  }
  const promise = spawnContainer(session)
    .then(() => true)
    .catch((err) => {
      log.warn('wakeContainer failed — host-sweep will retry', { sessionId: session.id, err });
      return false;
    })
    .finally(() => {
      wakePromises.delete(session.id);
    });
  wakePromises.set(session.id, promise);
  return promise;
}
```

### 4.4 设计要点

- **串行设计原因**：
  1. 避免同时 spawn 大量容器导致资源耗尽
  2. SQLite DB 操作（打开、读取、关闭）在每个 session 上是独立的，串行更安全
  3. `wakeContainer` 内部有 `wakePromises` Map 去重，防止同一 session 的并发唤醒

- **Sweep 周期**：60 秒（`SWEEP_INTERVAL_MS = 60_000`）

- **唤醒条件**（`host-sweep.ts:180-186`）：
  - `countDueMessages(inDb) > 0` — 有 pending 且 trigger=1 的消息
  - `!isContainerRunning(session.id)` — 容器未在运行

- **Stuck 检测**（`host-sweep.ts:228-262`）：
  - 绝对上限：heartbeat 超过 30 分钟 → kill
  - 消息级：processing claim 超过 60 秒且 heartbeat 未更新 → kill

---

## 5. 复用 vs 新增建议表

| 功能点 | 当前实现 | 后续开发建议 |
|--------|----------|-------------|
| **定时任务触发** | `schedule_task` MCP 工具 + `recurrence.ts` 的 cron 解析 | 复用。新增 Agent 的定时任务直接调用 `schedule_task`，无需新机制 |
| **数据抓取** | `daily-digest/fetch.ts` 的 sources.json + 多源抓取 | 复用模式。新增数据源只需在 sources.json 添加配置，或创建新的 skill 目录 |
| **LLM 摘要生成** | Agent 容器内通过 prompt 完成 | 复用。poll-loop 的 provider.query() 已支持任意 prompt |
| **消息推送** | `send_message` MCP 工具 → delivery.ts → channel adapter | 复用。任何 Agent 都可以通过 send_message 推送到已配置的 channel |
| **Agent 间协作** | `create_agent` + `agent_destinations` + `routeAgentMessage` | 复用。需要多 Agent 协作时直接调用 create_agent，系统已支持双向通信 |
| **容器唤醒** | `host-sweep.ts` 串行唤醒 + `wakeContainer` 去重 | 复用。无需修改唤醒机制 |
| **Session 管理** | `resolveSession` 的三级隔离模型 | 复用。新增 Agent 组按需求选择 shared/per-thread/agent-shared |
| **文件附件** | `send_file` MCP 工具 + outbox/inbox 目录 | 复用。Agent 间文件转发已通过 `forwardAttachedFiles` 支持 |
| **目的地管理** | `writeDestinations` 投影到 inbound.db | 复用。新增 channel/agent 连接后自动同步 |
| **心跳检测** | `.heartbeat` 文件 mtime | 复用。无需修改 |

### 5.1 关键复用路径

1. **新增一个日报 Agent**：
   - 复制 `groups/cli-with-muyu/` 目录结构
   - 修改 `CLAUDE.local.md` 定义 Agent 人格
   - 修改 `sources.json` 配置数据源
   - 通过 `schedule_task` 设置定时触发
   - 通过 `messaging_group_agents` 表连接到目标 channel

2. **新增一个数据处理 skill**：
   - 在 `groups/<agent>/` 下创建新目录
   - 参考 `daily-digest/fetch.ts` 的 orchestration 模式
   - 使用 `Bun.file()` 和 `Bun.write()` 进行文件 IO
   - 通过 JSON 格式与 Agent prompt 交互

3. **多 Agent 协作链**：
   - Parent Agent 调用 `create_agent` 创建子 Agent
   - 子 Agent 自动获得 `parent` 目的地
   - Parent 通过 `<message to="child-name">` 发送任务
   - 子 Agent 通过 `<message to="parent">` 返回结果
   - Host 的 `routeAgentMessage` 自动处理路由和文件转发

### 5.2 需要注意的约束

- **容器技能发现**：`container/skills/` 下的技能会在容器 spawn 时由 `composeGroupClaudeMd()` 自动扫描。自定义 Agent 工作流指令必须放在这里才能被容器内 Agent 加载（见 `CLAUDE.md` 注意事项）
- **CJK 字体**：Agent 容器默认不含 CJK 字体，如需渲染中文内容需在 `.env` 中设置 `INSTALL_CJK_FONTS=true` 后重建容器
- **OneCLI Secret 模式**：新 Agent 默认创建在 `selective` 模式，需要通过 `onecli agents set-secret-mode` 切换为 `all` 才能访问已有 credential
