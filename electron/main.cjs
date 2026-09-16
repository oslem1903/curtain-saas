const { app, BrowserWindow, ipcMain, shell } = require('electron');
const fs = require('fs');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn } = require('child_process');
const isDev = process.env.NODE_ENV === 'development';

// Windows'ta bildirimlerin ve gorev cubugu gruplamasinin dogru uygulamaya
// baglanmasi icin uygulama kimligi (appId ile ayni olmali).
app.setAppUserModelId('com.curtainsaas.app');

// Tek ornek kilidi: kullanici kisayola iki kez tiklarsa ikinci bir pencere
// acilmaz, mevcut pencere one getirilir. (Ayni hesapla iki oturum acilmasini
// ve guncelleme sirasinda cakismayi onler.)
const gotTheLock = app.requestSingleInstanceLock();
let mainWindow = null;

if (!gotTheLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

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
      file.on('error', (err) => {
        // Yarim kalan dosya birakma: bir sonraki denemede bozuk kurulum calismasin.
        fs.unlink(destination, () => reject(err));
      });
    });
    request.on('error', reject);
    // Ag kopmasinda sonsuza kadar beklemeyi engelle.
    request.setTimeout(120000, () => {
      request.destroy(new Error('Guncelleme indirme zaman asimina ugradi.'));
    });
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
  const base = safeFileName(path.basename(parsed.pathname, ext) || 'PerdePro-Setup');
  const fileName = `${safeFileName(payload.version || 'latest')}-${base}${ext}`;
  const updateDir = path.join(app.getPath('userData'), 'updates');
  fs.mkdirSync(updateDir, { recursive: true });
  const destination = path.join(updateDir, fileName);

  await downloadFile(rawUrl, destination);

  // Kurulum eski uygulama dosyalarını silebilmesi için önce mevcut Electron
  // sürecinin kapanmasına izin ver. Aksi halde NSIS "old application files"
  // hatası verip zorunlu güncelleme döngüsüne sokar.
  setTimeout(() => {
    const child = spawn(destination, ['/S'], { detached: true, stdio: 'ignore' });
    child.unref();
  }, 1500);
  app.quit();
  return { ok: true, file: destination };
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    // Pencere bu olcunun altina indirilemez; kucuk ekranda arayuz kirilmaz.
    minWidth: 960,
    minHeight: 600,
    // Icerik hazir olana kadar gosterme: acilista beyaz ekran parlamasi olmaz.
    show: false,
    backgroundColor: '#f8fafc',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, '../public/pwa-512x512.png'),
    title: 'PerdePro'
  });

  mainWindow = win;
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { mainWindow = null; });

  // Hide menu bar
  win.setMenuBarVisibility(false);

  // Dis baglantilar uygulamanin icinde acilip uygulamayi "kaybettirmesin";
  // varsayilan tarayiciya yonlendirilir.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const current = win.webContents.getURL();
    const sameDocument = url.split('#')[0] === current.split('#')[0];
    // Uygulama ici hash rotalari serbest; farkli bir adrese gidis engellenir.
    if (sameDocument) return;
    event.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  if (isDev) {
    win.loadURL('http://localhost:5173');
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }
}

app.whenReady().then(() => {
  if (!gotTheLock) return;
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
