// Ekran tabloları ve Excel çıktısı için ortak kolon tanımları.
import { historicalIds } from './checks';
import { LISTS } from './model';
import { actionPriority, capability, isKcCandidate, parseData, riskLevel, rpn } from './scoring';
import type { AnyRow, CapabilityRow, DfmeaRow, PfmeaRow, Project, TableKey } from './types';

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
  comp('ap', 'AP', (r) => actionPriority((r as DfmeaRow).s, (r as DfmeaRow).o, (r as DfmeaRow).d), 46, 'AIAG-VDA Action Priority (otomatik)'),
  comp('rpn', 'RPN', (r) => rpn((r as DfmeaRow).s, (r as DfmeaRow).o, (r as DfmeaRow).d), 52, 'S×O×D – tek başına karar kriteri değildir'),
  comp('risk', 'Risk', (r, p) => riskLevel(r as DfmeaRow, p.settings), 82, 'Öncelik: Emniyet/regülasyon > yüksek S > KC > AP > RPN'),
  sel('specialChar', 'Özel Kar.', LISTS.specialChar, 100),
  comp('kcFlag', 'KC', (r, p) => {
    const k = p.kcs.find((k) => k.sourceId === r.id);
    if (k) return `${k.id} (${k.status === 'Approved' ? 'Onaylı' : k.status === 'Rejected' ? 'Red' : 'Aday'})`;
    return isKcCandidate(r as DfmeaRow, p.settings) ? 'AI Recommended KC' : '';
  }, 120),
];

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
  comp('newAp', 'Yeni AP', (r) => actionPriority((r as DfmeaRow).newS, (r as DfmeaRow).newO, (r as DfmeaRow).newD), 60),
  t('source', 'Kaynak', 150, { help: 'Örn. REQ-023, DRW-001 / Sayfa 4 / Ölçü 35, EMAIL-003' }),
  sel('confidence', 'AI Güven', LISTS.confidence, 80, { secondary: true }),
  sel('dataStatus', 'Veri Durumu', LISTS.dataStatus, 170, { secondary: true }),
  sel('approval', 'Onay', LISTS.approval, 130),
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
  ],
  requirements: [
    long('text', 'Gereksinim', 300),
    sel('reqType', 'Tip', LISTS.reqType, 130),
    long('acceptance', 'Kabul Kriteri', 200, { help: 'Değiştiğinde DFMEA, KC ve Kontrol Planı güncellenir' }),
    t('verification', 'Doğrulama Yöntemi', 150),
    t('source', 'Kaynak', 170, { help: 'Doküman ID / No, sayfa, bölüm, ölçü no' }),
    sel('dataStatus', 'Veri Durumu', LISTS.dataStatus, 170),
    sel('approval', 'Onay', LISTS.approval, 130),
    comp('dfCount', 'DFMEA', (r, p) => p.dfmea.filter((d) => d.reqIds.includes(r.id)).length || '', 60, 'Bu gereksinime bağlı DFMEA satırı sayısı'),
    t('reassess', 'Yeniden Değerlendirme', 200),
    long('notes', 'Notlar', 180),
  ],
  structure: [
    sel('level', 'Seviye', LISTS.level, 100),
    { key: 'parentId', label: 'Üst Eleman', width: 110, type: 'ref', ref: 'structure' },
    t('element', 'Yapı Elemanı', 180, { help: 'Product → Assembly → Part → Feature' }),
    long('function', 'Fonksiyon', 240, { help: 'Değiştiğinde bağlı DFMEA satırları güncellenir' }),
    sel('functionType', 'Fonksiyon Tipi', LISTS.functionType, 150),
    { key: 'reqIds', label: 'Gereksinimler', width: 160, type: 'multi', ref: 'requirements' },
    comp('dfCount', 'DFMEA', (r, p) => p.dfmea.filter((d) => d.functionId === r.id).length || '', 60),
    t('source', 'Kaynak', 150),
    t('reassess', 'Yeniden Değerlendirme', 180, { secondary: true }),
    long('notes', 'Notlar', 160),
  ],
  dfmea: [
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
    long('verification', 'Doğrulama', 160, { secondary: true }),
    ...fmeaTail(),
  ],
  processSteps: [
    t('opNo', 'Op. No', 70, { help: 'Değiştiğinde PFMEA ve Kontrol Planı güncellenir' }),
    sel('name', 'Proses Adımı', LISTS.processStep, 170, { help: 'Listeden seçin veya yazın', free: true }),
    long('description', 'Açıklama', 240),
    t('machine', 'Makine / Ekipman', 140, { help: 'Değişirse bağlı PFMEA satırları yeniden değerlendirmeye düşer' }),
    t('tool', 'Takım / Kalıp', 130),
    { key: 'specialProcess', label: 'Özel Proses', width: 80, type: 'bool', help: 'Kür, bonding, boya, yüzey işlem, NDT...' },
    long('productChars', 'Ürün Karakteristikleri', 180),
    long('processChars', 'Proses Karakteristikleri', 180),
    comp('pfCount', 'PFMEA', (r, p) => p.pfmea.filter((x) => x.stepId === r.id).length || '', 60),
    t('source', 'Kaynak', 140),
    long('notes', 'Notlar', 160),
  ],
  pfmea: [
    { key: 'stepId', label: 'Adım ID', width: 130, type: 'ref', ref: 'processSteps' },
    t('opNo', 'Op. No', 60, { readonly: true, derived: 'Proses Akışı' }),
    t('stepName', 'Proses Adımı', 140, { readonly: true, derived: 'Proses Akışı' }),
    long('processFunction', 'Proses Fonksiyonu', 180),
    long('requirement', 'Gereksinim / Karakteristik', 180),
    { key: 'dfIds', label: 'Bağlı DFMEA', width: 120, type: 'multi', ref: 'dfmea', help: 'Bağlıysa Severity DFMEA ile otomatik eşitlenir' },
    long('failureMode', 'Hata Modu', 190),
    long('effect', 'Etki', 190),
    long('cause', 'Neden', 190, { help: 'İnsan faktörü, makine, malzeme, metot, ölçüm, çevre' }),
    long('prevention', 'Önleme Kontrolü', 180),
    long('detection', 'Tespit Kontrolü', 180),
    sel('errorProofing', 'Hata Önleme', LISTS.errorProofing, 140),
    ...fmeaScores(),
    t('measurement', 'Ölçüm Yöntemi', 150, { help: 'Kontrol Planı ölçüm yöntemine aktarılır' }),
    long('reactionPlan', 'Reaksiyon Planı', 170),
    ...fmeaTail(),
  ],
  kcs: [
    { key: 'sourceId', label: 'Kaynak FMEA', width: 130, type: 'ref', ref: ['dfmea', 'pfmea'] },
    long('characteristic', 'Karakteristik', 220),
    sel('kcClass', 'KC Sınıfı', LISTS.kcClass, 140),
    long('specification', 'Spesifikasyon', 200, { help: 'Değiştiğinde Kontrol Planı güncellenir' }),
    t('severity', 'S', 50, { readonly: true, derived: 'DFMEA / PFMEA' }),
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
    long('productChar', 'Ürün Karakteristiği', 180),
    long('processChar', 'Proses Karakteristiği', 180),
    t('kcClass', 'KC Sınıfı', 110, { readonly: true, derived: 'Kritik Karakteristikler' }),
    long('specification', 'Spesifikasyon / Tolerans', 180),
    t('method', 'Ölçüm Yöntemi', 150),
    t('gauge', 'Mastar / Cihaz', 130),
    t('sampleSize', 'Örnek', 90),
    t('frequency', 'Sıklık', 100),
    long('controlMethod', 'Kontrol Metodu', 170),
    long('reactionPlan', 'Reaksiyon Planı', 180),
    t('responsible', 'Sorumlu', 110),
    long('notes', 'Notlar', 150, { secondary: true }),
  ],
  msa: [
    { key: 'cpId', label: 'Kontrol Planı', width: 100, type: 'ref', ref: 'controlPlan' },
    { key: 'kcId', label: 'KC', width: 90, type: 'ref', ref: 'kcs' },
    long('characteristic', 'Karakteristik', 220, { derived: 'Kritik Karakteristikler' }),
    t('gauge', 'Ölçüm Sistemi', 180, { derived: 'Kontrol Planı' }),
    sel('study', 'Çalışma', LISTS.msaStudy, 160),
    sel('status', 'Durum', LISTS.msaStatus, 150),
    t('result', 'Sonuç (%GRR, ndc ...)', 160),
    long('notes', 'Notlar', 200),
  ],
  capability: [
    { key: 'kcId', label: 'KC', width: 90, type: 'ref', ref: 'kcs' },
    long('characteristic', 'Karakteristik', 200, { derived: 'Kritik Karakteristikler' }),
    { key: 'lsl', label: 'LSL', width: 70, type: 'number' },
    { key: 'usl', label: 'USL', width: 70, type: 'number' },
    { key: 'target', label: 'Hedef', width: 70, type: 'number' },
    long('data', 'Ölçüm Verisi', 220, { help: 'Değerleri üretim sırasıyla boşluk, satır veya ; ile ayırarak yapıştırın' }),
    ...(['n', 'mean', 'cp', 'cpk', 'pp', 'ppk'] as const).map((k) =>
      comp(k, k === 'mean' ? 'Ort.' : k.toUpperCase().replace('CPK', 'Cpk').replace('PPK', 'Ppk').replace('CP', 'Cp').replace('PP', 'Pp'), (r, p) => {
        const c = r as CapabilityRow;
        const res = capability(parseData(c.data), c.lsl, c.usl, p.settings.minSamples);
        const v = res[k];
        return v == null ? '' : k === 'n' ? v : Number(v.toFixed(3));
      }, 64),
    ),
    comp('result', 'Sonuç', (r, p) => {
      const c = r as CapabilityRow;
      const res = capability(parseData(c.data), c.lsl, c.usl, p.settings.minSamples);
      if (res.cpk == null) return res.message;
      const target = p.settings.targetCpk;
      const verdict = target == null ? 'Hedef Cpk VERİ YOK' : res.cpk >= target ? `Uygun (Cpk ≥ ${target})` : `Yetersiz (Cpk < ${target})`;
      return [verdict, res.message].filter(Boolean).join(' – ');
    }, 220),
    long('notes', 'Notlar', 160),
  ],
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
    comp('newAp', 'Yeni AP', (r) => {
      const a = r as unknown as DfmeaRow;
      return actionPriority(a.newS, a.newO, a.newD);
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
};

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

export function rowLabel(p: Project, id: string): string {
  const all: AnyRow[] = [
    ...p.requirements, ...p.structure, ...p.dfmea, ...p.processSteps, ...p.pfmea, ...p.kcs, ...p.controlPlan,
  ];
  const r = all.find((x) => x.id === id) as unknown as Record<string, string> | undefined;
  if (!r) return id;
  const txt = r.text || r.function || r.failureMode || r.name || r.characteristic || r.productChar || r.processChar || r.element || '';
  const prefix = r.opNo ? `${r.opNo} ` : '';
  return txt ? `${id} – ${prefix}${txt}`.slice(0, 90) : id;
}

export type FmeaLike = DfmeaRow | PfmeaRow;
