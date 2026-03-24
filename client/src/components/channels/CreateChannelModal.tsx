import { useState } from 'react';
import { X, Hash } from 'lucide-react';
import { useChannelStore, type Channel } from '../../store/channelStore';

interface CreateChannelModalProps {
  onClose: () => void;
  onCreated: (channel: Channel) => void;
}

export default function CreateChannelModal({ onClose, onCreated }: CreateChannelModalProps) {
  const { createChannel } = useChannelStore();
  const [title, setTitle] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [isPublic, setIsPublic] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const autoSlug = (val: string) =>
    val.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '').slice(0, 32);

  const handleTitleChange = (val: string) => {
    setTitle(val);
    if (!slug || slug === autoSlug(title)) setSlug(autoSlug(val));
  };

  const handleCreate = async () => {
    if (!title.trim() || !slug.trim()) return;
    setLoading(true);
    setError('');
    try {
      const channel = await createChannel({ title: title.trim(), slug, description, isPublic });
      onCreated(channel);
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Ошибка создания канала');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-dark-950/95 backdrop-blur-sm flex flex-col">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-dark-800/50">
        <button onClick={onClose} className="btn-ghost p-2 rounded-xl">
          <X className="w-5 h-5" />
        </button>
        <h2 className="text-base font-semibold text-white flex-1">Новый канал</h2>
        <button
          onClick={handleCreate}
          disabled={!title.trim() || !slug.trim() || loading}
          className="btn-primary px-4 py-2 text-sm"
        >
          {loading ? 'Создание...' : 'Создать'}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-8 max-w-lg mx-auto w-full">
        {/* Icon */}
        <div className="flex justify-center mb-8">
          <div className="w-24 h-24 rounded-full bg-gradient-to-br from-primary-600 to-primary-800 flex items-center justify-center">
            <Hash className="w-12 h-12 text-white" />
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <label className="text-xs text-dark-400 block mb-1.5">Название канала</label>
            <input
              autoFocus
              value={title}
              onChange={e => handleTitleChange(e.target.value)}
              maxLength={60}
              placeholder="Мой канал"
              className="input-field"
            />
          </div>

          <div>
            <label className="text-xs text-dark-400 block mb-1.5">Адрес (slug)</label>
            <div className="flex items-center gap-2">
              <span className="text-dark-500 text-sm">@</span>
              <input
                value={slug}
                onChange={e => setSlug(autoSlug(e.target.value))}
                maxLength={32}
                placeholder="my_channel"
                className="input-field flex-1"
              />
            </div>
            <p className="text-xs text-dark-600 mt-1">Только a-z, 0-9 и _ </p>
          </div>

          <div>
            <label className="text-xs text-dark-400 block mb-1.5">Описание (необязательно)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              maxLength={200}
              placeholder="Расскажите о канале..."
              className="input-field resize-none"
            />
          </div>

          <div className="flex items-center justify-between py-3 px-4 bg-dark-800/40 rounded-xl">
            <div>
              <p className="text-sm text-white font-medium">Публичный канал</p>
              <p className="text-xs text-dark-400">Любой может найти и подписаться</p>
            </div>
            <button
              onClick={() => setIsPublic(!isPublic)}
              className={`relative w-11 h-6 rounded-full transition-colors
                ${isPublic ? 'bg-primary-600' : 'bg-dark-600'}`}
            >
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform
                ${isPublic ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>

          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 rounded-xl px-4 py-3">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}
