import { create } from 'zustand';
import api from '../services/api';
import { getSocket } from '../services/socket';

export interface ChatMessage {
  id: string;
  chatId: string;
  senderId: string;
  text: string | null;
  type: string;
  status: string;
  replyToId: string | null;
  forwardedFromId: string | null;
  editedAt: string | null;
  pinnedAt: string | null;
  deletedForAll: boolean;
  createdAt: string;
  sender: { id: string; displayName: string; avatar: string | null };
  replyTo?: { id: string; text: string | null; sender: { id: string; displayName: string } } | null;
  forwardedFrom?: { id: string; text: string | null; sender: { id: string; displayName: string } } | null;
  media?: Array<{ id: string; url: string; filename: string; mimeType: string; size: number; duration?: number }>;
}

export interface Chat {
  id: string;
  type: 'PRIVATE' | 'GROUP';
  name: string | null;
  avatar: string | null;
  isOnline?: boolean;
  lastMessage: ChatMessage | null;
  members: Array<{
    id: string;
    userId: string;
    role: string;
    user: { id: string; displayName: string; avatar: string | null; isOnline: boolean; lastSeen: string };
  }>;
  updatedAt: string;
}

interface ChatState {
  chats: Chat[];
  activeChat: Chat | null;
  messages: ChatMessage[];
  isLoadingChats: boolean;
  isLoadingMessages: boolean;
  typingUsers: Map<string, Set<string>>;
  fetchChats: () => Promise<void>;
  setActiveChat: (chat: Chat | null) => void;
  fetchMessages: (chatId: string) => Promise<void>;
  sendMessage: (data: { chatId: string; text?: string; type?: string; replyToId?: string; mediaIds?: string[] }) => void;
  addMessage: (message: ChatMessage) => void;
  editMessage: (messageId: string, chatId: string, text: string) => void;
  deleteMessage: (messageId: string, chatId: string, forAll: boolean) => void;
  pinMessage: (messageId: string, chatId: string, pin: boolean) => void;
  applyEditedMessage: (message: ChatMessage) => void;
  applyDeletedMessage: (messageId: string, chatId: string, forAll: boolean, currentUserId: string) => void;
  applyPinnedMessage: (messageId: string, chatId: string, pinned: boolean) => void;
  createPrivateChat: (userId: string) => Promise<Chat>;
  createGroupChat: (name: string, memberIds: string[]) => Promise<Chat>;
  setTyping: (chatId: string, userId: string, isTyping: boolean) => void;
  updateMessageStatus: (messageId: string, status: string) => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChat: null,
  messages: [],
  isLoadingChats: false,
  isLoadingMessages: false,
  typingUsers: new Map(),

  fetchChats: async () => {
    set({ isLoadingChats: true });
    try {
      const { data } = await api.get('/chats');
      set({ chats: data, isLoadingChats: false });
    } catch (err) {
      console.error('Fetch chats error:', err);
      set({ isLoadingChats: false });
    }
  },

  setActiveChat: (chat) => {
    set({ activeChat: chat, messages: [] });
    if (chat) {
      get().fetchMessages(chat.id);
      const socket = getSocket();
      socket?.emit('chat:join', { chatId: chat.id });
    }
  },

  fetchMessages: async (chatId) => {
    set({ isLoadingMessages: true });
    try {
      const { data } = await api.get(`/messages/${chatId}`);
      set({ messages: data.messages, isLoadingMessages: false });
    } catch (err) {
      console.error('Fetch messages error:', err);
      set({ isLoadingMessages: false });
    }
  },

  sendMessage: (data) => {
    const socket = getSocket();
    socket?.emit('message:send', data);
  },

  addMessage: (message) => {
    const { activeChat, chats } = get();
    if (activeChat && message.chatId === activeChat.id) {
      set({ messages: [...get().messages, message] });
    }
    // Update last message in chat list
    set({
      chats: chats.map((c) =>
        c.id === message.chatId ? { ...c, lastMessage: message, updatedAt: message.createdAt } : c,
      ).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    });
  },

  createPrivateChat: async (userId) => {
    const { data } = await api.post('/chats/private', { userId });
    const { chats } = get();
    if (!chats.find((c) => c.id === data.id)) {
      set({ chats: [data, ...chats] });
    }
    return data;
  },

  createGroupChat: async (name, memberIds) => {
    const { data } = await api.post('/chats/group', { name, memberIds });
    set({ chats: [data, ...get().chats] });
    return data;
  },

  setTyping: (chatId, userId, isTyping) => {
    const typingUsers = new Map(get().typingUsers);
    const chatTyping = new Set(typingUsers.get(chatId) || []);
    if (isTyping) chatTyping.add(userId);
    else chatTyping.delete(userId);
    if (chatTyping.size === 0) typingUsers.delete(chatId);
    else typingUsers.set(chatId, chatTyping);
    set({ typingUsers });
  },

  updateMessageStatus: (messageId, status) => {
    set({
      messages: get().messages.map((m) => (m.id === messageId ? { ...m, status } : m)),
    });
  },

  editMessage: (messageId, chatId, text) => {
    const socket = getSocket();
    socket?.emit('message:edit', { messageId, chatId, text });
  },

  deleteMessage: (messageId, chatId, forAll) => {
    const socket = getSocket();
    socket?.emit('message:delete', { messageId, chatId, forAll });
  },

  pinMessage: (messageId, chatId, pin) => {
    const socket = getSocket();
    socket?.emit('message:pin', { messageId, chatId, pin });
  },

  applyEditedMessage: (message) => {
    set({
      messages: get().messages.map((m) => (m.id === message.id ? { ...m, ...message } : m)),
    });
  },

  applyDeletedMessage: (messageId, chatId, forAll, currentUserId) => {
    set({
      messages: get().messages.map((m) => {
        if (m.id !== messageId) return m;
        if (forAll || m.senderId === currentUserId) {
          return { ...m, text: null, deletedForAll: true, deletedAt: new Date().toISOString() } as any;
        }
        return m;
      }),
    });
    // Remove from chat list last message if needed
    const { chats } = get();
    set({
      chats: chats.map((c) =>
        c.id === chatId && c.lastMessage?.id === messageId
          ? { ...c, lastMessage: { ...c.lastMessage, text: 'Сообщение удалено' } }
          : c
      ),
    });
  },

  applyPinnedMessage: (messageId, chatId, pinned) => {
    set({
      messages: get().messages.map((m) =>
        m.id === messageId ? { ...m, pinnedAt: pinned ? new Date().toISOString() : null } : m
      ),
    });
  },
}));
