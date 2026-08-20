import { useEffect, useState } from 'react';
import ReactPlayer from 'react-player';
import {
  X, Calendar, Link as LinkIcon, Image as ImageIcon, Video as VideoIcon,
  Loader2, FileText, Sparkles, ArrowRight, CheckCircle, AlertCircle, ChevronDown
} from 'lucide-react';
import type { Article } from '@/commons/store/slices/articlesSlice';
import { fetchArticleDetailApi, createContentProjectFromSourcesApi, createProjectRunApi, type PlanningProfile } from '@/commons/apis/api';
import { fetchSocialProfilesApi } from '@/commons/apis/socialProfiles';

interface ArticleDetailModalProps {
  article: Article;
  onClose: () => void;
  workspaceMode?: string;
}

export default function ArticleDetailModal({ article: initialArticle, onClose }: ArticleDetailModalProps) {
  const [article, setArticle] = useState<Article>(initialArticle);
  const [loading, setLoading] = useState<boolean>(true);
  const [sendingToModule2, setSendingToModule2] = useState(false);
  const [module2Result, setModule2Result] = useState<{ success: boolean; message: string } | null>(null);
  const [profiles, setProfiles] = useState<PlanningProfile[]>([]);
  const [selectedProfileId, setSelectedProfileId] = useState('');

  useEffect(() => {
    const targetId = initialArticle.id || initialArticle.link;
    if (targetId) {
      setLoading(true);
      fetchArticleDetailApi(targetId)
        .then(data => setArticle({ ...initialArticle, ...data, status: (data as Partial<Article>).status || initialArticle.status }))
        .catch(err => console.error('Failed to load article detail:', err))
        .finally(() => setLoading(false));
    }
    // Load planning profiles
    fetchSocialProfilesApi()
      .then((res: any) => {
        const items = res?.items || res || []
        setProfiles(items)
        if (items.length > 0) setSelectedProfileId(items[0].id)
      })
      .catch(() => setProfiles([]))
  }, [initialArticle]);

  const handleSendToModule2 = async () => {
    if (!article.id || !selectedProfileId) return;
    setSendingToModule2(true);
    setModule2Result(null);
    try {
      const project = await createContentProjectFromSourcesApi({
        profile_id: selectedProfileId,
        content_ids: [article.id],
        selection_mode: 'MANUAL',
        candidate_limit: 1,
        title: article.title || 'Content project',
        note: `Chuyển thủ công từ Global Content Store: "${article.title}"`,
        filters: {
          manual_direct_script: true,
          bypass_scoring: true,
          source: 'legacy_article_modal',
          content_ids: [article.id],
        },
      });
      await createProjectRunApi({
        profile_id: selectedProfileId,
        project_id: project.id,
        planning_mode: 'SINGLE',
        target_duration_seconds: 60,
        preferred_part_count: 1,
        language: 'vi',
        skip_ai_evaluation: true,
        instructions: 'manual_direct_script: true. Bỏ qua chấm điểm và tạo luôn kịch bản video đơn lẻ từ đúng bài người dùng đã chọn.',
      })
      setModule2Result({ success: true, message: 'Đã tạo job kịch bản trực tiếp trong Module 2.' });
    } catch (err: any) {
      const detail = err?.response?.data?.detail || 'Không thể chuyển sang Module 2';
      setModule2Result({ success: false, message: detail });
    } finally {
      setSendingToModule2(false);
    }
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const getProxyUrl = (url: string) => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api/v1';
    return `${baseUrl}/proxy?url=${encodeURIComponent(url)}`;
  };

  const renderContent = () => {
    return (
      <div className="space-y-6">
        <div>
          <div className="flex items-center justify-between border-b pb-2 mb-4">
            <h3 className="text-sm font-bold text-[#0f172a] uppercase tracking-wider flex items-center gap-2">
              <FileText size={16} className="text-[#2563eb]" /> Văn Bản Crawl Đầy Đủ
            </h3>
            {article.quality_score !== undefined && (
              <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800">
                Quality: {Number(article.quality_score).toFixed(1)}/10
              </span>
            )}
          </div>

          {article.summary && article.summary !== article.content && (
            <div className="mb-5 p-4 rounded-xl bg-blue-50/70 border border-blue-200">
              <div className="text-xs font-bold text-blue-900 uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Sparkles size={14} /> AI Tóm Tắt (Canonical Summary)
              </div>
              <p className="text-xs leading-relaxed text-blue-950 font-medium">{article.summary}</p>
            </div>
          )}

          {!article.content ? (
            <p className="italic text-sm text-[#64748b]">Không có nội dung văn bản thô</p>
          ) : (
            <div className="max-w-none text-sm leading-relaxed text-[#334155] space-y-3">
              {(Array.isArray(article.content) ? article.content : article.content.split('\n')).map((paragraph, idx) => (
                paragraph.trim() && (
                  <p key={idx} className="text-justify font-normal leading-6 bg-slate-50/60 p-2.5 rounded-lg border border-slate-100">
                    {paragraph}
                  </p>
                )
              ))}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={handleBackdrop}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden shadow-2xl"
        style={{ backgroundColor: 'var(--surface-container-lowest)', border: '1px solid var(--outline-variant)' }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex flex-col gap-3 px-6 py-4 border-b"
          style={{ backgroundColor: 'var(--surface-container-lowest)', borderColor: 'var(--outline-variant)' }}
        >
          <div className="flex items-start gap-4 pr-8">
            <div className="flex-1 min-w-0">
              <h2 className="font-semibold text-base leading-snug" style={{ color: 'var(--on-surface)' }}>
                {article.title}
              </h2>
              <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--on-surface-variant)' }}>
                {article.crawled_at && (
                  <span className="flex items-center gap-1">
                    <Calendar size={12} />
                    {new Date(article.crawled_at).toLocaleString('vi-VN')}
                  </span>
                )}
                <a href={article.link} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1 transition-colors hover:opacity-70">
                  <LinkIcon size={12} /> Bài gốc
                </a>
              </div>
            </div>
          </div>

          {/* Action bar - Chuyển sang Module 2 */}
          <div className="flex items-center gap-3 flex-wrap">
            {module2Result ? (
              <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium ${
                module2Result.success
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-red-50 text-red-800 border border-red-200'
              }`}>
                {module2Result.success
                  ? <CheckCircle size={13} />
                  : <AlertCircle size={13} />}
                {module2Result.message}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {profiles.length > 1 && (
                  <div className="relative">
                    <select
                      value={selectedProfileId}
                      onChange={e => setSelectedProfileId(e.target.value)}
                      className="pl-3 pr-7 py-1.5 rounded-lg text-xs border border-[#d9e0ea] bg-white text-[#0f172a] outline-none appearance-none"
                    >
                      {profiles.map((p: any) => (
                        <option key={p.id} value={p.id}>{p.profile_name} ({p.platform})</option>
                      ))}
                    </select>
                    <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#64748b] pointer-events-none" />
                  </div>
                )}
                <button
                  onClick={handleSendToModule2}
                  disabled={sendingToModule2 || !article.id || loading || !selectedProfileId}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-semibold transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed bg-gradient-to-r from-violet-600 to-indigo-600 text-white shadow-sm"
                >
                  {sendingToModule2
                    ? <><Loader2 size={13} className="animate-spin" /> Đang chuyển...</>
                    : <><ArrowRight size={13} /> Chuyển sang Module 2 (Lên Kế Hoạch)</>}
                </button>
              </div>
            )}

            {module2Result && (
              <button
                onClick={() => setModule2Result(null)}
                className="text-xs text-[#64748b] hover:text-[#0f172a] underline"
              >
                Thử lại
              </button>
            )}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3"
              style={{ color: 'var(--on-surface-variant)' }}>
              <Loader2 className="animate-spin" size={28} style={{ color: 'var(--secondary)' }} />
              <p className="text-sm">Đang tải bài viết...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 order-2 lg:order-1">
                {renderContent()}
              </div>

              <div className="lg:col-span-1 order-1 lg:order-2 space-y-5">
                {article.videos && article.videos.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--on-surface-variant)' }}>
                      <VideoIcon size={13} /> Video ({article.videos.length})
                    </p>
                    <div className="space-y-3">
                      {article.videos.map((vid, idx) => {
                        const isVne = vid.includes('vnexpress') || vid.includes('vnecdn');
                        const isM3u8 = vid.includes('.m3u8');
                        const isIframe = vid.includes('video-iframe') || vid.includes('embed') || vid.includes('youtube.com');
                        const finalUrl = isVne && !isIframe ? getProxyUrl(vid) : vid;
                        return (
                          <div key={idx} className="rounded-xl overflow-hidden aspect-video relative border"
                            style={{ border: '1px solid var(--outline-variant)', backgroundColor: '#000' }}>
                            {isIframe ? (
                              <iframe src={vid} className="absolute inset-0 w-full h-full border-0" allowFullScreen />
                            ) : (
                              <ReactPlayer src={finalUrl} controls width="100%" height="100%"
                                className="absolute inset-0"
                                config={{ file: { forceHLS: isM3u8, attributes: { crossOrigin: 'anonymous' } } } as any}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {article.images && article.images.length > 0 && (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--on-surface-variant)' }}>
                      <ImageIcon size={13} /> Hình ảnh ({article.images.length})
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {article.images.map((img, idx) => (
                        <a href={img} target="_blank" rel="noreferrer" key={idx}>
                          <img src={img} alt={`img-${idx}`}
                            className="w-full h-24 object-cover rounded-lg hover:opacity-80 transition-opacity border"
                            style={{ borderColor: 'var(--outline-variant)' }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {!article.images && article.image && (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--on-surface-variant)' }}>
                      <ImageIcon size={13} /> Hình ảnh
                    </p>
                    <img src={article.image} alt="Article"
                      className="w-full rounded-xl object-cover border"
                      style={{ borderColor: 'var(--outline-variant)' }} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 rounded-lg transition-all hover:opacity-70"
          style={{ backgroundColor: 'var(--surface-container)', color: 'var(--on-surface-variant)' }}
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
