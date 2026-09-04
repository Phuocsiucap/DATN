export const API_CACHE_TAG_TYPES = [
  'General',
  'Auth',
  'Users',
  'Scheduler',
  'Stats',
  'CrawlJobs',
  'Contents',
  'SourceTypes',
  'SocialProfiles',
  'ProfileStrategy',
  'PublishingQueue',
  'SocialPosts',
  'Analytics',
  'MediaWorkflows',
  'GenerateVideo',
  'ContentSeries',
  'PlanningRuns',
  'OpenAiUsage',
] as const

export type ApiCacheTag = (typeof API_CACHE_TAG_TYPES)[number]
export type MutationInvalidation = 'all' | ApiCacheTag[]

const uniqueTags = (...groups: ApiCacheTag[][]) => [...new Set(groups.flat())]

export const normalizeApiPath = (url: string) => {
  const withoutOrigin = url.replace(/^[a-z][a-z\d+.-]*:\/\/[^/]+/i, '')
  const withoutQuery = withoutOrigin.split(/[?#]/, 1)[0] || '/'
  const apiPath = withoutQuery.replace(/^\/api\/v\d+(?=\/|$)/, '')
  return apiPath || '/'
}

export const isVolatileGetPath = (url: string) => {
  const path = normalizeApiPath(url)
  return [
    /^\/stats(?:\/|$)/,
    /^\/crawl-jobs(?:\/|$)/,
    /^\/planning-runs(?:\/|$)/,
    /^\/generate-video\/render-jobs(?:\/|$)/,
    /^\/media-workflows\/video-workspace(?:\/|$)/,
    /^\/media-workflows\/[^/]+\/(?:progress|workspace)(?:\/|$)/,
    /^\/social-profiles\/queue(?:\/|$)/,
    /\/(?:progress|status)(?:\/|$)/,
  ].some((pattern) => pattern.test(path))
}

export const getTagsForGet = (url: string): ApiCacheTag[] => {
  const path = normalizeApiPath(url)

  if (/^\/auth(?:\/|$)/.test(path)) return ['Auth']
  if (/^\/users(?:\/|$)/.test(path)) return ['Users']
  if (/^\/admin\/settings\/scheduler(?:\/|$)/.test(path)) return ['Scheduler']
  if (/^\/admin\/system\/openai-usage(?:\/|$)/.test(path)) return ['OpenAiUsage']
  if (/^\/stats(?:\/|$)/.test(path)) return ['Stats']
  if (/^\/crawl-jobs(?:\/|$)/.test(path)) return ['CrawlJobs']
  if (/^\/source-types(?:\/|$)/.test(path)) return ['SourceTypes']
  if (/^\/contents(?:\/|$)/.test(path)) return ['Contents']

  if (/^\/social-profiles\/queue(?:\/|$)/.test(path) || /^\/social-profiles\/[^/]+\/queue(?:\/|$)/.test(path)) {
    return ['PublishingQueue']
  }
  if (/^\/social-profiles\/[^/]+\/posts(?:\/|$)/.test(path)) return ['SocialPosts']
  if (/^\/social-profiles\/[^/]+\/strategy(?:\/|$)/.test(path)) return ['ProfileStrategy']
  if (/^\/social-profiles(?:\/|$)/.test(path)) return ['SocialProfiles']

  if (/^\/analytics(?:\/|$)/.test(path)) return ['Analytics']
  if (/^\/generate-video(?:\/|$)/.test(path)) return ['GenerateVideo']
  if (/^\/media-workflows(?:\/|$)/.test(path)) return ['MediaWorkflows']
  if (/^\/content-series(?:\/|$)/.test(path) || /^\/profile\/[^/]+\/content-series(?:\/|$)/.test(path)) {
    return ['ContentSeries']
  }
  if (/^\/profile\/[^/]+\/series-review(?:\/|$)/.test(path)) {
    return ['ContentSeries', 'MediaWorkflows', 'PlanningRuns']
  }
  if (/^\/planning-runs(?:\/|$)/.test(path)) return ['PlanningRuns']

  return ['General']
}

const workflowTags: ApiCacheTag[] = [
  'GenerateVideo',
  'MediaWorkflows',
  'ContentSeries',
  'PlanningRuns',
]

const publishingTags: ApiCacheTag[] = [
  'PublishingQueue',
  'SocialPosts',
  'Analytics',
  'Contents',
  'Stats',
]

export const getInvalidationForMutation = (url: string): MutationInvalidation => {
  const path = normalizeApiPath(url)

  if (/^\/auth(?:\/|$)/.test(path)) return 'all'

  if (/^\/users(?:\/|$)/.test(path)) return ['Users', 'Auth', 'Stats']
  if (/^\/admin\/settings\/scheduler\/publish-queue\/run-once(?:\/|$)/.test(path)) {
    return uniqueTags(['Scheduler', 'MediaWorkflows'], publishingTags)
  }
  if (/^\/admin\/settings\/scheduler(?:\/|$)/.test(path)) return ['Scheduler']

  if (/^\/(?:crawl-jobs|publish\/crawl-now)(?:\/|$)/.test(path)) {
    return uniqueTags(['CrawlJobs', 'Contents', 'Stats'], workflowTags)
  }

  if (/^\/social-profiles\/queue(?:\/|$)/.test(path)) {
    return uniqueTags(publishingTags, ['MediaWorkflows'])
  }

  if (/^\/social-profiles\/[^/]+\/strategy(?:\/|$)/.test(path)) {
    return ['ProfileStrategy', 'ContentSeries', 'PlanningRuns']
  }

  if (/^\/social-profiles(?:\/|$)/.test(path)) {
    return uniqueTags(
      ['SocialProfiles', 'ProfileStrategy', 'SocialPosts', 'Analytics', 'Stats'],
      workflowTags,
    )
  }

  if (/^\/content-series(?:\/|$)/.test(path)) {
    return ['ContentSeries', 'MediaWorkflows', 'PlanningRuns']
  }

  if (/^\/planning-runs(?:\/|$)/.test(path)) return workflowTags

  if (/^\/(?:generate-video|media-workflows)(?:\/|$)/.test(path)) {
    return uniqueTags(workflowTags, publishingTags)
  }

  // Unknown mutations are uncommon and potentially cross-cutting. Resetting
  // is safer than serving stale data without a declared relationship.
  return 'all'
}
