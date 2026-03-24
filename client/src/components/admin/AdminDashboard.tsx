import { useEffect, useState } from 'react';
import {
  Users, MessageSquare, FileText, Hash, BookOpen, Activity,
  Shield, Ban, Trash2, Search, ChevronLeft, ChevronRight,
} from 'lucide-react';
import api from '../../services/api';
import { useAuthStore } from '../../store/authStore';

interface Stats {
  users: number;
  messages: number;
  posts: number;
  channels: number;
  stories: number;
  activeToday: number;
}

interface AdminUser {
  id: string;
  displayName: string;
  phone: string;
  avatar: string | null;
  isAdmin: boolean;
  isBanned: boolean;
  isOnline: boolean;
  createdAt: string;
  lastSeen: string;
  _count: { messages: number; posts: number };
}

interface AdminChannel {
  id: string;
  title: string;
  slug: string;
  isPublic: boolean;
  createdAt: string;
  owner: { id: string; displayName: string };
  _count: { subscribers: number; posts: number };
}

const STAT_CARDS = [
  { key: 'users', label: 'Пользователи', icon: Users, color: 'text-blue-400' },
  { key: 'activeToday', label: 'Активны сегодня', icon: Activity, color: 'text-green-400' },
  { key: 'messages', label: 'Сообщения', icon: MessageSquare, color: 'text-purple-400' },
  { key: 'posts', label: 'Посты', icon: FileText, color: 'text-yellow-400' },
  { key: 'channels', label: 'Каналы', icon: Hash, color: 'text-pink-400' },
  { key: 'stories', label: 'Сторис', icon: BookOpen, color: 'text-orange-400' },
];

type Tab = 'stats' | 'users' | 'channels';

export default function AdminDashboard() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<Tab>('stats');
  const [stats, setStats] = useState<Stats | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [channels, setChannels] = useState<AdminChannel[]>([]);
  const [userSearch, setUserSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  useEffect(() => {
    api.get('/admin/stats').then(r => setStats(r.data)).catch(console.error);
  }, []);

  useEffect(() => {
    if (tab === 'users') fetchUsers();
  }, [tab, page]);

  useEffect(() => {
    if (tab === 'channels') {
      api.get('/admin/channels').then(r => setChannels(r.data)).catch(console.error);
    }
  }, [tab]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const { data } = await api.get(`/admin/users?q=${userSearch}&page=${page}&limit=15`);
      setUsers(data.users);
      setTotalPages(data.pages);
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    fetchUsers();
  };

  const toggleBan = async (u: AdminUser) => {
    setActionId(u.id);
    try {
      await api.patch(`/admin/users/${u.id}`, { isBanned: !u.isBanned });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, isBanned: !u.isBanned } : x));
    } finally {
      setActionId(null);
    }
  };

  const toggleAdmin = async (u: AdminUser) => {
    if (u.id === user?.id) return;
    setActionId(u.id);
    try {
      await api.patch(`/admin/users/${u.id}`, { isAdmin: !u.isAdmin });
      setUsers(prev => prev.map(x => x.id === u.id ? { ...x, isAdmin: !u.isAdmin } : x));
    } finally {
      setActionId(null);
    }
  };

  const deleteUser = async (id: string) => {
    if (!confirm('Удалить пользователя и все его данные?')) return;
    await api.delete(`/admin/users/${id}`);
    setUsers(prev => prev.filter(x => x.id !== id));
  };

  const deleteChannel = async (id: string) => {
    if (!confirm('Удалить канал?')) return;
    await api.delete(`/admin/channels/${id}`);
    setChannels(prev => prev.filter(x => x.id !== id));
  };

  const fmtDate = (d: string) => new Date(d).toLocaleDateString('ru', { day: '2-digit', month: 'short', year: 'numeric' });

  return (
    <div className="h-full flex flex-col bg-dark-950 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50">
        <Shield className="w-5 h-5 text-primary-400" />
        <h1 className="text-base font-semibold text-white">Панель администратора</h1>
      </div>

      {/* Tabs */}
      <div className="flex px-3 py-2 gap-1 border-b border-dark-800/30">
        {([['stats', 'Статистика'], ['users', 'Пользователи'], ['channels', 'Каналы']] as [Tab, string][]).map(([t, label]) => (
          <button
            key={t}
            onClick={() => { setTab(t); setPage(1); }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
              ${tab === t ? 'bg-primary-600/20 text-primary-400' : 'text-dark-400 hover:bg-dark-800/40'}`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── STATS ── */}
        {tab === 'stats' && stats && (
          <div className="p-4 grid grid-cols-2 gap-3">
            {STAT_CARDS.map(({ key, label, icon: Icon, color }) => (
              <div key={key} className="bg-dark-900/60 rounded-2xl p-4 border border-dark-800/40">
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-4 h-4 ${color}`} />
                  <span className="text-xs text-dark-400">{label}</span>
                </div>
                <p className="text-2xl font-bold text-white">{(stats as any)[key]?.toLocaleString('ru')}</p>
              </div>
            ))}
          </div>
        )}

        {/* ── USERS ── */}
        {tab === 'users' && (
          <div className="flex flex-col h-full">
            <form onSubmit={handleSearch} className="flex gap-2 px-3 py-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                <input
                  value={userSearch}
                  onChange={e => setUserSearch(e.target.value)}
                  placeholder="Поиск по имени или телефону..."
                  className="w-full bg-dark-800/40 rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                />
              </div>
              <button type="submit" className="btn-primary px-3 py-2 text-xs">Найти</button>
            </form>

            {loading && (
              <div className="flex justify-center py-8">
                <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
              </div>
            )}

            <div className="flex-1 overflow-y-auto divide-y divide-dark-800/30">
              {users.map(u => (
                <div key={u.id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="w-9 h-9 rounded-full bg-dark-700 flex items-center justify-center shrink-0 overflow-hidden">
                    {u.avatar
                      ? <img src={u.avatar} className="w-full h-full object-cover" alt="" />
                      : <span className="text-xs font-bold text-dark-300">{u.displayName.slice(0, 2).toUpperCase()}</span>
                    }
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-sm font-medium text-white truncate">{u.displayName}</p>
                      {u.isAdmin && <span className="text-[10px] bg-primary-600/20 text-primary-400 px-1 rounded">Admin</span>}
                      {u.isBanned && <span className="text-[10px] bg-red-500/20 text-red-400 px-1 rounded">Ban</span>}
                    </div>
                    <p className="text-xs text-dark-500">{u.phone} · {u._count.messages} сообщ. · {fmtDate(u.createdAt)}</p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      onClick={() => toggleAdmin(u)}
                      disabled={actionId === u.id || u.id === user?.id}
                      title={u.isAdmin ? 'Снять права админа' : 'Дать права админа'}
                      className={`p-1.5 rounded-lg transition-colors ${u.isAdmin ? 'text-primary-400 bg-primary-600/20' : 'text-dark-500 hover:text-primary-400'}`}
                    >
                      <Shield className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => toggleBan(u)}
                      disabled={actionId === u.id}
                      title={u.isBanned ? 'Разбанить' : 'Заблокировать'}
                      className={`p-1.5 rounded-lg transition-colors ${u.isBanned ? 'text-red-400 bg-red-500/20' : 'text-dark-500 hover:text-red-400'}`}
                    >
                      <Ban className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteUser(u.id)}
                      title="Удалить"
                      className="p-1.5 rounded-lg text-dark-600 hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between px-4 py-2 border-t border-dark-800/30">
                <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1} className="btn-ghost p-1.5 disabled:opacity-40">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-xs text-dark-400">{page} / {totalPages}</span>
                <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages} className="btn-ghost p-1.5 disabled:opacity-40">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* ── CHANNELS ── */}
        {tab === 'channels' && (
          <div className="divide-y divide-dark-800/30">
            {channels.map(ch => (
              <div key={ch.id} className="flex items-center gap-3 px-3 py-3">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-xs font-bold text-white shrink-0">
                  {ch.title.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white truncate">{ch.title}</p>
                  <p className="text-xs text-dark-500">@{ch.slug} · {ch._count.subscribers} подп. · {ch.owner.displayName}</p>
                </div>
                <button
                  onClick={() => deleteChannel(ch.id)}
                  className="p-1.5 text-dark-600 hover:text-red-400 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
            {channels.length === 0 && (
              <p className="text-center text-dark-500 py-12 text-sm">Каналов нет</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
