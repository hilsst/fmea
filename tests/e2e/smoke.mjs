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
await shot('02-dashboard');

// 2.0: sol menü + alt sekmeler
const screen = (label) => win.click(`.sidebar .sb-item:has(.lbl:text-is("${label}"))`);
const sub = (label) => win.click(`.subtabs .chip-btn:has-text("${label}")`);
const tab = async (label) => {
  const map = { 'Yapı & Fonksiyon': ['DFMEA', 'Yapı & Fonksiyon'], DFMEA: ['DFMEA', 'DFMEA'], 'Proses Akışı': ['PFMEA', 'Proses Akışı'], PFMEA: ['PFMEA', 'PFMEA'], 'Kritik Karakteristikler': ['Özel Karakteristikler'], Puanlama: ['Risk'], Revizyon: ['Revizyon / Baseline', 'Revizyon Geçmişi'] };
  const [s, t] = map[label] ?? [label];
  await screen(s);
  if (t) await sub(t);
};
await tab('Proje');
await win.waitForSelector('.tiles');
await shot('02b-project');
await tab('DFMEA');
await win.waitForSelector('[data-row="DF-001"]');
await shot('03-dfmea');

// DF-001 severity 7 -> 9: PFMEA ve KC'yi etkiler, onay penceresi çıkmalı
const sev = win.locator('[data-row="DF-001"] select.score').first();
await sev.selectOption('9');
await win.waitForSelector('.modal.confirm');
// S değişikliği için neden zorunlu (§37)
const reasonRequired = await win.locator('.modal.confirm .btn.primary').isDisabled();
await win.fill('.modal.confirm .reason input', 'Tasarım incelemesi kararı');
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
if (await win.locator('.modal.confirm .reason input').count()) await win.fill('.modal.confirm .reason input', 'KC değerlendirmesi');
await shot('07-kc-approve-dialog');
await win.click('.modal.confirm .btn.primary');

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

for (const [l, n] of [['Yapı & Fonksiyon', '10-structure'], ['Proses Akışı', '11-process'], ['İzlenebilirlik', '12-trace'], ['Kalite Kontrol', '13-quality'], ['Puanlama', '14-risk'], ['Aksiyonlar', '15-actions'], ['Revizyon', '16-history'],
  ['Dokümanlar', '17-documents'], ['Gereksinimler', '18-requirements'], ['Kontrol Planı', '19-cp'], ['MSA', '20-msa'], ['Capability', '21-capability'], ['Dersler', '22-lessons'], ['Değişiklik Etkisi', '23-impact'], ['AI İnceleme', '24-ai-review'], ['Onay', '25-approval'], ['Ayarlar', '26-settings'], ['Gösterge Paneli', '27-dashboard']]) {
  await tab(l);
  await win.waitForTimeout(250);
  await shot(n);
}
// Alt sekmeler
for (const [s0, t, n] of [['Onay', 'Denetim İzi', '28-audit'], ['Revizyon / Baseline', 'Baselines', '29-baselines'], ['Dokümanlar', 'Kanıtlar', '30-evidence'], ['Dersler', 'Bilgi Tabanı', '31-kb'], ['AI İnceleme', 'AI Çalıştırmaları', '32-airuns'], ['PFMEA', 'Proses Parametreleri', '33-params'], ['Özel Karakteristikler', 'Adaylar & Karar Akışı', '36-kc-flow'], ['Özel Karakteristikler', 'İzlenebilirlik & 7.2.16', '37-kc-trace']]) {
  await screen(s0);
  await sub(t);
  await win.waitForTimeout(250);
  await shot(n);
}
// v4-apqp: APQP ve PPAP ekranları
await screen('APQP');
await win.locator('.card select').first().selectOption('ND');
await win.waitForTimeout(250);
await shot('34-apqp');
for (const t of ['Fazlar & Kilometre Taşları', 'Teslimat Onayları', 'Ekip & Kriterler', 'P-Diyagramı / DRA', 'KP Fazları & Başlık', 'Ambalaj 7.2.20', 'Aile & Tetikleyiciler', 'Olgunluk 7.2.14']) {
  await sub(t);
  await win.waitForTimeout(150);
}
await shot('35-apqp-maturity');
await screen('PPAP');
for (const t of ['PRR Kapısı', 'Sunum & Karar', 'PPAP Elemanları']) {
  await sub(t);
  await win.waitForTimeout(150);
}
await shot('36-ppap');
const auditRows = await (async () => { await screen('Onay'); await sub('Denetim İzi'); return win.locator('.effects.audit tbody tr').count(); })();

// Neden burada? çekmecesi
await tab('DFMEA');
await win.locator('[data-row="DF-001"] td.sticky-col.sel input').check();
await win.click('.grid-toolbar >> text=Neden burada?');
await win.waitForSelector('.drawer');
await shot('34-why');
await win.click('.drawer .x');

// Baseline oluştur + mühür
await screen('Ayarlar');
await win.locator('.form label:has-text("Ad Soyad") input').fill('Test Mühendisi');
await win.locator('.form label:has-text("Ad Soyad") input').blur();
await screen('Revizyon / Baseline');
await sub('Baselines');
await win.click('text=Baseline oluştur');
await win.fill('.modal textarea', 'E2E baseline');
await win.click('text=Oluştur ve mühürle');
await win.waitForSelector('.badge.b-green:has-text("✓")');
const baselineOk = await win.locator('.badge.b-green:has-text("✓")').count();
await shot('35-baseline');



// Excel çıktısı (ana süreçte)
const xlsx = path.join(out, 'export.xlsx');
await app.evaluate(async ({ dialog }, file) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
}, xlsx);
await win.click('.topbar >> text=Excel’e aktar');
await win.waitForTimeout(2500);

console.log(JSON.stringify({ reasonRequired, effects, pfS, cpRows, accAfter, auditRows, baselineOk, xlsx: fs.existsSync(xlsx) ? fs.statSync(xlsx).size : 0, errors }, null, 2));
await app.evaluate(({ app }) => app.exit(0));
