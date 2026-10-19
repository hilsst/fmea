// Special Characteristic Engine (§27). Faktörler yalnızca projedeki veriden değerlendirilir;
// sonuç bir öneridir. KC kararı ve kategorisi mühendis tarafından verilir.
import { historicalIds } from './checks';
import { capabilityAnalysis } from './capability';
import { parseData } from './scoring';
import type { DfmeaRow, KcCategory, KcRow, PfmeaRow, Project, RequirementRow } from './types';

export interface KcFactor {
  key: 'severity' | 'safety' | 'regulatory' | 'customer' | 'specialProcess' | 'tolerance' | 'capability' | 'historical' | 'detection';
  label: string;
  on: boolean;
  reason: string;
  /** Faktör şirket kurallarında devre dışıysa false. */
  enabled: boolean;
}

export interface KcEvaluation {
  factors: KcFactor[];
  /** Öneri (AI SUGGESTION) – mühendis değiştirebilir. Boş = öneri yok. */
  suggestedCategory: KcCategory;
  summary: string;
}

const SAFETY_RE = /\b(safety|emniyet|güvenlik|yaralan|injur|fire|yangın|flammab|crash|hazard)/i;
const REG_RE = /\b(regulat|yasal|mevzuat|faa|easa|cs-25|far ?25|reach|rohs|certif|sertifika)/i;

function linkedReqs(p: Project, src: DfmeaRow | PfmeaRow): RequirementRow[] {
  const ids = 'functionId' in src ? src.reqIds : src.dfIds.flatMap((id) => p.dfmea.find((d) => d.id === id)?.reqIds ?? []);
  return ids.map((id) => p.requirements.find((r) => r.id === id)).filter(Boolean) as RequirementRow[];
}

/** Toleransın nominal değere oranı ≤ %1 ise "dar tolerans" sayılır (yalnızca kaynakta LSL/USL varsa). */
export function tightTolerance(r: RequirementRow): string {
  if (r.lsl == null || r.usl == null) return '';
  const span = r.usl - r.lsl;
  const ref = r.nominal ?? (r.usl + r.lsl) / 2;
  if (!(ref > 0) || !(span > 0)) return '';
  const pct = (span / ref) * 100;
  return pct <= 1 ? `${r.id}: tolerans aralığı nominalin %${pct.toFixed(2)}’si` : '';
}

export function evaluateKc(p: Project, src: DfmeaRow | PfmeaRow, kc?: KcRow): KcEvaluation {
  const rules = p.settings.kcRules;
  const reqs = linkedReqs(p, src);
  const text = [src.effect, src.failureMode, src.specialChar, ...reqs.map((r) => `${r.text} ${r.reqType}`)].join(' ');
  const f: KcFactor[] = [];
  const add = (key: KcFactor['key'], label: string, on: boolean, reason: string, enabled = true) => f.push({ key, label, on: enabled && on, reason: on ? reason : '', enabled });

  add('severity', 'Severity', (src.s ?? 0) >= p.settings.kcSeverityThreshold, `S=${src.s} ≥ eşik ${p.settings.kcSeverityThreshold}`);
  add('safety', 'Emniyet', src.specialChar === 'Safety' || reqs.some((r) => r.reqType === 'Safety') || SAFETY_RE.test(src.effect), 'Emniyet etkisi / Safety gereksinimi', rules.safety);
  add('regulatory', 'Regülasyon', src.specialChar === 'Regulatory' || reqs.some((r) => r.reqType === 'Regulatory') || REG_RE.test(text), 'Regülasyon gereksinimi', rules.regulatory);
  const cust = reqs.filter((r) => r.reqType === 'Customer-specific' || /müşteri|customer/i.test(r.source + ' ' + r.text));
  add('customer', 'Müşteri gereksinimi', cust.length > 0, cust.map((r) => r.id).join(', '), rules.customer);
  const step = 'stepId' in src ? p.processSteps.find((s) => s.id === src.stepId) : undefined;
  const pfSteps = 'functionId' in src ? p.pfmea.filter((x) => x.dfIds.includes(src.id)).map((x) => p.processSteps.find((s) => s.id === x.stepId)) : [step];
  const sp = pfSteps.filter((s) => s?.specialProcess);
  add('specialProcess', 'Özel proses', sp.length > 0, sp.map((s) => `${s!.opNo} ${s!.name}`).join(', '), rules.specialProcess);
  const tight = reqs.map(tightTolerance).filter(Boolean);
  add('tolerance', 'Dar tolerans', tight.length > 0, tight.join('; '), rules.tolerance);
  let capReason = '';
  if (kc) {
    for (const c of p.capability.filter((c) => c.kcId === kc.id)) {
      const a = capabilityAnalysis(parseData(c.data), c.lsl, c.usl, c.target, p.settings, c.subgroupSize);
      if (a.cpk != null && p.settings.targetCpk != null && a.cpk < p.settings.targetCpk) capReason = `${c.id}: Cpk ${a.cpk.toFixed(2)} < hedef ${p.settings.targetCpk}`;
    }
  }
  add('capability', 'Yetersiz capability', !!capReason, capReason, rules.capability);
  add('historical', 'Geçmiş hata', historicalIds(p).has(src.id), 'Dersler kaydına bağlı', rules.historical);
  add('detection', 'Tespit zorluğu', (src.d ?? 0) >= 7, `D=${src.d} (tespit zor)`, rules.detection);

  const on = f.filter((x) => x.on);
  let suggestedCategory: KcCategory = '';
  if (on.some((x) => x.key === 'safety')) suggestedCategory = 'Safety Characteristic';
  else if (on.some((x) => x.key === 'regulatory')) suggestedCategory = 'Regulatory Characteristic';
  else if (on.some((x) => x.key === 'severity') && on.length >= 2) suggestedCategory = 'Critical';
  else if (on.length >= 2) suggestedCategory = 'Key Characteristic';
  else if (on.length === 1) suggestedCategory = 'Significant';
  const summary = on.length
    ? `${on.length} faktör: ${on.map((x) => x.label).join(', ')}. Öneri: ${suggestedCategory} (AI SUGGESTION – mühendis kararı gerekli).`
    : 'Faktör bulunmadı.';
  return { factors: f, suggestedCategory, summary };
}

/** Kategori Critical / Safety / Regulatory ise toplu kabul yapılamaz (§70). */
export const MANUAL_ONLY_CATEGORIES: KcCategory[] = ['Critical', 'Safety Characteristic', 'Regulatory Characteristic'];
