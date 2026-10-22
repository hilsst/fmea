// DFMEA / PFMEA satırlarındaki boş alanları ilişkili veriden (yapı ağacı, gereksinim, proses adımı,
// proses parametresi, bağlı DFMEA) doldurur. Dolu alanlara dokunulmaz. Karar niteliğindeki alanlar
// (S 9–10 kararı, önerilen aksiyon) "AI ÖNERİSİ" olarak gelir; onay mühendistedir.
import { DEFAULT_REACTION } from './engine';
import { pfmeaAreaOf } from './failureLib';
import { NO_DATA } from './reqAutofill';
import { needsAction } from './risk';
import { AI_REC, rowRpn, rpnActionText } from './rpnAction';
import type { DfmeaRow, PfmeaRow, ProcessStepRow, Project, RequirementRow, StructureRow } from './types';

export const DECISION_NOTE = 'AI ÖNERİSİ – mühendis kararı gerekli';

const empty = (v: unknown) => v == null || v === '' || (Array.isArray(v) && v.length === 0);
const clean = (s: string) => s.replace(/\s*\(AI ÖNERİSİ[^)]*\)/g, '').trim();

/** Sadece boş alanlar için değer döndürür. */
const isNoData = (v: unknown) => typeof v === 'string' && v.startsWith(NO_DATA);

function onlyEmpty<T extends object>(row: T, vals: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(vals)) {
    const cur = (row as Record<string, unknown>)[k];
    // "VERİ YOK" yer tutucusu gerçek veri bulununca değiştirilir; elle yazılmış değerlere dokunulmaz.
    if (!empty(v) && (empty(cur) || (isNoData(cur) && !isNoData(v)))) out[k] = v;
  }
  return out;
}

// ───────────────────────── DFMEA ─────────────────────────

const RISK_CAT: Record<string, string[]> = {
  Dimensional: ['Manufacturability'], Material: ['Durability', 'Performance'], Performance: ['Performance'], Structural: ['Durability', 'Service life'],
  Environmental: ['Durability'], Reliability: ['Reliability', 'Service life'], Interface: ['Maintainability', 'Manufacturability'], Safety: ['Performance'],
  Regulatory: ['Performance'], Manufacturing: ['Manufacturability', 'Cost'], Process: ['Manufacturability', 'Cost'], Inspection: ['Testability'], Functional: ['Performance'],
};
const NOISE: Record<string, string[]> = {
  Dimensional: ['Piece-to-piece'], Material: ['Piece-to-piece', 'Deterioration'], Environmental: ['Environment'], Reliability: ['Deterioration', 'Customer usage'],
  Structural: ['Deterioration', 'Customer usage'], Interface: ['Other systems'], Performance: ['Environment', 'Deterioration'],
};

function chain(p: Project, fn: StructureRow | undefined): StructureRow[] {
  const out: StructureRow[] = [];
  let cur = fn;
  for (let i = 0; cur && i < 12; i++) {
    out.unshift(cur);
    const parentId: string = cur.parentId;
    cur = parentId ? p.structure.find((s) => s.id === parentId) : undefined;
  }
  return out;
}

export function dfmeaFillValues(p: Project, r: DfmeaRow): Record<string, unknown> {
  const fn = p.structure.find((s) => s.id === r.functionId);
  const path = chain(p, fn);
  const reqs = r.reqIds.map((id) => p.requirements.find((x) => x.id === id)).filter(Boolean) as RequirementRow[];
  const type = reqs.find((x) => x.reqType === 'Safety' || x.reqType === 'Regulatory')?.reqType ?? reqs[0]?.reqType ?? 'Functional';
  const el = fn?.element || r.component || '';
  const parent = path.length > 1 ? path[path.length - 2] : undefined;
  const ver = reqs.map((x) => x.verification).find((v) => v && !v.includes(NO_DATA));
  const vals: Record<string, unknown> = {
    system: path[0]?.element ?? '',
    subsystem: path.length > 2 ? path[1].element : '',
    component: el,
    localEffect: el && r.failureMode ? `${el} fonksiyonunu yerine getiremez` : '',
    higherEffect: parent?.element ? `${parent.element} seviyesinde fonksiyon / performans etkilenir` : '',
    verification: ver ? clean(ver) : r.detection,
    riskCategory: RISK_CAT[type] ?? ['Performance'],
    noiseFactor: NOISE[type] ?? ['Piece-to-piece'],
    specialChar: type === 'Safety' ? 'Safety' : type === 'Regulatory' ? 'Regulatory' : '',
  };
  Object.assign(vals, decisionValues(p, { ...r, ...onlyEmpty(r, vals) } as DfmeaRow, false));
  return onlyEmpty(r, vals);
}

// ───────────────────────── PFMEA ─────────────────────────

const PROCESS_FUNCTION: Record<string, string> = {
  Material: 'Malzemeyi spesifikasyona uygun kabul etmek, tanımlamak ve koşullarına uygun depolamak',
  'Lay-up': 'Plyleri doğru malzeme, sıra ve oryantasyonla kalıba sermek',
  'Vacuum Bagging': 'Parçayı kür için sızdırmaz şekilde torbalamak',
  Cure: 'Parçayı onaylı kür çevrimiyle (sıcaklık / basınç / vakum / süre) kürlemek',
  Bonding: 'Parçaları onaylı yapıştırıcı ve bondline kalınlığıyla birleştirmek',
  Demolding: 'Parçayı hasarsız şekilde kalıptan çıkarmak',
  Machining: 'Kenar ve delikleri çizim ölçülerine göre işlemek',
  Painting: 'Kaplamayı spesifikasyondaki kalınlık ve yapışma ile uygulamak',
  'Surface Treatment': 'Yüzeyi yapıştırma / kaplama için hazırlamak',
  NDT: 'İç hataları onaylı NDT yöntemiyle tespit etmek',
  Inspection: 'Ürün karakteristiklerini doğrulamak ve uygunsuz ürünü ayırmak',
  Assembly: 'Parçaları doğru bağlantı elemanı ve torkla monte etmek',
  Packaging: 'Parçayı hasarsız sevk edilecek şekilde ambalajlamak',
};

/** Alanla ilişkili gereksinimleri bulmak için anahtar kelimeler. */
const AREA_WORDS: Record<string, RegExp> = {
  Material: /malzeme|prepreg|reçine|resin|material|lot|raf ömrü/i,
  'Lay-up': /ply|kat sayısı|oryantasyon|laminat|kalınl|thickness/i,
  'Vacuum Bagging': /vakum|vacuum|porozite|porosity/i,
  Cure: /kür|cure|tg\b|otoklav|autoclave/i,
  Bonding: /bond|yapıştır|insert|adhesive/i,
  Machining: /delik|hole|Ø|⌀|çap|kenar|trim|edge/i,
  Painting: /boya|kaplama|coat|paint|film/i,
  'Surface Treatment': /yüzey|surface|zımpara/i,
  NDT: /ndt|porozite|porosity|delaminasyon|void|ultrason|disbond/i,
  Inspection: /ölçü|boyut|kalınl|Ø|çap|dimension/i,
  Assembly: /montaj|tork|torque|bağlantı|fastener/i,
  Packaging: /ambalaj|packag/i,
};
const PROCESS_REQ = new Set(['Manufacturing', 'Process', 'Inspection']);

const ELEMENT_4M: Record<string, string> = { Man: 'Operatör', Material: 'Malzeme', Method: 'İş talimatı / yöntem', Measurement: 'Ölçüm sistemi', Environment: 'Ortam (sıcaklık / nem / temizlik)' };

function reqText(r: RequirementRow) {
  return `${r.id}: ${r.text}${r.acceptance && !r.acceptance.includes(NO_DATA) && !r.text.includes(r.acceptance) ? ` (kabul: ${r.acceptance})` : ''}`;
}

/** Adımla ilişkili gereksinimler: adım metni / ürün karakteristikleri veya alan anahtar kelimeleriyle eşleşenler. */
export function stepRequirements(p: Project, step: ProcessStepRow): RequirementRow[] {
  const area = pfmeaAreaOf(`${step.name} ${step.description}`);
  const re = AREA_WORDS[area];
  const chars = `${step.productChars} ${step.processChars}`.toLocaleLowerCase('tr');
  return p.requirements.filter((r) => {
    if (r.approval === 'Rejected') return false;
    const t = `${r.text} ${r.characteristic}`;
    return (re && re.test(t)) || (!!r.characteristic && chars.includes(r.characteristic.toLocaleLowerCase('tr')));
  });
}

export function pfmeaFillValues(p: Project, r: PfmeaRow): Record<string, unknown> {
  const step = p.processSteps.find((s) => s.id === r.stepId);
  if (!step) return onlyEmpty(r, { reactionPlan: DEFAULT_REACTION, measurement: r.detection });
  const area = pfmeaAreaOf(`${step.name} ${step.description}`);
  const reqs = stepRequirements(p, step);
  const product = reqs.filter((x) => !PROCESS_REQ.has(x.reqType));
  const params = p.processParams.filter((x) => x.stepId === step.id);
  const prm = params.find((x) => x.pfIds.includes(r.id));
  const procReq = [
    ...(prm ? [prm] : params).map((x) => `${x.parameter}: ${x.lsl != null || x.usl != null ? `${x.lsl ?? '–'}…${x.usl ?? '–'} ${x.unit}`.trim() : NO_DATA}`),
    ...reqs.filter((x) => PROCESS_REQ.has(x.reqType)).map(reqText),
  ];
  const dfIds = p.dfmea.filter((d) => d.reqIds.some((id) => product.some((x) => x.id === id))).map((d) => d.id).slice(0, 6);
  // Ürün gereksinimi: adımla eşleşen gereksinimler → bağlı DFMEA gereksinimi → adımın ürün karakteristikleri → VERİ YOK.
  const linkedDf = (r.dfIds?.length ? r.dfIds : dfIds).map((id) => p.dfmea.find((d) => d.id === id)).filter((d): d is DfmeaRow => !!d?.requirement?.trim());
  const vals: Record<string, unknown> = {
    processFunction: PROCESS_FUNCTION[area] ?? (step.description || `${step.name} operasyonunu iş talimatına göre gerçekleştirmek`),
    productRequirement: product.length
      ? product.map(reqText).join('; ')
      : linkedDf.length
        ? [...new Set(linkedDf.map((d) => d.requirement.trim()))].join('; ')
        : step.productChars || `${NO_DATA} (bu adıma bağlı ürün gereksinimi bulunamadı; Gereksinimler veya Proses Akışı ürün karakteristiği)`,
    processRequirement: procReq.length
      ? procReq.join('; ')
      : step.processChars || `${NO_DATA} (proses parametresi / iş talimatı gereksinimi yok; Proses Parametreleri ekranında girin)`,
    dfIds,
    reqIds: reqs.map((x) => x.id),
    processElement: r.cause4M === 'Machine' ? step.machine || 'Ekipman' : ELEMENT_4M[r.cause4M] ?? '',
    why1: r.cause,
    measurement: r.detection,
    reactionPlan: DEFAULT_REACTION,
    specialChar: step.specialProcess ? 'Process' : '',
  };
  Object.assign(vals, decisionValues(p, { ...r, ...onlyEmpty(r, vals) } as PfmeaRow, true));
  return onlyEmpty(r, vals);
}

// ───────────────────────── Karar önerileri ─────────────────────────

function decisionValues(p: Project, r: DfmeaRow | PfmeaRow, pf: boolean): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const s = r.s ?? 0;
  if (s >= 9) {
    const ep = (r as PfmeaRow).errorProofing;
    out.sDisposition = pf ? (ep && !ep.startsWith('None') ? 'Error-proofing prevention' : 'Process KC assigned') : 'Design change planned';
    out.sDispositionReason = DECISION_NOTE;
  }
  // 4.4.0: öneri satırın neden / kontrol bilgisinden türetilir (rpnAction.ts); puanlar eksikse genel öneri.
  if (s >= 9 || needsAction(p, r).need)
    out.recommendedAction = rowRpn(r) != null
      ? rpnActionText(p, r, pf)
      : pf
        ? `Hata önleme (poka-yoke / otomatik izleme) ekle; tespit: ${r.detection || 'yöntem belirlenmeli'} (${AI_REC})`
        : `Önleme kontrolünü güçlendir (tasarım değişikliği / analiz) ve doğrulama testini planla (${AI_REC})`;
  return out;
}

/** Tablodaki (veya seçili) satırların boş alanları için set düzenlemeleri. */
export function fillBlanksEdits(p: Project, table: 'dfmea' | 'pfmea', ids?: string[]) {
  const rows = (table === 'dfmea' ? p.dfmea : p.pfmea).filter((r) => !ids?.length || ids.includes(r.id));
  return rows.flatMap((r) => {
    const v = table === 'dfmea' ? dfmeaFillValues(p, r as DfmeaRow) : pfmeaFillValues(p, r as PfmeaRow);
    return Object.entries(v).map(([field, value]) => ({ kind: 'set' as const, table, id: r.id, field, value }));
  });
}
