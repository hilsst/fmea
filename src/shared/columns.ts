// Ekran tabloları ve Excel çıktısı için ortak kolon tanımları.
import { historicalIds } from './checks';
import { LISTS } from './model';
import { CAP_COLUMNS, CP_SPC_COLUMNS, MSA_COLUMNS } from './capColumns'; // v4-cap
import { capabilityAnalysis, verdictText } from './capability';
import { apOf, RPN_WARNING, isKcCandidate, parseData, rpn } from './scoring';
import type { CapabilityAnalysis } from './capability';
import { impactOf } from './impact';
import { evaluateKc } from './kc';
import { kcExtraColumns, pfmeaExtraColumns, requirementExtraColumns } from './kcColumns'; // v4-kc
import { PFD_STEP_TYPES } from './types';
import { CP_PHASES as LISTS_CP_PHASES } from './apqpModel'; // v4-apqp
import { RISK_COLS } from './riskColumns'; // v4-risk
import type { AnyRow, CapabilityRow, ChangeRequestRow, DfmeaRow, KcRow, PfmeaRow, Project, TableKey } from './types';

export type ColType = 'text' | 'long' | 'score' | 'select' | 'multi' | 'ref' | 'bool' | 'date' | 'number' | 'computed';

export interface Col {
  key: string;
  label: string;
  width: number;
  type: ColType;
  options?: string[];
  /** select kolonunda listeden bağımsız serbest metin girilebilir. */
  free?: boolean;
  /** ref / multi kolonlarında seçenek listesi bu tablonun ID'lerinden gelir. */
  ref?: TableKey | TableKey[];
  compute?: (row: AnyRow, p: Project) => string | number | null;
  readonly?: boolean;
  help?: string;
  /** Detay görünümünde gizli tutulabilecek ikincil kolon. */
  secondary?: boolean;
  /** Bu kolon başka ekrandan kopyalanır; düzenleme ilgili ekranda yapılır. */
  derived?: string;
  /** v4-kc: yalnızca bu puanlama standardındaki projelerde gösterilir. */
  mode?: 'SCMH' | 'AIAG-VDA';
}

const t = (key: string, label: string, width = 160, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'text', ...extra });
const long = (key: string, label: string, width = 220, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'long', ...extra });
const sel = (key: string, label: string, options: string[], width = 140, extra: Partial<Col> = {}): Col => ({ key, label, width, type: 'select', options, ...extra });
const score = (key: string, label: string, help: string, extra: Partial<Col> = {}): Col => ({ key, label, width: 52, type: 'score', help, ...extra });
const comp = (key: string, label: string, compute: Col['compute'], width = 80, help?: string): Col => ({ key, label, width, type: 'computed', compute, readonly: true, help });

const fmeaScores = (): Col[] => [
  score('s', 'S', 'Severity 1–10 (Puanlama sekmesi). Gerçek veri yoksa AI önerisidir; onay gerekir.'),
  score('o', 'O', 'Occurrence 1–10'),
  score('d', 'D', 'Detection 1–10'),
  comp('ap', 'AP', (r, p) => apOf(p, (r as DfmeaRow).s, (r as DfmeaRow).o, (r as DfmeaRow).d), 46, 'Action Priority (AIAG-VDA veya şirket AP tablosu, Risk ekranı)'),
  comp('rpn', 'RPN', (r) => rpn((r as DfmeaRow).s, (r as DfmeaRow).o, (r as DfmeaRow).d), 52, `S×O×D – ${RPN_WARNING}`),
  RISK_COLS.risk, // v4-risk: SCMH'de AP yerine needsAction (eski: riskLevel)
  ...RISK_COLS.scores, // v4-risk
  sel('specialChar', 'Özel Kar.', LISTS.specialChar, 100),
  comp('kcFlag', 'KC', (r, p) => {
    const k = p.kcs.find((k) => k.sourceId === r.id);
    if (k) return `${k.id} (${k.status === 'Approved' ? 'Onaylı' : k.status === 'Rejected' ? 'Red' : 'Aday'})`;
    return isKcCandidate(r as DfmeaRow, p.settings) ? 'AI Recommended KC' : '';
  }, 120),
];

/** S/O/D gerekçesi, kanıtı ve güveni (§24–25). Kriter metni puandan gelir (Risk ekranı). */
const scoreReasons = (): Col[] =>
  (['s', 'o', 'd'] as const).flatMap((k) => [
    long(`${k}Reason`, `${k.toUpperCase()} Gerekçe`, 170, { secondary: true, help: 'Neden bu puan? Kriter tablosundaki satıra atıf yapın' }),
    t(`${k}Evidence`, `${k.toUpperCase()} Kanıt`, 140, { secondary: true, help: 'Kanıt ID (EV-xxx), doküman/sayfa, test raporu' }),
    sel(`${k}Conf`, `${k.toUpperCase()} Güven`, LISTS.confidence, 80, { secondary: true }),
  ]);

const fmeaTail = (): Col[] => [
  long('recommendedAction', 'Önerilen Aksiyon', 220, { help: 'Girildiğinde Aksiyonlar sekmesine otomatik kayıt açılır' }),
  t('owner', 'Sorumlu', 110),
  { key: 'dueDate', label: 'Termin', width: 120, type: 'date' },
  sel('actionStatus', 'Aksiyon Durumu', LISTS.actionStatus, 110),
  t('actionId', 'Aksiyon ID', 80, { readonly: true, derived: 'Aksiyonlar' }),
  long('actionTaken', 'Alınan Aksiyon', 180, { secondary: true }),
  score('newS', 'Yeni S', 'Aksiyon sonrası', { secondary: true }),
  score('newO', 'Yeni O', 'Aksiyon sonrası', { secondary: true }),
  score('newD', 'Yeni D', 'Aksiyon sonrası', { secondary: true }),
  comp('newAp', 'Yeni AP', (r, p) => apOf(p, (r as DfmeaRow).newS, (r as DfmeaRow).newO, (r as DfmeaRow).newD), 60),
  ...RISK_COLS.decision, // v4-risk
  t('source', 'Kaynak', 150, { help: 'Örn. REQ-023, DRW-001 / Sayfa 4 / Ölçü 35, EMAIL-003' }),
  sel('confidence', 'AI Güven', LISTS.confidence, 80, { secondary: true }),
  sel('dataStatus', 'Veri Durumu', LISTS.dataStatus, 170, { secondary: true }),
  sel('approval', 'Onay', LISTS.approval, 130),
  sel('basis', 'Dayanak', LISTS.basis, 150, { secondary: true, help: 'SOURCE DATA / ENGINEERING KNOWLEDGE / AI INFERENCE' }),
  { key: 'evidenceIds', label: 'Kanıtlar', width: 120, type: 'multi', ref: 'evidence', secondary: true },
  comp('hist', 'Geçmiş', (r, p) => (historicalIds(p).has(r.id) ? 'Historical Occurrence Evidence' : ''), 110, 'Dersler sekmesinde bu satıra bağlı NCR/8D/CAPA varsa'),
  t('reassess', 'Yeniden Değerlendirme', 200, { help: 'Kaynak değiştiğinde otomatik dolar; değerlendirince temizleyin' }),
  long('notes', 'Notlar', 160, { secondary: true }),
];

export const COLUMNS: Record<TableKey, Col[]> = {
  documents: [
    t('name', 'Doküman Adı', 220),
    sel('docType', 'Tip', LISTS.docType, 150),
    t('docNumber', 'Doküman No', 120, { help: 'Kaynak alanlarında bu numara geçen satırlar revizyon değişiminde işaretlenir' }),
    t('revision', 'Revizyon', 80, { help: 'Değiştiğinde bu dokümanı kaynak gösteren satırlar “FMEA Reassessment Required” olur' }),
    { key: 'date', label: 'Tarih', width: 120, type: 'date' },
    t('source', 'Kaynak / Gönderen', 140),
    t('product', 'İlgili Ürün/Parça/Proses', 170),
    long('notes', 'Kritik Gereksinimler / Notlar', 260),
    t('filePath', 'Dosya', 160, { readonly: true }),
    t('parseStatus', 'Analiz Durumu', 200, { readonly: true, help: 'Yerel doküman analizi sonucu (Dokümanlar → Analiz Et)' }),
  ],
  requirements: [
    long('text', 'Gereksinim', 300),
    sel('reqType', 'Tip', LISTS.reqType, 130),
    long('acceptance', 'Kabul Kriteri', 200, { help: 'Boşsa gereksinim metnindeki limitlerden otomatik dolar (limit yoksa VERİ YOK). Elle değiştirirseniz otomatik güncelleme durur. Değiştiğinde DFMEA, KC ve Kontrol Planı güncellenir' }),
    t('characteristic', 'Karakteristik', 130),
    { key: 'nominal', label: 'Nominal', width: 76, type: 'number' },
    { key: 'lsl', label: 'Alt Limit', width: 76, type: 'number' },
    { key: 'usl', label: 'Üst Limit', width: 76, type: 'number' },
    t('unit', 'Birim', 60),
    t('tolerance', 'Tolerans', 90, { secondary: true }),
    t('verification', 'Doğrulama Yöntemi', 150, { help: 'Boşsa gereksinim tipi ve karakteristiğinden AI ÖNERİSİ olarak dolar; mühendis onaylamalı veya düzeltmeli' }),
    t('source', 'Kaynak', 170, { help: 'Doküman ID / No, sayfa, bölüm, ölçü no' }),
    { key: 'sourceDocId', label: 'Kaynak Doküman', width: 110, type: 'ref', ref: 'documents', secondary: true },
    t('sourcePage', 'Sayfa', 60, { secondary: true }),
    t('sourceSection', 'Bölüm', 80, { secondary: true }),
    t('sourceCell', 'Hücre', 70, { secondary: true }),
    t('balloon', 'Balon', 60, { secondary: true }),
    long('evidenceText', 'Kanıt Metni', 220, { secondary: true, help: 'Kaynaktaki birebir alıntı' }),
    sel('confidence', 'Güven', LISTS.confidence, 80, { secondary: true }),
    sel('dataStatus', 'Veri Durumu', LISTS.dataStatus, 170),
    sel('approval', 'Onay', LISTS.approval, 130),
    comp('dfCount', 'DFMEA', (r, p) => p.dfmea.filter((d) => d.reqIds.includes(r.id)).length || '', 60, 'Bu gereksinime bağlı DFMEA satırı sayısı'),
    t('reassess', 'Yeniden Değerlendirme', 200),
    long('notes', 'Notlar', 180),
  ],
  structure: [
    sel('level', 'Seviye', LISTS.level, 100),
    { key: 'parentId', label: 'Üst Eleman', width: 110, type: 'ref', ref: 'structure' },
    t('element', 'Yapı Elemanı', 180, { help: 'System → Subsystem → Component → Part → Feature' }),
    long('function', 'Fonksiyon', 240, { help: 'Fiil + nesne (örn. “yükü aktarır”). Değiştiğinde bağlı DFMEA satırları güncellenir' }),
    sel('functionType', 'Fonksiyon Tipi', LISTS.functionType, 150),
    long('performanceReq', 'Performans Gereksinimi', 200, { help: 'Fonksiyonun ne kadar iyi yerine getirileceği (ölçülebilir)' }),
    long('constraint', 'Kısıt', 160, { secondary: true }),
    long('interface', 'Arayüz', 160, { secondary: true }),
    { key: 'reqIds', label: 'Gereksinimler', width: 160, type: 'multi', ref: 'requirements' },
    comp('dfCount', 'DFMEA', (r, p) => p.dfmea.filter((d) => d.functionId === r.id).length || '', 60),
    t('source', 'Kaynak', 150),
    sel('approval', 'Onay', LISTS.approval, 130, { help: 'Otomatik önerilen satırlar AI Proposed gelir. Rejected satırlardan DFMEA önerilmez' }),
    t('reassess', 'Yeniden Değerlendirme', 180, { secondary: true }),
    long('notes', 'Notlar', 160),
  ],
  dfmea: [
    t('system', 'Sistem', 110, { secondary: true }),
    t('subsystem', 'Alt Sistem', 110, { secondary: true }),
    t('component', 'Komponent', 120, { secondary: true }),
    { key: 'functionId', label: 'Fonksiyon ID', width: 130, type: 'ref', ref: 'structure' },
    long('function', 'Fonksiyon', 200, { derived: 'Yapı & Fonksiyon' }),
    { key: 'reqIds', label: 'Gereksinim ID', width: 120, type: 'multi', ref: 'requirements' },
    long('requirement', 'Gereksinim', 200, { readonly: true, derived: 'Gereksinimler' }),
    long('failureMode', 'Hata Modu', 200),
    long('localEffect', 'Lokal Etki', 170, { secondary: true }),
    long('higherEffect', 'Üst Seviye Etki', 170, { secondary: true }),
    long('effect', 'Nihai Etki', 200, { help: 'Severity bu etkiye göre verilir' }),
    long('cause', 'Neden', 200, { help: '5 Neden / Balık kılçığı ile kök nedene yaklaşın' }),
    long('prevention', 'Önleme Kontrolü', 190),
    long('detection', 'Tespit Kontrolü', 190),
    ...fmeaScores(),
    ...scoreReasons(),
    long('verification', 'Doğrulama', 160, { secondary: true }),
    ...RISK_COLS.df, // v4-risk
    ...fmeaTail(),
  ],
  processSteps: [
    t('opNo', 'Op. No', 70, { help: 'Değiştiğinde PFMEA ve Kontrol Planı güncellenir' }),
    sel('name', 'Proses Adımı', LISTS.processStep, 170, { help: 'Listeden seçin veya yazın', free: true }),
    long('description', 'Açıklama', 240),
    t('machine', 'Makine / Ekipman', 140, { help: 'Değişirse bağlı PFMEA satırları yeniden değerlendirmeye düşer' }),
    t('tool', 'Takım / Kalıp', 130),
    { key: 'specialProcess', label: 'Özel Proses', width: 80, type: 'bool', help: 'Kür, bonding, boya, yüzey işlem, NDT...' },
    { key: 'stepType', label: 'Adım Tipi (PFD)', width: 150, type: 'multi', options: PFD_STEP_TYPES, help: 'SCMH PFD sembolü: Operation, Setup, Move, Store, Inspect/Test, Other, Rework (birden çok seçilebilir)' },
    t('stepTypeOther', 'Diğer (Belirtin)', 130, { secondary: true, help: 'Adım tipi “Other” ise açıklama (SCMH PFD “Other (Specify)”)' }),
    t('classification', 'Classification', 120, { help: 'KC / CI ID’leri (örn. KC-001; KC-002). Boşsa bağlı PFMEA/Kontrol Planı KC’lerinden türetilir' }),
    long('productChars', 'Ürün Karakteristikleri', 180),
    long('processChars', 'Proses Karakteristikleri', 180),
    comp('pfCount', 'PFMEA', (r, p) => p.pfmea.filter((x) => x.stepId === r.id).length || '', 60),
    ...RISK_COLS.step, // v4-risk
    t('source', 'Kaynak', 140),
    long('notes', 'Notlar', 160),
  ],
  pfmea: [
    { key: 'stepId', label: 'Adım ID', width: 130, type: 'ref', ref: 'processSteps' },
    t('opNo', 'Op. No', 60, { readonly: true, derived: 'Proses Akışı' }),
    t('stepName', 'Proses Adımı', 140, { readonly: true, derived: 'Proses Akışı' }),
    long('processFunction', 'Proses Fonksiyonu', 180),
    ...RISK_COLS.pfReq, // v4-risk: tek 'requirement' kolonu yerine ürün / proses gereksinimi
    t('processElement', 'Proses Elemanı', 130, { secondary: true, help: 'Man / Machine / Material / Method / Measurement / Environment elemanı' }),
    { key: 'dfIds', label: 'Bağlı DFMEA', width: 120, type: 'multi', ref: 'dfmea', help: 'Bağlıysa Severity DFMEA ile otomatik eşitlenir' },
    long('failureMode', 'Hata Modu', 190),
    long('effect', 'Etki', 190),
    sel('cause4M', '4M/5M', LISTS.cause4M, 110, { help: 'Nedenin kategorisi' }),
    long('cause', 'Neden', 190, { help: 'İnsan faktörü, makine, malzeme, metot, ölçüm, çevre' }),
    long('why1', 'Neden 1', 150, { secondary: true }),
    long('why2', 'Neden 2', 150, { secondary: true }),
    long('why3', 'Neden 3', 150, { secondary: true }),
    long('why4', 'Neden 4', 150, { secondary: true }),
    long('why5', 'Neden 5', 150, { secondary: true }),
    long('rootCause', 'Kök Neden', 180, { help: '“Operatör hatası” kök neden değildir; sistemdeki zafiyeti yazın' }),
    long('prevention', 'Önleme Kontrolü', 180),
    long('detection', 'Tespit Kontrolü', 180),
    sel('errorProofing', 'Hata Önleme', LISTS.errorProofing, 140),
    ...fmeaScores(),
    ...scoreReasons(),
    t('measurement', 'Ölçüm Yöntemi', 150, { help: 'Kontrol Planı ölçüm yöntemine aktarılır' }),
    long('reactionPlan', 'Reaksiyon Planı', 170),
    sel('stage', 'PFMEA Olgunluğu', ['Preliminary', 'Released'], 110, { secondary: true, help: 'Ön PFMEA DRA ile eşzamanlı geliştirilir (SCMH 7.2.3 s.36); PRR/PPAP öncesi Released olmalı' }), // v4-apqp
    ...RISK_COLS.pf, // v4-risk
    ...fmeaTail(),
  ],
  kcs: [
    { key: 'sourceId', label: 'Kaynak FMEA', width: 130, type: 'ref', ref: ['dfmea', 'pfmea'] },
    long('characteristic', 'Karakteristik', 220),
    sel('kcClass', 'KC Sınıfı', LISTS.kcClass, 140),
    sel('category', 'Kategori', LISTS.kcCategory, 170, { free: true, help: 'Şirket sınıflandırması Ayarlar’dan değiştirilebilir. Mühendis seçer' }),
    long('specification', 'Spesifikasyon', 200, { help: 'Değiştiğinde Kontrol Planı güncellenir' }),
    t('severity', 'S', 50, { readonly: true, derived: 'DFMEA / PFMEA' }),
    comp('factors', 'KC Faktörleri', (r, p) => {
      const k = r as KcRow;
      const src = p.dfmea.find((d) => d.id === k.sourceId) ?? p.pfmea.find((x) => x.id === k.sourceId);
      return src ? evaluateKc(p, src, k).factors.filter((f) => f.on).map((f) => f.label).join(', ') : '';
    }, 180, 'Severity, emniyet, regülasyon, müşteri, özel proses, tolerans, capability, geçmiş hata, tespit zorluğu'),
    comp('suggested', 'Önerilen Kategori', (r, p) => {
      const k = r as KcRow;
      const src = p.dfmea.find((d) => d.id === k.sourceId) ?? p.pfmea.find((x) => x.id === k.sourceId);
      const c = src ? evaluateKc(p, src, k).suggestedCategory : '';
      return c ? `${c} (AI SUGGESTION)` : '';
    }, 170),
    long('rationale', 'Gerekçe', 200),
    sel('status', 'Mühendis Kararı', LISTS.approval, 140, { help: 'Approved → kontrol planı, MSA ve capability satırları önerilir. Rejected → otomatik satırlar kaldırılır' }),
    comp('cp', 'Kontrol Planı', (r, p) => p.controlPlan.filter((c) => c.kcId === r.id).map((c) => c.id).join(', '), 100),
    long('notes', 'Notlar', 160),
  ],
  controlPlan: [
    { key: 'stepId', label: 'Adım ID', width: 130, type: 'ref', ref: 'processSteps' },
    t('opNo', 'Proses No', 70, { readonly: true, derived: 'Proses Akışı' }),
    t('processName', 'Proses Adı', 140, { readonly: true, derived: 'Proses Akışı' }),
    t('machine', 'Makine', 120),
    t('tool', 'Takım', 100, { secondary: true }),
    { key: 'pfId', label: 'PFMEA', width: 90, type: 'ref', ref: 'pfmea' },
    { key: 'kcId', label: 'KC', width: 90, type: 'ref', ref: 'kcs' },
    sel('charType', 'Karakteristik Tipi', LISTS.charType, 150, { help: 'Ürün karakteristiği, proses karakteristiği ve proses parametresi ayrı tutulur' }),
    long('productChar', 'Ürün Karakteristiği', 180),
    long('processChar', 'Proses Karakteristiği / Parametre', 180),
    { key: 'ppId', label: 'Proses Parametresi', width: 110, type: 'ref', ref: 'processParams', secondary: true },
    t('kcClass', 'KC Sınıfı', 110, { readonly: true, derived: 'Kritik Karakteristikler' }),
    t('reference', 'Referans', 120, { help: 'SCMH “Reference”: resim konumu veya şartname bölümü (PFD/PFMEA ile aynı numara)' }),
    long('specification', 'Spesifikasyon', 180),
    t('tolerance', 'Tolerans', 100),
    t('method', 'Ölçüm Yöntemi', 150),
    t('gauge', 'Mastar / Cihaz', 130),
    t('sampleSize', 'Örnek', 90),
    t('frequency', 'Sıklık', 100),
    long('controlMethod', 'Kontrol Metodu', 170),
    long('reactionPlan', 'Reaksiyon Planı', 180, { help: 'Durdur → ayır → son kabul edilen parça → etkilenen lot/seri → Kalite → NCR → karar → kök neden → FMEA ve kontrol planı güncelleme' }),
    t('responsible', 'Sorumlu', 110),
    t('record', 'Kayıt', 120, { help: 'Ölçüm sonucunun kaydedildiği form / sistem' }),
    { key: 'phases', label: 'KP Fazı', width: 140, type: 'multi', options: LISTS_CP_PHASES, help: 'Prototype / Pre-launch / Production. Boş = tüm fazlar. SCMH paketi faz başına ayrı KP üretir' }, // v4-apqp
    ...CP_SPC_COLUMNS, // v4-cap
    ...RISK_COLS.cp, // v4-risk
    long('notes', 'Notlar', 150, { secondary: true }),
  ],
  // v4-cap: yapılandırılmış MSA ve AS9145 Tablo 1 capability kolonları (capColumns.ts)
  msa: MSA_COLUMNS,
  capability: CAP_COLUMNS,
  actions: [
    { key: 'sourceId', label: 'Kaynak FMEA', width: 130, type: 'ref', ref: ['dfmea', 'pfmea'] },
    long('description', 'Aksiyon', 260),
    sel('actionType', 'Tip', LISTS.actionType, 150),
    t('owner', 'Sorumlu', 120),
    { key: 'dueDate', label: 'Termin', width: 120, type: 'date' },
    sel('status', 'Durum', LISTS.actionStatus, 110),
    comp('overdue', 'Gecikme', (r) => {
      const a = r as unknown as { dueDate: string; status: string };
      return a.dueDate && a.status !== 'Completed' && a.status !== 'Cancelled' && a.dueDate < new Date().toISOString().slice(0, 10) ? 'GECİKMİŞ' : '';
    }, 80),
    long('actionTaken', 'Alınan Aksiyon', 200),
    { key: 'completionDate', label: 'Tamamlanma', width: 120, type: 'date' },
    score('newS', 'Yeni S', 'Aksiyon sonrası'),
    score('newO', 'Yeni O', 'Aksiyon sonrası'),
    score('newD', 'Yeni D', 'Aksiyon sonrası'),
    comp('newAp', 'Yeni AP', (r, p) => {
      const a = r as unknown as DfmeaRow;
      return apOf(p, a.newS, a.newO, a.newD);
    }, 60),
    long('verification', 'Etkinlik Doğrulaması', 180),
    long('notes', 'Notlar', 150),
  ],
  issues: [
    long('description', 'Konu / Eksik Bilgi', 280),
    sel('priority', 'Öncelik', LISTS.priority, 100),
    t('source', 'Kaynak', 150),
    long('risk', 'Risk', 180),
    t('relatedReq', 'İlgili Gereksinim', 120),
    t('relatedFmea', 'İlgili FMEA', 120),
    long('recommendedAction', 'Önerilen Aksiyon', 200),
    t('responsible', 'Sorumlu', 110),
    { key: 'dueDate', label: 'Termin', width: 120, type: 'date' },
    sel('status', 'Durum', LISTS.issueStatus, 130),
    long('answer', 'Cevap / Karar', 200),
  ],
  lessons: [
    sel('sourceType', 'Kaynak Tipi', LISTS.llSource, 130),
    t('reference', 'Referans (NCR/8D No)', 140),
    long('description', 'Problem', 240),
    long('rootCause', 'Kök Neden', 200),
    { key: 'linkedFmeaIds', label: 'Bağlı FMEA', width: 140, type: 'multi', ref: ['dfmea', 'pfmea'], help: 'Bağlanan satırlar “Historical Occurrence Evidence” olarak işaretlenir' },
    long('lesson', 'Öğrenilen Ders / Kalıcı Önlem', 240),
    t('product', 'Ürün', 120),
    t('process', 'Proses', 120),
    long('failureMode', 'Hata Modu', 160),
    long('previousAction', 'Önceki Aksiyon', 180),
    sel('status', 'Durum', LISTS.llStatus, 90),
    { key: 'date', label: 'Tarih', width: 120, type: 'date' },
  ],
  history: [
    t('revision', 'Revizyon', 80),
    { key: 'date', label: 'Tarih', width: 120, type: 'date' },
    t('author', 'Hazırlayan', 120),
    long('added', 'Eklenen (Added)', 200),
    long('modified', 'Değişen (Modified)', 200),
    long('deleted', 'Silinen (Deleted)', 160),
    long('description', 'Açıklama', 240),
    t('approvedBy', 'Onaylayan', 120),
  ],
  processParams: [
    { key: 'stepId', label: 'Adım ID', width: 120, type: 'ref', ref: 'processSteps' },
    t('parameter', 'Parametre', 170),
    sel('category', 'Kategori', LISTS.paramCategory, 120, { free: true }),
    { key: 'nominal', label: 'Nominal', width: 76, type: 'number' },
    { key: 'lsl', label: 'Alt', width: 66, type: 'number' },
    { key: 'usl', label: 'Üst', width: 66, type: 'number' },
    t('unit', 'Birim', 60),
    long('productCharacteristic', 'Etkilenen Ürün Karakteristiği', 190),
    { key: 'pfIds', label: 'PFMEA', width: 120, type: 'multi', ref: 'pfmea', help: 'Bu parametre sapınca oluşan hata modları' },
    long('prevention', 'Önleme', 160),
    long('monitoring', 'İzleme', 160, { help: 'Sürekli kayıt / termokupl / vakum logu ...' }),
    long('reaction', 'Reaksiyon', 160),
    long('validation', 'Validasyon', 160, { help: 'Proses kalifikasyonu / ilk parça / periyodik doğrulama' }),
    t('source', 'Kaynak', 150, { help: 'Proses spesifikasyonu / malzeme datasheet; yoksa VERİ YOK' }),
    long('notes', 'Notlar', 150, { secondary: true }),
  ],
  evidence: [
    { key: 'docId', label: 'Doküman', width: 110, type: 'ref', ref: 'documents' },
    t('page', 'Sayfa', 60),
    t('section', 'Bölüm', 80),
    t('sheet', 'Sayfa (Excel)', 100, { secondary: true }),
    t('cell', 'Hücre', 70, { secondary: true }),
    t('balloon', 'Balon', 60, { secondary: true }),
    long('quote', 'Kanıt (alıntı)', 300),
    sel('evidenceType', 'Kanıt Tipi', LISTS.evidenceType, 150, { free: true }),
    sel('basis', 'Dayanak', LISTS.basis, 150),
    sel('confidence', 'Güven', LISTS.confidence, 80),
    sel('verification', 'Doğrulama', LISTS.verification, 190, { readonly: true, help: 'Kaynak doğrulayıcı alıntıyı dokümanda arar' }),
    t('verifiedLocation', 'Bulunan Konum', 140, { readonly: true }),
    { key: 'linkedIds', label: 'Bağlı Kayıtlar', width: 160, type: 'multi', ref: ['requirements', 'dfmea', 'pfmea', 'kcs', 'controlPlan', 'processParams'] },
    t('aiRunId', 'AI Çalıştırma', 90, { readonly: true, secondary: true }),
    long('notes', 'Notlar', 150, { secondary: true }),
  ],
  changeRequests: [
    t('title', 'Başlık', 200),
    sel('trigger', 'Tetikleyici', ['Drawing revision', 'Specification change', 'Customer request', 'Process change', 'Material change', 'Supplier change', 'NCR / 8D', 'Other'], 150, { free: true }),
    long('description', 'Açıklama', 240),
    { key: 'impactedIds', label: 'Etkilenen Kayıtlar', width: 200, type: 'multi', ref: ['documents', 'requirements', 'structure', 'dfmea', 'processSteps', 'pfmea', 'kcs', 'controlPlan', 'msa', 'capability', 'processParams'] },
    comp('impactCount', 'Etki', (r, p) => {
      const ids = (r as ChangeRequestRow).impactedIds;
      return ids.length ? `${impactOf(p, ids).ids.length} kayıt` : '';
    }, 80, 'Değişiklik Etkisi ekranında zincir olarak görülür'),
    sel('status', 'Durum', LISTS.crStatus, 110),
    t('requestedBy', 'Talep Eden', 120),
    { key: 'date', label: 'Tarih', width: 120, type: 'date' },
    long('decision', 'Karar', 180),
    { key: 'ppapResubmission', label: 'PPAP Yeniden Sunum', width: 100, type: 'bool', help: 'PPAP onayından sonra uygulanan ürün/proses değişikliğinde otomatik işaretlenir (PPAP webinar s.38)' }, // v4-apqp
  ],
  aiRuns: [
    t('at', 'Zaman', 150, { readonly: true }),
    t('role', 'AI Rolü', 150, { readonly: true }),
    t('provider', 'Sağlayıcı', 90, { readonly: true }),
    t('model', 'Model', 120, { readonly: true }),
    t('mode', 'Mod', 90, { readonly: true }),
    t('inputs', 'Girdi', 200, { readonly: true }),
    t('status', 'Durum', 70, { readonly: true }),
    t('errorKind', 'Hata', 120, { readonly: true }),
    { key: 'items', label: 'Öneri', width: 60, type: 'number', readonly: true },
    { key: 'accepted', label: 'Kabul', width: 60, type: 'number', readonly: true },
    { key: 'rejected', label: 'Red', width: 60, type: 'number', readonly: true },
    { key: 'tokensIn', label: 'Token (girdi)', width: 90, type: 'number', readonly: true },
    { key: 'tokensOut', label: 'Token (çıktı)', width: 90, type: 'number', readonly: true },
    { key: 'cached', label: 'Önbellek', width: 70, type: 'bool', readonly: true },
    long('message', 'Mesaj', 220, { readonly: true }),
  ],
  pfdItems: RISK_COLS.pfdItems, // v4-risk
};

// v4-kc: KC/CI (9145), SR ve proses KC kolonları. SCMH projelerinde otomotiv KC sınıfı/kategorisi gizlenir.
{
  const kc = kcExtraColumns();
  for (const c of COLUMNS.kcs) if (kc.hideInScmh.includes(c.key)) c.mode = 'AIAG-VDA';
  const src = COLUMNS.kcs.find((c) => c.key === 'sourceId');
  if (src) Object.assign(src, { ref: ['dfmea', 'pfmea', 'requirements'], label: 'Kaynak (FMEA / Gereksinim)', help: 'DF-/PF- satırı veya müşteri KC’si için gereksinim (REQ-)' });
  COLUMNS.kcs.unshift(...kc.first);
  COLUMNS.kcs.push(...kc.rest);
  COLUMNS.requirements.push(...requirementExtraColumns());
  COLUMNS.pfmea.push(...pfmeaExtraColumns());
}

const LONG_LABEL: Record<string, string> = { s: 'Severity (S)', o: 'Occurrence (O)', d: 'Detection (D)', severity: 'Severity (S)', newS: 'Yeni Severity', newO: 'Yeni Occurrence', newD: 'Yeni Detection' };

export function fieldLabel(table: string, field: string): string {
  if (LONG_LABEL[field]) return LONG_LABEL[field];
  if (field === 'reassess') return 'Yeniden Değerlendirme';
  if (field === 'actionId') return 'Aksiyon ID';
  const col = (COLUMNS as Record<string, Col[]>)[table]?.find((c) => c.key === field);
  return col?.label ?? field;
}

export function cellText(col: Col, row: AnyRow, p: Project): string {
  if (col.compute) {
    const v = col.compute(row, p);
    return v == null ? '' : String(v);
  }
  const v = (row as unknown as Record<string, unknown>)[col.key];
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'boolean') return v ? 'Evet' : '';
  return v == null ? '' : String(v);
}

const labelIndex = new WeakMap<Project, Map<string, AnyRow>>();
function rowIndex(p: Project): Map<string, AnyRow> {
  let m = labelIndex.get(p);
  if (!m) {
    m = new Map();
    for (const t of ['documents', 'requirements', 'structure', 'dfmea', 'processSteps', 'pfmea', 'kcs', 'controlPlan', 'processParams', 'msa', 'capability', 'actions', 'evidence', 'changeRequests', 'lessons', 'issues'] as TableKey[])
      for (const r of p[t] as AnyRow[]) m.set(r.id, r);
    labelIndex.set(p, m);
  }
  return m;
}

export function rowLabel(p: Project, id: string): string {
  const r = rowIndex(p).get(id) as unknown as Record<string, string> | undefined;
  if (!r) return id;
  const txt = r.text || r.function || r.failureMode || r.name || r.characteristic || r.productChar || r.processChar || r.element || r.parameter || r.description || r.title || r.quote || '';
  const prefix = r.opNo ? `${r.opNo} ` : '';
  return txt ? `${id} – ${prefix}${txt}`.slice(0, 90) : id;
}

export type FmeaLike = DfmeaRow | PfmeaRow;
