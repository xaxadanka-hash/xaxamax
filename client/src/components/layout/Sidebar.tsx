import { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useChatStore, Chat } from '../../store/chatStore';
import { useAuthStore } from '../../store/authStore';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  MessageCircle, Search, Plus, Settings, LogOut, Newspaper, User,
  Phone, Video, Users,
} from 'lucide-react';
import api from '../../services/api';

interface SidebarProps {
  onChatSelect?: () => void;
}

export default function Sidebar({ onChatSelect }: SidebarProps) {
  const { chats, fetchChats, setActiveChat, activeChat } = useChatStore();
  const { user, logout } = useAuthStore();
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [showMenu, setShowMenu] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const timer = setTimeout(async () => {
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(search)}`);
        setSearchResults(data);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleUserClick = async (userId: string) => {
    try {
      const chat = await useChatStore.getState().createPrivateChat(userId);
      setActiveChat(chat);
      setSearch('');
      setSearchResults([]);
      onChatSelect?.();
      navigate('/');
    } catch (err) {
      console.error('Create chat error:', err);
    }
  };

  const handleChatClick = (chat: Chat) => {
    setActiveChat(chat);
    onChatSelect?.();
    navigate('/');
  };

  const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const formatTime = (date: string) => {
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ru });
    } catch { return ''; }
  };

  return (
    <div className="h-full flex flex-col bg-dark-950 border-r border-dark-800/50">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800/50">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-primary-500" />
          xaxamax
        </h1>
        <div className="flex items-center gap-1">
          <button onClick={() => setShowMenu(!showMenu)} className="btn-ghost p-2 rounded-xl">
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Menu dropdown */}
      {showMenu && (
        <div className="absolute top-14 right-2 z-50 glass rounded-xl p-1 min-w-[200px] shadow-xl">
          <button onClick={() => { navigate('/profile'); setShowMenu(false); }}
            className="sidebar-item w-full text-left">
            <User className="w-4 h-4" /> Профиль
          </button>
          <button onClick={() => { navigate('/feed'); setShowMenu(false); }}
            className="sidebar-item w-full text-left">
            <Newspaper className="w-4 h-4" /> Лента
          </button>
          <hr className="border-dark-700/50 my-1" />
          <button onClick={logout} className="sidebar-item w-full text-left text-red-400 hover:text-red-300">
            <LogOut className="w-4 h-4" /> Выйти
          </button>
        </div>
      )}

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            type="text"
            placeholder="Поиск..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-dark-800/40 border-none rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="flex px-3 gap-1 mb-1">
        <button
          onClick={() => navigate('/')}
          className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
            location.pathname === '/' ? 'bg-primary-600/20 text-primary-400' : 'text-dark-400 hover:bg-dark-800/40'
          }`}
        >
          <MessageCircle className="w-4 h-4 mx-auto mb-0.5" />
          Чаты
        </button>
        <button
          onClick={() => navigate('/feed')}
          className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
            location.pathname === '/feed' ? 'bg-primary-600/20 text-primary-400' : 'text-dark-400 hover:bg-dark-800/40'
          }`}
        >
          <Newspaper className="w-4 h-4 mx-auto mb-0.5" />
          Лента
        </button>
        <button
          onClick={() => navigate('/profile')}
          className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
            location.pathname === '/profile' ? 'bg-primary-600/20 text-primary-400' : 'text-dark-400 hover:bg-dark-800/40'
          }`}
        >
          <User className="w-4 h-4 mx-auto mb-0.5" />
          Профиль
        </button>
      </div>

      {/* Search results */}
      {searchResults.length > 0 && (
        <div className="px-3 mb-2">
          <p className="text-xs text-dark-500 px-2 mb-1">Пользователи</p>
          {searchResults.map((u: any) => (
            <button
              key={u.id}
              onClick={() => handleUserClick(u.id)}
              className="sidebar-item w-full text-left"
            >
              <div className="w-10 h-10 rounded-full bg-primary-600/30 flex items-center justify-center text-sm font-medium text-primary-300 flex-shrink-0">
                {u.avatar ? <img src={u.avatar} className="w-full h-full rounded-full object-cover" /> : getInitials(u.displayName)}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium text-white truncate">{u.displayName}</p>
                <p className="text-xs text-dark-400">{u.phone}</p>
              </div>
              {u.isOnline && <div className="w-2 h-2 rounded-full bg-green-500 ml-auto" />}
            </button>
          ))}
        </div>
      )}

      {/* Chat list */}
      <div className="flex-1 overflow-y-auto px-2">
        {chats.length === 0 && !search && (
          <div className="text-center py-8">
            <Users className="w-10 h-10 text-dark-600 mx-auto mb-2" />
            <p className="text-dark-500 text-sm">Нет чатов</p>
            <p className="text-dark-600 text-xs mt-1">Найдите пользователей в поиске</p>
          </div>
        )}
        {chats.map((chat) => (
          <button
            key={chat.id}
            onClick={() => handleChatClick(chat)}
            className={`sidebar-item w-full text-left mb-0.5 ${activeChat?.id === chat.id ? 'sidebar-item-active' : ''}`}
          >
            <div className="relative flex-shrink-0">
              <div className="w-12 h-12 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium text-dark-300">
                {chat.avatar ? <img src={chat.avatar} className="w-full h-full rounded-full object-cover" /> : getInitials(chat.name || '?')}
              </div>
              {chat.isOnline && (
                <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-dark-950" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex justify-between items-baseline">
                <p className="text-sm font-medium text-white truncate">{chat.name || 'Без названия'}</p>
                {chat.lastMessage && (
                  <span className="text-xs text-dark-500 flex-shrink-0 ml-2">
                    {formatTime(chat.lastMessage.createdAt)}
                  </span>
                )}
              </div>
              {chat.lastMessage && (
                <p className="text-xs text-dark-400 truncate mt-0.5">
                  {chat.type === 'GROUP' && <span className="text-dark-300">{chat.lastMessage.sender.displayName}: </span>}
                  {chat.lastMessage.text || (chat.lastMessage.type === 'IMAGE' ? '🖼 Фото' : chat.lastMessage.type === 'VOICE' ? '🎤 Голосовое' : '📎 Файл')}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
