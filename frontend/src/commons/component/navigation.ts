export type Tab =
  | 'dashboard'
  | 'crawl'
  | 'content'
  | 'planning'
  | 'generateVideo'
  | 'approvals'
  | 'schedule'
  | 'publishedPosts'
  | 'users'
  | 'settings'
  | 'profile'
  | 'openaiUsage'
  | 'deepseekUsage'
  | 'auditLogs'
  | 'contentItems'

export const TAB_PATHS: Record<Tab, string> = {
  dashboard: '/',
  crawl: '/crawl',
  content: '/content',
  planning: '/planning',
  generateVideo: '/generate-video',
  approvals: '/approvals',
  schedule: '/schedule',
  publishedPosts: '/published-posts',
  users: '/users',
  settings: '/social-account',
  profile: '/profile',
  openaiUsage: '/admin/openai-usage',
  deepseekUsage: '/admin/deepseek-usage',
  auditLogs: '/admin/audit-logs',
  contentItems: '/admin/content-items',
}

export const ADMIN_DASHBOARD_PATH = '/admin/dashboard'
export const CREATOR_DASHBOARD_PATH = '/creator/dashboard'
