// FMEA proje veri modeli. Tüm tablolar sabit ID'li satırlardan oluşur (REQ-001, DF-001 ...);
// ekranlar arası bağlantılar bu ID'ler üzerinden kurulur.

export type Approval = 'AI Proposed' | 'Engineer Reviewed' | 'Approved' | 'Rejected' | '';
export type Confidence = 'High' | 'Medium' | 'Low' | '';
export type DataStatus =
  | 'Dokümandan (kaynaklı)'
  | 'VERİ YOK – doğrulanmalı'
  | 'DOĞRULAMA GEREKLİ'
  | 'AI VARSAYIMI – mühendislik doğrulaması gerekli'
  | 'AI RECOMMENDATION'
  | 'AI SUGGESTION'
  | 'ENGINEERING SUGGESTION – VERIFY'
  | '';
/** Kaydın nereden geldiği (2.0). */
export type Origin = 'manual' | 'ai' | 'import' | 'extraction' | 'template' | 'similar' | '';
/** AI çıktısında bilginin dayanağı – Engineering Knowledge Mode'da ayrı gösterilir (§58). */
export type Basis = 'SOURCE DATA' | 'ENGINEERING KNOWLEDGE' | 'AI INFERENCE' | '';
export type Cause4M = 'Man' | 'Machine' | 'Material' | 'Method' | 'Measurement' | 'Environment' | '';
export type KcCategory = 'Normal' | 'Significant' | 'Critical' | 'Key Characteristic' | 'Safety Characteristic' | 'Regulatory Characteristic' | '';
export type CharType = 'Product Characteristic' | 'Process Characteristic' | 'Process Parameter' | '';
export type Verification = 'VERIFIED' | 'VERIFIED – farklı konum' | 'SOURCE NOT VERIFIED' | 'MANUAL VERIFICATION REQUIRED' | '';
export type ActionStatus = 'Open' | 'In Progress' | 'Completed' | 'Cancelled' | '';
export type IssueStatus = 'Open' | 'Under Review' | 'Waiting Customer' | 'Resolved' | 'Closed' | '';
export type KcClass = 'KC-1 Critical' | 'KC-2 Significant' | 'KC-3 Process KC' | '';
export type Score = number | null;

export interface BaseRow {
  id: string;
  /** Değişiklik yönetimi: kaynak doküman/gereksinim değiştiğinde dolar. */
  reassess?: string;
  /** 2.0: kaydın kaynağı (elle, AI, içe aktarma, doküman çıkarımı ...). */
  origin?: Origin;
  /** 2.0: bu kaydı destekleyen kanıtlar (EV-xxx). */
  evidenceIds?: string[];
  /** 2.0: AI önerisi reddedildiyse gerekçe (§72). */
  rejectReason?: string;
}

export interface ProjectMeta {
  name: string;
  partNumber: string;
  partName: string;
  customer: string;
  program: string;
  drawingRevision: string;
  fmeaNumber: string;
  fmeaRevision: string;
  preparedBy: string;
  team: string;
  startDate: string;
  revisionDate: string;
  scope: string;
  supplier: string;
  location: string;
  confidentiality: string;
  // SCMH başlık alanları (IAQG SCMH 7.2.9–7.2.13 şablonları)
  /** Company/Organization Name (boşsa `supplier` kullanılır). */
  organization: string;
  /** Export Control Classification */
  exportControl: string;
  /** Other Restrictions (boşsa `confidentiality` kullanılır). */
  otherRestrictions: string;
  /** DFMEA: Product Owner & E-mail */
  productOwner: string;
  /** PFD / PFMEA / Control Plan: Process Owner & E-mail */
  processOwner: string;
  /** DFMEA / PFMEA Facilitator & E-mail (boşsa `preparedBy` kullanılır). */
  facilitator: string;
  /** DFMEA seviyesi checkbox'ı: SCMH_DFMEA_LEVELS ('System' | 'Subsystem' | 'Component') veya ''. */
  dfmeaLevel: string;
  /** PFMEA / Control Plan aşaması checkbox'ı: SCMH_PHASES ('Pre-Production' | 'Production') veya ''. */
  scmhPhase: string;
}

export interface Settings {
  /** Bu değer ve üzeri Severity → otomatik KC adayı. */
  kcSeverityThreshold: number;
  /** Bu değer ve üzeri Severity → High Severity vurgusu. */
  highSeverityThreshold: number;
  /** RPN aksiyon eşiği (boş = kullanılmaz; SCMH eşiksiz çalışır). */
  rpnThreshold: number | null;
  /** Capability hedefleri (boş = VERİ YOK). */
  targetCpk: number | null;
  minSamples: number | null;
  /** Kritik karakteristik onaylandığında kontrol planı satırı otomatik önerilsin. */
  autoControlPlan: boolean;
  /** Yüksek severity satırlar için otomatik KC adayı önerilsin. */
  autoKcCandidates: boolean;
  // 2.0
  userName: string;
  userRole: string;
  /** Strict Engineering Mode (§57) / Engineering Knowledge Mode (§58) */
  aiMode: 'strict' | 'knowledge';
  productType: string;
  causeView: '4M' | '5M+E';
  kcRules: KcRules;
  kcClasses: string[];
  workflow: { step: WorkflowStep; enabled: boolean; role: string }[];
  /** Bu alanlar değişirken neden sorulur (§37). */
  reasonFields: string[];
  /** Puanlama/önceliklendirme standardı. SCMH: RPN eşiği yok, S 9–10 her zaman incelenir. */
  scoringStandard: 'SCMH' | 'AIAG-VDA';
}

export interface DocumentRow extends BaseRow {
  name: string;
  docType: string;
  docNumber: string;
  revision: string;
  date: string;
  source: string;
  product: string;
  notes: string;
  filePath: string;
  /** 2.0: analiz durumu (docIndex özetinden). */
  parseStatus: string;
}

export interface RequirementRow extends BaseRow {
  text: string;
  reqType: string;
  acceptance: string;
  verification: string;
  source: string;
  dataStatus: DataStatus;
  approval: Approval;
  notes: string;
  // 2.0 Requirement Engine (§12)
  characteristic: string;
  nominal: number | null;
  lsl: number | null;
  usl: number | null;
  unit: string;
  tolerance: string;
  sourceDocId: string;
  sourcePage: string;
  sourceSection: string;
  sourceCell: string;
  balloon: string;
  evidenceText: string;
  confidence: Confidence;
}

export type StructureLevel = 'System' | 'Subsystem' | 'Product' | 'Assembly' | 'Component' | 'Part' | 'Feature';

export interface StructureRow extends BaseRow {
  level: StructureLevel | '';
  parentId: string;
  element: string;
  function: string;
  functionType: string;
  reqIds: string[];
  source: string;
  notes: string;
  // 2.0 Function analysis (§16)
  performanceReq: string;
  constraint: string;
  interface: string;
}

interface FmeaCommon extends BaseRow {
  failureMode: string;
  effect: string;
  cause: string;
  prevention: string;
  detection: string;
  s: Score;
  o: Score;
  d: Score;
  specialChar: string;
  recommendedAction: string;
  owner: string;
  dueDate: string;
  actionStatus: ActionStatus;
  actionId: string;
  actionTaken: string;
  newS: Score;
  newO: Score;
  newD: Score;
  source: string;
  confidence: Confidence;
  approval: Approval;
  dataStatus: DataStatus;
  notes: string;
  // 2.0 S/O/D gerekçesi (§24–25): kriter puanın kendisinden gelir; gerekçe, kanıt, güven saklanır.
  sReason: string;
  sEvidence: string;
  sConf: Confidence;
  oReason: string;
  oEvidence: string;
  oConf: Confidence;
  dReason: string;
  dEvidence: string;
  dConf: Confidence;
  basis: Basis;
}

export interface DfmeaRow extends FmeaCommon {
  system: string;
  subsystem: string;
  component: string;
  functionId: string;
  function: string;
  reqIds: string[];
  requirement: string;
  localEffect: string;
  higherEffect: string;
  verification: string;
}

export interface ProcessStepRow extends BaseRow {
  opNo: string;
  name: string;
  description: string;
  machine: string;
  tool: string;
  specialProcess: boolean;
  productChars: string;
  processChars: string;
  source: string;
  notes: string;
  /** SCMH PFD adım tipi (birden çok seçilebilir). */
  stepType: PfdStepType[];
  /** "Other (Specify)" seçildiğinde açıklama. */
  stepTypeOther: string;
  /** SCMH Classification: KC / CI ID'leri (örn. "KC-001; KC-002"). Boşsa PFMEA/KP bağlantılarından türetilir. */
  classification: string;
}

export const SCMH_DFMEA_LEVELS = ['System', 'Subsystem', 'Component'] as const;
export const SCMH_PHASES = ['Pre-Production', 'Production'] as const;

export type PfdStepType = 'Operation' | 'Setup' | 'Move' | 'Store' | 'Inspect/Test' | 'Other' | 'Rework';
export const PFD_STEP_TYPES: PfdStepType[] = ['Operation', 'Setup', 'Move', 'Store', 'Inspect/Test', 'Other', 'Rework'];

export interface PfmeaRow extends FmeaCommon {
  stepId: string;
  opNo: string;
  stepName: string;
  processFunction: string;
  requirement: string;
  dfIds: string[];
  errorProofing: string;
  measurement: string;
  reactionPlan: string;
  // 2.0 (§19–21)
  processElement: string;
  cause4M: Cause4M;
  why1: string;
  why2: string;
  why3: string;
  why4: string;
  why5: string;
  rootCause: string;
}

/** 2.0 Special Process Engine (§23): proses parametresi → ürün karakteristiği → hata modu → kontrol. */
export interface ProcessParamRow extends BaseRow {
  stepId: string;
  parameter: string;
  category: string;
  nominal: number | null;
  lsl: number | null;
  usl: number | null;
  unit: string;
  productCharacteristic: string;
  pfIds: string[];
  prevention: string;
  monitoring: string;
  reaction: string;
  validation: string;
  source: string;
  notes: string;
}

export interface KcRow extends BaseRow {
  sourceId: string; // DF-xxx veya PF-xxx
  characteristic: string;
  kcClass: KcClass;
  specification: string;
  severity: Score;
  rationale: string;
  status: Approval;
  autoCreated: boolean;
  notes: string;
  // 2.0 Special Characteristic Engine (§27)
  category: KcCategory;
  fSafety: boolean;
  fRegulatory: boolean;
  fCustomer: boolean;
  fSpecialProcess: boolean;
  fTolerance: boolean;
  fCapability: boolean;
  fHistorical: boolean;
  fDetection: boolean;
}

export interface ControlPlanRow extends BaseRow {
  stepId: string;
  opNo: string;
  processName: string;
  machine: string;
  tool: string;
  pfId: string;
  kcId: string;
  productChar: string;
  processChar: string;
  kcClass: string;
  specification: string;
  method: string;
  gauge: string;
  sampleSize: string;
  frequency: string;
  controlMethod: string;
  reactionPlan: string;
  responsible: string;
  autoCreated: boolean;
  notes: string;
  // 2.0 (§28–29)
  charType: CharType;
  tolerance: string;
  record: string;
  ppId: string;
  /** SCMH CP "Reference": resim konumu / şartname bölümü (PFD ve PFMEA ile aynı numara). */
  reference: string;
}

export interface MsaRow extends BaseRow {
  cpId: string;
  kcId: string;
  characteristic: string;
  gauge: string;
  study: string;
  status: string;
  result: string;
  autoCreated: boolean;
  notes: string;
  dataType: 'Variable' | 'Attribute' | '';
}

export interface CapabilityRow extends BaseRow {
  kcId: string;
  characteristic: string;
  lsl: number | null;
  usl: number | null;
  target: number | null;
  data: string; // virgül/boşluk/satır ile ayrılmış ölçümler
  notes: string;
  subgroupSize: number | null;
  distribution: 'Normal' | 'Non-normal' | 'Unknown' | '';
}

export interface ActionRow extends BaseRow {
  sourceId: string; // DF-/PF-
  description: string;
  actionType: string;
  owner: string;
  dueDate: string;
  status: ActionStatus;
  actionTaken: string;
  completionDate: string;
  newS: Score;
  newO: Score;
  newD: Score;
  verification: string;
  notes: string;
}

export interface IssueRow extends BaseRow {
  description: string;
  priority: 'Critical' | 'Important' | 'Optional' | '';
  source: string;
  risk: string;
  relatedReq: string;
  relatedFmea: string;
  recommendedAction: string;
  responsible: string;
  dueDate: string;
  status: IssueStatus;
  answer: string;
}

export interface LessonRow extends BaseRow {
  sourceType: string;
  reference: string;
  description: string;
  rootCause: string;
  linkedFmeaIds: string[];
  lesson: string;
  date: string;
  // 2.0 Lessons Learned Knowledge Base (§33)
  product: string;
  process: string;
  failureMode: string;
  previousAction: string;
  status: string;
}

/** 2.0 Evidence System (§13): her kanıt doküman konumuna ve alıntıya bağlıdır. */
export interface EvidenceRow extends BaseRow {
  docId: string;
  page: string;
  section: string;
  sheet: string;
  cell: string;
  balloon: string;
  quote: string;
  evidenceType: string;
  basis: Basis;
  confidence: Confidence;
  verification: Verification;
  verifiedLocation: string;
  linkedIds: string[];
  aiRunId: string;
  notes: string;
}

/** 2.0 Change Impact (§34) */
export interface ChangeRequestRow extends BaseRow {
  title: string;
  trigger: string;
  description: string;
  impactedIds: string[];
  status: 'Open' | 'Assessed' | 'Implemented' | 'Rejected' | '';
  requestedBy: string;
  date: string;
  decision: string;
}

/** 2.0 AI çalıştırma kaydı (§37, §64). */
export interface AiRunRow extends BaseRow {
  role: string;
  provider: string;
  model: string;
  at: string;
  inputs: string;
  mode: string;
  status: 'ok' | 'error' | '';
  errorKind: string;
  message: string;
  items: number;
  accepted: number;
  rejected: number;
  tokensIn: number;
  tokensOut: number;
  cached: boolean;
}

export interface HistoryRow extends BaseRow {
  revision: string;
  date: string;
  author: string;
  added: string;
  modified: string;
  deleted: string;
  description: string;
  approvedBy: string;
}

export interface ScoringEntry {
  rank: number;
  df: string;
  pf: string;
}

export interface Scoring {
  severity: ScoringEntry[];
  occurrence: ScoringEntry[];
  detection: ScoringEntry[];
  /**
   * 2.0: şirkete özel AP tablosu (§26). Anahtar "S bandı,O bandı" (1–5), değer D bantları için 4 harf
   * [D=1, D=2–4, D=5–6, D=7–10], örn. { "5,5": "HHHH" }. Boş = AIAG-VDA 2019.
   */
  apTable?: Record<string, string> | null;
  /** Tablonun adı / kaynağı (örn. "Şirket AP Tablosu Rev 2"). */
  apName?: string;
}

export type WorkflowStep = 'AI Draft' | 'Engineer Review' | 'Design Review' | 'Manufacturing Review' | 'Quality Review' | 'Final Approval' | 'Baseline';
export const WORKFLOW_STEPS: WorkflowStep[] = ['AI Draft', 'Engineer Review', 'Design Review', 'Manufacturing Review', 'Quality Review', 'Final Approval', 'Baseline'];
export const ROLES = ['Design Engineer', 'Manufacturing Engineer', 'Quality Engineer', 'Configuration Engineer', 'Approver'] as const;

/** KC değerlendirme faktörleri (§27). Severity eşiği `kcSeverityThreshold` ayarındadır. */
export interface KcRules {
  safety: boolean;
  regulatory: boolean;
  customer: boolean;
  specialProcess: boolean;
  tolerance: boolean;
  capability: boolean;
  historical: boolean;
  detection: boolean;
}

/** 2.0 Revision / Baseline (§35): baseline değiştirilemez; snapshot + SHA-256 ile korunur. */
export interface Baseline {
  id: string;
  revision: string;
  author: string;
  date: string;
  approver: string;
  approvalComment: string;
  changeReason: string;
  hash: string;
  snapshot: string;
}

export interface ApprovalRecord {
  id: string;
  step: WorkflowStep;
  role: string;
  user: string;
  at: string;
  decision: 'Approved' | 'Rejected' | 'Returned';
  comment: string;
  revision: string;
}

/** 2.0 Audit Trail (§37) */
export interface AuditEntry {
  at: string;
  user: string;
  kind: 'Added' | 'Modified' | 'Deleted' | 'Approval' | 'AI' | 'Baseline' | 'Import';
  table: string;
  id: string;
  field?: string;
  from?: unknown;
  to?: unknown;
  reason?: string;
  comment?: string;
  revision: string;
}

/** Revizyonlar arası değişiklik sayacı (Added/Modified/Deleted). */
export interface ChangeLogEntry {
  at: string;
  kind: 'Added' | 'Modified' | 'Deleted';
  table: TableKey;
  id: string;
  field?: string;
  from?: unknown;
  to?: unknown;
}

export interface Project {
  schemaVersion: number;
  meta: ProjectMeta;
  settings: Settings;
  scoring: Scoring;
  documents: DocumentRow[];
  requirements: RequirementRow[];
  structure: StructureRow[];
  dfmea: DfmeaRow[];
  processSteps: ProcessStepRow[];
  pfmea: PfmeaRow[];
  kcs: KcRow[];
  controlPlan: ControlPlanRow[];
  msa: MsaRow[];
  capability: CapabilityRow[];
  actions: ActionRow[];
  issues: IssueRow[];
  lessons: LessonRow[];
  history: HistoryRow[];
  changeLog: ChangeLogEntry[];
  // 2.0
  processParams: ProcessParamRow[];
  evidence: EvidenceRow[];
  changeRequests: ChangeRequestRow[];
  aiRuns: AiRunRow[];
  baselines: Baseline[];
  approvals: ApprovalRecord[];
  auditLog: AuditEntry[];
  /** Doküman analiz çıktısı (yerel ayrıştırma); kaynak doğrulama için dosyada saklanır. */
  docIndex: Record<string, import('./docmodel').ExtractedDoc>;
}

export type TableKey =
  | 'documents'
  | 'requirements'
  | 'structure'
  | 'dfmea'
  | 'processSteps'
  | 'pfmea'
  | 'kcs'
  | 'controlPlan'
  | 'msa'
  | 'capability'
  | 'actions'
  | 'issues'
  | 'lessons'
  | 'history'
  | 'processParams'
  | 'evidence'
  | 'changeRequests'
  | 'aiRuns';

export type AnyRow = Project[TableKey][number];
