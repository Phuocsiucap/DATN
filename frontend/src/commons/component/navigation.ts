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
  settings: '/settings',
}
