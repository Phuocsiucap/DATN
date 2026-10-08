export type Tab =
  | 'dashboard'
  | 'crawl'
  | 'content'
  | 'storyStatus'
  | 'planning'
  | 'generateVideo'
  | 'approvals'
  | 'schedule'
  | 'aiManagement'
  | 'publishedPosts'
  | 'tiktokShop'
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
  storyStatus: '/stories/status',
  planning: '/planning',
  generateVideo: '/generate-video',
  approvals: '/approvals',
  schedule: '/schedule',
  aiManagement: '/ai-management',
  publishedPosts: '/published-posts',
  tiktokShop: '/tiktok-shop',
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
