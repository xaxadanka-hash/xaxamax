import { create } from 'zustand';
import api from '../services/api';

export interface AppNotification {
  id: string;
  type: string;
  title: string;
  body: string | null;
  data: Record<string, string> | null;
  read: boolean;
  createdAt: string;
}

interface NotificationState {
  notifications: AppNotification[];
  unreadCount: number;
  isLoading: boolean;
  fetchNotifications: () => Promise<void>;
  addNotification: (n: Omit<AppNotification, 'id' | 'read' | 'createdAt'>) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  removeNotification: (id: string) => void;
}

export const useNotificationStore = create<NotificationState>((set, get) => ({
  notifications: [],
  unreadCount: 0,
  isLoading: false,

  fetchNotifications: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.get('/notifications');
      set({ notifications: data.notifications, unreadCount: data.unreadCount, isLoading: false });
    } catch (err) {
      console.error('fetchNotifications error:', err);
      set({ isLoading: false });
    }
  },

  addNotification: (n) => {
    const newNotif: AppNotification = {
      id: `local-${Date.now()}`,
      ...n,
      read: false,
      createdAt: new Date().toISOString(),
    };
    set(state => ({
      notifications: [newNotif, ...state.notifications].slice(0, 100),
      unreadCount: state.unreadCount + 1,
    }));
  },

  markRead: (id) => {
    api.patch(`/notifications/${id}/read`).catch(console.error);
    set(state => ({
      notifications: state.notifications.map(n => n.id === id ? { ...n, read: true } : n),
      unreadCount: Math.max(0, state.unreadCount - (state.notifications.find(n => n.id === id && !n.read) ? 1 : 0)),
    }));
  },

  markAllRead: () => {
    api.patch('/notifications/read-all').catch(console.error);
    set(state => ({
      notifications: state.notifications.map(n => ({ ...n, read: true })),
      unreadCount: 0,
    }));
  },

  removeNotification: (id) => {
    api.delete(`/notifications/${id}`).catch(console.error);
    set(state => {
      const notif = state.notifications.find(n => n.id === id);
      return {
        notifications: state.notifications.filter(n => n.id !== id),
        unreadCount: Math.max(0, state.unreadCount - (notif && !notif.read ? 1 : 0)),
      };
    });
  },
}));
