// Kural tabanlı öneri motoru: doküman → gereksinim → yapı/fonksiyon → DFMEA → PFMEA.
// Üretilen her satır "AI Proposed" eklenir; ekleme öncesi onay penceresi tüm satırları listeler.
// Kaynakta olmayan değer uydurulmaz (VERİ YOK); kütüphane içeriği ENGINEERING KNOWLEDGE olarak işaretlenir.
import { findRequirementCandidates, locText } from './docmodel';
import { DFMEA_LIB, PFMEA_LIB, paramTemplates, pfmeaAreaOf, type FailureTemplate } from './failureLib';
import { blankRow, nextId } from './model';
import { NO_DATA, characteristicOf, reqAutoValues } from './reqAutofill';
import type { AnyRow, PfmeaRow, ProcessParamRow, ProcessStepRow, Project, RequirementRow, StructureRow, TableKey } from './types';

export type GenEdit = { kind: 'add'; table: TableKey; row: AnyRow } | { kind: 'set'; table: TableKey; id: string; field: string; value: unknown };

export const ASSUMPTION = 'AI VARSAYIMI – mühendislik doğrulaması gerekli';
const LIB_REASON = 'Hata kütüphanesi başlangıç değeri – kriter tablosuna göre doğrulayın (AI VARSAYIMI)';

/** Satır ekleyen ve eklenenleri kendi proje kopyasında tutan yardımcı (sonraki adımlar yeni satırları görür). */
export class Gen {
  edits: GenEdit[] = [];
  counts: Partial<Record<TableKey, number>> = {};
  constructor(public p: Project) {}
  add(table: TableKey, data: Partial<AnyRow>): string {
    const id = nextId(this.p, table);
    const row = { ...blankRow(table, id), ...data, id } as AnyRow;
    this.p = { ...this.p, [table]: [...(this.p[table] as AnyRow[]), row] };
    this.edits.push({ kind: 'add', table, row });
    this.counts[table] = (this.counts[table] ?? 0) + 1;
    return id;
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
    .replace(/\b\d+\s*[xX]\s+/g, '')
    .replace(/°\s*[CF]\b/g, ' ')
    .replace(/[Ø⌀±≥≤<>]/g, ' ')
    .replace(/[-+]?\d+(?:[.,]\d+)?(?:\s*\/\s*[-+]?\d+(?:[.,]\d+)?)*/g, ' ')
    .replace(/\b(mm|µm|um|cm|inch|in|°C|°F|deg|kg|g|min|dk|h|s|MPa|GPa|kPa|bar|psi|Pa|N|Nm|%|Ra)\b/gi, ' ')
    .replace(/°|\bmin\.|\bmaks\.|\bmax\.|\ben az\b|\ben fazla\b/gi, ' ')
    .replace(/\b(olmalıdır|olmalı|edilmelidir|yapılmalıdır|gereklidir|zorunludur|uygulanmalıdır|sağlamalıdır|aşmamalıdır|tutulmalıdır|shall|must|be)\b/gi, ' ')
    .replace(/[–\-:;,/()]+/g, ' ')
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

/** DFMEA satırı olmayan fonksiyonlar için hata kütüphanesinden satır önerir. */
export function genDfmea(g: Gen, fnIds?: string[]) {
  for (const fn of g.p.structure) {
    if (!fn.function?.trim() || fn.approval === 'Rejected' || (fnIds && !fnIds.includes(fn.id))) continue;
    if (g.p.dfmea.some((d) => d.functionId === fn.id)) continue;
    const reqs = fn.reqIds.map((id) => g.p.requirements.find((r) => r.id === id)).filter(Boolean) as RequirementRow[];
    const type = reqs.find((r) => r.reqType === 'Safety' || r.reqType === 'Regulatory')?.reqType ?? reqs[0]?.reqType ?? '';
    const lib = DFMEA_LIB[type] ?? DFMEA_LIB.Functional;
    const x = reqs[0]?.characteristic || fn.element || fn.id;
    const verification = reqs.map((r) => r.verification).find((v) => v && !v.includes(NO_DATA));
    for (const t of lib) {
      g.add('dfmea', {
        functionId: fn.id,
        function: fn.function,
        reqIds: [...fn.reqIds],
        failureMode: fill(t.failureMode, x),
        effect: t.effect,
        cause: t.cause,
        prevention: t.prevention,
        detection: verification ? `${t.detection}; ${verification}` : t.detection,
        ...scoreFields(t),
        source: `${fn.id}${fn.reqIds.length ? ', ' + fn.reqIds.join(', ') : ''} · DFMEA hata kütüphanesi (${type || 'Functional'})`,
        confidence: 'Low',
        basis: 'ENGINEERING KNOWLEDGE',
        dataStatus: ASSUMPTION,
        approval: 'AI Proposed',
        origin: 'template',
      } as Partial<AnyRow>);
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

/** PFMEA satırı olmayan proses adımları için kütüphane ve özel proses parametrelerinden satır önerir. */
export function genPfmea(g: Gen, stepIds?: string[]) {
  for (const step of g.p.processSteps) {
    if (stepIds && !stepIds.includes(step.id)) continue;
    if (g.p.pfmea.some((r) => r.stepId === step.id)) continue;
    const area = pfmeaAreaOf(`${step.name} ${step.description}`);
    for (const t of PFMEA_LIB[area] ?? PFMEA_LIB.Generic) g.add('pfmea', pfRow(step, t, `${step.id} · PFMEA hata kütüphanesi (${area})`) as Partial<AnyRow>);
    // Özel proses parametreleri: her parametre için alt/üst limit dışı hata modları; parametre satırına bağlanır.
    for (const prm of g.p.processParams.filter((x) => x.stepId === step.id) as ProcessParamRow[]) {
      const ids = paramTemplates(prm.parameter || prm.id, prm.productCharacteristic, prm.prevention, prm.monitoring).map((t) =>
        g.add('pfmea', pfRow(step, t, `${step.id}, ${prm.id} · özel proses parametresi${prm.lsl != null || prm.usl != null ? ` (${prm.lsl ?? '–'}…${prm.usl ?? '–'} ${prm.unit})` : ' (limit VERİ YOK)'}`) as Partial<AnyRow>),
      );
      g.set('processParams', prm.id, 'pfIds', [...prm.pfIds, ...ids]);
    }
  }
}

// ───────────────────────── Zincir ─────────────────────────

export type GenStage = 'requirements' | 'structure' | 'dfmea' | 'pfmea';

/** Seçilen aşamaları sırayla çalıştırır; her aşama bir öncekinin ürettiği satırları kullanır. */
export function generate(p: Project, stages: GenStage[], opts: { docIds?: string[]; reqIds?: string[]; fnIds?: string[]; stepIds?: string[] } = {}): Gen {
  const g = new Gen(p);
  if (stages.includes('requirements')) genRequirements(g, opts.docIds);
  if (stages.includes('structure')) genStructure(g, stages.includes('requirements') ? undefined : opts.reqIds);
  if (stages.includes('dfmea')) genDfmea(g, stages.includes('structure') ? undefined : opts.fnIds);
  if (stages.includes('pfmea')) genPfmea(g, opts.stepIds);
  return g;
}

export const STAGE_LABEL: Record<string, string> = { requirements: 'gereksinim', evidence: 'kanıt', structure: 'yapı/fonksiyon', dfmea: 'DFMEA', pfmea: 'PFMEA' };

export function countText(g: Gen): string {
  return Object.entries(g.counts).map(([t, n]) => `${n} ${STAGE_LABEL[t] ?? t}`).join(', ');
}

