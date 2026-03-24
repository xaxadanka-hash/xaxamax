import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft, Send, Trash2, Bell, BellOff, Paperclip, Image,
} from 'lucide-react';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useChannelStore, type Channel, type ChannelPost } from '../../store/channelStore';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

const REACTIONS = ['👍', '❤️', '🔥', '😂', '😮', '👎'];

interface ChannelViewProps {
  channel: Channel;
  onBack: () => void;
}

export default function ChannelView({ channel, onBack }: ChannelViewProps) {
  const { posts, isLoadingPosts, fetchPosts, createPost, deletePost, subscribe, react, myChannels } = useChannelStore();
  const { user } = useAuthStore();
  const [text, setText] = useState('');
  const [posting, setPosting] = useState(false);
  const [showReactions, setShowReactions] = useState<string | null>(null);
  const [isSubscribed, setIsSubscribed] = useState(
    myChannels.some(c => c.id === channel.id) || !!channel.isSubscribed
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isAdmin = channel.ownerId === user?.id ||
    !!(channel.subscribers?.[0]?.isAdmin);

  useEffect(() => {
    fetchPosts(channel.slug);
  }, [channel.slug, fetchPosts]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [posts.length]);

  const handlePost = async () => {
    if (!text.trim() || posting) return;
    setPosting(true);
    try {
      await createPost(channel.slug, text.trim());
      setText('');
    } finally {
      setPosting(false);
    }
  };

  const handleFilePost = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const form = new FormData();
      form.append('file', file);
      const { data: media } = await api.post('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await createPost(channel.slug, '', [media.id]);
    } catch (err) {
      console.error('File post error:', err);
    }
    e.target.value = '';
  };

  const handleSubscribe = async () => {
    const subscribed = await subscribe(channel.slug);
    setIsSubscribed(subscribed);
  };

  const handleReact = (post: ChannelPost, emoji: string) => {
    react(channel.slug, post.id, emoji, user?.id || '');
    setShowReactions(null);
  };

  const fmtDate = (d: string) => {
    try { return format(new Date(d), 'd MMM, HH:mm', { locale: ru }); }
    catch { return ''; }
  };

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  const reactionSummary = (post: ChannelPost) => {
    const map = new Map<string, number>();
    post.reactions.forEach(r => map.set(r.emoji, (map.get(r.emoji) || 0) + 1));
    return Array.from(map.entries());
  };

  const hasMyReaction = (post: ChannelPost, emoji: string) =>
    post.reactions.some(r => r.userId === user?.id && r.emoji === emoji);

  return (
    <div className="h-full flex flex-col bg-dark-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50 glass shrink-0">
        <button onClick={onBack} className="btn-ghost p-1.5 rounded-lg">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-sm font-bold text-white shrink-0">
          {channel.avatar
            ? <img src={channel.avatar} className="w-full h-full rounded-full object-cover" alt="" />
            : getInitials(channel.title)}
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-white truncate">{channel.title}</h3>
          <p className="text-xs text-dark-400">{channel.subscriberCount} подписчиков</p>
        </div>
        {channel.ownerId !== user?.id && (
          <button
            onClick={handleSubscribe}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors
              ${isSubscribed
                ? 'bg-dark-700 text-dark-300 hover:bg-red-500/20 hover:text-red-400'
                : 'bg-primary-600 text-white hover:bg-primary-700'
              }`}
          >
            {isSubscribed ? <><BellOff className="w-3.5 h-3.5" /> Отписаться</> : <><Bell className="w-3.5 h-3.5" /> Подписаться</>}
          </button>
        )}
      </div>

      {/* Posts feed */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {isLoadingPosts && (
          <div className="flex justify-center py-8">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!isLoadingPosts && posts.length === 0 && (
          <div className="text-center py-16 text-dark-500">
            <p className="text-sm">Постов пока нет</p>
            {isAdmin && <p className="text-xs mt-1">Напишите первый пост ниже</p>}
          </div>
        )}

        {posts.map(post => (
          <div key={post.id} className="group relative">
            {/* Post bubble */}
            <div className="bg-dark-900/70 rounded-2xl px-4 py-3 border border-dark-800/40">
              {/* Media */}
              {post.media?.map(m => (
                <div key={m.id} className="mb-2">
                  {m.mimeType.startsWith('image/') && (
                    <img src={m.url} alt="" className="rounded-xl max-h-72 object-cover w-full" />
                  )}
                  {m.mimeType.startsWith('video/') && (
                    <video src={m.url} controls className="rounded-xl max-h-72 w-full" />
                  )}
                </div>
              ))}

              {/* Text */}
              {post.text && (
                <p className="text-sm text-dark-100 whitespace-pre-wrap break-words leading-relaxed">
                  {post.text}
                </p>
              )}

              {/* Footer */}
              <div className="flex items-center justify-between mt-2">
                <span className="text-[10px] text-dark-500">{fmtDate(post.createdAt)}</span>

                <div className="flex items-center gap-2">
                  {/* Existing reactions */}
                  {reactionSummary(post).map(([emoji, count]) => (
                    <button
                      key={emoji}
                      onClick={() => handleReact(post, emoji)}
                      className={`flex items-center gap-0.5 text-xs px-2 py-0.5 rounded-full transition-colors
                        ${hasMyReaction(post, emoji)
                          ? 'bg-primary-600/30 text-primary-300'
                          : 'bg-dark-700/60 text-dark-300 hover:bg-dark-600'
                        }`}
                    >
                      {emoji} {count}
                    </button>
                  ))}

                  {/* Add reaction */}
                  <button
                    onClick={() => setShowReactions(showReactions === post.id ? null : post.id)}
                    className="text-dark-600 hover:text-dark-300 text-sm transition-colors opacity-0 group-hover:opacity-100"
                  >
                    +
                  </button>

                  {/* Delete (admin) */}
                  {isAdmin && (
                    <button
                      onClick={() => deletePost(channel.slug, post.id)}
                      className="text-dark-600 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Reaction picker */}
              {showReactions === post.id && (
                <div className="flex gap-1 mt-2 pt-2 border-t border-dark-700/30">
                  {REACTIONS.map(emoji => (
                    <button
                      key={emoji}
                      onClick={() => handleReact(post, emoji)}
                      className="text-xl hover:scale-125 transition-transform"
                    >
                      {emoji}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}

        <div ref={bottomRef} />
      </div>

      {/* Post input (admin only) */}
      {isAdmin && (
        <div className="px-4 py-3 border-t border-dark-800/50 glass shrink-0">
          <div className="flex items-center gap-2">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="btn-ghost p-2 rounded-xl shrink-0"
            >
              <Paperclip className="w-5 h-5" />
            </button>
            <input
              type="text"
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handlePost(); } }}
              placeholder="Написать пост..."
              className="flex-1 bg-dark-800/40 border-none rounded-xl px-4 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
            />
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleFilePost} accept="image/*,video/*" />
            <button
              onClick={handlePost}
              disabled={!text.trim() || posting}
              className="btn-primary p-2.5 rounded-xl disabled:opacity-40 shrink-0"
            >
              {posting
                ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Send className="w-5 h-5" />
              }
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
