import { create } from 'zustand';

type Theme = 'dark' | 'light';

interface ThemeState {
  theme: Theme;
  setTheme: (t: Theme) => void;
  toggle: () => void;
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('light-theme', t === 'light');
  localStorage.setItem('theme', t);
}

const stored = (localStorage.getItem('theme') as Theme) || 'dark';
applyTheme(stored);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: stored,
  setTheme: (t) => { applyTheme(t); set({ theme: t }); },
  toggle: () => {
    set(state => {
      const next: Theme = state.theme === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      return { theme: next };
    });
  },
}));
