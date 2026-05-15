/**
 * 源配置
 */
export interface SourceConfig {
  /** 源唯一标识，如 "anthropic-blog" */
  id: string;
  /** 显示名称，如 "Anthropic Blog" */
  name: string;
  /** 源类型 */
  type: 'api' | 'rss';
  /** 抓取地址 */
  url: string;
  /** 分类倾向提示，如 "ai-model" */
  categoryHint: string;
  /** 最大抓取条数 */
  fetchLimit: number;
}

/**
 * 源配置集合
 */
export interface SourcesConfig {
  /** 配置版本号 */
  version: number;
  /** 源配置列表 */
  sources: SourceConfig[];
}

/**
 * 原始条目（去重前）
 */
export interface RawItem {
  /** 如 "hn-0" */
  id: string;
  /** 文章标题 */
  title: string;
  /** 原文链接 */
  url: string;
  /** 来源显示名称 */
  source: string;
  /** 来源 ID */
  sourceId: string;
  /** ISO 8601 格式 */
  publishedAt: string;
  /** RSS 摘要 */
  description?: string;
  /** HN 投票数（仅 HN） */
  score?: number;
  /** 分类倾向提示 */
  categoryHint: string;
}

/**
 * 抓取结果（去重后）
 */
export interface FetchResult {
  /** ISO 8601 */
  generatedAt: string;
  /** 配置源总数 */
  totalSources: number;
  /** 去重后条目数 */
  totalItems: number;
  /** 去重后的原始条目 */
  items: RawItem[];
}

/**
 * 日报条目
 */
export interface DigestItem {
  /** 文章标题 */
  title: string;
  /** 2~3 句话核心摘要 */
  summary: string;
  /** 原文链接 */
  url: string;
  /** 来源显示名称 */
  source: string;
}

/**
 * 日报板块
 */
export interface Section {
  /** 板块名称，如 "AI 大模型进展" */
  name: string;
  /** 板块内条目 */
  items: DigestItem[];
}

/**
 * 日报（LLM 输出格式）
 */
export interface DailyDigest {
  /** ISO 8601 */
  generatedAt: string;
  /** 日报板块列表 */
  sections: Section[];
}
