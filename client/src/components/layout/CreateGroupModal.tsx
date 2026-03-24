import { useState, useEffect } from 'react';
import { X, Search, Check, Users, ArrowLeft } from 'lucide-react';
import { useChatStore } from '../../store/chatStore';
import api from '../../services/api';

interface CreateGroupModalProps {
  onClose: () => void;
}

interface SearchUser {
  id: string;
  phone: string;
  displayName: string;
  avatar: string | null;
}

export default function CreateGroupModal({ onClose }: CreateGroupModalProps) {
  const { createGroupChat, setActiveChat } = useChatStore();
  const [step, setStep] = useState<'members' | 'name'>('members');
  const [search, setSearch] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUser[]>([]);
  const [selected, setSelected] = useState<Map<string, SearchUser>>(new Map());
  const [groupName, setGroupName] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!search.trim()) {
      setSearchResults([]);
      return;
    }

    const timer = window.setTimeout(async () => {
      try {
        const { data } = await api.get(`/users/search?q=${encodeURIComponent(search)}`);
        setSearchResults(data);
      } catch {
        setSearchResults([]);
      }
    }, 250);

    return () => window.clearTimeout(timer);
  }, [search]);

  const toggleMember = (user: SearchUser) => {
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(user.id)) next.delete(user.id);
      else next.set(user.id, user);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!groupName.trim() || selected.size === 0 || loading) return;
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

  const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-2xl max-h-[88vh] bg-dark-900 border border-dark-700/60 rounded-3xl shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-3 px-4 sm:px-5 py-4 border-b border-dark-800/50">
          {step === 'name' ? (
            <button onClick={() => setStep('members')} className="btn-ghost p-2 rounded-xl" title="Назад">
              <ArrowLeft className="w-5 h-5" />
            </button>
          ) : (
            <button onClick={onClose} className="btn-ghost p-2 rounded-xl" title="Закрыть">
              <X className="w-5 h-5" />
            </button>
          )}

          <div className="flex-1 min-w-0">
            <h2 className="text-base sm:text-lg font-semibold text-white">Создать беседу</h2>
            <p className="text-xs text-dark-400">
              {step === 'members' ? 'Выберите участников' : 'Задайте название беседы'}
            </p>
          </div>

          {step === 'members' && (
            <button
              onClick={() => setStep('name')}
              disabled={selected.size === 0}
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
            {selected.size > 0 && (
              <div className="px-4 sm:px-5 py-3 border-b border-dark-800/30">
                <div className="flex items-center flex-wrap gap-2">
                  {Array.from(selected.values()).map((selectedUser) => (
                    <button
                      key={selectedUser.id}
                      onClick={() => toggleMember(selectedUser)}
                      className="flex items-center gap-1.5 bg-primary-600/20 text-primary-300 px-3 py-1 rounded-full text-sm"
                    >
                      {selectedUser.displayName}
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="px-4 sm:px-5 py-3 border-b border-dark-800/30">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-dark-500" />
                <input
                  autoFocus
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Найти пользователей..."
                  className="w-full bg-dark-800/40 border-none rounded-xl pl-10 pr-4 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:ring-1 focus:ring-primary-500/30"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-4 sm:px-5 py-3 space-y-1">
              {searchResults.map((searchUser) => {
                const isSelected = selected.has(searchUser.id);
                return (
                  <button
                    key={searchUser.id}
                    onClick={() => toggleMember(searchUser)}
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-xl hover:bg-dark-800/60 transition-colors"
                  >
                    <div className="w-10 h-10 rounded-full bg-dark-700 flex items-center justify-center text-sm font-medium shrink-0 overflow-hidden">
                      {searchUser.avatar
                        ? <img src={searchUser.avatar} className="w-full h-full object-cover" alt="" />
                        : getInitials(searchUser.displayName)}
                    </div>

                    <div className="flex-1 min-w-0 text-left">
                      <p className="text-sm font-medium text-white truncate">{searchUser.displayName}</p>
                      <p className="text-xs text-dark-400 truncate">{searchUser.phone}</p>
                    </div>

                    <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-primary-600 border-primary-600' : 'border-dark-600'}`}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                  </button>
                );
              })}

              {search && searchResults.length === 0 && (
                <p className="text-center text-dark-500 py-8 text-sm">Пользователи не найдены</p>
              )}

              {!search && (
                <div className="text-center py-10">
                  <Users className="w-10 h-10 text-dark-600 mx-auto mb-2" />
                  <p className="text-dark-500 text-sm">Найдите участников по имени или номеру</p>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-start pt-12 px-8 gap-6">
            <div className="w-20 h-20 rounded-full bg-dark-800 flex items-center justify-center">
              <Users className="w-10 h-10 text-dark-500" />
            </div>

            <div className="w-full max-w-md">
              <input
                autoFocus
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                onKeyDown={(event) => event.key === 'Enter' && handleCreate()}
                placeholder="Название беседы"
                maxLength={60}
                className="w-full text-center bg-transparent border-b-2 border-dark-700 focus:border-primary-500 outline-none text-white text-2xl py-2 placeholder:text-dark-600 transition-colors"
              />
              <p className="text-xs text-dark-500 text-center mt-2">{selected.size} участников</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
