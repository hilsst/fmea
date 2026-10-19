import type { Score, Settings } from './types';

export type AP = 'H' | 'M' | 'L' | '';

// AIAG & VDA FMEA Handbook (2019) Action Priority tablosu.
// Anahtar: S bandı (1..5), O bandı (1..5) → [D=1, D=2–4, D=5–6, D=7–10]
export const AIAG_VDA_AP: Record<string, string> = {
  '5,5': 'HHHH', '5,4': 'HHHH', '5,3': 'MHHH', '5,2': 'LLMH', '5,1': 'LLLL',
  '4,5': 'HHHH', '4,4': 'MHHH', '4,3': 'MMMH', '4,2': 'LLMM', '4,1': 'LLLL',
  '3,5': 'MMHH', '3,4': 'LMMM', '3,3': 'LLLM', '3,2': 'LLLL', '3,1': 'LLLL',
  '2,5': 'LLMM', '2,4': 'LLLL', '2,3': 'LLLL', '2,2': 'LLLL', '2,1': 'LLLL',
  '1,5': 'LLLL', '1,4': 'LLLL', '1,3': 'LLLL', '1,2': 'LLLL', '1,1': 'LLLL',
};

const valid = (v: Score): v is number => typeof v === 'number' && v >= 1 && v <= 10;

function sBand(s: number) {
  return s >= 9 ? 5 : s >= 7 ? 4 : s >= 4 ? 3 : s >= 2 ? 2 : 1;
}
function oBand(o: number) {
  return o >= 8 ? 5 : o >= 6 ? 4 : o >= 4 ? 3 : o >= 2 ? 2 : 1;
}
function dIndex(d: number) {
  return d >= 7 ? 3 : d >= 5 ? 2 : d >= 2 ? 1 : 0;
}

export const S_BANDS = ['1', '2–3', '4–6', '7–8', '9–10'];
export const O_BANDS = ['1', '2–3', '4–5', '6–7', '8–10'];
export const D_BANDS = ['1', '2–4', '5–6', '7–10'];

/** Action Priority. `table` verilirse şirket AP tablosu, yoksa AIAG-VDA 2019 kullanılır. */
export function actionPriority(s: Score, o: Score, d: Score, table?: Record<string, string> | null): AP {
  if (!valid(s) || !valid(o) || !valid(d)) return '';
  const key = `${sBand(s)},${oBand(o)}`;
  const row = (table && /^[HML]{4}$/.test(table[key] ?? '') ? table[key] : AIAG_VDA_AP[key]) as string;
  return row[dIndex(d)] as AP;
}

/** Projenin AP tablosuyla AP (kısa yol). */
export const apOf = (p: { scoring: { apTable?: Record<string, string> | null } }, s: Score, o: Score, d: Score) =>
  actionPriority(s, o, d, p.scoring.apTable);

/** RPN tek başına karar kriteri değildir (§26). Ekranda ve raporda bu uyarı gösterilir. */
export const RPN_WARNING = 'RPN tek başına risk karar mekanizması değildir.';

export function rpn(s: Score, o: Score, d: Score): number | null {
  if (!valid(s) || !valid(o) || !valid(d)) return null;
  return s * o * d;
}

export type RiskLevel = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | '';

/**
 * Spesifikasyon §18 öncelik mantığı: emniyet/yüksek severity RPN'den bağımsız olarak öne çıkar.
 */
export function riskLevel(
  row: { s: Score; o: Score; d: Score; specialChar?: string },
  settings: Settings,
  apTable?: Record<string, string> | null,
): RiskLevel {
  if (!valid(row.s)) return '';
  const ap = actionPriority(row.s, row.o, row.d, apTable);
  const r = rpn(row.s, row.o, row.d);
  if (row.specialChar === 'Safety' || row.specialChar === 'Regulatory' || row.s >= settings.kcSeverityThreshold) return 'CRITICAL';
  if (ap === 'H' || (settings.rpnThreshold != null && r != null && r >= settings.rpnThreshold)) return 'HIGH';
  if (ap === 'M' || row.s >= settings.highSeverityThreshold) return 'MEDIUM';
  return ap ? 'LOW' : '';
}

/**
 * KC adayı mı? Aday yalnızca öneridir (AI Proposed); KC kararı mühendisindir (§27, §77).
 */
export function isKcCandidate(row: { s: Score; specialChar?: string }, settings: Settings): boolean {
  if (row.specialChar && ['Safety', 'Regulatory', 'Critical', 'Significant'].includes(row.specialChar)) return true;
  return valid(row.s) && row.s >= settings.kcSeverityThreshold;
}

export function parseData(text: string): number[] {
  return text
    .split(/[\s;,]+/)
    .map((t) => t.replace(',', '.'))
    .filter((t) => t !== '')
    .map(Number)
    .filter((n) => Number.isFinite(n));
}

export interface CapabilityResult {
  n: number;
  mean: number | null;
  sigmaWithin: number | null;
  sigmaOverall: number | null;
  cp: number | null;
  cpk: number | null;
  pp: number | null;
  ppk: number | null;
  message: string;
}

/** σ within = MR̄/d2 (d2 = 1.128), σ overall = örnek standart sapma. */
export function capability(values: number[], lsl: number | null, usl: number | null, minSamples: number | null): CapabilityResult {
  const n = values.length;
  const empty: CapabilityResult = { n, mean: null, sigmaWithin: null, sigmaOverall: null, cp: null, cpk: null, pp: null, ppk: null, message: '' };
  if (n < 2) return { ...empty, message: 'Capability calculation cannot be performed – production data required.' };
  if (lsl == null && usl == null) return { ...empty, message: 'LSL/USL VERİ YOK – spesifikasyon sınırı girilmeli.' };
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  let mr = 0;
  for (let i = 1; i < n; i++) mr += Math.abs(values[i] - values[i - 1]);
  const sw = mr / (n - 1) / 1.128;
  const two = lsl != null && usl != null;
  const idx = (sigma: number) => {
    if (!(sigma > 0)) return { c: null, ck: null };
    const c = two ? (usl! - lsl!) / (6 * sigma) : null;
    const parts: number[] = [];
    if (usl != null) parts.push((usl - mean) / (3 * sigma));
    if (lsl != null) parts.push((mean - lsl) / (3 * sigma));
    return { c, ck: Math.min(...parts) };
  };
  const w = idx(sw);
  const o = idx(sd);
  let message = '';
  if (minSamples != null && n < minSamples) message = `Örnek sayısı (${n}) minimumun (${minSamples}) altında – sonuç ön değerlendirmedir.`;
  return { n, mean, sigmaWithin: sw, sigmaOverall: sd, cp: w.c, cpk: w.ck, pp: o.c, ppk: o.ck, message };
}
