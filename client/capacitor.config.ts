import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xaxamax.app',
  appName: 'xaxamax',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
    url: process.env.VITE_API_URL || undefined,
    cleartext: false,
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
  },
};

export default config;
