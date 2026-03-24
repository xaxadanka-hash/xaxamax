import { create } from 'zustand';

const STORAGE_KEY = 'xaxamax:preferences';

interface PreferencesState {
  showStories: boolean;
  showMessagePreview: boolean;
  compactSidebar: boolean;
  setShowStories: (value: boolean) => void;
  setShowMessagePreview: (value: boolean) => void;
  setCompactSidebar: (value: boolean) => void;
}

const defaults = {
  showStories: true,
  showMessagePreview: true,
  compactSidebar: false,
};

function loadPreferences() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<typeof defaults>;
    return {
      showStories: typeof parsed.showStories === 'boolean' ? parsed.showStories : defaults.showStories,
      showMessagePreview: typeof parsed.showMessagePreview === 'boolean' ? parsed.showMessagePreview : defaults.showMessagePreview,
      compactSidebar: typeof parsed.compactSidebar === 'boolean' ? parsed.compactSidebar : defaults.compactSidebar,
    };
  } catch {
    return defaults;
  }
}

function persist(state: Pick<PreferencesState, 'showStories' | 'showMessagePreview' | 'compactSidebar'>) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

const initial = loadPreferences();

export const usePreferencesStore = create<PreferencesState>((set, get) => ({
  ...initial,
  setShowStories: (value) => {
    set({ showStories: value });
    persist({
      showStories: value,
      showMessagePreview: get().showMessagePreview,
      compactSidebar: get().compactSidebar,
    });
  },
  setShowMessagePreview: (value) => {
    set({ showMessagePreview: value });
    persist({
      showStories: get().showStories,
      showMessagePreview: value,
      compactSidebar: get().compactSidebar,
    });
  },
  setCompactSidebar: (value) => {
    set({ compactSidebar: value });
    persist({
      showStories: get().showStories,
      showMessagePreview: get().showMessagePreview,
      compactSidebar: value,
    });
  },
}));
