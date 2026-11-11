// v4-apqp: APQP / PPAP veri modeli (proje düzeyi `project.apqp`). Bu dosya model.ts tarafından içe aktarılır;
// döngü olmaması için model.ts / engine.ts'i içe aktarmaz. Kurallar ve türetilmiş durumlar apqp.ts'tedir.
//
// Kaynaklar (veri; talimat değil):
//  - SCMH 7.2.12 APQP Element Applicability Template: faz, tip, "Required (Y/N)", "If not required, indicate why",
//    "Approved by", "Assigned to", "Target Completion Date" sütunları.
//  - SCMH 7.2.15 APQP Applicability Matrix (Rev. New 27 NOV 2018): X = Mandatory, O = Recommended, boş = As needed;
//    kalın yazı = 9145 gereksinimi. Proje tipleri ND / DC1 / NP / PC / WT / NDELV.
//  - SCMH 7.2.2 s.15–23: kilometre taşları A–E. SCMH 7.2.3 §6.1: Red / Yellow / Green kuralları.
//  - PPAP webinar (21 Jan 2020) s.18: 11 PPAP elemanı ve APQP fazları; s.34: Full / Interim / Rejected.
//  - SCMH 7.2.20: ambalaj/koruma/etiketleme onay formu (2 temel + 12 Evet/Hayır/NA maddesi).
// IAQG metinleri kopyalanmaz: katalog yalnızca kimlik, faz, kısa ad ve şablon satırını bulmak için kısa bir önek taşır.

export type ApqpProjectType = 'ND' | 'DC1' | 'NP' | 'PC' | 'WT' | 'NDELV';
export const APQP_PROJECT_TYPES: { key: ApqpProjectType; label: string }[] = [
  { key: 'ND', label: 'New Design' },
  { key: 'DC1', label: 'Design Change (Class 1)' },
  { key: 'NP', label: 'New Process' },
  { key: 'PC', label: 'Process Change' },
  { key: 'WT', label: 'Work Transfer' },
  { key: 'NDELV', label: 'New Design Extremely Low Volume' },
];
/** 7.2.15 sütun sırası (marks dizisindeki karakter sırası). */
export const MATRIX_ORDER: ApqpProjectType[] = ['ND', 'DC1', 'NP', 'PC', 'WT', 'NDELV'];

export type Applicability = 'Mandatory' | 'Recommended' | 'As needed' | '';
export type Ryg = 'Green' | 'Yellow' | 'Red' | '';
export type YesNo = 'Y' | 'N' | '';
export type ElementStatus = 'Not started' | 'In work' | 'Complete' | '';

export interface ApqpCatalogItem {
  key: string;
  phase: 1 | 2 | 3 | 4 | 5;
  type: 'Activity' | 'Deliverable';
  /** Uygulamadaki kısa ad. */
  name: string;
  /** 7.2.12 şablonunda satırı bulmak için C sütunu öneki (küçük harf, yalnızca harf/rakam karşılaştırılır). */
  match: string;
  /** 7.2.12 şablonundaki varsayılan satır (metin eşleşmezse yalnızca faz/tip tutuyorsa kullanılır). */
  row: number;
  /** 7.2.15 ID'si ve ND/DC1/NP/PC/WT/NDELV işaretleri ('X' | 'O' | '.'). */
  matrixId?: string;
  marks?: string;
  /** 7.2.15'te kalın = 9145 gereksinimi. */
  is9145?: boolean;
  responsible?: string;
}

const A = (key: string, phase: ApqpCatalogItem['phase'], row: number, name: string, match: string): ApqpCatalogItem => ({ key, phase, type: 'Activity', name, match, row });
const D = (key: string, phase: ApqpCatalogItem['phase'], row: number, name: string, match: string, matrixId?: string, marks?: string, is9145 = false, responsible = ''): ApqpCatalogItem =>
  ({ key, phase, type: 'Deliverable', name, match, row, matrixId, marks, is9145, responsible });

/** 7.2.12 satırları (81) ve 7.2.15 eşleşmesi. Matris işaretleri gap-forms.md §1.3 tablosundan (koordinatla eşlenmiş). */
export const APQP_CATALOG: ApqpCatalogItem[] = [
  A('A1.1', 1, 5, 'Gereksinimlerin toplanması', 'collect the technical'),
  A('A1.2', 1, 6, 'SOW hazırlama', 'develop a statement of work'),
  A('A1.3', 1, 7, 'Ürün ve proje hedefleri', 'define the product and associated'),
  A('A1.4', 1, 8, 'Ürün ağacı / üst seviye BOM', 'develop the product breakdown'),
  A('A1.5', 1, 9, 'Zamanlamanın paydaşlarla koordinasyonu', 'coordinate and communicate timing'),
  A('A1.6', 1, 10, 'Proje planında tarihlerin planlanması', 'schedule all key dates'),
  D('1.01.1', 1, 11, 'Ürün tasarım gereksinimleri', 'product design requirements', '1.01.1', 'X....X', false, 'DA'),
  D('1.02', 1, 12, 'Proje hedefleri', 'project targets', '1.02', 'X...OX', true, 'DA'),
  D('1.03', 1, 13, 'Ön CI / KC listesi', 'preliminary listing of critical', '1.03', 'X....X', false, 'DA'),
  D('1.04', 1, 14, 'Ön BOM', 'preliminary bom', '1.04', 'X....X', true, 'DA'),
  D('1.05', 1, 15, 'Ön proses akış diyagramı', 'preliminary process flow', '1.05', 'X....X', false, 'DA'),
  D('1.06', 1, 16, 'SOW gözden geçirme', 'sow review', '1.06', 'X....X', false, 'DA'),
  D('1.07', 1, 17, 'Ön tedarik planı', 'preliminary sourcing plan', '1.07', 'X...OX', true, 'DA'),
  D('1.08', 1, 18, 'Proje planı', 'project plan', '1.08', 'X...OX', true, 'DA'),
  A('A2.1', 2, 20, 'Spesifikasyon → sağlam ürün tanımı', 'turning product specifications'),
  A('A2.2', 2, 21, 'Tasarım risk analizi (faaliyet)', 'design risk analysis'),
  A('A2.3', 2, 22, 'DFMA', 'design for manufacture'),
  A('A2.4', 2, 23, 'DFMRO', 'design for maintenance'),
  A('A2.5', 2, 24, 'Ürün KC belirleme', 'identification of product kcs'),
  A('A2.6', 2, 25, 'Ürün hata önleme', 'product error proofing'),
  A('A2.7', 2, 26, 'BOM oluşturma', 'create bom'),
  A('A2.8', 2, 27, 'Tasarım gözden geçirmeleri', 'conduct design reviews'),
  A('A2.9', 2, 28, 'Tasarım doğrulama ve geçerleme', 'validate and verify product design'),
  A('A2.10', 2, 29, 'Üretilebilirlik için tasarım kaydı incelemesi', 'conduct design record review'),
  D('2.01', 2, 30, 'Tasarım risk analizi (DRA / DFMEA)', 'design risk analysis', '2.01', 'XX...X', true, 'DA'),
  D('2.02.1', 2, 31, 'Tasarım kayıtları ve BOM', 'design records and bom', '2.02.1', 'XX...X', true, 'DA/Producer'),
  D('2.02.3', 2, 32, 'DFMA, tolerans, stack-up analizi', 'dfma tolerance', '2.02.3', 'XO...X', false, 'DA'),
  D('2.03', 2, 33, 'Özel gereksinimler, ürün KC ve CI listeleri', 'special requirements', '2.03', 'X.XXXX', true, 'DA'),
  D('2.04', 2, 34, 'Tedarik planı ön risk analizi', 'preliminary risk analysis of sourcing', '2.04', 'X...OX', true, 'DA'),
  D('2.05', 2, 35, 'Ambalaj spesifikasyonu', 'packaging specification', '2.05', 'X....X', false, 'DA'),
  D('2.06', 2, 36, 'Tasarım gözden geçirme raporu', 'design review report', '2.06', 'X....X', false, 'DA'),
  D('2.07', 2, 37, 'Geliştirme ürünü üretim planı', 'development product build plan', '2.07', 'X....X', false, 'DA'),
  D('2.08', 2, 38, 'Tasarım doğrulama/geçerleme planları ve sonuçları', 'design verification and validation', '2.08', 'X....X', true, 'DA'),
  D('2.09', 2, 39, 'Fizibilite değerlendirmesi', 'feasibility assessment', '2.09', 'XOO.OX', true, 'DA/Producer'),
  A('A3.1', 3, 41, 'Kaynak seçimi ve tedarik zinciri risk planı', 'complete source selection'),
  A('A3.2', 3, 42, 'Proses akış diyagramı oluşturma', 'create a process flow diagram'),
  A('A3.3', 3, 43, 'PFMEA yürütme ve proses KC belirleme', 'conduct process failure mode'),
  A('A3.4', 3, 44, 'Prosesin PFMEA risk azaltma planlarına göre güncellenmesi', 'update the process based on the pfmea'),
  A('A3.5', 3, 45, 'Kontrol planı oluşturma (PFMEA ve KC sonuçlarıyla)', 'create the control plan'),
  A('A3.6', 3, 46, 'Üretim talimatları ve dokümantasyon', 'create process manufacturing instructions'),
  A('A3.7', 3, 47, 'Üretime hazırlık değerlendirmesi', 'evaluate production readiness'),
  D('3.01', 3, 48, 'Proses akış diyagramı (PFD)', 'process flow diagram', '3.01', 'XOXOXX', true, 'Producer'),
  D('3.02', 3, 49, 'Yerleşim planı', 'floor plan layout', '3.02', 'X.X.XX', false, 'Producer'),
  D('3.03', 3, 50, 'Üretim hazırlık planı', 'production preparation plan', '3.03', 'X.X.XX', true, 'Producer'),
  D('D3.staff', 3, 51, 'Operatör kadro ve eğitim planı', 'operator staffing'),
  D('3.04', 3, 52, 'PFMEA', 'pfmea', '3.04', 'XXXXXX', true, 'Producer'),
  D('3.05', 3, 53, 'Proses KC’leri', 'process kcs', '3.05', 'XOXOXX', true, 'Producer'),
  D('3.06', 3, 54, 'Kontrol planı (ön üretim)', 'control plan', '3.06', 'XXXXXX', true, 'Producer'),
  D('3.07', 3, 55, 'Ön kapasite değerlendirmesi', 'preliminary capacity assessment', '3.07', 'XOX.X.', true, 'Producer'),
  D('3.08', 3, 56, 'İş istasyonu dokümantasyonu', 'work station documentation', '3.08', 'XOXOXX', true, 'Producer'),
  D('3.09', 3, 57, 'MSA planı', 'measurement systems analysis msa plan', '3.09', 'X.X.XX', true, 'Producer'),
  D('3.10', 3, 58, 'Tedarik zinciri risk yönetim planı', 'supply chain risk management plan', '3.10', 'X.X.XX', false, 'Producer'),
  D('3.11', 3, 59, 'Malzeme taşıma, ambalaj, etiketleme ve parça markalama onayları', 'material handling packaging', '3.11', 'X.X.XX', true, 'Producer'),
  D('3.12', 3, 60, 'PRR (üretime hazırlık gözden geçirmesi) sonuçları', 'production readiness review', '3.12', 'XOXOXX', true, 'Producer'),
  A('A4.1', 4, 62, 'FAI ve PPAP dosyasının hazırlanması', 'conduct a first article inspection'),
  A('A4.2', 4, 63, 'Üretim koşusu(ları)', 'completion of a production product run'),
  A('A4.3', 4, 64, 'Kapasite analizi', 'conduct a capacity analysis'),
  A('A4.4', 4, 65, 'Müşteri talep hızında uygun ürün verisi', 'collect data to demonstrate'),
  A('A4.5', 4, 66, 'MSA planına göre MSA', 'conduct the msa per the msa plan'),
  A('A4.6', 4, 67, 'Üretim koşusu sonuçlarının incelenmesi ve DÖF', 'review the results of production process runs'),
  A('A4.7', 4, 68, 'Seri üretime geçiş hazırlığı', 'subsequent to corrective actions'),
  D('4.01', 4, 69, 'Üretim koşusu ürünleri', 'product from production process run', '4.01', 'XXXXX.', true, 'Producer'),
  D('4.02', 4, 70, 'MSA', 'msa', '4.02', 'X.X.XX', true, 'Producer'),
  D('4.03', 4, 71, 'İlk proses yeterlilik çalışmaları', 'initial process capability studies', '4.03', 'X.X.X.', true, 'Producer'),
  D('4.04', 4, 72, 'Kontrol planı (üretim)', 'control plan', '4.04', 'XOXOXX', true, 'Producer'),
  D('4.05', 4, 73, 'Kapasite doğrulama', 'capacity verification', '4.05', 'XOX.X.', false, 'Producer'),
  D('4.06', 4, 74, 'Ürün geçerleme sonuçları', 'product validation results', '4.06', 'XOX.XX', false, 'Producer'),
  D('4.07', 4, 75, 'FAIR', 'first article inspection report', '4.07', 'XXXXXX', true, 'Producer'),
  D('4.08', 4, 76, 'PPAP dosyası ve onay formu', 'ppap file and approval form', '4.08', 'XXXXXX', true, 'Producer'),
  D('4.09', 4, 77, 'Müşteriye özel gereksinimler', 'customer specific requirements', '4.09', 'X.X.XX', true, 'DA/End user'),
  A('A5.1', 5, 79, 'Ürün/proses performansının Faz 1 hedefleriyle izlenmesi', 'monitor product and process performance'),
  A('A5.2', 5, 80, 'Güvenilirlik, kalite, müşteri memnuniyeti', 'reliability quality and customer'),
  A('A5.3', 5, 81, 'Teslim sonrası performans (garanti dahil)', 'product post delivery performance'),
  A('A5.4', 5, 82, 'MRO operasyonları', 'maintenance repair and overhaul mro operations'),
  A('A5.5', 5, 83, 'Varyasyonu azaltma aksiyonları', 'implement actions to reduce'),
  A('A5.6', 5, 84, 'Varyasyon kaynaklarının dokümantasyonu', 'document sources of variation'),
  A('A5.7', 5, 85, 'Derslerin kaydı ve tasarıma entegrasyonu', 'capture lessons learned'),
  A('A5.8', 5, 86, 'FMEA’ların derslere göre güncellenmesi', 'update fmeas based on lessons'),
  D('5.01.1', 5, 87, 'Kalite göstergeleri (Cpk, PPM, ret oranı)', 'quality indices', '5.01.1', 'XXXXX.', false, 'Program Team / Producer'),
  D('5.01.1b', 5, 88, 'Ürün kalitesi/güvenilirlik KPI’ları', 'key performance indicators', '5.01.1', 'XXXXXX', false, 'Program Team / DA/Producer'),
  D('5.01.1c', 5, 89, 'Proje hedeflerinin karşılandığına dair kanıt', 'evidence that project targets', '5.01.1', 'XXXXXX', true, 'Program Team'),
  D('5.01.1d', 5, 90, 'OTD ve kapasite KPI’ları', 'on time delivery otd and capacity kpis', '5.01.1', 'XXXXX.', false, 'Producer'),
  D('D5.otd', 5, 91, 'OTD ve kapasite iyileştirme planı', 'otd and capacity improvement plan'),
  D('5.01.2', 5, 92, 'MRO KPI’ları ve planları', 'mro kpis and plan', '5.01.2', 'XXXXX.', false, 'Program Team'),
  D('5.03b', 5, 93, 'Proje kapanış önerileri', 'project closure recommendations', '5.03', 'XXXXXX', true, 'Program Team'),
  D('5.02', 5, 94, 'Sürekli iyileştirme aksiyonları', 'continuous improvement actions', '5.02', 'XXXXX.', true, 'Program Team / DA/Producer'),
  D('5.03', 5, 95, 'Öğrenilen dersler', 'lessons learned', '5.03', 'XXXXXX', true, 'Program Team'),
  D('5.03.02', 5, 96, 'Güncellenmiş DRA, PFMEA ve kontrol planları', 'updated design risk analysis', '5.03.02', 'XXXXXX', false, 'DA/Producer'),
];
export const CATALOG_BY_KEY: Record<string, ApqpCatalogItem> = Object.fromEntries(APQP_CATALOG.map((c) => [c.key, c]));

export interface ChecklistItem {
  id: string;
  q: string;
  answer: 'Y' | 'N' | 'NA' | '';
  /** Uygulama içi kontrol anahtarı (öneri gösterir; cevabı mühendis verir). */
  auto?: string;
  evidenceRef: string;
  deviation: string;
  action: string;
}

export interface ApqpElement {
  key: string;
  required: YesNo;
  reason: string;
  approvedBy: string;
  assignedTo: string;
  targetDate: string;
  completedDate: string;
  status: ElementStatus;
  /** Takvim/kalite sapması için kurtarma aksiyonu (Yellow için gerekli). */
  recoveryAction: string;
  /** Teslim takvimine etki var (SCMH 7.2.3 §6.1 Red). */
  scheduleImpact: boolean;
  checklist: ChecklistItem[];
  notes: string;
}

export type MilestoneKey = 'A' | 'B' | 'C' | 'D' | 'E';
export const MILESTONES: { key: MilestoneKey; phase: number; label: string }[] = [
  { key: 'A', phase: 1, label: 'Ürün konsepti tamam (End of concept)' },
  { key: 'B', phase: 2, label: 'Tasarım doğrulandı ve geçerlendi' },
  { key: 'C', phase: 3, label: 'Üretime hazırlık gözden geçirmesi (PRR)' },
  { key: 'D', phase: 4, label: 'Üretim başlangıcı ve FAI' },
  { key: 'E', phase: 4, label: 'PPAP' },
];
export const APQP_PHASES = ['1 · Planlama', '2 · Ürün tasarımı ve geliştirme', '3 · Proses tasarımı ve geliştirme', '4 · Ürün ve proses geçerleme', '5 · Sürekli iyileştirme ve izleme'];

export interface Milestone {
  key: MilestoneKey;
  planned: string;
  actual: string;
  notes: string;
}

export type Deliverable = 'DFMEA' | 'PFMEA' | 'PFD' | 'CP' | 'KC list';
export const DELIVERABLES: Deliverable[] = ['DFMEA', 'PFMEA', 'PFD', 'CP', 'KC list'];

export interface DeliverableConfig {
  deliverable: Deliverable;
  /** Onay sırası (fonksiyon/rol). */
  steps: string[];
  /** Müşteri onayı gerekli (talep halinde). */
  customerRequired: boolean;
}

/**
 * Varsayılan onay adımları. PFD: "approved by Engineering, Operations and Quality" (SCMH 7.2.3 s.52).
 * CP: "Quality and production and the Customer upon request" (7.2.3 s.65). PFMEA: "Completed approved PFMEA"
 * (7.2.3 s.59, rol belirtilmemiş). DFMEA / KC listesi için kaynak rol vermez; şirket prosedürüne göre düzenlenir.
 * KC listesi: "The customer may require final approval of the KC determination" (DRA webinar Q&A s.5).
 */
export const DEFAULT_DELIVERABLE_CONFIG: DeliverableConfig[] = [
  { deliverable: 'DFMEA', steps: ['Design', 'Quality'], customerRequired: false },
  { deliverable: 'PFMEA', steps: ['Manufacturing', 'Quality'], customerRequired: false },
  { deliverable: 'PFD', steps: ['Engineering', 'Operations', 'Quality'], customerRequired: false },
  { deliverable: 'CP', steps: ['Quality', 'Production'], customerRequired: false },
  { deliverable: 'KC list', steps: ['Design', 'Quality'], customerRequired: false },
];

export interface DeliverableApproval {
  id: string;
  deliverable: Deliverable;
  /** Onay adımı (fonksiyon) veya 'Customer'. */
  step: string;
  user: string;
  role: string;
  at: string;
  decision: 'Approved' | 'Rejected' | 'Returned';
  comment: string;
  revision: string;
  /** Müşteri adımında: müşteri adına onaylayan kişi ve yazılı onay referansı. */
  customerName?: string;
  customerRef?: string;
}

export interface PpapElementDef {
  no: number;
  name: string;
  phase: number;
  /** Tasarım sorumlusu kuruluşun elemanı (webinar s.18 yıldız). */
  designOwned: boolean;
}
/** PPAP webinar s.18: 11 eleman ve APQP fazları. */
export const PPAP_ELEMENTS: PpapElementDef[] = [
  { no: 1, name: 'Design Records', phase: 2, designOwned: true },
  { no: 2, name: 'Design Risk Analysis (DRA / DFMEA)', phase: 2, designOwned: true },
  { no: 3, name: 'Process Flow Diagram', phase: 3, designOwned: false },
  { no: 4, name: 'PFMEA', phase: 3, designOwned: false },
  { no: 5, name: 'Control Plan', phase: 3, designOwned: false },
  { no: 6, name: 'MSA', phase: 4, designOwned: false },
  { no: 7, name: 'Initial Process Capability Studies', phase: 4, designOwned: false },
  { no: 8, name: 'Packing / Preservation / Labeling Approval', phase: 3, designOwned: false },
  { no: 9, name: 'FAIR (AS9102)', phase: 4, designOwned: false },
  { no: 10, name: 'Customer Specific Requirements', phase: 4, designOwned: false },
  { no: 11, name: 'PPAP Approval Form', phase: 4, designOwned: false },
];

export interface PpapElementState {
  no: number;
  /** Müşterinin istediği sunum kapsamında mı (dosya her elemanı içerir; sunum istenenleri). */
  required: boolean;
  status: 'Not started' | 'In work' | 'Complete' | 'N/A' | '';
  /** Dosya / doküman referansı (FAIR, CSR gibi dış kayıtlar için zorunlu). */
  ref: string;
  notes: string;
}

export type PpapDisposition = 'Full' | 'Interim' | 'Rejected' | '';
export interface PpapSubmission {
  id: string;
  date: string;
  level: string;
  disposition: PpapDisposition;
  /** Interim: süre veya miktar sınırı. */
  interimUntil: string;
  reasons: string;
  restrictions: string;
  customerApprover: string;
  /** Yazılı onay belgesi (sevkiyat için zorunlu, webinar s.37). */
  writtenApprovalRef: string;
  recordedBy: string;
  revision: string;
}

export interface ActionMitigation {
  actionId: string;
  note: string;
  approvedBy: string;
  date: string;
}

export interface PrrRecord {
  date: string;
  decision: 'Passed' | 'Failed' | '';
  decidedBy: string;
  comment: string;
}

export type PackAnswer = 'Yes' | 'No' | 'N/A' | '';
export interface PackItem {
  key: string;
  label: string;
  answer: PackAnswer;
  note: string;
  /** Kullanıcının eklediği madde (şablonda karşılığı yok; formda yazılmaz). */
  custom?: boolean;
}
/** 7.2.20 madde sırası (şablondaki checkbox sırası: 2 temel + 12 × Evet/Hayır/NA). */
export const PACK_ITEMS: { key: string; label: string }[] = [
  { key: 'unique', label: 'Ek müşteriye özel gereksinimlere uygunluk' },
  { key: 'cleanliness', label: 'Temizlik' },
  { key: 'preservation', label: 'Koruma (preservation)' },
  { key: 'cushioning', label: 'Yastıklama' },
  { key: 'unit', label: 'Birim ambalaj' },
  { key: 'intermediate', label: 'Ara ambalaj' },
  { key: 'unitization', label: 'Birimleştirme (unitization)' },
  { key: 'labeling', label: 'Ambalaj etiketi' },
  { key: 'esd', label: 'ESD (elektronik ürün)' },
  { key: 'msd', label: 'Neme duyarlı parça kontrolü' },
  { key: 'desiccant', label: 'Kurutucu / nem kontrolleri' },
  { key: 'environment', label: 'Çevresel kontroller (örn. ışık)' },
];

export interface PackagingRecord {
  customerPartNo: string;
  customerPartDesc: string;
  customerPartRev: string;
  supplierPartNo: string;
  supplierName: string;
  supplierCode: string;
  basis: 'Standard commercial' | 'Customer unique' | '';
  standardRef: string;
  customerSpec: string;
  items: PackItem[];
  /** Ekler: doküman ID'leri (DOC-xxx) veya dosya referansı. */
  workInstructionRef: string;
  packPhotoRef: string;
  labelPhotoRef: string;
  /** Müşteri onayı (formun 3. bölümü). İmza alanı uygulama tarafından doldurulmaz. */
  customerApprover: string;
  approvalDate: string;
  recordedBy: string;
}

export const TEAM_FUNCTIONS = ['Design', 'Manufacturing', 'Quality', 'Operations', 'Customer', 'Supplier', 'Field Service', 'HS&E', 'Other'] as const;
export interface TeamMember {
  id: string;
  name: string;
  function: string;
  fmea: ('DFMEA' | 'PFMEA')[];
  email: string;
}

export interface CriteriaAgreement {
  date: string;
  members: string;
  source: 'SCMH template' | 'AS13004' | 'J1739' | 'Company' | '';
  /** Anlaşma anındaki puanlama standardı (settings.scoringStandard). */
  standard: string;
  notes: string;
  recordedBy: string;
}

export interface PDiagram {
  id: string;
  structureId: string;
  inputs: string;
  intendedOutputs: string;
  /** Her satır bir istenmeyen çıktı → DFMEA hata modu taslağı. */
  unintendedOutputs: string;
  controlFactors: string;
  noisePieceToPiece: string;
  noiseChangeOverTime: string;
  noiseCustomerUsage: string;
  noiseEnvironment: string;
  noiseSystemInteraction: string;
  notes: string;
}

export const DRA_METHODS = ['DFMEA', 'P-diagram', 'DOE', 'Monte Carlo / probabilistic analysis', 'Tolerance stack-up', 'Test-to-failure', 'FTA', 'Design review', 'Other'];
export const KNOWLEDGE_GAPS = ['Known', 'Known unknown', 'Unknown unknown', 'Unknown known'];
export interface DraMethod {
  id: string;
  method: string;
  knowledgeGap: string;
  dfIds: string[];
  description: string;
  result: string;
  evidenceRef: string;
}

export interface FamilyRecord {
  name: string;
  partNumbers: string;
  commonalityDesign: string;
  commonalityFunction: string;
  commonalityEnvironment: string;
  /** Proses ailesi (yüksek çeşit / düşük hacim): aynı akış ve ortak özellikler. */
  processFamily: string;
  confirmedBy: string;
  date: string;
  /** "Mevcut FMEA'dan başla" ile içe alınan kaynak. */
  reusedFrom: string;
}

export interface CpAdmin {
  supplierCode: string;
  keyContact: string;
  keyContactPhone: string;
  customerEngApprovalBy: string;
  customerEngApprovalDate: string;
  customerQualityApprovalBy: string;
  customerQualityApprovalDate: string;
  otherApprovalBy: string;
  otherApprovalDate: string;
}

export interface ApqpData {
  projectType: ApqpProjectType | '';
  projectLead: string;
  elements: ApqpElement[];
  milestones: Milestone[];
  deliverableConfig: DeliverableConfig[];
  deliverableApprovals: DeliverableApproval[];
  ppap: { elements: PpapElementState[]; submissions: PpapSubmission[]; customerRef: string };
  actionMitigations: ActionMitigation[];
  prr: PrrRecord;
  packaging: PackagingRecord;
  team: TeamMember[];
  criteriaAgreement: CriteriaAgreement;
  pDiagrams: PDiagram[];
  draMethods: DraMethod[];
  family: FamilyRecord;
  /** DFMEA "design release öncesi tamamlanır" (DRA webinar s.38) takibi. */
  designReleaseDate: string;
  pdrDate: string;
  designReleaseBaselineId: string;
  cpAdmin: CpAdmin;
}

let qn = 0;
const q = (text: string, auto?: string): ChecklistItem => ({ id: `Q${++qn}`, q: text, answer: '', auto, evidenceRef: '', deviation: '', action: '' });

/**
 * Uygulamanın yazdığı FMEA odaklı kontrol soruları (SCMH 7.2.5–7.2.7 kontrol listesi soru metni sağlanmadı;
 * bunlar onların yerine geçmez). Her sorunun yanında proje verisinden öneri gösterilir; cevabı mühendis verir.
 */
export function defaultChecklist(key: string): ChecklistItem[] {
  qn = 0;
  switch (key) {
    case '1.03': return [q('Ön CI / KC listesi oluşturuldu mu?', 'kc-any')];
    case '1.05': return [q('Ön proses akışı tanımlandı mı?', 'pfd-rows')];
    case '2.01': return [q('DFMEA / DRA satırları tanımlı mı?', 'df-rows'), q('S 9–10 satırların hepsi aksiyon veya karar içeriyor mu?', 'df-high'), q('DFMEA teslimat onayı tamamlandı mı?', 'df-approved')];
    case '2.03': return [q('Ürün KC / CI adayları mühendis tarafından değerlendirildi mi?', 'kc-reviewed'), q('KC listesi onaylandı mı?', 'kc-approved')];
    case '3.01': return [q('Her proses adımının PFD tipi tanımlı mı?', 'pfd-types'), q('PFD teslimat onayı tamamlandı mı?', 'pfd-approved')];
    case '3.04': return [q('Her PFD adımının PFMEA satırı var mı?', 'pf-steps'), q('S 9–10 satırların hepsi aksiyon veya karar içeriyor mu?', 'pf-high'), q('Ön (Preliminary) PFMEA satırları kalmadı mı?', 'pf-released'), q('PFMEA teslimat onayı tamamlandı mı?', 'pf-approved')];
    case '3.05': return [q('Proses KC’leri PFMEA’dan belirlendi mi?', 'kc-process')];
    case '3.06': return [q('Onaylı KC’lerin hepsi kontrol planında mı?', 'kc-cp'), q('Ön üretim (Pre-launch) kontrol planı satırları var mı?', 'cp-prelaunch'), q('Kontrol planı teslimat onayı tamamlandı mı?', 'cp-approved')];
    case '3.09': return [q('KC’li kontrol satırları için MSA planı var mı?', 'msa-plan')];
    case '3.11': return [q('Ambalaj/koruma/etiketleme formu tamamlandı ve müşteri onayı kaydedildi mi?', 'pack-approved')];
    case '3.12': return [q('Açık FMEA aksiyonları kapatıldı veya onaylı azaltma planına bağlandı mı?', 'prr-actions')];
    case '4.02': return [q('MSA çalışmaları kabul edilebilir sonuçlandı mı?', 'msa-ok')];
    case '4.03': return [q('KC capability çalışmaları geçerli (VALID) mi?', 'cap-valid')];
    case '4.04': return [q('Üretim (Production) kontrol planı satırları var mı?', 'cp-production'), q('Kontrol planı teslimat onayı tamamlandı mı?', 'cp-approved')];
    case '4.08': return [q('PPAP kararı “Full” olarak kaydedildi mi?', 'ppap-full')];
    case '5.03': return [q('Dersler kaydedildi mi?', 'lessons')];
    case '5.03.02': return [q('Derslerden sonra DRA/PFMEA/KP baseline’ı alındı mı?', 'baseline-after-lessons')];
    default: return [];
  }
}

export function blankElement(key: string): ApqpElement {
  return { key, required: '', reason: '', approvedBy: '', assignedTo: '', targetDate: '', completedDate: '', status: '', recoveryAction: '', scheduleImpact: false, checklist: defaultChecklist(key), notes: '' };
}

export function blankPackaging(): PackagingRecord {
  return {
    customerPartNo: '', customerPartDesc: '', customerPartRev: '', supplierPartNo: '', supplierName: '', supplierCode: '', basis: '', standardRef: '', customerSpec: '',
    items: PACK_ITEMS.map((i) => ({ ...i, answer: '', note: '' })),
    workInstructionRef: '', packPhotoRef: '', labelPhotoRef: '', customerApprover: '', approvalDate: '', recordedBy: '',
  };
}

export function defaultApqp(): ApqpData {
  return {
    projectType: '',
    projectLead: '',
    elements: APQP_CATALOG.map((c) => blankElement(c.key)),
    milestones: MILESTONES.map((m) => ({ key: m.key, planned: '', actual: '', notes: '' })),
    deliverableConfig: structuredClone(DEFAULT_DELIVERABLE_CONFIG),
    deliverableApprovals: [],
    ppap: { elements: PPAP_ELEMENTS.map((e) => ({ no: e.no, required: true, status: '', ref: '', notes: '' })), submissions: [], customerRef: '' },
    actionMitigations: [],
    prr: { date: '', decision: '', decidedBy: '', comment: '' },
    packaging: blankPackaging(),
    team: [],
    criteriaAgreement: { date: '', members: '', source: '', standard: '', notes: '', recordedBy: '' },
    pDiagrams: [],
    draMethods: [],
    family: { name: '', partNumbers: '', commonalityDesign: '', commonalityFunction: '', commonalityEnvironment: '', processFamily: '', confirmedBy: '', date: '', reusedFrom: '' },
    designReleaseDate: '',
    pdrDate: '',
    designReleaseBaselineId: '',
    cpAdmin: { supplierCode: '', keyContact: '', keyContactPhone: '', customerEngApprovalBy: '', customerEngApprovalDate: '', customerQualityApprovalBy: '', customerQualityApprovalDate: '', otherApprovalBy: '', otherApprovalDate: '' },
  };
}

/** 3.0 ve öncesi dosyalarda `apqp` yoktur: varsayılanlar eklenir; mevcut alanlar korunur (ek alanlar). */
export function normalizeApqp(raw: Partial<ApqpData> | undefined): ApqpData {
  const base = defaultApqp();
  if (!raw) return base;
  const byKey = new Map((raw.elements ?? []).map((e) => [e.key, e]));
  const elements = base.elements.map((e) => ({ ...e, ...(byKey.get(e.key) ?? {}) }));
  // katalogda olmayan (ileride kaldırılmış) kayıtlar silinmez
  for (const e of raw.elements ?? []) if (!CATALOG_BY_KEY[e.key]) elements.push({ ...blankElement(e.key), ...e });
  const ms = new Map((raw.milestones ?? []).map((m) => [m.key, m]));
  const pp = new Map((raw.ppap?.elements ?? []).map((e) => [e.no, e]));
  const cfg = new Map((raw.deliverableConfig ?? []).map((c) => [c.deliverable, c]));
  const pk = { ...base.packaging, ...(raw.packaging ?? {}) };
  const items = new Map((raw.packaging?.items ?? []).map((i) => [i.key, i]));
  pk.items = [...base.packaging.items.map((i) => ({ ...i, ...(items.get(i.key) ?? {}) })), ...(raw.packaging?.items ?? []).filter((i) => !PACK_ITEMS.some((d) => d.key === i.key))];
  return {
    ...base,
    ...raw,
    elements,
    milestones: base.milestones.map((m) => ({ ...m, ...(ms.get(m.key) ?? {}) })),
    deliverableConfig: base.deliverableConfig.map((c) => ({ ...c, ...(cfg.get(c.deliverable) ?? {}) })),
    deliverableApprovals: raw.deliverableApprovals ?? [],
    ppap: {
      ...base.ppap,
      ...(raw.ppap ?? {}),
      elements: base.ppap.elements.map((e) => ({ ...e, ...(pp.get(e.no) ?? {}) })),
      submissions: raw.ppap?.submissions ?? [],
    },
    actionMitigations: raw.actionMitigations ?? [],
    prr: { ...base.prr, ...(raw.prr ?? {}) },
    packaging: pk,
    team: raw.team ?? [],
    criteriaAgreement: { ...base.criteriaAgreement, ...(raw.criteriaAgreement ?? {}) },
    pDiagrams: raw.pDiagrams ?? [],
    draMethods: raw.draMethods ?? [],
    family: { ...base.family, ...(raw.family ?? {}) },
    cpAdmin: { ...base.cpAdmin, ...(raw.cpAdmin ?? {}) },
  };
}

/** Kontrol planı fazları (CP webinar s.20: Prototype, Pre-Launch, Production). */
export type CpPhase = 'Prototype' | 'Pre-launch' | 'Production';
export const CP_PHASES: CpPhase[] = ['Prototype', 'Pre-launch', 'Production'];
/** PFMEA olgunluğu (SCMH 7.2.3 s.36: DRA ile eşzamanlı ön PFMEA). */
export const PFMEA_STAGES = ['Preliminary', 'Released'];
/** FMEA güncelleme tetikleyicisi sayılan ders kaynakları (7.2.3 s.59, s.82, s.99–100). */
export const UPDATE_TRIGGER_SOURCES = ['NCR', '8D', 'CAPA', 'Customer complaint', 'Scrap', 'Rework', 'Audit finding', 'Warranty', 'Test failure', 'Production failure', 'Production run', 'Continuous improvement'];
