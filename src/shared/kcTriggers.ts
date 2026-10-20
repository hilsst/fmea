// v4-kc: KC aday tetikleyicileri ve proses KC kuralı. Sonuçlar yalnızca ADAY'dır; KC kararı mühendisindir.
// Kaynaklar: CPQA Q10, DRA Q&A Q21, SCMH 7.2.3 p33 adım 13 ve p63. Öncelik listesi risk akışından gelir (needsAction).
import { kcTypeOf } from './kcScmh';
import { needsAction } from './risk';
import type { DfmeaRow, KcRow, PfmeaRow, Project, RequirementRow, Score } from './types';

export type TriggerKey = 'S' | 'Safety' | 'SO' | 'SD' | 'OD' | 'RPN' | 'Customer' | 'SR';

export interface KcTrigger {
  key: TriggerKey;
  label: string;
  on: boolean;
  /** Değer ve eşik / gerekçe; eşik tanımsızsa bilgi metni. */
  reason: string;
}

const valid = (v: Score): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10;
const prod = (a: Score, b: Score) => (valid(a) && valid(b) ? a * b : null);
const SAFETY_RE = /\b(safety|emniyet|güvenlik|yaralan|injur|fire|yangın|hazard)/i;

function linkedReqs(p: Project, src: DfmeaRow | PfmeaRow): RequirementRow[] {
  const ids = 'functionId' in src ? src.reqIds : src.dfIds.flatMap((id) => p.dfmea.find((d) => d.id === id)?.reqIds ?? []);
  return ids.map((id) => p.requirements.find((r) => r.id === id)).filter(Boolean) as RequirementRow[];
}

/** O×D sırasında ilk N satır (settings.scmhReviewTopN; N yoksa boş küme). */
function topOd(p: Project): Set<string> {
  const n = p.settings.scmhReviewTopN;
  if (!(typeof n === 'number' && n > 0)) return new Set();
  const rows = [...p.dfmea, ...p.pfmea].map((r) => ({ id: r.id, v: prod(r.o, r.d) })).filter((r) => r.v != null) as { id: string; v: number }[];
  return new Set(rows.sort((a, b) => b.v - a.v || a.id.localeCompare(b.id)).slice(0, n).map((r) => r.id));
}

/**
 * Bir FMEA satırının KC aday tetikleyicileri (yalnızca aday; karar değil).
 * - S: S ≥ `kcSeverityThreshold` (SCMH projelerinde 9; D-SEV/P-SEV 9–10 = Safety/Regulatory bandı).
 * - Safety: emniyet etkisi / Safety gereksinimi / specialChar Safety.
 * - SO, SD, RPN: ekibin Top-N inceleme listesi (risk.ts needsAction); OD: aynı N ile O×D sırası. N yoksa yalnızca değer gösterilir.
 * - Customer: müşteriye özel gereksinim; SR: Special Requirement işaretli gereksinim.
 */
export function kcTriggers(p: Project, src: DfmeaRow | PfmeaRow): KcTrigger[] {
  const st = p.settings;
  const reqs = linkedReqs(p, src);
  const out: KcTrigger[] = [];
  const add = (key: TriggerKey, label: string, on: boolean, reason: string) => out.push({ key, label, on, reason });
  add('S', 'Severity', valid(src.s) && src.s >= st.kcSeverityThreshold, valid(src.s) ? `S=${src.s} (eşik ${st.kcSeverityThreshold})` : 'S puanlanmamış');
  const safetyReq = reqs.filter((r) => r.reqType === 'Safety');
  const safety = src.specialChar === 'Safety' || safetyReq.length > 0 || SAFETY_RE.test(src.effect);
  add('Safety', 'Emniyet', safety, safety ? (safetyReq.length ? `Safety gereksinimi: ${safetyReq.map((r) => r.id).join(', ')}` : 'Emniyet etkisi') : '');
  // S×O / S×D / RPN: risk akışının ekip "Top-N" inceleme listesi (needsAction, settings.scmhReviewTopN).
  // O×D aynı N ile sıralanır (7.2.3 p63 "Detection x Occurrence"). SCMH sabit eşik vermez (DFMEA Guidance O19).
  const n = st.scmhReviewTopN;
  const reasons = needsAction(p, src).reasons;
  const band = (key: TriggerKey, label: string, v: number | null, on: boolean) =>
    add(key, label, on, v == null ? 'puan eksik' : typeof n === 'number' && n > 0 ? `${label}=${v}${on ? ` (inceleme listesi ilk ${n})` : ''}` : `${label}=${v} (inceleme listesi Top-N tanımlı değil – yalnızca sıralama)`);
  band('SO', 'S×O', prod(src.s, src.o), reasons.includes('Top-S×O'));
  band('SD', 'S×D', prod(src.s, src.d), reasons.includes('Top-S×D'));
  band('OD', 'O×D', prod(src.o, src.d), topOd(p).has(src.id));
  band('RPN', 'RPN', valid(src.s) && valid(src.o) && valid(src.d) ? src.s * src.o * src.d : null, reasons.includes('Top-RPN'));
  const cust = reqs.filter((r) => r.reqType === 'Customer-specific' || /müşteri|customer/i.test(`${r.source} ${r.text}`));
  add('Customer', 'Müşteri', cust.length > 0, cust.map((r) => r.id).join(', '));
  const sr = reqs.filter((r) => r.specialRequirement);
  add('SR', 'Special Requirement', sr.length > 0, sr.map((r) => `${r.id}${r.srReason ? ` (${r.srReason})` : ''}`).join(', '));
  return out;
}

/** Satıra bağlı (kaynak veya ek bağlantı) KC kaydı var mı? Elenmiş KC de değerlendirilmiş sayılır. */
export function kcsOfSource(p: Project, rowId: string): KcRow[] {
  return p.kcs.filter((k) => k.sourceId === rowId || (k.linkedIds ?? []).includes(rowId));
}

export interface KcCandidate {
  row: DfmeaRow | PfmeaRow;
  triggers: KcTrigger[];
  /** Mevcut KC kayıtları (varsa aday zaten değerlendirilmiştir). */
  kcs: KcRow[];
}

/** Tetikleyicisi olan FMEA satırları (S tek başına da listelenir, ama KC kararı akışla verilir). */
export function kcCandidates(p: Project): KcCandidate[] {
  const out: KcCandidate[] = [];
  for (const row of [...p.dfmea, ...p.pfmea] as (DfmeaRow | PfmeaRow)[]) {
    if (!row.failureMode) continue;
    const t = kcTriggers(p, row).filter((x) => x.on);
    if (t.length) out.push({ row, triggers: t, kcs: kcsOfSource(p, row.id) });
  }
  return out;
}

// ------------------------------------------------------------------ proses KC kuralı (7.2.3 p63)

export interface ProcessKcCandidate {
  row: PfmeaRow;
  /** Yüksek risk gerekçesi (S bandı veya ekip eşiği). */
  why: string[];
  /** Varyasyonu süren proses girdileri (bağlı proses parametreleri). */
  ppIds: string[];
  characteristic: string;
  /** designActionFeasible cevaplanmamışsa true: önce soru cevaplanmalı. */
  needsAnswer: boolean;
}

/**
 * PFMEA'da yüksek riskli (S 9–10 inceleme bandı – SCMH Guidance Q19 – veya ekip eşiğini aşan S×D / O×D / RPN)
 * ve riski tasarım aksiyonuyla azaltılamayan satırlar → proses KC adayı. Aday, satıra bağlı proses parametresi
 * üzerine önerilir ("process inputs that drive variability", p63 not).
 */
export function processKcCandidates(p: Project): ProcessKcCandidate[] {
  const out: ProcessKcCandidate[] = [];
  for (const row of p.pfmea) {
    if (!row.failureMode) continue;
    const t = kcTriggers(p, row);
    const why = [
      ...(valid(row.s) && row.s >= 9 ? [`S=${row.s} (SCMH inceleme bandı 9–10)`] : []),
      ...t.filter((x) => (x.key === 'SD' || x.key === 'OD' || x.key === 'RPN') && x.on).map((x) => x.reason),
    ];
    if (!why.length || row.designActionFeasible === 'Yes') continue;
    if (p.kcs.some((k) => kcTypeOf(k) === 'Process' && (k.sourceId === row.id || (k.linkedIds ?? []).includes(row.id)))) continue;
    const pps = p.processParams.filter((pp) => pp.pfIds.includes(row.id));
    out.push({
      row,
      why,
      ppIds: pps.map((pp) => pp.id),
      characteristic: pps.map((pp) => pp.parameter).filter(Boolean).join('; ') || row.requirement || row.processFunction || row.failureMode,
      needsAnswer: row.designActionFeasible !== 'No',
    });
  }
  return out;
}

