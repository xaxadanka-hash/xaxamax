export {};

declare global {
  interface Window {
    electronAPI?: {
      platform: string;
      isElectron: boolean;
      getDesktopSources: () => Promise<Array<{
        id: string;
        name: string;
        displayId?: string;
        thumbnail: string;
        appIcon: string | null;
      }>>;
      showNotification: (payload: { title?: string; body?: string | null }) => void;
      focusWindow: () => void;
    };
  }
}
