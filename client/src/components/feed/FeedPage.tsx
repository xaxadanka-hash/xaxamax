import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useChatStore } from '../../store/chatStore';
import api from '../../services/api';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  ArrowLeft, Heart, MessageCircle, Share2, Send, Image, Mic, Trash2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { VoicePlayer } from '../chat/VoiceMessage';
import { createAudioRecorder, getAudioFileExtension } from '../../utils/audioRecording';

interface Post {
  id: string;
  text: string | null;
  author: { id: string; displayName: string; avatar: string | null };
  media: Array<{ id: string; url: string; mimeType: string }>;
  isLiked: boolean;
  likesCount: number;
  commentsCount: number;
  createdAt: string;
}

interface Comment {
  id: string;
  text: string | null;
  type: string;
  author: { id: string; displayName: string; avatar: string | null };
  media: Array<{ id: string; url: string; mimeType: string; duration?: number }>;
  likes: Array<{ id: string; userId: string }>;
  replies?: Comment[];
  _count?: { likes: number; replies: number };
  createdAt: string;
}

export default function FeedPage() {
  const { user } = useAuthStore();
  const { setActiveChat } = useChatStore();
  const navigate = useNavigate();
  const [posts, setPosts] = useState<Post[]>([]);
  const [newPostText, setNewPostText] = useState('');
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [expandedPost, setExpandedPost] = useState<string | null>(null);
  const [comments, setComments] = useState<Record<string, Comment[]>>({});
  const [commentText, setCommentText] = useState<Record<string, string>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedMedia, setSelectedMedia] = useState<string[]>([]);

  useEffect(() => {
    fetchFeed();
  }, []);

  const fetchFeed = async () => {
    try {
      const { data } = await api.get('/posts/feed');
      setPosts(data.posts);
    } catch (err) {
      console.error('Fetch feed error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePost = async () => {
    if (!newPostText.trim() && selectedMedia.length === 0) return;
    setPosting(true);
    try {
      const { data } = await api.post('/posts', {
        text: newPostText.trim() || null,
        mediaIds: selectedMedia,
      });
      setPosts([{ ...data, isLiked: false, likesCount: 0, commentsCount: 0 }, ...posts]);
      setNewPostText('');
      setSelectedMedia([]);
    } catch (err) {
      console.error('Create post error:', err);
    } finally {
      setPosting(false);
    }
  };

  const handleLike = async (postId: string) => {
    try {
      const { data } = await api.post(`/posts/${postId}/like`);
      setPosts(posts.map((p) =>
        p.id === postId
          ? { ...p, isLiked: data.liked, likesCount: p.likesCount + (data.liked ? 1 : -1) }
          : p,
      ));
    } catch (err) {
      console.error('Like error:', err);
    }
  };

  const handleDeletePost = async (postId: string) => {
    try {
      await api.delete(`/posts/${postId}`);
      setPosts(posts.filter((p) => p.id !== postId));
    } catch (err) {
      console.error('Delete post error:', err);
    }
  };

  const fetchComments = async (postId: string) => {
    try {
      const { data } = await api.get(`/posts/${postId}/comments`);
      setComments((prev) => ({ ...prev, [postId]: data }));
    } catch (err) {
      console.error('Fetch comments error:', err);
    }
  };

  const handleComment = async (postId: string) => {
    const text = commentText[postId]?.trim();
    if (!text) return;
    try {
      const { data } = await api.post(`/posts/${postId}/comments`, { text });
      setComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), data] }));
      setCommentText((prev) => ({ ...prev, [postId]: '' }));
      setPosts(posts.map((p) => p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p));
    } catch (err) {
      console.error('Comment error:', err);
    }
  };

  const handleVoiceComment = async (postId: string) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const { recorder: mediaRecorder, mimeType } = createAudioRecorder(stream);
      const chunks: BlobPart[] = [];
      const startedAt = Date.now();

      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const duration = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const blob = new Blob(chunks, { type: mimeType });
        const formData = new FormData();
        formData.append('file', blob, `voice.${getAudioFileExtension(mimeType)}`);
        formData.append('duration', duration.toString());
        const { data: media } = await api.post('/media/upload', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const { data: comment } = await api.post(`/posts/${postId}/comments`, {
          type: 'VOICE',
          mediaId: media.id,
        });
        setComments((prev) => ({ ...prev, [postId]: [...(prev[postId] || []), comment] }));
        setPosts(posts.map((p) => p.id === postId ? { ...p, commentsCount: p.commentsCount + 1 } : p));
      };

      mediaRecorder.start();
      setTimeout(() => mediaRecorder.stop(), 30000); // max 30s
    } catch (err) {
      console.error('Voice recording error:', err);
    }
  };

  const toggleComments = (postId: string) => {
    if (expandedPost === postId) {
      setExpandedPost(null);
    } else {
      setExpandedPost(postId);
      if (!comments[postId]) fetchComments(postId);
    }
  };

  const handleMediaUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length) return;
    const formData = new FormData();
    formData.append('file', files[0]);
    try {
      const { data } = await api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setSelectedMedia([...selectedMedia, data.id]);
    } catch (err) {
      console.error('Upload error:', err);
    }
    e.target.value = '';
  };

  const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const formatTime = (date: string) => {
    try { return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ru }); }
    catch { return ''; }
  };

  const handleBackToChats = () => {
    setActiveChat(null);
    navigate('/');
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto no-overscroll safe-bottom">
      <div className="max-w-3xl xl:max-w-[56rem] mx-auto px-4 sm:px-6 py-4 md:py-6 pb-[calc(5.5rem+env(safe-area-inset-bottom))] md:pb-8">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-dark-950/95 backdrop-blur-sm border-b border-dark-800/30 -mx-4 sm:-mx-6 px-4 sm:px-6 pb-3 mb-4 md:mb-6 safe-top">
          <div className="flex items-center justify-between gap-3 pt-1.5">
            <button
              onClick={handleBackToChats}
              className="btn-ghost px-2.5 py-2 rounded-xl flex items-center gap-1.5 text-sm"
              title="Вернуться к чатам"
            >
              <ArrowLeft className="w-4 h-4" />
              Чаты
            </button>

            <h2 className="text-2xl font-bold text-white">Стена</h2>
            <div className="w-[70px]" />
          </div>
        </div>

        {/* New post */}
        <div className="glass rounded-2xl p-4 mb-6">
          <div className="flex gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-600/30 flex items-center justify-center text-sm font-medium text-primary-300 flex-shrink-0">
              {user?.avatar ? <img src={user.avatar} className="w-full h-full rounded-full object-cover" alt="" /> : getInitials(user?.displayName || '?')}
            </div>
            <div className="flex-1">
              <textarea
                placeholder="Что нового?"
                value={newPostText}
                onChange={(e) => setNewPostText(e.target.value)}
                className="w-full bg-transparent text-white placeholder:text-dark-500 resize-none focus:outline-none text-sm min-h-[60px]"
                rows={2}
              />
              <div className="flex flex-wrap items-center justify-between gap-3 mt-2">
                <div className="flex gap-2">
                  <button onClick={() => fileInputRef.current?.click()} className="btn-ghost p-1.5 rounded-lg">
                    <Image className="w-4 h-4" />
                  </button>
                  <input ref={fileInputRef} type="file" className="hidden" accept="image/*,video/*" onChange={handleMediaUpload} />
                </div>
                <button
                  onClick={handlePost}
                  disabled={posting || (!newPostText.trim() && selectedMedia.length === 0)}
                  className="btn-primary text-sm px-4 py-1.5"
                >
                  {posting ? 'Публикация...' : 'Опубликовать'}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Posts */}
        {posts.length === 0 && (
          <div className="text-center py-12">
            <p className="text-dark-500">Пока нет постов. Будьте первым!</p>
          </div>
        )}

        <AnimatePresence>
          {posts.map((post) => (
            <motion.div
              key={post.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="glass rounded-2xl p-4 mb-4"
            >
              {/* Post header */}
              <div className="flex items-center gap-3 mb-3">
                <button
                  onClick={() => navigate(`/profile/${post.author.id}`)}
                  className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium flex-shrink-0 overflow-hidden hover:ring-2 hover:ring-primary-500/50 transition-all"
                >
                  {post.author.avatar
                    ? <img src={post.author.avatar} className="w-full h-full rounded-full object-cover" alt="" />
                    : getInitials(post.author.displayName)}
                </button>
                <div className="flex-1">
                  <button onClick={() => navigate(`/profile/${post.author.id}`)} className="text-sm font-semibold text-white hover:underline">{post.author.displayName}</button>
                  <p className="text-xs text-dark-500">{formatTime(post.createdAt)}</p>
                </div>
                {post.author.id === user?.id && (
                  <button onClick={() => handleDeletePost(post.id)} className="btn-ghost p-1.5 rounded-lg text-dark-500 hover:text-red-400">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>

              {/* Post content */}
              {post.text && <p className="text-sm text-dark-200 whitespace-pre-wrap mb-3">{post.text}</p>}
              {post.media?.map((m) => (
                <div key={m.id} className="mb-3 rounded-xl overflow-hidden">
                  {m.mimeType.startsWith('image/') && <img src={m.url} className="w-full max-h-96 object-cover" alt="" />}
                  {m.mimeType.startsWith('video/') && <video src={m.url} controls className="w-full max-h-96" />}
                </div>
              ))}

              {/* Actions */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 pt-2 border-t border-dark-800/30">
                <button
                  onClick={() => handleLike(post.id)}
                  className={`flex items-center gap-1.5 text-sm transition-colors ${post.isLiked ? 'text-red-500' : 'text-dark-400 hover:text-red-400'}`}
                >
                  <Heart className={`w-4 h-4 ${post.isLiked ? 'fill-current' : ''}`} />
                  {post.likesCount > 0 && post.likesCount}
                </button>
                <button
                  onClick={() => toggleComments(post.id)}
                  className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-primary-400 transition-colors"
                >
                  <MessageCircle className="w-4 h-4" />
                  {post.commentsCount > 0 && post.commentsCount}
                </button>
                <button className="flex items-center gap-1.5 text-sm text-dark-400 hover:text-primary-400 transition-colors">
                  <Share2 className="w-4 h-4" />
                </button>
              </div>

              {/* Comments section */}
              <AnimatePresence>
                {expandedPost === post.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="mt-3 pt-3 border-t border-dark-800/30 overflow-hidden"
                  >
                    {(comments[post.id] || []).map((c) => (
                      <div key={c.id} className="flex gap-2 mb-3">
                        <button
                          onClick={() => navigate(`/profile/${c.author.id}`)}
                          className="w-7 h-7 rounded-full bg-dark-700 flex items-center justify-center text-[10px] font-medium flex-shrink-0 overflow-hidden hover:ring-2 hover:ring-primary-500/50 transition-all"
                        >
                          {c.author.avatar ? <img src={c.author.avatar} className="w-full h-full rounded-full object-cover" alt="" /> : getInitials(c.author.displayName)}
                        </button>
                        <div className="flex-1">
                          <div className="bg-dark-800/50 rounded-xl px-3 py-2">
                            <button
                              onClick={() => navigate(`/profile/${c.author.id}`)}
                              className="text-xs font-medium text-dark-300 hover:text-primary-300 transition-colors"
                            >
                              {c.author.displayName}
                            </button>
                            {c.type === 'VOICE' && c.media?.[0] ? (
                              <div className="mt-1">
                                <VoicePlayer
                                  src={c.media[0].url}
                                  duration={c.media[0].duration}
                                  isMine={c.author.id === user?.id}
                                />
                              </div>
                            ) : (
                              <p className="text-xs text-dark-200">{c.text}</p>
                            )}
                          </div>
                          <p className="text-[10px] text-dark-600 mt-0.5 ml-2">{formatTime(c.createdAt)}</p>
                        </div>
                      </div>
                    ))}

                    {/* Comment input */}
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <input
                        type="text"
                        placeholder="Комментарий..."
                        value={commentText[post.id] || ''}
                        onChange={(e) => setCommentText({ ...commentText, [post.id]: e.target.value })}
                        onKeyDown={(e) => e.key === 'Enter' && handleComment(post.id)}
                        className="flex-1 bg-dark-800/40 rounded-xl px-3 py-2 text-xs text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                      />
                      <button onClick={() => handleVoiceComment(post.id)} className="btn-ghost p-1.5 rounded-lg tap-target" title="Голосовой комментарий">
                        <Mic className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleComment(post.id)} className="btn-ghost p-1.5 rounded-lg text-primary-400 tap-target">
                        <Send className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
