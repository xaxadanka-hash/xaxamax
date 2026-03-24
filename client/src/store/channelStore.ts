import { create } from 'zustand';
import { SOCKET_EVENTS } from '@xaxamax/shared/socket-events';
import api from '../services/api';
import { getSocket } from '../services/socket';

export interface ChannelPostMedia {
  id: string;
  url: string;
  mimeType: string;
  filename: string;
  size: number;
}

export interface ChannelPostReaction {
  id: string;
  emoji: string;
  userId: string;
}

export interface ChannelPost {
  id: string;
  channelId: string;
  authorId: string;
  text: string | null;
  viewCount: number;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  author: { id: string; displayName: string; avatar: string | null };
  media: ChannelPostMedia[];
  reactions: ChannelPostReaction[];
}

export interface Channel {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  avatar: string | null;
  ownerId: string;
  isPublic: boolean;
  subscriberCount: number;
  createdAt: string;
  isSubscribed?: boolean;
  isAdmin?: boolean;
  _count?: { subscribers: number; posts: number };
  subscribers?: Array<{ isAdmin: boolean }>;
  posts?: ChannelPost[];
}

interface ChannelState {
  myChannels: Channel[];
  activeChannel: Channel | null;
  posts: ChannelPost[];
  isLoadingPosts: boolean;
  fetchMyChannels: () => Promise<void>;
  setActiveChannel: (channel: Channel | null) => void;
  fetchPosts: (slug: string) => Promise<void>;
  createChannel: (data: { title: string; slug: string; description?: string; isPublic?: boolean }) => Promise<Channel>;
  subscribe: (slug: string) => Promise<boolean>;
  createPost: (slug: string, text: string, mediaIds?: string[]) => Promise<void>;
  deletePost: (slug: string, postId: string) => void;
  addPost: (post: ChannelPost) => void;
  react: (slug: string, postId: string, emoji: string, currentUserId: string) => void;
}

export const useChannelStore = create<ChannelState>((set, get) => ({
  myChannels: [],
  activeChannel: null,
  posts: [],
  isLoadingPosts: false,

  fetchMyChannels: async () => {
    try {
      const { data } = await api.get('/channels/my');
      set({ myChannels: data });
    } catch (err) {
      console.error('fetchMyChannels error:', err);
    }
  },

  setActiveChannel: (channel) => set({ activeChannel: channel, posts: [] }),

  fetchPosts: async (slug) => {
    set({ isLoadingPosts: true });
    try {
      const { data } = await api.get(`/channels/${slug}/posts`);
      set({ posts: data.posts });
    } catch (err) {
      console.error('fetchPosts error:', err);
    } finally {
      set({ isLoadingPosts: false });
    }
  },

  createChannel: async (data) => {
    const { data: channel } = await api.post('/channels', data);
    set(state => ({ myChannels: [channel, ...state.myChannels] }));
    return channel;
  },

  subscribe: async (slug) => {
    const { data } = await api.post(`/channels/${slug}/subscribe`);
    const { subscribed } = data;
    if (subscribed) {
      const { data: channel } = await api.get(`/channels/${slug}`);
      set(state => ({ myChannels: [channel, ...state.myChannels] }));
    } else {
      set(state => ({ myChannels: state.myChannels.filter(c => c.slug !== slug) }));
    }
    return subscribed;
  },

  createPost: async (slug, text, mediaIds) => {
    const { data } = await api.post(`/channels/${slug}/posts`, { text, mediaIds });
    // Broadcast via socket so other subscribers get it too
    const socket = getSocket();
    socket?.emit(SOCKET_EVENTS.channel.post, { channelId: data.post.channelId, post: data.post });
    set(state => ({ posts: [...state.posts, data.post] }));
  },

  deletePost: (slug, postId) => {
    api.delete(`/channels/${slug}/posts/${postId}`).catch(console.error);
    set(state => ({ posts: state.posts.filter(p => p.id !== postId) }));
  },

  addPost: (post) => {
    set(state => {
      if (state.posts.find(p => p.id === post.id)) return state;
      return { posts: [...state.posts, post] };
    });
  },

  react: async (slug, postId, emoji, currentUserId) => {
    try {
      const { data } = await api.post(`/channels/${slug}/posts/${postId}/react`, { emoji });
      set(state => ({
        posts: state.posts.map(p => {
          if (p.id !== postId) return p;
          const reactions = data.reacted
            ? [...p.reactions, { id: Date.now().toString(), emoji, userId: currentUserId }]
            : p.reactions.filter(r => !(r.userId === currentUserId && r.emoji === emoji));
          return { ...p, reactions };
        }),
      }));
    } catch (err) {
      console.error('react error:', err);
    }
  },
}));
