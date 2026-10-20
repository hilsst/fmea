// Capability Validation Engine (§31): Cp/Cpk/Pp/Ppk yalnızca geçerlilik koşulları sağlanırsa yorumlanır.
// v4-cap: Xbar-s (alt grup > 10), R/s/MR kartı kontrolü, alt grup sayısı minimumu, trend kuralı,
// beklenen PPM / Z.bench / sigma seviyesi ve nitel (attribute) capability (IAQG SCMH CAP webinar 7 Ocak 2020).
import { DEFAULT_MIN_SUBGROUPS } from './capDefaults';
import type { Settings } from './types';

export type CapVerdict = 'VALID' | 'INVALID' | 'INSUFFICIENT DATA';
export type ChartMethod = 'I-MR' | 'Xbar-R' | 'Xbar-s' | 'Percentile' | '';

export interface ControlLimits {
  /** Konum kartı (I veya Xbar) */
  center: number;
  ucl: number;
  lcl: number;
  /** Dağılım kartı (MR, R veya s) */
  dispLabel: 'MR' | 'R' | 's';
  dispCenter: number;
  dispUcl: number;
  dispLcl: number;
}

export interface RuleHit {
  rule: string;
  points: number[];
}

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
  /** Konum kartında kontrol dışı noktalar (1 tabanlı; alt grup kartında alt grup no). */
  outOfControl: number[];
  method: ChartMethod;
  minSamples: number;
  verdict: CapVerdict;
  /** Hedef karşılaştırması: geçerli değilse boş. */
  meetsTarget: boolean | null;
  reasons: string[];
  // v4-cap
  /** Alt grup sayısı (I-MR'da bireysel değer sayısı). */
  subgroups: number;
  minSubgroups: number;
  /** CAP p46 karar ağacına göre kart seçimi gerekçesi. */
  chartWhy: string;
  limits: ControlLimits | null;
  /** Dağılım kartında (MR/R/s) kontrol dışı noktalar – CAP p49 "loss of signal". */
  dispersionOoc: number[];
  ruleHits: RuleHit[];
  /** Normal model beklenen PPM (σ within / σ overall) ve gözlenen PPM. */
  ppmWithin: number | null;
  ppmOverall: number | null;
  ppmObserved: number | null;
  /** Z.bench = Φ⁻¹(1 − toplam uygunsuzluk oranı), overall σ. */
  zBench: number | null;
  /** CAP p18: "Sigma Score ~ 3 x Cpk" (yaklaşık). */
  sigmaLevel: number | null;
}

const D2: Record<number, number> = { 2: 1.128, 3: 1.693, 4: 2.059, 5: 2.326, 6: 2.534, 7: 2.704, 8: 2.847, 9: 2.97, 10: 3.078 };
const A2: Record<number, number> = { 2: 1.88, 3: 1.023, 4: 0.729, 5: 0.577, 6: 0.483, 7: 0.419, 8: 0.373, 9: 0.337, 10: 0.308 };
// R kartı sabitleri (AIAG SPC 2. baskı Ek E)
const D3: Record<number, number> = { 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0.076, 8: 0.136, 9: 0.184, 10: 0.223 };
const D4: Record<number, number> = { 2: 3.267, 3: 2.574, 4: 2.282, 5: 2.114, 6: 2.004, 7: 1.924, 8: 1.864, 9: 1.816, 10: 1.777 };
export const DEFAULT_MIN_SAMPLES = 25;
/** Bu boyuta kadar Xbar-R, üzeri Xbar-s (CAP p46 "> 9 → Xbar-s"; V3 ile uyum için 10 Xbar-R kalır). */
export const XBAR_R_MAX = 10;
/** Nelson kural 3: art arda 6 nokta sürekli artan/azalan (CAP p32–36 "trends"). */
const TREND_RUN = 6;
const SAME_SIDE_RUN = 8;

// Standart normal CDF (Abramowitz-Stegun 7.1.26)
function phi(z: number) {
  const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(z * z) / 2);
  return z >= 0 ? (1 + y) / 2 : (1 - y) / 2;
}

/** Ters standart normal (Acklam). */
export function invPhi(q: number): number {
  if (!(q > 0 && q < 1)) return q <= 0 ? -Infinity : Infinity;
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const pl = 0.02425;
  if (q < pl) {
    const r = Math.sqrt(-2 * Math.log(q));
    return (((((c[0] * r + c[1]) * r + c[2]) * r + c[3]) * r + c[4]) * r + c[5]) / ((((d[0] * r + d[1]) * r + d[2]) * r + d[3]) * r + 1);
  }
  if (q > 1 - pl) return -invPhi(1 - q);
  const r0 = q - 0.5, r = r0 * r0;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * r0) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

function lnGamma(x: number): number {
  const g = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
  let y = x;
  const tmp = x + 5.5 - (x + 0.5) * Math.log(x + 5.5);
  let ser = 1.000000000190015;
  for (const gi of g) ser += gi / ++y;
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

/** c4(n) = √(2/(n−1)) · Γ(n/2) / Γ((n−1)/2) */
export function c4(n: number): number {
  return Math.sqrt(2 / (n - 1)) * Math.exp(lnGamma(n / 2) - lnGamma((n - 1) / 2));
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

/** Konum kartı kuralları: 3σ dışı, 8 nokta aynı taraf, 6 nokta trend. Noktalar 1 tabanlı. */
export function runRules(points: number[], center: number, ucl: number, lcl: number): RuleHit[] {
  const hits: RuleHit[] = [];
  const beyond = points.map((v, i) => (v > ucl || v < lcl ? i + 1 : 0)).filter(Boolean);
  if (beyond.length) hits.push({ rule: '3σ kontrol limiti dışında', points: beyond });
  const side: number[] = [];
  let run = 0, prev = 0;
  for (let i = 0; i < points.length; i++) {
    const s = Math.sign(points[i] - center);
    run = s !== 0 && s === prev ? run + 1 : 1;
    prev = s;
    if (run >= SAME_SIDE_RUN) side.push(i + 1);
  }
  if (side.length) hits.push({ rule: `${SAME_SIDE_RUN} ardışık nokta merkezin aynı tarafında`, points: side });
  const trend: number[] = [];
  let up = 1, down = 1;
  for (let i = 1; i < points.length; i++) {
    up = points[i] > points[i - 1] ? up + 1 : 1;
    down = points[i] < points[i - 1] ? down + 1 : 1;
    if (up >= TREND_RUN || down >= TREND_RUN) trend.push(i + 1);
  }
  if (trend.length) hits.push({ rule: `${TREND_RUN} ardışık nokta sürekli artan/azalan (trend)`, points: trend });
  return hits;
}

function tailPpm(mean: number, sigma: number | null, lsl: number | null, usl: number | null): number | null {
  if (!(sigma != null && sigma > 0)) return null;
  let p = 0;
  if (usl != null) p += 1 - phi((usl - mean) / sigma);
  if (lsl != null) p += phi((lsl - mean) / sigma);
  return Math.max(p, 0) * 1e6;
}

export function capabilityAnalysis(
  values: number[],
  lsl: number | null,
  usl: number | null,
  target: number | null,
  settings: Pick<Settings, 'minSamples' | 'targetCpk'> & Partial<Pick<Settings, 'minSubgroups'>>,
  subgroupSize?: number | null,
  distribution?: string,
): CapabilityAnalysis {
  const n = values.length;
  const minSamples = settings.minSamples ?? DEFAULT_MIN_SAMPLES;
  const minSubgroups = settings.minSubgroups ?? DEFAULT_MIN_SUBGROUPS;
  const r: CapabilityAnalysis = {
    n, mean: null, sigmaWithin: null, sigmaOverall: null, cp: null, cpk: null, pp: null, ppk: null,
    unilateral: (lsl == null) !== (usl == null), ad: null, adP: null, normal: null, stable: null, outOfControl: [],
    method: '', minSamples, verdict: 'INSUFFICIENT DATA', meetsTarget: null, reasons: [],
    subgroups: 0, minSubgroups, chartWhy: '', limits: null, dispersionOoc: [], ruleHits: [],
    ppmWithin: null, ppmOverall: null, ppmObserved: null, zBench: null, sigmaLevel: null,
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

  // Kararlılık ve σ within – kart seçimi CAP p46: alt grup yok → I-MR, ≤ 10 → Xbar-R, > 10 → Xbar-s
  const k = subgroupSize && subgroupSize >= 2 ? Math.round(subgroupSize) : 1;
  if (k > 1) {
    const groups: number[][] = [];
    for (let i = 0; i + k <= n; i += k) groups.push(values.slice(i, i + k));
    r.subgroups = groups.length;
    if (n % k) r.reasons.push(`Son ${n % k} ölçüm tam alt grup oluşturmadığı için kararlılık analizine alınmadı.`);
    const useS = k > XBAR_R_MAX;
    r.method = useS ? 'Xbar-s' : 'Xbar-R';
    r.chartWhy = useS ? `Alt grup ${k} > ${XBAR_R_MAX} → Xbar-s (CAP p46)` : `Alt grup ${k} (2–${XBAR_R_MAX}) → Xbar-R (CAP p46)`;
    if (groups.length < 2) {
      r.reasons.push('Kararlılık için en az 2 alt grup gerekir.');
    } else {
      const xb = groups.map((g) => g.reduce((a, b) => a + b, 0) / k);
      const xbb = xb.reduce((a, b) => a + b, 0) / xb.length;
      let disp: number[], dc: number, ducl: number, dlcl: number, ucl: number, lcl: number;
      if (useS) {
        disp = groups.map((g, i) => Math.sqrt(g.reduce((a, b) => a + (b - xb[i]) ** 2, 0) / (k - 1)));
        dc = disp.reduce((a, b) => a + b, 0) / disp.length;
        const c = c4(k);
        r.sigmaWithin = dc / c;
        const a3 = 3 / (c * Math.sqrt(k));
        const w = (3 * Math.sqrt(1 - c * c)) / c;
        ucl = xbb + a3 * dc;
        lcl = xbb - a3 * dc;
        ducl = (1 + w) * dc;
        dlcl = Math.max(0, 1 - w) * dc;
      } else {
        disp = groups.map((g) => Math.max(...g) - Math.min(...g));
        dc = disp.reduce((a, b) => a + b, 0) / disp.length;
        r.sigmaWithin = dc / D2[k];
        ucl = xbb + A2[k] * dc;
        lcl = xbb - A2[k] * dc;
        ducl = D4[k] * dc;
        dlcl = D3[k] * dc;
      }
      r.limits = { center: xbb, ucl, lcl, dispLabel: useS ? 's' : 'R', dispCenter: dc, dispUcl: ducl, dispLcl: dlcl };
      r.ruleHits = runRules(xb, xbb, ucl, lcl);
      r.outOfControl = [...new Set(r.ruleHits.flatMap((h) => h.points))].sort((a, b) => a - b);
      r.dispersionOoc = disp.map((v, i) => (v > ducl || (dlcl > 0 && v < dlcl) ? i + 1 : 0)).filter(Boolean);
      if (r.dispersionOoc.length) r.ruleHits.push({ rule: `${useS ? 's' : 'R'} kartı kontrol dışı (sinyal kaybı, CAP p49)`, points: r.dispersionOoc });
    }
    if (groups.length < minSubgroups) r.reasons.push(`Alt grup sayısı (${groups.length}) minimumun (${minSubgroups}) altında – kontrol limitleri için 20–25 alt grup gerekir (CAP p38).`);
  } else {
    r.method = 'I-MR';
    r.subgroups = n;
    r.chartWhy = 'Rasyonel alt grup yok → I-MR, hareketli aralık 2 (CAP p39, p46)';
    const mrs: number[] = [];
    for (let i = 1; i < n; i++) mrs.push(Math.abs(values[i] - values[i - 1]));
    const mrbar = mrs.reduce((a, b) => a + b, 0) / mrs.length;
    r.sigmaWithin = mrbar / 1.128;
    const ucl = mean + 2.66 * mrbar, lcl = mean - 2.66 * mrbar;
    r.limits = { center: mean, ucl, lcl, dispLabel: 'MR', dispCenter: mrbar, dispUcl: D4[2] * mrbar, dispLcl: 0 };
    r.ruleHits = runRules(values, mean, ucl, lcl);
    r.outOfControl = [...new Set(r.ruleHits.flatMap((h) => h.points))].sort((a, b) => a - b);
    // MR noktası i, i ile i+1 ölçümleri arasındadır → ölçüm no (i+2) olarak raporlanır
    r.dispersionOoc = mrs.map((v, i) => (v > D4[2] * mrbar ? i + 2 : 0)).filter(Boolean);
    if (r.dispersionOoc.length) r.ruleHits.push({ rule: 'MR kartı kontrol dışı (sinyal kaybı, CAP p49)', points: r.dispersionOoc });
  }
  r.stable = r.sigmaWithin != null && r.limits ? r.outOfControl.length === 0 && r.dispersionOoc.length === 0 : null;

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
    // Beklenen PPM yalnızca normal model reddedilmediyse anlamlıdır (CAP p26–30)
    if (r.normal !== false) {
      r.ppmWithin = tailPpm(mean, r.sigmaWithin, lsl, usl);
      r.ppmOverall = tailPpm(mean, sd, lsl, usl);
      if (r.ppmOverall != null && r.ppmOverall > 0) r.zBench = -invPhi(r.ppmOverall / 1e6);
    }
  }
  r.ppmObserved = (values.filter((v) => (usl != null && v > usl) || (lsl != null && v < lsl)).length / n) * 1e6;
  const best = r.cpk ?? r.ppk;
  r.sigmaLevel = best != null ? 3 * best : null;
  if (r.unilateral) r.reasons.push('Tek taraflı tolerans: Cp/Pp hesaplanmaz, yalnızca Cpk/Ppk.');
  if (target != null && lsl != null && usl != null && (target < lsl || target > usl)) r.reasons.push('Hedef değer tolerans aralığının dışında.');
  if (target != null) r.reasons.push(`Ortalama hedeften sapma: ${(mean - target).toPrecision(3)}`);

  // Karar
  const fewSubgroups = k > 1 && r.subgroups < minSubgroups;
  if (n < minSamples || fewSubgroups) {
    r.verdict = 'INSUFFICIENT DATA';
    if (n < minSamples) r.reasons.unshift(`Örnek sayısı (${n}) minimumun (${minSamples}) altında.`);
    r.reasons.push('Küçük örnek: değerlendirme yöntemi için müşteriye danışın (CAP p19).');
  } else if (r.stable === false) {
    r.verdict = 'INVALID';
    r.reasons.unshift(`Proses kararlı değil (${r.method}: ${r.ruleHits.map((h) => `${h.rule}: ${h.points.slice(0, 8).join(', ')}`).join('; ')}). Capability yorumlanamaz.`);
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

// ───────────────────────── v4-cap: nitel (attribute) capability ─────────────────────────

export interface AttributeInput {
  kind: '' | 'Defectives' | 'Defects';
  /** Alt grup verisi "kusur/adet" çiftleri (örn. "2/50 0/50 1/48"); yoksa toplamlar kullanılır. */
  data: string;
  defects: number | null;
  units: number | null;
  opportunities: number | null;
}

export interface AttributeAnalysis {
  kind: 'Defectives' | 'Defects';
  chart: 'p' | 'np' | 'u' | 'c';
  chartWhy: string;
  subgroups: number;
  minSubgroups: number;
  defects: number;
  units: number;
  /** Uygunsuz oranı (Defectives) veya birim başına kusur (Defects). */
  rate: number | null;
  ppm: number | null;
  dpmo: number | null;
  /** Uzun dönem Z eşdeğeri = Φ⁻¹(1 − p); yalnızca Defectives için. */
  zEquivalent: number | null;
  stable: boolean | null;
  outOfControl: number[];
  verdict: CapVerdict;
  reasons: string[];
}

export function parseAttributeData(s: string): { d: number; n: number }[] {
  return [...(s ?? '').matchAll(/(\d+(?:[.,]\d+)?)\s*\/\s*(\d+(?:[.,]\d+)?)/g)]
    .map((m) => ({ d: Number(m[1].replace(',', '.')), n: Number(m[2].replace(',', '.')) }))
    .filter((x) => x.n > 0 && x.d >= 0);
}

/**
 * CAP p15–16, p46–48: nitel veri PPM / %kusur / DPMO ile tanımlanır; kart p/np (oran) veya c/u (sayım).
 * Cpk/Ppk değildir; AS9145 Tablo 1 bandı doğrudan uygulanmaz (müşteri kriteri gerekir).
 */
export function attributeCapability(inp: AttributeInput, settings: Partial<Pick<Settings, 'minSubgroups'>>): AttributeAnalysis {
  const kind = inp.kind || 'Defectives';
  const minSubgroups = settings.minSubgroups ?? DEFAULT_MIN_SUBGROUPS;
  const sg = parseAttributeData(inp.data);
  const defects = sg.length ? sg.reduce((a, b) => a + b.d, 0) : inp.defects ?? 0;
  const units = sg.length ? sg.reduce((a, b) => a + b.n, 0) : inp.units ?? 0;
  const constN = sg.length > 0 && sg.every((x) => x.n === sg[0].n);
  const chart = kind === 'Defectives' ? (constN ? 'np' : 'p') : constN ? 'c' : 'u';
  const r: AttributeAnalysis = {
    kind, chart, subgroups: sg.length, minSubgroups, defects, units, rate: null, ppm: null, dpmo: null, zEquivalent: null,
    stable: null, outOfControl: [], verdict: 'INSUFFICIENT DATA', reasons: [],
    chartWhy: `${kind === 'Defectives' ? 'Uygunsuz birim (oran)' : 'Kusur sayımı'}, ${constN ? 'sabit' : 'değişken'} alt grup boyutu → ${chart} kartı (CAP p46–48)`,
  };
  if (!(units > 0)) {
    r.reasons.push('Nitel veri yok: alt grupları "kusur/adet" olarak girin veya toplam kusur ve adet alanlarını doldurun.');
    return r;
  }
  if (kind === 'Defectives' && defects > units) {
    r.verdict = 'INVALID';
    r.reasons.push('Uygunsuz adet, toplam adetten büyük olamaz.');
    return r;
  }
  const rate = defects / units;
  r.rate = rate;
  if (kind === 'Defectives') {
    r.ppm = rate * 1e6;
    r.zEquivalent = rate > 0 && rate < 1 ? invPhi(1 - rate) : null;
  } else if (inp.opportunities != null && inp.opportunities > 0) {
    r.dpmo = (defects / (units * inp.opportunities)) * 1e6;
  } else r.reasons.push('DPMO için birim başına fırsat sayısı VERİ YOK.');
  if (sg.length >= 2) {
    // p/u kartı limitleri: p̄ ± 3√(p̄(1−p̄)/nᵢ), ū ± 3√(ū/nᵢ)
    r.outOfControl = sg
      .map((x, i) => {
        const v = x.d / x.n;
        const half = kind === 'Defectives' ? 3 * Math.sqrt((rate * (1 - rate)) / x.n) : 3 * Math.sqrt(rate / x.n);
        return v > rate + half || v < rate - half ? i + 1 : 0;
      })
      .filter(Boolean);
    r.stable = r.outOfControl.length === 0;
    if (sg.some((x) => x.n <= 30)) r.reasons.push('Nitel veride alt grup başına >30 birim önerilir (CAP p38).');
  } else r.reasons.push('Kararlılık için alt grup verisi ("kusur/adet") gerekir.');
  if (sg.length < minSubgroups) r.reasons.push(`Alt grup sayısı (${sg.length}) minimumun (${minSubgroups}) altında (CAP p38).`);
  if (r.stable === false) {
    r.verdict = 'INVALID';
    r.reasons.unshift(`${chart} kartı kontrol dışı alt grup: ${r.outOfControl.slice(0, 8).join(', ')}`);
  } else if (sg.length >= minSubgroups && r.stable === true) r.verdict = 'VALID';
  r.reasons.push('Nitel capability Cpk/Ppk değildir; mümkünse değişken veri kullanın (CAP p30). Kabul kriteri müşteriden alınmalı.');
  return r;
}
