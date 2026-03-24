import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import { useChatStore } from '../../store/chatStore';
import {
  Camera, Save, Loader2, UserPlus, UserMinus, MessageCircle,
  Heart, MessageSquare, ChevronLeft, MoreVertical, LogOut, Settings,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import api from '../../services/api';

interface ProfileData {
  id: string;
  displayName: string;
  phone: string;
  avatar: string | null;
  bio: string | null;
  isOnline: boolean;
  lastSeen: string;
  createdAt: string;
  postsCount: number;
  contactsCount: number;
  isContact: boolean;
  posts: Array<{
    id: string;
    text: string | null;
    createdAt: string;
    author: { id: string; displayName: string; avatar: string | null };
    _count: { likes: number; comments: number };
  }>;
}

export default function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const { user, updateProfile, logout } = useAuthStore();
  const { createPrivateChat, setActiveChat } = useChatStore();
  const navigate = useNavigate();

  const isOwn = !userId || userId === user?.id;

  // Own profile edit state
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Other profile state
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(!isOwn);
  const [contactLoading, setContactLoading] = useState(false);

  useEffect(() => {
    if (!isOwn && userId) {
      setLoading(true);
      api.get(`/users/${userId}`)
        .then(r => setProfile(r.data))
        .catch(console.error)
        .finally(() => setLoading(false));
    }
  }, [userId, isOwn]);

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ displayName, bio });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    try {
      const { data: media } = await api.post('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await updateProfile({ avatar: media.url });
    } catch (err) {
      console.error('Avatar upload error:', err);
    }
  };

  const handleToggleContact = async () => {
    if (!profile) return;
    setContactLoading(true);
    try {
      if (profile.isContact) {
        await api.delete(`/users/me/contacts/${profile.id}`);
        setProfile(p => p ? { ...p, isContact: false, contactsCount: p.contactsCount } : p);
      } else {
        await api.post('/users/me/contacts', { contactId: profile.id });
        setProfile(p => p ? { ...p, isContact: true } : p);
      }
    } finally {
      setContactLoading(false);
    }
  };

  const handleMessage = async () => {
    if (!profile) return;
    try {
      const chat = await createPrivateChat(profile.id);
      setActiveChat(chat);
      navigate('/');
    } catch (err) {
      console.error('Create chat error:', err);
    }
  };

  const fmtDate = (d: string) =>
    formatDistanceToNow(new Date(d), { addSuffix: true, locale: ru });

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  // ── OTHER USER PROFILE ──
  if (!isOwn) {
    if (loading) {
      return (
        <div className="h-full flex items-center justify-center">
          <div className="w-8 h-8 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
        </div>
      );
    }
    if (!profile) {
      return (
        <div className="h-full flex items-center justify-center text-dark-400 text-sm">
          Пользователь не найден
        </div>
      );
    }

    return (
      <div className="h-full overflow-y-auto">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-dark-800/50">
          <button onClick={() => navigate(-1)} className="btn-ghost p-1.5 rounded-xl">
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-semibold text-white truncate flex-1">{profile.displayName}</span>
          <button className="btn-ghost p-1.5 rounded-xl">
            <MoreVertical className="w-5 h-5" />
          </button>
        </div>

        <div className="max-w-lg mx-auto px-4 py-6">
          {/* Avatar + name */}
          <div className="flex flex-col items-center gap-3 mb-6">
            <div className="w-24 h-24 rounded-full overflow-hidden ring-4 ring-primary-500/20">
              {profile.avatar
                ? <img src={profile.avatar} className="w-full h-full object-cover" alt="" />
                : <div className="w-full h-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-2xl font-bold text-white">
                    {getInitials(profile.displayName)}
                  </div>
              }
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-white">{profile.displayName}</h2>
              {profile.bio && <p className="text-sm text-dark-400 mt-1 max-w-xs text-center">{profile.bio}</p>}
              <p className="text-xs text-dark-500 mt-1">
                {profile.isOnline
                  ? <span className="text-green-400">В сети</span>
                  : `Был(а) ${fmtDate(profile.lastSeen)}`}
              </p>
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 mb-6">
            <button
              onClick={handleMessage}
              className="flex-1 btn-primary flex items-center justify-center gap-2 py-2.5"
            >
              <MessageCircle className="w-4 h-4" />
              Написать
            </button>
            <button
              onClick={handleToggleContact}
              disabled={contactLoading}
              className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-medium transition-colors
                ${profile.isContact
                  ? 'bg-dark-800/60 text-dark-300 hover:bg-red-500/10 hover:text-red-400'
                  : 'bg-dark-800/60 text-dark-300 hover:bg-primary-600/20 hover:text-primary-400'}`}
            >
              {contactLoading
                ? <Loader2 className="w-4 h-4 animate-spin" />
                : profile.isContact
                  ? <><UserMinus className="w-4 h-4" />Удалить</>
                  : <><UserPlus className="w-4 h-4" />В контакты</>}
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            <div className="glass rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{profile.postsCount}</p>
              <p className="text-xs text-dark-400 mt-1">Постов</p>
            </div>
            <div className="glass rounded-xl p-4 text-center">
              <p className="text-2xl font-bold text-white">{profile.contactsCount}</p>
              <p className="text-xs text-dark-400 mt-1">Контактов</p>
            </div>
          </div>

          {/* Posts */}
          {profile.posts.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-dark-300 mb-3">Посты</h3>
              <div className="space-y-3">
                {profile.posts.map(post => (
                  <div key={post.id} className="glass rounded-xl p-4">
                    {post.text && <p className="text-sm text-white whitespace-pre-wrap">{post.text}</p>}
                    <div className="flex items-center gap-4 mt-3 text-xs text-dark-500">
                      <span className="flex items-center gap-1">
                        <Heart className="w-3.5 h-3.5" />{post._count.likes}
                      </span>
                      <span className="flex items-center gap-1">
                        <MessageSquare className="w-3.5 h-3.5" />{post._count.comments}
                      </span>
                      <span className="ml-auto">{fmtDate(post.createdAt)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── OWN PROFILE ──
  return (
    <div className="h-full overflow-y-auto no-overscroll safe-bottom">
      <div className="sticky top-0 z-10 bg-dark-950/95 backdrop-blur-sm border-b border-dark-800/30 px-4 sm:px-6 py-3 safe-top">
        <div className="max-w-2xl mx-auto flex items-center justify-between gap-3">
          <h2 className="text-xl font-bold text-white">Мой профиль</h2>
          <button
            onClick={() => navigate('/settings')}
            className="btn-ghost px-3 py-2 rounded-xl flex items-center gap-2 text-sm"
          >
            <Settings className="w-4 h-4" />
            Настройки
          </button>
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 sm:px-6 py-6 md:py-8 space-y-4 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-10">
        <div className="glass rounded-3xl p-6">
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5 mb-5">
            <div className="relative group shrink-0">
              <div className="w-24 h-24 rounded-full bg-primary-600/30 flex items-center justify-center text-2xl font-bold text-primary-300 overflow-hidden ring-4 ring-primary-500/20">
                {user?.avatar
                  ? <img src={user.avatar} className="w-full h-full object-cover" alt="" />
                  : getInitials(user?.displayName || '?')}
              </div>
              <label className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                <Camera className="w-6 h-6 text-white" />
                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
              </label>
            </div>

            <div className="flex-1 min-w-0 text-center sm:text-left">
              <h3 className="text-2xl font-bold text-white truncate">{user?.displayName}</h3>
              <p className="text-sm text-dark-400 mt-1">{user?.phone}</p>
              {user && (
                <p className="text-xs text-dark-500 mt-2">
                  Участник с {new Date(user.createdAt).toLocaleDateString('ru', { month: 'long', year: 'numeric' })}
                </p>
              )}
            </div>

            <button
              onClick={handleLogout}
              className="w-full sm:w-auto bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-300 px-4 py-2.5 rounded-xl text-sm font-medium flex items-center justify-center gap-2 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Выйти
            </button>
          </div>

          <div className="mb-4">
            <label className="text-xs text-dark-400 mb-1 block">Телефон</label>
            <div className="input-field bg-dark-900/50 cursor-not-allowed text-dark-400">{user?.phone}</div>
          </div>

          <div className="mb-4">
            <label className="text-xs text-dark-400 mb-1 block">Имя</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              className="input-field"
              placeholder="Ваше имя"
            />
          </div>

          <div className="mb-6">
            <label className="text-xs text-dark-400 mb-1 block">О себе</label>
            <textarea
              value={bio}
              onChange={e => setBio(e.target.value)}
              className="input-field resize-none"
              rows={3}
              placeholder="Расскажите о себе..."
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving}
            className="btn-primary w-full flex items-center justify-center gap-2"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saved ? 'Сохранено!' : saving ? 'Сохранение...' : 'Сохранить изменения'}
          </button>
        </div>
      </div>
    </div>
  );
}
