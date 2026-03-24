import { create } from 'zustand';
import api from '../services/api';

export interface StoryItem {
  id: string;
  authorId: string;
  mediaUrl: string;
  mimeType: string;
  text: string | null;
  duration: number;
  expiresAt: string;
  createdAt: string;
  viewed: boolean;
  viewers: Array<{ userId: string }>;
}

export interface StoryGroup {
  author: { id: string; displayName: string; avatar: string | null };
  stories: StoryItem[];
}

interface StoryState {
  groups: StoryGroup[];
  isLoading: boolean;
  fetchStories: () => Promise<void>;
  markViewed: (storyId: string) => void;
  deleteStory: (storyId: string, authorId: string) => void;
  addGroup: (group: StoryGroup) => void;
}

export const useStoryStore = create<StoryState>((set, get) => ({
  groups: [],
  isLoading: false,

  fetchStories: async () => {
    set({ isLoading: true });
    try {
      const { data } = await api.get('/stories');
      set({ groups: data });
    } catch (err) {
      console.error('fetchStories error:', err);
    } finally {
      set({ isLoading: false });
    }
  },

  markViewed: (storyId) => {
    api.post(`/stories/${storyId}/view`).catch(console.error);
    set({
      groups: get().groups.map(g => ({
        ...g,
        stories: g.stories.map(s =>
          s.id === storyId ? { ...s, viewed: true } : s
        ),
      })),
    });
  },

  deleteStory: (storyId, authorId) => {
    api.delete(`/stories/${storyId}`).catch(console.error);
    set({
      groups: get().groups
        .map(g => {
          if (g.author.id !== authorId) return g;
          return { ...g, stories: g.stories.filter(s => s.id !== storyId) };
        })
        .filter(g => g.stories.length > 0),
    });
  },

  addGroup: (group) => {
    set(state => {
      const exists = state.groups.find(g => g.author.id === group.author.id);
      if (exists) {
        return {
          groups: state.groups.map(g =>
            g.author.id === group.author.id
              ? { ...g, stories: [...g.stories, ...group.stories] }
              : g
          ),
        };
      }
      return { groups: [group, ...state.groups] };
    });
  },
}));
