import { useEffect, useState } from 'react';
import { Hash, Plus, Search, Users, Bell, BellOff } from 'lucide-react';
import { useChannelStore, type Channel } from '../../store/channelStore';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';
import CreateChannelModal from './CreateChannelModal';

interface ChannelListProps {
  onSelect: (channel: Channel) => void;
}

export default function ChannelList({ onSelect }: ChannelListProps) {
  const { myChannels, fetchMyChannels, subscribe } = useChannelStore();
  const { user } = useAuthStore();
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<Channel[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [subscribingId, setSubscribingId] = useState<string | null>(null);
  const [tab, setTab] = useState<'my' | 'discover'>('my');

  useEffect(() => {
    fetchMyChannels();
  }, [fetchMyChannels]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/channels?q=${encodeURIComponent(search)}`);
        setSearchResults(data);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    if (tab === 'discover' && !search) {
      api.get('/channels').then(({ data }) => setSearchResults(data)).catch(() => {});
    }
  }, [tab, search]);

  const handleSubscribe = async (channel: Channel) => {
    setSubscribingId(channel.id);
    try {
      await subscribe(channel.slug);
      await fetchMyChannels();
    } finally {
      setSubscribingId(null);
    }
  };

  const isSubscribed = (channel: Channel) =>
    myChannels.some(c => c.id === channel.id) || channel.isSubscribed;

  const getInitials = (name: string) => name.slice(0, 2).toUpperCase();

  const ChannelRow = ({ channel, showSub = false }: { channel: Channel; showSub?: boolean }) => (
    <button
      key={channel.id}
      onClick={() => onSelect(channel)}
      className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-dark-800/60 transition-colors text-left"
    >
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center text-sm font-bold text-white shrink-0 overflow-hidden">
        {channel.avatar
          ? <img src={channel.avatar} className="w-full h-full object-cover" alt="" />
          : getInitials(channel.title)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <p className="text-sm font-semibold text-white truncate">{channel.title}</p>
          {channel.ownerId === user?.id && (
            <span className="text-[10px] bg-primary-600/20 text-primary-400 px-1.5 py-0.5 rounded-full shrink-0">ваш</span>
          )}
        </div>
        <p className="text-xs text-dark-400 truncate">{channel.description || `@${channel.slug}`}</p>
        <p className="text-xs text-dark-600 mt-0.5 flex items-center gap-1">
          <Users className="w-3 h-3" />
          {channel.subscriberCount} подписчиков
        </p>
      </div>
      {showSub && (
        <button
          onClick={e => { e.stopPropagation(); handleSubscribe(channel); }}
          disabled={subscribingId === channel.id}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors
            ${isSubscribed(channel)
              ? 'bg-dark-700 text-dark-300 hover:bg-red-500/20 hover:text-red-400'
              : 'bg-primary-600 text-white hover:bg-primary-700'
            }`}
        >
          {subscribingId === channel.id
            ? '...'
            : isSubscribed(channel)
              ? <BellOff className="w-3.5 h-3.5" />
              : <Bell className="w-3.5 h-3.5" />
          }
        </button>
      )}
    </button>
  );

  return (
    <div className="h-full flex flex-col bg-dark-950">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800/50">
        <h2 className="text-base font-semibold text-white flex items-center gap-2">
          <Hash className="w-5 h-5 text-primary-400" /> Каналы
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="btn-ghost p-2 rounded-xl"
          title="Создать канал"
        >
          <Plus className="w-5 h-5" />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex px-3 pt-2 gap-1">
        {(['my', 'discover'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors
              ${tab === t ? 'bg-primary-600/20 text-primary-400' : 'text-dark-400 hover:bg-dark-800/40'}`}
          >
            {t === 'my' ? 'Мои каналы' : 'Обзор'}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Найти каналы..."
            className="w-full bg-dark-800/40 border-none rounded-xl pl-10 pr-4 py-2 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 py-1 space-y-0.5">
        {tab === 'my' && !search && (
          <>
            {myChannels.length === 0 && (
              <div className="text-center py-12">
                <Hash className="w-10 h-10 text-dark-600 mx-auto mb-2" />
                <p className="text-dark-500 text-sm">Нет подписок</p>
                <button
                  onClick={() => setTab('discover')}
                  className="text-primary-400 text-xs mt-1 hover:underline"
                >
                  Открыть обзор каналов
                </button>
              </div>
            )}
            {myChannels.map(ch => <ChannelRow key={ch.id} channel={ch} />)}
          </>
        )}

        {(tab === 'discover' || search) && (
          <>
            {searchResults.map(ch => (
              <ChannelRow key={ch.id} channel={ch} showSub />
            ))}
            {searchResults.length === 0 && search && (
              <p className="text-center text-dark-500 py-8 text-sm">Каналы не найдены</p>
            )}
          </>
        )}
      </div>

      {showCreate && (
        <CreateChannelModal
          onClose={() => setShowCreate(false)}
          onCreated={ch => { setShowCreate(false); onSelect(ch); }}
        />
      )}
    </div>
  );
}
