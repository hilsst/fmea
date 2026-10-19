// Capability Validation Engine (§31): Cp/Cpk/Pp/Ppk yalnızca geçerlilik koşulları sağlanırsa yorumlanır.
import type { Settings } from './types';

export type CapVerdict = 'VALID' | 'INVALID' | 'INSUFFICIENT DATA';

export interface CapabilityAnalysis {
  n: number;
  mean: number | null;
  sigmaWithin: number | null;
  sigmaOverall: number | null;
  cp: number | null;
  cpk: number | null;
  pp: number | null;
  ppk: number | null;
  unilateral: boolean;
  /** Anderson-Darling */
  ad: number | null;
  adP: number | null;
  normal: boolean | null;
  stable: boolean | null;
  outOfControl: number[];
  method: 'I-MR' | 'Xbar-R' | 'Percentile' | '';
  minSamples: number;
  verdict: CapVerdict;
  /** Hedef karşılaştırması: geçerli değilse boş. */
  meetsTarget: boolean | null;
  reasons: string[];
}

const D2: Record<number, number> = { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.97, 10: 3.078 };
const A2: Record<number, number> = { 2: 1.88, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308 };
export const DEFAULT_MIN_SAMPLES = 25;

// Standart normal CDF (Abramowitz-Stegun 7.1.26)
function phi(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Anderson-Darling normallik testi; p değeri D'Agostino & Stephens (1986) yaklaşımı. */
export function andersonDarling(values: number[]): { a2: number; p: number } | null {
  const n = values.length;
  if (n < 8) return null;
  const x = [...values].sort((a, b) => a - b);
  const m = x.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (n - 1));
  if (!(sd > 0)) return null;
  let s = 0;
  for (let i = 0; i < n; i++) {
    const fi = Math.min(Math.max(phi((x[i] - m) / sd), 1e-12), 1 - 1e-12);
    const fn = Math.min(Math.max(phi((x[n - 1 - i] - m) / sd), 1e-12), 1 - 1e-12);
    s += (2 * i + 1) * (Math.log(fi) + Math.log(1 - fn));
  }
  const a2 = -n - s / n;
  const a = a2 * (1 + 0.75 / n + 2.25 / (n * n));
  let p: number;
  if (a >= 0.6) p = Math.exp(1.2937 - 5.709 * a + 0.0186 * a * a);
  else if (a >= 0.34) p = Math.exp(0.9177 - 4.279 * a - 1.38 * a * a);
  else if (a >= 0.2) p = 1 - Math.exp(-8.318 + 42.796 * a - 59.938 * a * a);
  else p = 1 - Math.exp(-13.436 + 101.14 * a - 223.73 * a * a);
  return { a2, p: Math.min(Math.max(p, 0), 1) };
}

function percentile(sorted: number[], q: number) {
  const i = (sorted.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}

export function capabilityAnalysis(
  values: number[],
  lsl: number | null,
  usl: number | null,
  target: number | null,
  settings: Pick<Settings, 'minSamples' | 'targetCpk'>,
  subgroupSize?: number | null,
  distribution?: string,
): CapabilityAnalysis {
  const n = values.length;
  const minSamples = settings.minSamples ?? DEFAULT_MIN_SAMPLES;
  const r: CapabilityAnalysis = {
    n, mean: null, sigmaWithin: null, sigmaOverall: null, cp: null, cpk: null, pp: null, ppk: null,
    unilateral: (lsl == null) !== (usl == null), ad: null, adP: null, normal: null, stable: null, outOfControl: [],
    method: '', minSamples, verdict: 'INSUFFICIENT DATA', meetsTarget: null, reasons: [],
  };
  if (settings.minSamples == null) r.reasons.push(`Minimum örnek sayısı tanımlı değil; ${DEFAULT_MIN_SAMPLES} varsayıldı (Proje ayarından değiştirilebilir).`);
  if (n < 2) {
    r.reasons.push('Capability calculation cannot be performed – production data required.');
    return r;
  }
  if (lsl == null && usl == null) {
    r.reasons.push('LSL/USL VERİ YOK – spesifikasyon sınırı girilmeli.');
    return r;
  }
  if (lsl != null && usl != null && lsl >= usl) {
    r.verdict = 'INVALID';
    r.reasons.push('LSL ≥ USL – spesifikasyon sınırları hatalı.');
    return r;
  }
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  r.mean = mean;
  r.sigmaOverall = sd;

  // Kararlılık ve σ within
  const k = subgroupSize && subgroupSize >= 2 && subgroupSize <= 10 ? Math.round(subgroupSize) : 1;
  if (k > 1) {
    r.method = 'Xbar-R';
    const groups: number[][] = [];
    for (let i = 0; i + k <= n; i += k) groups.push(values.slice(i, i + k));
    if (n % k) r.reasons.push(`Son ${n % k} ölçüm tam alt grup oluşturmadığı için kararlılık analizine alınmadı.`);
    if (groups.length < 2) {
      r.reasons.push('Kararlılık için en az 2 alt grup gerekir.');
    } else {
      const xb = groups.map((g) => g.reduce((a, b) => a + b, 0) / k);
      const rg = groups.map((g) => Math.max(...g) - Math.min(...g));
      const xbb = xb.reduce((a, b) => a + b, 0) / xb.length;
      const rbar = rg.reduce((a, b) => a + b, 0) / rg.length;
      r.sigmaWithin = rbar / D2[k];
      const ucl = xbb + A2[k] * rbar, lcl = xbb - A2[k] * rbar;
      r.outOfControl = xb.map((v, i) => (v > ucl || v < lcl ? i + 1 : 0)).filter(Boolean);
    }
  } else {
    r.method = 'I-MR';
    let mr = 0;
    for (let i = 1; i < n; i++) mr += Math.abs(values[i] - values[i - 1]);
    const mrbar = mr / (n - 1);
    r.sigmaWithin = mrbar / 1.128;
    const ucl = mean + 2.66 * mrbar, lcl = mean - 2.66 * mrbar;
    r.outOfControl = values.map((v, i) => (v > ucl || v < lcl ? i + 1 : 0)).filter(Boolean);
    // 8 ardışık nokta ortalamanın aynı tarafında
    let run = 0, side = 0;
    for (let i = 0; i < n; i++) {
      const s = Math.sign(values[i] - mean);
      run = s !== 0 && s === side ? run + 1 : 1;
      side = s;
      if (run >= 8 && !r.outOfControl.includes(i + 1)) r.outOfControl.push(i + 1);
    }
  }
  r.stable = r.sigmaWithin != null ? r.outOfControl.length === 0 : null;

  // Normallik
  const ad = andersonDarling(values);
  if (ad) {
    r.ad = ad.a2;
    r.adP = ad.p;
    r.normal = ad.p >= 0.05;
  } else r.reasons.push('Normallik testi için en az 8 ölçüm gerekir.');

  const idx = (sigma: number | null) => {
    if (!(sigma != null && sigma > 0)) return { c: null as number | null, ck: null as number | null };
    const c = lsl != null && usl != null ? (usl - lsl) / (6 * sigma) : null;
    const parts: number[] = [];
    if (usl != null) parts.push((usl - mean) / (3 * sigma));
    if (lsl != null) parts.push((mean - lsl) / (3 * sigma));
    return { c, ck: Math.min(...parts) };
  };
  const nonNormal = distribution === 'Non-normal' || r.normal === false;
  if (nonNormal && distribution === 'Non-normal') {
    // Yüzdelik yöntemi (ISO 22514-2 / Clements): yalnızca performans indeksleri
    r.method = 'Percentile';
    const s = [...values].sort((a, b) => a - b);
    if (n >= 100) {
      const p0 = percentile(s, 0.00135), p50 = percentile(s, 0.5), p1 = percentile(s, 0.99865);
      r.pp = lsl != null && usl != null ? (usl - lsl) / (p1 - p0) : null;
      const parts: number[] = [];
      if (usl != null) parts.push((usl - p50) / (p1 - p50));
      if (lsl != null) parts.push((p50 - lsl) / (p50 - p0));
      r.ppk = Math.min(...parts);
    } else r.reasons.push('Normal olmayan dağılımda yüzdelik yöntemi için en az 100 ölçüm gerekir.');
  } else {
    const w = idx(r.sigmaWithin);
    const o = idx(sd);
    r.cp = w.c;
    r.cpk = w.ck;
    r.pp = o.c;
    r.ppk = o.ck;
  }
  if (r.unilateral) r.reasons.push('Tek taraflı tolerans: Cp/Pp hesaplanmaz, yalnızca Cpk/Ppk.');
  if (target != null && lsl != null && usl != null && (target < lsl || target > usl)) r.reasons.push('Hedef değer tolerans aralığının dışında.');
  if (target != null) r.reasons.push(`Ortalama hedeften sapma: ${(mean - target).toPrecision(3)}`);

  // Karar
  if (n < minSamples) {
    r.verdict = 'INSUFFICIENT DATA';
    r.reasons.unshift(`Örnek sayısı (${n}) minimumun (${minSamples}) altında.`);
  } else if (r.stable === false) {
    r.verdict = 'INVALID';
    r.reasons.unshift(`Proses kararlı değil (${r.method}: kontrol dışı nokta ${r.outOfControl.slice(0, 8).join(', ')}). Capability yorumlanamaz.`);
  } else if (r.normal === false && distribution !== 'Non-normal') {
    r.verdict = 'INVALID';
    r.reasons.unshift(`Normallik reddedildi (Anderson-Darling p=${r.adP!.toFixed(3)}). Dağılımı "Non-normal" seçin veya veriyi inceleyin.`);
  } else if (r.method === 'Percentile' && r.ppk == null) {
    r.verdict = 'INSUFFICIENT DATA';
  } else if (r.normal == null) {
    r.verdict = 'INSUFFICIENT DATA';
  } else {
    r.verdict = 'VALID';
  }
  const idxForTarget = r.cpk ?? r.ppk;
  if (r.verdict === 'VALID' && settings.targetCpk != null && idxForTarget != null) r.meetsTarget = idxForTarget >= settings.targetCpk;
  return r;
}

export function verdictText(a: CapabilityAnalysis, targetCpk: number | null): string {
  const idx = a.cpk ?? a.ppk;
  const t = a.verdict !== 'VALID' ? '' : targetCpk == null ? ' · Hedef Cpk VERİ YOK' : a.meetsTarget ? ` · Uygun (≥ ${targetCpk})` : ` · Yetersiz (< ${targetCpk})`;
  return `${a.verdict}${idx != null && a.verdict === 'VALID' ? ` (${a.cpk != null ? 'Cpk' : 'Ppk'} ${idx.toFixed(2)})` : ''}${t}`;
}
