import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../store/chatStore';
import {
  UserMinus, MessageCircle, Search, Users, UserPlus, X, Loader2,
} from 'lucide-react';
import api from '../../services/api';

interface Contact {
  id: string;
  contactId: string;
  nickname: string | null;
  contact: {
    id: string;
    displayName: string;
    phone: string;
    avatar: string | null;
    isOnline: boolean;
    lastSeen: string;
  };
}

interface SearchUser {
  id: string;
  displayName: string;
  phone: string;
  avatar: string | null;
  isOnline: boolean;
}

export default function ContactsPage() {
  const navigate = useNavigate();
  const { createPrivateChat, setActiveChat } = useChatStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    api.get('/users/me/contacts')
      .then(r => setContacts(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!showAddModal) {
      setUserSearch('');
      setSearchResults([]);
      setSearchError(null);
      return;
    }

    const query = userSearch.trim();
    if (query.length < 2) {
      setSearchResults([]);
      setSearchError(null);
      setSearchingUsers(false);
      return;
    }

    const timeoutId = window.setTimeout(async () => {
      setSearchingUsers(true);
      setSearchError(null);
      try {
        const { data } = await api.get('/users/search', { params: { q: query } });
        const existingIds = new Set(contacts.map((contact) => contact.contactId));
        const filteredResults = (data as SearchUser[]).filter((searchUser) => !existingIds.has(searchUser.id));
        setSearchResults(filteredResults);
      } catch (err) {
        console.error('Search users error:', err);
        setSearchResults([]);
        setSearchError('Не удалось выполнить поиск');
      } finally {
        setSearchingUsers(false);
      }
    }, 250);

    return () => window.clearTimeout(timeoutId);
  }, [userSearch, showAddModal, contacts]);

  const handleRemove = async (contactId: string) => {
    setRemovingId(contactId);
    try {
      await api.delete(`/users/me/contacts/${contactId}`);
      setContacts(prev => prev.filter(c => c.contactId !== contactId));
    } finally {
      setRemovingId(null);
    }
  };

  const handleMessage = async (contactId: string) => {
    try {
      const chat = await createPrivateChat(contactId);
      setActiveChat(chat);
      navigate('/');
    } catch (err) {
      console.error('Create chat error:', err);
    }
  };

  const handleAddContact = async (searchUser: SearchUser) => {
    setAddingId(searchUser.id);
    try {
      const { data } = await api.post('/users/me/contacts', { contactId: searchUser.id });
      setContacts((prev) => {
        if (prev.some((contact) => contact.contactId === data.contactId)) return prev;
        return [...prev, data];
      });
      setSearchResults((prev) => prev.filter((entry) => entry.id !== searchUser.id));
      setUserSearch('');
    } catch (err) {
      console.error('Add contact error:', err);
      setSearchError('Не удалось добавить контакт');
    } finally {
      setAddingId(null);
    }
  };

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const filtered = contacts.filter(c =>
    (c.nickname || c.contact.displayName).toLowerCase().includes(search.toLowerCase()) ||
    c.contact.phone.includes(search)
  );

  return (
    <div className="h-full flex flex-col bg-dark-950">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50">
        <Users className="w-5 h-5 text-primary-400" />
        <h1 className="text-base font-semibold text-white">Контакты</h1>
        <span className="ml-auto text-xs text-dark-500">{contacts.length}</span>
        <button
          onClick={() => setShowAddModal(true)}
          className="btn-primary px-3 py-2 text-xs flex items-center gap-1.5"
          title="Добавить контакт"
        >
          <UserPlus className="w-4 h-4" />
          Добавить
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Поиск контактов..."
            className="w-full bg-dark-800/40 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary-500 border-t-transparent rounded-full animate-spin" />
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 text-center px-8">
            <div className="w-16 h-16 rounded-full bg-dark-800/60 flex items-center justify-center">
              <Users className="w-8 h-8 text-dark-600" />
            </div>
            <p className="text-dark-400 text-sm">
              {search ? 'Ничего не найдено' : 'Добавьте первый контакт через кнопку «Добавить»'}
            </p>
          </div>
        )}

        {filtered.map(c => (
          <div key={c.id} className="flex items-center gap-3 px-4 py-3 hover:bg-dark-800/30 transition-colors">
            {/* Avatar */}
            <button
              onClick={() => navigate(`/profile/${c.contact.id}`)}
              className="relative shrink-0"
            >
              <div className="w-12 h-12 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium overflow-hidden">
                {c.contact.avatar
                  ? <img src={c.contact.avatar} className="w-full h-full object-cover" alt="" />
                  : <span className="text-dark-300">{getInitials(c.contact.displayName)}</span>
                }
              </div>
              {c.contact.isOnline && (
                <div className="absolute bottom-0 right-0 w-3 h-3 rounded-full bg-green-500 border-2 border-dark-950" />
              )}
            </button>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <button
                onClick={() => navigate(`/profile/${c.contact.id}`)}
                className="text-sm font-medium text-white hover:underline text-left truncate block"
              >
                {c.nickname || c.contact.displayName}
              </button>
              <p className="text-xs text-dark-500 truncate">
                {c.contact.isOnline
                  ? <span className="text-green-400">в сети</span>
                  : c.contact.phone}
              </p>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={() => handleMessage(c.contact.id)}
                title="Написать"
                className="p-2 text-dark-500 hover:text-primary-400 transition-colors"
              >
                <MessageCircle className="w-4 h-4" />
              </button>
              <button
                onClick={() => handleRemove(c.contact.id)}
                disabled={removingId === c.contact.id}
                title="Удалить из контактов"
                className="p-2 text-dark-500 hover:text-red-400 transition-colors"
              >
                <UserMinus className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {showAddModal && (
        <div className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="w-full sm:max-w-lg glass border border-dark-700/80 rounded-t-3xl sm:rounded-3xl overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50">
              <h2 className="text-sm font-semibold text-white">Добавить в контакты</h2>
              <button
                onClick={() => setShowAddModal(false)}
                className="ml-auto btn-ghost p-2 rounded-xl"
                title="Закрыть"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 max-h-[75vh] overflow-y-auto safe-bottom">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                <input
                  value={userSearch}
                  onChange={(e) => setUserSearch(e.target.value)}
                  placeholder="Имя или телефон..."
                  className="w-full bg-dark-800/40 rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                />
              </div>

              {userSearch.trim().length > 0 && userSearch.trim().length < 2 && (
                <p className="text-xs text-dark-500">Введите минимум 2 символа</p>
              )}

              {searchingUsers && (
                <div className="flex items-center justify-center py-6 text-dark-400 text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Поиск...
                </div>
              )}

              {!searchingUsers && searchError && (
                <div className="text-sm text-red-400 py-2">{searchError}</div>
              )}

              {!searchingUsers && !searchError && userSearch.trim().length >= 2 && searchResults.length === 0 && (
                <div className="text-sm text-dark-500 py-2">Пользователи не найдены</div>
              )}

              {!searchingUsers && searchResults.map((searchUser) => (
                <div key={searchUser.id} className="flex items-center gap-3 p-2 rounded-xl hover:bg-dark-800/40 transition-colors">
                  <button
                    onClick={() => {
                      setShowAddModal(false);
                      navigate(`/profile/${searchUser.id}`);
                    }}
                    className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium overflow-hidden shrink-0"
                  >
                    {searchUser.avatar
                      ? <img src={searchUser.avatar} className="w-full h-full object-cover" alt="" />
                      : getInitials(searchUser.displayName)}
                  </button>
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => {
                        setShowAddModal(false);
                        navigate(`/profile/${searchUser.id}`);
                      }}
                      className="text-sm font-medium text-white hover:underline truncate block text-left"
                    >
                      {searchUser.displayName}
                    </button>
                    <p className="text-xs text-dark-500 truncate">{searchUser.phone}</p>
                  </div>
                  <button
                    onClick={() => handleAddContact(searchUser)}
                    disabled={addingId === searchUser.id}
                    className="btn-primary px-3 py-2 text-xs flex items-center gap-1.5 shrink-0"
                  >
                    {addingId === searchUser.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                    Добавить
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
