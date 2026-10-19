// FMEA proje veri modeli. Tüm tablolar sabit ID'li satırlardan oluşur (REQ-001, DF-001 ...);
// ekranlar arası bağlantılar bu ID'ler üzerinden kurulur.

export type Approval = 'AI Proposed' | 'Engineer Reviewed' | 'Approved' | 'Rejected' | '';
export type Confidence = 'High' | 'Medium' | 'Low' | '';
export type DataStatus =
  | 'Dokümandan (kaynaklı)'
  | 'VERİ YOK – doğrulanmalı'
  | 'AI VARSAYIMI – mühendislik doğrulaması gerekli'
  | 'AI RECOMMENDATION'
  | '';
export type ActionStatus = 'Open' | 'In Progress' | 'Completed' | 'Cancelled' | '';
export type IssueStatus = 'Open' | 'Under Review' | 'Waiting Customer' | 'Resolved' | 'Closed' | '';
export type KcClass = 'KC-1 Critical' | 'KC-2 Significant' | 'KC-3 Process KC' | '';
export type Score = number | null;

export interface BaseRow {
  id: string;
  /** Değişiklik yönetimi: kaynak doküman/gereksinim değiştiğinde dolar. */
  reassess?: string;
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
}

export type StructureLevel = 'Product' | 'Assembly' | 'Part' | 'Feature';

export interface StructureRow extends BaseRow {
  level: StructureLevel | '';
  parentId: string;
  element: string;
  function: string;
  functionType: string;
  reqIds: string[];
  source: string;
  notes: string;
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
}

export interface DfmeaRow extends FmeaCommon {
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
}

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
}

export interface CapabilityRow extends BaseRow {
  kcId: string;
  characteristic: string;
  lsl: number | null;
  usl: number | null;
  target: number | null;
  data: string; // virgül/boşluk/satır ile ayrılmış ölçümler
  notes: string;
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
  | 'history';

export type AnyRow = Project[TableKey][number];
