import { useEffect, useRef, useState } from 'react';
import { Bell, X, Check, MessageCircle, Heart, Phone } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { ru } from 'date-fns/locale';
import { useNotificationStore } from '../../store/notificationStore';
import { useNavigate } from 'react-router-dom';
import { useChatStore } from '../../store/chatStore';

const TYPE_ICON: Record<string, React.ReactNode> = {
  MESSAGE: <MessageCircle className="w-4 h-4 text-primary-400" />,
  CALL: <Phone className="w-4 h-4 text-green-400" />,
  POST_LIKE: <Heart className="w-4 h-4 text-red-400" />,
  COMMENT: <MessageCircle className="w-4 h-4 text-yellow-400" />,
  CONTACT_REQUEST: <MessageCircle className="w-4 h-4 text-blue-400" />,
};

export default function NotificationBell() {
  const { notifications, unreadCount, fetchNotifications, markRead, markAllRead, removeNotification } =
    useNotificationStore();
  const { chats, setActiveChat } = useChatStore();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleNotifClick = (n: (typeof notifications)[0]) => {
    markRead(n.id);
    if (n.type === 'MESSAGE' && n.data?.chatId) {
      const chat = chats.find(c => c.id === n.data!.chatId);
      if (chat) { setActiveChat(chat); navigate('/'); }
    }
    setOpen(false);
  };

  return (
    <div className="relative" ref={panelRef}>
      <button
        onClick={() => setOpen(o => !o)}
        className="relative btn-ghost p-2 rounded-xl"
        title="Уведомления"
      >
        <Bell className="w-5 h-5" />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-0.5">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-1 w-80 max-h-[480px] flex flex-col glass rounded-2xl shadow-2xl border border-dark-700/40 z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-dark-800/40">
            <span className="text-sm font-semibold text-white">Уведомления</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300"
              >
                <Check className="w-3.5 h-3.5" />
                Прочитать все
              </button>
            )}
          </div>

          {/* List */}
          <div className="flex-1 overflow-y-auto">
            {notifications.length === 0 && (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-dark-700 mx-auto mb-2" />
                <p className="text-dark-500 text-sm">Нет уведомлений</p>
              </div>
            )}

            {notifications.map(n => (
              <div
                key={n.id}
                onClick={() => handleNotifClick(n)}
                className={`flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors border-b border-dark-800/20 last:border-0
                  ${n.read ? 'hover:bg-dark-800/20' : 'bg-primary-600/5 hover:bg-primary-600/10'}`}
              >
                <div className="w-8 h-8 rounded-full bg-dark-800/60 flex items-center justify-center shrink-0 mt-0.5">
                  {TYPE_ICON[n.type] ?? <Bell className="w-4 h-4 text-dark-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${n.read ? 'text-dark-300' : 'text-white'}`}>
                    {n.title}
                  </p>
                  {n.body && (
                    <p className="text-xs text-dark-500 truncate mt-0.5">{n.body}</p>
                  )}
                  <p className="text-[10px] text-dark-600 mt-1">
                    {formatDistanceToNow(new Date(n.createdAt), { addSuffix: true, locale: ru })}
                  </p>
                </div>
                {!n.read && (
                  <div className="w-2 h-2 rounded-full bg-primary-500 mt-1.5 shrink-0" />
                )}
                <button
                  onClick={e => { e.stopPropagation(); removeNotification(n.id); }}
                  className="p-0.5 text-dark-700 hover:text-dark-400 shrink-0 self-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
