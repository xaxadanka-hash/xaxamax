const { app, BrowserWindow, session, systemPreferences, ipcMain } = require('electron');
const path = require('path');

let mainWindow;

const isDev = !app.isPackaged;
const SERVER_URL = isDev ? 'http://localhost:5173' : null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 380,
    minHeight: 600,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 15 },
    backgroundColor: '#0a0a0f',
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
    // Allow screen sharing
    const { desktopCapturer } = require('electron');
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

app.whenReady().then(async () => {
  await requestMediaPermissions();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
