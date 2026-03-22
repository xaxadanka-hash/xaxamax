import { useState } from 'react';
import { useAuthStore } from '../../store/authStore';
import { Camera, Save, Loader2 } from 'lucide-react';
import api from '../../services/api';

export default function ProfilePage() {
  const { user, updateProfile } = useAuthStore();
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState(user?.bio || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateProfile({ displayName, bio });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error('Save profile error:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append('file', file);
    try {
      const { data: media } = await api.post('/media/upload', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await updateProfile({ avatar: media.url });
    } catch (err) {
      console.error('Avatar upload error:', err);
    }
  };

  const getInitials = (name: string) => name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase();

  return (
    <div className="h-full overflow-y-auto">
      <div className="max-w-lg mx-auto px-4 py-8">
        <h2 className="text-2xl font-bold text-white mb-8">Профиль</h2>

        <div className="glass rounded-2xl p-6">
          {/* Avatar */}
          <div className="flex justify-center mb-6">
            <div className="relative group">
              <div className="w-24 h-24 rounded-full bg-primary-600/30 flex items-center justify-center text-2xl font-bold text-primary-300 overflow-hidden">
                {user?.avatar ? (
                  <img src={user.avatar} className="w-full h-full object-cover" alt="" />
                ) : (
                  getInitials(user?.displayName || '?')
                )}
              </div>
              <label className="absolute inset-0 bg-black/50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                <Camera className="w-6 h-6 text-white" />
                <input type="file" className="hidden" accept="image/*" onChange={handleAvatarUpload} />
              </label>
            </div>
          </div>

          {/* Phone (read-only) */}
          <div className="mb-4">
            <label className="text-xs text-dark-400 mb-1 block">Телефон</label>
            <div className="input-field bg-dark-900/50 cursor-not-allowed text-dark-400">{user?.phone}</div>
          </div>

          {/* Display name */}
          <div className="mb-4">
            <label className="text-xs text-dark-400 mb-1 block">Имя</label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              className="input-field"
              placeholder="Ваше имя"
            />
          </div>

          {/* Bio */}
          <div className="mb-6">
            <label className="text-xs text-dark-400 mb-1 block">О себе</label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
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
            {saved ? 'Сохранено!' : saving ? 'Сохранение...' : 'Сохранить'}
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="glass rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">0</p>
            <p className="text-xs text-dark-400 mt-1">Контактов</p>
          </div>
          <div className="glass rounded-xl p-4 text-center">
            <p className="text-2xl font-bold text-white">0</p>
            <p className="text-xs text-dark-400 mt-1">Постов</p>
          </div>
        </div>
      </div>
    </div>
  );
}
