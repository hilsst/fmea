// 4.12.0: Firma kütüphanesi Excel dışa / içe aktarma. Her sekme bir sayfadır; aynı biçim içe alınır.
// Dışa aktarma yerleşik + firma satırlarını "Kaynak" sütunuyla yazar. İçe aktarmada yalnız "Firma" (veya kaynağı boş) satırlar
// kayıt olur; yerleşik satırlarda yalnız "Durum" (Etkin / Devre dışı) okunur.
import ExcelJS from 'exceljs';
import { TABS, TAB_LABEL, builtinIndex, libView, tabFields, recordFromCells, type CompanyLib, type JsonLibElement, type LibOps, type LibTab } from './companyLib';

const STRUCT_COLS = ['Şablon anahtarı', 'Şablon adı', 'Grup', 'Aile', 'İpucu', 'Kök seviye', 'Eleman anahtarı', 'Eleman adı', 'Seviye', 'Üst eleman', 'Opsiyonel', 'Eşleşme', 'Fonksiyon', 'Fonksiyon tipi', 'Kısıt', 'Arayüz'] as const;

const sheetName = (tab: LibTab) => TAB_LABEL[tab].replace(/[\\/*?:[\]]/g, '-').slice(0, 31);

const sheetCols = (tab: LibTab): string[] => ['Kaynak', 'Durum', 'ID', ...(tab === 'structures' ? STRUCT_COLS : tabFields(tab).map((f) => f.label))];

function structRows(t: { key: string; label: string; group: string; family: string; hint: string; rootLevel: string; rootFns: { text: string; type: string; constraint?: string; iface?: string }[]; elements: { key: string; name: string; level: string; parent?: string; optional?: boolean; match?: string | RegExp; fns: { text: string; type: string; constraint?: string; iface?: string }[] }[] }): string[][] {
  const head = [t.key, t.label, t.group, t.family, t.hint, t.rootLevel];
  const out: string[][] = [];
  for (const f of t.rootFns) out.push([...head, '', '', '', '', '', '', f.text, f.type, f.constraint ?? '', f.iface ?? '']);
  for (const e of t.elements) {
    const m = e.match instanceof RegExp ? e.match.source : e.match ?? '';
    const eh = [...head, e.key, e.name, e.level, e.parent ?? '', e.optional ? 'evet' : '', m];
    if (!e.fns.length) out.push([...eh, '', '', '', '']);
    for (const f of e.fns) out.push([...eh, f.text, f.type, f.constraint ?? '', f.iface ?? '']);
  }
  return out;
}

/** Kütüphaneyi (yerleşik + firma) sekme başına bir sayfa olarak çalışma kitabına yazar. */
export function buildLibWorkbook(co: CompanyLib): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'FMEA Studio';
  const idx = builtinIndex();
  for (const tab of TABS) {
    const ws = wb.addWorksheet(sheetName(tab));
    ws.addRow(sheetCols(tab)).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    if (tab === 'structures') {
      const off = new Set(co.disabled);
      for (const x of idx.structures) for (const r of structRows(x.t)) ws.addRow(['Yerleşik', off.has(x.id) ? 'Devre dışı' : 'Etkin', x.id, ...r]);
      for (const c of co.structures) for (const r of structRows(c.template)) ws.addRow(['Firma', 'Etkin', c.id, ...r]);
    } else {
      const fields = tabFields(tab);
      for (const v of libView(co, tab)) ws.addRow([v.source, v.source === 'Yerleşik' ? (v.disabled ? 'Devre dışı' : 'Etkin') : 'Etkin', v.id, ...fields.map((f) => v.cells[f.key] ?? '')]);
    }
    sheetCols(tab).forEach((_, i) => (ws.getColumn(i + 1).width = i < 3 ? 12 : 28));
    ws.getColumn(3).width = 16;
  }
  return wb;
}

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return '';
  if (typeof v === 'object') {
    const o = v as { text?: string; richText?: { text: string }[]; result?: ExcelJS.CellValue };
    if (o.richText) return o.richText.map((x) => x.text).join('').trim();
    if (o.text != null) return String(o.text).trim();
    if (o.result != null) return cellText(o.result);
    return '';
  }
  return String(v).trim();
};

export interface LibImport {
  ops: LibOps;
  /** Sayfa başına okunan firma kaydı sayısı. */
  counts: Partial<Record<LibTab, number>>;
  warnings: string[];
}

/** Dışa aktarılan biçimdeki çalışma kitabını işlemlere çevirir. Tanınmayan sayfa / sütun uyarı olur; çökmez. */
export function parseLibWorkbook(wb: ExcelJS.Workbook): LibImport {
  const res: LibImport = { ops: { upsert: [], disable: [], enable: [] }, counts: {}, warnings: [] };
  for (const tab of TABS) {
    const name = sheetName(tab);
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => cellText(v).toLocaleLowerCase('tr'));
    const col = (label: string) => header.indexOf(label.toLocaleLowerCase('tr'));
    const need = sheetCols(tab).slice(3);
    const missing = need.filter((l) => col(l) < 0 && (tab !== 'structures' || ['Şablon anahtarı', 'Şablon adı', 'Fonksiyon'].includes(l)));
    if (missing.length && missing.some((m) => tabFields(tab).find((f) => f.label === m)?.required || tab === 'structures')) {
      res.warnings.push(`"${name}" sayfasında sütun eksik: ${missing.join(', ')} – sayfa atlandı.`);
      continue;
    }
    const get = (row: ExcelJS.Row, label: string) => (col(label) >= 0 ? cellText(row.getCell(col(label)).value) : '');
    const structs = new Map<string, { id: string; t: Record<string, unknown> & { rootFns: unknown[]; elements: Map<string, JsonLibElement> } }>();
    let n = 0;
    ws.eachRow((row, i) => {
      if (i === 1) return;
      const source = get(row, 'Kaynak'), status = get(row, 'Durum').toLocaleLowerCase('tr'), id = get(row, 'ID');
      if (source.toLocaleLowerCase('tr') === 'yerleşik') {
        if (id && status.startsWith('devre')) res.ops.disable!.push(id);
        else if (id && status.startsWith('etkin')) res.ops.enable!.push(id);
        return;
      }
      if (tab === 'structures') {
        const key = get(row, 'Şablon anahtarı');
        if (!key) return;
        const s = structs.get(key) ?? { id: id.startsWith('c:') ? id : '', t: { key, label: get(row, 'Şablon adı'), group: get(row, 'Grup'), family: get(row, 'Aile'), hint: get(row, 'İpucu'), rootLevel: get(row, 'Kök seviye') || 'Product', rootFns: [], elements: new Map<string, JsonLibElement>() } };
        structs.set(key, s);
        const fn = get(row, 'Fonksiyon') ? { text: get(row, 'Fonksiyon'), type: get(row, 'Fonksiyon tipi'), constraint: get(row, 'Kısıt'), iface: get(row, 'Arayüz') } : null;
        const ek = get(row, 'Eleman anahtarı');
        if (!ek) {
          if (fn) s.t.rootFns.push(fn);
          return;
        }
        const e = s.t.elements.get(ek) ?? { key: ek, name: get(row, 'Eleman adı'), level: (get(row, 'Seviye') || 'Component') as JsonLibElement['level'], parent: get(row, 'Üst eleman') || undefined, optional: /^(evet|true|1)$/i.test(get(row, 'Opsiyonel')), match: get(row, 'Eşleşme') || undefined, fns: [] };
        if (fn) e.fns.push(fn);
        s.t.elements.set(ek, e);
        return;
      }
      const cells: Record<string, string> = {};
      for (const f of tabFields(tab)) cells[f.key] = get(row, f.label);
      if (!Object.values(cells).some(Boolean)) return;
      const { coll, rec } = recordFromCells(tab, cells, id.startsWith('c:') ? id : undefined);
      res.ops.upsert!.push({ coll, rec });
      n++;
    });
    for (const s of structs.values()) {
      res.ops.upsert!.push({ coll: 'structures', rec: { ...(s.id ? { id: s.id } : {}), template: { ...s.t, elements: [...s.t.elements.values()] } } });
      n++;
    }
    if (n) res.counts[tab] = n;
  }
  return res;
}
