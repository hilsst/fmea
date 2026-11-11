// v4-risk: FMEA yöntemi ve risk mantığı (IAQG SCMH).
// Tek "aksiyon gerekli" yüklemi (needsAction): SCMH modunda AIAG-VDA AP kullanılmaz. Rozetler, kalite kontrolleri,
// "Neyi kaçırdım?" ve Quality Score aynı yüklemi kullanır. Kaynaklar:
//  - SCMH 7.2.3 (Aerospace APQP/PPAP Manual Rev B) p33/p61: yöntem S/O/D + RPN; p59: "prioritized based on Severity
//    Occurrence (SO), Severity Detection (SD) and Risk Priority Numbers (RPN)… Special attention is given to high
//    Severity rankings"; adım 12: "re-rank … based on evidence of the effectiveness of the actions".
//  - Webinar Q&A (22-JAN-2019) Q21: "the design should be modified to reduce the severity, regardless of the RPN".
//  - DFMEA Guidance O19: RPN eşiği karar kriteri olarak kullanılmaz → burada sabit eşik yoktur; "Top-N" ekip kararıdır.
//  - SCMH 7.2.19 DFMEA Examples: "None (deemed ALARP)", öngörülen / gerçekleşen sonuçlar, (n) puanları.
//  - Control Plan webinar (12 Nov 2019) p29–p33, p43; CP Q&A Q17/Q19/Q24/Q31; PF/PFMEA webinar (22 Oct 2019) p8–p31.
// Bulgular mühendis değerlendirmesi içindir; hiçbir kural kaydı onaylamaz veya değeri kendisi uydurmaz.
import type { CheckResult } from './checks';
import type { MissItem } from './quality';
import type { Finding } from './semantic';
import { apOf, riskLevel, type RiskLevel } from './scoring';
import { isScmh, scmhPriority, scmhSortBy, SCMH_PRIORITY, type ScmhMeasure } from './scmhScoring';
import { splitRequirement } from './riskModel';
import { rpnOver } from './rpnAction';
import { isInactive } from './kcScmh'; // v4-kc
import { dfRowsOfKc, pfRowsOfKc } from './kcTrace'; // v4-kc
import type { ActionRow, ControlPlanRow, DfmeaRow, PfmeaRow, ProcessStepRow, Project, Score } from './types';

export const VY = 'VERİ YOK – doğrulanmalı';
const has = (s: unknown) => typeof s === 'string' && s.trim() !== '' && !/^VERİ YOK/i.test(s.trim());
const valid = (v: Score): v is number => typeof v === 'number' && v >= 1 && v <= 10;
const opNum = (op: string) => {
  const n = parseFloat(String(op ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

type Fmea = DfmeaRow | PfmeaRow;
const isPf = (r: Fmea): r is PfmeaRow => 'stepId' in r;

// ------------------------------------------------------------------ listeler
export const RISK_LISTS = {
  riskDecision: ['Action required', 'No action – ALARP', 'No action – accepted'],
  resultBasis: ['Projected', 'Actual'],
  sDispositionDf: ['Design change planned', 'Severity cannot be reduced – KC/CI assigned', 'Accepted with rationale'],
  sDispositionPf: ['Design change requested (DFMEA)', 'Error-proofing prevention', 'Process KC assigned', 'Accepted with rationale'],
  /** AS9145 §4.4.4 (DRA webinar slide 14): performance, durability, service life, reliability, manufacturability,
   * maintainability, cost. Test/inceleme zorluğu DRA webinar slide 39'dan ("producibility, repair or test difficulty"). */
  riskCategory: ['Performance', 'Durability', 'Service life', 'Reliability', 'Manufacturability', 'Maintainability', 'Cost', 'Testability'],
  /** P-diagram gürültü faktörleri (DRA webinar slide 23). */
  noiseFactor: ['Piece-to-piece', 'Other systems', 'Customer usage', 'Deterioration', 'Environment'],
  cpDecision: ['In CP', 'Not required'],
  /** CP webinar p28 (kontrol metodu örnekleri), p29 (hata önleme), CP Q&A Q6–Q8 (bakım, yazılım). */
  controlKind: ['Error proofing', 'SPC', 'Inspection', 'First piece', 'Audit', 'Checklist', 'Maintenance', 'Software configuration', 'Other'],
  pfdItemKind: ['Input', 'Output'],
};
/** 9145 §4.4.4 kategorileri ("Neyi kaçırdım?" kapsam kontrolü bunları arar). */
export const AS9145_CATEGORIES = RISK_LISTS.riskCategory.slice(0, 7);

// ------------------------------------------------------------------ yardımcılar
export function actionOf(p: Pick<Project, 'actions'>, row: { id: string; actionId: string }): ActionRow | undefined {
  return p.actions.find((a) => (row.actionId && a.id === row.actionId) || a.sourceId === row.id);
}

/** Satıra bağlı (reddedilmemiş) KC'ler: doğrudan kaynak veya (PFMEA için) bağlı DFMEA satırlarının KC'leri. */
export function linkedKcIds(p: Pick<Project, 'kcs'>, row: Fmea): string[] {
  // v4-kc: KC/CI akışı (kaynak, ek bağlantı, REQ- kaynaklı müşteri KC'si, dfIds) – elenen KC "atanmış" sayılmaz
  const full = p as Pick<Project, 'kcs'> & Partial<Project>;
  if (full.dfmea && full.pfmea) return p.kcs.filter((k) => !isInactive(k) && (isPf(row) ? pfRowsOfKc(full, k) : dfRowsOfKc(full, k)).some((r) => r.id === row.id)).map((k) => k.id);
  const src = new Set([row.id, ...(isPf(row) ? row.dfIds : [])]);
  return p.kcs.filter((k) => src.has(k.sourceId) && k.status !== 'Rejected').map((k) => k.id);
}

export const isNoAction = (r: Pick<Fmea, 'riskDecision'>) => (r.riskDecision ?? '').startsWith('No action');
const reranked = (r: Pick<Fmea, 'newS' | 'newO' | 'newD'>) => r.newS != null || r.newO != null || r.newD != null;

// ------------------------------------------------------------------ öncelik / needsAction
export interface NeedInfo {
  need: boolean;
  /** 'S≥9', 'Top-RPN', 'Top-S×O', 'Top-S×D', 'KC/CI', 'AP=H' */
  reasons: string[];
}

const bandCache = new WeakMap<object, { sig: string; m: Map<string, string[]> }>();
/** SCMH "Top-N" inceleme listesi (settings.scmhReviewTopN; boşsa liste yoktur). */
function topBands(p: Project): Map<string, string[]> {
  const n = p.settings.scmhReviewTopN;
  if (!(typeof n === 'number' && n > 0)) return new Map();
  const rows = [...p.dfmea, ...p.pfmea].filter((r) => valid(r.s));
  // Proje nesnesi planlama sırasında yerinde değişebildiği için önbellek imzası puanlardan üretilir.
  const sig = `${n}|${rows.map((r) => `${r.id}:${r.s},${r.o},${r.d}`).join(';')}`;
  const hit = bandCache.get(p);
  if (hit && hit.sig === sig) return hit.m;
  const m = new Map<string, string[]>();
  const labels: Record<ScmhMeasure, string> = { rpn: 'Top-RPN', so: 'Top-S×O', sd: 'Top-S×D' };
  for (const meas of ['rpn', 'so', 'sd'] as ScmhMeasure[])
    for (const r of scmhSortBy(rows, meas).filter((r) => scmhPriority(r)[meas] != null).slice(0, n)) m.set(r.id, [...(m.get(r.id) ?? []), labels[meas]]);
  bandCache.set(p, { sig, m });
  return m;
}

/**
 * Tek yüklem. SCMH: S≥9 (RPN'den bağımsız), ekibin Top-N inceleme listesi (RPN / S×O / S×D) veya KC/CI bağlantısı.
 * AIAG-VDA: AP = H.
 */
export function needsAction(p: Project, row: Fmea): NeedInfo {
  // 4.4.0: RPN eşiği ek tetiktir; S≥9 / Top-N / KC (SCMH) veya AP=H tek başına yine aksiyon gerektirir.
  const rpnReason = rpnOver(p, row) ? [`RPN≥${p.settings.rpnThreshold}`] : [];
  if (!isScmh(p)) {
    const h = apOf(p, row.s, row.o, row.d) === 'H';
    const reasons = [...(h ? ['AP=H'] : []), ...rpnReason];
    return { need: reasons.length > 0, reasons };
  }
  const reasons: string[] = [];
  if (valid(row.s) && row.s >= SCMH_PRIORITY.reviewSeverity) reasons.push('S≥9');
  reasons.push(...(topBands(p).get(row.id) ?? []));
  if (linkedKcIds(p, row).length) reasons.push('KC/CI');
  reasons.push(...rpnReason);
  return { need: reasons.length > 0, reasons };
}

/** Rozet metni: SCMH'de "SCMH: S≥9 review / Top-RPN …", AIAG-VDA'da "AP=H". */
export function needLabel(p: Project, row: Fmea): string {
  const n = needsAction(p, row);
  if (!n.need) return '';
  if (!isScmh(p)) return n.reasons.join(' / ');
  return 'SCMH: ' + n.reasons.map((r) => (r === 'S≥9' ? 'S≥9 review' : r)).join(' / ');
}

/** Satır için aksiyon veya belgelenmiş karar var mı? */
export function actionAddressed(row: Fmea): boolean {
  if (has(row.recommendedAction)) return true;
  return isNoAction(row) && has(row.riskDecisionReason);
}

/** Satır rengi / risk seviyesi. SCMH'de AP kullanılmaz. */
export function riskLevelOf(p: Project, row: Fmea): RiskLevel {
  if (!isScmh(p)) return riskLevel(row, p.settings, p.scoring.apTable);
  if (!valid(row.s)) return '';
  if (row.specialChar === 'Safety' || row.specialChar === 'Regulatory' || row.s >= SCMH_PRIORITY.reviewSeverity) return 'CRITICAL';
  if (needsAction(p, row).need) return 'HIGH';
  if (row.s >= p.settings.highSeverityThreshold) return 'MEDIUM';
  return valid(row.o) && valid(row.d) ? 'LOW' : '';
}

// ------------------------------------------------------------------ sonuç dayanağı (öngörülen / gerçekleşen)
/** Elle seçilmemişse: bağlı aksiyon Completed + tamamlanma tarihi → Actual; yeni puan varsa Projected. */
export function effectiveBasis(p: Pick<Project, 'actions'>, row: Fmea): '' | 'Projected' | 'Actual' {
  if (row.resultBasis) return row.resultBasis;
  const a = actionOf(p, row);
  if (a && a.status === 'Completed' && has(a.completionDate)) return 'Actual';
  return reranked(row) || has(row.actionTaken) ? 'Projected' : '';
}

/** Yeniden puanlama için etkinlik kanıtı (7.2.3 adım 12): aksiyon Completed + doğrulama metni + kanıt kaydı. */
export function rerankEvidenceGap(p: Pick<Project, 'actions'>, row: Fmea): string {
  const a = actionOf(p, row);
  const miss: string[] = [];
  if (!a || a.status !== 'Completed') miss.push('aksiyon tamamlanmamış');
  if (!a || !has(a.verification)) miss.push('etkinlik doğrulaması yazılmamış');
  if (!a || !(a.evidenceIds?.length)) miss.push('kanıt (EV-xxx) bağlı değil');
  return miss.join(', ');
}

// ------------------------------------------------------------------ S 9–10 kararı
const dispList = (r: Fmea) => (isPf(r) ? RISK_LISTS.sDispositionPf : RISK_LISTS.sDispositionDf);

/** S 9–10 satırının karar sorunu ('' = sorun yok). Yalnızca SCMH modunda zorunludur. */
export function dispositionProblem(p: Project, r: Fmea): string {
  if (!isScmh(p) || !valid(r.s) || r.s < SCMH_PRIORITY.reviewSeverity) return '';
  const d = (r.sDisposition ?? '').trim();
  if (!d) return `S=${r.s}: severity kararı seçilmemiş (${dispList(r).join(' / ')})`;
  if (/Accepted with rationale/.test(d) && !has(r.sDispositionReason)) return 'Kabul kararı gerekçesiz';
  if (/KC/.test(d) && linkedKcIds(p, r).length === 0) return 'KC/CI atandı denilmiş ama satıra bağlı KC yok';
  if (/Design change/.test(d) && !has(r.recommendedAction) && !(actionOf(p, r)?.actionType === 'Design change')) return 'Tasarım değişikliği seçilmiş ama aksiyon tanımlı değil';
  return '';
}

/** Final onay / baseline'ı engelleyen satırlar (S 9–10 kararı eksik veya geçersiz). */
export function riskApprovalBlockers(p: Project): string[] {
  return [...p.dfmea, ...p.pfmea].filter((r) => dispositionProblem(p, r)).map((r) => r.id);
}

// ------------------------------------------------------------------ Kontrol planı kapsamı
const stepOf = (p: Project, id: string) => p.processSteps.find((s) => s.id === id);

/** PFMEA satırı KP'de olmalı mı? (CP webinar p43 "significant risk items … including high severity risks"; CPQA Q17/Q19) */
export function cpRequired(p: Project, r: PfmeaRow): boolean {
  if (!r.failureMode?.trim()) return false;
  return (valid(r.s) && r.s >= SCMH_PRIORITY.reviewSeverity) || linkedKcIds(p, r).length > 0 || r.significantRisk || needsAction(p, r).need;
}

export function cpCoverageGap(p: Project, r: PfmeaRow): boolean {
  if (!cpRequired(p, r)) return false;
  if (p.controlPlan.some((c) => c.pfId === r.id)) return false;
  return !(r.cpDecision === 'Not required' && has(r.cpExclusionReason));
}

const SEGREGATE = /segregat|ayır|karantina|quarantine|izole|hold\b/i;
const CORRECT = /correct|düzelt|rework|yeniden işle|repair|onar|tamir/i;
const CORRECT_EMPTY = /düzeltme (yöntemi|metodu)\s*:\s*VERİ YOK/i;
const CONTACT = /supervisor|amir|şef\b|yönetici|ekip lideri|team lead/i;

/** CP webinar p30: reaksiyon planı MUST: uygunsuz ürünü ayırma, düzeltme yöntemi, amire bildirim. Eksikleri döndürür. */
export function reactionMissing(c: ControlPlanRow): string[] {
  const txt = c.reactionPlan ?? '';
  const out: string[] = [];
  if (!c.reactionSegregate && !SEGREGATE.test(txt)) out.push('uygunsuz ürünü ayırma');
  if (!has(c.reactionCorrection) && !(CORRECT.test(txt.replace(CORRECT_EMPTY, '')))) out.push('düzeltme yöntemi');
  if (!has(c.reactionContact) && !CONTACT.test(txt)) out.push('amire (supervisor) bildirim');
  return out;
}

/** Reaksiyon metni ve sorumlu: SCMH CP O sütunu (şablonda sorumlu sütunu yok). */
export function reactionExportText(c: ControlPlanRow): string {
  const parts = [c.reactionPlan?.trim() || VY];
  const extra = [c.reactionSegregate && !SEGREGATE.test(c.reactionPlan ?? '') ? 'Uygunsuz ürünü ayır' : '', has(c.reactionCorrection) ? `Düzeltme: ${c.reactionCorrection.trim()}` : '', has(c.reactionContact) ? `Bildir: ${c.reactionContact.trim()}` : ''].filter(Boolean);
  if (extra.length) parts.push(extra.join('; '));
  parts.push(`Sorumlu: ${c.responsible?.trim() || VY}`);
  return parts.join('\n');
}

const isEpNone = (s: string) => !s || /^None/i.test(s.trim());
export function needsEpCp(p: Project, r: PfmeaRow): boolean {
  return !isEpNone(r.errorProofing) && cpRequired(p, r) && !p.controlPlan.some((c) => c.pfId === r.id && c.controlKind === 'Error proofing');
}

// ------------------------------------------------------------------ PFD
export function isInspectionStep(st: ProcessStepRow | undefined): boolean {
  if (!st) return false;
  if (st.stepType?.length) return st.stepType.includes('Inspect/Test') && !st.stepType.includes('Operation');
  return /inspect|muayene|kontrol|test/i.test(st.name);
}
const RECEIPT = /incoming|receiv|receipt|giriş|kabul|malzeme alım/i;
const SHIP = /ship|sevk|packag|paket|storage|store|depo/i;

export function sortedSteps(p: Project): ProcessStepRow[] {
  return [...p.processSteps].sort((a, b) => opNum(a.opNo) - opNum(b.opNo) || a.id.localeCompare(b.id));
}

/** PF webinar p8: PFD girişten (malzeme kabul) depolama/sevkiyata kadar; dış operasyonlara gidiş-dönüş; alternatif ve rework. */
export function pfdCompleteness(p: Project): { id: string; message: string }[] {
  const out: { id: string; message: string }[] = [];
  const main = sortedSteps(p).filter((s) => !s.alternateOf);
  if (!main.length) return out;
  const first = main[0];
  const last = main[main.length - 1];
  if (!RECEIPT.test(`${first.name} ${first.description}`)) out.push({ id: first.id, message: 'PFD ilk adımı malzeme kabulü değil (PF webinar p8: “from receipt of materials”)' });
  if (!(SHIP.test(`${last.name} ${last.description}`) || last.stepType?.includes('Store'))) out.push({ id: last.id, message: 'PFD son adımı depolama / sevkiyat değil (PF webinar p8: “through storage and shipment”)' });
  const isMove = (s?: ProcessStepRow) => !!s && (s.stepType?.includes('Move') || /move|taşı|transfer|nakliye|sevk/i.test(s.name));
  main.forEach((s, i) => {
    if (s.external && !(isMove(s) || (isMove(main[i - 1]) && isMove(main[i + 1]))))
      out.push({ id: s.id, message: 'Dış kaynaklı adımın öncesinde ve sonrasında taşıma (Move) adımı yok' });
    if (s.external && !has(s.externalSupplier)) out.push({ id: s.id, message: 'Dış kaynaklı adımın tedarikçisi yazılmamış' });
  });
  for (const s of p.processSteps) {
    if ((s.stepType ?? []).includes('Rework') && !s.returnTo) out.push({ id: s.id, message: 'Rework adımının dönüş adımı (returnTo) yok' });
    if (s.returnTo && !p.processSteps.some((x) => x.id === s.returnTo)) out.push({ id: s.id, message: `Dönüş adımı ${s.returnTo} yok` });
    if (s.alternateOf && !p.processSteps.some((x) => x.id === s.alternateOf)) out.push({ id: s.id, message: `Alternatif olduğu adım ${s.alternateOf} yok` });
  }
  return out;
}

// ------------------------------------------------------------------ DFMEA zinciri
/** Bu satırın hata modu hangi üst seviye DFMEA satırlarının nedeni? */
export function chainParents(p: Pick<Project, 'dfmea'>, id: string): DfmeaRow[] {
  return p.dfmea.filter((d) => d.causeFromIds?.includes(id));
}
export function chainParentText(p: Pick<Project, 'dfmea'>, id: string): string {
  return chainParents(p, id).map((d) => `${d.id}${valid(d.s) ? ` S=${d.s}` : ''}`).join(', ');
}

// ------------------------------------------------------------------ SCMH çıktı yardımcıları
export interface ActionColVals {
  rec: string;
  owner: string;
  due: string;
  taken: string;
  done: string;
  newS: number | null;
  newO: number | null;
  newD: number | null;
}

/** Karar (ALARP / aksiyonsuz) ve öngörülen sonuç işaretini aksiyon sütunlarına uygular (SCMH 7.2.19 Fuel Air satır 20). */
export function decisionCols(p: Project, row: Fmea, a: ActionColVals): ActionColVals {
  if (isNoAction(row) && !has(row.recommendedAction)) {
    const sc = (v: Score) => (typeof v === 'number' ? v : null);
    return { rec: row.riskDecision === 'No action – ALARP' ? 'None (deemed ALARP)' : 'None', owner: 'N/A', due: 'N/A', taken: 'N/A', done: 'N/A', newS: sc(row.s), newO: sc(row.o), newD: sc(row.d) };
  }
  if (effectiveBasis(p, row) === 'Projected' && (a.taken || a.newS != null || a.newO != null || a.newD != null))
    return { ...a, taken: `[Projected] ${a.taken || 'Öngörülen sonuç'}` };
  return a;
}

/** Kontrol / etki metnine puan ekler: "metin (n)" (metinde zaten "(n)" varsa dokunmaz). */
export function withRank(text: string, rank: Score, on: boolean): string {
  if (!on || !text || !valid(rank) || /\(\d{1,2}\)\s*$/.test(text.trim()) || /^VERİ YOK/.test(text)) return text;
  return `${text} (${rank})`;
}

/** "Comments" sütunu: puan gerekçeleri, karar, severity kararı, sonuç dayanağı ve notlar. */
export function commentText(p: Project, row: Fmea): string {
  const parts: string[] = [];
  const rs = [row.sReason && `S: ${row.sReason}`, row.oReason && `O: ${row.oReason}`, row.dReason && `D: ${row.dReason}`].filter(Boolean);
  if (rs.length) parts.push(rs.join('; '));
  if (row.riskDecision) parts.push(`Karar: ${row.riskDecision}${row.riskDecisionReason ? ` – ${row.riskDecisionReason}` : ''}${row.riskDecisionBy ? ` (${row.riskDecisionBy})` : ''}`);
  if (row.sDisposition) parts.push(`Severity kararı: ${row.sDisposition}${row.sDispositionReason ? ` – ${row.sDispositionReason}` : ''}`);
  const b = effectiveBasis(p, row);
  if (b === 'Projected') parts.push('Aksiyon sonuçları öngörülen değerlerdir; tamamlanınca gerçekleşen değerler yazılacak.');
  if (b === 'Actual' && reranked(row)) parts.push('Aksiyon sonuçları gerçekleşen değerlerdir.');
  if (row.notes?.trim()) parts.push(row.notes.trim());
  return parts.join('\n');
}

/** Satır numarası: kayıtlıysa o, değilse kayıtlıların en büyüğünden sonra sırayla. */
export function lineNumbers<T extends { id: string; lineNo?: number }>(rows: T[]): Map<string, number> {
  let max = 0;
  for (const r of rows) if (typeof r.lineNo === 'number' && r.lineNo > max) max = r.lineNo;
  const m = new Map<string, number>();
  for (const r of rows) m.set(r.id, typeof r.lineNo === 'number' ? r.lineNo : ++max);
  return m;
}

export { splitRequirement };

// ------------------------------------------------------------------ Level 2 bulgular
const DF_PROCESS_CONTROL = /\bSPC\b|\bCMM\b|100 ?%|in-process|proses içi|first article|\bFAI\b|ilk parça|operat(o|ö)r|üretim kontrol/i;

export function riskFindings(p: Project): Finding[] {
  const out: Finding[] = [];
  const f = (kind: Finding['kind'], code: string, id: string, field: string, message: string) => out.push({ kind, code, id, field, message });
  for (const r of [...p.dfmea, ...p.pfmea] as Fmea[]) {
    if (reranked(r)) {
      const basis = effectiveBasis(p, r);
      const a = actionOf(p, r);
      if (isNoAction(r) && !has(r.recommendedAction)) {
        if ((r.newS != null && r.newS !== r.s) || (r.newO != null && r.newO !== r.o) || (r.newD != null && r.newD !== r.d))
          f('FMEA LOGIC ERROR', 'alarp-rescored', r.id, 'newS', 'Aksiyon alınmama kararı var ama sonuç puanları değişmiş. ALARP/aksiyonsuz satırda puan değişmez (SCMH 7.2.19).');
      } else if (!a && !has(r.recommendedAction)) {
        f('FMEA LOGIC ERROR', 'rerank-no-action', r.id, 'newS', 'Yeni S/O/D var ama aksiyon tanımlı değil. Yeniden puanlama yalnızca alınan aksiyona göre yapılır (SCMH 7.2.3 adım 12).');
      } else if (basis === 'Actual') {
        const gap = rerankEvidenceGap(p, r);
        if (gap) f('FMEA LOGIC ERROR', 'rerank-no-evidence', r.id, 'newS', `Gerçekleşen sonuç olarak yeniden puanlanmış ama etkinlik kanıtı eksik: ${gap} (SCMH 7.2.3 adım 12: “based on evidence of the effectiveness of the actions”).`);
      }
      if (r.resultBasis === 'Projected' && a?.status === 'Completed')
        f('ENGINEERING WARNING', 'projected-completed', r.id, 'resultBasis', 'Aksiyon tamamlandı ama sonuçlar hâlâ “Projected”. Gerçekleşen değerlerle yeniden puanlayın (SCMH 7.2.19).');
    }
    if (isNoAction(r) && !has(r.riskDecisionReason))
      f('FMEA LOGIC ERROR', 'decision-no-reason', r.id, 'riskDecisionReason', 'Aksiyon alınmama kararının gerekçesi yazılmamış.');
    if (isNoAction(r) && has(r.recommendedAction))
      f('ENGINEERING WARNING', 'decision-conflict', r.id, 'riskDecision', 'Aksiyon alınmama kararı var ama önerilen aksiyon da yazılmış.');
    const dp = dispositionProblem(p, r);
    if (dp && r.sDisposition) f('FMEA LOGIC ERROR', 's-disposition', r.id, 'sDisposition', dp);
    if (!isPf(r)) {
      for (const k of ['prevention', 'detection'] as const)
        if (has(r[k]) && DF_PROCESS_CONTROL.test(r[k]))
          f('ENGINEERING WARNING', 'df-control-is-process', r.id, k, 'DFMEA kontrolü bir üretim/proses kontrolü gibi görünüyor (SPC, CMM, %100, ilk parça, operatör). DFMEA tasarım zafiyetini üretim kontrolleriyle kapatmamalıdır (DRA webinar slide 38).');
      for (const c of r.causeFromIds ?? []) {
        if (c === r.id || !p.dfmea.some((d) => d.id === c)) f('FMEA LOGIC ERROR', 'df-chain-link', r.id, 'causeFromIds', `Neden bağlantısı ${c} geçersiz (kendisi veya mevcut değil).`);
      }
    } else {
      const inputs = p.pfdItems.filter((x) => x.stepId === r.stepId && x.kind === 'Input');
      if (inputs.length && has(r.cause) && !(r.causeInputIds?.length))
        f('ENGINEERING WARNING', 'pf-cause-no-input', r.id, 'causeInputIds', 'Neden PFD girdisine bağlanmamış. Neden, karşılanmayan veya yetersiz bir girdidir (PF webinar p22).');
      if (r.outputId && !p.pfdItems.some((x) => x.id === r.outputId && x.kind === 'Output'))
        f('FMEA LOGIC ERROR', 'pf-output-link', r.id, 'outputId', `PFD çıktısı ${r.outputId} bulunamadı.`);
    }
  }
  // Kontrol planı
  const steps = new Map(p.processSteps.map((s) => [s.id, s]));
  const outputsByChar = new Set(p.pfdItems.filter((x) => x.kind === 'Output' && has(x.charId)).map((x) => `${x.stepId}|${x.charId.trim()}`));
  const charIds = new Map<string, ControlPlanRow[]>();
  for (const c of p.controlPlan) {
    const miss = reactionMissing(c);
    if (miss.length)
      f('ENGINEERING WARNING', 'cp-reaction-must', c.id, 'reactionPlan', `Reaksiyon planında zorunlu öğe eksik: ${miss.join(', ')} (CP webinar p30).${/\bncr\b/i.test(c.reactionPlan) && miss.includes('düzeltme yöntemi') ? ' Yalnızca NCR ile tepki “çok reaktiftir” (CP Q&A Q24).' : ''}`);
    if (c.controlKind === 'Error proofing' && !has(c.epVerification) && !has(c.frequency))
      f('ENGINEERING WARNING', 'ep-no-verification', c.id, 'epVerification', 'Hata önleme cihazının doğrulama yöntemi/sıklığı yok; cihazlar aşınabilir veya devre dışı kalabilir (CP webinar p29).');
    if (has(c.charId)) charIds.set(c.charId.trim(), [...(charIds.get(c.charId.trim()) ?? []), c]);
    if (has(c.charId) && c.stepId && p.pfdItems.some((x) => x.stepId === c.stepId && x.kind === 'Output') && !outputsByChar.has(`${c.stepId}|${c.charId.trim()}`))
      f('ENGINEERING WARNING', 'cp-charid-pfd', c.id, 'charId', `Karakteristik ID ${c.charId} bu adımın PFD çıktılarında yok (CP webinar p23/p31: PFD ve PFMEA ile aynı numara).`);
    if (c.kcId && has(c.productChar) && c.charType !== 'Process Characteristic' && c.charType !== 'Process Parameter' && !isInspectionStep(steps.get(c.stepId)) && !c.ppId && !has(c.noPairReason)
      && !p.controlPlan.some((x) => x.controlsCpIds?.includes(c.id)))
      f('ENGINEERING WARNING', 'cp-pair-missing', c.id, 'controlsCpIds', 'KC ürün karakteristiğini besleyen proses karakteristiği/parametresi satırı yok; bağlayın veya gerekçe yazın (CP webinar p24, p33 “2D/2P”).');
    for (const t of c.controlsCpIds ?? [])
      if (!p.controlPlan.some((x) => x.id === t)) f('FMEA LOGIC ERROR', 'cp-pair-link', c.id, 'controlsCpIds', `Eşleştirilen satır ${t} yok.`);
    if (c.kcId && !c.wiDocId)
      f('ENGINEERING WARNING', 'cp-no-wi', c.id, 'wiDocId', 'KC kontrol satırı bir üretim/muayene talimatına bağlı değil (CP Q&A Q20, CP webinar p43).');
  }
  for (const [id, rows] of charIds) {
    const texts = new Set(rows.map((c) => (c.productChar || c.processChar).trim().toLowerCase()));
    if (texts.size > 1) for (const c of rows) f('ENGINEERING WARNING', 'cp-charid-dup', c.id, 'charId', `Karakteristik ID ${id} farklı karakteristiklerde kullanılmış.`);
  }
  // Önleme öncelikli / en erken adım (CP webinar p17, p44)
  for (const k of p.kcs.filter((k) => k.status !== 'Rejected')) {
    const cps = p.controlPlan.filter((c) => c.kcId === k.id && c.stepId);
    if (!cps.length || !cps.every((c) => isInspectionStep(steps.get(c.stepId)))) continue;
    const firstCp = Math.min(...cps.map((c) => opNum(steps.get(c.stepId)?.opNo ?? '')));
    const creators = [
      ...p.pfdItems.filter((x) => x.kind === 'Output' && x.kcId === k.id).map((x) => x.stepId),
      ...p.pfmea.filter((x) => x.id === k.sourceId || x.dfIds.includes(k.sourceId)).map((x) => x.stepId),
    ].map((id) => steps.get(id)).filter((s): s is ProcessStepRow => !!s && !isInspectionStep(s) && opNum(s.opNo) < firstCp);
    if (creators.length)
      f('ENGINEERING WARNING', 'prevention-first', k.id, 'controlPlan', `${k.id} yalnızca muayene adımında kontrol ediliyor; karakteristiği oluşturan ${creators[0].opNo || creators[0].id} adımında önleme/izleme yok (CP webinar p17 “earliest possible operation”, p44).`);
  }
  return out;
}

// ------------------------------------------------------------------ Level 1 kontroller
export function riskChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (key: string, question: string, weight: number, bad: string[], okDetail: string, badDetail: (n: number) => string, applicable = true) =>
    out.push({ key, question, weight, ok: applicable && bad.length === 0, ids: bad, detail: !applicable ? 'Değerlendirilecek veri yok' : bad.length ? badDetail(bad.length) : okDetail });
  const fm = ([...p.dfmea, ...p.pfmea] as Fmea[]).filter((r) => r.failureMode?.trim());
  const pf = p.pfmea.filter((r) => r.failureMode?.trim());
  const scmh = isScmh(p);
  const findings = riskFindings(p);
  const codes = (...c: string[]) => [...new Set(findings.filter((f) => c.includes(f.code)).map((f) => f.id))];

  add('s-high-no-disposition', 'S 9–10 satırlar için severity kararı (tasarım değişikliği / KC-CI / gerekçeli kabul) verilmiş mi?', 10,
    fm.filter((r) => dispositionProblem(p, r)).map((r) => r.id),
    'S 9–10 satırların hepsinde geçerli karar var', (n) => `${n} S 9–10 satırda karar eksik veya geçersiz – Final onayı engeller (SCMH Q&A Q21)`,
    scmh && fm.some((r) => valid(r.s) && r.s >= 9));
  add('rerank-evidence', 'Yeniden puanlama tamamlanmış aksiyon ve etkinlik kanıtına dayanıyor mu?', 8,
    codes('rerank-no-evidence', 'rerank-no-action', 'alarp-rescored'),
    'Yeni S/O/D değerleri aksiyon ve kanıtla destekli', (n) => `${n} satırda kanıtsız yeniden puanlama`, fm.some(reranked));
  add('decision-reason', 'Aksiyon alınmama (ALARP) kararları gerekçeli mi?', 6,
    codes('decision-no-reason'), 'Kararların hepsi gerekçeli', (n) => `${n} karar gerekçesiz`, fm.some(isNoAction));
  add('cp-coverage', 'Önemli PFMEA riskleri (S 9–10, KC/CI, ekip seçimi) kontrol planında mı?', 10,
    pf.filter((r) => cpCoverageGap(p, r)).map((r) => r.id),
    'Önemli risklerin hepsi kontrol planında veya gerekçeyle dışarıda', (n) => `${n} önemli PFMEA riski kontrol planında yok (CP webinar p43, CP Q&A Q19)`, pf.length > 0);
  add('cp-align', 'Kontrol planı satırları PFD adımına ve PFMEA satırına bağlı mı?', 5,
    p.controlPlan.filter((c) => !c.pfId || !c.stepId || !p.processSteps.some((s) => s.id === c.stepId)).map((c) => c.id),
    'Tüm satırlar PFD ve PFMEA’ya bağlı', (n) => `${n} kontrol planı satırı PFD/PFMEA’ya bağlı değil (CP webinar p31)`, p.controlPlan.length > 0);
  add('cp-reaction-owner', 'Reaksiyon planlarının sorumlusu belirlenmiş mi?', 6,
    p.controlPlan.filter((c) => !has(c.responsible)).map((c) => c.id),
    'Tüm satırlarda sorumlu var', (n) => `${n} kontrol planı satırında reaksiyon sorumlusu yok (SCMH 7.2.3 p66, CP webinar p43)`, p.controlPlan.length > 0);
  add('cp-reaction-must', 'Reaksiyon planları ayırma + düzeltme + amire bildirim içeriyor mu?', 6,
    p.controlPlan.filter((c) => reactionMissing(c).length).map((c) => c.id),
    'Tüm reaksiyon planları zorunlu öğeleri içeriyor', (n) => `${n} reaksiyon planında zorunlu öğe eksik (CP webinar p30)`, p.controlPlan.length > 0);
  add('ep-cp', 'Hata önleme cihazları kontrol planında izleniyor mu?', 4,
    pf.filter((r) => needsEpCp(p, r)).map((r) => r.id),
    'Önemli risklerdeki hata önleme cihazları kontrol planında', (n) => `${n} PFMEA satırının hata önleme cihazı kontrol planında izlenmiyor (CP webinar p29)`, pf.some((r) => !isEpNone(r.errorProofing)));
  const outputs = p.pfdItems.filter((x) => x.kind === 'Output' && has(x.text));
  add('pfd-output-fm', 'Her PFD çıktısı için hata modu tanımlanmış mı?', 6,
    outputs.filter((o) => !p.pfmea.some((r) => r.outputId === o.id)).map((o) => o.id),
    'Tüm PFD çıktılarının PFMEA hata modu var', (n) => `${n} PFD çıktısının PFMEA hata modu yok (PF webinar p20)`, outputs.length > 0);
  const pc = pfdCompleteness(p);
  add('pfd-complete', 'PFD malzeme kabulünden sevkiyata kadar eksiksiz mi?', 5,
    [...new Set(pc.map((x) => x.id))], 'PFD bütünlük kontrolleri geçti', (n) => `${n} adımda PFD bütünlük sorunu (PF webinar p8)`, p.processSteps.length > 0);
  return out;
}

// ------------------------------------------------------------------ Neyi kaçırdım?
export function riskMisses(p: Project): MissItem[] {
  const out: MissItem[] = [];
  const add = (area: string, message: string, ids: string[]) => ids.length && out.push({ area, message, ids });
  const df = p.dfmea.filter((d) => d.failureMode?.trim());
  if (df.length) {
    const cats = new Set(df.flatMap((d) => d.riskCategory ?? []));
    const missing = AS9145_CATEGORIES.filter((c) => !cats.has(c));
    if (missing.length) add('DFMEA', `9145 risk kategorilerinde DFMEA satırı yok: ${missing.join(', ')} (AS9145 §4.4.4, DRA webinar slide 14)`, ['DFMEA']);
    const noise = new Set(df.flatMap((d) => d.noiseFactor ?? []));
    const nMiss = RISK_LISTS.noiseFactor.filter((n) => !noise.has(n));
    if (nMiss.length) add('DFMEA', `Değerlendirilmemiş gürültü faktörleri: ${nMiss.join(', ')} (P-diagram, DRA webinar slide 23)`, ['DFMEA']);
    if (!noise.has('Environment')) add('DFMEA', 'Çevresel riskler (sıcaklık, titreşim, gürültü, radyasyon duyarlılığı) hiçbir satırda etiketlenmemiş (DRA webinar slide 39)', ['DFMEA']);
    if (!['Manufacturability', 'Maintainability', 'Testability'].some((c) => cats.has(c))) add('DFMEA', 'Üretilebilirlik, onarım veya test zorluğu olarak etiketlenmiş satır yok (DRA webinar slide 39)', ['DFMEA']);
    add('DFMEA', 'S 9–10 olup severity kararı verilmemiş satırlar', p.dfmea.filter((r) => dispositionProblem(p, r)).map((r) => r.id));
  }
  add('PFMEA', 'S 9–10 olup severity kararı verilmemiş satırlar', p.pfmea.filter((r) => dispositionProblem(p, r)).map((r) => r.id));
  add('Kontrol Planı', 'Kontrol planında olmayan önemli PFMEA riskleri (S 9–10 / KC / ekip seçimi)', p.pfmea.filter((r) => cpCoverageGap(p, r)).map((r) => r.id));
  add('Kontrol Planı', 'Reaksiyon sorumlusu olmayan kontrol planı satırları', p.controlPlan.filter((c) => !has(c.responsible)).map((c) => c.id));
  add('PFD', 'PFMEA hata modu olmayan PFD çıktıları', p.pfdItems.filter((x) => x.kind === 'Output' && has(x.text) && !p.pfmea.some((r) => r.outputId === x.id)).map((x) => x.id));
  for (const x of pfdCompleteness(p)) add('PFD', x.message, [x.id]);
  return out;
}

/** Aksiyon bekleyen satırlar ("Neyi kaçırdım?" ve kalite skoru için). */
export function unaddressed(p: Project): Fmea[] {
  return ([...p.dfmea, ...p.pfmea] as Fmea[]).filter((r) => needsAction(p, r).need && !actionAddressed(r));
}

/** PFMEA satırının ürün/proses gereksinimi birleşik metni (eski `requirement` alanı için). */
export function joinedRequirement(product: string, process: string): string {
  return [product, process].map((x) => (x ?? '').trim()).filter(Boolean).join(' / ');
}
