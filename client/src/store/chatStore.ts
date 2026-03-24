import { create } from 'zustand';
import api from '../services/api';
import { getSocket } from '../services/socket';
import { useAuthStore } from './authStore';
import { filterHiddenMessages, hideMessageForUser, isMessageHiddenForUser } from '../utils/hiddenMessages';

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
  reactions?: Array<{ id: string; emoji: string; userId: string }>;
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
  isLoadingMore: boolean;
  hasMore: boolean;
  nextCursor: string | null;
  typingUsers: Map<string, Set<string>>;
  unreadCounts: Map<string, number>;
  totalUnread: number;
  fetchChats: () => Promise<void>;
  setActiveChat: (chat: Chat | null) => void;
  fetchMessages: (chatId: string) => Promise<void>;
  loadMoreMessages: (chatId: string) => Promise<void>;
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
  incrementUnread: (chatId: string) => void;
  clearUnread: (chatId: string) => void;
  reactMessage: (messageId: string, chatId: string, emoji: string) => void;
  applyReaction: (messageId: string, userId: string, emoji: string, reacted: boolean) => void;
}

const maskHiddenLastMessage = (chat: Chat, currentUserId?: string | null): Chat => {
  if (!chat.lastMessage || !isMessageHiddenForUser(chat.lastMessage.id, currentUserId)) {
    return chat;
  }

  return {
    ...chat,
    lastMessage: {
      ...chat.lastMessage,
      text: 'Сообщение скрыто',
      media: [],
    },
  };
};

export const useChatStore = create<ChatState>((set, get) => ({
  chats: [],
  activeChat: null,
  messages: [],
  isLoadingChats: false,
  isLoadingMessages: false,
  isLoadingMore: false,
  hasMore: false,
  nextCursor: null,
  typingUsers: new Map(),
  unreadCounts: new Map(),
  totalUnread: 0,

  fetchChats: async () => {
    set({ isLoadingChats: true });
    try {
      const { data } = await api.get('/chats');
      const currentUserId = useAuthStore.getState().user?.id;
      set({
        chats: (data as Chat[]).map((chat) => maskHiddenLastMessage(chat, currentUserId)),
        isLoadingChats: false,
      });
    } catch (err) {
      console.error('Fetch chats error:', err);
      set({ isLoadingChats: false });
    }
  },

  setActiveChat: (chat) => {
    set({ activeChat: chat, messages: [], nextCursor: null, hasMore: false });
    if (chat) {
      get().fetchMessages(chat.id);
      get().clearUnread(chat.id);
      const socket = getSocket();
      socket?.emit('chat:join', { chatId: chat.id });
    }
  },

  fetchMessages: async (chatId) => {
    set({ isLoadingMessages: true });
    try {
      const { data } = await api.get(`/messages/${chatId}`);
      const currentUserId = useAuthStore.getState().user?.id;
      const visibleMessages = filterHiddenMessages(data.messages as ChatMessage[], currentUserId);
      set({
        messages: visibleMessages,
        isLoadingMessages: false,
        nextCursor: data.nextCursor,
        hasMore: !!data.nextCursor,
      });
      // Mark all unread messages as read
      const unreadIds = visibleMessages
        .filter(m => m.status !== 'READ' && m.senderId !== useAuthStore.getState().user?.id)
        .map(m => m.id);
      if (unreadIds.length > 0) {
        const socket = getSocket();
        socket?.emit('message:read', { chatId, messageIds: unreadIds });
      }
    } catch (err) {
      console.error('Fetch messages error:', err);
      set({ isLoadingMessages: false });
    }
  },

  loadMoreMessages: async (chatId) => {
    const { nextCursor, isLoadingMore } = get();
    if (!nextCursor || isLoadingMore) return;
    set({ isLoadingMore: true });
    try {
      const { data } = await api.get(`/messages/${chatId}?cursor=${nextCursor}`);
      const currentUserId = useAuthStore.getState().user?.id;
      const visibleMessages = filterHiddenMessages(data.messages as ChatMessage[], currentUserId);
      set(state => ({
        messages: [...visibleMessages, ...state.messages],
        nextCursor: data.nextCursor,
        hasMore: !!data.nextCursor,
        isLoadingMore: false,
      }));
    } catch (err) {
      console.error('Load more messages error:', err);
      set({ isLoadingMore: false });
    }
  },

  sendMessage: (data) => {
    const socket = getSocket();
    socket?.emit('message:send', data);
  },

  addMessage: (message) => {
    const { activeChat, chats } = get();
    const currentUserId = useAuthStore.getState().user?.id;
    const hasChatInList = chats.some((chat) => chat.id === message.chatId);
    if (activeChat && message.chatId === activeChat.id) {
      set({ messages: [...get().messages, message] });
    } else if (message.senderId !== currentUserId) {
      // Increment unread for background chats (not sent by me)
      get().incrementUnread(message.chatId);
    }

    if (!hasChatInList) {
      void get().fetchChats();
      return;
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
    const currentUserId = useAuthStore.getState().user?.id;
    const normalizedChat = maskHiddenLastMessage(data as Chat, currentUserId);
    if (!chats.find((c) => c.id === data.id)) {
      set({ chats: [normalizedChat, ...chats] });
    }
    return normalizedChat;
  },

  createGroupChat: async (name, memberIds) => {
    const { data } = await api.post('/chats/group', { name, memberIds });
    const currentUserId = useAuthStore.getState().user?.id;
    const normalizedChat = maskHiddenLastMessage(data as Chat, currentUserId);
    set({ chats: [normalizedChat, ...get().chats] });
    return normalizedChat;
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
    set({
      chats: get().chats.map((chat) =>
        chat.lastMessage?.id === message.id
          ? { ...chat, lastMessage: { ...chat.lastMessage, ...message } }
          : chat,
      ),
    });
  },

  applyDeletedMessage: (messageId, chatId, forAll, currentUserId) => {
    if (forAll) {
      set({
        messages: get().messages.map((m) => {
          if (m.id !== messageId) return m;
          return { ...m, text: null, deletedForAll: true, deletedAt: new Date().toISOString() } as any;
        }),
      });
      set({
        chats: get().chats.map((chat) =>
          chat.id === chatId && chat.lastMessage?.id === messageId
            ? { ...chat, lastMessage: { ...chat.lastMessage, text: 'Сообщение удалено' } }
            : chat,
        ),
      });
      return;
    }

    hideMessageForUser(messageId, currentUserId);
    set({
      messages: get().messages.filter((message) => message.id !== messageId),
      chats: get().chats.map((chat) =>
        chat.id === chatId && chat.lastMessage?.id === messageId
          ? {
            ...chat,
            lastMessage: {
              ...chat.lastMessage,
              text: 'Сообщение скрыто',
              media: [],
            },
          }
          : chat,
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

  incrementUnread: (chatId) => {
    const counts = new Map(get().unreadCounts);
    counts.set(chatId, (counts.get(chatId) || 0) + 1);
    const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
    set({ unreadCounts: counts, totalUnread: total });
  },

  clearUnread: (chatId) => {
    const counts = new Map(get().unreadCounts);
    counts.delete(chatId);
    const total = Array.from(counts.values()).reduce((s, n) => s + n, 0);
    set({ unreadCounts: counts, totalUnread: total });
  },

  reactMessage: (messageId, chatId, emoji) => {
    const socket = getSocket();
    socket?.emit('message:react', { messageId, chatId, emoji });
  },

  applyReaction: (messageId, userId, emoji, reacted) => {
    set({
      messages: get().messages.map(m => {
        if (m.id !== messageId) return m;
        const reactions = m.reactions || [];
        const updated = reacted
          ? [...reactions, { id: `${messageId}-${userId}-${emoji}`, emoji, userId }]
          : reactions.filter(r => !(r.userId === userId && r.emoji === emoji));
        return { ...m, reactions: updated };
      }),
    });
  },
}));
