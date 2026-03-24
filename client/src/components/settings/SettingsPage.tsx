import { useState, useRef, useEffect } from 'react';
import { useThemeStore } from '../../store/themeStore';
import { useAuthStore } from '../../store/authStore';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api';
import {
  Camera, LogOut, ChevronRight, Bell, Lock, Palette,
  Phone, Info, Trash2, Check, Moon, Sun,
} from 'lucide-react';

export default function SettingsPage() {
  const { user, logout, checkAuth } = useAuthStore();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [bio, setBio] = useState((user as any)?.bio || '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  const { theme, toggle: toggleTheme } = useThemeStore();
  const [pushLoading, setPushLoading] = useState(false);

  useEffect(() => {
    if ('Notification' in window) {
      setPushEnabled(Notification.permission === 'granted');
    }
  }, []);

  const handleTogglePush = async () => {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    setPushLoading(true);
    try {
      if (pushEnabled) {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.getSubscription();
        if (sub) {
          await api.post('/push/unsubscribe', { endpoint: sub.endpoint });
          await sub.unsubscribe();
        }
        setPushEnabled(false);
      } else {
        const perm = await Notification.requestPermission();
        if (perm !== 'granted') return;
        const { data } = await api.get('/push/vapid-public-key');
        if (!data.key) return;
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(data.key),
        });
        const json = sub.toJSON();
        await api.post('/push/subscribe', { endpoint: json.endpoint, keys: json.keys });
        setPushEnabled(true);
      }
    } catch (err) {
      console.error('Push toggle error:', err);
    } finally {
      setPushLoading(false);
    }
  };

  function urlBase64ToUint8Array(base64String: string) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = window.atob(base64);
    return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
  }

  const getInitials = (name: string) =>
    name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();

  const handleSaveProfile = async () => {
    if (!displayName.trim()) return;
    setSaving(true);
    try {
      await api.patch('/users/profile', { displayName: displayName.trim(), bio: bio.trim() });
      await checkAuth();
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
    setUploadingAvatar(true);
    try {
      const form = new FormData();
      form.append('file', file);
      const { data: media } = await api.post('/media/upload', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await api.patch('/users/profile', { avatar: media.url });
      await checkAuth();
    } catch (err) {
      console.error('Avatar upload error:', err);
    } finally {
      setUploadingAvatar(false);
      e.target.value = '';
    }
  };

  const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div className="mb-6">
      <p className="text-xs font-medium text-dark-500 uppercase tracking-wider px-4 mb-2">{title}</p>
      <div className="bg-dark-900/60 rounded-2xl overflow-hidden border border-dark-800/40">
        {children}
      </div>
    </div>
  );

  const Row = ({
    icon: Icon,
    label,
    value,
    onClick,
    danger,
  }: {
    icon: React.ElementType;
    label: string;
    value?: string;
    onClick?: () => void;
    danger?: boolean;
  }) => (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 w-full px-4 py-3.5 border-b border-dark-800/30 last:border-0 transition-colors
        ${onClick ? 'hover:bg-dark-800/40 active:bg-dark-800/60' : 'cursor-default'}
        ${danger ? 'text-red-400' : 'text-dark-100'}`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0
        ${danger ? 'bg-red-500/15' : 'bg-dark-700/60'}`}>
        <Icon className="w-4 h-4" />
      </div>
      <span className="flex-1 text-sm text-left">{label}</span>
      {value && <span className="text-xs text-dark-500">{value}</span>}
      {onClick && !danger && <ChevronRight className="w-4 h-4 text-dark-600" />}
    </button>
  );

  return (
    <div className="h-full overflow-y-auto bg-dark-950 no-overscroll safe-bottom">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-dark-950/95 backdrop-blur-sm border-b border-dark-800/30 px-4 sm:px-6 py-3 safe-top">
        <h1 className="text-lg font-semibold text-white">Настройки</h1>
      </div>

      <div className="px-4 sm:px-6 pt-6 pb-[calc(6rem+env(safe-area-inset-bottom))] md:pb-16 max-w-2xl mx-auto">
        {/* Avatar + name */}
        <div className="flex flex-col items-center mb-8">
          <div className="relative mb-4">
            <div className="w-24 h-24 rounded-full bg-dark-700 overflow-hidden flex items-center justify-center text-2xl font-bold text-white">
              {user?.avatar
                ? <img src={user.avatar} className="w-full h-full object-cover" alt="" />
                : getInitials(user?.displayName || '?')}
            </div>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploadingAvatar}
              className="absolute bottom-0 right-0 w-8 h-8 bg-primary-600 rounded-full flex items-center justify-center border-2 border-dark-950 hover:bg-primary-700 transition-colors"
            >
              {uploadingAvatar
                ? <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <Camera className="w-4 h-4 text-white" />}
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarUpload} />
          <p className="text-lg font-semibold text-white">{user?.displayName}</p>
          <p className="text-sm text-dark-400 mt-0.5">{(user as any)?.phone}</p>
        </div>

        {/* Profile edit */}
        <Section title="Мой аккаунт">
          <div className="px-4 py-3 space-y-3">
            <div>
              <label className="text-xs text-dark-400 mb-1 block">Имя</label>
              <input
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                className="w-full bg-dark-800/50 border border-dark-700/50 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/30"
                placeholder="Ваше имя"
                maxLength={60}
              />
            </div>
            <div>
              <label className="text-xs text-dark-400 mb-1 block">О себе</label>
              <textarea
                value={bio}
                onChange={e => setBio(e.target.value)}
                rows={2}
                className="w-full bg-dark-800/50 border border-dark-700/50 rounded-xl px-3 py-2.5 text-sm text-white placeholder:text-dark-500 focus:outline-none focus:border-primary-500/50 focus:ring-1 focus:ring-primary-500/30 resize-none"
                placeholder="Расскажите о себе..."
                maxLength={200}
              />
            </div>
            <button
              onClick={handleSaveProfile}
              disabled={saving || !displayName.trim()}
              className="w-full btn-primary flex items-center justify-center gap-2"
            >
              {saved ? <><Check className="w-4 h-4" /> Сохранено</> : saving ? 'Сохранение...' : 'Сохранить'}
            </button>
          </div>
        </Section>

        {/* App settings */}
        <Section title="Приложение">
          <button
            onClick={handleTogglePush}
            disabled={pushLoading || !('PushManager' in window)}
            className="flex items-center gap-3 w-full px-4 py-3.5 border-b border-dark-800/30 hover:bg-dark-800/40 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-dark-700/60 flex items-center justify-center shrink-0">
              <Bell className="w-4 h-4" />
            </div>
            <span className="flex-1 text-sm text-left text-dark-100">Уведомления</span>
            <div className={`relative w-11 h-6 rounded-full transition-colors ${pushEnabled ? 'bg-primary-600' : 'bg-dark-600'}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${pushEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
          </button>
          <Row icon={Lock} label="Конфиденциальность" onClick={() => {}} />
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 w-full px-4 py-3.5 border-b border-dark-800/30 hover:bg-dark-800/40 transition-colors"
          >
            <div className="w-8 h-8 rounded-lg bg-dark-700/60 flex items-center justify-center shrink-0">
              {theme === 'dark' ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
            </div>
            <span className="flex-1 text-sm text-left text-dark-100">Оформление</span>
            <span className="text-xs text-dark-400">{theme === 'dark' ? 'Тёмная' : 'Светлая'}</span>
            <div className={`relative w-11 h-6 rounded-full transition-colors ml-2 ${theme === 'light' ? 'bg-primary-600' : 'bg-dark-600'}`}>
              <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-transform ${theme === 'light' ? 'translate-x-6' : 'translate-x-1'}`} />
            </div>
          </button>
          <Row icon={Phone} label="Телефон" value={(user as any)?.phone || '—'} />
        </Section>

        {/* Info */}
        <Section title="О приложении">
          <Row icon={Info} label="Версия" value="1.0.0" />
        </Section>

        {/* Danger zone */}
        <Section title="Аккаунт">
          <Row
            icon={LogOut}
            label="Выйти"
            onClick={logout}
            danger
          />
          <Row
            icon={Trash2}
            label="Удалить аккаунт"
            onClick={() => {}}
            danger
          />
        </Section>
      </div>
    </div>
  );
}
