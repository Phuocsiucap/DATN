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
        .then(data => {
          setArticle(data);
        })
        .catch(err => {
          console.error("Failed to load article detail:", err);
        })
        .finally(() => {
          setLoading(false);
        });
    }
  }, [initialArticle]);

  const getProxyUrl = (url: string) => {
    const baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000/api';
    return `${baseUrl}/proxy?url=${encodeURIComponent(url)}`;
  };

  // The backend might return content as an array of strings or a single string
  const renderContent = () => {
    if (!article.content) return <p className="text-gray-400 italic">Không có nội dung chữ</p>;
    
    if (Array.isArray(article.content)) {
      return article.content.map((paragraph, idx) => (
        <p key={idx} className="mb-4 text-gray-300 leading-relaxed text-justify">{paragraph}</p>
      ));
    }
    
    // If it's a single string separated by newlines
    return article.content.split('\n').map((paragraph, idx) => (
      <p key={idx} className="mb-4 text-gray-300 leading-relaxed text-justify">{paragraph}</p>
    ));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
      <div 
        className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header (Sticky) */}
        <div className="sticky top-0 z-10 flex flex-col lg:flex-row items-start lg:items-center justify-between px-6 py-4 bg-gray-900/95 border-b border-gray-800 backdrop-blur gap-4">
          <div className="pr-8 flex-1">
            <h2 className="text-xl font-bold text-white leading-tight">{article.title}</h2>
            <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-gray-400">
              {article.crawled_at && (
                <span className="flex items-center gap-1">
                  <Calendar size={14} />
                  {new Date(article.crawled_at).toLocaleString('vi-VN')}
                </span>
              )}
              <a 
                href={article.link} 
                target="_blank" 
                rel="noreferrer"
                className="flex items-center gap-1 hover:text-blue-400 transition-colors"
              >
                <LinkIcon size={14} />
                Xem bài gốc
              </a>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-4 lg:pr-8 w-full lg:w-auto">
            <div className="flex items-center gap-3">
              {['facebook', 'tiktok'].map(p => (
                <label key={p} className="flex items-center gap-1 text-sm text-gray-300 cursor-pointer select-none">
                  <input type="checkbox" checked={platforms.includes(p)} onChange={() => togglePlatform(p)}
                    className="accent-blue-500 w-4 h-4" />
                  {p}
                </label>
              ))}
            </div>
            <button 
              onClick={handlePublish} 
              disabled={isPublishing || platforms.length === 0}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors shadow-lg shadow-blue-500/20"
            >
              {isPublishing
                ? <><Loader2 size={16} className="animate-spin" /> Đang đăng...</>
                : <><Send size={16} /> Đăng bài</>}
            </button>
          </div>

          <button 
            onClick={onClose}
            className="p-2 text-gray-400 bg-gray-800 rounded-full hover:bg-gray-700 hover:text-white transition-colors absolute top-4 right-4"
          >
            <X size={20} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 scroll-smooth">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 gap-3">
              <Loader2 className="animate-spin text-blue-500" size={32} />
              <p className="text-gray-400">Đang tải chi tiết bài viết...</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Col: Text Content */}
              <div className="lg:col-span-2 order-2 lg:order-1">
                <div className="prose prose-invert max-w-none">
                  {renderContent()}
                </div>
              </div>

              {/* Right Col: Media */}
              <div className="lg:col-span-1 order-1 lg:order-2 space-y-6">
                
                {/* Videos Section */}
                {article.videos && article.videos.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      <VideoIcon size={16} /> Video ({article.videos.length})
                    </h3>
                    <div className="flex flex-col gap-4">
                      {article.videos.map((vid, idx) => {
                        const isVne = vid.includes('vnexpress') || vid.includes('vnecdn');
                        const isM3u8 = vid.includes('.m3u8');
                        const isIframe = vid.includes('video-iframe') || vid.includes('embed') || vid.includes('youtube.com');
                        const finalUrl = isVne && !isIframe ? getProxyUrl(vid) : vid;

                        if (isIframe) {
                          return (
                            <div key={idx} className="rounded-xl overflow-hidden bg-black aspect-video relative border border-gray-800">
                              <iframe src={vid} className="absolute top-0 left-0 w-full h-full border-0" allowFullScreen />
                            </div>
                          )
                        }

                        return (
                          <div key={idx} className="rounded-xl overflow-hidden bg-black aspect-video relative border border-gray-800">
                            <ReactPlayer
                              url={finalUrl}
                              controls
                              width="100%"
                              height="100%"
                              className="absolute top-0 left-0"
                              config={{
                                file: {
                                  forceHLS: isM3u8,
                                  attributes: { crossOrigin: "anonymous" }
                                }
                              } as any}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )}

                {/* Images Section */}
                {article.images && article.images.length > 0 && (
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      <ImageIcon size={16} /> Hình ảnh ({article.images.length})
                    </h3>
                    <div className="grid grid-cols-2 gap-2">
                      {article.images.map((img, idx) => (
                        <a href={img} target="_blank" rel="noreferrer" key={idx}>
                          <img 
                            src={img} 
                            alt={`Article img ${idx}`} 
                            className="object-cover w-full h-24 rounded-lg bg-gray-800 hover:opacity-80 transition-opacity border border-gray-700" 
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                {/* Fallback old single image */}
                {!article.images && article.image && (
                  <div className="space-y-3">
                    <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-300 uppercase tracking-wider">
                      <ImageIcon size={16} /> Hình ảnh
                    </h3>
                    <img 
                      src={article.image} 
                      alt="Article img" 
                      className="object-cover w-full rounded-lg border border-gray-700" 
                    />
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
