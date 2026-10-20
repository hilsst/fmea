// Excel FMEA içe aktarma (kolon eşleme). Saf fonksiyonlar: ana süreç xlsx'i basit bir ızgaraya okur,
// arayüz eşleme ekranını gösterir. Eşleme yalnızca öneridir; kullanıcı değiştirir. Değer uydurulmaz.
import { COLUMNS, type Col } from './columns';
import { blankRow, nextId } from './model';
import type { AnyRow, Project, TableKey } from './types';

export interface SheetGrid {
  name: string;
  rows: (string | number | null)[][];
}

export type ImportTable = 'requirements' | 'dfmea' | 'pfmea' | 'processSteps' | 'controlPlan' | 'kcs' | 'lessons';
export const IMPORT_TABLES: ImportTable[] = ['requirements', 'dfmea', 'pfmea', 'processSteps', 'controlPlan', 'kcs', 'lessons'];

export interface ImportField {
  key: string;
  label: string;
  type: Col['type'];
  options?: string[];
}

/** Eşlemede "yok say" değeri. */
export const IGNORE = '';
/** Kaynaktaki RPN / AP gibi hesaplanan kolonlar: içe alınmaz, yeniden hesaplanır. */
export const COMPUTED = '__computed';

// İçe aktarılmayan alanlar: denetim/AI işaretleri ve uygulamanın kendisinin doldurduğu alanlar.
const EXCLUDED = new Set(['reassess', 'approval', 'dataStatus', 'evidenceIds', 'actionId']);
// Ekranda salt-okunur olsa da kaynak FMEA'larda bulunan, proses adımına eşlemede kullanılan alanlar.
const EXTRA: Partial<Record<ImportTable, string[]>> = { pfmea: ['opNo', 'stepName'], controlPlan: ['opNo', 'processName'] };

function targetsFor(table: ImportTable): ImportField[] {
  const extra = EXTRA[table] ?? [];
  return COLUMNS[table]
    .filter((c) => (extra.includes(c.key) || (c.type !== 'computed' && !c.readonly)) && !EXCLUDED.has(c.key))
    .map((c) => ({ key: c.key, label: c.label, type: c.type, ...(c.options ? { options: c.options } : {}) }));
}

export const IMPORT_TARGETS: Record<ImportTable, ImportField[]> = Object.fromEntries(IMPORT_TABLES.map((t) => [t, targetsFor(t)])) as Record<ImportTable, ImportField[]>;

const cellStr = (v: string | number | null | undefined) => (v == null ? '' : String(v).trim());

/** Başlık satırı: ilk 15 satır içinde ≥3 boş olmayan metin hücresi olan ilk satır (bulunamazsa 0). */
export function detectHeaderRow(grid: SheetGrid): number {
  const n = Math.min(grid.rows.length, 15);
  for (let i = 0; i < n; i++) {
    const texts = (grid.rows[i] ?? []).filter((v) => typeof v === 'string' && v.trim() !== '' && !/^[\d.,\s-]+$/.test(v)).length;
    if (texts >= 3) return i;
  }
  return 0;
}

export function normHeader(s: string): string {
  return s
    .toLocaleLowerCase('tr')
    .replace(/\(s\)/g, '')
    .replace(/ı/g, 'i').replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Sıra önemlidir: daha özel kurallar önce. Aday alanlardan tabloda bulunan ilk boş alan seçilir.
const RULES: [RegExp, string[]][] = [
  [/^(rpn|risk priority number|risk oncelik sayisi|new rpn|yeni rpn|rpn new|revised rpn)$/, [COMPUTED]],
  [/^(ap|action priority|aksiyon onceligi|new ap|yeni ap|ap new)$/, [COMPUTED]],
  [/^(new|yeni|revised|rev|result|sonuc) ?(s|sev|severity|siddet)$/, ['newS']],
  [/^(new|yeni|revised|rev|result|sonuc) ?(o|occ|occurrence|olasilik)$/, ['newO']],
  [/^(new|yeni|revised|rev|result|sonuc) ?(d|det|detection|tespit)$/, ['newD']],
  [/^(s|sev|severity|severity s|siddet|ciddiyet)$/, ['s']],
  [/^(o|occ|occurrence|occurrence o|olasilik|meydana gelme)$/, ['o']],
  [/^(d|det|detection|detection d|detectability|tespit edilebilirlik)$/, ['d']],
  [/^(why|neden) ?([1-5])$/, ['why$2']],
  [/(op no|op nr|operation no|operation number|operasyon no|islem no|proses no|process no|process number|step no|^op$|^no$)/, ['opNo']],
  [/(special process|ozel proses)/, ['specialProcess']],
  [/(process step|proses adimi|process name|proses adi|operation name|operasyon adi|islem adi|^operation$|^operasyon$|^step$|^adim$)/, ['stepName', 'name', 'processName']],
  [/(step id|adim id)/, ['stepId']],
  [/(failure mode|hata modu|hata turu)/, ['failureMode']],
  [/(local effect|lokal etki|yerel etki)/, ['localEffect']],
  [/(higher|ust seviye etki)/, ['higherEffect']],
  [/(effect|etki)/, ['effect']],
  [/(4m|5m|cause category|neden kategori)/, ['cause4M']],
  [/(root cause|kok neden)/, ['rootCause']],
  [/(cause|neden|sebep|mechanism)/, ['cause']],
  [/(error proof|poka|hata onleme)/, ['errorProofing']],
  [/(prevention|onleme)/, ['prevention']],
  [/(detection|tespit)/, ['detection']],
  [/(recommended action|onerilen aksiyon|tavsiye edilen|onerilen faaliyet)/, ['recommendedAction']],
  [/(action taken|actions taken|alinan aksiyon|alinan faaliyet)/, ['actionTaken']],
  [/(previous action|onceki aksiyon)/, ['previousAction']],
  [/(responsib|sorumlu|owner)/, ['owner', 'responsible']],
  [/(target date|due date|target completion|termin|hedef tarih)/, ['dueDate']],
  [/(req(uirement)? id|gereksinim id|req no)/, ['reqIds']],
  [/(function id|fonksiyon id)/, ['functionId']],
  [/(function|fonksiyon)/, ['processFunction', 'function']],
  [/(requirement|gereksinim)/, ['text', 'requirement']],
  [/(req(uirement)? type|gereksinim tipi)/, ['reqType']],
  [/(source fmea|kaynak fmea|fmea id|fmea ref)/, ['sourceId']],
  [/(linked fmea|bagli fmea|ilgili fmea)/, ['linkedFmeaIds']],
  [/(special char|ozel kar|^class$|classification|^sinif$|kc class|kc sinifi)/, ['specialChar', 'kcClass']],
  [/(product char|urun kar)/, ['productChar', 'productChars', 'characteristic']],
  [/(process char|proses kar|process param)/, ['processChar', 'processChars']],
  [/(characteristic|karakteristik)/, ['characteristic', 'productChar']],
  [/(element|proses elemani)/, ['processElement']],
  [/(machine|makine|equipment|ekipman|device|tezgah)/, ['machine']],
  [/(tool|takim|kalip|fixture)/, ['tool']],
  [/(gauge|gage|mastar|olcum cihazi|olcum sistemi)/, ['gauge']],
  [/(measurement technique|evaluation|measurement method|olcum yontemi|olcum metodu|^method$|^yontem$)/, ['method', 'measurement']],
  [/(sample size|ornek buyuklugu|^size$|^ornek$|^sample$)/, ['sampleSize']],
  [/(freq|siklik|frekans)/, ['frequency']],
  [/(control method|kontrol metodu|kontrol yontemi)/, ['controlMethod']],
  [/(reaction|reaksiyon)/, ['reactionPlan']],
  [/(specification|spesifikasyon|spec)/, ['specification']],
  [/(tolerance|tolerans)/, ['tolerance', 'specification']],
  [/(acceptance|kabul)/, ['acceptance']],
  [/(verification|dogrulama)/, ['verification']],
  [/(rationale|gerekce)/, ['rationale']],
  [/(nominal)/, ['nominal']],
  [/(^lsl$|lower|alt limit|alt sinir|^min$)/, ['lsl']],
  [/(^usl$|upper|ust limit|ust sinir|^max$)/, ['usl']],
  [/(^unit$|^birim$)/, ['unit']],
  [/(record|kayit)/, ['record']],
  [/(source type|kaynak tipi)/, ['sourceType']],
  [/(reference|referans|ncr|8d|capa)/, ['reference']],
  [/(lesson|ders)/, ['lesson']],
  [/(^type$|^tip$|^tur$)/, ['reqType', 'sourceType', 'charType']],
  [/(source|kaynak)/, ['source']],
  [/(description|aciklama|problem)/, ['description']],
  [/(^product$|^urun$)/, ['product']],
  [/(^process$|^proses$)/, ['process']],
  [/(status|durum)/, ['status', 'actionStatus']],
  [/(notes?|^not$|notlar|remarks|comment|yorum)/, ['notes']],
  [/(date|tarih)/, ['date', 'dueDate']],
];

/** Başlıklardan kolon → alan eşlemesi önerir (TR + EN eşanlamlılar). Eşleşmeyen kolon eşlemede yer almaz. */
export function suggestMapping(headers: string[], table: ImportTable): Record<number, string> {
  const targets = IMPORT_TARGETS[table];
  const keys = new Set(targets.map((t) => t.key));
  const byLabel = new Map(targets.map((t) => [normHeader(t.label), t.key] as [string, string]));
  const used = new Set<string>();
  const out: Record<number, string> = {};
  headers.forEach((h, i) => {
    const n = normHeader(String(h ?? ''));
    if (!n) return;
    const exact = byLabel.get(n);
    if (exact && !used.has(exact)) {
      out[i] = exact;
      used.add(exact);
      return;
    }
    for (const [re, cands] of RULES) {
      const m = re.exec(n);
      if (!m) continue;
      const pick = cands.map((c) => c.replace('$2', m[2] ?? '')).find((c) => c === COMPUTED || (keys.has(c) && !used.has(c)));
      if (!pick) continue;
      out[i] = pick;
      if (pick !== COMPUTED) used.add(pick);
      return;
    }
  });
  return out;
}

/** 0 tabanlı satır/kolon → Excel hücre adresi (örn. 3,4 → E4). */
export function cellAddress(row: number, col: number): string {
  let s = '';
  let c = col + 1;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return `${s}${row + 1}`;
}

function parseNumber(v: string | number): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const t = v.trim().replace(/\s/g, '').replace(',', '.');
  if (!/^[-+]?\d*\.?\d+(e[-+]?\d+)?$/i.test(t)) return null;
  return Number(t);
}

function excelDate(v: string | number): string {
  if (typeof v === 'number' && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const s = String(v).trim();
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return s;
}

const TRUE_RE = /^(evet|yes|y|e|x|true|1|var|✓|✔)$/i;
const ARRAY_KEYS = new Set(['reqIds', 'dfIds', 'linkedFmeaIds', 'pfIds']);

function allIds(p: Project): Set<string> {
  const ids = new Set<string>();
  for (const t of ['documents', 'requirements', 'structure', 'dfmea', 'processSteps', 'pfmea', 'kcs', 'controlPlan', 'processParams', 'evidence'] as TableKey[])
    for (const r of p[t] as AnyRow[]) ids.add(r.id);
  return ids;
}

export interface ImportResult {
  rows: AnyRow[];
  warnings: string[];
}

/**
 * Izgaradan yeni satırlar üretir. Proje değiştirilmez; ID'ler projedeki numaralandırmadan devam eder.
 * İçe aktarılan veri kullanıcı verisidir: origin 'import', onay ve veri durumu boş bırakılır.
 */
export function applyImport(
  p: Project,
  table: ImportTable,
  grid: SheetGrid,
  headerRow: number,
  mapping: Record<number, string>,
  opts: { sourceLabel: string },
): ImportResult {
  const warnings: string[] = [];
  const targets = new Map(IMPORT_TARGETS[table].map((t) => [t.key, t] as [string, ImportField]));
  const headers = (grid.rows[headerRow] ?? []).map((h) => cellStr(h));
  const cols: [number, ImportField][] = [];
  let computedSeen = false;
  for (const [k, field] of Object.entries(mapping)) {
    const ci = Number(k);
    if (!field) continue;
    if (field === COMPUTED) {
      computedSeen = true;
      continue;
    }
    const t = targets.get(field);
    if (!t) {
      warnings.push(`Kolon ${cellAddress(headerRow, ci)} (“${headers[ci] ?? ''}”): “${field}” bu tabloda içe aktarılabilir bir alan değil; yok sayıldı.`);
      continue;
    }
    cols.push([ci, t]);
  }
  headers.forEach((h, ci) => {
    if (!mapping[ci] && /^(rpn|ap|action priority|risk priority number)$/.test(normHeader(h))) computedSeen = true;
  });
  if (computedSeen) warnings.push('Kaynaktaki RPN / AP kolonları içe alınmadı; S/O/D değerlerinden yeniden hesaplanır.');
  cols.sort((a, b) => a[0] - b[0]);

  const work = { ...p, [table]: [...(p[table] as AnyRow[])] } as Project;
  const known = allIds(p);
  const out: AnyRow[] = [];

  for (let ri = headerRow + 1; ri < grid.rows.length; ri++) {
    const src = grid.rows[ri] ?? [];
    if (cols.every(([ci]) => cellStr(src[ci]) === '')) continue;
    const id = nextId(work, table);
    const row = blankRow(table, id) as unknown as Record<string, unknown>;
    const set = new Set<string>();
    for (const [ci, f] of cols) {
      const raw = src[ci];
      const text = cellStr(raw);
      if (text === '') continue;
      const at = cellAddress(ri, ci);
      if (f.type === 'score') {
        const n = parseNumber(raw as string | number);
        if (n == null || !Number.isInteger(n) || n < 1 || n > 10) {
          warnings.push(`${at}: “${text}” geçerli bir ${f.label} puanı değil (1–10 tam sayı); boş bırakıldı.`);
          continue;
        }
        if (set.has(f.key)) continue;
        row[f.key] = n;
      } else if (f.type === 'number') {
        const n = parseNumber(raw as string | number);
        if (n == null) {
          warnings.push(`${at}: “${text}” sayı değil (${f.label}); boş bırakıldı.`);
          continue;
        }
        row[f.key] = n;
      } else if (f.type === 'bool') {
        row[f.key] = TRUE_RE.test(text);
      } else if (f.type === 'multi' && f.options) {
        // Seçenek listeli çoklu alan (örn. PFD adım tipi): ID değil, liste değeri
        const parts = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
        const byLower = new Map(f.options.map((o) => [o.toLowerCase(), o] as [string, string]));
        const ok = parts.map((x) => byLower.get(x.toLowerCase())).filter((x): x is string => !!x);
        const bad = parts.filter((x) => !byLower.has(x.toLowerCase()));
        if (bad.length) warnings.push(`${at}: “${bad.join(', ')}” ${f.label} listesinde yok; alınmadı.`);
        row[f.key] = [...new Set([...((row[f.key] as string[]) ?? []), ...ok])];
      } else if (f.type === 'multi' || ARRAY_KEYS.has(f.key)) {
        const parts = text.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
        const ok = parts.filter((x) => known.has(x));
        const bad = parts.filter((x) => !known.has(x));
        if (bad.length) warnings.push(`${at}: projede bulunmayan ID'ler bağlanmadı – ${bad.join(', ')}`);
        const prev = (row[f.key] as string[]) ?? [];
        row[f.key] = [...new Set([...prev, ...ok])];
      } else if (f.type === 'ref') {
        if (!known.has(text)) {
          warnings.push(`${at}: “${text}” projede bulunan bir ID değil (${f.label}); bağlanmadı.`);
          continue;
        }
        row[f.key] = text;
      } else if (f.type === 'date') {
        row[f.key] = excelDate(raw as string | number);
      } else if (f.type === 'select' && f.options) {
        const hit = f.options.find((o) => o.toLocaleLowerCase('tr') === text.toLocaleLowerCase('tr'));
        row[f.key] = hit ?? text;
      } else {
        // aynı alana birden fazla kolon eşlendiyse metinler birleştirilir
        row[f.key] = set.has(f.key) && row[f.key] ? `${row[f.key]} / ${text}` : text;
      }
      set.add(f.key);
    }
    resolveStep(p, table, row);
    row.origin = 'import';
    if ('approval' in row) row.approval = '';
    if ('dataStatus' in row) row.dataStatus = '';
    if (table === 'kcs' && !set.has('status')) row.status = '';
    if (table === 'kcs' || table === 'controlPlan') row.autoCreated = false;
    const prov = `${opts.sourceLabel} / ${grid.name} / satır ${ri + 1}`;
    if ('source' in row) {
      if (!cellStr(row.source as string)) row.source = prov;
    } else if ('notes' in row) {
      row.notes = row.notes ? `${row.notes} (${prov})` : prov;
    }
    (work[table] as AnyRow[]).push(row as unknown as AnyRow);
    out.push(row as unknown as AnyRow);
  }
  if (!cols.length) warnings.push('Hiçbir kolon eşlenmedi; satır içe aktarılmadı.');
  return { rows: out, warnings };
}

/** PFMEA / Kontrol Planı: Op No veya adım adı projedeki bir proses adımıyla birebir eşleşirse bağlanır. */
function resolveStep(p: Project, table: ImportTable, row: Record<string, unknown>) {
  if (table !== 'pfmea' && table !== 'controlPlan') return;
  if (row.stepId) return;
  const op = cellStr(row.opNo as string);
  const name = cellStr((table === 'pfmea' ? row.stepName : row.processName) as string).toLocaleLowerCase('tr');
  const step =
    (op && p.processSteps.find((s) => s.opNo.trim() === op)) ||
    (name && p.processSteps.find((s) => s.name.trim().toLocaleLowerCase('tr') === name || `${s.opNo} ${s.name}`.trim().toLocaleLowerCase('tr') === name)) ||
    undefined;
  if (!step) return;
  row.stepId = step.id;
  if (!op) row.opNo = step.opNo;
  if (table === 'pfmea' && !row.stepName) row.stepName = step.name;
  if (table === 'controlPlan' && !row.processName) row.processName = step.name;
}
