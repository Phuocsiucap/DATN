import { useCallback, useEffect, useState } from 'react'
import { fetchVideoWorkspaceApi, type VideoWorkspaceDetail } from '@/commons/apis/generateVideo'
import BilibiliTranslationWorkflowPage from './bilibili-translation/BilibiliTranslationWorkflowPage'
import VideoProductionWorkspace from './VideoProductionWorkspace'

type Props = {
  workflowId: string
  onBackToList: () => void
}

const isBilibiliTranslationWorkflow = (workspace: VideoWorkspaceDetail | null) => {
  const metadata = workspace?.metadata || {}
  return metadata.creation_source === 'BILIBILI_TRANSLATION'
    || metadata.workflow_type === 'ORIGINAL_VIDEO_HARDSUB'
    || String(metadata.source_type || '').toUpperCase() === 'BILIBILI'
}

export default function MediaWorkflowWorkspaceRouter({ workflowId, onBackToList }: Props) {
  const [workspace, setWorkspace] = useState<VideoWorkspaceDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadWorkspace = useCallback(async () => {
    setError(null)
    const data = await fetchVideoWorkspaceApi(workflowId)
    setWorkspace(data)
  }, [workflowId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setWorkspace(null)
    setError(null)
    loadWorkspace()
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Không tải được workflow.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [loadWorkspace])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--on-surface-variant)]">Đang mở workspace...</div>
  }

  if (error || !workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-sm text-[var(--on-surface-variant)]">
        <p>{error || 'Không tìm thấy workflow.'}</p>
        <div className="flex gap-2">
          <button type="button" onClick={() => void loadWorkspace().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Không tải được workflow.'))} className="rounded-md border border-[var(--border)] px-3 py-2 text-[var(--on-surface)]">Thử lại</button>
          <button type="button" onClick={onBackToList} className="rounded-md border border-[var(--border)] px-3 py-2 text-[var(--on-surface)]">Quay lại</button>
        </div>
      </div>
    )
  }

  if (isBilibiliTranslationWorkflow(workspace)) {
    return <BilibiliTranslationWorkflowPage workflowId={workflowId} initialWorkspace={workspace} onBackToList={onBackToList} />
  }

  return <VideoProductionWorkspace workflowId={workflowId} onBackToList={onBackToList} />
}
