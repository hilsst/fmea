// v4-kc: IAQG SCMH / AS9145 özel karakteristik modeli.
// Kaynaklar (veri, talimat değil):
//  - 9145 terimleri SR / CI / KC: CP webinar p11, DRA webinar slide 19–20, CAP webinar p53.
//  - KC karar akışı: CAP webinar p54 (= DRA webinar slide 43).
//  - KC numarası PN-KC-XXX, tekrar kullanılmaz, elenen KC kayıtta kalır: SCMH 7.2.17 §1.2.1, §1.2.4–1.2.8.
//  - KC adayları: CPQA Q10 ("high RPN, high Criticality Number (S×O), high Severity, high Safety risk"),
//    DRA Q&A Q21 (yüksek SO / yüksek S + zor tespit → KC atanabilir), 7.2.3 p33 adım 13.
//  - Proses KC kuralı: 7.2.3 p63 (D×O, S×D veya RPN tasarım aksiyonuyla azaltılamıyorsa).
// Buradaki her sonuç bir ÖNERİ / ADAY'dır; KC kararını mühendis verir. Severity tek başına KC kararı değildir.
import type { AnyRow, DfmeaRow, KcItemType, KcLifecycle, KcRow, KcType, PfmeaRow, Project, RequirementRow, Score, TableKey } from './types';

export const KC_LIFECYCLES: Exclude<KcLifecycle, ''>[] = ['Preliminary', 'Potential', 'Confirmed', 'Eliminated'];
export const KC_ITEM_TYPES: Exclude<KcItemType, ''>[] = ['KC', 'CI'];
export const KC_TYPES: Exclude<KcType, ''>[] = ['Product', 'Process'];
/** 7.2.17 §1.2.5 önerilen kategoriler + 7.2.16 örneğindeki "Product Performance". */
export const KC_IMPACTS = ['Safety', 'Reliability', 'Durability', 'Manufacturing', 'Assembly', 'Product Performance'];
/** 7.2.16 H sütunu / 7.2.17 §1.2.7. */
export const KC_ORIGINS = ['DRA', 'DFMEA', 'PFMEA', 'FMECA', 'Historical data', 'Customer', 'Design record'];
export const KC_ELIMINATED_BY = ['Design change', 'Process change', 'Analysis', 'Customer decision'];
export const YES_NO = ['Yes', 'No'];

export const LIFECYCLE_LABEL: Record<string, string> = {
  '': 'Aday (karar yok)',
  Preliminary: 'Ön liste (Faz 1)',
  Potential: 'Potansiyel',
  Confirmed: 'Kesinleşmiş',
  Eliminated: 'Elendi (kayıtta)',
};

/** Ekranda gösterilen durum: lifecycle yoksa onay durumundan türetilir (3.0 dosyaları). */
export function lifecycleLabel(k: Pick<KcRow, 'lifecycle' | 'status'>): string {
  if (k.lifecycle) return LIFECYCLE_LABEL[k.lifecycle] ?? k.lifecycle;
  if (k.status === 'Approved') return 'Kesinleşmiş (onaylı)';
  if (k.status === 'Rejected') return 'Reddedildi';
  return LIFECYCLE_LABEL[''];
}

/** Varsayılan numaralandırma: 7.2.17 §1.2.1 "XXXXXX-KC-XXX" (parça numarasıyla). */
export const DEFAULT_KC_NUMBERING = '{PN}-KC-{nnn}';
export const DEFAULT_CI_NUMBERING = '{PN}-CI-{nnn}';

/** blankRow için ek alanlar (her çağrıda yeni diziler). */
export function kcRowDefaults(table: TableKey): Record<string, unknown> | null {
  switch (table) {
    case 'kcs':
      return {
        itemType: '', kcType: '', lifecycle: '', kcNo: '', eliminatedBy: '', eliminatedRef: '', eliminatedDate: '', eliminationNote: '',
        designatedBy: '', triggers: [], qSafetyCritical: '', qCriticalOther: '', qUnsafe: '', qAffectsOther: '', qVariation: '',
        linkedIds: [], ppIds: [], relatedKcIds: [], structureId: '', designRecordDocId: '', designRecordRef: '', onDrawing: false,
        flowDownTo: '', flowDownDate: '', impact: [], originatingDoc: [], customerAgreed: false,
      };
    case 'requirements':
      return { specialRequirement: false, srReason: '' };
    case 'pfmea':
      return { designActionFeasible: '' };
    default:
      return null;
  }
}

// ------------------------------------------------------------------ sınıflandırma yardımcıları

export const isCi = (k: Pick<KcRow, 'itemType'>) => k.itemType === 'CI';

/** Ürün / proses KC: açık değer yoksa kaynaktan türetilir. */
export function kcTypeOf(k: Pick<KcRow, 'kcType' | 'sourceId' | 'kcClass'>): Exclude<KcType, ''> {
  if (k.kcType) return k.kcType;
  if (k.kcClass === 'KC-3 Process KC' || k.sourceId?.startsWith('PF-') || k.sourceId?.startsWith('PP-')) return 'Process';
  return 'Product';
}

/** Kayıt dışı (reddedilmiş AI önerisi veya elenmiş) mi? */
export const isInactive = (k: Pick<KcRow, 'status' | 'lifecycle'>) => k.status === 'Rejected' || k.lifecycle === 'Eliminated';

/** Kesinleşmiş KC: lifecycle Confirmed; 3.0 dosyalarında lifecycle yoksa onaylı KC kesinleşmiş sayılır. */
export const isConfirmed = (k: Pick<KcRow, 'status' | 'lifecycle'>) => k.lifecycle === 'Confirmed' || (!k.lifecycle && k.status === 'Approved');

/** KC listesinde (numaralı) mı? Aday (karar verilmemiş AI önerisi) listede değildir. */
export const isListed = (k: Pick<KcRow, 'status' | 'lifecycle' | 'kcNo'>) => k.status !== 'Rejected' && (!!k.kcNo || !!k.lifecycle || k.status === 'Approved');

/** Belgelerde görünen numara (PN-KC-XXX; yoksa iç ID). */
export const kcDisplayNo = (k: Pick<KcRow, 'id' | 'kcNo'>) => k.kcNo || k.id;

function seqOf(no: string): number {
  const m = /(\d+)\s*$/.exec(no);
  return m ? Number(m[1]) : 0;
}

/** Numara şablonunu uygular: {PN} parça numarası (boşsa önündeki ayraçla birlikte düşer), {nnn} sıra (3 hane). */
export function formatKcNo(pattern: string, pn: string, seq: number): string {
  const part = pn.replace(/\s+/g, '');
  let out = pattern || DEFAULT_KC_NUMBERING;
  out = part ? out.replace('{PN}', part) : out.replace(/\{PN\}[-_ ]?/, '');
  const m = /\{(n+)\}/.exec(out);
  const width = m ? Math.max(3, m[1].length) : 3;
  return out.replace(/\{n+\}/, String(seq).padStart(width, '0'));
}

/**
 * Bir sonraki KC / CI numarası. Sayaç (kcRegistry) ve mevcut numaraların en büyüğü dikkate alınır; sayaç
 * hiç azalmadığından silinmiş/elenmiş numara yeniden verilmez (7.2.17 §1.2.1). `p.kcRegistry` güncellenir.
 */
export function issueKcNo(p: Project, itemType: KcItemType): string {
  const ci = itemType === 'CI';
  const reg = (p.kcRegistry ??= { kc: 0, ci: 0 });
  const used = p.kcs.filter((k) => k.kcNo && isCi(k) === ci).map((k) => seqOf(k.kcNo));
  const seq = Math.max(ci ? reg.ci : reg.kc, ...used, 0) + 1;
  if (ci) reg.ci = seq;
  else reg.kc = seq;
  const pattern = ci ? p.settings.ciNumbering || DEFAULT_CI_NUMBERING : p.settings.kcNumbering || DEFAULT_KC_NUMBERING;
  return formatKcNo(pattern, p.meta.partNumber ?? '', seq);
}

/** Numara verilmiş KC silinemez; Eliminated yapılır. */
export const kcLocked = (k: Pick<KcRow, 'kcNo'> | undefined) => !!k?.kcNo;
export const KC_LOCK_MSG = 'Numara verilmiş KC/CI silinemez (SCMH 7.2.17 §1.2.1: numara tekrar kullanılmaz, elenen KC kayıtta kalır). Yaşam döngüsünü “Eliminated” yapıp gerekçe yazın.';

// ------------------------------------------------------------------ yayma kancası (engine.ts 'kcs' onSet)

export interface KcSet {
  table: TableKey;
  id: string;
  field: string;
  value: unknown;
  reason: string;
}

const today = () => new Date().toISOString().slice(0, 10);
const AGREEMENT_FIELDS = ['characteristic', 'specification', 'lifecycle', 'kcType', 'itemType', 'designRecordRef'];

/**
 * KC satırındaki bir alan değiştiğinde aynı satırda türetilen değişiklikler (motor bunları onay penceresine
 * yansıtır). `p` motorun proje kopyasıdır; numara sayacı burada ilerletilir.
 */
export function kcOnSet(p: Project, k: KcRow, field: string, fresh: boolean): KcSet[] {
  const out: KcSet[] = [];
  const set = (f: string, value: unknown, reason: string) => out.push({ table: 'kcs', id: k.id, field: f, value, reason });
  if (['lifecycle', 'status', 'itemType'].includes(field) && !k.kcNo && (k.lifecycle || k.status === 'Approved' || k.status === 'Engineer Reviewed')) {
    const no = issueKcNo(p, k.itemType);
    set('kcNo', no, `${k.id} KC listesine alındı → ${no} numarası verildi (SCMH 7.2.17 §1.2.1, tekrar kullanılmaz)`);
  }
  if (field === 'lifecycle' && k.lifecycle === 'Eliminated' && !k.eliminatedDate) set('eliminatedDate', today(), `${k.id} elendi (kayıtta kalır)`);
  if (!fresh && k.customerAgreed && AGREEMENT_FIELDS.includes(field))
    set('customerAgreed', false, `${k.id} müşteri mutabakatından sonra değişti (${field}); KC listesi müşteriyle yeniden mutabık kalınmalı (7.2.3 p22)`);
  return out;
}

// ------------------------------------------------------------------ SCMH KC karar akışı (CAP p54)

export type ScmhKcOutcome =
  | 'Safety-related KC'
  | 'Non-safety-related KC'
  | 'Safety-related Frozen Process Characteristic or Mandatory Procedural Element'
  | 'Not a KC'
  | 'Not a Critical Item'
  | '';

export interface ScmhKcDecision {
  /** Critical Item atanmalı mı (null = henüz cevaplanmadı). */
  ci: boolean | null;
  outcome: ScmhKcOutcome;
  /** Sıradaki cevaplanacak soru (alan adı) veya ''. */
  next: '' | 'qSafetyCritical' | 'qCriticalOther' | 'qUnsafe' | 'qAffectsOther' | 'qVariation';
  path: string[];
  complete: boolean;
}

export const DECISION_QUESTIONS: Record<Exclude<ScmhKcDecision['next'], ''>, string> = {
  qSafetyCritical: 'Ürün/kalem emniyet açısından kritik mi? (Safety Critical?)',
  qCriticalOther: 'Diğer müşteri gereksinimleri için kritik mi? (Critical to other Customer Requirements?)',
  qUnsafe: 'Tasarım karakteristiği emniyetsiz bir durum oluşturabilir mi? (Can its Design Characteristic create an unsafe condition?)',
  qAffectsOther: 'Tasarım karakteristiği diğer gereksinimleri etkileyebilir mi? (Can its Design Characteristic affect other requirements?)',
  qVariation: 'Varyasyon yönetiminden fayda sağlar mı? (Benefit from Variation Management?)',
};

type Answers = Pick<KcRow, 'qSafetyCritical' | 'qCriticalOther' | 'qUnsafe' | 'qAffectsOther' | 'qVariation'>;

/**
 * CAP webinar p54 akışı:
 *  Safety critical? YES → CI → Unsafe? YES → Variation? YES → Safety-related KC / NO → Frozen process / MPE
 *                                     Unsafe? NO → Affects other? …
 *  Safety critical? NO → Critical to other req.? NO → Not a CI; YES → CI → Affects other? NO → Not a KC
 *                                     Affects other? YES → Variation? YES → Non-safety KC / NO → Not a KC (çıkarım)
 */
export function scmhKcDecision(a: Answers): ScmhKcDecision {
  const path: string[] = [];
  const res = (ci: boolean | null, outcome: ScmhKcOutcome, next: ScmhKcDecision['next']): ScmhKcDecision => ({ ci, outcome, next, path, complete: !next });
  if (!a.qSafetyCritical) return res(null, '', 'qSafetyCritical');
  const safety = a.qSafetyCritical === 'Yes';
  path.push(`Safety critical: ${a.qSafetyCritical}`);
  if (!safety) {
    if (!a.qCriticalOther) return res(null, '', 'qCriticalOther');
    path.push(`Critical to other requirements: ${a.qCriticalOther}`);
    if (a.qCriticalOther === 'No') return res(false, 'Not a Critical Item', '');
  }
  path.push('→ Designate a Critical Item');
  if (safety) {
    if (!a.qUnsafe) return res(true, '', 'qUnsafe');
    path.push(`Create unsafe condition: ${a.qUnsafe}`);
    if (a.qUnsafe === 'Yes') {
      if (!a.qVariation) return res(true, '', 'qVariation');
      path.push(`Benefit from variation management: ${a.qVariation}`);
      return res(true, a.qVariation === 'Yes' ? 'Safety-related KC' : 'Safety-related Frozen Process Characteristic or Mandatory Procedural Element', '');
    }
  }
  if (!a.qAffectsOther) return res(true, '', 'qAffectsOther');
  path.push(`Affect other requirements: ${a.qAffectsOther}`);
  if (a.qAffectsOther === 'No') return res(true, 'Not a KC', '');
  if (!a.qVariation) return res(true, '', 'qVariation');
  path.push(`Benefit from variation management: ${a.qVariation}`);
  return res(true, a.qVariation === 'Yes' ? 'Non-safety-related KC' : 'Not a KC', '');
}

/** Proses KC kontrol metodu: kontrol planında %100 kontrol veya SPC (7.2.3 p63 not). */
export function hasKcControl(c: { sampleSize: string; controlMethod: string; method: string; frequency: string }): boolean {
  if (/(^|\D)100\s*%|%\s*100(\D|$)/.test(`${c.sampleSize} ${c.frequency}`)) return true;
  return /\bSPC\b|statistical process control|istatistiksel proses kontrol|control chart|kontrol kartı|x[̄-]?bar|i-mr|\bimr\b/i.test(`${c.controlMethod} ${c.method}`);
}

/** Satırın kendisi bir FMEA satırı mı? (tip daraltma) */
export const isFmeaRow = (r: AnyRow | undefined): r is DfmeaRow | PfmeaRow => !!r && ('failureMode' in r);
