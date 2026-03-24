import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useChatStore, type Chat } from '../../store/chatStore';
import { useAuthStore } from '../../store/authStore';
import { usePreferencesStore } from '../../store/preferencesStore';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import {
  MessageCircle,
  Search,
  Settings,
  Users,
  User,
  Newspaper,
  SquarePen,
  Shield,
} from 'lucide-react';
import CreateGroupModal from './CreateGroupModal';
import StoryStrip from '../stories/StoryStrip';
import NotificationBell from '../notifications/NotificationBell';
import api from '../../services/api';
import { filterHiddenMessages } from '../../utils/hiddenMessages';

const PENDING_CHAT_SEARCH_STORAGE_KEY = 'xaxamax:pending-chat-search';
const OPEN_CHAT_SEARCH_EVENT = 'xaxamax:open-chat-search';

interface SidebarProps {
  onChatSelect?: () => void;
}

interface SearchUser {
  id: string;
  phone: string;
  displayName: string;
  avatar: string | null;
  isOnline: boolean;
}

interface SearchMessageResult {
  id: string;
  chatId: string;
  text: string | null;
  type: string;
  createdAt: string;
  sender: {
    id: string;
    displayName: string;
    avatar: string | null;
  };
  chat: {
    id: string;
    name: string | null;
    type: string;
  };
}

const NAV_ITEMS = [
  { path: '/', label: 'Чаты', icon: MessageCircle },
  { path: '/contacts', label: 'Контакты', icon: Users },
  { path: '/feed', label: 'Стена', icon: Newspaper },
  { path: '/profile', label: 'Профиль', icon: User },
] as const;

export default function Sidebar({ onChatSelect }: SidebarProps) {
  const { chats, fetchChats, setActiveChat, activeChat, unreadCounts } = useChatStore();
  const { user } = useAuthStore();
  const { showStories, showMessagePreview, compactSidebar } = usePreferencesStore();

  const [search, setSearch] = useState('');
  const [userResults, setUserResults] = useState<SearchUser[]>([]);
  const [messageResults, setMessageResults] = useState<SearchMessageResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    fetchChats();
  }, [fetchChats]);

  const normalizedSearch = search.trim();
  const hasActiveSearch = normalizedSearch.length > 0;
  const chatLookup = useMemo(() => new Map(chats.map((chat) => [chat.id, chat])), [chats]);

  const filteredChats = useMemo(() => {
    if (!hasActiveSearch) return [];

    const query = normalizedSearch.toLowerCase();
    return chats
      .filter((chat) => {
        const name = (chat.name || '').toLowerCase();
        const lastMessageText = (chat.lastMessage?.text || '').toLowerCase();
        const memberNames = chat.members.map((member) => member.user.displayName.toLowerCase()).join(' ');
        return name.includes(query) || lastMessageText.includes(query) || memberNames.includes(query);
      })
      .slice(0, 8);
  }, [chats, hasActiveSearch, normalizedSearch]);

  useEffect(() => {
    if (!hasActiveSearch) {
      setUserResults([]);
      setMessageResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const controller = new AbortController();
    const timeoutId = window.setTimeout(async () => {
      setIsSearching(true);
      setSearchError(null);

      try {
        const [usersResponse, messagesResponse] = await Promise.all([
          api.get('/users/search', {
            params: { q: normalizedSearch },
            signal: controller.signal,
          }),
          api.get('/messages/search', {
            params: { q: normalizedSearch, limit: 12 },
            signal: controller.signal,
          }),
        ]);

        setUserResults(usersResponse.data || []);
        setMessageResults(filterHiddenMessages(messagesResponse.data.messages || [], user?.id));
      } catch (err: any) {
        if (err?.code === 'ERR_CANCELED' || controller.signal.aborted) return;
        console.error('Sidebar search error:', err);
        setUserResults([]);
        setMessageResults([]);
        setSearchError('Не удалось выполнить поиск');
      } finally {
        if (!controller.signal.aborted) {
          setIsSearching(false);
        }
      }
    }, 300);

    return () => {
      controller.abort();
      window.clearTimeout(timeoutId);
    };
  }, [hasActiveSearch, normalizedSearch, user?.id]);

  const clearSearch = () => {
    setSearch('');
    setUserResults([]);
    setMessageResults([]);
    setSearchError(null);
    setIsSearching(false);
  };

  const finalizeSelection = () => {
    clearSearch();
    onChatSelect?.();
    navigate('/');
  };

  const handleUserClick = async (userId: string) => {
    try {
      const chat = await useChatStore.getState().createPrivateChat(userId);
      setActiveChat(chat);
      finalizeSelection();
    } catch (err) {
      console.error('Create chat error:', err);
    }
  };

  const handleChatClick = (chat: Chat) => {
    setActiveChat(chat);
    finalizeSelection();
  };

  const openChatById = async (chatId: string) => {
    const existingChat = chatLookup.get(chatId);
    if (existingChat) {
      setActiveChat(existingChat);
      return existingChat;
    }

    const { data } = await api.get(`/chats/${chatId}`);
    setActiveChat(data as Chat);
    return data as Chat;
  };

  const handleMessageClick = async (message: SearchMessageResult) => {
    const payload = { chatId: message.chatId, query: normalizedSearch };

    try {
      window.sessionStorage.setItem(PENDING_CHAT_SEARCH_STORAGE_KEY, JSON.stringify(payload));
      await openChatById(message.chatId);
      finalizeSelection();
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent(OPEN_CHAT_SEARCH_EVENT, { detail: payload }));
      }, 0);
    } catch (err) {
      window.sessionStorage.removeItem(PENDING_CHAT_SEARCH_STORAGE_KEY);
      console.error('Open message search result error:', err);
    }
  };

  const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  const formatTime = (date: string) => {
    try {
      return formatDistanceToNow(new Date(date), { addSuffix: true, locale: ru });
    } catch {
      return '';
    }
  };

  const getChatPreview = (chat: Chat) => {
    if (!chat.lastMessage) return 'Нет сообщений';
    if (chat.lastMessage.deletedForAll) return 'Сообщение удалено';
    if (chat.lastMessage.text) return chat.lastMessage.text;

    switch (chat.lastMessage.type) {
      case 'IMAGE':
        return 'Фото';
      case 'VOICE':
        return 'Голосовое';
      case 'VIDEO':
        return 'Видео';
      default:
        return 'Файл';
    }
  };

  const getMessagePreview = (message: SearchMessageResult) => {
    if (message.text?.trim()) return message.text;

    switch (message.type) {
      case 'IMAGE':
        return 'Фото';
      case 'VOICE':
        return 'Голосовое сообщение';
      case 'VIDEO':
        return 'Видео';
      default:
        return 'Медиафайл';
    }
  };

  const getSearchChatName = (message: SearchMessageResult) => {
    return chatLookup.get(message.chatId)?.name || message.chat.name || 'Чат';
  };

  const hasSearchResults = filteredChats.length > 0 || userResults.length > 0 || messageResults.length > 0;

  const renderChatItem = (chat: Chat) => {
    const unread = unreadCounts.get(chat.id) || 0;

    return (
      <button
        key={chat.id}
        onClick={() => handleChatClick(chat)}
        className={`sidebar-item w-full text-left mb-0.5 ${compactSidebar ? 'py-2' : 'py-2.5'} ${activeChat?.id === chat.id ? 'sidebar-item-active' : ''}`}
      >
        <div className="relative flex-shrink-0">
          <div className={`${compactSidebar ? 'w-10 h-10 text-xs' : 'w-12 h-12 text-sm'} rounded-full bg-dark-700 flex items-center justify-center font-medium text-dark-300 overflow-hidden`}>
            {chat.avatar ? <img src={chat.avatar} className="w-full h-full rounded-full object-cover" alt="" /> : getInitials(chat.name || '?')}
          </div>
          {chat.isOnline && (
            <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-dark-950" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex justify-between items-baseline gap-2">
            <p className={`${compactSidebar ? 'text-[13px]' : 'text-sm'} font-medium text-white truncate`}>
              {chat.name || 'Без названия'}
            </p>
            {chat.lastMessage && (
              <span className="text-[11px] text-dark-500 flex-shrink-0">
                {formatTime(chat.lastMessage.createdAt)}
              </span>
            )}
          </div>

          {showMessagePreview && chat.lastMessage && (
            <p className="text-xs text-dark-400 truncate mt-0.5">
              {chat.type === 'GROUP' && <span className="text-dark-300">{chat.lastMessage.sender.displayName}: </span>}
              {getChatPreview(chat)}
            </p>
          )}
        </div>

        {unread > 0 && (
          <span className="shrink-0 ml-1 min-w-[20px] h-5 bg-primary-600 text-white text-[10px] font-bold rounded-full flex items-center justify-center px-1">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
    );
  };

  return (
    <div className="relative h-full min-h-dvh flex flex-col bg-dark-950 border-r border-dark-800/50 safe-top safe-x overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800/50 shrink-0">
        <h1 className="text-xl font-bold text-white flex items-center gap-2">
          <MessageCircle className="w-6 h-6 text-primary-500" />
          xaxamax
        </h1>

        <div className="flex items-center gap-1">
          <button
            onClick={() => setShowCreateGroup(true)}
            className="btn-ghost p-2 rounded-xl"
            title="Создать беседу"
          >
            <SquarePen className="w-5 h-5" />
          </button>
          <NotificationBell />
          <button
            onClick={() => navigate('/settings')}
            className="btn-ghost p-2 rounded-xl"
            title="Настройки"
          >
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5 px-3 py-2 border-b border-dark-800/40 shrink-0">
        {NAV_ITEMS.map(({ path, label, icon: Icon }) => {
          const isActive = path === '/' ? location.pathname === '/' : location.pathname.startsWith(path);
          return (
            <button
              key={path}
              onClick={() => {
                if (path === '/') {
                  setActiveChat(null);
                  navigate('/');
                  return;
                }
                navigate(path);
              }}
              className={`flex flex-col items-center justify-center gap-1 rounded-xl py-2 text-[10px] font-medium transition-colors ${isActive ? 'bg-primary-600/20 text-primary-300' : 'text-dark-400 hover:bg-dark-800/60 hover:text-dark-200'}`}
            >
              <Icon className="w-4 h-4" />
              <span className="leading-none truncate">{label}</span>
            </button>
          );
        })}
      </div>

      {(user as any)?.isAdmin && (
        <div className="px-3 py-2 border-b border-dark-800/30 shrink-0">
          <button
            onClick={() => navigate('/admin')}
            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl bg-primary-600/10 text-primary-300 hover:bg-primary-600/20 transition-colors"
          >
            <Shield className="w-4 h-4" />
            Администрирование
          </button>
        </div>
      )}

      {showStories && (
        <div className="shrink-0 border-b border-dark-800/30">
          <StoryStrip />
        </div>
      )}

      <div className="px-3 py-2 shrink-0">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            type="text"
            placeholder="Поиск чатов, людей, сообщений..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-dark-800/40 border-none rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
        </div>
      </div>

      {hasActiveSearch ? (
        <div className="flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-3">
          {isSearching && (
            <div className="px-3 py-2 text-xs text-dark-500">Ищем по xaxamax...</div>
          )}

          {filteredChats.length > 0 && (
            <SearchSection title="Чаты">
              {filteredChats.map((chat) => renderChatItem(chat))}
            </SearchSection>
          )}

          {userResults.length > 0 && (
            <SearchSection title="Пользователи">
              {userResults.map((searchUser) => (
                <button
                  key={searchUser.id}
                  onClick={() => handleUserClick(searchUser.id)}
                  className="sidebar-item w-full text-left mb-0.5"
                >
                  <div className="w-10 h-10 rounded-full bg-primary-600/30 flex items-center justify-center text-sm font-medium text-primary-300 flex-shrink-0 overflow-hidden">
                    {searchUser.avatar
                      ? <img src={searchUser.avatar} className="w-full h-full rounded-full object-cover" alt="" />
                      : getInitials(searchUser.displayName)}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{searchUser.displayName}</p>
                    <p className="text-xs text-dark-400">{searchUser.phone}</p>
                  </div>
                  {searchUser.isOnline && <div className="w-2 h-2 rounded-full bg-green-500 ml-auto" />}
                </button>
              ))}
            </SearchSection>
          )}

          {messageResults.length > 0 && (
            <SearchSection title="Сообщения">
              {messageResults.map((message) => (
                <button
                  key={`${message.chatId}-${message.id}`}
                  onClick={() => handleMessageClick(message)}
                  className="sidebar-item w-full text-left mb-0.5"
                >
                  <div className="w-10 h-10 rounded-full bg-dark-800 flex items-center justify-center text-sm font-medium text-dark-300 flex-shrink-0 overflow-hidden">
                    {message.sender.avatar
                      ? <img src={message.sender.avatar} className="w-full h-full rounded-full object-cover" alt="" />
                      : getInitials(message.sender.displayName)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-white truncate">{getSearchChatName(message)}</p>
                      <span className="text-[10px] text-dark-500 shrink-0">{formatTime(message.createdAt)}</span>
                    </div>
                    <p className="text-xs text-primary-400 truncate">{message.sender.displayName}</p>
                    <p className="text-xs text-dark-400 truncate">{getMessagePreview(message)}</p>
                  </div>
                </button>
              ))}
            </SearchSection>
          )}

          {!isSearching && searchError && (
            <div className="px-4 py-6 text-center text-sm text-red-400">
              {searchError}
            </div>
          )}

          {!isSearching && !searchError && !hasSearchResults && (
            <div className="px-4 py-8 text-center">
              <Search className="w-10 h-10 text-dark-600 mx-auto mb-2" />
              <p className="text-dark-400 text-sm">Ничего не найдено</p>
              <p className="text-dark-600 text-xs mt-1">Попробуй другое имя, номер или текст сообщения</p>
            </div>
          )}
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto px-2 pb-[calc(1rem+env(safe-area-inset-bottom))] md:pb-3">
          {chats.length === 0 && (
            <div className="text-center py-8">
              <Users className="w-10 h-10 text-dark-600 mx-auto mb-2" />
              <p className="text-dark-500 text-sm">Нет чатов</p>
              <p className="text-dark-600 text-xs mt-1">Найдите пользователей в поиске</p>
            </div>
          )}

          {chats.map((chat) => renderChatItem(chat))}
        </div>
      )}

      {showCreateGroup && (
        <CreateGroupModal onClose={() => setShowCreateGroup(false)} />
      )}
    </div>
  );
}

function SearchSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="text-[11px] uppercase tracking-[0.12em] text-dark-500 px-3 mb-1.5">{title}</p>
      {children}
    </div>
  );
}
