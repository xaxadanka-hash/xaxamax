import { useState, useEffect } from 'react';
import { X, Search, Check, Users } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import { useAuthStore } from '../../store/authStore';
import api from '../../services/api';

interface CreateGroupModalProps {
  onClose: () => void;
}

export default function CreateGroupModal({ onClose }: CreateGroupModalProps) {
  const { user } = useAuthStore();
  const { createGroupChat, setActiveChat } = useChatStore();
  const [step, setStep] = useState<'members' | 'name'>('members');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [selected, setSelected] = useState<Map<string, any>>(new Map());
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!search.trim()) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(search)}`);
        setSearchResults(data);
      } catch { setSearchResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const toggleMember = (u: any) => {
    setSelected(prev => {
      const next = new Map(prev);
      if (next.has(u.id)) next.delete(u.id);
      else next.set(u.id, u);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!groupName.trim() || selected.size === 0) return;
    setLoading(true);
    try {
      const chat = await createGroupChat(groupName.trim(), Array.from(selected.keys()));
      setActiveChat(chat);
      onClose();
    } catch (err) {
      console.error('Create group error:', err);
    } finally {
      setLoading(false);
    }
  };

  const getInitials = (name: string) => name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 bg-dark-950/95 backdrop-blur-sm flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50">
        <button onClick={onClose} className="btn-ghost p-2 rounded-xl">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold text-white flex-1">
          {step === 'members' ? 'Добавить участников' : 'Название беседы'}
        </h2>
        {step === 'members' && selected.size > 0 && (
          <button
            onClick={() => setStep('name')}
            className="btn-primary px-4 py-2 text-sm"
          >
            Далее
          </button>
        )}
        {step === 'name' && (
          <button
            onClick={handleCreate}
            disabled={!groupName.trim() || loading}
            className="btn-primary px-4 py-2 text-sm"
          >
            {loading ? 'Создание...' : 'Создать'}
          </button>
        )}
      </div>

      {step === 'members' ? (
        <>
          {/* Selected chips */}
          {selected.size > 0 && (
            <div className="flex gap-2 px-4 py-2 flex-wrap border-b border-dark-800/30">
              {Array.from(selected.values()).map(u => (
                <button
                  key={u.id}
                  onClick={() => toggleMember(u)}
                  className="flex items-center gap-1.5 bg-primary-600/20 text-primary-300 px-3 py-1 rounded-full text-sm"
                >
                  {u.displayName}
                  <X className="w-3.5 h-3.5" />
                </button>
              ))}
            </div>
          )}

          {/* Search */}
          <div className="px-4 py-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
              <input
                autoFocus
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Найти пользователей..."
                className="w-full bg-dark-800/40 border-none rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
              />
            </div>
          </div>

          {/* Results */}
          <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
            {searchResults.map(u => {
              const isSelected = selected.has(u.id);
              return (
                <button
                  key={u.id}
                  onClick={() => toggleMember(u)}
                  className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-dark-800/60 transition-colors"
                >
                  <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium shrink-0 overflow-hidden">
                    {u.avatar
                      ? <img src={u.avatar} className="w-full h-full object-cover" alt="" />
                      : getInitials(u.displayName)}
                  </div>
                  <div className="flex-1 min-w-0 text-left">
                    <p className="text-sm font-medium text-white truncate">{u.displayName}</p>
                    <p className="text-xs text-dark-400">{u.phone}</p>
                  </div>
                  <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all
                    ${isSelected ? 'bg-primary-600 border-primary-600' : 'border-dark-600'}`}>
                    {isSelected && <Check className="w-3 h-3 text-white" />}
                  </div>
                </button>
              );
            })}
            {search && searchResults.length === 0 && (
              <p className="text-center text-dark-500 py-8 text-sm">Пользователи не найдены</p>
            )}
            {!search && (
              <div className="text-center py-8">
                <Users className="w-10 h-10 text-dark-600 mx-auto mb-2" />
                <p className="text-dark-500 text-sm">Найдите участников по имени или номеру</p>
              </div>
            )}
          </div>
        </>
      ) : (
        /* Name step */
        <div className="flex-1 flex flex-col items-center justify-start pt-12 px-8 gap-6">
          <div className="w-20 h-20 rounded-full bg-dark-700 flex items-center justify-center">
            <Users className="w-10 h-10 text-dark-500" />
          </div>
          <div className="w-full">
            <input
              autoFocus
              value={groupName}
              onChange={e => setGroupName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
              placeholder="Название беседы"
              maxLength={60}
              className="w-full text-center bg-transparent border-b-2 border-dark-700 focus:border-primary-500 outline-none text-white text-xl py-2 placeholder:text-dark-600 transition-colors"
            />
            <p className="text-xs text-dark-500 text-center mt-2">
              {selected.size} участников
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
