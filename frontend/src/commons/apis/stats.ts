import { api, isSocialContentApiBase } from './client'

type ApiItem = Record<string, unknown>

export const fetchStatsApi = async () => {
  if (isSocialContentApiBase()) {
    const [contentsResult, profilesResult, queueResult] = await Promise.allSettled([
      api.get('/contents'),
      api.get('/social-profiles'),
      api.get('/social-profiles/queue/items'),
    ])
    const contents: ApiItem[] =
      contentsResult.status === 'fulfilled' && Array.isArray(contentsResult.value.data) ? contentsResult.value.data : []
    const profiles: ApiItem[] =
      profilesResult.status === 'fulfilled' && Array.isArray(profilesResult.value.data?.items) ? profilesResult.value.data.items : []
    const queue: ApiItem[] =
      queueResult.status === 'fulfilled' && Array.isArray(queueResult.value.data?.items) ? queueResult.value.data.items : []
    const queueStatus = queue.reduce<Record<string, number>>((acc, item) => {
      const key = String(item.status || 'unknown').toLowerCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    const byPlatform = profiles.reduce<Record<string, number>>((acc, item) => {
      const key = String(item.platform || 'unknown').toLowerCase()
      acc[key] = (acc[key] || 0) + 1
      return acc
    }, {})
    return {
      scope: 'user',
      total_articles: contents.length,
      crawled_last_24h: 0,
      crawled_last_1h: 0,
      published_total: queueStatus.published || 0,
      published_failed: queueStatus.failed || 0,
      by_platform: byPlatform,
      profiles_total: profiles.length,
      profiles_active: profiles.filter((item) => String(item.status || '').toLowerCase() === 'active').length,
      queue_status: {
        upcoming: (queueStatus.queued || 0) + (queueStatus.approved || 0),
        needs_approval: queueStatus.pending || 0,
        ...queueStatus,
      },
      ai_matches_total: contents.length,
      social_posts_total: queue.length,
      users_total: undefined,
      users_active: undefined,
      feed_matched: contents.length,
      feed_low_suggestions: contents.filter((item) => Number(item.quality_score || 0) < 60).length,
    }
  }
  const { data } = await api.get('/stats')
  return data
}
