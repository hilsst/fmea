// v4-kc: KC / CI, SR ve proses KC sorusu için ek tablo kolonları. `mode` verilmiş kolon yalnızca o puanlama
// standardındaki projelerde gösterilir (SCMH: 9145 terimleri; AIAG-VDA: mevcut otomotiv sınıfları).
import type { Col } from './columns';
import { KC_ELIMINATED_BY, KC_IMPACTS, KC_ITEM_TYPES, KC_LIFECYCLES, KC_ORIGINS, KC_TYPES, YES_NO, kcTypeOf, scmhKcDecision } from './kcScmh';
import { kcTriggers } from './kcTriggers';
import { kcTraceRows } from './kcTrace';
import type { KcRow, Project } from './types';

const SCMH = { mode: 'SCMH' as const };
const traceCache = new WeakMap<Project, Map<string, string>>();

function traceGaps(p: Project, id: string): string {
  let m = traceCache.get(p);
  if (!m) {
    m = new Map(kcTraceRows(p).map((r) => [r.kc.id, r.gaps.join(', ') || (r.kc.lifecycle === 'Eliminated' ? '' : '✓')]));
    traceCache.set(p, m);
  }
  return m.get(id) ?? '';
}

export function kcExtraColumns(): { first: Col[]; rest: Col[]; hideInScmh: string[] } {
  return {
    first: [
      { key: 'kcNo', label: 'KC/CI No', width: 130, type: 'text', readonly: true, help: 'PN-KC-XXX / PN-CI-XXX (SCMH 7.2.17 §1.2.1). Listeye alınınca bir kez verilir; tekrar kullanılmaz' },
      { key: 'itemType', label: 'Tür (KC/CI)', width: 80, type: 'select', options: KC_ITEM_TYPES, help: '9145: Key Characteristic veya Critical Item. Boş = KC', ...SCMH },
      { key: 'kcType', label: 'Ürün/Proses', width: 90, type: 'select', options: KC_TYPES, help: 'Boşsa kaynaktan: DFMEA/gereksinim → Product, PFMEA → Process', ...SCMH },
      { key: 'kcTypeEff', label: 'Tip (etkin)', width: 80, type: 'computed', readonly: true, compute: (r) => kcTypeOf(r as KcRow), secondary: true, ...SCMH },
      { key: 'lifecycle', label: 'Yaşam Döngüsü', width: 120, type: 'select', options: KC_LIFECYCLES, help: 'Preliminary (Faz 1 ön liste) → Potential → Confirmed; Eliminated kayıtta kalır, gerekçe zorunlu' },
    ],
    rest: [
      { key: 'designatedBy', label: 'Belirleyen', width: 110, type: 'select', options: ['Customer', 'Organization'], ...SCMH },
      {
        key: 'kcTriggers', label: 'Aday Tetikleyicileri', width: 170, type: 'computed', readonly: true, ...SCMH,
        help: 'S, Emniyet, S×O, S×D, O×D, RPN (Top-N inceleme listesi), Müşteri, SR – yalnızca aday; karar değildir',
        compute: (r, p) => {
          const k = r as KcRow;
          const src = p.dfmea.find((d) => d.id === k.sourceId) ?? p.pfmea.find((x) => x.id === k.sourceId);
          return src ? kcTriggers(p, src).filter((t) => t.on).map((t) => t.label).join(', ') : '';
        },
      },
      {
        key: 'kcDecision', label: 'Karar Akışı Sonucu', width: 190, type: 'computed', readonly: true, ...SCMH,
        help: 'SCMH KC karar akışı (CAP webinar p54) – mühendisin cevaplarından hesaplanır',
        compute: (r) => {
          const d = scmhKcDecision(r as KcRow);
          return d.complete ? `${d.ci ? 'CI · ' : ''}${d.outcome}` : 'Eksik';
        },
      },
      { key: 'kcTrace', label: 'Akış (PFMEA/PFD/KP)', width: 170, type: 'computed', readonly: true, compute: (r, p) => traceGaps(p, r.id), help: 'Aynı KC numarası PFMEA, PFD ve kontrol planında var mı?', ...SCMH },
      { key: 'linkedIds', label: 'Ek Bağlantılar', width: 140, type: 'multi', ref: ['dfmea', 'pfmea', 'processSteps', 'controlPlan'], secondary: true, help: 'Kaynak dışında KC’nin aktığı satırlar (müşteri KC’si için PFMEA satırı vb.)' },
      { key: 'ppIds', label: 'Proses Parametreleri', width: 120, type: 'multi', ref: 'processParams', secondary: true, help: 'Proses KC’yi süren girdiler (7.2.3 p63)', ...SCMH },
      { key: 'relatedKcIds', label: 'Kontrol Ettiği Ürün KC', width: 120, type: 'multi', ref: 'kcs', secondary: true, ...SCMH },
      { key: 'structureId', label: 'CI Yapı Elemanı', width: 110, type: 'ref', ref: 'structure', secondary: true, ...SCMH },
      { key: 'designRecordDocId', label: 'Tasarım Kaydı', width: 110, type: 'ref', ref: 'documents', ...SCMH },
      { key: 'designRecordRef', label: 'Resim Konumu', width: 130, type: 'text', help: 'Sayfa / zon / balon (örn. Sheet 1 Zone A-1). Boşsa bağlı gereksinimin konumu kullanılır', ...SCMH },
      { key: 'onDrawing', label: 'Resimde', width: 70, type: 'bool', help: 'KC tasarım kaydında (resim/şartname) işaretli (7.2.3 p40)', ...SCMH },
      { key: 'flowDownTo', label: 'Akış (Tedarikçi)', width: 130, type: 'text', secondary: true, ...SCMH },
      { key: 'flowDownDate', label: 'Akış Tarihi', width: 110, type: 'date', secondary: true, ...SCMH },
      { key: 'impact', label: 'Etki (7.2.16)', width: 140, type: 'multi', options: KC_IMPACTS, ...SCMH },
      { key: 'originatingDoc', label: 'Kaynak Doküman', width: 120, type: 'multi', options: KC_ORIGINS, secondary: true, help: 'Boşsa kaynak satırdan türetilir (DFMEA / PFMEA …)', ...SCMH },
      { key: 'eliminatedBy', label: 'Eleme Yolu', width: 120, type: 'select', options: KC_ELIMINATED_BY, secondary: true },
      { key: 'eliminatedRef', label: 'Eleme Referansı', width: 120, type: 'text', secondary: true, help: 'Tasarım değişikliği / aksiyon / değişiklik talebi ID' },
      { key: 'eliminatedDate', label: 'Eleme Tarihi', width: 110, type: 'date', secondary: true },
      { key: 'eliminationNote', label: 'Eleme Gerekçesi', width: 200, type: 'long', help: 'Zorunlu (7.2.17 §1.2.8)' },
      { key: 'customerAgreed', label: 'Müşteri Mutabık', width: 80, type: 'bool', help: 'KC/CI listesi müşteriyle mutabık (7.2.3 p22). Sonradan değişirse otomatik düşer', ...SCMH },
    ],
    hideInScmh: ['kcClass', 'category', 'factors', 'suggested'],
  };
}

export const requirementExtraColumns = (): Col[] => [
  { key: 'specialRequirement', label: 'SR', width: 50, type: 'bool', help: '9145 Special Requirement: kapasite sınırında, karmaşık veya olgun olmayan gereksinim (7.2.3 p40)', ...SCMH },
  { key: 'srReason', label: 'SR Gerekçesi', width: 160, type: 'text', secondary: true, ...SCMH },
];

export const pfmeaExtraColumns = (): Col[] => [
  { key: 'designActionFeasible', label: 'Tasarımla Azaltılabilir?', width: 110, type: 'select', options: YES_NO, help: '7.2.3 p63: risk O/S düşürülerek tasarım aksiyonuyla azaltılamıyorsa (No) proses KC adayıdır', ...SCMH },
];

