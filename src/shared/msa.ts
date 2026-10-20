// v4-cap: Yapılandırılmış MSA değerlendirmesi (IAQG SCMH MSA webinar, 5 Aralık 2019).
// Çözünürlük 10:1 (p30), doğruluk/TUR 4:1 (p17–19, p31), kararlılık ≥10× doğruluk (p31), GR&R tasarımı
// en az 5 parça / 2 operatör (p33–34). GR&R kabul limiti verilmez (p35–36): müşteri kriteri, yoksa VERİ YOK.
import { DEFAULT_MSA_CRITERIA } from './capDefaults';
import type { ControlPlanRow, MsaRow, Project, Settings } from './types';

export const NO_DATA = 'VERİ YOK – doğrulanmalı';

export const MSA_LISTS = {
  measType: ['Değişken – boyutsal', 'Değişken – proses parametresi', 'Nitel – görsel', 'Nitel – go/no-go', 'NDT', 'Yazılıma bağlı', 'Çoklu cihaz sistemi'],
  msaStatus: ['Planned', 'Planned (re-study)', 'In Progress', 'Acceptable', 'Conditionally acceptable', 'Not acceptable'],
  msaStudy: ['Gage R&R', 'Bias', 'Linearity', 'Stability', 'Calibration', 'Attribute Agreement Analysis', 'Measurement Uncertainty Analysis', 'Software Analysis', 'MSA by reference'],
  trigger: ['NPI', 'Design change', 'Escape', 'New test', 'KC', 'Unexplained', 'Gauge change', 'Method change', 'Control plan addition'],
  linearity: ['OK', 'NOK'],
  custBasis: ['%Tolerance', '%Study Var'],
};

const hasText = (s: string | undefined | null) => !!s && s.trim() !== '' && !/^VERİ YOK/i.test(s.trim());

/** Ölçüm yöntemine göre MSA çalışma önerisi (engine.suggestMsaStudy ile aynı sınıflama; döngüsel import olmaması için burada). */
export function msaStudyFor(method: string): { study: string; dataType: '' | 'Variable' | 'Attribute' } {
  const m = (method ?? '').toLowerCase();
  if (!m || /veri yok/.test(m)) return { study: '', dataType: '' };
  if (/görsel|visual|go.?no.?go|tapa|pim mastar|limit numune|attribute|tap test|pass\/fail/.test(m)) return { study: 'Attribute Agreement Analysis', dataType: 'Attribute' };
  if (/termokupl|thermocouple|sıcaklık|temperature|basınç|pressure|vakum|vacuum|transdüser|data ?logger/.test(m)) return { study: 'Calibration', dataType: 'Variable' };
  if (/cmm|mikrometre|micrometer|kumpas|caliper|komparatör|bore|ultrason|thickness|kalınlık|profilometre|terazi|tork|torque|gauge|ölçer/.test(m)) return { study: 'Gage R&R', dataType: 'Variable' };
  return { study: '', dataType: '' };
}

/** "6.00–6.10", "6.0-6.1", "10 ±0.2", "±0.05" → tolerans aralığı genişliği. Belirsizse null. */
export function toleranceFromSpec(spec: string): number | null {
  const s = (spec ?? '').replace(/,/g, '.');
  let m = /(-?\d+(?:\.\d+)?)\s*(?:–|—|-|\.\.|to)\s*(-?\d+(?:\.\d+)?)/.exec(s);
  if (m) {
    const a = Number(m[1]), b = Number(m[2]);
    if (b > a) return b - a;
  }
  m = /±\s*(\d+(?:\.\d+)?)/.exec(s);
  if (m) return 2 * Number(m[1]);
  return null;
}

export interface MsaCriterion {
  maxGrr: number | null;
  basis: '%Tolerance' | '%Study Var';
  minNdc: number | null;
  minKappa: number | null;
  source: string;
  fromRow: boolean;
}

export function msaCriterion(row: MsaRow, settings: Pick<Settings, 'msaCriteria'>): MsaCriterion {
  const s = settings.msaCriteria ?? DEFAULT_MSA_CRITERIA;
  const fromRow = row.custMaxGrr != null || row.custMinNdc != null || row.custMinKappa != null;
  return {
    maxGrr: row.custMaxGrr ?? s.maxGrrPct,
    basis: (row.custBasis || s.basis) as MsaCriterion['basis'],
    minNdc: row.custMinNdc ?? s.minNdc,
    minKappa: row.custMinKappa ?? s.minKappa,
    source: (fromRow ? row.custSource : s.source) || '',
    fromRow,
  };
}

export interface MsaEvaluation {
  tolerance: number | null;
  toleranceFrom: string;
  resolutionRatio: number | null;
  tur: number | null;
  stabilityOk: boolean | null;
  /** ENGINEERING WARNING listesi (gauge seçimi ve GR&R tasarımı). */
  warnings: string[];
  /** MSA akışı yönlendirmeleri (yazılım, çoklu cihaz, referans). */
  flow: string[];
  criterionText: string;
  /** Sonucun müşteri kriterine göre önerilen yorumu – durum alanını değiştirmez. */
  verdict: 'Kriteri karşılıyor (öneri)' | 'Kriteri karşılamıyor (öneri)' | 'VERİ YOK – müşteri kriteri tanımlı değil' | 'Sonuç VERİ YOK' | '';
}

const f = (v: number, d = 1) => (Number.isInteger(v) ? String(v) : v.toFixed(d));

export function evaluateMsa(row: MsaRow, p: Pick<Project, 'settings' | 'controlPlan' | 'msa'>): MsaEvaluation {
  const s = p.settings.msaCriteria ?? DEFAULT_MSA_CRITERIA;
  const cp = p.controlPlan.find((c: ControlPlanRow) => c.id === row.cpId);
  let tolerance = row.tolerance;
  let toleranceFrom = tolerance != null ? 'MSA satırı' : '';
  if (tolerance == null && cp) {
    tolerance = toleranceFromSpec(cp.tolerance) ?? toleranceFromSpec(cp.specification);
    if (tolerance != null) toleranceFrom = `${cp.id} spesifikasyonu`;
  }
  const out: MsaEvaluation = { tolerance, toleranceFrom, resolutionRatio: null, tur: null, stabilityOk: null, warnings: [], flow: [], criterionText: '', verdict: '' };
  const attr = row.dataType === 'Attribute' || /^Nitel/.test(row.measType);

  if (!attr) {
    if (tolerance == null) out.warnings.push('Tolerans aralığı VERİ YOK – çözünürlük ve TUR oranı hesaplanamaz.');
    if (row.resolution != null && row.resolution > 0 && tolerance != null) {
      out.resolutionRatio = tolerance / row.resolution;
      if (out.resolutionRatio < s.resolutionRatio) out.warnings.push(`Çözünürlük oranı ${f(out.resolutionRatio)}:1 < ${s.resolutionRatio}:1 (MSA p30) – başka cihaz seçin veya aksiyon alın.`);
    } else if (row.resolution == null) out.warnings.push('Cihaz çözünürlüğü VERİ YOK (MSA adım 2).');
    if (row.gaugeUncertainty != null && row.gaugeUncertainty > 0 && tolerance != null) {
      out.tur = tolerance / 2 / row.gaugeUncertainty;
      if (out.tur < s.tur) out.warnings.push(`TUR ${f(out.tur)}:1 < ${s.tur}:1 (MSA p17–19, p31; müşteri oranı belirleyebilir).`);
    } else if (row.gaugeUncertainty == null) out.warnings.push('Ölçüm belirsizliği VERİ YOK (MSA adım 3).');
    if (row.stabilityDrift != null && row.gaugeUncertainty != null && row.gaugeUncertainty > 0) {
      out.stabilityOk = row.stabilityDrift * 10 <= row.gaugeUncertainty;
      if (!out.stabilityOk) out.warnings.push('Kararlılık (kalibrasyon geçmişi sapması) doğruluğun en az 10 katı iyi değil (MSA p31).');
    }
    if (row.linearity === 'NOK') out.warnings.push('Doğrusallık uygun değil (MSA adım 4A).');
  }
  if (!row.calibrationVerified && (row.study === 'Gage R&R' || row.grrParts != null)) out.warnings.push('GR&R öncesi kalibrasyon doğrulanmalı (MSA p33).');
  if (row.calibrationDue && row.calibrationDue < new Date().toISOString().slice(0, 10)) out.warnings.push(`Kalibrasyon tarihi geçmiş (${row.calibrationDue}).`);
  if (row.grrParts != null && row.grrParts < 5) out.warnings.push(`GR&R parça sayısı ${row.grrParts} < 5 (MSA p33: önerilen 10, en az 5).`);
  if (row.grrOperators != null && row.grrOperators < 2) out.warnings.push(`GR&R operatör sayısı ${row.grrOperators} < 2 (MSA p33).`);
  if (row.grrTrials != null && row.grrTrials < 2) out.warnings.push(`Tekrar sayısı ${row.grrTrials} < 2: tekrarlanabilirlik ölçülemez (önerilen 2-10-2, MSA p34).`);

  if (row.softwareDependent) out.flow.push('Yazılıma bağlı sistem → yazılım analizi (MSA adım 7A/8).');
  if (row.multiGauge || row.measType === 'Çoklu cihaz sistemi') out.flow.push('Çoklu cihaz / ekipman ana varyasyon kaynağı → ölçüm belirsizliği analizi (MSA adım 7B/9).');
  if (row.refMsaId) {
    const ref = p.msa.find((m) => m.id === row.refMsaId);
    out.flow.push(ref?.status === 'Acceptable' ? `Aynı/benzer kararlı sistem: ${ref.id} referans alındı (MSA adım 5–6).` : `Referans ${row.refMsaId} kabul edilmiş değil – referansla MSA geçersiz.`);
  }

  const c = msaCriterion(row, p.settings);
  const parts: string[] = [];
  if (attr) {
    if (c.minKappa != null) parts.push(`kappa ≥ ${c.minKappa}`);
  } else {
    if (c.maxGrr != null) parts.push(`GR&R ≤ %${c.maxGrr} (${c.basis})`);
    if (c.minNdc != null) parts.push(`ndc ≥ ${c.minNdc}`);
  }
  out.criterionText = parts.length ? `${parts.join(', ')}${c.source ? ` – ${c.source}` : ' – kaynak VERİ YOK'}` : 'VERİ YOK – müşteri kriteri tanımlı değil (MSA p36)';
  const grr = c.basis === '%Study Var' ? row.pctStudyVar : row.pctTolerance;
  if (row.study && !/Gage R&R|Attribute Agreement/.test(row.study) && row.grrParts == null) return out;
  if (!parts.length) out.verdict = row.pctStudyVar != null || row.pctTolerance != null || row.ndc != null || row.kappa != null ? 'VERİ YOK – müşteri kriteri tanımlı değil' : '';
  else {
    const checks: (boolean | null)[] = attr
      ? [c.minKappa != null ? (row.kappa == null ? null : row.kappa >= c.minKappa) : true]
      : [c.maxGrr != null ? (grr == null ? null : grr <= c.maxGrr) : true, c.minNdc != null ? (row.ndc == null ? null : row.ndc >= c.minNdc) : true];
    out.verdict = checks.some((x) => x === false) ? 'Kriteri karşılamıyor (öneri)' : checks.some((x) => x === null) ? 'Sonuç VERİ YOK' : 'Kriteri karşılıyor (öneri)';
  }
  return out;
}

/** Status "Acceptable" ama sayısal sonuç yok mu? */
export function acceptableWithoutResult(row: MsaRow): boolean {
  if (row.status !== 'Acceptable' || row.refMsaId) return false;
  const nums = [row.pctStudyVar, row.pctTolerance, row.ndc, row.kappa, row.effectiveness].some((v) => v != null);
  return !nums && !/\d/.test(row.result ?? '');
}

/** Ölçüm yöntemi veya cihazı tanımlı kontrol planı satırı MSA ile kapsanıyor mu? (MSA p26: her ölçüm tipi) */
export function msaCovers(p: Pick<Project, 'msa'>, cp: ControlPlanRow): boolean {
  const g = (cp.gauge || '').trim().toLowerCase();
  return p.msa.some((m) => m.cpId === cp.id || (!!g && m.gauge.trim().toLowerCase() === g));
}

export function needsMsa(cp: ControlPlanRow): boolean {
  return !cp.capId && (hasText(cp.gauge) || hasText(cp.method));
}
