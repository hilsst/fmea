// CSV: RFC 4180 (tırnak, kaçış), ayraç otomatik algılama (, ; sekme).
import { BlockList, decodeText, result, type Parser } from './util';
import { emitRows, type TRow } from './table';

export function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  const count = (l: string, d: string) => {
    let n = 0, q = false;
    for (const ch of l) {
      if (ch === '"') q = !q;
      else if (ch === d && !q) n++;
    }
    return n;
  };
  let best = ',', bestScore = 0;
  for (const d of [',', ';', '\t', '|']) {
    const c = sample.map((l) => count(l, d));
    if (!c.length || !c[0]) continue;
    // Tutarlılık (aynı sütun sayısı) öncelikli, sonra sütun sayısı
    const score = c.filter((x) => x === c[0]).length * 100 + c[0];
    if (score > bestScore) [best, bestScore] = [d, score];
  }
  return best;
}

/** Satır numarası = kaydın başladığı fiziksel satır (tırnak içi satır sonları dahil). */
export function parseCsvText(text: string, delim: string): { line: number; fields: string[] }[] {
  const out: { line: number; fields: string[] }[] = [];
  let field = '', fields: string[] = [], q = false, line = 1, start = 1;
  const endRec = () => {
    fields.push(field);
    if (fields.some((f) => f.trim())) out.push({ line: start, fields });
    fields = [];
    field = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
    } else if (ch === '"' && field.trim() === '') { q = true; field = ''; }
    else if (ch === delim) { fields.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRec();
      line++;
      start = line;
    } else field += ch;
  }
  if (field || fields.length) endRec();
  return out;
}

export const parseCsv: Parser = async (name, data) => {
  const text = decodeText(data);
  const delim = detectDelimiter(text);
  const recs = parseCsvText(text, delim);
  const rows: TRow[] = recs.map((r) => ({ row: r.line, cells: r.fields.map((f, i) => ({ col: i + 1, text: f.replace(/\s+/g, ' ').trim() })) }));
  const bl = new BlockList();
  const { truncated } = emitRows(bl, rows, (r) => ({ sheet: name, cell: `R${r.row}` }));
  return result(bl.blocks, {
    meta: { delimiter: delim === '\t' ? 'TAB' : delim, rows: String(recs.length) },
    status: truncated ? 'partial' : 'ok',
    messages: truncated ? [{ level: 'warning', text: 'CSV çok büyük; yalnızca ilk satırlar işlendi.' }] : [],
  });
};
