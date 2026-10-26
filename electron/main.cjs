// Electron main process: opens the built web app from an app:// scheme (so fetch() of the
// HarfBuzz wasm and bundled fonts works), grants the local-fonts permission so "Fonts on
// this computer…" lists the fonts installed on the machine, and adds native Open/Save.
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, net, session, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const DIST = path.join(__dirname, '..', 'dist');
const DEV_URL = process.env.KPC_DEV_URL; // e.g. http://localhost:5173 when running against `vite`

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
]);

/** PDF paths handed to the app by the OS (Finder "Open with", double-click, command line). */
const pendingFiles = [];
let mainWindow = null;

function isPdfArg(arg) {
  return typeof arg === 'string' && /\.pdf$/i.test(arg) && !arg.startsWith('-');
}

async function sendFile(win, filePath) {
  try {
    const bytes = await fs.readFile(filePath);
    win.webContents.send('open-file', { name: path.basename(filePath), bytes: new Uint8Array(bytes) });
  } catch (e) {
    dialog.showErrorBox('Cannot open file', `${filePath}\n${e.message}`);
  }
}

async function openDialog(win) {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Open PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  });
  if (!canceled && filePaths[0]) await sendFile(win, filePaths[0]);
}

function buildMenu(win) {
  const isMac = process.platform === 'darwin';
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open PDF…', accelerator: 'CmdOrCtrl+O', click: () => openDialog(win) },
        { label: 'Save PDF As…', accelerator: 'CmdOrCtrl+S', click: () => win.webContents.send('request-save') },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [{ label: 'KhmerPDFcraft on GitHub', click: () => shell.openExternal('https://github.com/kompheak7711/KhmerPDFcraft') }],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    title: 'KhmerPDFcraft',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  mainWindow = win;
  buildMenu(win);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadURL('app://app/index.html');
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
  });
  return win;
}

app.on('open-file', (event, filePath) => {
  // macOS: Finder double-click or drag onto the Dock icon.
  event.preventDefault();
  if (mainWindow) sendFile(mainWindow, filePath);
  else pendingFiles.push(filePath);
});

app.whenReady().then(() => {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(DIST, rel));
    if (!file.startsWith(DIST)) return new Response('Forbidden', { status: 403 });
    const response = await net.fetch(pathToFileURL(file).toString());
    if (!file.endsWith('.html')) return response;
    const headers = new Headers(response.headers);
    headers.set(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; font-src 'self' data: blob:; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self' data: blob:; object-src 'none'",
    );
    return new Response(response.body, { status: response.status, headers });
  });

  const allowed = new Set(['local-fonts', 'clipboard-read', 'clipboard-sanitized-write']);
  session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowed.has(permission));

  // The page tells us when its listeners are in place; only then are queued files delivered.
  ipcMain.handle('renderer-ready', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    while (pendingFiles.length) await sendFile(win, pendingFiles.shift());
  });
  ipcMain.handle('open-dialog', () => (mainWindow ? openDialog(mainWindow) : undefined));
  ipcMain.handle('save-pdf', async (_e, { name, bytes }) => {
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
      title: 'Save PDF',
      defaultPath: path.join(app.getPath('documents'), name),
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (canceled || !filePath) return { saved: false };
    await fs.writeFile(filePath, Buffer.from(bytes));
    return { saved: true, path: filePath };
  });

  for (const arg of process.argv.slice(1)) if (isPdfArg(arg)) pendingFiles.push(arg);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
