/**
 * Researcher Agent runner for multi-platform content generation.
 * Provides research output formatting and progress update helpers.
 *
 * Usage: bun runner.ts <command> [args...]
 */
import { writeProgress, readProgress } from '../lib/progress.js'
import type { ProgressJson, ResearchReport } from '../lib/types.js'

const COMMANDS = ['updateStatus', 'saveReport'] as const

/**
 * Update researcher status in progress.json.
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
  const updated: ProgressJson = {
    ...existing,
    researcherStatus: {
      ...existing.researcherStatus,
      status,
      stage: options.stage ?? existing.researcherStatus.stage,
      progress: options.progress ?? existing.researcherStatus.progress,
      error: options.error ?? existing.researcherStatus.error,
      startedAt: status === 'running' ? now : existing.researcherStatus.startedAt,
      completedAt: status === 'completed' || status === 'failed' ? now : existing.researcherStatus.completedAt,
    },
  }

  writeProgress(updated)
  return updated
}

/**
 * Save research report and mark researcher as completed.
 * Also advances overall status to 'writing'.
 */
export function saveReport(taskId: string, report: ResearchReport): ProgressJson {
  const existing = readProgress()
  if (!existing || existing.taskId !== taskId) {
    throw new Error(`Task ${taskId} not found`)
  }

  const now = new Date().toISOString()

  // Save report to a separate file for writers to read
  const reportPath = `${import.meta.dir}/../data/research-report-${taskId}.json`
  Bun.write(reportPath, JSON.stringify(report, null, 2))

  const updated: ProgressJson = {
    ...existing,
    status: 'writing',
    researcherStatus: {
      ...existing.researcherStatus,
      status: 'completed',
      stage: '研究完成',
      progress: 100,
      completedAt: now,
    },
    coordinatorStatus: {
      ...existing.coordinatorStatus,
      stage: '调度 Writers',
    },
  }

  writeProgress(updated)
  return updated
}

/**
 * Read the saved research report for a task.
 */
export function readReport(taskId: string): ResearchReport | null {
  const reportPath = `${import.meta.dir}/../data/research-report-${taskId}.json`
  const file = Bun.file(reportPath)
  if (!file.exists()) return null
  try {
    return JSON.parse(file.text()) as ResearchReport
  } catch {
    return null
  }
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
      case 'saveReport': {
        const [taskId, jsonReport] = args
        if (!taskId || !jsonReport) throw new Error('taskId and report JSON are required')
        console.log(JSON.stringify(saveReport(taskId, JSON.parse(jsonReport))))
        break
      }
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
