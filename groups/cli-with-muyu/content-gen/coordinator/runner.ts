/**
 * Coordinator Agent runner for multi-platform content generation.
 * Provides intent parsing, progress management, and workflow orchestration helpers.
 *
 * Usage: bun runner.ts <command> [args...]
 */
import { writeProgress, readProgress } from '../lib/progress.js'
import type { ProgressJson, AgentExecutionStatus } from '../lib/types.js'

const COMMANDS = ['parseIntent', 'initProgress', 'updateProgress', 'checkTask', 'finalizeResults'] as const

/**
 * Parse user message for content generation intent.
 * Returns { topic: string | null, isGenerateRequest: boolean }
 */
export function parseIntent(message: string): { topic: string | null; isGenerateRequest: boolean } {
  const trimmed = message.trim()

  // Command prefix: /generate <topic>
  const cmdMatch = trimmed.match(/^\/generate\s+(.+)$/i)
  if (cmdMatch) {
    return { topic: cmdMatch[1].trim(), isGenerateRequest: true }
  }

  // Natural language patterns
  const patterns = [
    /(?:帮我|给我)?(?:写|生成|创作|编)?(?:一篇|一个|一段)?(?:关于|有关)?(.+?)(?:的)?(?:文章|文案|内容|帖子|笔记)/i,
    /(?:写|生成|创作)(?:一篇|一个|一段)?(.+?)(?:的)?(?:文章|文案|内容)/i,
    /^(?:生成|创作|写)\s+(.+)$/i,
  ]

  for (const pattern of patterns) {
    const match = trimmed.match(pattern)
    if (match) {
      return { topic: match[1].trim(), isGenerateRequest: true }
    }
  }

  return { topic: null, isGenerateRequest: false }
}

/**
 * Initialize a new content generation task.
 */
export function initProgress(topic: string): ProgressJson {
  const now = new Date().toISOString()
  const taskId = `cg-${now.replace(/[:.]/g, '').slice(0, 14)}-${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`

  const state: ProgressJson = {
    taskId,
    topic,
    status: 'researching',
    startedAt: now,
    coordinatorStatus: { agentName: 'coordinator', status: 'running', stage: '初始化任务' },
    researcherStatus: { agentName: 'researcher', status: 'queued', stage: '等待启动' },
    writerStatuses: [
      { agentName: 'writer-xiaohongshu', status: 'queued', stage: '等待研究完成', progress: 0 },
      { agentName: 'writer-wechat', status: 'queued', stage: '等待研究完成', progress: 0 },
      { agentName: 'writer-weibo', status: 'queued', stage: '等待研究完成', progress: 0 },
    ],
    results: { xiaohongshu: null, wechat: null, weibo: null },
  }

  writeProgress(state)
  return state
}

/**
 * Update progress state. Merges partial updates.
 */
export function updateProgress(partial: Partial<ProgressJson> & { taskId: string }): ProgressJson {
  const existing = readProgress()
  if (!existing || existing.taskId !== partial.taskId) {
    throw new Error(`Task ${partial.taskId} not found`)
  }

  const updated: ProgressJson = {
    ...existing,
    ...partial,
    coordinatorStatus: { ...existing.coordinatorStatus, ...(partial.coordinatorStatus || {}) },
    researcherStatus: { ...existing.researcherStatus, ...(partial.researcherStatus || {}) },
    writerStatuses: partial.writerStatuses || existing.writerStatuses,
    results: { ...existing.results, ...(partial.results || {}) },
  }

  writeProgress(updated)
  return updated
}

/**
 * Check if there's an active task (researching or writing).
 */
export function checkTask(): ProgressJson | null {
  const progress = readProgress()
  if (!progress) return null
  if (progress.status === 'researching' || progress.status === 'writing') {
    return progress
  }
  return null
}

/**
 * Finalize results after all writers complete.
 */
export function finalizeResults(taskId: string): ProgressJson {
  const existing = readProgress()
  if (!existing || existing.taskId !== taskId) {
    throw new Error(`Task ${taskId} not found`)
  }

  const completedAt = new Date().toISOString()
  const started = new Date(existing.startedAt).getTime()
  const totalDurationMs = Date.now() - started

  // Count successes
  const results = existing.results
  const successCount = [results.xiaohongshu, results.wechat, results.weibo].filter(Boolean).length

  const updated: ProgressJson = {
    ...existing,
    status: successCount > 0 ? (successCount === 3 ? 'completed' : 'failed') : 'failed',
    completedAt,
    totalDurationMs,
    coordinatorStatus: { ...existing.coordinatorStatus, status: 'completed', stage: '任务完成' },
  }

  writeProgress(updated)
  return updated
}

// CLI
if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2)

  if (!command || !COMMANDS.includes(command as typeof COMMANDS[number])) {
    console.error(`Usage: bun runner.ts <${COMMANDS.join('|')}> [args...]`)
    process.exit(1)
  }

  try {
    switch (command) {
      case 'parseIntent': {
        const message = args.join(' ') || ''
        console.log(JSON.stringify(parseIntent(message)))
        break
      }
      case 'initProgress': {
        const topic = args.join(' ') || ''
        if (!topic) throw new Error('topic is required')
        console.log(JSON.stringify(initProgress(topic)))
        break
      }
      case 'updateProgress': {
        const json = args.join(' ')
        if (!json) throw new Error('JSON partial update is required')
        console.log(JSON.stringify(updateProgress(JSON.parse(json))))
        break
      }
      case 'checkTask': {
        console.log(JSON.stringify(checkTask()))
        break
      }
      case 'finalizeResults': {
        const taskId = args[0]
        if (!taskId) throw new Error('taskId is required')
        console.log(JSON.stringify(finalizeResults(taskId)))
        break
      }
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
