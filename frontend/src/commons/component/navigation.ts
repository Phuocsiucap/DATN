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
  | 'openaiUsage'

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
  openaiUsage: '/admin/openai-usage',
}
