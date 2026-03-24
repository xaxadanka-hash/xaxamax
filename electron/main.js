const {
  app,
  BrowserWindow,
  session,
  systemPreferences,
  ipcMain,
  desktopCapturer,
  Notification,
  Tray,
  Menu,
  nativeImage,
} = require('electron');
const path = require('path');

let mainWindow;
let tray = null;

const isDev = !app.isPackaged;
const SERVER_URL = isDev ? 'http://localhost:5173' : null;
const APP_ICON_PATH = path.join(__dirname, 'assets', process.platform === 'darwin' ? 'icon.png' : 'icon.png');

function showMainWindow() {
  if (!mainWindow) return;

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }

  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;

  const trayIcon = nativeImage.createFromPath(APP_ICON_PATH);
  tray = new Tray(trayIcon);
  tray.setToolTip('xaxamax');
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Открыть xaxamax',
      click: () => showMainWindow(),
    },
    {
      label: 'Скрыть',
      click: () => mainWindow?.hide(),
    },
    {
      type: 'separator',
    },
    {
      label: 'Выход',
      click: () => app.quit(),
    },
  ]));

  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
      return;
    }
    showMainWindow();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 380,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0a0a0f',
    icon: APP_ICON_PATH,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
    show: false,
  });

  // Grant permissions for camera, microphone, screen capture
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'display-capture', 'notifications'];
    if (allowedPermissions.includes(permission)) {
      callback(true);
    } else {
      callback(false);
    }
  });

  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    const allowedPermissions = ['media', 'mediaKeySystem', 'display-capture', 'notifications'];
    return allowedPermissions.includes(permission);
  });

  // Handle screen sharing - enable desktopCapturer
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen', 'window'] }).then((sources) => {
      if (sources.length > 0) {
        callback({ video: sources[0] });
      } else {
        callback({});
      }
    });
  });

  if (isDev) {
    mainWindow.loadURL(SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    const appPath = path.join(process.resourcesPath, 'app', 'index.html');
    mainWindow.loadFile(appPath);
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (event) => {
    if (process.platform === 'darwin' && !app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Request macOS permissions for camera and microphone
async function requestMediaPermissions() {
  if (process.platform === 'darwin') {
    try {
      const micStatus = systemPreferences.getMediaAccessStatus('microphone');
      if (micStatus !== 'granted') {
        await systemPreferences.askForMediaAccess('microphone');
      }
      const camStatus = systemPreferences.getMediaAccessStatus('camera');
      if (camStatus !== 'granted') {
        await systemPreferences.askForMediaAccess('camera');
      }
    } catch (err) {
      console.error('Permission request error:', err);
    }
  }
}

ipcMain.handle('desktop-sources:list', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen', 'window'],
    thumbnailSize: { width: 320, height: 180 },
  });

  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    displayId: source.display_id,
    thumbnail: source.thumbnail.toDataURL(),
    appIcon: source.appIcon ? source.appIcon.toDataURL() : null,
  }));
});

ipcMain.on('desktop-notification:show', (_event, payload = {}) => {
  if (!Notification.isSupported()) return;

  const notification = new Notification({
    title: payload.title || 'xaxamax',
    body: payload.body || '',
    icon: APP_ICON_PATH,
    silent: false,
  });

  notification.on('click', () => {
    showMainWindow();
  });

  notification.show();
});

ipcMain.on('window:focus', () => {
  showMainWindow();
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showMainWindow();
  });
}

app.whenReady().then(async () => {
  await requestMediaPermissions();
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      createTray();
      return;
    }
    showMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
