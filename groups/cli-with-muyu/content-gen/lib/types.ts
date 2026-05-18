/**
 * Agent execution status
 */
export interface AgentExecutionStatus {
  agentName: string
  status: 'queued' | 'running' | 'completed' | 'failed'
  stage?: string
  progress?: number
  startedAt?: string
  completedAt?: string
  error?: string
}

/**
 * Research report output from Researcher Agent
 */
export interface ResearchReport {
  topic: string
  summary: string
  keyPoints: string[]
  dataSources?: string[]
  writingAngles: string[]
  wordCount?: number
}

/**
 * Platform article output from Writer Agent
 */
export interface PlatformArticle {
  taskId: string
  platform: 'xiaohongshu' | 'wechat' | 'weibo'
  title: string
  content: string
  wordCount: number
  durationMs?: number
  styleGuide?: string
}

/**
 * Publish record (mock)
 */
export interface PublishRecord {
  taskId: string
  platform: 'xiaohongshu' | 'wechat' | 'weibo'
  status: 'pending' | 'publishing' | 'published' | 'failed'
  attemptedAt?: string
  publishedAt?: string
  error?: string
  mockUrl?: string
}

/**
 * Content generation task status stored in progress.json
 */
export interface ProgressJson {
  taskId: string
  topic: string
  status: 'idle' | 'researching' | 'writing' | 'completed' | 'failed'
  startedAt: string
  completedAt?: string
  totalDurationMs?: number
  coordinatorStatus: AgentExecutionStatus
  researcherStatus: AgentExecutionStatus
  writerStatuses: AgentExecutionStatus[]
  results: {
    xiaohongshu?: PlatformArticle | null
    wechat?: PlatformArticle | null
    weibo?: PlatformArticle | null
  }
}

/**
 * API response for GET /api/content-generation
 */
export interface ContentGenerationResponse {
  taskId: string | null
  topic: string | null
  status: 'idle' | 'researching' | 'writing' | 'completed' | 'failed'
  startedAt: string | null
  completedAt?: string | null
  agents: Record<string, AgentExecutionStatus>
  results: {
    xiaohongshu?: PlatformArticle | null
    wechat?: PlatformArticle | null
    weibo?: PlatformArticle | null
  }
}

/**
 * API request for POST /api/content-generation/publish
 */
export interface PublishRequest {
  taskId: string
  platform: 'xiaohongshu' | 'wechat' | 'weibo'
}

/**
 * API response for POST /api/content-generation/publish
 */
export interface PublishResponse {
  success: boolean
  platform: 'xiaohongshu' | 'wechat' | 'weibo'
  publishedAt?: string
  mockUrl?: string
  error?: string
}
