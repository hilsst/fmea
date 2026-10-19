import { app, BrowserWindow, dialog, ipcMain, Menu, safeStorage, shell } from 'electron';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { buildWorkbook } from '../shared/excel';
import type { Project } from '../shared/types';
import * as ai from './ai';

let win: BrowserWindow | null = null;
let dirty = false;
let forceClose = false;

const userFile = (name: string) => path.join(app.getPath('userData'), name);
const RECOVERY = () => userFile('recovery.fmea.json');
const CONFIG = () => userFile('config.json');

interface Config {
  apiKeyEnc?: string;
  recent?: string[];
}

function readConfig(): Config {
  try {
    return JSON.parse(fssync.readFileSync(CONFIG(), 'utf8')) as Config;
  } catch {
    return {};
  }
}
function writeConfig(c: Config) {
  fssync.mkdirSync(path.dirname(CONFIG()), { recursive: true });
  fssync.writeFileSync(CONFIG(), JSON.stringify(c, null, 2));
}
function apiKey(): string {
  const c = readConfig();
  if (!c.apiKeyEnc) return '';
  try {
    const buf = Buffer.from(c.apiKeyEnc, 'base64');
    return safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(buf) : buf.toString('utf8');
  } catch {
    return '';
  }
}
function addRecent(file: string) {
  const c = readConfig();
  c.recent = [file, ...(c.recent ?? []).filter((f) => f !== file)].slice(0, 8);
  writeConfig(c);
}

function send(channel: string, ...args: unknown[]) {
  win?.webContents.send(channel, ...args);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 1000,
    minHeight: 640,
    title: 'FMEA Studio',
    backgroundColor: '#f4f6fa',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) win.loadURL(devUrl);
  else win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  win.on('close', (e) => {
    if (!dirty || forceClose) return;
    const r = dialog.showMessageBoxSync(win!, {
      type: 'warning',
      buttons: ['Kaydet ve çık', 'Kaydetmeden çık', 'Vazgeç'],
      defaultId: 0,
      cancelId: 2,
      title: 'Kaydedilmemiş değişiklikler',
      message: 'Projede kaydedilmemiş değişiklikler var.',
      detail: 'Çıkmadan önce kaydetmek ister misiniz?',
    });
    if (r === 2) e.preventDefault();
    else if (r === 0) {
      e.preventDefault();
      send('menu', 'save-and-quit');
    } else {
      fssync.rmSync(RECOVERY(), { force: true });
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
}

function buildMenu() {
  const m = (id: string) => () => send('menu', id);
  const tpl: Electron.MenuItemConstructorOptions[] = [
    {
      label: 'Dosya',
      submenu: [
        { label: 'Yeni Proje', accelerator: 'CmdOrCtrl+N', click: m('new') },
        { label: 'Aç…', accelerator: 'CmdOrCtrl+O', click: m('open') },
        { label: 'Kaydet', accelerator: 'CmdOrCtrl+S', click: m('save') },
        { label: 'Farklı Kaydet…', accelerator: 'CmdOrCtrl+Shift+S', click: m('saveAs') },
        { type: 'separator' },
        { label: 'Excel’e Aktar…', accelerator: 'CmdOrCtrl+E', click: m('export') },
        { label: 'Örnek Proje Yükle', click: m('sample') },
        { type: 'separator' },
        { role: 'quit', label: 'Çıkış' },
      ],
    },
    {
      label: 'Düzen',
      submenu: [
        { label: 'Geri Al', accelerator: 'CmdOrCtrl+Z', click: m('undo') },
        { label: 'Yinele', accelerator: 'CmdOrCtrl+Y', click: m('redo') },
        { type: 'separator' },
        { role: 'cut', label: 'Kes' },
        { role: 'copy', label: 'Kopyala' },
        { role: 'paste', label: 'Yapıştır' },
        { role: 'selectAll', label: 'Tümünü Seç' },
      ],
    },
    {
      label: 'Görünüm',
      submenu: [
        { role: 'reload', label: 'Yenile' },
        { role: 'toggleDevTools', label: 'Geliştirici Araçları' },
        { type: 'separator' },
        { role: 'zoomIn', label: 'Yakınlaştır' },
        { role: 'zoomOut', label: 'Uzaklaştır' },
        { role: 'resetZoom', label: 'Gerçek Boyut' },
        { role: 'togglefullscreen', label: 'Tam Ekran' },
      ],
    },
    {
      label: 'Yardım',
      submenu: [
        { label: 'Kullanım Kılavuzu', click: m('help') },
        { label: 'Hakkında', click: () => dialog.showMessageBox(win!, { title: 'FMEA Studio', message: `FMEA Studio ${app.getVersion()}`, detail: 'DFMEA / PFMEA / KC / Kontrol Planı / İzlenebilirlik uygulaması.' }) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

const FILTERS = [{ name: 'FMEA Projesi', extensions: ['fmea'] }, { name: 'JSON', extensions: ['json'] }];

function registerIpc() {
  ipcMain.handle('project:open', async (_e, file?: string) => {
    let target = file;
    if (!target) {
      const r = await dialog.showOpenDialog(win!, { filters: FILTERS, properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return null;
      target = r.filePaths[0];
    }
    const text = await fs.readFile(target, 'utf8');
    addRecent(target);
    return { path: target, data: JSON.parse(text) as Project };
  });
  ipcMain.handle('project:save', async (_e, args: { path?: string; data: Project; saveAs?: boolean }) => {
    let target = args.path;
    if (!target || args.saveAs) {
      const base = args.data.meta.partNumber || args.data.meta.name || 'FMEA';
      const r = await dialog.showSaveDialog(win!, { defaultPath: `${base}_${args.data.meta.fmeaRevision || 'RevA'}.fmea`.replace(/\s+/g, '_'), filters: FILTERS });
      if (r.canceled || !r.filePath) return null;
      target = r.filePath;
    }
    await fs.writeFile(target, JSON.stringify(args.data, null, 2), 'utf8');
    addRecent(target);
    await fs.rm(RECOVERY(), { force: true });
    return target;
  });
  ipcMain.handle('project:recent', () => (readConfig().recent ?? []).filter((f) => fssync.existsSync(f)));
  ipcMain.handle('project:recovery', async () => {
    try {
      return JSON.parse(await fs.readFile(RECOVERY(), 'utf8')) as { path?: string; data: Project; at: string };
    } catch {
      return null;
    }
  });
  ipcMain.handle('project:autosave', async (_e, payload: { path?: string; data: Project }) => {
    await fs.mkdir(path.dirname(RECOVERY()), { recursive: true });
    await fs.writeFile(RECOVERY(), JSON.stringify({ ...payload, at: new Date().toISOString() }), 'utf8');
  });
  ipcMain.handle('project:discardRecovery', () => fs.rm(RECOVERY(), { force: true }));
  ipcMain.on('project:dirty', (_e, v: boolean) => {
    dirty = v;
    win?.setTitle(`FMEA Studio${v ? ' •' : ''}`);
  });
  ipcMain.on('app:quit', () => {
    forceClose = true;
    win?.close();
  });

  ipcMain.handle('excel:export', async (_e, data: Project) => {
    const base = `${data.meta.partNumber || data.meta.name || 'FMEA'}_${data.meta.fmeaRevision || 'RevA'}`.replace(/\s+/g, '_');
    const r = await dialog.showSaveDialog(win!, { defaultPath: `${base}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, await buildWorkbook(data));
    return r.filePath;
  });
  ipcMain.handle('file:pick', async (_e, opts?: { filters?: Electron.FileFilter[] }) => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: opts?.filters });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], name: path.basename(r.filePaths[0]) };
  });
  ipcMain.handle('file:open', (_e, p: string) => shell.openPath(p));
  ipcMain.handle('file:reveal', (_e, p: string) => shell.showItemInFolder(p));

  ipcMain.handle('ai:status', () => ({ configured: !!apiKey() || !!process.env.ANTHROPIC_API_KEY, fromEnv: !apiKey() && !!process.env.ANTHROPIC_API_KEY }));
  ipcMain.handle('ai:setKey', (_e, key: string) => {
    const c = readConfig();
    if (!key) delete c.apiKeyEnc;
    else c.apiKeyEnc = (safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(key) : Buffer.from(key, 'utf8')).toString('base64');
    writeConfig(c);
    return true;
  });
  const wrap = <A,>(fn: (cfg: ai.AiConfig, a: A) => Promise<unknown>) => async (_e: unknown, a: A) => {
    try {
      return { ok: true, data: await fn({ apiKey: apiKey() }, a) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  ipcMain.handle('ai:requirements', wrap(ai.extractRequirements));
  ipcMain.handle('ai:dfmea', wrap(ai.suggestDfmea));
  ipcMain.handle('ai:pfmea', wrap(ai.suggestPfmea));
  ipcMain.handle('ai:review', wrap(ai.engineeringReview));
}

app.whenReady().then(() => {
  registerIpc();
  buildMenu();
  createWindow();
  const fileArg = process.argv.find((a) => a.endsWith('.fmea'));
  if (fileArg) win!.webContents.once('did-finish-load', () => send('open-file', path.resolve(fileArg)));
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
