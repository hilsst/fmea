// Profesyonel Excel çıktısı (exceljs). Ana süreçte (Node) çalışır.
import ExcelJS from 'exceljs';
import { completenessScore, qualityChecks, traceability } from './checks';
import { COLUMNS, cellText } from './columns';
import { TABS } from './tabs';
import type { AnyRow, Project, TableKey } from './types';

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

function sheetName(i: number, label: string) {
  return `${String(i + 1).padStart(2, '0')}_${label}`.replace(/[\\/?*[\]:]/g, '-').slice(0, 31);
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

function header(ws: ExcelJS.Worksheet, row: number, labels: string[], widths: number[]) {
  labels.forEach((l, i) => {
    const c = ws.getCell(row, i + 1);
    c.value = l;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 10 };
    c.fill = FILL(NAVY);
    c.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    c.border = BORDER;
    ws.getColumn(i + 1).width = widths[i];
  });
  ws.getRow(row).height = 32;
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
  if (/VERİ YOK|DATA NOT AVAILABLE/.test(text)) return AMBER;
  if (key === 'approval' && text === 'AI Proposed') return AMBER;
  return null;
}

function tableSheet(wb: ExcelJS.Workbook, p: Project, i: number, key: TableKey, label: string, hint: string) {
  const cols = COLUMNS[key];
  const ws = wb.addWorksheet(sheetName(i, label), { views: [{ state: 'frozen', xSplit: 1, ySplit: 3 }] });
  title(ws, p, label, hint, cols.length + 1);
  header(ws, 3, ['ID', ...cols.map((c) => c.label)], [10, ...cols.map((c) => Math.max(6, Math.round(c.width / 7)))]);
  const rows = p[key] as AnyRow[];
  rows.forEach((r, ri) => {
    const rowNo = 4 + ri;
    const id = ws.getCell(rowNo, 1);
    id.value = r.id;
    id.font = { bold: true };
    id.border = BORDER;
    cols.forEach((c, ci) => {
      const cell = ws.getCell(rowNo, ci + 2);
      const text = cellText(c, r, p);
      const num = Number(text);
      cell.value = text !== '' && (c.type === 'score' || c.type === 'number' || c.key === 'rpn' || c.key === 'severity') && Number.isFinite(num) ? num : text;
      cell.alignment = { wrapText: true, vertical: 'top', horizontal: c.type === 'score' || c.key === 'ap' || c.key === 'rpn' ? 'center' : 'left' };
      cell.border = BORDER;
      cell.font = { size: 9 };
      const color = colorFor(c.key, text, p);
      if (color) cell.fill = FILL(color);
    });
  });
  ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3 + Math.max(rows.length, 1), column: cols.length + 1 } };
  ws.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '3:3' };
}

function projectSheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = wb.addWorksheet(sheetName(i, 'Proje'));
  title(ws, p, 'FMEA Proje Bilgileri', 'Spesifikasyon §29 01_Project. AI önerileri müşteri gereksinimi veya onaylı mühendislik kriteri değildir.', 4);
  const m = p.meta;
  const rows: [string, string | number | null][] = [
    ['Proje adı', m.name], ['Parça numarası', m.partNumber], ['Parça adı', m.partName], ['Müşteri', m.customer], ['Program', m.program],
    ['Resim revizyonu', m.drawingRevision], ['FMEA numarası', m.fmeaNumber], ['FMEA revizyonu', m.fmeaRevision], ['Hazırlayan', m.preparedBy],
    ['Ekip', m.team], ['Başlangıç tarihi', m.startDate], ['Revizyon tarihi', m.revisionDate], ['Kapsam', m.scope], ['Tedarikçi / Tesis', m.supplier],
    ['Lokasyon', m.location], ['Gizlilik', m.confidentiality],
    ['KC Severity eşiği', p.settings.kcSeverityThreshold], ['High Severity eşiği', p.settings.highSeverityThreshold],
    ['RPN aksiyon eşiği', p.settings.rpnThreshold ?? 'Kullanılmıyor'], ['Hedef Cpk', p.settings.targetCpk ?? 'VERİ YOK – doğrulanmalı'],
    ['Capability min. n', p.settings.minSamples ?? 'VERİ YOK – doğrulanmalı'],
  ];
  rows.forEach(([k, v], j) => {
    const a = ws.getCell(4 + j, 1);
    a.value = k;
    a.font = { bold: true };
    a.border = BORDER;
    const b = ws.getCell(4 + j, 2);
    b.value = v === '' ? 'VERİ YOK – doğrulanmalı' : v;
    b.border = BORDER;
    b.alignment = { wrapText: true };
    if (v === '' || v == null) b.fill = FILL(AMBER);
  });
  ws.getColumn(1).width = 26;
  ws.getColumn(2).width = 70;
  // özet sayılar
  const open = p.actions.filter((a) => a.status !== 'Completed' && a.status !== 'Cancelled').length;
  const stats: [string, number][] = [
    ['Gereksinim', p.requirements.length], ['DFMEA satırı', p.dfmea.length], ['PFMEA satırı', p.pfmea.length], ['KC', p.kcs.length],
    ['Kontrol planı satırı', p.controlPlan.length], ['Açık aksiyon', open], ['Açık konu', p.issues.filter((x) => x.status !== 'Closed' && x.status !== 'Resolved').length],
  ];
  stats.forEach(([k, v], j) => {
    ws.getCell(4 + j, 4).value = k;
    ws.getCell(4 + j, 4).font = { bold: true };
    ws.getCell(4 + j, 5).value = v;
  });
  ws.getColumn(4).width = 22;
}

function traceSheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = wb.addWorksheet(sheetName(i, 'Izlenebilirlik'));
  title(ws, p, 'İzlenebilirlik Matrisi', 'ID bazında bağlantılar (spesifikasyon §26). Boşluklar her matrisin altında listelenir.', 6);
  let col = 1;
  for (const m of traceability(p)) {
    ws.getCell(3, col).value = m.title;
    ws.getCell(3, col).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getCell(3, col).fill = FILL(NAVY);
    ws.mergeCells(3, col, 3, col + 1);
    ws.getCell(4, col).value = 'Kimden';
    ws.getCell(4, col + 1).value = 'Kime';
    ws.getCell(4, col).font = ws.getCell(4, col + 1).font = { bold: true };
    let r = 5;
    for (const l of m.links) {
      ws.getCell(r, col).value = l.from;
      ws.getCell(r, col + 1).value = l.to;
      r++;
    }
    if (m.orphans.length) {
      r++;
      ws.getCell(r, col).value = m.orphanLabel;
      ws.getCell(r, col).font = { bold: true, color: { argb: 'FFC00000' } };
      r++;
      for (const o of m.orphans) {
        ws.getCell(r, col).value = o;
        ws.getCell(r, col).fill = FILL(AMBER);
        r++;
      }
    }
    ws.getColumn(col).width = 16;
    ws.getColumn(col + 1).width = 26;
    col += 3;
  }
}

function qualitySheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = wb.addWorksheet(sheetName(i, 'Kalite_Kontrol'));
  const checks = qualityChecks(p);
  const score = completenessScore(checks);
  title(ws, p, 'FMEA Kalite Kontrol', `FMEA COMPLETENESS SCORE: %${score}. Bu bir kalite sertifikası değildir; mühendislik değerlendirmesi gerekir.`, 4);
  header(ws, 3, ['Kontrol', 'Sonuç', 'Detay', 'İlgili ID'], [60, 12, 50, 60]);
  checks.forEach((c, j) => {
    const r = 4 + j;
    ws.getCell(r, 1).value = c.question;
    ws.getCell(r, 2).value = c.ok ? 'UYGUN' : 'EKSİK';
    ws.getCell(r, 2).fill = FILL(c.ok ? GREEN : RED);
    ws.getCell(r, 3).value = c.detail;
    ws.getCell(r, 4).value = c.ids.slice(0, 60).join(', ');
    for (let k = 1; k <= 4; k++) {
      ws.getCell(r, k).border = BORDER;
      ws.getCell(r, k).alignment = { wrapText: true, vertical: 'top' };
    }
  });
}

function scoringSheet(wb: ExcelJS.Workbook, p: Project, i: number) {
  const ws = wb.addWorksheet(sheetName(i, 'Puanlama'));
  title(ws, p, 'Puanlama Kriterleri', 'Severity / Occurrence / Detection kriterleri. AP: AIAG & VDA FMEA Handbook (2019) tablosu otomatik uygulanır.', 3);
  let r = 3;
  for (const [name, list] of [['SEVERITY (S)', p.scoring.severity], ['OCCURRENCE (O)', p.scoring.occurrence], ['DETECTION (D)', p.scoring.detection]] as const) {
    header(ws, r, [name, 'DFMEA kriteri', 'PFMEA kriteri'], [14, 70, 70]);
    r++;
    for (const e of list) {
      ws.getCell(r, 1).value = e.rank;
      ws.getCell(r, 1).alignment = { horizontal: 'center' };
      ws.getCell(r, 2).value = e.df;
      ws.getCell(r, 3).value = e.pf;
      for (let k = 1; k <= 3; k++) {
        ws.getCell(r, k).border = BORDER;
        if (k > 1) ws.getCell(r, k).alignment = { wrapText: true, vertical: 'top' };
      }
      r++;
    }
    r++;
  }
}

export async function buildWorkbook(p: Project): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FMEA Studio';
  wb.created = new Date();
  TABS.forEach((tab, i) => {
    if (tab.key === 'project') projectSheet(wb, p, i);
    else if (tab.key === 'traceability') traceSheet(wb, p, i);
    else if (tab.key === 'quality') qualitySheet(wb, p, i);
    else if (tab.key === 'scoring') scoringSheet(wb, p, i);
    else tableSheet(wb, p, i, tab.key, tab.label, tab.hint);
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf as ArrayBuffer);
}
