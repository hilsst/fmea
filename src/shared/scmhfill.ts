// Mevcut bir .xlsx şablonunu sayfa XML'i üzerinde yerinde doldurur (xlsxfill.py'nin TS karşılığı).
// exceljs/openpyxl'in düşürdüğü her şey (form kontrol checkbox'ları, şekiller, VML, external link,
// customXml, yazıcı ayarları) korunur: yalnızca dokunulan parçalar yeniden yazılır, diğer tüm paket
// girdileri içerik olarak bayt-bayt aynı kalır.
//
// Değerler inline string / sayı olarak yazılır (sharedStrings.xml'e dokunulmaz); mevcut hücre stili korunur.
// Formül yalnızca açıkça { formula } nesnesiyle yazılır: "=" ile başlayan kullanıcı metni formül olmaz.
import JSZip from 'jszip';
import { DOMParser, XMLSerializer } from '@xmldom/xmldom';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const RNS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types';
const XML_NS = 'http://www.w3.org/XML/1998/namespace';

// xmldom tipleri global DOM tiplerinden farklı; burada yalnızca kullandığımız yüzeyi tanımlıyoruz.
/* eslint-disable @typescript-eslint/no-explicit-any */
type El = any;
type Doc = any;

export type CellValue = string | number | null | undefined | { formula: string };

export interface SetOptions {
  /** Yeni oluşturulan (veya mevcut) hücreye bu hücrenin stilini (s) kopyala. */
  styleFrom?: string;
  /** Hücre stilini wrapText + üst hizalı bir kopyayla değiştir. */
  wrap?: boolean;
}

export function col2n(c: string): number {
  let n = 0;
  for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64;
  return n;
}

export function n2col(n: number): string {
  let s = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function splitRef(ref: string): [string, number] {
  const m = /^([A-Z]+)(\d+)$/.exec(ref);
  if (!m) throw new Error(`Geçersiz hücre adresi: ${ref}`);
  return [m[1], Number(m[2])];
}

/** XML 1.0'da yasak kontrol karakterlerini temizler (tab/LF/CR hariç). */
function cleanText(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '');
}

/** Formül/aralık metnindeki bu sayfaya ait (nitelenmemiş) hücre referanslarının satırını kaydırır. */
function shiftRefs(text: string, before: number, n: number): string {
  return text.replace(/(?<![A-Za-z0-9_!.'"])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (_m, d1, c, d2, r) => {
    const row = Number(r);
    return `${d1}${c}${d2}${row >= before ? row + n : row}`;
  });
}

/** Satırdaki tüm referansları `from` satırından `to` satırına taşır (kopyalanan satırdaki normal formüller için). */
function rebaseRow(text: string, from: number, to: number): string {
  return text.replace(/(?<![A-Za-z0-9_!.'"])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(])/g, (m, d1, c, d2, r) =>
    Number(r) === from && !d2 ? `${d1}${c}${d2}${to}` : m,
  );
}

function children(el: El, local: string): El[] {
  const out: El[] = [];
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === local) out.push(c);
  return out;
}
function child(el: El, local: string): El | null {
  for (let c = el.firstChild; c; c = c.nextSibling) if (c.nodeType === 1 && c.localName === local) return c;
  return null;
}
function clearChildren(el: El) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
function textOf(el: El): string {
  if (!el) return '';
  if (el.nodeType === 3 || el.nodeType === 4) return el.data;
  let s = '';
  for (let c = el.firstChild; c; c = c.nextSibling) s += textOf(c);
  return s;
}

function resolvePath(baseFile: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const parts = baseFile.split('/').slice(0, -1);
  for (const seg of target.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}
function relsPathOf(part: string): string {
  const i = part.lastIndexOf('/');
  return `${part.slice(0, i)}/_rels/${part.slice(i + 1)}.rels`;
}

export class ScmhBook {
  private zip: JSZip;
  private docs = new Map<string, Doc>();
  private texts = new Map<string, string>();
  private dirty = new Set<string>();
  private removed = new Set<string>();
  private sheetPaths = new Map<string, string>();
  private wrapCache = new Map<string, string>();
  private shared: string[] | null = null;

  private constructor(zip: JSZip) {
    this.zip = zip;
  }

  static async open(data: Uint8Array | ArrayBuffer): Promise<ScmhBook> {
    const zip = await JSZip.loadAsync(data);
    const b = new ScmhBook(zip);
    await b.init();
    return b;
  }

  private async init() {
    // Tüm XML parçalarını metin olarak önceden oku (senkron API için); ikili parçalar zip'te kalır.
    for (const name of Object.keys(this.zip.files)) {
      const f = this.zip.files[name];
      if (f.dir) continue;
      if (/\.(xml|rels|vml)$/i.test(name)) this.texts.set(name, await f.async('string'));
    }
    const wb = this.doc('xl/workbook.xml');
    const rels = this.doc('xl/_rels/workbook.xml.rels');
    const rmap = new Map<string, string>();
    for (const r of Array.from(rels.getElementsByTagNameNS(PKG, 'Relationship')) as El[]) rmap.set(r.getAttribute('Id'), r.getAttribute('Target'));
    for (const s of Array.from(wb.getElementsByTagNameNS(NS, 'sheet')) as El[]) {
      const t = rmap.get(s.getAttributeNS(RNS, 'id')) ?? '';
      this.sheetPaths.set(s.getAttribute('name'), resolvePath('xl/workbook.xml', t));
    }
  }

  /** Parçayı DOM olarak döndürür (ilk erişimde ayrıştırılır). Değiştirilecekse `touch` çağrılmalı. */
  private doc(name: string): Doc {
    let d = this.docs.get(name);
    if (!d) {
      const t = this.texts.get(name);
      if (t == null) throw new Error(`Pakette parça yok: ${name}`);
      d = new DOMParser().parseFromString(t, 'text/xml');
      this.docs.set(name, d);
    }
    return d;
  }
  private touch(name: string) {
    this.dirty.add(name);
  }

  has(name: string): boolean {
    return this.texts.has(name) || (!!this.zip.files[name] && !this.removed.has(name));
  }
  sheetNames(): string[] {
    return [...this.sheetPaths.keys()];
  }
  hasSheet(sheet: string): boolean {
    return this.sheetPaths.has(sheet);
  }
  sheetPath(sheet: string): string {
    const p = this.sheetPaths.get(sheet);
    if (!p) throw new Error(`Şablonda sayfa yok: ${sheet}`);
    return p;
  }
  private ws(sheet: string): Doc {
    return this.doc(this.sheetPath(sheet));
  }
  private sheetData(sheet: string): El {
    const sd = this.ws(sheet).getElementsByTagNameNS(NS, 'sheetData')[0];
    if (!sd) throw new Error(`sheetData yok: ${sheet}`);
    return sd;
  }

  // ------------------------------------------------------------------ hücreler
  private rowEl(sheet: string, r: number, create: boolean): El | null {
    const sd = this.sheetData(sheet);
    for (const row of children(sd, 'row')) {
      const rr = Number(row.getAttribute('r'));
      if (rr === r) return row;
      if (rr > r) {
        if (!create) return null;
        const n = sd.ownerDocument.createElementNS(NS, 'row');
        n.setAttribute('r', String(r));
        sd.insertBefore(n, row);
        return n;
      }
    }
    if (!create) return null;
    const n = sd.ownerDocument.createElementNS(NS, 'row');
    n.setAttribute('r', String(r));
    sd.appendChild(n);
    return n;
  }

  find(sheet: string, ref: string): El | null {
    const [col, r] = splitRef(ref);
    const row = this.rowEl(sheet, r, false);
    if (!row) return null;
    for (const c of children(row, 'c')) if (splitRef(c.getAttribute('r'))[0] === col) return c;
    return null;
  }

  private cell(sheet: string, ref: string, styleFrom?: string): El {
    const [col, r] = splitRef(ref);
    const row = this.rowEl(sheet, r, true);
    let found: El | null = null;
    let created = false;
    for (const c of children(row, 'c')) {
      const cc = splitRef(c.getAttribute('r'))[0];
      if (cc === col) {
        found = c;
        break;
      }
      if (col2n(cc) > col2n(col)) {
        found = row.ownerDocument.createElementNS(NS, 'c');
        found.setAttribute('r', ref);
        row.insertBefore(found, c);
        created = true;
        break;
      }
    }
    if (!found) {
      found = row.ownerDocument.createElementNS(NS, 'c');
      found.setAttribute('r', ref);
      row.appendChild(found);
      created = true;
    }
    if (styleFrom && (created || !found.getAttribute('s'))) {
      const src = this.find(sheet, styleFrom);
      const s = src?.getAttribute('s');
      if (s) found.setAttribute('s', s);
    }
    return found;
  }

  /** Hücreye değer yazar. null/undefined/'' hücreyi boşaltır (stil kalır). */
  set(sheet: string, ref: string, value: CellValue, opts: SetOptions = {}): void {
    const c = this.cell(sheet, ref, opts.styleFrom);
    this.touch(this.sheetPath(sheet));
    clearChildren(c);
    c.removeAttribute('t');
    const d = c.ownerDocument;
    if (value != null && typeof value === 'object') {
      if (typeof (value as { formula?: unknown }).formula !== 'string') throw new Error(`Desteklenmeyen hücre değeri (${ref})`);
      const f = d.createElementNS(NS, 'f');
      f.appendChild(d.createTextNode((value as { formula: string }).formula.replace(/^=/, '')));
      c.appendChild(f);
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) throw new Error(`Sayı değil (${ref})`);
      const v = d.createElementNS(NS, 'v');
      v.appendChild(d.createTextNode(String(value)));
      c.appendChild(v);
    } else if (value != null && value !== '') {
      const text = cleanText(String(value));
      c.setAttribute('t', 'inlineStr');
      const is = d.createElementNS(NS, 'is');
      const t = d.createElementNS(NS, 't');
      t.setAttributeNS(XML_NS, 'xml:space', 'preserve');
      t.appendChild(d.createTextNode(text));
      is.appendChild(t);
      c.appendChild(is);
    }
    if (opts.wrap) c.setAttribute('s', this.wrapStyle(c.getAttribute('s')));
  }

  private sharedStrings(): string[] {
    if (this.shared) return this.shared;
    this.shared = [];
    if (this.texts.has('xl/sharedStrings.xml')) {
      const d = this.doc('xl/sharedStrings.xml');
      for (const si of children(d.documentElement, 'si')) {
        // yalnızca t metinleri (rPh fonetik metni hariç)
        let s = '';
        for (const t of Array.from(si.getElementsByTagNameNS(NS, 't')) as El[]) if (t.parentNode.localName !== 'rPh') s += textOf(t);
        this.shared.push(s);
      }
    }
    return this.shared;
  }

  /** Hücre değeri: formül "=..." olarak, metin, sayı veya null. */
  get(sheet: string, ref: string): string | number | null {
    const c = this.find(sheet, ref);
    if (!c) return null;
    const f = child(c, 'f');
    if (f) return '=' + textOf(f);
    const t = c.getAttribute('t');
    if (t === 'inlineStr') {
      const is = child(c, 'is');
      return is ? textOf(is) : '';
    }
    const v = child(c, 'v');
    if (!v) return null;
    const raw = textOf(v);
    if (t === 's') return this.sharedStrings()[Number(raw)] ?? '';
    if (t === 'str' || t === 'e' || t === 'b') return raw;
    const n = Number(raw);
    return Number.isFinite(n) ? n : raw;
  }

  /** Stil indeksi (s) – yoksa ''. */
  styleOf(sheet: string, ref: string): string {
    return this.find(sheet, ref)?.getAttribute('s') ?? '';
  }

  /** Bu sütundaki ilk satır (from'dan itibaren) – metni koşulu sağlayan; yoksa null. */
  findRow(sheet: string, col: string, test: (v: string | number | null) => boolean, from = 1, to = 2000): number | null {
    const sd = this.sheetData(sheet);
    for (const row of children(sd, 'row')) {
      const r = Number(row.getAttribute('r'));
      if (r < from) continue;
      if (r > to) break;
      if (test(this.get(sheet, `${col}${r}`))) return r;
    }
    return null;
  }

  /** `cols` sütunlarının hepsi boş olan ilk satır (from'dan itibaren). */
  firstEmptyRow(sheet: string, cols: string[], from: number): number {
    let r = from;
    while (cols.some((c) => {
      const v = this.get(sheet, `${c}${r}`);
      return v != null && v !== '';
    })) r++;
    return r;
  }

  // ------------------------------------------------------------------ stiller
  /** cellXfs[base] kopyası + wrapText/üst hizalama; yeni indeksi döndürür (önbellekli). */
  wrapStyle(base: string | null | undefined): string {
    const key = base || '0';
    const hit = this.wrapCache.get(key);
    if (hit) return hit;
    const st = this.doc('xl/styles.xml');
    const xfs = st.getElementsByTagNameNS(NS, 'cellXfs')[0];
    const list = children(xfs, 'xf');
    const src = list[Number(key)] ?? list[0];
    const al = src && child(src, 'alignment');
    // Zaten sarmalıysa kopyalamaya gerek yok.
    if (al && al.getAttribute('wrapText') === '1') {
      this.wrapCache.set(key, key);
      return key;
    }
    const n = src.cloneNode(true);
    for (const a of children(n, 'alignment')) n.removeChild(a);
    const na = st.createElementNS(NS, 'alignment');
    if (al) for (const attr of Array.from(al.attributes) as El[]) na.setAttribute(attr.name, attr.value);
    na.setAttribute('wrapText', '1');
    na.setAttribute('vertical', 'top');
    // alignment, protection'dan önce gelmeli
    const prot = child(n, 'protection');
    if (prot) n.insertBefore(na, prot);
    else n.appendChild(na);
    n.setAttribute('applyAlignment', '1');
    xfs.appendChild(n);
    const idx = String(children(xfs, 'xf').length - 1);
    xfs.setAttribute('count', String(children(xfs, 'xf').length));
    this.touch('xl/styles.xml');
    this.wrapCache.set(key, idx);
    return idx;
  }

  // ------------------------------------------------------------------ yerleşim
  widths(sheet: string): Map<number, number> {
    const w = new Map<number, number>();
    for (const c of Array.from(this.ws(sheet).getElementsByTagNameNS(NS, 'col')) as El[]) {
      const lo = Number(c.getAttribute('min'));
      const hi = Math.min(Number(c.getAttribute('max')), 200);
      for (let n = lo; n <= hi; n++) w.set(n, Number(c.getAttribute('width') || 9));
    }
    return w;
  }

  /** Metinlere göre sarılmış satır yüksekliğini tahmin eder ve ht ayarlar (azaltmaz). */
  fitRow(sheet: string, r: number, texts: Record<string, string | null | undefined>, lineH = 13, minH = 18): void {
    const w = this.widths(sheet);
    let lines = 1;
    for (const [col, t] of Object.entries(texts)) {
      if (t == null || t === '') continue;
      const cw = Math.max((w.get(col2n(col)) ?? 9) * 1.15, 4);
      const n = String(t).split('\n').reduce((a, p) => a + Math.max(1, Math.ceil(p.length / cw)), 0);
      lines = Math.max(lines, n);
    }
    const row = this.rowEl(sheet, r, true);
    const cur = Number(row.getAttribute('ht') || 0);
    const ht = Math.min(409, Math.max(minH, lines * lineH + 4, cur));
    row.setAttribute('ht', String(ht));
    row.setAttribute('customHeight', '1');
    this.touch(this.sheetPath(sheet));
  }

  setColWidth(sheet: string, coln: number, width: number): void {
    const d = this.ws(sheet);
    let cols = d.getElementsByTagNameNS(NS, 'cols')[0];
    if (!cols) {
      cols = d.createElementNS(NS, 'cols');
      const sd = this.sheetData(sheet);
      sd.parentNode.insertBefore(cols, sd);
    }
    this.touch(this.sheetPath(sheet));
    for (const c of children(cols, 'col')) {
      const lo = Number(c.getAttribute('min'));
      const hi = Number(c.getAttribute('max'));
      if (lo <= coln && coln <= hi) {
        const mk = (a: number, b: number, wdt?: number) => {
          const e = c.cloneNode(false);
          e.setAttribute('min', String(a));
          e.setAttribute('max', String(b));
          if (wdt != null) {
            e.setAttribute('width', String(wdt));
            e.setAttribute('customWidth', '1');
          }
          return e;
        };
        if (lo < coln) cols.insertBefore(mk(lo, coln - 1), c);
        cols.insertBefore(mk(coln, coln, width), c);
        if (coln < hi) cols.insertBefore(mk(coln + 1, hi), c);
        cols.removeChild(c);
        return;
      }
    }
    const e = d.createElementNS(NS, 'col');
    e.setAttribute('min', String(coln));
    e.setAttribute('max', String(coln));
    e.setAttribute('width', String(width));
    e.setAttribute('customWidth', '1');
    cols.appendChild(e);
  }

  /**
   * `before` satırından önce `templateRow` satırının n kopyasını ekler; `before` ve sonrası aşağı kayar.
   * Kopyalarda stil ve formüller korunur (değerler/önbellek silinir); paylaşılan formül aralıkları,
   * birleşik hücreler, koşullu biçim, veri doğrulama, köprüler, boyut ve bu sayfayı gösteren tanımlı
   * adlar kaydırılır. Tablo aralığının içinde ekleme yapmak için `before` = son veri satırı verilmelidir.
   */
  insertRows(sheet: string, before: number, n: number, templateRow: number): void {
    if (n <= 0) return;
    const d = this.ws(sheet);
    const sd = this.sheetData(sheet);
    const shift = (s: string) => shiftRefs(s, before, n);
    let tmpl: El | null = null;
    for (const row of children(sd, 'row')) {
      const r = Number(row.getAttribute('r'));
      if (r === templateRow) tmpl = row.cloneNode(true);
      if (r >= before) {
        row.setAttribute('r', String(r + n));
        for (const c of children(row, 'c')) c.setAttribute('r', shift(c.getAttribute('r')));
      }
    }
    // Sayfadaki tüm formül metinleri ve paylaşılan formül aralıkları
    for (const f of Array.from(d.getElementsByTagNameNS(NS, 'f')) as El[]) {
      if (f.getAttribute('ref')) f.setAttribute('ref', shift(f.getAttribute('ref')));
      if (f.firstChild) {
        const t = textOf(f);
        const nt = shift(t);
        if (nt !== t) {
          clearChildren(f);
          f.appendChild(d.createTextNode(nt));
        }
      }
    }
    if (!tmpl) {
      tmpl = d.createElementNS(NS, 'row');
      tmpl.setAttribute('r', String(templateRow));
    }
    const anchor = children(sd, 'row').find((row) => Number(row.getAttribute('r')) >= before + n) ?? null;
    for (let k = 0; k < n; k++) {
      const r = before + k;
      const nr = tmpl.cloneNode(true);
      nr.setAttribute('r', String(r));
      for (const c of children(nr, 'c')) {
        const [col] = splitRef(c.getAttribute('r'));
        c.setAttribute('r', `${col}${r}`);
        const f = child(c, 'f');
        for (const ch of Array.from(c.childNodes) as El[]) if (ch !== f) c.removeChild(ch);
        if (f) {
          if (f.getAttribute('t') === 'shared' && f.getAttribute('ref')) {
            // Ana paylaşılan formül kopyalanmaz; kopya, normal formül olarak yeniden yazılır.
            const t = rebaseRow(textOf(f), templateRow, r);
            const nf = d.createElementNS(NS, 'f');
            nf.appendChild(d.createTextNode(t));
            c.replaceChild(nf, f);
          } else if (f.getAttribute('t') !== 'shared' && f.firstChild) {
            const t = rebaseRow(textOf(f), templateRow, r);
            clearChildren(f);
            f.appendChild(d.createTextNode(t));
          }
          c.removeAttribute('t');
        } else c.removeAttribute('t');
      }
      if (anchor) sd.insertBefore(nr, anchor);
      else sd.appendChild(nr);
    }
    const attrs: [string, string][] = [
      ['mergeCell', 'ref'],
      ['conditionalFormatting', 'sqref'],
      ['dataValidation', 'sqref'],
      ['hyperlink', 'ref'],
      ['selection', 'sqref'],
      ['autoFilter', 'ref'],
    ];
    for (const [tag, attr] of attrs)
      for (const e of Array.from(d.getElementsByTagNameNS(NS, tag)) as El[]) if (e.getAttribute(attr)) e.setAttribute(attr, shift(e.getAttribute(attr)));
    // x14 koşullu biçim / veri doğrulama (xm:sqref)
    for (const e of Array.from(d.getElementsByTagName('xm:sqref')) as El[]) {
      const t = textOf(e);
      clearChildren(e);
      e.appendChild(d.createTextNode(shift(t)));
    }
    const dim = d.getElementsByTagNameNS(NS, 'dimension')[0];
    if (dim) dim.setAttribute('ref', shift(dim.getAttribute('ref')));
    this.touch(this.sheetPath(sheet));
    // Bu sayfayı gösteren tanımlı adlar (yazdırma alanı vb.)
    const wb = this.doc('xl/workbook.xml');
    let wbChanged = false;
    const rangeRe = /('(?:[^']|'')+'|[A-Za-z0-9_.]+)!(\$?[A-Z]{1,3}\$?\d+(?::\$?[A-Z]{1,3}\$?\d+)?)/g;
    const sheetOf = (pfx: string) => (pfx.startsWith("'") ? pfx.slice(1, -1).replace(/''/g, "'") : pfx);
    for (const dn of Array.from(wb.getElementsByTagNameNS(NS, 'definedName')) as El[]) {
      const t = textOf(dn);
      const nt = t.replace(rangeRe, (m, pfx, rng) => (sheetOf(pfx) === sheet ? `${pfx}!${rng.replace(/(\$?)([A-Z]{1,3})(\$?)(\d+)/g, (_x: string, d1: string, c: string, d2: string, r: string) => `${d1}${c}${d2}${Number(r) >= before ? Number(r) + n : r}`)}` : m));
      if (nt !== t) {
        clearChildren(dn);
        dn.appendChild(wb.createTextNode(nt));
        wbChanged = true;
      }
    }
    if (wbChanged) this.touch('xl/workbook.xml');
  }

  /** Sayfadaki (veya tüm sayfalardaki) formül hücrelerinin önbellek değerlerini (<v>) siler. */
  stripFormulaCache(sheet?: string): void {
    const sheets = sheet ? [sheet] : this.sheetNames();
    for (const s of sheets) {
      const d = this.ws(s);
      let changed = false;
      for (const c of Array.from(d.getElementsByTagNameNS(NS, 'c')) as El[]) {
        if (!child(c, 'f')) continue;
        for (const v of children(c, 'v')) {
          c.removeChild(v);
          changed = true;
        }
        if (c.getAttribute('t') && c.getAttribute('t') !== 'array') {
          c.removeAttribute('t');
          changed = true;
        }
      }
      if (changed) this.touch(this.sheetPath(s));
    }
  }

  // ------------------------------------------------------------------ form kontrolleri
  /**
   * Form kontrol checkbox'ını işaretler/kaldırır. shapeId sayfa XML'indeki <control shapeId> ile bulunur;
   * ctrlProp parçası ve sayfanın VML çizimi ilişkilerden çözülür. Bulunamazsa false döner.
   */
  checkBox(sheet: string, shapeId: number, checked = true): boolean {
    const sp = this.sheetPath(sheet);
    const d = this.ws(sheet);
    const ctrl = (Array.from(d.getElementsByTagNameNS(NS, 'control')) as El[]).find((c) => c.getAttribute('shapeId') === String(shapeId));
    if (!ctrl) return false;
    const rp = relsPathOf(sp);
    if (!this.texts.has(rp)) return false;
    const rels = this.doc(rp);
    const relList = Array.from(rels.getElementsByTagNameNS(PKG, 'Relationship')) as El[];
    const rid = ctrl.getAttributeNS(RNS, 'id') || ctrl.getAttribute('r:id');
    const rel = relList.find((r) => r.getAttribute('Id') === rid);
    const vmlRel = relList.find((r) => /\/vmlDrawing$/.test(r.getAttribute('Type')));
    if (!rel || !vmlRel) return false;
    const cpPath = resolvePath(sp, rel.getAttribute('Target'));
    const vmlPath = resolvePath(sp, vmlRel.getAttribute('Target'));
    if (!this.texts.has(cpPath) || !this.texts.has(vmlPath)) return false;
    let v = this.texts.get(vmlPath)!;
    const i = v.indexOf(`id="_x0000_s${shapeId}"`);
    if (i < 0) return false;
    const j = v.indexOf('</x:ClientData>', i);
    if (j < 0) return false;
    const seg = v.slice(i, j);
    if (checked && !/<x:Checked>/.test(seg)) v = v.slice(0, j) + '<x:Checked>1</x:Checked>' + v.slice(j);
    if (!checked) v = v.slice(0, i) + seg.replace(/<x:Checked>[^<]*<\/x:Checked>/g, '') + v.slice(j);
    if (v !== this.texts.get(vmlPath)) {
      this.texts.set(vmlPath, v);
      this.dirty.add(vmlPath);
    }
    const cp = this.doc(cpPath).documentElement;
    if (checked) cp.setAttribute('checked', 'Checked');
    else cp.removeAttribute('checked');
    this.touch(cpPath);
    return true;
  }

  // ------------------------------------------------------------------ kaydet
  private removeCalcChain() {
    const name = 'xl/calcChain.xml';
    if (!this.has(name)) return;
    this.removed.add(name);
    this.texts.delete(name);
    const ct = this.doc('[Content_Types].xml');
    for (const o of Array.from(ct.getElementsByTagNameNS(CT, 'Override')) as El[])
      if (o.getAttribute('PartName') === '/xl/calcChain.xml') o.parentNode.removeChild(o);
    this.touch('[Content_Types].xml');
    const rels = this.doc('xl/_rels/workbook.xml.rels');
    for (const r of Array.from(rels.getElementsByTagNameNS(PKG, 'Relationship')) as El[])
      if ((r.getAttribute('Target') || '').endsWith('calcChain.xml')) r.parentNode.removeChild(r);
    this.touch('xl/_rels/workbook.xml.rels');
  }

  /** Paketi yazar. Hücre değiştiyse Excel açılışta yeniden hesaplar (fullCalcOnLoad, calcChain silinir). */
  async save(): Promise<Buffer> {
    const sheetTouched = [...this.dirty].some((p) => p.startsWith('xl/worksheets/'));
    if (sheetTouched) {
      const wb = this.doc('xl/workbook.xml');
      const cp = wb.getElementsByTagNameNS(NS, 'calcPr')[0];
      if (cp) {
        cp.setAttribute('fullCalcOnLoad', '1');
        this.touch('xl/workbook.xml');
      }
      this.removeCalcChain();
    }
    const ser = new XMLSerializer();
    for (const name of this.removed) this.zip.remove(name);
    for (const name of this.dirty) {
      if (this.removed.has(name)) continue;
      const d = this.docs.get(name);
      const text = d ? ser.serializeToString(d) : this.texts.get(name)!;
      this.texts.set(name, text);
      this.zip.file(name, text, { createFolders: false });
    }
    const out = await this.zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    this.dirty.clear();
    return out;
  }
}
