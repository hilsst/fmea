// FMEA Studio 2.0 Excel çıktısı (14 sayfa, exceljs). Ana süreçte (Node) çalışır.
// v1 çıktısı (excel.ts) değişmeden kalır; stil yaklaşımı aynıdır.
import ExcelJS from 'exceljs';
import { verifyBaseline } from './baseline';
import { traceability } from './checks';
import { cellText, tableColumns, type Col } from './columns';
import { TABLE_LABEL } from './model';
import { QUALITY_SCORE_NOTE, qualityReport } from './quality';
import { RPN_WARNING } from './scoring';
import type { AnyRow, Project, TableKey } from './types';
import { currentStep } from './workflow';

const NAVY = 'FF1F3864';
const FILL = (argb: string): ExcelJS.Fill => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const BORDER: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  left: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  bottom: { style: 'thin', color: { argb: 'FFBFBFBF' } },
  right: { style: 'thin', color: { argb: 'FFBFBFBF' } },
};
const RED = 'FFF8CBAD';
const AMBER = 'FFFFE699';
const GREEN = 'FFC6EFCE';
const PURPLE = 'FFE4DFEC';
const BLUE = 'FFDDEBF7';
const GREY = 'FFD9D9D9';

export const SHEETS_V2 = [
  'Project Summary', 'Requirements', 'DFMEA', 'PFMEA', 'Special Characteristics', 'Control Plan', 'MSA',
  'Capability', 'Actions', 'Lessons Learned', 'Traceability', 'AI Evidence', 'Change History', 'Approval',
] as const;

export function sheetNameV2(i: number): string {
  return `${String(i + 1).padStart(2, '0')}_${SHEETS_V2[i]}`.replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
}

/** Hücreye yazılacak düz metin: diziler ', ' ile, nesneler JSON olarak; ham nesne yazılmaz. */
export function plain(v: unknown): string | number {
  if (v == null) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? v : '';
  if (typeof v === 'boolean') return v ? 'Evet' : 'Hayır';
  if (Array.isArray(v)) return v.map((x) => String(plain(x))).join(', ');
  if (typeof v === 'object') {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

function title(ws: ExcelJS.Worksheet, p: Project, text: string, sub: string, width: number) {
  ws.mergeCells(1, 1, 1, Math.max(width, 4));
  const c = ws.getCell(1, 1);
  c.value = `${text} – ${p.meta.partNumber || p.meta.name || 'FMEA'} ${p.meta.fmeaRevision}`.trim();
  c.font = { bold: true, size: 14, color: { argb: NAVY } };
  ws.mergeCells(2, 1, 2, Math.max(width, 4));
  const s = ws.getCell(2, 1);
  s.value = sub;
  s.font = { italic: true, size: 9, color: { argb: 'FF595959' } };
  s.alignment = { wrapText: true, vertical: 'top' };
  ws.getRow(2).height = 30;
}

function header(ws: ExcelJS.Worksheet, row: number, labels: string[], widths?: number[]) {
  labels.forEach((l, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = l;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = FILL(NAVY);
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = BORDER;
    if (widths) {
      const col = ws.getColumn(i + 1);
      col.width = Math.max(col.width ?? 0, widths[i] ?? 14);
    }
  });
  ws.getRow(row).height = 32;
}

function section(ws: ExcelJS.Worksheet, row: number, text: string, width: number) {
  ws.mergeCells(row, 1, row, Math.max(width, 2));
  const c = ws.getCell(row, 1);
  c.value = text;
  c.font = { bold: true, size: 12, color: { argb: NAVY } };
  c.fill = FILL(GREY);
}

function colorFor(key: string, text: string, p: Project): string | null {
  if (!text) return null;
  const n = Number(text);
  if (key === 'ap' || key === 'newAp') return text === 'H' ? RED : text === 'M' ? AMBER : text === 'L' ? GREEN : null;
  if (key === 'risk') return text === 'CRITICAL' || text === 'HIGH' ? RED : text === 'MEDIUM' ? AMBER : GREEN;
  if ((key === 's' || key === 'severity') && Number.isFinite(n) && n >= p.settings.highSeverityThreshold) return RED;
  if (key === 'kcFlag' || key === 'kcClass' || key === 'kcId') return PURPLE;
  if ((key === 'actionStatus' || key === 'status') && (text === 'Open' || text === 'In Progress' || text === 'Under Review' || text === 'Waiting Customer')) return BLUE;
  if (key === 'reassess' || key === 'overdue' || key === 'hist') return AMBER;
  if (/VERİ YOK|DATA NOT AVAILABLE|MÜHÜR BOZUK|SOURCE NOT VERIFIED/.test(text)) return AMBER;
  if (key === 'approval' && text === 'AI Proposed') return AMBER;
  if (key === 'verification' && /^VERIFIED/.test(text)) return GREEN;
  return null;
}

/** Genel tablo yazıcı: başlık satırı + veri satırları. Bir sonraki boş satırı döndürür. */
function grid(ws: ExcelJS.Worksheet, p: Project, row: number, labels: string[], keys: string[], widths: number[], data: (string | number)[][]): number {
  header(ws, row, labels, widths);
  data.forEach((vals, ri) => {
    vals.forEach((v, ci) => {
      const cell = ws.getCell(row + 1 + ri, ci + 1);
      cell.value = v;
      cell.border = BORDER;
      cell.font = ci === 0 ? { bold: true, size: 9 } : { size: 9 };
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: typeof v === 'number' || keys[ci] === 'ap' ? 'center' : 'left' };
      const color = colorFor(keys[ci] ?? '', String(v), p);
      if (color) cell.fill = FILL(color);
    });
  });
  return row + 1 + data.length;
}

const NUMERIC: Col['type'][] = ['score', 'number'];

function colRows(p: Project, table: TableKey, rows: AnyRow[] = p[table] as AnyRow[]) {
  const cols = tableColumns(table, p.settings.tableFormat);
  const labels = ['ID', ...cols.map((c) => c.label)];
  const keys = ['id', ...cols.map((c) => c.key)];
  const widths = [11, ...cols.map((c) => Math.min(60, Math.max(6, Math.round(c.width / 7))))];
  const data = rows.map((r) => [
    r.id,
    ...cols.map((c) => {
      const text = cellText(c, r, p);
      const num = Number(text);
      return text !== '' && (NUMERIC.includes(c.type) || c.key === 'rpn' || c.key === 'severity') && Number.isFinite(num) ? num : text;
    }),
  ]);
  return { labels, keys, widths, data };
}

function finish(ws: ExcelJS.Worksheet, headerRow: number, lastRow: number, cols: number, ySplit = headerRow, xSplit = 1) {
  ws.views = [{ state: 'frozen', xSplit, ySplit }];
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: Math.max(lastRow, headerRow + 1), column: Math.max(cols, 1) } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: `${headerRow}:${headerRow}` };
}

function tableSheet(wb: ExcelJS.Workbook, p: Project, i: number, table: TableKey, hint: string): ExcelJS.Worksheet {
  const ws = wb.addWorksheet(sheetNameV2(i));
  const t = colRows(p, table);
  title(ws, p, TABLE_LABEL[table], hint, t.labels.length);
  const next = grid(ws, p, 3, t.labels, t.keys, t.widths, t.data);
  finish(ws, 3, next - 1, t.labels.length);
  return ws;
}

function aiModeText(m: string) {
  return m === 'knowledge' ? 'Engineering Knowledge Mode' : 'Strict Engineering Mode';
}

function summarySheet(wb: ExcelJS.Workbook, p: Project) {
  const ws = wb.addWorksheet(sheetNameV2(0));
  title(ws, p, 'FMEA Proje Özeti', 'AI önerileri müşteri gereksinimi veya onaylı mühendislik kriteri değildir; mühendis onayı gerekir.', 5);
  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 70;
  ws.getColumn(3).width = 16;
  ws.getColumn(4).width = 50;
  ws.getColumn(5).width = 20;
  let r = 3;
  const kv = (k: string, v: unknown, missing = false) => {
    const a = ws.getCell(r, 1);
    a.value = k;
    a.font = { bold: true };
    a.border = BORDER;
    const b = ws.getCell(r, 2);
    const val = plain(v);
    b.value = val === '' && missing ? 'VERİ YOK – doğrulanmalı' : val;
    b.border = BORDER;
    b.alignment = { wrapText: true, vertical: 'top' };
    if (val === '' && missing) b.fill = FILL(AMBER);
    r++;
  };
  header(ws, r++, ['Alan', 'Değer']);
  const m = p.meta;
  const metaRows: [string, string][] = [
    ['Proje adı', m.name], ['Parça numarası', m.partNumber], ['Parça adı', m.partName], ['Müşteri', m.customer], ['Program', m.program],
    ['Resim revizyonu', m.drawingRevision], ['FMEA numarası', m.fmeaNumber], ['FMEA revizyonu', m.fmeaRevision], ['Hazırlayan', m.preparedBy],
    ['Ekip', m.team], ['Başlangıç tarihi', m.startDate], ['Revizyon tarihi', m.revisionDate], ['Kapsam', m.scope], ['Tedarikçi / Tesis', m.supplier],
    ['Lokasyon', m.location], ['Gizlilik', m.confidentiality],
  ];
  for (const [k, v] of metaRows) kv(k, v, true);
  kv('Ürün tipi', p.settings.productType, true);
  kv('AI modu', aiModeText(p.settings.aiMode));
  kv('Neden görünümü', p.settings.causeView);
  kv('KC Severity eşiği', p.settings.kcSeverityThreshold);
  kv('High Severity eşiği', p.settings.highSeverityThreshold);
  kv('RPN aksiyon eşiği', p.settings.rpnThreshold ?? 'Kullanılmıyor');
  kv('RPN uyarısı', RPN_WARNING);
  kv('AP tablosu', p.scoring.apName || (p.scoring.apTable ? 'Şirket AP tablosu' : 'AIAG-VDA 2019'));
  kv('Hedef Cpk', p.settings.targetCpk ?? 'VERİ YOK – doğrulanmalı');
  kv('Capability min. n', p.settings.minSamples ?? 'VERİ YOK – doğrulanmalı');
  kv('Güncel iş akışı adımı', currentStep(p) ?? 'Tüm adımlar onaylandı');
  r++;

  const q = qualityReport(p);
  section(ws, r++, q.label, 4);
  ws.getCell(r, 1).value = QUALITY_SCORE_NOTE;
  ws.getCell(r, 1).font = { italic: true, size: 9 };
  ws.mergeCells(r, 1, r, 4);
  r++;
  r = grid(ws, p, r, ['Boyut', 'Detay', 'Skor', 'Uygulanabilir'], ['', '', 'score', ''], [30, 70, 16, 14],
    q.dimensions.map((d) => [d.label, d.detail, d.score, d.applicable ? 'Evet' : 'Veri yok']));
  r++;

  section(ws, r++, 'Kayıt sayıları', 4);
  const counted: TableKey[] = ['documents', 'requirements', 'structure', 'dfmea', 'processSteps', 'pfmea', 'processParams', 'kcs', 'controlPlan', 'msa', 'capability', 'actions', 'issues', 'lessons', 'evidence', 'changeRequests', 'aiRuns'];
  const open = p.actions.filter((a) => a.status !== 'Completed' && a.status !== 'Cancelled').length;
  r = grid(ws, p, r, ['Tablo', 'Açıklama', 'Adet'], ['', '', ''], [30, 70, 16], [
    ...counted.map((t) => [TABLE_LABEL[t], t, (p[t] as AnyRow[]).length]),
    ['Açık aksiyon', 'actions (Open / In Progress)', open],
  ]);
  r++;

  section(ws, r++, 'Baseline’lar', 5);
  r = grid(ws, p, r, ['Baseline', 'Revizyon / Tarih', 'Yazar', 'Onaylayan', 'Mühür'], ['', '', '', '', 'seal'], [30, 70, 16, 50, 20],
    p.baselines.map((b) => [b.id, `${b.revision} / ${b.date}`, b.author, b.approver, verifyBaseline(b) ? 'Mühür geçerli' : 'MÜHÜR BOZUK']));
  if (!p.baselines.length) ws.getCell(r++, 1).value = 'Baseline yok';
  ws.views = [{ state: 'frozen', xSplit: 0, ySplit: 3 }];
  ws.pageSetup = { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function pfmeaSheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = tableSheet(wb, p, i, 'pfmea', 'Proses adımı → hata modu → etki → neden → önleme → tespit. Altta özel proses parametreleri.');
  let r = ws.rowCount + 2;
  const t = colRows(p, 'processParams');
  section(ws, r++, 'Proses Parametreleri (Special Process Engine)', Math.min(t.labels.length, 8));
  r = grid(ws, p, r, t.labels, t.keys, t.widths, t.data);
  if (!p.processParams.length) ws.getCell(r, 1).value = 'Proses parametresi tanımlı değil';
}

function traceSheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = wb.addWorksheet(sheetNameV2(i));
  title(ws, p, 'İzlenebilirlik', 'ID bazında bağlantılar (Kimden → Kime). Boşluklar her matrisin altında listelenir.', 3);
  header(ws, 3, ['Matris', 'Kimden', 'Kime'], [36, 22, 50]);
  let r = 4;
  const put = (vals: string[], fill?: string, bold = false) => {
    vals.forEach((v, c) => {
      const cell = ws.getCell(r, c + 1);
      cell.value = v;
      cell.border = BORDER;
      cell.font = { size: 9, bold, color: bold ? { argb: 'FFC00000' } : undefined };
      cell.alignment = { wrapText: true, vertical: 'top' };
      if (fill) cell.fill = FILL(fill);
    });
    r++;
  };
  for (const m of traceability(p)) {
    for (const l of m.links) put([m.title, l.from, l.to]);
    if (!m.links.length) put([m.title, '—', 'Bağlantı yok']);
    for (const o of m.orphans) put([m.title, o, m.orphanLabel], AMBER);
  }
  finish(ws, 3, r - 1, 3, 3, 0);
}

function evidenceSheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = tableSheet(wb, p, i, 'evidence', 'Her kanıt doküman konumuna ve birebir alıntıya bağlıdır. Altta AI çalıştırma özeti.');
  let r = ws.rowCount + 2;
  const t = colRows(p, 'aiRuns');
  section(ws, r++, 'AI Çalıştırmaları (özet)', 8);
  const sum = (k: 'items' | 'accepted' | 'rejected' | 'tokensIn' | 'tokensOut') => p.aiRuns.reduce((a, x) => a + (Number(x[k]) || 0), 0);
  ws.getCell(r++, 1).value = `${p.aiRuns.length} çalıştırma · ${p.aiRuns.filter((x) => x.status === 'error').length} hata · öneri ${sum('items')} / kabul ${sum('accepted')} / red ${sum('rejected')} · token ${sum('tokensIn')} + ${sum('tokensOut')}`;
  grid(ws, p, r, t.labels, t.keys, t.widths, t.data);
}

function historySheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = tableSheet(wb, p, i, 'history', 'Revizyon geçmişi; altta denetim izi (audit trail).');
  let r = ws.rowCount + 2;
  section(ws, r++, 'Denetim İzi (Audit Trail)', 11);
  grid(ws, p, r, ['Zaman', 'Kullanıcı', 'Tür', 'Tablo', 'ID', 'Alan', 'Eski', 'Yeni', 'Neden', 'Yorum', 'Revizyon'], [], [20, 14, 12, 14, 11, 14, 30, 30, 30, 30, 10],
    p.auditLog.map((a) => [a.at, a.user, a.kind, a.table, a.id, plain(a.field), plain(a.from), plain(a.to), plain(a.reason), plain(a.comment), a.revision]));
}

function approvalSheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = wb.addWorksheet(sheetNameV2(i));
  title(ws, p, 'Onay', `AI hiçbir adımı onaylayamaz; her karar kullanıcı adıyla kaydedilir. Güncel adım: ${currentStep(p) ?? 'Tümü onaylandı'}`, 9);
  let r = grid(ws, p, 3, ['Kayıt', 'Adım', 'Rol', 'Kullanıcı', 'Zaman', 'Karar', 'Yorum', 'Revizyon'], ['', '', '', '', '', 'decision', '', ''], [12, 22, 22, 16, 20, 12, 40, 10],
    p.approvals.map((a) => [a.id, a.step, a.role, a.user, a.at, a.decision, a.comment, a.revision]));
  const lastApproval = r - 1;
  r++;
  section(ws, r++, 'İş akışı ayarları', 3);
  r = grid(ws, p, r, ['Adım', 'Etkin', 'Rol'], [], [], p.settings.workflow.map((w) => [w.step, w.enabled ? 'Evet' : 'Hayır', w.role]));
  r++;
  section(ws, r++, 'Baseline’lar', 9);
  grid(ws, p, r, ['Baseline', 'Revizyon', 'Yazar', 'Tarih', 'Onaylayan', 'Onay yorumu', 'Değişiklik nedeni', 'SHA-256', 'Mühür'], ['', '', '', '', '', '', '', '', 'seal'], [12, 22, 22, 16, 20, 30, 40, 66, 16],
    p.baselines.map((b) => [b.id, b.revision, b.author, b.date, b.approver, b.approvalComment, b.changeReason, b.hash, verifyBaseline(b) ? 'Mühür geçerli' : 'MÜHÜR BOZUK']));
  finish(ws, 3, lastApproval, 8, 3, 0);
}

export async function buildWorkbookV2(p: Project): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FMEA Studio 2.0';
  wb.created = new Date();
  summarySheet(wb, p);
  tableSheet(wb, p, 1, 'requirements', 'Her gereksinim benzersiz ID ve kaynak konumu ile.');
  tableSheet(wb, p, 2, 'dfmea', 'Fonksiyon → Gereksinim → Hata Modu → Etki → Neden → Önleme → Tespit. ' + RPN_WARNING);
  pfmeaSheet(wb, p, 3);
  tableSheet(wb, p, 4, 'kcs', 'KC faktörleri ve önerilen kategori AI SUGGESTION’dır; karar mühendisindir.');
  tableSheet(wb, p, 5, 'controlPlan', 'Ürün karakteristiği, proses karakteristiği ve proses parametresi ayrı tutulur.');
  tableSheet(wb, p, 6, 'msa', 'KC ölçümleri için ölçüm sistemi analizi.');
  tableSheet(wb, p, 7, 'capability', 'Cp/Cpk/Pp/Ppk, normallik ve kararlılık kontrolüyle.');
  tableSheet(wb, p, 8, 'actions', 'Önerilen aksiyonlar; gecikmiş olanlar işaretlidir.');
  tableSheet(wb, p, 9, 'lessons', 'NCR / 8D / CAPA kayıtları ve bağlı FMEA satırları.');
  traceSheet(wb, p, 10);
  evidenceSheet(wb, p, 11);
  historySheet(wb, p, 12);
  approvalSheet(wb, p, 13);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
