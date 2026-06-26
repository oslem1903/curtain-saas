const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const isDev = process.env.NODE_ENV === 'development';

function safeFileName(value) {
  return String(value || 'update')
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 80);
}

function downloadFile(url, destination, redirects = 0) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const request = client.get(parsed, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode || 0) && response.headers.location && redirects < 5) {
        response.resume();
        const nextUrl = new URL(response.headers.location, parsed).toString();
        downloadFile(nextUrl, destination, redirects + 1).then(resolve).catch(reject);
        return;
      }

      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        response.resume();
        reject(new Error(`Guncelleme dosyasi indirilemedi. HTTP ${response.statusCode}`));
        return;
      }

      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on('finish', () => file.close(resolve));
      file.on('error', reject);
    });
    request.on('error', reject);
  });
}

ipcMain.handle('desktop-update:install', async (_event, payload = {}) => {
  const rawUrl = String(payload.url || '').trim();
  if (!rawUrl) throw new Error('Guncelleme indirme linki bos.');

  const parsed = new URL(rawUrl);
  if (!['https:', 'http:'].includes(parsed.protocol)) {
    throw new Error('Guncelleme linki http veya https olmali.');
  }

  const ext = path.extname(parsed.pathname) || '.exe';
  const base = safeFileName(path.basename(parsed.pathname, ext) || 'Perde-Yonetim-SaaS-Setup');
  const fileName = `${safeFileName(payload.version || 'latest')}-${base}${ext}`;
  const updateDir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(updateDir, { recursive: true });
  const destination = path.join(updateDir, fileName);

  await downloadFile(rawUrl, destination);

  const child = spawn(destination, ['/S'], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();

  setTimeout(() => app.quit(), 1000);
  return { ok: true, file: destination };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/pwa-512x512.png'),
    title: 'Perde Yönetim SaaS'
  });

  // Hide menu bar
  win.setMenuBarVisibility(false);

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
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
