// XLSX: exceljs ile her sayfa; satır blokları (A5:F5) + izlenebilirlik için seçili hücre blokları (B5).
import ExcelJS from 'exceljs';
import { BlockList, result, type Parser } from './util';
import { MAX_ROWS, colName, emitRows, type TRow } from './table';

function numText(n: number, fmt?: string): string {
  if (fmt && /%/.test(fmt)) return `${Number((n * 100).toPrecision(12))}%`;
  return String(Number(n.toPrecision(12)));
}

function dateText(d: Date): string {
  const iso = d.toISOString();
  return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
}

/** Hücre değeri → metin. Formüllerde hesaplanmış sonuç kullanılır. */
export function cellValueText(v: unknown, fmt?: string): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number') return numText(v, fmt);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return dateText(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text?: string }[]).map((r) => r.text ?? '').join('');
    if ('formula' in o || 'sharedFormula' in o) return cellValueText(o.result, fmt);
    if ('error' in o) return String(o.error);
    if ('text' in o) return cellValueText(o.text, fmt);
  }
  return String(v);
}

export const parseXlsx: Parser = async (_name, data) => {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const bl = new BlockList();
  const messages: { level: 'info' | 'warning'; text: string }[] = [];
  const sheets: string[] = [];
  let formulaNoResult = 0;
  wb.eachSheet((ws) => {
    sheets.push(ws.name);
    const rows: TRow[] = [];
    ws.eachRow({ includeEmpty: false }, (row, rowNo) => {
      if (rows.length > MAX_ROWS) return;
      const r: TRow = { row: rowNo, cells: [] };
      row.eachCell({ includeEmpty: false }, (cell, colNo) => {
        if (cell.isMerged && cell.master !== cell) return;
        const v = cell.value as unknown;
        if (v && typeof v === 'object' && ('formula' in v || 'sharedFormula' in v) && (v as { result?: unknown }).result == null) formulaNoResult++;
        const text = cellValueText(v, cell.numFmt).replace(/\s+/g, ' ').trim();
        if (text) r.cells.push({ col: colNo, text });
      });
      if (r.cells.length) rows.push(r);
    });
    const { truncated } = emitRows(
      bl,
      rows,
      (r) => {
        const a = r.cells[0].col, b = r.cells[r.cells.length - 1].col;
        return { sheet: ws.name, cell: a === b ? `${colName(a)}${r.row}` : `${colName(a)}${r.row}:${colName(b)}${r.row}` };
      },
      (r, c) => ({ sheet: ws.name, cell: `${colName(c.col)}${r.row}` }),
    );
    if (truncated) messages.push({ level: 'warning', text: `"${ws.name}" sayfasında ilk ${MAX_ROWS} satır işlendi; kalan satırlar atlandı.` });
  });
  if (formulaNoResult)
    messages.push({ level: 'warning', text: `${formulaNoResult} formül hücresinde kayıtlı sonuç yok (dosya hesaplanmadan kaydedilmiş olabilir); bu hücreler boş kabul edildi.` });
  const meta: Record<string, string> = { sheets: sheets.join(', ') };
  if (wb.title) meta.title = wb.title;
  if (wb.creator) meta.author = wb.creator;
  return result(bl.blocks, { meta, messages, status: messages.some((m) => m.level === 'warning' && m.text.includes('satır')) ? 'partial' : 'ok' });
};
