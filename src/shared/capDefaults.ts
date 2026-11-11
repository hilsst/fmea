// v4-cap: capability / MSA alanlarının varsayılanları. Yaprak modül (yalnızca tip importu) – model.ts döngüsüz kullanır.
import type { CapAcceptance, CapabilityRow, MsaCriteria, MsaRow, Settings } from './types';

/**
 * AS9145 Tablo 1 (IAQG SCMH PPAP Overview webinar p26): Ppk/Cpk ≥ 1.33 kabul; 1.00 ≤ indeks < 1.33 kontrol metodu +
 * düzeltici faaliyet; < 1.00 ayrıca müşteri temsilcisiyle iletişim. Şirket/müşteri daha sıkı değer girebilir.
 */
export const AS9145_ACCEPTANCE: CapAcceptance = { accept: 1.33, conditional: 1.0, source: 'AS9145 Tablo 1 (SCMH PPAP webinar p26)' };

/** CAP webinar p38: "Between 20-25 subgroups is a minimum" – alt sınır 20 alınır. */
export const DEFAULT_MIN_SUBGROUPS = 20;

/**
 * MSA webinar: çözünürlük toleransın 10 katı (p30), doğruluk/TUR 4:1 (p17–19, p31).
 * GR&R / ndc / kappa limiti verilmez (p35–36 "Refer to your customer") → boş = VERİ YOK.
 */
export const DEFAULT_MSA_CRITERIA: MsaCriteria = {
  maxGrrPct: null,
  basis: '%Tolerance',
  minNdc: null,
  minKappa: null,
  resolutionRatio: 10,
  tur: 4,
  source: '',
};

export const CAP_SETTINGS_DEFAULTS: Pick<Settings, 'capAcceptance' | 'minSubgroups' | 'msaCriteria'> = {
  capAcceptance: { ...AS9145_ACCEPTANCE },
  minSubgroups: null,
  msaCriteria: { ...DEFAULT_MSA_CRITERIA },
};

type Extra<T, K extends keyof T> = Pick<T, K>;

export const MSA_V4_DEFAULTS: Extra<MsaRow,
  'measType' | 'tolerance' | 'resolution' | 'gaugeUncertainty' | 'stabilityDrift' | 'linearity' | 'calibrationRef' | 'calibrationDue' |
  'calibrationVerified' | 'softwareDependent' | 'multiGauge' | 'grrParts' | 'grrOperators' | 'grrTrials' | 'pctStudyVar' | 'pctTolerance' |
  'ndc' | 'kappa' | 'effectiveness' | 'custMaxGrr' | 'custBasis' | 'custMinNdc' | 'custMinKappa' | 'custSource' | 'trigger' | 'refMsaId' | 'actionId'> = {
  measType: '', tolerance: null, resolution: null, gaugeUncertainty: null, stabilityDrift: null, linearity: '', calibrationRef: '', calibrationDue: '',
  calibrationVerified: false, softwareDependent: false, multiGauge: false, grrParts: null, grrOperators: null, grrTrials: null, pctStudyVar: null,
  pctTolerance: null, ndc: null, kappa: null, effectiveness: null, custMaxGrr: null, custBasis: '', custMinNdc: null, custMinKappa: null, custSource: '',
  trigger: '', refMsaId: '', actionId: '',
};

export const CAP_V4_DEFAULTS: Extra<CapabilityRow,
  'dataKind' | 'attrKind' | 'defects' | 'units' | 'opportunities' | 'dataSource' | 'runRef' | 'dateFrom' | 'dateTo' | 'operators' | 'samplePlan' |
  'term' | 'disposition' | 'containmentCpId' | 'actionId' | 'customerIssueId' | 'customerContactRef' | 'customerAccepted'> = {
  dataKind: '', attrKind: '', defects: null, units: null, opportunities: null, dataSource: '', runRef: '', dateFrom: '', dateTo: '', operators: '',
  samplePlan: '', term: '', disposition: '', containmentCpId: '', actionId: '', customerIssueId: '', customerContactRef: '', customerAccepted: false,
};

export const CP_SPC_DEFAULTS = {
  capId: '', spcChart: '', spcSubgroup: null, spcCenter: null, spcUcl: null, spcLcl: null, spcBaselineCapId: '', spcLimitsFixedOn: '',
};

/**
 * normalizeProject sonrası: iç içe ayar nesnelerini tamamlar, kontrol planı SPC alanlarını doldurur.
 * V3'te `targetCpk` girilmişse ve kabul bandı yoksa kullanıcının hedefi kabul eşiği olarak korunur.
 */
export function capNormalize(p: { settings: Settings; controlPlan: object[] }, rawSettings: Partial<Settings> | undefined, notes: string[]) {
  const raw = rawSettings ?? {};
  p.settings.capAcceptance = { ...AS9145_ACCEPTANCE, ...(raw.capAcceptance ?? {}) };
  p.settings.msaCriteria = { ...DEFAULT_MSA_CRITERIA, ...(raw.msaCriteria ?? {}) };
  if (!raw.capAcceptance && raw.targetCpk != null && raw.targetCpk !== AS9145_ACCEPTANCE.accept) {
    p.settings.capAcceptance = { ...AS9145_ACCEPTANCE, accept: raw.targetCpk, source: `Proje hedef Cpk (${raw.targetCpk}); AS9145 Tablo 1 kabul eşiği 1.33` };
    notes.push(`Capability kabul eşiği proje hedef Cpk değerinden alındı (${raw.targetCpk}); AS9145 Tablo 1 koşullu bant alt sınırı 1.00.`);
  }
  p.controlPlan = p.controlPlan.map((r) => ({ ...CP_SPC_DEFAULTS, ...r }));
}
