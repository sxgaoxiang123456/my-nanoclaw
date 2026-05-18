import { join } from 'path'

const PROGRESS_PATH = join(import.meta.dir, '..', 'data', 'progress.json')

/**
 * Atomically write progress state to progress.json using temp file + rename.
 */
export async function writeProgress(state: ProgressJson): Promise<void> {
  const tempPath = PROGRESS_PATH + '.tmp'
  await Bun.write(tempPath, JSON.stringify(state, null, 2))
  await Bun.write(PROGRESS_PATH, Bun.file(tempPath))
  try {
    await Bun.file(tempPath).delete()
  } catch {
    // ignore cleanup failure
  }
}

/**
 * Read and parse progress.json. Returns null if file doesn't exist.
 */
export async function readProgress(): Promise<ProgressJson | null> {
  const file = Bun.file(PROGRESS_PATH)
  const exists = await file.exists()
  if (!exists) return null

  try {
    const text = await file.text()
    return JSON.parse(text) as ProgressJson
  } catch {
    return null
  }
}

// Re-export types
export type { ProgressJson, AgentStatus, PlatformArticle } from './types'
