import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../store/chatStore';
import { useAuthStore } from '../../store/authStore';
import { UserMinus, MessageCircle, Search, Users } from 'lucide-react';
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

export default function ContactsPage() {
  const navigate = useNavigate();
  const { createPrivateChat, setActiveChat } = useChatStore();
  const { user } = useAuthStore();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [removingId, setRemovingId] = useState<string | null>(null);

  useEffect(() => {
    api.get('/users/me/contacts')
      .then(r => setContacts(r.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

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
              {search ? 'Ничего не найдено' : 'Добавьте контакты через поиск в чатах'}
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
    </div>
  );
}
