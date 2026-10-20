// IAQG SCMH puanlama tabloları ve SCMH önceliklendirme kuralı.
// Kriterler SCMH 7.2.10 DFMEA şablonunun D-SEV / D-OCC / D-DET sekmelerinden ve SCMH 7.2.11 PFMEA
// şablonunun P-SEV / P-OCC / P-DET sekmelerinden kısaltılarak aktarılmıştır (İngilizce, şablondaki gibi).
// Şablonun kendisi © IAQG; burada yalnızca kriter özetleri yer alır.
import type { ControlPlanRow, DfmeaRow, PfmeaRow, ProcessStepRow, Project, Score, Scoring, ScoringEntry } from './types';
import { isInactive, kcDisplayNo } from './kcScmh'; // v4-kc
import { cpClassification, rowClassification, stepClassification } from './kcTrace'; // v4-kc

export type ScoringStandard = 'SCMH' | 'AIAG-VDA';

// D-SEV (Modified from J1739) – rank 10 … 1
const D_SEV = [
  'Safety/Regulatory – Potentially hazardous failure without warning; affects safe operation of the product or causes regulatory non-compliance.',
  'Safety/Regulatory – Potentially hazardous failure with warning; affects safe operation, causes regulatory non-compliance or significantly reduces safety margins.',
  'Primary function – Product is not operational; safety not compromised. Major customer dissatisfaction and severe disruptions.',
  'Primary function – Operability severely affected; primary functions/systems may be degraded. High customer dissatisfaction or severe disruptions.',
  'Secondary function – Operability significantly degraded; secondary systems may be inoperable. Significant customer dissatisfaction or disruptions.',
  'Secondary function – Moderate effect on operability; secondary systems may be degraded / do not conform. Customer dissatisfaction, operational disruption.',
  'Annoyance – Moderate effect on operability; non-compliance to functional requirement although all systems operational. Noticed by most customers, in-service repair.',
  'Annoyance – Minor effect on operability; non-compliance to functional requirement. Noticed by many customers, action at next overhaul.',
  'Awareness – Slight effect on operability; non-compliance to functional requirement. Noticed by few customers, additional overhaul cost.',
  'No effect – No discernible effect on product operation.',
];

// P-SEV (Modified from J1739 / AS13004) – ürün (müşteri) etkisi / proses etkisi
const P_SEV = [
  'Safety/Regulatory – Product: affects safe operation and/or regulatory non-compliance without warning. Process: may endanger operator, machine or assembly without warning.',
  'Safety/Regulatory – Product: affects safe operation and/or regulatory non-compliance with warning. Process: may endanger operator, machine or assembly with warning.',
  'Loss of primary function – Product inoperable, does not affect safe operation. Process (major disruption): 100% of product may be scrapped; line shutdown or stop ship.',
  'Degradation of primary function – Product operable at reduced performance. Process (significant disruption): a portion of the run may be scrapped; deviation from primary process.',
  'Loss of secondary function – Product operable, service life greatly reduced / convenience items inoperable. Process (moderate disruption): 100% of the run may be reworked off line.',
  'Degradation of secondary function – Appearance affected / convenience items at reduced level. Process (moderate disruption): a proportion of the run may be reworked off line.',
  'Annoyance – Appearance, fit and finish do not conform, noticed by most customers (>75%). Process: 100% of the run may be reworked in station.',
  'Annoyance – Appearance, fit and finish do not conform, noticed by about half of customers (50%). Process: a proportion of the run may be reworked in station.',
  'Annoyance – Appearance, fit and finish do not conform, noticed by discriminating customers (<25%). Process (minor disruption): slight inconvenience to process or operator.',
  'No effect – No discernible effect on product or process.',
];

// D-OCC (Modified from J1739) – Probability of Design Error
const D_OCC = [
  'Inevitable – No guiding practices for this technology; design system developed for the first time; new technology with no history of successful application.',
  'Almost Inevitable – Very limited guiding practices from other industries; new technology with only limited relevance/application in other industries.',
  'Highly Likely – Some standard practices from other industries; new technology with moderate amount of successful relevant application.',
  'Likely – Existing standard methods not applicable; existing technology but extremely different duty cycle/conditions; past experience of limited to no relevance.',
  'Possible – Existing standard methods only partly applicable; highly different duty cycle/conditions; past experience of partial relevance.',
  'Plausible – Existing standard methods moderately applicable; moderate differences in duty cycle/conditions; past experience of moderate relevance.',
  'Unlikely – Existing standard methods highly applicable; slight differences in duty cycle/conditions; past experience of good relevance.',
  'Highly Unlikely – Similar successful past experience guiding design; minor differences in duty cycle/conditions.',
  'Extremely Unlikely – Design error significantly minimized by prevention controls; identical, highly relevant, successful past experience; no differences in application.',
  'Prevented – Design error physically impossible or eliminated through prevention controls; extensive identical, highly relevant, successful past experience.',
];

// P-OCC (J1739 / AS13004 low volume production) – Likelihood of Cause
const P_OCC = [
  'Very High – 100% of production (>1 per occurrence per shift).',
  'High – 50% of production (>1 per occurrence per day).',
  'High – 20% of production (>1 per 2–3 days).',
  'High – 10% of production (>1 per week).',
  'Moderate – 5% of production (1 per month).',
  'Moderate – 0.5% of production (2 per year).',
  'Moderate – 0.1% of production (1 per year).',
  'Low – 0.05% of production (1 per 5 years).',
  'Low – 0.01% of production (1 per 10 years).',
  'Very Low – Less than 0.01% of production (<1 per 10 years); eliminated through preventive controls.',
];

// D-DET (Modified from J1739) – Likelihood of Detection by Design Control
const D_DET = [
  'Will not detect – No current design control; design control will not and/or cannot detect the failure cause/mechanism.',
  'Not likely to detect / post Production Launch – Analysis/detection controls not likely to detect; testing post launch, low-fidelity uncorrelated virtual analysis.',
  'Post Design Freeze, prior to Launch – Detected in product verification/validation with "pass/fail" testing or uncorrelated late detailed analysis.',
  'Post Design Freeze, prior to Launch – Detected in product verification/validation with "test to failure" testing or late partially correlated analysis.',
  'Post Design Freeze, prior to Launch – Detected in product verification/validation with "degradation" testing or correlated late detailed analysis.',
  'Prior to Design Freeze – Detected using "pass/fail" testing or uncorrelated detailed analysis.',
  'Prior to Design Freeze – Detected using "test to failure" testing or partially correlated detailed analysis.',
  'Prior to Design Freeze – Detected using degradation testing or correlated detailed analysis.',
  'Robust Early Detection – Controls virtually assured to detect; early virtual analysis highly correlated with actual/expected operating conditions.',
  'Failure Prevented; Detection not applicable – Cause cannot occur, fully prevented through preventive design controls (proven design standard, best practice, common material).',
];

// P-DET (Modified from J1739 / AS13004) – Likelihood of Detection by Process Control
const P_DET = [
  'Absolute Uncertainty – No current process control; cannot detect or compliance analysis is not performed.',
  'Difficult to Detect – Defect and/or error not easily detected (e.g. random audits).',
  'Defect Detection Post Processing – Operator visual/tactile/audible detection post-processing, no boundary samples.',
  'Defect Detection at Source – Operator visual/tactile/audible detection in-station, or post-processing attribute gauging (go/no-go) with no boundary samples.',
  'Defect Detection Post Processing – Operator variable gauging post-processing, or in-station attribute gauging with boundary samples.',
  'Defect Detection at Source – In-station variable gauging, or automated controls that detect and notify operator; gauging on setup and first-piece check.',
  'Defect Detection Post Processing – Automated controls detect discrepant part post-processing and lock part to prevent further processing.',
  'Defect Detection at Source – Automated controls detect discrepant part in-station and automatically lock part in station.',
  'Error Detection and/or Defect Prevention – Automated in-station controls detect the error (cause) and prevent the discrepant part from being made.',
  'Detection not applicable – Error (cause) prevented by fixture design, machine design or part design.',
];

function table(df: string[], pf: string[]): ScoringEntry[] {
  return df.map((t, i) => ({ rank: 10 - i, df: t, pf: pf[i] }));
}

/**
 * SCMH tabloları (DFMEA metni `df`, PFMEA metni `pf`), rank 10 … 1.
 * SCMH'de Action Priority yoktur; öncelik `scmhPriority` ile belirlenir. apTable boş bırakılır.
 */
export const SCMH_SCORING: Scoring = {
  severity: table(D_SEV, P_SEV),
  occurrence: table(D_OCC, P_OCC),
  detection: table(D_DET, P_DET),
  apTable: null,
};

// ------------------------------------------------------------------ öncelik (SCMH kuralı)
// Karar 2026-10-14: RPN eşiği karar kriteri olarak kullanılmaz (DFMEA Guidance O19: "RPN thresholds
// (as a decision criteria) should not be implemented"). S 9–10 olan her satır RPN'den bağımsız incelenir
// (Guidance Q19). Sonra RPN, eşitlikte S×O (criticality number, Guidance N19) ile sıralanır.

const valid = (v: Score): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10;

type Sod = Pick<DfmeaRow | PfmeaRow, 's' | 'o' | 'd'>;

export interface ScmhPriority {
  /** S 9–10: RPN'den bağımsız olarak incelenmeli. */
  review: boolean;
  /** Sıralama anahtarı: büyük olan önce. S 9–10 satırları her zaman diğerlerinin önündedir. */
  rank: number;
  reason: string;
  // v4-risk: SCMH 7.2.3 p59 / Q&A Q21: RPN, SO ve SD ile önceliklendirme; p63 O×D de anılır. Eşik yoktur.
  rpn: number | null;
  so: number | null;
  sd: number | null;
  od: number | null;
}

export function scmhRpn(s: Score, o: Score, d: Score): number | null {
  return valid(s) && valid(o) && valid(d) ? s * o * d : null;
}

export function scmhCriticality(s: Score, o: Score): number | null {
  return valid(s) && valid(o) ? s * o : null;
}

/** v4-risk: Severity × Detection (SD), SCMH 7.2.3 p59 "Severity Detection (SD)". */
export function scmhSeverityDetection(s: Score, d: Score): number | null {
  return valid(s) && valid(d) ? s * d : null;
}

/** v4-risk: Occurrence × Detection, SCMH 7.2.3 p63 "Detection x Occurrence". */
export function scmhOccDetection(o: Score, d: Score): number | null {
  return valid(o) && valid(d) ? o * d : null;
}

/** v4-risk: SCMH sıralama ölçütleri. */
export type ScmhMeasure = 'rpn' | 'so' | 'sd';
export const SCMH_MEASURES: { key: ScmhMeasure; label: string }[] = [
  { key: 'rpn', label: 'RPN' },
  { key: 'so', label: 'S×O' },
  { key: 'sd', label: 'S×D' },
];

/** v4-risk: seçilen ölçüte göre sıralama (S 9–10 bandı her zaman önde; eşitlikte RPN, sonra ID). */
export function scmhSortBy<T extends Sod & { id: string }>(rows: T[], m: ScmhMeasure): T[] {
  const key = (r: T) => {
    const p = scmhPriority(r);
    return (p.review ? 1_000_000 : 0) + (p[m] ?? 0) * 1000 + (m === 'rpn' ? (p.so ?? 0) : (p.rpn ?? 0) / 1000);
  };
  return [...rows].sort((a, b) => key(b) - key(a) || a.id.localeCompare(b.id));
}

/** SCMH önceliği. rank = review bandı × 10^6 + RPN × 10^3 + S×O (puan eksikse yalnızca mevcut kısım). */
export function scmhPriority(row: Sod): ScmhPriority {
  const review = valid(row.s) && row.s >= 9;
  const r = scmhRpn(row.s, row.o, row.d);
  const so = scmhCriticality(row.s, row.o);
  const rank = (review ? 1_000_000 : 0) + (r ?? 0) * 1000 + (so ?? 0);
  const parts: string[] = [];
  if (review) parts.push(`S=${row.s}: RPN'den bağımsız incelenmeli (SCMH)`);
  if (r != null) parts.push(`RPN ${r}`);
  if (so != null) parts.push(`S×O ${so}`);
  if (!valid(row.s) || !valid(row.o) || !valid(row.d)) parts.push('S/O/D eksik – puanlanmalı');
  const sd = scmhSeverityDetection(row.s, row.d); // v4-risk
  if (sd != null) parts.push(`S×D ${sd}`); // v4-risk
  return { review, rank, reason: parts.join('; '), rpn: r, so, sd, od: scmhOccDetection(row.o, row.d) };
}

/** Satırları SCMH önceliğine göre sıralar (kopya döndürür; S 9–10 → RPN → S×O, eşitlikte ID). */
export function scmhSort<T extends Sod & { id: string }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => scmhPriority(b).rank - scmhPriority(a).rank || a.id.localeCompare(b.id));
}

/** Kısa yol: projede SCMH standardı mı seçili? */
export const isScmh = (p: Pick<Project, 'settings'>) => (p.settings.scoringStandard ?? 'AIAG-VDA') === 'SCMH';

// ------------------------------------------------------------------ Classification sütunu
// Şablon rehberi (DFMEA P18/P19, PFMEA Q17, PFD N14, CP I19): "Enter a unique ID for special requirements
// such as a Key Characteristic (KC), Critical Items (CI), or items requiring additional design or process
// controls. Ensure traceability across DFMEA, Process Flow Diagram, PFMEA and Control Plan."
// Yani sütun bir sembol değil, benzersiz bir ID taşır (örn. KC-1, CI-3). Uygulamada KC ID'leri kullanılır.

export const SCMH_CLASS_KINDS = [
  { code: 'KC', label: 'Key Characteristic' },
  { code: 'CI', label: 'Critical Item' },
] as const;

// v4-kc: Classification artık KC ve CI numaralarını (PN-KC-XXX / PN-CI-XXX) taşır; DFMEA KC'leri PFMEA'ya dfIds
// bağlantısıyla, PFD'ye adımın PFMEA/KP satırlarıyla akar (kcTrace.ts). Elenen ve reddedilen kayıtlar yazılmaz;
// kesinleşmemiş olanlar "Potential: …" olarak yazılır.

/** Classification sütunu için seçenekler: projedeki etkin KC ve CI numaraları. */
export function scmhClassOptions(p: Pick<Project, 'kcs'>): string[] {
  return p.kcs.filter((k) => !isInactive(k)).map((k) => kcDisplayNo(k));
}

/** Bir FMEA satırına bağlı / akan KC-CI numaraları (Classification hücresi metni, "; " ile). Yoksa ''. */
export function scmhClassificationOf(p: Pick<Project, 'kcs'> & Partial<Project>, rowId: string): string {
  return rowClassification(p, rowId);
}

/** Kontrol planı satırının Classification metni (CP sütun I). */
export function scmhCpClassification(p: Pick<Project, 'kcs'> & Partial<Project>, c: ControlPlanRow): string {
  return cpClassification(p, c);
}

/** PFD adımının Classification metni (PFD sütun N), adımda elle girilmiş değer yoksa. */
export function scmhStepClassification(p: Pick<Project, 'kcs'> & Partial<Project>, st: ProcessStepRow): string {
  return stepClassification(p, st);
}

/** SCMH öncelik kuralı yardımcıları tek nesnede. */
export const SCMH_PRIORITY = {
  /** Bu S ve üzeri RPN'den bağımsız incelenir. */
  reviewSeverity: 9,
  /** RPN eşiği kullanılmaz. */
  rpnThreshold: null,
  priority: scmhPriority,
  sort: scmhSort,
  rpn: scmhRpn,
  criticality: scmhCriticality,
  severityDetection: scmhSeverityDetection, // v4-risk
} as const;
