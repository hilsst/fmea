// XLSX ve CSV için ortak satır → blok dönüşümü (başlık satırı algılama dahil).
import type { DocLoc } from '../../shared/docmodel';
import type { BlockList } from './util';

export interface TCell {
  col: number; // 1 tabanlı
  text: string;
}
export interface TRow {
  row: number; // 1 tabanlı
  cells: TCell[];
}

export const MAX_ROWS = 20000;

const isNumeric = (s: string) => /^[-+]?[\d.,\s]+%?$/.test(s.trim());
/** Birimli sayı (2.00 mm, 120 °C, ±0.1) – izlenebilirlik için hücre bazında ayrıca blok üretilir. */
const NUM_UNIT = /\d\s*(mm|µm|um|μm|cm|in|°C|°F|°|N·m|Nm|N|kN|MPa|GPa|psi|bar|kPa|Pa|kg|g|%|min|h|Ra)(?![A-Za-z])|±|\+\/-/i;

export function colName(n: number): string {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** İlk dolu satır ≥2 metin (sayısal olmayan) hücreden oluşuyorsa başlık satırı kabul edilir. */
export function detectHeader(rows: TRow[]): TRow | undefined {
  const first = rows.find((r) => r.cells.some((c) => c.text));
  if (!first || rows.length < 2) return undefined;
  const filled = first.cells.filter((c) => c.text);
  if (filled.length < 2 || filled.some((c) => isNumeric(c.text) || c.text.length > 60)) return undefined;
  return first;
}

export function emitRows(
  bl: BlockList,
  rows: TRow[],
  rowLoc: (r: TRow) => DocLoc,
  cellLoc?: (r: TRow, c: TCell) => DocLoc,
): { header?: TRow; truncated: boolean } {
  const header = detectHeader(rows);
  const hmap = new Map<number, string>();
  header?.cells.forEach((c) => c.text && hmap.set(c.col, c.text));
  let count = 0;
  for (const r of rows) {
    const cells = r.cells.filter((c) => c.text);
    if (!cells.length) continue;
    if (++count > MAX_ROWS) return { header, truncated: true };
    if (r === header) {
      bl.add('table-row', cells.map((c) => c.text).join(' | '), { ...rowLoc(r), part: 'table-header' });
      continue;
    }
    const text = cells.map((c) => (hmap.has(c.col) ? `${hmap.get(c.col)}: ${c.text}` : c.text)).join(' | ');
    bl.add('table-row', text, rowLoc(r));
    if (cellLoc) for (const c of cells) if (c.text.length > 15 || NUM_UNIT.test(c.text)) bl.add('cell', c.text, cellLoc(r, c));
  }
  return { header, truncated: false };
}
