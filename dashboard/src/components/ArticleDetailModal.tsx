import { useEffect, useState } from 'react';
import ReactPlayer from 'react-player';
import { X, Calendar, Link as LinkIcon, Image as ImageIcon, Video as VideoIcon, Loader2, Send } from 'lucide-react';
import type { Article } from '../store/slices/articlesSlice';
import { fetchArticleDetailApi } from '../services/api';
import { useAppDispatch, useAppSelector } from '../hooks/useAppDispatch';
import { publishArticle } from '../store/slices/articlesSlice';

interface ArticleDetailModalProps {
  article: Article;
  onClose: () => void;
}

export default function ArticleDetailModal({ article: initialArticle, onClose }: ArticleDetailModalProps) {
  const [article, setArticle] = useState<Article>(initialArticle);
  const [loading, setLoading] = useState<boolean>(!initialArticle.content);
  const dispatch = useAppDispatch();
  const isPublishing = useAppSelector(s => s.articles.publishing[initialArticle.link]);
  const [platforms, setPlatforms] = useState<string[]>(['facebook', 'tiktok']);

  const togglePlatform = (p: string) =>
    setPlatforms(prev => prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]);

  const handlePublish = () => {
    if (platforms.length === 0) return;
    dispatch(publishArticle({ link: initialArticle.link, platforms }));
  };

  useEffect(() => {
    if (!initialArticle.content) {
      setLoading(true);
      fetchArticleDetailApi(initialArticle.link)
        .then(data => setArticle(data))
        .catch(err => console.error('Failed to load article detail:', err))
        .finally(() => setLoading(false));
    }
  }, [initialArticle]);

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const getProxyUrl = (url: string) => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
    return `${baseUrl}/proxy?url=${encodeURIComponent(url)}`;
  };

  const renderContent = () => {
    if (!article.content) {
      return <p className="italic" style={{ color: 'var(--text-muted)' }}>Không có nội dung</p>;
    }
    const paragraphs = Array.isArray(article.content)
      ? article.content
      : article.content.split('\n');
    return paragraphs.map((p, i) => (
      <p key={i} className="mb-4 leading-relaxed text-justify" style={{ color: 'var(--text-secondary)', fontSize: '14px' }}>
        {p}
      </p>
    ));
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(4px)' }}
      onClick={handleBackdrop}
    >
      <div
        className="relative w-full max-w-4xl max-h-[90vh] flex flex-col rounded-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)' }}
      >
        {/* Header */}
        <div
          className="sticky top-0 z-10 flex flex-col lg:flex-row items-start lg:items-center gap-4 px-6 py-4"
          style={{ backgroundColor: 'var(--bg-surface)', borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex-1 pr-8 min-w-0">
            <h2 className="font-semibold text-base leading-snug" style={{ color: 'var(--text-primary)' }}>
              {article.title}
            </h2>
            <div className="flex flex-wrap items-center gap-3 mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              {article.crawled_at && (
                <span className="flex items-center gap-1">
                  <Calendar size={12} />
                  {new Date(article.crawled_at).toLocaleString('vi-VN')}
                </span>
              )}
              <a href={article.link} target="_blank" rel="noreferrer"
                className="flex items-center gap-1 hover:text-blue-400 transition-colors">
                <LinkIcon size={12} /> Bài gốc
              </a>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            {['facebook', 'tiktok'].map(p => (
              <label key={p} className="flex items-center gap-1.5 text-xs cursor-pointer select-none"
                style={{ color: 'var(--text-secondary)' }}>
                <input type="checkbox" checked={platforms.includes(p)} onChange={() => togglePlatform(p)}
                  className="accent-blue-500 w-3.5 h-3.5" />
                {p}
              </label>
            ))}
            <button
              onClick={handlePublish}
              disabled={isPublishing || platforms.length === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium transition-all hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              {isPublishing
                ? <><Loader2 size={13} className="animate-spin" /> Đăng...</>
                : <><Send size={13} /> Đăng bài</>}
            </button>
          </div>

          <button
            onClick={onClose}
            className="absolute top-4 right-4 p-1.5 rounded-lg transition-all hover:opacity-80"
            style={{ backgroundColor: 'var(--bg-elevated)', color: 'var(--text-secondary)' }}
          >
            <X size={16} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3"
              style={{ color: 'var(--text-muted)' }}>
              <Loader2 className="animate-spin text-blue-400" size={28} />
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
                      style={{ color: 'var(--text-muted)' }}>
                      <VideoIcon size={13} /> Video ({article.videos.length})
                    </p>
                    <div className="space-y-3">
                      {article.videos.map((vid, idx) => {
                        const isVne = vid.includes('vnexpress') || vid.includes('vnecdn');
                        const isM3u8 = vid.includes('.m3u8');
                        const isIframe = vid.includes('video-iframe') || vid.includes('embed') || vid.includes('youtube.com');
                        const finalUrl = isVne && !isIframe ? getProxyUrl(vid) : vid;
                        return (
                          <div key={idx} className="rounded-xl overflow-hidden aspect-video relative"
                            style={{ backgroundColor: '#000', border: '1px solid var(--border)' }}>
                            {isIframe ? (
                              <iframe src={vid} className="absolute inset-0 w-full h-full border-0" allowFullScreen />
                            ) : (
                              <ReactPlayer url={finalUrl} controls width="100%" height="100%"
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
                      style={{ color: 'var(--text-muted)' }}>
                      <ImageIcon size={13} /> Hình ảnh ({article.images.length})
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      {article.images.map((img, idx) => (
                        <a href={img} target="_blank" rel="noreferrer" key={idx}>
                          <img src={img} alt={`img-${idx}`}
                            className="w-full h-24 object-cover rounded-lg hover:opacity-80 transition-opacity"
                            style={{ border: '1px solid var(--border)' }} />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {!article.images && article.image && (
                  <div>
                    <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider mb-3"
                      style={{ color: 'var(--text-muted)' }}>
                      <ImageIcon size={13} /> Hình ảnh
                    </p>
                    <img src={article.image} alt="Article"
                      className="w-full rounded-xl object-cover"
                      style={{ border: '1px solid var(--border)' }} />
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
