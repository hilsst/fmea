// Electron uçtan uca duman testi: örnek proje, sekmeler, onay penceresi, Excel çıktısı.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const out = process.argv[2] || path.join(os.tmpdir(), 'fmea-shots');
fs.mkdirSync(out, { recursive: true });
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'fmea-ud-'));
const exe = process.env.FMEA_EXE;
const app = await electron.launch({ ...(exe ? { executablePath: exe } : {}), args: [...(exe ? [] : ['.']), `--user-data-dir=${userData}`, '--no-sandbox'], env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: '1' } });
const win = await app.firstWindow();
const errors = [];
win.on('pageerror', (e) => errors.push(String(e)));
win.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await win.setViewportSize({ width: 1500, height: 900 });
const shot = (n) => win.screenshot({ path: path.join(out, `${n}.png`) });

await win.waitForSelector('.welcome');
await shot('01-welcome');
await win.click('text=Örnek proje');
await win.waitForSelector('.tiles');
await shot('02-project');

const tab = (label) => win.click(`.tabs .tab:has-text("${label}")`);
await tab('DFMEA');
await win.waitForSelector('[data-row="DF-001"]');
await shot('03-dfmea');

// DF-001 severity 7 -> 9: PFMEA ve KC'yi etkiler, onay penceresi çıkmalı
const sev = win.locator('[data-row="DF-001"] select.score').first();
await sev.selectOption('9');
await win.waitForSelector('.modal.confirm');
await shot('04-confirm-dialog');
const effects = await win.locator('.modal.confirm .effects tr').count();
await win.click('text=Onayla ve tümünü güncelle');
await win.waitForSelector('.modal.confirm', { state: 'detached' });

await tab('PFMEA');
await win.waitForSelector('[data-row="PF-001"]');
const pfS = await win.locator('[data-row="PF-001"] select.score').first().inputValue();
await shot('05-pfmea');

await tab('Kritik Karakteristikler');
await win.waitForSelector('[data-row="KC-001"]');
await shot('06-kc');
// KC-001 onayla -> kontrol planı
await win.locator('[data-row="KC-001"] td.sticky-col.sel input').check();
await win.click('.grid-toolbar >> text=✓ Onayla');
await win.waitForSelector('.modal.confirm');
await shot('07-kc-approve-dialog');
await win.click('text=Onayla ve tümünü güncelle');

await tab('Kontrol Planı');
await win.waitForSelector('.grid tbody tr');
const cpRows = await win.locator('.grid tbody tr').count();
await shot('08-control-plan');

// Vazgeç yolu: gereksinim kabul kriteri değişikliği iptal edilir
await tab('Gereksinimler');
const acc = win.locator('[data-row="REQ-002"] textarea').nth(1);
await acc.fill('Ø6.00–6.05 mm');
await acc.blur();
await win.waitForSelector('.modal.confirm');
await shot('09-req-dialog');
await win.click('.modal.confirm >> text=Vazgeç');
const accAfter = await acc.inputValue();

for (const [l, n] of [['Yapı & Fonksiyon', '10-structure'], ['Proses Akışı', '11-process'], ['İzlenebilirlik', '12-trace'], ['Kalite Kontrol', '13-quality'], ['Puanlama', '14-scoring'], ['Aksiyonlar', '15-actions'], ['Revizyon', '16-history']]) {
  await tab(l);
  await win.waitForTimeout(250);
  await shot(n);
}

// Excel çıktısı (ana süreçte)
const xlsx = path.join(out, 'export.xlsx');
await app.evaluate(async ({ dialog }, file) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
}, xlsx);
await win.click('.topbar >> text=Excel’e aktar');
await win.waitForTimeout(2500);

console.log(JSON.stringify({ effects, pfS, cpRows, accAfter, xlsx: fs.existsSync(xlsx) ? fs.statSync(xlsx).size : 0, errors }, null, 2));
await app.evaluate(({ app }) => app.exit(0));
