import type {
  AnyRow,
  Project,
  ProjectMeta,
  Scoring,
  Settings,
  TableKey,
} from './types';

export const SCHEMA_VERSION = 1;

export const ID_PREFIX: Record<TableKey, string> = {
  documents: 'DOC',
  requirements: 'REQ',
  structure: 'FN',
  dfmea: 'DF',
  processSteps: 'OP',
  pfmea: 'PF',
  kcs: 'KC',
  controlPlan: 'CP',
  msa: 'MSA',
  capability: 'CAP',
  actions: 'ACT',
  issues: 'OI',
  lessons: 'LL',
  history: 'CH',
};

export const TABLE_LABEL: Record<TableKey, string> = {
  documents: 'Dokümanlar',
  requirements: 'Gereksinimler',
  structure: 'Yapı & Fonksiyon',
  dfmea: 'DFMEA',
  processSteps: 'Proses Akışı',
  pfmea: 'PFMEA',
  kcs: 'Kritik Karakteristikler',
  controlPlan: 'Kontrol Planı',
  msa: 'MSA',
  capability: 'Yeterlilik',
  actions: 'Aksiyonlar',
  issues: 'Açık Konular',
  lessons: 'Dersler',
  history: 'Revizyon Geçmişi',
};

/** Bir ID'nin hangi tabloya ait olduğunu prefix'ten bulur. */
export function tableOfId(id: string): TableKey | null {
  const prefix = id.split('-')[0];
  for (const [k, p] of Object.entries(ID_PREFIX)) if (p === prefix) return k as TableKey;
  return null;
}

export function nextId(project: Project, table: TableKey): string {
  const prefix = ID_PREFIX[table];
  let max = 0;
  for (const r of project[table] as AnyRow[]) {
    const m = /-(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

const fmeaCommon = {
  failureMode: '',
  effect: '',
  cause: '',
  prevention: '',
  detection: '',
  s: null,
  o: null,
  d: null,
  specialChar: '',
  recommendedAction: '',
  owner: '',
  dueDate: '',
  actionStatus: '' as const,
  actionId: '',
  actionTaken: '',
  newS: null,
  newO: null,
  newD: null,
  source: '',
  confidence: '' as const,
  approval: '' as const,
  dataStatus: '' as const,
  notes: '',
};

export function blankRow(table: TableKey, id: string): AnyRow {
  switch (table) {
    case 'documents':
      return { id, name: '', docType: '', docNumber: '', revision: '', date: '', source: '', product: '', notes: '', filePath: '' };
    case 'requirements':
      return { id, text: '', reqType: '', acceptance: '', verification: '', source: '', dataStatus: '', approval: 'AI Proposed', notes: '' };
    case 'structure':
      return { id, level: '', parentId: '', element: '', function: '', functionType: '', reqIds: [], source: '', notes: '' };
    case 'dfmea':
      return { id, ...fmeaCommon, functionId: '', function: '', reqIds: [], requirement: '', localEffect: '', higherEffect: '', verification: '' };
    case 'processSteps':
      return { id, opNo: '', name: '', description: '', machine: '', tool: '', specialProcess: false, productChars: '', processChars: '', source: '', notes: '' };
    case 'pfmea':
      return { id, ...fmeaCommon, stepId: '', opNo: '', stepName: '', processFunction: '', requirement: '', dfIds: [], errorProofing: '', measurement: '', reactionPlan: '' };
    case 'kcs':
      return { id, sourceId: '', characteristic: '', kcClass: '', specification: '', severity: null, rationale: '', status: 'AI Proposed', autoCreated: false, notes: '' };
    case 'controlPlan':
      return { id, stepId: '', opNo: '', processName: '', machine: '', tool: '', pfId: '', kcId: '', productChar: '', processChar: '', kcClass: '', specification: '', method: '', gauge: '', sampleSize: '', frequency: '', controlMethod: '', reactionPlan: '', responsible: '', autoCreated: false, notes: '' };
    case 'msa':
      return { id, cpId: '', kcId: '', characteristic: '', gauge: '', study: '', status: 'Planned', result: '', autoCreated: false, notes: '' };
    case 'capability':
      return { id, kcId: '', characteristic: '', lsl: null, usl: null, target: null, data: '', notes: '' };
    case 'actions':
      return { id, sourceId: '', description: '', actionType: '', owner: '', dueDate: '', status: 'Open', actionTaken: '', completionDate: '', newS: null, newO: null, newD: null, verification: '', notes: '' };
    case 'issues':
      return { id, description: '', priority: '', source: '', risk: '', relatedReq: '', relatedFmea: '', recommendedAction: '', responsible: '', dueDate: '', status: 'Open', answer: '' };
    case 'lessons':
      return { id, sourceType: '', reference: '', description: '', rootCause: '', linkedFmeaIds: [], lesson: '', date: '' };
    case 'history':
      return { id, revision: '', date: '', author: '', added: '', modified: '', deleted: '', description: '', approvedBy: '' };
  }
}

export const DEFAULT_META: ProjectMeta = {
  name: '',
  partNumber: '',
  partName: '',
  customer: '',
  program: '',
  drawingRevision: '',
  fmeaNumber: '',
  fmeaRevision: 'Rev A',
  preparedBy: '',
  team: '',
  startDate: '',
  revisionDate: '',
  scope: '',
  supplier: '',
  location: '',
  confidentiality: '',
};

export const DEFAULT_SETTINGS: Settings = {
  kcSeverityThreshold: 9,
  highSeverityThreshold: 8,
  rpnThreshold: null,
  targetCpk: null,
  minSamples: null,
  autoControlPlan: true,
  autoKcCandidates: true,
};

// AIAG-VDA (2019) yapısına dayalı özet kriterler. Kurum/müşteri tablosu varsa "Puanlama" sekmesinden değiştirilir.
const SEV_DF = [
  'Ürünün/sistemin güvenli çalışmasını etkiler; kullanıcı, çevre veya üçüncü kişiler için emniyet riski',
  'Yasal / regülasyon gereksinimlerine uygunsuzluk',
  'Birincil (ana) fonksiyon kaybı',
  'Birincil fonksiyonda bozulma / performans düşüşü',
  'İkincil fonksiyon kaybı',
  'İkincil fonksiyonda bozulma',
  'Çok rahatsız edici görünüm, ses, titreşim, his vb.',
  'Orta derecede rahatsız edici görünüm, ses, titreşim, his',
  'Hafif rahatsız edici görünüm, ses, titreşim, his',
  'Fark edilebilir etki yok',
];
const SEV_PF = [
  'Operatör emniyetini veya son kullanıcının güvenliğini etkileyebilir',
  'Tesis veya ürün için regülasyon / yasal uygunsuzluk',
  "Üretimin %100'ü hurda olabilir / birincil fonksiyon kaybı",
  'Üretimin bir kısmı hurda; hat dışı yeniden işleme / birincil fonksiyonda bozulma',
  '%100 hat dışı yeniden işleme / ikincil fonksiyon kaybı',
  'Bir kısmı hat dışı yeniden işleme / ikincil fonksiyonda bozulma',
  '%100 istasyonda yeniden işleme / çok rahatsız edici görünüm',
  'Bir kısmı istasyonda yeniden işleme / orta derecede rahatsız edici görünüm',
  'Proseste hafif aksama / hafif rahatsız edici görünüm',
  'Fark edilebilir etki yok',
];
const OCC_DF = [
  'Aşırı yüksek – Yeni teknoloji, deneyim yok; önleyici kontrol yok veya performansı öngörülemez',
  'Çok yüksek – Yeni tasarımın ilk kullanımı; önleyici kontroller performansı öngörmeye yetmiyor',
  'Çok yüksek – Yeni malzeme/teknoloji, sınırlı deneyim; standart veya best practice yok',
  'Yüksek – Benzer teknolojinin yeni uygulaması; önleyici kontroller kısmen etkili',
  'Yüksek – Önceki tasarımlara benzer, sorun geçmişi var; kontroller sınırlı etkili',
  'Orta – Kanıtlanmış teknolojide detay değişikliği; bazı sorun geçmişi',
  'Orta – Kısa saha deneyimli neredeyse aynı tasarım; kontroller etkili',
  'Düşük – Bilinen tasarımda küçük değişiklik; best practice ve doğrulanmış kontroller',
  'Çok düşük – Olgun tasarım, uzun saha geçmişi; kontroller kanıtlanmış etkin',
  'Aşırı düşük – Hata nedeni önleyici kontrollerle ortadan kaldırılmış',
];
const OCC_PF = [
  'Aşırı yüksek – Önleyici kontrol yok',
  'Çok yüksek – Önleyici kontrollerin etkisi çok az',
  'Çok yüksek – Önleyici kontrollerin etkisi çok az',
  'Yüksek – Önleyici kontroller kısmen etkili',
  'Yüksek – Önleyici kontroller kısmen etkili',
  'Orta – Önleyici kontroller etkili',
  'Orta – Önleyici kontroller etkili',
  'Düşük – Önleyici kontroller yüksek derecede etkili (teknik / otomatik)',
  'Düşük – Önleyici kontroller yüksek derecede etkili (teknik / otomatik)',
  'Aşırı düşük – Neden tasarım/proses ile fiziksel olarak engellenmiş (poka-yoke)',
];
const DET_DF = [
  'Test prosedürü henüz geliştirilmedi',
  'Test yöntemi bu hata modunu tespit etmek için tasarlanmadı',
  'Yeni, kanıtlanmamış test yöntemi',
  'Kanıtlanmış yöntem (pass/fail); üretim öncesi tasarım değişikliği için zaman yetersiz',
  'Kanıtlanmış yöntem (test-to-failure); zaman yetersiz',
  'Kanıtlanmış yöntem (degradation testi); zaman yetersiz',
  'Kanıtlanmış yöntem (pass/fail); üretim öncesi değişiklik için zaman yeterli',
  'Kanıtlanmış yöntem (test-to-failure); zaman yeterli',
  'Kanıtlanmış yöntem (degradation testi); zaman yeterli',
  'Hata modu fiziksel olarak oluşamaz veya tespit yöntemi her zaman tespit eder',
];
const DET_PF = [
  'Tespit yöntemi yok; test veya muayene yapılmıyor',
  'Hata modu/nedeni kolay tespit edilemiyor (örn. rastgele denetim)',
  'İnsan muayenesi (görsel/dokunsal/işitsel) veya manuel ölçüm; yöntem kanıtlanmamış',
  'Makine bazlı tespit veya muayene ekipmanı; yöntem kanıtlanmamış',
  'İnsan muayenesi veya manuel ölçüm; yöntem kanıtlanmış ve etkin',
  'Makine bazlı tespit veya muayene ekipmanı; kanıtlanmış ve etkin',
  'Otomatik tespit sonraki istasyonda; uygunsuz ürünü ayırır/durdurur',
  'Otomatik tespit aynı istasyonda; uygunsuz ürünü durdurur',
  'Nedeni tespit edip uygunsuz ürünün üretilmesini engelleyen yöntem',
  'Hata modu fiziksel olarak üretilemez veya tespit yöntemi her zaman tespit eder',
];

function table(df: string[], pf: string[]) {
  return df.map((t, i) => ({ rank: 10 - i, df: t, pf: pf[i] }));
}

export const DEFAULT_SCORING: Scoring = {
  severity: table(SEV_DF, SEV_PF),
  occurrence: table(OCC_DF, OCC_PF),
  detection: table(DET_DF, DET_PF),
};

export function newProject(): Project {
  const today = new Date().toISOString().slice(0, 10);
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { ...DEFAULT_META, startDate: today, revisionDate: today },
    settings: { ...DEFAULT_SETTINGS },
    scoring: structuredClone(DEFAULT_SCORING),
    documents: [],
    requirements: [],
    structure: [],
    dfmea: [],
    processSteps: [],
    pfmea: [],
    kcs: [],
    controlPlan: [],
    msa: [],
    capability: [],
    actions: [],
    issues: [],
    lessons: [],
    history: [
      { id: 'CH-001', revision: 'Rev A', date: today, author: '', added: '', modified: '', deleted: '', description: 'İlk sürüm', approvedBy: '' },
    ],
    changeLog: [],
  };
}

/** Eski/eksik dosyaları güncel şemaya tamamlar. */
export function normalizeProject(raw: Partial<Project>): Project {
  const base = newProject();
  const p: Project = {
    ...base,
    ...raw,
    meta: { ...base.meta, ...(raw.meta ?? {}) },
    settings: { ...base.settings, ...(raw.settings ?? {}) },
    scoring: raw.scoring ?? base.scoring,
    changeLog: raw.changeLog ?? [],
  } as Project;
  for (const t of Object.keys(ID_PREFIX) as TableKey[]) {
    const rows = (raw[t] as AnyRow[] | undefined) ?? (t === 'history' ? base.history : []);
    (p as unknown as Record<string, AnyRow[]>)[t] = rows.map((r) => ({ ...blankRow(t, r.id), ...r }) as AnyRow);
  }
  return p;
}

export const LISTS = {
  reqType: ['Functional', 'Performance', 'Dimensional', 'Material', 'Structural', 'Environmental', 'Safety', 'Reliability', 'Interface', 'Manufacturing', 'Inspection', 'Regulatory', 'Customer-specific'],
  docType: ['Teknik resim', 'Teknik şartname', 'Müşteri gereksinimi', 'CAD (STEP/IGES/DXF)', 'E-posta', 'Toplantı notu', 'Malzeme datasheet', 'Proses spesifikasyonu', 'Üretim talimatı', 'Kontrol planı', 'Test raporu', 'Laboratuvar raporu', 'Önceki FMEA', 'NCR / CAPA / 8D', 'Müşteri şikayeti', 'Üretim problemi kaydı', 'Diğer'],
  functionType: ['Taşıma', 'Yük aktarma', 'Sızdırmazlık', 'Elektromanyetik performans', 'Termal dayanım', 'Geometrik uyum', 'Bağlantı', 'Yüzey koruması', 'Aerodinamik / akış performansı', 'Titreşim dayanımı', 'Çevresel dayanım', 'Diğer'],
  level: ['Product', 'Assembly', 'Part', 'Feature'],
  approval: ['AI Proposed', 'Engineer Reviewed', 'Approved', 'Rejected'],
  confidence: ['High', 'Medium', 'Low'],
  dataStatus: ['Dokümandan (kaynaklı)', 'VERİ YOK – doğrulanmalı', 'AI VARSAYIMI – mühendislik doğrulaması gerekli', 'AI RECOMMENDATION'],
  actionStatus: ['Open', 'In Progress', 'Completed', 'Cancelled'],
  issueStatus: ['Open', 'Under Review', 'Waiting Customer', 'Resolved', 'Closed'],
  priority: ['Critical', 'Important', 'Optional'],
  kcClass: ['KC-1 Critical', 'KC-2 Significant', 'KC-3 Process KC'],
  specialChar: ['Safety', 'Regulatory', 'Critical', 'Significant', 'Process'],
  actionType: ['Design change', 'Process change', 'Prevention control', 'Detection control', 'Error proofing', 'Validation / Test', 'Analysis', 'Work instruction / Documentation', 'Training (destekleyici)'],
  errorProofing: ['Poka-yoke', 'Barcode', 'QR verification', 'Interlock', 'Software parameter lock', 'Fixture', 'Template', 'Visual aid', 'Automated inspection', 'Sensor', 'Recipe management', 'None (operator dependent)'],
  llSource: ['NCR', '8D', 'CAPA', 'Customer complaint', 'Scrap', 'Rework', 'Warranty', 'Production failure'],
  msaStudy: ['Gage R&R', 'Bias', 'Linearity', 'Stability', 'Calibration', 'Attribute Agreement Analysis'],
  msaStatus: ['Planned', 'In Progress', 'Acceptable', 'Conditionally acceptable', 'Not acceptable'],
  processStep: ['Incoming Material', 'Storage', 'Material Preparation', 'Cutting', 'Kitting', 'Lay-up', 'Debulk', 'Vacuum Bagging', 'Cure', 'Demolding', 'Machining', 'Bonding', 'Surface Treatment', 'Painting', 'Inspection', 'Assembly', 'Final Inspection', 'Packaging'],
};

/** Spesifikasyon §9 – kompozit PFMEA'da otomatik değerlendirilecek hata modları. */
export const COMPOSITE_CHECKLIST: Record<string, string[]> = {
  Material: ['wrong material', 'wrong prepreg', 'expired material', 'out-of-life material', 'incorrect storage temperature', 'incorrect thawing', 'moisture absorption', 'contamination', 'wrong batch', 'wrong fiber orientation'],
  'Lay-up': ['missing ply', 'extra ply', 'wrong ply orientation', 'wrong material', 'wrong ply sequence', 'incorrect overlap', 'incorrect stagger', 'wrinkle', 'bridging', 'foreign material', 'contamination', 'ply shift', 'incorrect splice', 'incorrect ply drop'],
  Core: ['wrong core density', 'wrong core thickness', 'crushed core', 'damaged core', 'moisture', 'incorrect bonding', 'incorrect scarf', 'incorrect geometry'],
  'Vacuum Bagging': ['vacuum leak', 'incorrect bagging', 'incorrect breather', 'blocked vacuum path', 'bridging', 'incorrect vacuum port location', 'incorrect sealant application'],
  Cure: ['incorrect temperature', 'incorrect pressure', 'incorrect vacuum', 'incorrect heating rate', 'incorrect dwell time', 'incorrect cooling rate', 'thermocouple failure', 'incorrect cure cycle', 'resin-rich area', 'resin-starved area', 'porosity', 'delamination', 'incomplete cure', 'excessive exotherm'],
  Machining: ['delamination', 'fiber pull-out', 'dimensional error', 'hole oversize', 'hole undersize', 'burr', 'thermal damage', 'surface damage'],
  Bonding: ['incorrect adhesive', 'wrong adhesive batch', 'expired adhesive', 'incorrect surface preparation', 'contamination', 'incorrect adhesive thickness', 'void', 'insufficient pressure', 'insufficient cure', 'incorrect cure temperature', 'incorrect overlap', 'bondline variation'],
  Finishing: ['incorrect coating thickness', 'poor adhesion', 'contamination', 'surface defect', 'incorrect masking', 'incorrect curing'],
};

/** Ölçüm tipi → önerilen yöntem ve MSA çalışması (AI RECOMMENDATION). */
export const MEASUREMENT_MAP: { type: string; method: string; msa: string }[] = [
  { type: 'Dimensional', method: 'CMM / kalibre ölçü aleti / mastar', msa: 'Gage R&R + Bias + Linearity + Stability + Calibration' },
  { type: 'Hole diameter', method: 'Tapa/pim mastar, bore gauge veya CMM', msa: 'Gage R&R + Bias + Linearity + Stability + Calibration' },
  { type: 'Hole position', method: 'CMM / pozisyon mastarı / kontrol fikstürü', msa: 'Gage R&R + Bias + Stability + Calibration' },
  { type: 'Thickness', method: 'Mikrometre / kalınlık ölçer / ultrasonik kalınlık', msa: 'Gage R&R + Bias + Linearity + Stability + Calibration' },
  { type: 'Bondline thickness', method: 'Thickness gauge / ultrasonic', msa: 'Gage R&R + Bias + Linearity + Stability + Calibration' },
  { type: 'Fiber orientation', method: 'Visual / template / digital work instruction', msa: 'Attribute Agreement Analysis' },
  { type: 'Coating thickness', method: 'Kuru film kalınlık ölçer', msa: 'Gage R&R + Bias + Linearity + Stability + Calibration' },
  { type: 'Surface roughness', method: 'Profilometre', msa: 'Gage R&R + Bias + Stability + Calibration' },
  { type: 'Torque', method: 'Kalibre tork anahtarı / tork analizörü', msa: 'Gage R&R + Bias + Stability + Calibration' },
  { type: 'Temperature', method: 'Kalibre termokupl + veri kaydı', msa: 'Calibration + Bias + Stability' },
  { type: 'Pressure', method: 'Kalibre basınç transdüseri + veri kaydı', msa: 'Calibration + Bias + Stability' },
  { type: 'Vacuum', method: 'Kalibre vakum göstergesi + veri kaydı', msa: 'Calibration + Bias + Stability' },
  { type: 'Weight', method: 'Kalibre terazi', msa: 'Gage R&R + Bias + Calibration' },
  { type: 'Internal defect (NDT)', method: 'NDT (UT / thermography / X-ray / tap test) – kabul kriteri VERİ YOK', msa: 'NDT personel/yöntem yeterliliği + Attribute Agreement Analysis' },
  { type: 'Visual / cosmetic', method: 'Görsel muayene + limit numune', msa: 'Attribute Agreement Analysis' },
];
