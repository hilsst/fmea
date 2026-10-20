import { app, BrowserWindow, dialog, ipcMain, Menu, net, safeStorage, session, shell } from 'electron';
import ExcelJS from 'exceljs';
import fs from 'node:fs/promises';
import fssync from 'node:fs';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import type { ExtractedDoc } from '../shared/docmodel';
import { buildWorkbook } from '../shared/excel';
import { buildWorkbookV2 } from '../shared/excel2';
import { buildScmhPackage, scmhFileName, SCMH_TEMPLATE_FILES, type ScmhKind } from '../shared/scmh';
import type { SheetGrid } from '../shared/importmap';
import type { Project } from '../shared/types';
import * as ai from './ai';
import { PROVIDERS } from './ai/provider';
import { DEFAULT_IFS, ifsConnector, type IfsSettings } from './connectors/ifs';

let win: BrowserWindow | null = null;
let dirty = false;
let forceClose = false;

const userFile = (name: string) => path.join(app.getPath('userData'), name);
const RECOVERY = () => userFile('recovery.fmea.json');
const CONFIG = () => userFile('config.json');

interface Config {
  /** safeStorage (işletim sistemi anahtar zinciri) ile şifrelenmiş anahtar. Düz metin/Base64 saklanmaz. */
  apiKeyEnc?: string;
  aiProvider?: string;
  recent?: string[];
  ifs?: IfsSettings;
  /** IAQG SCMH şablon klasörü (şablonlar © IAQG; uygulamayla dağıtılmaz, kullanıcı sağlar). */
  scmhDir?: string;
}

/** safeStorage yoksa anahtar yalnızca bu oturumun belleğinde tutulur (diske yazılmaz). */
let sessionKey = '';

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
  if (sessionKey) return sessionKey;
  const c = readConfig();
  if (!c.apiKeyEnc || !safeStorage.isEncryptionAvailable()) return '';
  try {
    return safeStorage.decryptString(Buffer.from(c.apiKeyEnc, 'base64'));
  } catch {
    return '';
  }
}

function aiEnv(): ai.AiEnv {
  return { apiKey: apiKey(), provider: readConfig().aiProvider ?? 'anthropic', cacheDir: userFile('ai-cache'), online: () => net.isOnline() };
}

// ---------------------------------------------------------------- doküman ayrıştırma (worker)
let worker: Worker | null = null;
let seq = 0;
const pending = new Map<number, { resolve: (d: ExtractedDoc) => void; reject: (e: Error) => void }>();
function extract(file: string): Promise<ExtractedDoc> {
  if (!worker) {
    worker = new Worker(path.join(__dirname, 'docworker.js'));
    worker.on('message', (m: { id: number; doc?: ExtractedDoc; error?: string }) => {
      const p = pending.get(m.id);
      pending.delete(m.id);
      if (m.doc) p?.resolve(m.doc);
      else p?.reject(new Error(m.error ?? 'Ayrıştırma hatası'));
    });
    worker.on('error', (e) => {
      for (const p of pending.values()) p.reject(e);
      pending.clear();
      worker = null;
    });
  }
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    worker!.postMessage({ id, path: file });
  });
}

const isSafeExternal = (url: string) => /^https:\/\//i.test(url);
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
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  });
  // Uygulama dışına gezinme engellenir; yalnızca https bağlantıları varsayılan tarayıcıda açılır (§62).
  win.webContents.on('will-navigate', (e, url) => {
    const dev = process.env.VITE_DEV_SERVER_URL;
    if (dev && url.startsWith(dev)) return;
    e.preventDefault();
    if (isSafeExternal(url)) shell.openExternal(url);
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
    if (isSafeExternal(url)) shell.openExternal(url);
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
        { label: 'Excel’e Aktar (2.0, 14 sayfa)…', accelerator: 'CmdOrCtrl+E', click: m('export2') },
        { label: 'SCMH Paketi (PFD, DFMEA, PFMEA, Kontrol Planı)…', accelerator: 'CmdOrCtrl+Shift+E', click: m('scmh') },
        { label: 'Excel’e Aktar (1.0 biçimi)…', click: m('export') },
        { label: 'Excel FMEA İçe Aktar…', click: m('import') },
        { label: 'İnceleme Raporu (PDF / HTML)…', click: m('report') },
        { type: 'separator' },
        { label: 'Şirket Şablonu Olarak Kaydet…', click: m('saveTemplate') },
        { label: 'Şirket Şablonu Uygula…', click: m('applyTemplate') },
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
        ...(app.isPackaged ? [] : [{ role: 'toggleDevTools' as const, label: 'Geliştirici Araçları' }]),
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
        { label: 'Hakkında', click: () => dialog.showMessageBox(win!, { title: 'FMEA Studio', message: `FMEA Studio ${app.getVersion()}`, detail: 'DFMEA / PFMEA / Özel Karakteristik / Kontrol Planı / MSA / Capability / İzlenebilirlik uygulaması. AI önerileri mühendis onayı olmadan geçerli değildir.' }) },
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

  ipcMain.handle('ai:status', () => ({
    configured: !!apiKey() || !!process.env.ANTHROPIC_API_KEY,
    fromEnv: !apiKey() && !!process.env.ANTHROPIC_API_KEY,
    secureStorage: safeStorage.isEncryptionAvailable(),
    sessionOnly: !!sessionKey,
    provider: readConfig().aiProvider ?? 'anthropic',
    providers: PROVIDERS,
    online: net.isOnline(),
  }));
  ipcMain.handle('ai:setKey', (_e, key: string) => {
    const c = readConfig();
    sessionKey = '';
    delete c.apiKeyEnc;
    if (key) {
      if (safeStorage.isEncryptionAvailable()) c.apiKeyEnc = safeStorage.encryptString(key).toString('base64');
      else sessionKey = key; // şifreleme yoksa diske yazılmaz
    }
    writeConfig(c);
    return { stored: key ? (sessionKey ? 'session' : 'secure') : 'cleared' };
  });
  ipcMain.handle('ai:setProvider', (_e, id: string) => {
    const c = readConfig();
    c.aiProvider = PROVIDERS.some((p) => p.id === id) ? id : 'anthropic';
    writeConfig(c);
    return c.aiProvider;
  });
  ipcMain.handle('ai:requirements', (_e, a: Parameters<typeof ai.extractRequirements>[1]) => ai.extractRequirements(aiEnv(), a));
  ipcMain.handle('ai:dfmea', (_e, a: Parameters<typeof ai.suggestDfmea>[1]) => ai.suggestDfmea(aiEnv(), a));
  ipcMain.handle('ai:pfmea', (_e, a: Parameters<typeof ai.suggestPfmea>[1]) => ai.suggestPfmea(aiEnv(), a));
  ipcMain.handle('ai:review', (_e, a: Parameters<typeof ai.review>[1]) => ai.review(aiEnv(), a));
  ipcMain.handle('ai:clearCache', () => fs.rm(userFile('ai-cache'), { recursive: true, force: true }));

  ipcMain.handle('doc:extract', async (_e, file: string) => {
    try {
      return { ok: true, doc: await extract(file) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('excel:exportV2', async (_e, data: Project) => {
    const base = `${data.meta.partNumber || data.meta.name || 'FMEA'}_${data.meta.fmeaRevision || 'RevA'}_v2`.replace(/\s+/g, '_');
    const r = await dialog.showSaveDialog(win!, { defaultPath: `${base}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, await buildWorkbookV2(data));
    return r.filePath;
  });
  // SCMH paketi: PFD 7.2.9, DFMEA 7.2.10, PFMEA 7.2.11, Kontrol Planı 7.2.13 – resmi şablonlara doldurulur
  const KINDS: ScmhKind[] = ['pfd', 'dfmea', 'pfmea', 'cp'];
  const missingTemplates = (dir: string) => KINDS.filter((k) => !fssync.existsSync(path.join(dir, SCMH_TEMPLATE_FILES[k]))).map((k) => SCMH_TEMPLATE_FILES[k]);
  ipcMain.handle('scmh:getDir', () => {
    const dir = readConfig().scmhDir ?? '';
    return { dir, missing: dir ? missingTemplates(dir) : KINDS.map((k) => SCMH_TEMPLATE_FILES[k]) };
  });
  const pickScmhDir = async () => {
    const r = await dialog.showOpenDialog(win!, { title: 'IAQG SCMH şablon klasörünü seçin', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const c = readConfig();
    c.scmhDir = r.filePaths[0];
    writeConfig(c);
    return { dir: c.scmhDir, missing: missingTemplates(c.scmhDir) };
  };
  ipcMain.handle('scmh:pickDir', pickScmhDir);
  ipcMain.handle('scmh:export', async (_e, data: Project) => {
    let dir = readConfig().scmhDir ?? '';
    if (!dir || missingTemplates(dir).length) {
      const picked = await pickScmhDir();
      if (!picked) return { ok: false, error: 'SCMH şablon klasörü seçilmedi.' };
      dir = picked.dir;
    }
    const missing = missingTemplates(dir);
    if (missing.length) return { ok: false, error: `Şablon bulunamadı: ${missing.join(', ')}. Dosyaları scmh.iaqg.org’dan indirip bu klasöre koyun.` };
    const out = await dialog.showOpenDialog(win!, { title: 'SCMH dosyalarının kaydedileceği klasör', properties: ['openDirectory', 'createDirectory'] });
    if (out.canceled || !out.filePaths[0]) return { ok: false, error: '' };
    try {
      const t = Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, new Uint8Array(await fs.readFile(path.join(dir, SCMH_TEMPLATE_FILES[k])))]))) as Record<ScmhKind, Uint8Array>;
      const pkg = await buildScmhPackage(data, t);
      const files: string[] = [];
      for (const k of KINDS) {
        const f = path.join(out.filePaths[0], scmhFileName(k, data));
        await fs.writeFile(f, pkg[k]);
        files.push(f);
      }
      return { ok: true, files, dir: out.filePaths[0] };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
  ipcMain.handle('excel:readGrid', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xlsm', 'csv'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    const file = r.filePaths[0];
    const wb = new ExcelJS.Workbook();
    if (file.toLowerCase().endsWith('.csv')) await wb.csv.readFile(file);
    else await wb.xlsx.readFile(file);
    const sheets: SheetGrid[] = [];
    wb.eachSheet((ws) => {
      const rows: SheetGrid['rows'] = [];
      ws.eachRow({ includeEmpty: true }, (row, n) => {
        const vals: (string | number | null)[] = [];
        row.eachCell({ includeEmpty: true }, (c, col) => {
          const v = c.value as unknown;
          vals[col - 1] = v == null ? null : typeof v === 'number' ? v : typeof v === 'object' ? String((v as { result?: unknown; text?: unknown }).result ?? (v as { text?: unknown }).text ?? c.text) : String(v);
        });
        rows[n - 1] = vals;
      });
      sheets.push({ name: ws.name, rows: Array.from(rows, (x) => x ?? []) });
    });
    return { name: path.basename(file), sheets };
  });
  ipcMain.handle('report:export', async (_e, a: { html: string; format: 'pdf' | 'html'; name: string }) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: `${a.name}.${a.format}`, filters: [{ name: a.format.toUpperCase(), extensions: [a.format] }] });
    if (r.canceled || !r.filePath) return null;
    if (a.format === 'html') {
      await fs.writeFile(r.filePath, a.html, 'utf8');
      return r.filePath;
    }
    const pw = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false, contextIsolation: true } });
    try {
      await pw.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(a.html)}`);
      const pdf = await pw.webContents.printToPDF({ pageSize: 'A4', printBackground: true, margins: { marginType: 'default' } });
      await fs.writeFile(r.filePath, pdf);
    } finally {
      pw.destroy();
    }
    return r.filePath;
  });
  ipcMain.handle('template:save', async (_e, t: { name: string }) => {
    const r = await dialog.showSaveDialog(win!, { defaultPath: `${t.name || 'Sirket_Sablonu'}.fmeatpl`.replace(/\s+/g, '_'), filters: [{ name: 'FMEA Studio Şablonu', extensions: ['fmeatpl'] }] });
    if (r.canceled || !r.filePath) return null;
    await fs.writeFile(r.filePath, JSON.stringify(t, null, 2), 'utf8');
    return r.filePath;
  });
  ipcMain.handle('template:open', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: [{ name: 'FMEA Studio Şablonu', extensions: ['fmeatpl', 'json'] }] });
    if (r.canceled || !r.filePaths[0]) return null;
    return JSON.parse(await fs.readFile(r.filePaths[0], 'utf8'));
  });
  ipcMain.handle('reference:open', async () => {
    const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters: FILTERS });
    if (r.canceled || !r.filePaths[0]) return null;
    return { name: path.basename(r.filePaths[0]), data: JSON.parse(await fs.readFile(r.filePaths[0], 'utf8')) as Project };
  });
  ipcMain.handle('external:open', (_e, url: string) => (isSafeExternal(url) ? shell.openExternal(url) : Promise.resolve()));

  // Opsiyonel IFS connector – kapalıysa hiçbir çekirdek işlev etkilenmez
  const ifsSettings = () => ({ ...DEFAULT_IFS, ...(readConfig().ifs ?? {}) });
  ipcMain.handle('ifs:get', () => ifsSettings());
  ipcMain.handle('ifs:set', (_e, s: Partial<IfsSettings>) => {
    const c = readConfig();
    c.ifs = { ...ifsSettings(), ...s };
    writeConfig(c);
    return c.ifs;
  });
  const ifsCall = (fn: (c: NonNullable<ReturnType<typeof ifsConnector>>, arg: string) => Promise<unknown>) => async (_e: unknown, arg: string) => {
    const conn = ifsConnector(ifsSettings());
    if (!conn) return { ok: false, error: 'IFS bağlantısı kapalı (Ayarlar → IFS).' };
    try {
      return { ok: true, data: await fn(conn, arg) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  ipcMain.handle('ifs:test', ifsCall((c) => c.test()));
  ipcMain.handle('ifs:parts', ifsCall((c, q) => c.parts(q)));
  ipcMain.handle('ifs:ncrs', ifsCall((c, q) => c.ncrs(q)));
  ipcMain.handle('ifs:routing', ifsCall((c, q) => c.routing(q)));
}

app.whenReady().then(() => {
  // Arayüzden kamera/mikrofon/konum vb. izin istekleri reddedilir
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
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
