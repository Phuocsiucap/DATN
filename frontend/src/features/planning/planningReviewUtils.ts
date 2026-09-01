import type { ProfileSeriesReview, ReviewSourceContent, StoryScene } from '@/commons/apis/planning'

export function getArticleStoryData(article: ProfileSeriesReview['articles'][number]): StoryScene[] {
  return article.story_data || article.plan?.story_data || article.plan?.draft_json?.story_data || []
}

export function sourceCategoryId(source?: ReviewSourceContent | null): string {
  if (!source) return ''
  const metadata = source.source_metadata || {}
  return String(source.categoryId || source.category_id || source.normalized?.categoryId || metadata.categoryId || metadata.category_id || '')
}
