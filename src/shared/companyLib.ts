// 4.12.0: Firma kütüphanesi (şema, doğrulama, birleştirme, işlemler) – saf ve testli; dosya erişimi src/main'dedir.
// Birleşik kütüphane = yerleşik − devre dışı bırakılanlar + firma kayıtları. Yerleşik kütüphane salt okunurdur.
// Dosyaya yalnız bilinen alanlar yazılır; API anahtarı / kişisel veri yazılmaz (anahtar benzeri metin reddedilir).
// Firma kaydındaki satır kaynağına "Firma kütüphanesi" yazılır; satırlar yine AI Proposed + güven Low eklenir, onay mühendistedir.
import { GAUGE_LIB, type GaugeTemplate } from './cpLib';
import { ELEMENT_KINDS, elementKind, type ElementKind, type ElementTemplate } from './elementLib';
import { DFMEA_FUNCTION_TYPES, DFMEA_LIB, PFMEA_ALT_CAUSES, PFMEA_LIB, PFMEA_STEP_COMMON, stepArea, type AltCause, type FailureTemplate } from './failureLib';
import { PARAM_LIB, type ParamTemplate } from './paramLib';
import { STRUCTURE_TEMPLATES, type LibElement, type LibFunction, type StructureTemplate } from './structureLib';
import type { DfmeaRow, PfmeaRow, Project } from './types';

export const LIB_FILE = 'fmea-kutuphane.json';
export const LIB_SCHEMA = 1;
export const COMPANY_SOURCE = 'Firma kütüphanesi';

// ───────────────────────── Şema ─────────────────────────

export interface RecBase {
  id: string;
  addedBy: string;
  addedAt: string;
  sourceProject?: string;
}
type Tpl = { failureMode: string; effect: string; cause: string; prevention: string; detection: string; s: number; o: number; d: number };
/** scopeKind 'reqType': scope = DFMEA_LIB anahtarı (gereksinim tipi, veya 'Functional' = fonksiyon hata tipleri); 'element': scope = eleman türü anahtarı. */
export interface CoDfmea extends RecBase, Tpl {
  scopeKind: 'reqType' | 'element';
  scope: string;
}
/** area: PFMEA_LIB alan anahtarı veya 'Common' (her adıma uygulanan genel modlar). */
export interface CoPfmea extends RecBase, Tpl {
  area: string;
  cause4M: string;
  rootCause: string;
  errorProofing: string;
}
export interface CoParam extends RecBase, Omit<ParamTemplate, 'key' | 'match'> {
  /** Parametre adı. */
  name: string;
  /** Parametre adında aranan düzenli ifade (küçük harf, Türkçe). */
  match: string;
}
export interface CoGauge extends RecBase, Omit<GaugeTemplate, 'key' | 'match'> {
  name: string;
  match: string;
}
export interface JsonLibElement extends Omit<LibElement, 'match'> {
  match?: string;
}
export interface JsonStructureTemplate extends Omit<StructureTemplate, 'elements'> {
  elements: JsonLibElement[];
}
export interface CoStructure extends RecBase {
  template: JsonStructureTemplate;
}

export interface CompanyLib {
  schema: number;
  rev: number;
  updatedAt: string;
  updatedBy: string;
  /** Devre dışı bırakılan YERLEŞİK kayıt kimlikleri. */
  disabled: string[];
  dfmea: CoDfmea[];
  pfmea: CoPfmea[];
  params: CoParam[];
  gauges: CoGauge[];
  structures: CoStructure[];
}
export type CollKey = 'dfmea' | 'pfmea' | 'params' | 'gauges' | 'structures';
export const COLLS: CollKey[] = ['dfmea', 'pfmea', 'params', 'gauges', 'structures'];

export const emptyCompanyLib = (): CompanyLib => ({ schema: LIB_SCHEMA, rev: 0, updatedAt: '', updatedBy: '', disabled: [], dfmea: [], pfmea: [], params: [], gauges: [], structures: [] });

// ───────────────────────── Doğrulama (asla çökmez) ─────────────────────────

const SECRET = /sk-[A-Za-z0-9_-]{16,}|AIza[0-9A-Za-z_-]{20,}|(?:api[_-]?key|secret|token|password)\s*[:=]\s*\S{8,}/i;
const MAX = 2000;
const str = (v: unknown, max = MAX): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : typeof v === 'number' ? String(v) : '');
const rating = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').replace(',', '.'));
  return Number.isFinite(n) && n >= 1 && n <= 10 ? Math.round(n) : null;
};
const C4M = ['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment'];
/** Geçerli düzenli ifade mi (ve makul uzunlukta mı)? */
export function validRegex(src: string): boolean {
  if (!src || src.length > 300) return false;
  try {
    new RegExp(src, 'i');
    return true;
  } catch {
    return false;
  }
}
/** Metinden güvenli düzenli ifade kaynağı: virgül / satır sonu ile ayrılmış anahtar kelimeler. */
export function keywordsRegex(text: string): string {
  const parts = text.split(/[,;\n|]/).map((x) => x.trim().toLocaleLowerCase('tr')).filter(Boolean);
  return parts.map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
}

let seq = 0;
const newId = (prefix: string) => `c:${prefix}:${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function base(raw: Record<string, unknown>, prefix: string, at: string, by: string): RecBase {
  return {
    id: str(raw.id, 120) || newId(prefix),
    addedBy: str(raw.addedBy, 80) || by || 'Kullanıcı',
    addedAt: str(raw.addedAt, 40) || at,
    ...(str(raw.sourceProject, 120) ? { sourceProject: str(raw.sourceProject, 120) } : {}),
  };
}
const hasSecret = (o: unknown): boolean => JSON.stringify(o).match(SECRET) !== null;

function tpl(raw: Record<string, unknown>): Tpl | string {
  const failureMode = str(raw.failureMode);
  if (!failureMode) return 'hata modu boş';
  const s = rating(raw.s), o = rating(raw.o), d = rating(raw.d);
  if (s == null || o == null || d == null) return 'S / O / D 1–10 arasında olmalı';
  return { failureMode, effect: str(raw.effect), cause: str(raw.cause), prevention: str(raw.prevention), detection: str(raw.detection), s, o, d };
}

export type CleanResult<T> = { rec: T } | { error: string };

/** Ham kaydı koleksiyonun şemasına uydurur; geçersizse neden döner. Bilinmeyen alanlar atılır. */
export function cleanRecord(coll: CollKey, raw: unknown, ctx: { at?: string; by?: string } = {}): CleanResult<CoDfmea | CoPfmea | CoParam | CoGauge | CoStructure> {
  const at = ctx.at ?? new Date().toISOString();
  const by = ctx.by ?? '';
  if (!raw || typeof raw !== 'object') return { error: 'kayıt nesne değil' };
  const r = raw as Record<string, unknown>;
  if (hasSecret(r)) return { error: 'API anahtarı / parola benzeri metin içeriyor' };
  if (coll === 'dfmea') {
    const t = tpl(r);
    if (typeof t === 'string') return { error: t };
    const scopeKind = r.scopeKind === 'element' ? 'element' : 'reqType';
    const scope = str(r.scope, 80);
    if (!scope) return { error: 'kapsam (gereksinim tipi / eleman türü) boş' };
    return { rec: { ...base(r, 'df', at, by), scopeKind, scope, ...t } };
  }
  if (coll === 'pfmea') {
    const t = tpl(r);
    if (typeof t === 'string') return { error: t };
    const area = str(r.area, 80);
    if (!area) return { error: 'proses alanı boş' };
    const c4 = str(r.cause4M, 20);
    return { rec: { ...base(r, 'pf', at, by), area, cause4M: C4M.includes(c4) ? c4 : '', rootCause: str(r.rootCause), errorProofing: str(r.errorProofing), ...t } };
  }
  if (coll === 'params') {
    const name = str(r.name, 120);
    if (!name) return { error: 'parametre adı boş' };
    const match = str(r.match, 300) || keywordsRegex(name);
    if (!validRegex(match)) return { error: 'eşleşme ifadesi geçersiz' };
    return {
      rec: {
        ...base(r, 'pr', at, by), name, match, category: str(r.category, 60), unit: str(r.unit, 30), productCharacteristic: str(r.productCharacteristic), prevention: str(r.prevention), monitoring: str(r.monitoring),
        reaction: str(r.reaction), validation: str(r.validation), limitSource: str(r.limitSource), gauge: str(r.gauge), record: str(r.record),
      },
    };
  }
  if (coll === 'gauges') {
    const name = str(r.name, 120);
    const match = str(r.match, 300) || keywordsRegex(name);
    if (!name || !validRegex(match)) return { error: !name ? 'ad boş' : 'eşleşme ifadesi geçersiz' };
    if (!str(r.gauge)) return { error: 'ölçüm cihazı boş' };
    return { rec: { ...base(r, 'gg', at, by), name, match, gauge: str(r.gauge), record: str(r.record), controlKind: str(r.controlKind, 40) || 'Inspection' } };
  }
  // structures
  const t = (r.template ?? {}) as Record<string, unknown>;
  const key = str(t.key, 60), label = str(t.label, 120);
  if (!key || !label) return { error: 'şablon anahtarı / adı boş' };
  const fns = (a: unknown): LibFunction[] =>
    (Array.isArray(a) ? a : []).map((f) => f as Record<string, unknown>).filter((f) => str(f?.text)).map((f) => ({ text: str(f.text), type: str(f.type, 60) || 'Diğer', ...(str(f.constraint) ? { constraint: str(f.constraint) } : {}), ...(str(f.iface) ? { iface: str(f.iface) } : {}) }));
  const elements: JsonLibElement[] = [];
  for (const e of Array.isArray(t.elements) ? t.elements : []) {
    const x = e as Record<string, unknown>;
    if (!str(x?.key, 60) || !str(x.name, 120)) continue;
    const m = str(x.match, 300);
    elements.push({ key: str(x.key, 60), name: str(x.name, 120), level: (str(x.level, 20) || 'Component') as JsonLibElement['level'], ...(str(x.parent, 60) ? { parent: str(x.parent, 60) } : {}), fns: fns(x.fns), ...(m && validRegex(m) ? { match: m } : {}), ...(x.optional ? { optional: true } : {}) });
  }
  const rootFns = fns(t.rootFns);
  if (!rootFns.length && !elements.length) return { error: 'şablonda fonksiyon / eleman yok' };
  const family = str(t.family, 20);
  return {
    rec: {
      ...base(r, 'st', at, by),
      template: { key, label, group: (['Kompozit', 'Metal', 'Montaj'].includes(str(t.group, 20)) ? str(t.group, 20) : 'Montaj') as StructureTemplate['group'], family: (family === 'metal' || family === 'composite' ? family : '') as StructureTemplate['family'], hint: str(t.hint), rootLevel: (str(t.rootLevel, 20) || 'Product') as StructureTemplate['rootLevel'], rootFns, elements },
    },
  };
}

/**
 * Dosyadan okunan ham veriyi şemaya uydurur. Bozuk / eksik / yeni sürüm dosyada çökmez:
 * geçersiz kayıtlar atlanır ve uyarı olarak döner; hiçbir şey yoksa boş kütüphane gelir.
 */
export function validateCompanyLib(raw: unknown): { lib: CompanyLib; warnings: string[] } {
  const warnings: string[] = [];
  const lib = emptyCompanyLib();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) warnings.push('Kütüphane dosyası beklenen biçimde değil; boş kütüphane kullanılıyor.');
    return { lib, warnings };
  }
  const r = raw as Record<string, unknown>;
  const schema = typeof r.schema === 'number' ? r.schema : 1;
  if (schema > LIB_SCHEMA) warnings.push(`Kütüphane dosyası daha yeni bir sürümden (şema ${schema}); bilinen alanlar okundu, kaydetmeden önce uygulamayı güncelleyin.`);
  lib.rev = typeof r.rev === 'number' && r.rev >= 0 ? Math.floor(r.rev) : 0;
  lib.updatedAt = str(r.updatedAt, 40);
  lib.updatedBy = str(r.updatedBy, 80);
  lib.disabled = [...new Set((Array.isArray(r.disabled) ? r.disabled : []).map((x) => str(x, 200)).filter(Boolean))];
  for (const coll of COLLS) {
    const list = r[coll];
    if (list !== undefined && !Array.isArray(list)) {
      warnings.push(`"${coll}" bölümü liste değil; atlandı.`);
      continue;
    }
    const seen = new Set<string>();
    let bad = 0;
    for (const item of (list as unknown[] | undefined) ?? []) {
      const c = cleanRecord(coll, item);
      if ('error' in c || seen.has(c.rec.id)) {
        bad++;
        continue;
      }
      seen.add(c.rec.id);
      (lib[coll] as RecBase[]).push(c.rec);
    }
    if (bad) warnings.push(`"${coll}" bölümünde ${bad} geçersiz kayıt atlandı.`);
  }
  return { lib, warnings };
}

// ───────────────────────── İşlemler (eşzamanlı kullanım için) ─────────────────────────

/** Bir yazma işlemi: kayıt ekle / güncelle (id bazında), sil, yerleşik kaydı devre dışı bırak / geri aç. */
export interface LibOps {
  upsert?: { coll: CollKey; rec: unknown }[];
  remove?: { coll: CollKey; id: string }[];
  disable?: string[];
  enable?: string[];
}

/**
 * İşlemleri güncel kütüphane üzerine uygular (rev + 1). Dosya yazılmadan önce DİSKTEKİ son hal üzerine uygulandığı için
 * başkasının eklediği kayıtlar kaybolmaz; aynı id'de son yazan kazanır. Geçersiz kayıtlar atlanır ve sayılır.
 */
export function applyOps(lib: CompanyLib, ops: LibOps, meta: { by: string; at?: string }): { lib: CompanyLib; applied: number; rejected: string[] } {
  const at = meta.at ?? new Date().toISOString();
  const next: CompanyLib = { ...lib, disabled: [...lib.disabled], dfmea: [...lib.dfmea], pfmea: [...lib.pfmea], params: [...lib.params], gauges: [...lib.gauges], structures: [...lib.structures] };
  let applied = 0;
  const rejected: string[] = [];
  for (const { coll, id } of ops.remove ?? []) {
    const before = next[coll].length;
    (next[coll] as RecBase[]) = (next[coll] as RecBase[]).filter((x) => x.id !== id);
    if (next[coll].length !== before) applied++;
  }
  for (const { coll, rec } of ops.upsert ?? []) {
    const c = cleanRecord(coll, rec, { at, by: meta.by });
    if ('error' in c) {
      rejected.push(c.error);
      continue;
    }
    const list = next[coll] as RecBase[];
    const i = list.findIndex((x) => x.id === c.rec.id);
    if (i >= 0) list[i] = { ...c.rec, addedBy: list[i].addedBy, addedAt: list[i].addedAt };
    else list.push(c.rec);
    applied++;
  }
  const dis = new Set(next.disabled);
  for (const id of ops.disable ?? []) if (id && !dis.has(id)) (dis.add(id), applied++);
  for (const id of ops.enable ?? []) if (dis.delete(id)) applied++;
  next.disabled = [...dis];
  next.rev = lib.rev + 1;
  next.updatedAt = at;
  next.updatedBy = meta.by || lib.updatedBy;
  next.schema = Math.max(LIB_SCHEMA, lib.schema);
  return { lib: next, applied, rejected };
}

// ───────────────────────── Birleşik kütüphane ─────────────────────────

export interface MergedLib {
  /** DFMEA_LIB biçimi (gereksinim tipi → hata modları); takma adlar (Process, Customer-specific) aynı dizi nesnesidir. */
  dfmea: Record<string, FailureTemplate[]>;
  functionTypes: FailureTemplate[];
  elementKinds: ElementKind[];
  /** PFMEA_LIB biçimi (alan → hata modları). */
  pfmea: Record<string, FailureTemplate[]>;
  pfmeaCommon: FailureTemplate[];
  altCauses: Record<string, AltCause[]>;
  params: ParamTemplate[];
  gauges: GaugeTemplate[];
  structures: StructureTemplate[];
}

const compile = (src: string): RegExp => new RegExp(src, 'i');
const tplOf = (c: Tpl & { sourceProject?: string }, extra: Partial<FailureTemplate> = {}): FailureTemplate => ({ failureMode: c.failureMode, effect: c.effect, cause: c.cause, prevention: c.prevention, detection: c.detection, s: c.s, o: c.o, d: c.d, company: true, ...(c.sourceProject ? { from: c.sourceProject } : {}), ...extra });

// Yerleşik kayıtların kararlı kimlikleri: kapsam + hata modu (+ nadiren tekrar eden için sıra eki).
const uniq = () => {
  const seen = new Map<string, number>();
  return (base: string) => {
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n === 1 ? base : `${base}#${n}`;
  };
};

interface BuiltinTpl {
  id: string;
  /** Kapsam anahtarı (gereksinim tipi / eleman türü / proses alanı). */
  scope: string;
  t: FailureTemplate;
}
export interface BuiltinIndex {
  dfmea: BuiltinTpl[];
  functionTypes: BuiltinTpl[];
  element: BuiltinTpl[];
  pfmea: BuiltinTpl[];
  pfmeaCommon: BuiltinTpl[];
  alt: { id: string; failureMode: string; a: AltCause }[];
  params: { id: string; t: ParamTemplate }[];
  gauges: { id: string; t: GaugeTemplate }[];
  structures: { id: string; t: StructureTemplate }[];
}

/** Takma ad (aynı dizi nesnesi) taşıyan sözlüğü tekilleştirir: dizi ilk anahtarında listelenir. */
function canonicalGroups<T>(map: Record<string, T[]>): [string, T[]][] {
  const seen = new Set<T[]>();
  const out: [string, T[]][] = [];
  for (const [k, v] of Object.entries(map)) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push([k, v]);
  }
  return out;
}

let builtinCache: BuiltinIndex | undefined;
export function builtinIndex(): BuiltinIndex {
  if (builtinCache) return builtinCache;
  const u = uniq();
  const idx: BuiltinIndex = { dfmea: [], functionTypes: [], element: [], pfmea: [], pfmeaCommon: [], alt: [], params: [], gauges: [], structures: [] };
  for (const [scope, list] of canonicalGroups(DFMEA_LIB)) for (const t of list) idx.dfmea.push({ id: u(`b:df:${scope}:${t.failureMode}`), scope, t });
  for (const t of DFMEA_FUNCTION_TYPES) idx.functionTypes.push({ id: u(`b:dfn:${t.failureMode}`), scope: 'Functional', t });
  for (const k of ELEMENT_KINDS) for (const t of k.templates) idx.element.push({ id: u(`b:el:${k.key}:${t.failureMode}`), scope: k.key, t });
  for (const [scope, list] of canonicalGroups(PFMEA_LIB)) for (const t of list) idx.pfmea.push({ id: u(`b:pf:${scope}:${t.failureMode}`), scope, t });
  for (const t of PFMEA_STEP_COMMON) idx.pfmeaCommon.push({ id: u(`b:pfc:${t.failureMode}`), scope: 'Common', t });
  for (const [fm, list] of Object.entries(PFMEA_ALT_CAUSES)) for (const a of list) idx.alt.push({ id: u(`b:alt:${fm}:${a.cause}`), failureMode: fm, a });
  for (const t of PARAM_LIB) idx.params.push({ id: `b:pr:${t.key}`, t });
  for (const t of GAUGE_LIB) idx.gauges.push({ id: `b:gg:${t.key}`, t });
  for (const t of STRUCTURE_TEMPLATES) idx.structures.push({ id: `b:st:${t.key}`, t });
  builtinCache = idx;
  return idx;
}

/** Yerleşik − devre dışı + firma. Firma verisi yoksa (veya boşsa) yerleşikle aynı içeriği verir. */
export function mergeLibs(co: CompanyLib = emptyCompanyLib()): MergedLib {
  const idx = builtinIndex();
  const off = new Set(co.disabled);
  const on = <T extends { id: string }>(l: T[]) => l.filter((x) => !off.has(x.id));

  // DFMEA: takma ad kimliğini korumak için her özgün diziyi bir kez kopyala.
  const dfmeaCopies = new Map<FailureTemplate[], FailureTemplate[]>();
  const dfmea: Record<string, FailureTemplate[]> = {};
  const ids = new Map<FailureTemplate, string>(idx.dfmea.map((x) => [x.t, x.id]));
  for (const [k, v] of Object.entries(DFMEA_LIB)) {
    if (!dfmeaCopies.has(v)) dfmeaCopies.set(v, v.filter((t) => !off.has(ids.get(t) ?? '')));
    dfmea[k] = dfmeaCopies.get(v)!;
  }
  const functionTypes = on(idx.functionTypes).map((x) => x.t);
  for (const c of co.dfmea) {
    if (c.scopeKind !== 'reqType') continue;
    if (c.scope === 'Functional') functionTypes.push(tplOf(c));
    else (dfmea[c.scope] ??= []).push(tplOf(c));
  }

  const elIds = new Map<ElementTemplate, string>(idx.element.map((x) => [x.t as ElementTemplate, x.id]));
  const elementKinds: ElementKind[] = ELEMENT_KINDS.map((k) => ({
    ...k,
    templates: [...k.templates.filter((t) => !off.has(elIds.get(t) ?? '')), ...co.dfmea.filter((c) => c.scopeKind === 'element' && c.scope === k.key).map((c) => tplOf(c))],
  }));

  const pfCopies = new Map<FailureTemplate[], FailureTemplate[]>();
  const pfIds = new Map<FailureTemplate, string>(idx.pfmea.map((x) => [x.t, x.id]));
  const pfmea: Record<string, FailureTemplate[]> = {};
  for (const [k, v] of Object.entries(PFMEA_LIB)) {
    if (!pfCopies.has(v)) pfCopies.set(v, v.filter((t) => !off.has(pfIds.get(t) ?? '')));
    pfmea[k] = pfCopies.get(v)!;
  }
  const pfmeaCommon = on(idx.pfmeaCommon).map((x) => x.t);
  const pfExtra = (c: CoPfmea) => tplOf(c, { cause4M: c.cause4M, rootCause: c.rootCause, errorProofing: c.errorProofing });
  for (const c of co.pfmea) {
    if (c.area === 'Common') pfmeaCommon.push(pfExtra(c));
    else (pfmea[c.area] ??= []).push(pfExtra(c));
  }

  const altCauses: Record<string, AltCause[]> = {};
  for (const x of on(idx.alt)) (altCauses[x.failureMode] ??= []).push(x.a);

  const params = [...on(idx.params).map((x) => x.t), ...co.params.filter((c) => validRegex(c.match)).map((c): ParamTemplate => ({ key: c.id, match: compile(c.match), category: c.category, unit: c.unit, productCharacteristic: c.productCharacteristic, prevention: c.prevention, monitoring: c.monitoring, reaction: c.reaction, validation: c.validation, limitSource: c.limitSource, gauge: c.gauge, record: c.record }))];
  // Firma kaydı önce eşleşsin (özel olan genel olanın önüne geçer).
  params.sort((a, b) => Number(b.key.startsWith('c:')) - Number(a.key.startsWith('c:')));
  const gauges = [...on(idx.gauges).map((x) => x.t), ...co.gauges.filter((c) => validRegex(c.match)).map((c): GaugeTemplate => ({ key: c.id, match: compile(c.match), gauge: c.gauge, record: c.record, controlKind: c.controlKind }))];
  gauges.sort((a, b) => Number(b.key.startsWith('c:')) - Number(a.key.startsWith('c:')));

  const structures = [
    ...on(idx.structures).map((x) => x.t),
    ...co.structures.map((c): StructureTemplate => ({ ...c.template, elements: c.template.elements.map((e) => ({ ...e, match: e.match && validRegex(e.match) ? compile(e.match) : undefined })) })),
  ];
  return { dfmea, functionTypes, elementKinds, pfmea, pfmeaCommon, altCauses, params, gauges, structures };
}

// ───────────────────────── Ekran için sekme tanımı ve görünüm satırları ─────────────────────────

export type LibTab = 'structures' | 'elements' | 'dfmea' | 'pfmea' | 'params' | 'gauges';
export interface FieldSpec {
  key: string;
  label: string;
  type?: 'text' | 'long' | 'num' | 'select';
  options?: string[];
  required?: boolean;
  wide?: boolean;
}
const TPL_FIELDS: FieldSpec[] = [
  { key: 'failureMode', label: 'Hata modu', type: 'long', required: true, wide: true },
  { key: 'effect', label: 'Etki', type: 'long', wide: true },
  { key: 'cause', label: 'Neden', type: 'long', wide: true },
  { key: 'prevention', label: 'Önleme', type: 'long', wide: true },
  { key: 'detection', label: 'Tespit', type: 'long', wide: true },
  { key: 's', label: 'S', type: 'num', required: true },
  { key: 'o', label: 'O', type: 'num', required: true },
  { key: 'd', label: 'D', type: 'num', required: true },
];
export const CONTROL_KINDS = ['Inspection', 'Test', 'First piece', 'Checklist', 'Process monitoring', 'Error-proofing', 'Audit'];

/** Sekme tanımı. scopeOptions: kapsam seçenekleri (gereksinim tipi / eleman türü / proses alanı). */
export function tabFields(tab: LibTab): FieldSpec[] {
  const idx = builtinIndex();
  if (tab === 'dfmea') return [{ key: 'scope', label: 'Gereksinim tipi', type: 'select', options: [...new Set(['Functional', ...idx.dfmea.map((x) => x.scope)])], required: true }, ...TPL_FIELDS];
  if (tab === 'elements') return [{ key: 'scope', label: 'Eleman türü', type: 'select', options: ELEMENT_KINDS.map((k) => k.key), required: true }, ...TPL_FIELDS];
  if (tab === 'pfmea')
    return [
      { key: 'area', label: 'Proses alanı', type: 'select', options: ['Common', ...new Set(idx.pfmea.map((x) => x.scope))], required: true },
      ...TPL_FIELDS.slice(0, 5),
      { key: 'cause4M', label: '4M', type: 'select', options: C4M },
      { key: 'rootCause', label: 'Kök neden', type: 'long', wide: true },
      { key: 'errorProofing', label: 'Hata önleme', type: 'long', wide: true },
      ...TPL_FIELDS.slice(5),
    ];
  if (tab === 'params')
    return [
      { key: 'name', label: 'Parametre adı', required: true },
      { key: 'match', label: 'Eşleşme (anahtar kelimeler, virgülle)', wide: true },
      { key: 'category', label: 'Kategori' },
      { key: 'unit', label: 'Birim' },
      { key: 'productCharacteristic', label: 'Ürün karakteristiği', type: 'long', wide: true },
      { key: 'prevention', label: 'Önleme', type: 'long', wide: true },
      { key: 'monitoring', label: 'İzleme', type: 'long', wide: true },
      { key: 'reaction', label: 'Reaksiyon', type: 'long', wide: true },
      { key: 'validation', label: 'Validasyon', type: 'long', wide: true },
      { key: 'limitSource', label: 'Limit kaynağı (doküman türü)', type: 'long', wide: true },
      { key: 'gauge', label: 'Ölçüm cihazı' },
      { key: 'record', label: 'Kayıt' },
    ];
  if (tab === 'gauges')
    return [
      { key: 'name', label: 'Ad', required: true },
      { key: 'match', label: 'Eşleşme (ölçüm yöntemi anahtar kelimeleri, virgülle)', wide: true },
      { key: 'gauge', label: 'Ölçüm cihazı', type: 'long', required: true, wide: true },
      { key: 'record', label: 'Kayıt', type: 'long', wide: true },
      { key: 'controlKind', label: 'Kontrol tipi', type: 'select', options: CONTROL_KINDS },
    ];
  return [
    { key: 'key', label: 'Anahtar', required: true },
    { key: 'label', label: 'Ad', required: true },
    { key: 'group', label: 'Grup' },
    { key: 'family', label: 'Aile' },
    { key: 'hint', label: 'İpucu', type: 'long', wide: true },
    { key: 'elements', label: 'Elemanlar', type: 'long', wide: true },
  ];
}
export const TAB_LABEL: Record<LibTab, string> = {
  structures: 'Yapı şablonları',
  elements: 'Eleman DFMEA',
  dfmea: 'DFMEA gereksinim tipi',
  pfmea: 'PFMEA alanları',
  params: 'Parametreler',
  gauges: 'Ölçüm / Kontrol Planı',
};
export const TABS: LibTab[] = ['structures', 'elements', 'dfmea', 'pfmea', 'params', 'gauges'];
export const TAB_COLL: Record<LibTab, CollKey> = { structures: 'structures', elements: 'dfmea', dfmea: 'dfmea', pfmea: 'pfmea', params: 'params', gauges: 'gauges' };

export interface ViewRow {
  id: string;
  source: 'Yerleşik' | 'Firma';
  /** Yerleşik kayıt devre dışı mı? */
  disabled: boolean;
  /** Yalnız bilgi: ek neden gibi yerleşik, düzenlenemeyen satır. */
  cells: Record<string, string>;
  /** Firma kaydı (düzenleme / silme için). */
  rec?: CoDfmea | CoPfmea | CoParam | CoGauge | CoStructure;
}

const cellsOfTpl = (t: FailureTemplate): Record<string, string> => ({ failureMode: t.failureMode, effect: t.effect, cause: t.cause, prevention: t.prevention, detection: t.detection, s: String(t.s), o: String(t.o), d: String(t.d) });
const elementsText = (t: { elements: { name: string }[] }) => t.elements.map((e) => e.name).join('; ');
const maskRegex = (r: RegExp) => r.source;

/** Bir sekmenin satırları: yerleşik (devre dışı olanlar işaretli) + firma. */
export function libView(co: CompanyLib, tab: LibTab): ViewRow[] {
  const idx = builtinIndex();
  const off = new Set(co.disabled);
  const b = (id: string, cells: Record<string, string>): ViewRow => ({ id, source: 'Yerleşik', disabled: off.has(id), cells });
  const rows: ViewRow[] = [];
  if (tab === 'dfmea') {
    rows.push(...idx.dfmea.map((x) => b(x.id, { scope: x.scope, ...cellsOfTpl(x.t) })), ...idx.functionTypes.map((x) => b(x.id, { scope: 'Functional', ...cellsOfTpl(x.t) })));
    rows.push(...co.dfmea.filter((c) => c.scopeKind === 'reqType').map((c): ViewRow => ({ id: c.id, source: 'Firma', disabled: false, cells: { scope: c.scope, ...cellsOfTpl(c) }, rec: c })));
  } else if (tab === 'elements') {
    rows.push(...idx.element.map((x) => b(x.id, { scope: x.scope, ...cellsOfTpl(x.t) })));
    rows.push(...co.dfmea.filter((c) => c.scopeKind === 'element').map((c): ViewRow => ({ id: c.id, source: 'Firma', disabled: false, cells: { scope: c.scope, ...cellsOfTpl(c) }, rec: c })));
  } else if (tab === 'pfmea') {
    const pf = (t: FailureTemplate, area: string) => ({ area, ...cellsOfTpl(t), cause4M: t.cause4M ?? '', rootCause: t.rootCause ?? '', errorProofing: t.errorProofing ?? '' });
    rows.push(...idx.pfmea.map((x) => b(x.id, pf(x.t, x.scope))), ...idx.pfmeaCommon.map((x) => b(x.id, pf(x.t, 'Common'))));
    rows.push(...idx.alt.map((x) => b(x.id, { area: 'Ek neden', failureMode: x.failureMode, effect: '', cause: x.a.cause, prevention: x.a.prevention, detection: '', s: '', o: x.a.o != null ? String(x.a.o) : '', d: '', cause4M: x.a.cause4M, rootCause: x.a.rootCause, errorProofing: x.a.errorProofing ?? '' })));
    rows.push(...co.pfmea.map((c): ViewRow => ({ id: c.id, source: 'Firma', disabled: false, cells: { area: c.area, ...cellsOfTpl(c), cause4M: c.cause4M, rootCause: c.rootCause, errorProofing: c.errorProofing }, rec: c })));
  } else if (tab === 'params') {
    const pc = (t: ParamTemplate, name: string) => ({ name, match: maskRegex(t.match), category: t.category, unit: t.unit, productCharacteristic: t.productCharacteristic, prevention: t.prevention, monitoring: t.monitoring, reaction: t.reaction, validation: t.validation, limitSource: t.limitSource, gauge: t.gauge, record: t.record });
    rows.push(...idx.params.map((x) => b(x.id, pc(x.t, x.t.key))));
    rows.push(...co.params.map((c): ViewRow => ({ id: c.id, source: 'Firma', disabled: false, cells: { name: c.name, match: c.match, category: c.category, unit: c.unit, productCharacteristic: c.productCharacteristic, prevention: c.prevention, monitoring: c.monitoring, reaction: c.reaction, validation: c.validation, limitSource: c.limitSource, gauge: c.gauge, record: c.record }, rec: c })));
  } else if (tab === 'gauges') {
    rows.push(...idx.gauges.map((x) => b(x.id, { name: x.t.key, match: maskRegex(x.t.match), gauge: x.t.gauge, record: x.t.record, controlKind: x.t.controlKind })));
    rows.push(...co.gauges.map((c): ViewRow => ({ id: c.id, source: 'Firma', disabled: false, cells: { name: c.name, match: c.match, gauge: c.gauge, record: c.record, controlKind: c.controlKind }, rec: c })));
  } else {
    rows.push(...idx.structures.map((x) => b(x.id, { key: x.t.key, label: x.t.label, group: x.t.group, family: x.t.family, hint: x.t.hint, elements: elementsText(x.t) })));
    rows.push(...co.structures.map((c): ViewRow => ({ id: c.id, source: 'Firma', disabled: false, cells: { key: c.template.key, label: c.template.label, group: c.template.group, family: c.template.family, hint: c.template.hint, elements: elementsText(c.template) }, rec: c })));
  }
  return rows;
}

/** Arama: görünen tüm hücrelerde, büyük / küçük harf ve Türkçe duyarsız. */
export function searchRows(rows: ViewRow[], q: string): ViewRow[] {
  const n = q.toLocaleLowerCase('tr').trim();
  if (!n) return rows;
  return rows.filter((r) => `${r.source} ${Object.values(r.cells).join(' ')}`.toLocaleLowerCase('tr').includes(n));
}

/** Form / Excel hücrelerinden kayıt ham verisi (tab'a göre). Eşleşme alanı anahtar kelimeyse düzenli ifadeye çevrilir. */
export function recordFromCells(tab: LibTab, cells: Record<string, string>, id?: string): { coll: CollKey; rec: Record<string, unknown> } {
  const c = (k: string) => (cells[k] ?? '').trim();
  const withId = id ? { id } : {};
  const rx = (v: string) => (v && !validRegex(v) ? keywordsRegex(v) : v && /[,;|\n]/.test(v) && !/[\\()[\]^$*+?]/.test(v) ? keywordsRegex(v) : v);
  if (tab === 'dfmea' || tab === 'elements') return { coll: 'dfmea', rec: { ...withId, scopeKind: tab === 'elements' ? 'element' : 'reqType', scope: resolveScope(tab, c('scope')), failureMode: c('failureMode'), effect: c('effect'), cause: c('cause'), prevention: c('prevention'), detection: c('detection'), s: c('s'), o: c('o'), d: c('d') } };
  if (tab === 'pfmea') return { coll: 'pfmea', rec: { ...withId, area: c('area'), failureMode: c('failureMode'), effect: c('effect'), cause: c('cause'), cause4M: c('cause4M'), rootCause: c('rootCause'), prevention: c('prevention'), detection: c('detection'), errorProofing: c('errorProofing'), s: c('s'), o: c('o'), d: c('d') } };
  if (tab === 'params') return { coll: 'params', rec: { ...withId, name: c('name'), match: rx(c('match')), category: c('category'), unit: c('unit'), productCharacteristic: c('productCharacteristic'), prevention: c('prevention'), monitoring: c('monitoring'), reaction: c('reaction'), validation: c('validation'), limitSource: c('limitSource'), gauge: c('gauge'), record: c('record') } };
  if (tab === 'gauges') return { coll: 'gauges', rec: { ...withId, name: c('name'), match: rx(c('match')), gauge: c('gauge'), record: c('record'), controlKind: c('controlKind') } };
  return { coll: 'structures', rec: { ...withId } };
}
/** Eleman türü: anahtar veya etiket ile yazılabilir. */
function resolveScope(tab: LibTab, v: string): string {
  if (tab !== 'elements') return v;
  const k = ELEMENT_KINDS.find((x) => x.key === v || x.label.toLocaleLowerCase('tr') === v.toLocaleLowerCase('tr'));
  return k?.key ?? v;
}

// ───────────────────────── Onaylı satırdan kayıt ─────────────────────────

const APPROVED = new Set(['Approved', 'Engineer Reviewed']);
const UNIT = 'mm|cm|m|µm|um|μm|inç|in|°c|°|derece|bar|psi|mpa|gpa|kpa|pa|n|nm|kn|kg|g|mg|s|sn|dk|min|saat|h|hz|khz|%|rpm|ohm|ω|v|a|ma|db|ppm|hrc|hv|ra|rz|lb|ft';
// Tek başına duran sayı (+ varsa birim ve ± işareti): ölçü / limit / tolerans. Kod içindeki rakamlar (AS9102, M8, T6) korunur.
const NUM = new RegExp(`(^|[\\s(\\[=<>≤≥±~/])[+-]?\\d+(?:[.,]\\d+)?(?:\\s*(?:${UNIT}))?(?:\\s*[±]\\s*\\d+(?:[.,]\\d+)?)?(?=$|[\\s),;:.\\]/])`, 'gi');
const IDS = /\b(?:REQ|FN|DF|PF|ST|PP|CP|DOC|EV|AC|KC|MSA|ISS|NCR|SM)-?\d+\b/gi;

/** Projeye özgü sayısal değer ve ID'leri ayıklar; metni okunur bırakır. */
export function scrubText(text: string, names: string[] = []): string {
  let t = ` ${text ?? ''} `;
  for (const n of names.filter((x) => x && x.length >= 3)) t = t.split(n).join('{x}');
  t = t.replace(IDS, '').replace(NUM, '$1').replace(/±/g, '').replace(/\(\s*\)/g, '').replace(/\s+([,.;:)])/g, '$1').replace(/\s{2,}/g, ' ').replace(/\{x\}(\s*\{x\})+/g, '{x}');
  return t.trim();
}

const norm = (s: string) => (s ?? '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

export interface FromApproved {
  /** Onaylı satırdan üretilen kayıtlar (collection ile birlikte). */
  records: { coll: 'dfmea' | 'pfmea'; rec: CoDfmea | CoPfmea }[];
  /** Eklenmeyen satırlar ve nedeni. */
  skipped: { id: string; reason: string }[];
}

/**
 * Onaylı (Approved / Engineer Reviewed) DFMEA veya PFMEA satırlarından firma kaydı üretir (expert.ts approvedExamples ile aynı onay ölçütü).
 * Proje özel sayılar ve ID'ler ayıklanır; karakteristik / eleman adı {x} olur. Kütüphanede zaten olan (aynı kapsam + hata modu + neden) satır atlanır.
 */
export function recordsFromApproved(p: Project, kind: 'dfmea' | 'pfmea', rowIds: string[], opts: { by?: string; at?: string; lib?: MergedLib; existing?: CompanyLib } = {}): FromApproved {
  const at = opts.at ?? new Date().toISOString();
  const by = opts.by ?? 'Kullanıcı';
  const merged = opts.lib ?? mergeLibs(opts.existing);
  const project = (p.meta.partNumber || p.meta.name || '').replace(/\s+/g, ' ').trim();
  const out: FromApproved = { records: [], skipped: [] };
  const have = new Set<string>();
  const key = (scope: string, fm: string, cause: string) => `${scope}|${norm(fm)}|${norm(cause)}`;
  if (kind === 'dfmea') {
    for (const [s, l] of Object.entries(merged.dfmea)) for (const t of l) have.add(key(s, t.failureMode, t.cause));
    for (const t of merged.functionTypes) have.add(key('Functional', t.failureMode, t.cause));
    for (const k of merged.elementKinds) for (const t of k.templates) have.add(key(k.key, t.failureMode, t.cause));
  } else {
    for (const [s, l] of Object.entries(merged.pfmea)) for (const t of l) have.add(key(s, t.failureMode, t.cause));
    for (const t of merged.pfmeaCommon) have.add(key('Common', t.failureMode, t.cause));
  }
  const rows: (DfmeaRow | PfmeaRow)[] = (kind === 'dfmea' ? p.dfmea : p.pfmea).filter((r) => rowIds.includes(r.id));
  for (const r of rows) {
    if (!APPROVED.has(r.approval)) {
      out.skipped.push({ id: r.id, reason: 'onaylı değil (Approved / Engineer Reviewed olmalı)' });
      continue;
    }
    if (!r.failureMode.trim()) {
      out.skipped.push({ id: r.id, reason: 'hata modu boş' });
      continue;
    }
    if (r.s == null || r.o == null || r.d == null) {
      out.skipped.push({ id: r.id, reason: 'S / O / D eksik' });
      continue;
    }
    const meta = { addedBy: by, addedAt: at, ...(project ? { sourceProject: project } : {}) };
    const common = { id: newId(kind === 'dfmea' ? 'df' : 'pf'), ...meta };
    if (kind === 'dfmea') {
      const d = r as DfmeaRow;
      const fn = p.structure.find((s) => s.id === d.functionId);
      const ek = fn ? elementKind(fn.element, merged.elementKinds) : undefined;
      const req = p.requirements.find((q) => d.reqIds?.includes(q.id));
      const reqScope = req && merged.dfmea[req.reqType] && req.reqType !== 'Functional' ? req.reqType : 'Functional';
      const scopeKind = ek ? 'element' : 'reqType';
      const scope = ek ? ek.key : reqScope;
      const names = [fn?.element ?? '', req?.characteristic ?? ''];
      const t = (v: string) => scrubText(v, names);
      const rec: CoDfmea = { ...common, scopeKind, scope, failureMode: t(d.failureMode), effect: t(d.effect), cause: t(d.cause), prevention: t(d.prevention), detection: t(d.detection), s: d.s!, o: d.o!, d: d.d! };
      if (have.has(key(scope, rec.failureMode, rec.cause))) out.skipped.push({ id: r.id, reason: 'kütüphanede zaten var' });
      else (have.add(key(scope, rec.failureMode, rec.cause)), out.records.push({ coll: 'dfmea', rec }));
    } else {
      const f = r as PfmeaRow;
      const st = p.processSteps.find((s) => s.id === f.stepId);
      const area = stepArea(p, st, f.stepName);
      const names = [f.stepName ?? '', st?.name ?? ''];
      const t = (v: string) => scrubText(v, names);
      const rec: CoPfmea = { ...common, area, cause4M: f.cause4M ?? '', rootCause: t(f.rootCause ?? ''), errorProofing: t(f.errorProofing ?? ''), failureMode: t(f.failureMode), effect: t(f.effect), cause: t(f.cause), prevention: t(f.prevention), detection: t(f.detection), s: f.s!, o: f.o!, d: f.d! };
      if (have.has(key(area, rec.failureMode, rec.cause))) out.skipped.push({ id: r.id, reason: 'kütüphanede zaten var' });
      else (have.add(key(area, rec.failureMode, rec.cause)), out.records.push({ coll: 'pfmea', rec }));
    }
  }
  return out;
}

/** Eski yerel örnek kütüphanesi satırlarını (userData) firma kaydına çevirir – ilk açılışta taşıma seçeneği için. */
export function recordsFromExamples(
  rows: { kind: 'dfmea' | 'pfmea'; project: string; context: string; failureMode: string; effect: string; cause: string; rootCause: string; prevention: string; detection: string; errorProofing: string; s: number | null; o: number | null; d: number | null }[],
  by = 'Kullanıcı',
  at = new Date().toISOString(),
): { coll: 'dfmea' | 'pfmea'; rec: CoDfmea | CoPfmea }[] {
  const out: { coll: 'dfmea' | 'pfmea'; rec: CoDfmea | CoPfmea }[] = [];
  const seen = new Set<string>();
  for (const x of rows) {
    if (!x.failureMode?.trim() || x.s == null || x.o == null || x.d == null) continue;
    const ctx = x.context ?? '';
    const t = (v: string) => scrubText(v);
    const meta = { addedBy: by, addedAt: at, ...(x.project ? { sourceProject: x.project } : {}) };
    const k = `${x.kind}|${norm(x.context)}|${norm(x.failureMode)}|${norm(x.cause)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (x.kind === 'dfmea') {
      const el = ctx.split('→')[0]?.trim() ?? '';
      const ek = elementKind(el);
      out.push({ coll: 'dfmea', rec: { id: newId('df'), ...meta, scopeKind: ek ? 'element' : 'reqType', scope: ek ? ek.key : 'Functional', failureMode: scrubText(x.failureMode, [el]), effect: t(x.effect), cause: t(x.cause), prevention: t(x.prevention), detection: t(x.detection), s: x.s, o: x.o, d: x.d } });
    } else {
      const area = /^\[([^\]]+)\]/.exec(ctx)?.[1] ?? 'Generic';
      out.push({ coll: 'pfmea', rec: { id: newId('pf'), ...meta, area, cause4M: '', rootCause: t(x.rootCause), errorProofing: t(x.errorProofing), failureMode: t(x.failureMode), effect: t(x.effect), cause: t(x.cause), prevention: t(x.prevention), detection: t(x.detection), s: x.s, o: x.o, d: x.d } });
    }
  }
  return out;
}
