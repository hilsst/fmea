// Kural tabanlı öneri motoru: doküman → gereksinim → yapı/fonksiyon → DFMEA → PFMEA.
// Üretilen her satır "AI Proposed" eklenir; ekleme öncesi onay penceresi tüm satırları listeler.
// Kaynakta olmayan değer uydurulmaz (VERİ YOK); kütüphane içeriği ENGINEERING KNOWLEDGE olarak işaretlenir.
import { findRequirementCandidates, locText } from './docmodel';
import { DFMEA_FUNCTION_TYPES, DFMEA_LIB, PFMEA_ALT_CAUSES, PFMEA_LIB, PFMEA_STEP_COMMON, paramTemplates, stepArea, type FailureTemplate } from './failureLib';
import { elementKind, type ElementTemplate } from './elementLib';
import { dfmeaFillValues, fillBlanksEdits, pfmeaFillValues } from './fmeaFill';
import { blankRow, nextId } from './model';
import { NO_DATA, characteristicOf, reqAutoValues } from './reqAutofill';
import { similarity } from './similarity';
import type { AnyRow, PfmeaRow, ProcessParamRow, ProcessStepRow, Project, RequirementRow, StructureRow, TableKey } from './types';

export type GenEdit = { kind: 'add'; table: TableKey; row: AnyRow } | { kind: 'set'; table: TableKey; id: string; field: string; value: unknown };

export const ASSUMPTION = 'AI VARSAYIMI – mühendislik doğrulaması gerekli';
const LIB_REASON = 'Hata kütüphanesi başlangıç değeri – kriter tablosuna göre doğrulayın (AI VARSAYIMI)';

/** Satır ekleyen ve eklenenleri kendi proje kopyasında tutan yardımcı (sonraki adımlar yeni satırları görür). */
export class Gen {
  edits: GenEdit[] = [];
  counts: Partial<Record<string, number>> = {};
  constructor(public p: Project) {}
  add(table: TableKey, data: Partial<AnyRow>): string {
    const id = nextId(this.p, table);
    const row = { ...blankRow(table, id), ...data, id } as AnyRow;
    this.p = { ...this.p, [table]: [...(this.p[table] as AnyRow[]), row] };
    this.edits.push({ kind: 'add', table, row });
    this.counts[table] = (this.counts[table] ?? 0) + 1;
    return id;
  }
  /** Henüz uygulanmamış (bu çalıştırmada eklenen) satırı yerinde tamamlar. */
  fill(row: AnyRow, vals: Record<string, unknown>) {
    Object.assign(row, vals);
  }
  set(table: TableKey, id: string, field: string, value: unknown) {
    this.p = { ...this.p, [table]: (this.p[table] as AnyRow[]).map((r) => (r.id === id ? { ...r, [field]: value } : r)) };
    this.edits.push({ kind: 'set', table, id, field, value });
  }
}

// ───────────────────────── 1) Dokümanlardan gereksinim ─────────────────────────

/** Analiz edilmiş dokümanlardaki gereksinim cümlelerini ekler (yerel, AI kullanılmaz). */
export function genRequirements(g: Gen, docIds?: string[]) {
  const have = new Set(g.p.requirements.map((r) => r.text.trim().toLowerCase()));
  for (const doc of g.p.documents) {
    if (docIds && !docIds.includes(doc.id)) continue;
    const index = g.p.docIndex[doc.id];
    if (!index || index.status === 'unsupported') continue;
    for (const c of findRequirementCandidates(index)) {
      const key = c.text.trim().toLowerCase();
      if (have.has(key)) continue;
      have.add(key);
      const evId = g.add('evidence', { docId: doc.id, page: c.loc.page ? String(c.loc.page) : '', section: c.loc.section ?? '', sheet: c.loc.sheet ?? '', cell: c.loc.cell ?? '', balloon: c.loc.balloon ?? '', quote: c.evidence, evidenceType: 'Doküman metni', basis: 'SOURCE DATA', confidence: c.confidence, verification: 'VERIFIED', verifiedLocation: locText(c.loc), origin: 'extraction' } as Partial<AnyRow>);
      const id = g.add('requirements', {
        text: c.text, reqType: c.reqType, characteristic: c.characteristic, nominal: c.nominal, lsl: c.lsl, usl: c.usl, unit: c.unit, tolerance: c.tolerance,
        source: `${doc.docNumber || doc.name} ${locText(c.loc)}`.trim(), sourceDocId: doc.id, sourcePage: c.loc.page ? String(c.loc.page) : '', sourceSection: c.loc.section ?? '', sourceCell: c.loc.cell ?? '', balloon: c.loc.balloon ?? '',
        evidenceText: c.evidence, confidence: c.confidence, dataStatus: 'DOĞRULAMA GEREKLİ', origin: 'extraction', evidenceIds: [evId], approval: 'AI Proposed',
      } as Partial<AnyRow>);
      // Kabul kriteri / doğrulama yöntemi sonraki aşamalarda (fonksiyon metni) kullanılabilsin diye hemen doldurulur.
      const r = g.p.requirements.find((x) => x.id === id)!;
      const auto = reqAutoValues(r);
      const row = g.edits[g.edits.length - 1] as { row: AnyRow };
      Object.assign(row.row, auto, { autoFields: Object.keys(auto) });
      Object.assign(r, auto, { autoFields: Object.keys(auto) });
    }
  }
}

// ───────────────────────── 2) Gereksinimden yapı & fonksiyon ─────────────────────────

/** Özellik (Feature) seviyesinde karşılanan gereksinim tipleri; diğerleri ürün seviyesinde fonksiyondur. */
const FEATURE_TYPES = new Set(['Dimensional', 'Material', 'Interface']);
/** Proses / muayene gereksinimleri tasarım yapısına değil, proses akışı ve PFMEA'ya aittir. */
const PROCESS_TYPES = new Set(['Manufacturing', 'Process', 'Inspection']);

const FUNCTION_TYPE: Record<string, string> = {
  Dimensional: 'Geometrik uyum', Interface: 'Bağlantı', Structural: 'Yük aktarma', Environmental: 'Çevresel dayanım', Reliability: 'Titreşim dayanımı',
};

/** Gereksinim metninden ölçü/tolerans ve kip ifadelerini atarak eleman adı çıkarır. */
export function elementName(text: string): string {
  const t = text
    .replace(/(?<![\p{L}\d])\d+\s*[xX]\s+/gu, '')
    .replace(/°\s*[CF]\b/g, ' ')
    .replace(/[Ø⌀±≥≤<>]/g, ' ')
    .replace(/[-+]?\d+(?:[.,]\d+)?(?:\s*\/\s*[-+]?\d+(?:[.,]\d+)?)*/g, ' ')
    .replace(/(?<![\p{L}\d])(mm|µm|um|cm|inch|in|°C|°F|deg|kg|g|min|dk|h|s|MPa|GPa|kPa|bar|psi|Pa|N|Nm|%|Ra)(?![\p{L}\d])/giu, ' ')
    .replace(/°|…|(?<![\p{L}\d])(?:min\.|maks\.|max\.|en az(?![\p{L}\d])|en fazla(?![\p{L}\d]))/giu, ' ')
    .replace(/(?<![\p{L}\d])(olmalı|gereklidir|zorunludur|shall|must|be|\p{L}+(?:malıdır|melidir)|aralığında)(?![\p{L}\d])/giu, ' ')
    .replace(/[–\-:;,/().]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const short = t.split(' ').slice(0, 6).join(' ');
  return short ? short[0].toLocaleUpperCase('tr') + short.slice(1) : '';
}

function functionText(r: RequirementRow, element: string): string {
  const ok = r.acceptance && !r.acceptance.startsWith(NO_DATA) && !r.acceptance.includes(NO_DATA);
  const ch = r.characteristic || characteristicOf(r.text) || element;
  if (FEATURE_TYPES.has(r.reqType) && ok) return `${ch} değerini ${r.acceptance} sınırları içinde sağlar`;
  return `${r.text.replace(/\s*(olmalıdır|olmalı|sağlamalıdır)\.?$/i, '')} gereksinimini karşılar`;
}

/** Yapı ağacına bağlı olmayan gereksinimlerden Product → Part → Feature yapısı ve fonksiyonları önerir. */
export function genStructure(g: Gen, reqIds?: string[]) {
  const linked = new Set(g.p.structure.flatMap((s) => s.reqIds));
  const reqs = g.p.requirements.filter((r) => r.text.trim() && !linked.has(r.id) && !PROCESS_TYPES.has(r.reqType) && r.approval !== 'Rejected' && (!reqIds || reqIds.includes(r.id)));
  if (!reqs.length) return;
  const m = g.p.meta;
  const common = { approval: 'AI Proposed', origin: 'template', notes: 'Otomatik öneri (gereksinimden) – mühendis onayı gerekli' };
  let root = g.p.structure.find((s) => s.level === 'Product' || s.level === 'System') as StructureRow | undefined;
  const rootName = root?.element || m.partName || m.name || 'Ürün';
  const rootId = root?.id ?? g.add('structure', { level: 'Product', element: rootName, source: 'Proje bilgisi', ...common } as Partial<AnyRow>);
  root = g.p.structure.find((s) => s.id === rootId)!;
  let part = g.p.structure.find((s) => s.level === 'Part' || s.level === 'Component');
  // Parça satırı yoksa mevcut özelliklerin bağlı olduğu eleman kullanılır; o da yoksa parça önerilir.
  const featureParent = g.p.structure.find((s) => s.level === 'Feature' && s.parentId)?.parentId;
  const partId = () => {
    if (!part && featureParent) return featureParent;
    if (!part) {
      const id = g.add('structure', { level: 'Part', parentId: rootId, element: `${m.partNumber} ${m.partName}`.trim() || rootName, source: 'Proje bilgisi', ...common } as Partial<AnyRow>);
      part = g.p.structure.find((s) => s.id === id);
    }
    return part!.id;
  };
  for (const r of reqs) {
    const feature = FEATURE_TYPES.has(r.reqType);
    const element = feature ? elementName(r.text) || r.characteristic || r.id : rootName;
    const fn = functionText(r, element);
    const data = {
      functionType: FUNCTION_TYPE[r.reqType] ?? '',
      performanceReq: r.acceptance && !r.acceptance.includes(NO_DATA) ? r.acceptance : '',
      reqIds: [r.id],
      source: `${r.id}${r.source ? ' · ' + r.source : ''}`,
      ...common,
    };
    // Ürün seviyesindeki ilk fonksiyon kök satırına yazılır; sonrakiler aynı elemanın ek fonksiyon satırlarıdır.
    const cur = g.p.structure.find((s) => s.id === rootId)!;
    if (!feature && !cur.function) {
      g.set('structure', rootId, 'function', fn);
      g.set('structure', rootId, 'reqIds', [...cur.reqIds, r.id]);
      if (!cur.performanceReq && data.performanceReq) g.set('structure', rootId, 'performanceReq', data.performanceReq);
      continue;
    }
    g.add('structure', { level: feature ? 'Feature' : 'Product', parentId: feature ? partId() : '', element, function: fn, ...data } as Partial<AnyRow>);
  }
}

// ───────────────────────── 3) Fonksiyondan DFMEA ─────────────────────────

const fill = (s: string, x: string) => s.replace(/\{x\}/g, x);

function scoreFields(t: FailureTemplate) {
  return { s: t.s, o: t.o, d: t.d, sReason: LIB_REASON, oReason: LIB_REASON, dReason: LIB_REASON, sConf: 'Low', oConf: 'Low', dConf: 'Low' };
}

/** 4.7.0: aynı / çok benzer hata modu (aynı fonksiyon veya adımda) tekrar önerilmez. */
export const SAME_MODE = 0.8;
const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
/** Zıt yönlü modlar (alt / üst limit, eksik / fazla) benzer metne rağmen ayrı hata modlarıdır. */
const OPPOSITES: [RegExp, RegExp][] = [[/alt limit|altında/, /üst limit|üzerinde/], [/eksik|yetersiz/, /fazla|aşırı/]];
const opposite = (a: string, b: string) => OPPOSITES.some(([x, y]) => (x.test(a) && !y.test(a) && y.test(b) && !x.test(b)) || (y.test(a) && !x.test(a) && x.test(b) && !y.test(b)));
function covered(existing: string[], fm: string, skipIf?: RegExp): boolean {
  const n = norm(fm);
  return existing.some((e) => norm(e) === n || (skipIf?.test(norm(e)) ?? false) || (similarity(e, fm) >= SAME_MODE && !opposite(norm(e), n)));
}

/**
 * Fonksiyonlar için hata kütüphanesinden DFMEA satırı önerir.
 * 4.7.0: tek bir hata modu değil, olası tüm modlar – fonksiyona bağlı HER gereksinim tipinin kütüphanesi ve
 * fonksiyon hata tipleri (yok / kısmi / zamanla azalan / aralıklı / istenmeyen). Fonksiyonun mevcut satırları korunur,
 * yalnız eksik modlar eklenir.
 */
export function genDfmea(g: Gen, fnIds?: string[]) {
  for (const fn of g.p.structure) {
    if (!fn.function?.trim() || fn.approval === 'Rejected' || (fnIds && !fnIds.includes(fn.id))) continue;
    const have = g.p.dfmea.filter((d) => d.functionId === fn.id).map((d) => d.failureMode);
    const reqs = fn.reqIds.map((id) => g.p.requirements.find((r) => r.id === id)).filter(Boolean) as RequirementRow[];
    // Emniyet / regülasyon önce; sonra bağlı gereksinimlerin tipleri (her tip bir kez).
    const types = [...new Set([...reqs.filter((r) => r.reqType === 'Safety' || r.reqType === 'Regulatory'), ...reqs].map((r) => r.reqType).filter((t) => DFMEA_LIB[t] && DFMEA_LIB[t] !== DFMEA_LIB.Functional))]; // Functional = fonksiyon hata tipleri
    const verification = reqs.map((r) => r.verification).find((v) => v && !v.includes(NO_DATA));
    const xOf = (type: string) => reqs.find((r) => r.reqType === type)?.characteristic || reqs[0]?.characteristic || fn.element || fn.id;
    // 4.10.0: elemana özel hata modları (eleman türü addan tanınır). Eleman birden çok fonksiyon satırına sahipse
    // her mod, tipine (ft) uyan fonksiyon satırına; yoksa elemanın ilk fonksiyon satırına bir kez eklenir.
    const kind = elementKind(fn.element);
    const siblings = g.p.structure.filter((s) => s.function?.trim() && s.approval !== 'Rejected' && s.parentId === fn.parentId && norm(s.element) === norm(fn.element) && s.level === fn.level);
    const ownerOf = (t: ElementTemplate) => (siblings.find((s) => t.ft && s.functionType === t.ft) ?? siblings[0] ?? fn).id;
    const elementHave = g.p.dfmea.filter((d) => siblings.some((s) => s.id === d.functionId)).map((d) => d.failureMode);
    const elementPlan = (kind?.templates ?? []).filter((t) => ownerOf(t) === fn.id && !covered(elementHave, fill(t.failureMode, fn.element))).map((t) => ({ t: t as FailureTemplate, type: `eleman: ${kind!.label}`, x: fn.element }));
    const plan: { t: FailureTemplate; type: string; x: string }[] = [
      ...elementPlan,
      ...types.flatMap((type) => DFMEA_LIB[type].map((t) => ({ t, type, x: xOf(type) }))),
      // Türü tanınan alt elemanlarda genel fonksiyon hata tipleri eklenmez: elemana özel modlar aynı soruları somut yanıtlar. Ürün seviyesinde kalır.
      ...(kind && fn.parentId ? [] : DFMEA_FUNCTION_TYPES.map((t) => ({ t, type: 'fonksiyon hata tipleri', x: xOf('') }))),
    ];
    for (const { t, type, x } of plan) {
      const failureMode = fill(t.failureMode, x);
      if (covered(have, failureMode, t.skipIf)) continue;
      have.push(failureMode);
      const id = g.add('dfmea', {
        functionId: fn.id,
        function: fn.function,
        reqIds: [...fn.reqIds],
        failureMode,
        effect: t.effect,
        cause: t.cause,
        prevention: t.prevention,
        detection: verification ? `${t.detection}; ${verification}` : t.detection,
        ...scoreFields(t),
        source: `${fn.id}${fn.reqIds.length ? ', ' + fn.reqIds.join(', ') : ''} · DFMEA hata kütüphanesi (${type})`,
        confidence: 'Low',
        basis: 'ENGINEERING KNOWLEDGE',
        dataStatus: ASSUMPTION,
        approval: 'AI Proposed',
        origin: 'template',
      } as Partial<AnyRow>);
      const row = g.p.dfmea.find((d) => d.id === id)!;
      g.fill(row, dfmeaFillValues(g.p, row));
    }
  }
}

// ───────────────────────── 4) Proses adımından PFMEA ─────────────────────────

function pfRow(step: ProcessStepRow, t: FailureTemplate, source: string, dfIds: string[] = []): Partial<PfmeaRow> {
  return {
    stepId: step.id,
    dfIds,
    failureMode: t.failureMode,
    effect: t.effect,
    cause: t.cause,
    cause4M: (t.cause4M ?? '') as PfmeaRow['cause4M'],
    rootCause: t.rootCause ? `${t.rootCause} (5 Neden ile doğrulayın)` : '',
    prevention: t.prevention,
    detection: t.detection,
    errorProofing: t.errorProofing ?? '',
    ...(scoreFields(t) as Partial<PfmeaRow>),
    source,
    confidence: 'Low',
    basis: 'ENGINEERING KNOWLEDGE',
    dataStatus: ASSUMPTION,
    approval: 'AI Proposed',
    origin: 'template',
  };
}

/**
 * Proses adımları için kütüphane ve özel proses parametrelerinden PFMEA satırı önerir.
 * 4.7.0: adımda satır olsa da (ör. tek bir elle girilmiş satır veya PFD çıktı taslakları) eksik hata modları eklenir:
 * alan kütüphanesinin tüm modları + her adım için genel modlar (atlama, yanlış parça / revizyon, elleçleme hasarı).
 */
export function genPfmea(g: Gen, stepIds?: string[]) {
  for (const step of g.p.processSteps) {
    if (stepIds && !stepIds.includes(step.id)) continue;
    if (!step.name?.trim()) continue;
    const before = new Set(g.p.pfmea.map((r) => r.id));
    const have = g.p.pfmea.filter((r) => r.stepId === step.id).map((r) => r.failureMode);
    const fresh = (t: FailureTemplate) => !covered(have, t.failureMode, t.skipIf) && (have.push(t.failureMode), true);
    const area = stepArea(g.p, step);
    // 4.4.0: adımın PFD çıktısı (hata modu = çıktının karşılanmaması) ve aynı 4M kategorisindeki girdiler (neden) bağlanır.
    const io = g.p.pfdItems.filter((x) => x.stepId === step.id && x.text.trim());
    const out = io.find((x) => x.kind === 'Output');
    const links = (t: FailureTemplate): Partial<PfmeaRow> => ({
      ...(out ? { outputId: out.id } : {}),
      causeInputIds: io.filter((x) => x.kind === 'Input' && x.cat4M && x.cat4M === t.cause4M).map((x) => x.id),
    });
    // 4.8.0: bir hata modunun ana nedenine ek olası nedenleri (4M) ayrı satır olarak eklenir.
    const addWithCauses = (t: FailureTemplate, src: string) => {
      g.add('pfmea', { ...pfRow(step, t, src), ...links(t) } as Partial<AnyRow>);
      for (const a of PFMEA_ALT_CAUSES[t.failureMode] ?? []) {
        const alt: FailureTemplate = { ...t, cause: a.cause, cause4M: a.cause4M, rootCause: a.rootCause, prevention: a.prevention, errorProofing: a.errorProofing ?? '', o: a.o ?? t.o };
        g.add('pfmea', { ...pfRow(step, alt, `${src} · ek neden`), ...links(alt) } as Partial<AnyRow>);
      }
    };
    // Aynı hata modu adımda zaten varsa (4.7.0 veya elle) yalnız henüz karşılanmayan ek nedenler eklenir.
    const addMissingCauses = (t: FailureTemplate, src: string) => {
      const same = g.p.pfmea.filter((r) => r.stepId === step.id && norm(r.failureMode) === norm(t.failureMode));
      if (!same.length) return;
      for (const a of PFMEA_ALT_CAUSES[t.failureMode] ?? []) {
        if (same.some((r) => norm(r.cause) === norm(a.cause) || similarity(r.cause, a.cause) >= SAME_MODE)) continue;
        const alt: FailureTemplate = { ...t, cause: a.cause, cause4M: a.cause4M, rootCause: a.rootCause, prevention: a.prevention, errorProofing: a.errorProofing ?? '', o: a.o ?? t.o };
        g.add('pfmea', { ...pfRow(step, alt, `${src} · ek neden`), ...links(alt) } as Partial<AnyRow>);
        same.push(g.p.pfmea[g.p.pfmea.length - 1]);
      }
    };
    const lib = PFMEA_LIB[area] ?? PFMEA_LIB.Generic;
    const handled = (t: FailureTemplate, src: string) => (fresh(t) ? addWithCauses(t, src) : addMissingCauses(t, src));
    for (const t of lib) handled(t, `${step.id} · PFMEA hata kütüphanesi (${area})`);
    for (const t of PFMEA_STEP_COMMON) handled(t, `${step.id} · PFMEA hata kütüphanesi (genel adım hata modları)`);
    // Özel proses parametreleri: her parametre için alt/üst limit dışı hata modları; parametre satırına bağlanır.
    for (const prm of g.p.processParams.filter((x) => x.stepId === step.id) as ProcessParamRow[]) {
      if (prm.pfIds.length) continue; // parametrenin hata modları zaten bağlı
      const ids = paramTemplates(prm.parameter || prm.id, prm.productCharacteristic, prm.prevention, prm.monitoring).filter(fresh).map((t) =>
        g.add('pfmea', { ...pfRow(step, t, `${step.id}, ${prm.id} · özel proses parametresi${prm.lsl != null || prm.usl != null ? ` (${prm.lsl ?? '–'}…${prm.usl ?? '–'} ${prm.unit})` : ' (limit VERİ YOK)'}`), ...links(t) } as Partial<AnyRow>),
      );
      if (ids.length) g.set('processParams', prm.id, 'pfIds', [...prm.pfIds, ...ids]);
    }
    // Boş kalan alanlar (proses fonksiyonu, gereksinimler, bağlı DFMEA, ölçüm, reaksiyon ...) ilişkili veriden.
    // Yalnız bu çalıştırmada eklenen satırlar; mevcut satırların boşları 'fill' aşamasında tamamlanır.
    for (const r of g.p.pfmea.filter((x) => x.stepId === step.id && !before.has(x.id))) g.fill(r, pfmeaFillValues(g.p, r));
  }
}

// ───────────────────────── Zincir ─────────────────────────

/** fill: mevcut DFMEA/PFMEA satırlarının boş alanlarını da doldurur. */
export type GenStage = 'requirements' | 'structure' | 'dfmea' | 'pfmea' | 'fill';

/** Seçilen aşamaları sırayla çalıştırır; her aşama bir öncekinin ürettiği satırları kullanır. */
export function generate(p: Project, stages: GenStage[], opts: { docIds?: string[]; reqIds?: string[]; fnIds?: string[]; stepIds?: string[] } = {}): Gen {
  const g = new Gen(p);
  if (stages.includes('requirements')) genRequirements(g, opts.docIds);
  if (stages.includes('structure')) genStructure(g, stages.includes('requirements') ? undefined : opts.reqIds);
  if (stages.includes('dfmea')) genDfmea(g, stages.includes('structure') ? undefined : opts.fnIds);
  if (stages.includes('pfmea')) genPfmea(g, opts.stepIds);
  if (stages.includes('fill')) {
    // Bu çalıştırmada eklenenler zaten dolu; önceden var olan satırların boşları tamamlanır.
    const before = new Set([...p.dfmea, ...p.pfmea].map((r) => r.id));
    const n = g.edits.length;
    for (const t of ['dfmea', 'pfmea'] as const)
      for (const e of fillBlanksEdits(g.p, t).filter((x) => before.has(x.id))) g.set(t, e.id, e.field, e.value);
    const filled = new Set(g.edits.slice(n).map((e) => (e as { id: string }).id)).size;
    if (filled) g.counts.filled = filled;
  }
  return g;
}

export const STAGE_LABEL: Record<string, string> = { requirements: 'gereksinim', evidence: 'kanıt', structure: 'yapı/fonksiyon', dfmea: 'DFMEA', pfmea: 'PFMEA', filled: 'satırda boş alan tamamlama' };

export function countText(g: Gen): string {
  return Object.entries(g.counts).map(([t, n]) => `${n} ${STAGE_LABEL[t] ?? t}`).join(', ');
}

