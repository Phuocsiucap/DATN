import { useEffect, useState } from 'react'
import { fetchVideoWorkspaceApi, type VideoWorkspaceDetail } from '@/commons/apis/generateVideo'
import BilibiliTranslationWorkflowPage from './bilibili-translation/BilibiliTranslationWorkflowPage'
import VideoProductionWorkspace from './VideoProductionWorkspace'

type Props = {
  workflowId: string
  onBackToList: () => void
}

const isBilibiliTranslationWorkflow = (workspace: VideoWorkspaceDetail | null) => {
  const metadata = workspace?.metadata || {}
  return metadata.creation_source === 'BILIBILI_TRANSLATION' || metadata.source_type === 'BILIBILI'
}

export default function MediaWorkflowWorkspaceRouter({ workflowId, onBackToList }: Props) {
  const [workspace, setWorkspace] = useState<VideoWorkspaceDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    fetchVideoWorkspaceApi(workflowId)
      .then((data) => {
        if (!cancelled) setWorkspace(data)
      })
      .catch(() => {
        if (!cancelled) setWorkspace(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [workflowId])

  if (loading) {
    return <div className="flex h-full items-center justify-center text-sm text-[var(--on-surface-variant)]">Đang mở workspace...</div>
  }

  if (isBilibiliTranslationWorkflow(workspace)) {
    return <BilibiliTranslationWorkflowPage workflowId={workflowId} onBackToList={onBackToList} />
  }

  return <VideoProductionWorkspace workflowId={workflowId} onBackToList={onBackToList} />
}
