/**
 * Weibo Writer Agent runner.
 * Provides article formatting and progress update helpers.
 *
 * Usage: bun runner.ts <command> [args...]
 */
import { writeProgress, readProgress } from '../lib/progress.js'
import type { ProgressJson, PlatformArticle } from '../lib/types.js'

const COMMANDS = ['updateStatus', 'saveArticle'] as const
const PLATFORM = 'weibo' as const
const AGENT_NAME = 'writer-weibo' as const

/**
 * Update writer status in progress.json.
 */
export function updateStatus(
  taskId: string,
  status: 'queued' | 'running' | 'completed' | 'failed',
  options: { stage?: string; progress?: number; error?: string } = {}
): ProgressJson {
  const existing = readProgress()
  if (!existing || existing.taskId !== taskId) {
    throw new Error(`Task ${taskId} not found`)
  }

  const now = new Date().toISOString()
  const updatedWriterStatuses = existing.writerStatuses.map((w) => {
    if (w.agentName === AGENT_NAME) {
      return {
        ...w,
        status,
        stage: options.stage ?? w.stage,
        progress: options.progress ?? w.progress,
        error: options.error ?? w.error,
        startedAt: status === 'running' ? now : w.startedAt,
        completedAt: status === 'completed' || status === 'failed' ? now : w.completedAt,
      }
    }
    return w
  })

  const updated: ProgressJson = {
    ...existing,
    writerStatuses: updatedWriterStatuses,
  }

  writeProgress(updated)
  return updated
}

/**
 * Save article and mark writer as completed.
 */
export function saveArticle(taskId: string, article: Omit<PlatformArticle, 'taskId' | 'platform'>): ProgressJson {
  const existing = readProgress()
  if (!existing || existing.taskId !== taskId) {
    throw new Error(`Task ${taskId} not found`)
  }

  const now = new Date().toISOString()
  const fullArticle: PlatformArticle = {
    taskId,
    platform: PLATFORM,
    ...article,
  }

  const updatedWriterStatuses = existing.writerStatuses.map((w) => {
    if (w.agentName === AGENT_NAME) {
      return {
        ...w,
        status: 'completed' as const,
        stage: '写作完成',
        progress: 100,
        completedAt: now,
      }
    }
    return w
  })

  const allDone = updatedWriterStatuses.every((w) => w.status === 'completed' || w.status === 'failed')

  const updated: ProgressJson = {
    ...existing,
    status: allDone ? 'completed' : existing.status,
    completedAt: allDone ? now : existing.completedAt,
    totalDurationMs: allDone ? Date.now() - new Date(existing.startedAt).getTime() : existing.totalDurationMs,
    writerStatuses: updatedWriterStatuses,
    results: {
      ...existing.results,
      [PLATFORM]: fullArticle,
    },
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
      case 'updateStatus': {
        const [taskId, status, jsonOptions] = args
        if (!taskId || !status) throw new Error('taskId and status are required')
        const options = jsonOptions ? JSON.parse(jsonOptions) : {}
        console.log(JSON.stringify(updateStatus(taskId, status as any, options)))
        break
      }
      case 'saveArticle': {
        const [taskId, jsonArticle] = args
        if (!taskId || !jsonArticle) throw new Error('taskId and article JSON are required')
        console.log(JSON.stringify(saveArticle(taskId, JSON.parse(jsonArticle))))
        break
      }
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
