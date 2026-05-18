import { join } from 'path'
import type { PlatformArticle } from './types.js'

const SENT_ARTICLES_PATH = join(import.meta.dir, '..', 'data', 'sent-articles.jsonl')

/**
 * Append articles to sent-articles.jsonl (JSON Lines format).
 */
export async function writeSentArticles(articles: PlatformArticle[]): Promise<void> {
  if (articles.length === 0) return

  const lines = articles.map((a) => JSON.stringify(a)).join('\n') + '\n'
  const file = Bun.file(SENT_ARTICLES_PATH)
  const exists = await file.exists()

  if (exists) {
    const existing = await file.text()
    await Bun.write(SENT_ARTICLES_PATH, existing + lines)
  } else {
    await Bun.write(SENT_ARTICLES_PATH, lines)
  }
}

/**
 * Read all sent articles from sent-articles.jsonl.
 */
export async function readSentArticles(): Promise<PlatformArticle[]> {
  const file = Bun.file(SENT_ARTICLES_PATH)
  const exists = await file.exists()
  if (!exists) return []

  const text = await file.text()
  const articles: PlatformArticle[] = []

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      articles.push(JSON.parse(trimmed) as PlatformArticle)
    } catch {
      console.warn(`[results] Failed to parse line: ${trimmed.slice(0, 100)}`)
    }
  }

  return articles
}

// CLI
if (import.meta.main) {
  const [command, ...args] = process.argv.slice(2)

  try {
    switch (command) {
      case 'write': {
        const json = args.join(' ')
        if (!json) throw new Error('articles JSON array is required')
        await writeSentArticles(JSON.parse(json))
        console.log(JSON.stringify({ success: true }))
        break
      }
      case 'read': {
        const articles = await readSentArticles()
        console.log(JSON.stringify(articles))
        break
      }
      default:
        console.error('Usage: bun results.ts <write|read> [args...]')
        process.exit(1)
    }
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  }
}
