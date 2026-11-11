// v4-risk: risk akışının ekran / Excel kolonları (columns.ts tarafından eklenir).
import type { Col } from './columns';
import { chainParentText, effectiveBasis, needLabel, riskLevelOf, RISK_LISTS } from './risk';
import { scmhPriority } from './scmhScoring';
import type { AnyRow, DfmeaRow } from './types';

const t = (key: string, label: string, width = 150, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'text', ...extra });
const long = (key: string, label: string, width = 200, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'long', ...extra });
const sel = (key: string, label: string, options: string[], width = 150, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'select', options, ...extra });
const comp = (key: string, label: string, compute: Col['compute'], width = 80, help?: string): Col => ({ key, label, width, type: 'computed', compute, readonly: true, help });
const bool = (key: string, label: string, help: string, extra: Partial<Col> = {}): Col => ({ key, label, width: 80, type: 'bool', help, ...extra });
const F = (r: AnyRow) => r as unknown as DfmeaRow;

const lineNo: Col = { key: 'lineNo', label: 'Satır #', width: 60, type: 'number', readonly: true, secondary: true, help: 'SCMH “Doc (Line) #”: bir kez atanır, silinen satırın numarası yeniden kullanılmaz' };

export const RISK_COLS = {
  /** S/O/D sonrası: SCMH ölçütleri ve "aksiyon gerekli" rozeti. */
  scores: [
    comp('so', 'S×O', (r) => scmhPriority(F(r)).so, 52, 'Severity × Occurrence (SCMH 7.2.3 p59 “SO”)'),
    comp('sd', 'S×D', (r) => scmhPriority(F(r)).sd, 52, 'Severity × Detection (SCMH 7.2.3 p59 “SD”)'),
    comp('need', 'Aksiyon Gerekli', (r, p) => needLabel(p, F(r)), 150, 'SCMH: S≥9 (RPN’den bağımsız), ekibin Top-N listesi (RPN/S×O/S×D), KC/CI. AIAG-VDA: AP=H'),
  ] as Col[],
  risk: comp('risk', 'Risk', (r, p) => riskLevelOf(p, F(r)), 82, 'SCMH: S≥9 → CRITICAL, inceleme listesi/KC → HIGH (AP kullanılmaz). AIAG-VDA: emniyet > yüksek S > AP > RPN'),
  /** Aksiyon sütunlarından sonra: karar, sonuç dayanağı, severity kararı. */
  decision: [
    sel('riskDecision', 'Aksiyon Kararı', RISK_LISTS.riskDecision, 160, { help: 'No action – ALARP: SCMH çıktısına “None (deemed ALARP)”, N/A ve değişmeyen S/O/D yazılır. Gerekçe zorunlu' }),
    long('riskDecisionReason', 'Karar Gerekçesi', 180),
    t('riskDecisionBy', 'Kararı Veren', 110, { secondary: true }),
    sel('resultBasis', 'Sonuç Dayanağı', RISK_LISTS.resultBasis, 110, { secondary: true, help: 'Boş = aksiyon Completed + tamamlanma tarihi ise Actual, değilse Projected' }),
    comp('basisEff', 'Sonuç (türetilen)', (r, p) => effectiveBasis(p, F(r)), 90),
    long('sDispositionReason', 'Severity Kararı Gerekçesi', 180, { secondary: true }),
    lineNo,
  ] as Col[],
  df: [
    sel('sDisposition', 'S 9–10 Kararı', RISK_LISTS.sDispositionDf, 190, { help: 'SCMH Q&A Q21: severity tasarımla düşürülmeli; düşürülemiyorsa KC/CI veya gerekçeli kabul. S 9–10 satırda boşsa Final onay engellenir' }),
    { key: 'causeFromIds', label: 'Neden: Alt Seviye DFMEA', width: 130, type: 'multi', ref: 'dfmea', help: 'Çok seviyeli DFMEA: alt seviye satırın hata modu bu satırın nedenidir (DRA webinar slide 42)' } as Col,
    comp('chainUp', 'Üst Seviye (S)', (r, p) => chainParentText(p, r.id), 120, 'Bu satırın hata modunu neden olarak kullanan üst seviye satırlar ve S'),
    { key: 'localEffectS', label: 'Lokal Etki S', width: 52, type: 'score', secondary: true, help: '(L) etkinin puanı (SCMH 7.2.19 DRA G18)' } as Col,
    { key: 'higherEffectS', label: 'Üst Etki S', width: 52, type: 'score', secondary: true, help: '(N) etkinin puanı' } as Col,
    { key: 'riskCategory', label: '9145 Risk Kategorisi', width: 150, type: 'multi', options: RISK_LISTS.riskCategory, help: 'AS9145 §4.4.4: performans, dayanım, servis ömrü, güvenilirlik, üretilebilirlik, bakım kolaylığı, maliyet' } as Col,
    { key: 'noiseFactor', label: 'Gürültü Faktörü', width: 150, type: 'multi', options: RISK_LISTS.noiseFactor, help: 'P-diagram: parçadan parçaya, diğer sistemler, kullanım, bozulma, çevre (sıcaklık, titreşim, gürültü, radyasyon)' } as Col,
  ] as Col[],
  pfReq: [
    long('productRequirement', 'Ürün Gereksinimi', 170, { help: 'SCMH 7.2.11 Rev A sütun E. Boşsa bağlı DFMEA gereksiniminden önerilir' }),
    long('processRequirement', 'Proses Gereksinimi', 170, { help: 'SCMH 7.2.11 Rev A sütun F. Boşsa bağlı proses parametresinden önerilir' }),
  ] as Col[],
  pf: [
    sel('sDisposition', 'S 9–10 Kararı', RISK_LISTS.sDispositionPf, 190, { help: 'Severity yalnızca tasarımla düşer (PF webinar p18/p27): tasarım talebi, hata önleme veya proses KC' }),
    { key: 'outputId', label: 'PFD Çıktısı', width: 110, type: 'ref', ref: 'pfdItems', help: 'Hata modu = bu çıktının karşılanmaması (PF webinar p20)' } as Col,
    { key: 'causeInputIds', label: 'PFD Girdisi (Neden)', width: 120, type: 'multi', ref: 'pfdItems', help: 'Neden = karşılanmayan / yetersiz girdi (PF webinar p22)' } as Col,
    bool('significantRisk', 'Önemli Risk', 'Ekip bu riski önemli kabul etti → kontrol planında olmalı (CP webinar p43)'),
    sel('cpDecision', 'KP Kararı', RISK_LISTS.cpDecision, 110, { help: 'Not required seçilirse gerekçe zorunlu (CP Q&A Q17/Q19)' }),
    long('cpExclusionReason', 'KP Dışı Gerekçe', 160, { secondary: true }),
    comp('inCp', 'Kontrol Planı', (r, p) => p.controlPlan.filter((c) => c.pfId === r.id).map((c) => c.id).join(', '), 100),
    bool('designActionRequest', 'Tasarım Talebi', 'İşaretlenince bağlı DFMEA satırları için açık konu oluşturulur (DFMEA ↔ PFMEA, SCMH 7.2.3 p32)'),
  ] as Col[],
  step: [
    bool('external', 'Dış Kaynak', 'Dış (outsourced) operasyon; öncesinde ve sonrasında taşıma adımı olmalı (PF webinar p8, p12)'),
    t('externalSupplier', 'Dış Tedarikçi', 130, { secondary: true }),
    { key: 'alternateOf', label: 'Alternatif (adım)', width: 110, type: 'ref', ref: 'processSteps', secondary: true, help: 'Alternatif proses rotası: hangi adımın yerine' } as Col,
    { key: 'returnTo', label: 'Rework Dönüşü', width: 110, type: 'ref', ref: 'processSteps', secondary: true, help: 'Rework adımı sonrası dönülen adım' } as Col,
    comp('io', 'Girdi/Çıktı', (r, p) => {
      const xs = p.pfdItems.filter((x) => x.stepId === r.id);
      return xs.length ? `${xs.filter((x) => x.kind === 'Input').length} girdi / ${xs.filter((x) => x.kind === 'Output').length} çıktı` : '';
    }, 100),
    lineNo,
  ] as Col[],
  cp: [
    sel('controlKind', 'Kontrol Tipi', RISK_LISTS.controlKind, 130, { free: true, help: 'Hata önleme cihazları da KP’de izlenir (CP webinar p29)' }),
    t('epDevice', 'Hata Önleme Cihazı', 130, { secondary: true }),
    t('epVerification', 'Cihaz Doğrulaması', 150, { secondary: true, help: 'Örn. vardiya başında referans parça ile deneme' }),
    t('charId', 'Karakteristik ID', 90, { help: 'Resim balonu / not numarası; PFD ve PFMEA ile aynı (CP webinar p23, CP Q&A Q31). Boşsa bağlı gereksinimin balonundan önerilir' }),
    { key: 'controlsCpIds', label: 'Kontrol Ettiği Ürün Kar.', width: 130, type: 'multi', ref: 'controlPlan', help: 'Proses karakteristiği satırı → etkilediği ürün karakteristiği satırı (CP webinar p24, p33)' } as Col,
    long('noPairReason', 'Eşleşme Yok Gerekçesi', 150, { secondary: true }),
    { key: 'reactionSegregate', label: 'Ayır', width: 54, type: 'bool', help: 'Reaksiyon MUST: uygunsuz ürünü ayır (CP webinar p30)' } as Col,
    t('reactionCorrection', 'Düzeltme Yöntemi', 150, { help: 'Reaksiyon MUST: düzeltme yöntemi' }),
    t('reactionContact', 'Bildirilecek', 110, { help: 'Reaksiyon MUST: amire (supervisor) bildirim' }),
    { key: 'wiDocId', label: 'Talimat', width: 110, type: 'ref', ref: 'documents', help: 'Kontrolün yazıldığı üretim/muayene talimatı (CP Q&A Q20)' } as Col,
    t('wiSection', 'Talimat Bölümü', 100, { secondary: true }),
    lineNo,
  ] as Col[],
  pfdItems: [
    { key: 'stepId', label: 'Adım ID', width: 120, type: 'ref', ref: 'processSteps' } as Col,
    sel('kind', 'Tip', RISK_LISTS.pfdItemKind, 90),
    long('text', 'Girdi / Çıktı', 240, { help: 'Çıktı: adımın ürettiği gereksinim (→ PFMEA hata modu). Girdi: değişkenlik kaynağı (→ PFMEA nedeni)' }),
    sel('cat4M', '4M/5M', ['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment'], 110),
    t('charId', 'Karakteristik ID / Balon', 110),
    { key: 'reqId', label: 'Gereksinim', width: 110, type: 'ref', ref: 'requirements' } as Col,
    { key: 'kcId', label: 'KC', width: 90, type: 'ref', ref: 'kcs' } as Col,
    t('control', 'Kontrol', 150),
    t('mistakeProofing', 'Hata Önleme', 130),
    bool('sourceOfVariation', 'Değişkenlik Kaynağı', 'PFD “Incoming Sources of Variation” (PF webinar p31)'),
    comp('fm', 'PFMEA', (r, p) => p.pfmea.filter((x) => x.outputId === r.id || x.causeInputIds?.includes(r.id)).map((x) => x.id).join(', '), 100),
    t('source', 'Kaynak', 140),
    long('notes', 'Notlar', 150, { secondary: true }),
  ] as Col[],
};
