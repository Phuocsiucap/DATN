export type Tab =
  | 'dashboard'
  | 'crawl'
  | 'content'
  | 'planning'
  | 'generateVideo'
  | 'approvals'
  | 'schedule'
  | 'publishedPosts'
  | 'analyticsAccounts'
  | 'analyticsPosts'
  | 'users'
  | 'settings'
  | 'profile'
  | 'openaiUsage'
  | 'deepseekUsage'
  | 'auditLogs'

export const TAB_PATHS: Record<Tab, string> = {
  dashboard: '/',
  crawl: '/crawl',
  content: '/content',
  planning: '/planning',
  generateVideo: '/generate-video',
  approvals: '/approvals',
  schedule: '/schedule',
  publishedPosts: '/published-posts',
  analyticsAccounts: '/analytics/accounts',
  analyticsPosts: '/analytics/posts',
  users: '/users',
  settings: '/settings',
  profile: '/profile',
  openaiUsage: '/admin/openai-usage',
  deepseekUsage: '/admin/deepseek-usage',
  auditLogs: '/admin/audit-logs',
}

export const ADMIN_DASHBOARD_PATH = '/admin/dashboard'
export const CREATOR_DASHBOARD_PATH = '/creator/dashboard'
