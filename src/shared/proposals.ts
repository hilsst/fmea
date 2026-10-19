// Human-in-the-loop (§70): AI çıktısı → kontrol edilebilir öneriler. Kabul edilenler "AI Proposed" eklenir,
// kanıtlar EV kayıtlarına dönüşür ve kaynakta doğrulanmayan sayısal değerler silinir (§14, §64).
import type { AiRunMeta } from './aischema';
import { locText, verifySource, type DocLoc, type ExtractedDoc, type SourceCheck } from './docmodel';
import { blankRow, nextId } from './model';
import type { AiRunRow, AnyRow, Basis, Confidence, DataStatus, EvidenceRow, Project, TableKey, Verification } from './types';

export type Decision = 'pending' | 'accepted' | 'rejected';

export interface ProposalEvidence {
  docName: string;
  page: string;
  section: string;
  sheet: string;
  cell: string;
  balloon: string;
  quote: string;
  evidenceType: string;
}

export interface ProposalItem {
  key: string;
  table: TableKey;
  row: Record<string, unknown>;
  evidence: ProposalEvidence[];
  checks: SourceCheck[];
  confidence: Confidence;
  basis: Basis;
  /** Critical / Safety / Regulatory → toplu kabul yapılamaz. */
  critical: boolean;
  warnings: string[];
  decision: Decision;
  rejectReason: string;
}

export interface ProposalSet {
  kind: 'requirements' | 'dfmea' | 'pfmea';
  items: ProposalItem[];
  issues: { description: string; priority: string; source: string; risk: string; recommendedAction: string; decision: Decision }[];
  params: Record<string, unknown>[];
  meta: AiRunMeta;
  note?: string;
  docId?: string;
  inputs: string;
}

const s = (v: unknown) => (v == null ? '' : String(v));
const conf = (v: unknown): Confidence => (v === 'High' || v === 'Medium' || v === 'Low' ? v : 'Low');
const basisOf = (v: unknown): Basis => (v === 'SOURCE DATA' || v === 'ENGINEERING KNOWLEDGE' || v === 'AI INFERENCE' ? v : 'AI INFERENCE');
const score = (v: unknown) => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 10 ? v : null);

function toLoc(e: ProposalEvidence): DocLoc {
  const page = Number(e.page);
  return { page: e.page && Number.isFinite(page) ? page : undefined, section: e.section || undefined, sheet: e.sheet || undefined, cell: e.cell || undefined, balloon: e.balloon || undefined };
}

function findDoc(p: Project, docName: string, docId?: string): ExtractedDoc | undefined {
  if (docId && p.docIndex[docId]) return p.docIndex[docId];
  const n = docName.toLowerCase();
  return Object.values(p.docIndex).find((d) => d.fileName.toLowerCase() === n) ?? Object.values(p.docIndex).find((d) => n && d.fileName.toLowerCase().includes(n));
}

const verifiedOk = (c: SourceCheck) => c.verdict === 'VERIFIED' || c.verdict === 'VERIFIED – farklı konum';

/** Sayı kanıt metninde birebir geçiyor mu? (2.00 ↔ 2, 2,00 ↔ 2.00 eşdeğer) */
function numberInText(n: number, text: string): boolean {
  const nums = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.')));
  return nums.some((x) => Math.abs(x - n) < 1e-9) || nums.some((a) => nums.some((b) => Math.abs(a - b - n) < 1e-9 || Math.abs(a + b - n) < 1e-9));
}

function dataStatusFor(basis: Basis, checks: SourceCheck[], mode: string): DataStatus {
  if (basis === 'SOURCE DATA' && checks.length && checks.every(verifiedOk)) return 'Dokümandan (kaynaklı)';
  if (basis === 'SOURCE DATA') return 'DOĞRULAMA GEREKLİ';
  return mode === 'strict' ? 'ENGINEERING SUGGESTION – VERIFY' : 'AI SUGGESTION';
}

export function buildProposals(p: Project, kind: ProposalSet['kind'], data: Record<string, unknown>, meta: AiRunMeta, opts: { docId?: string; inputs: string; note?: string }): ProposalSet {
  const raw = ((kind === 'requirements' ? data.requirements : data.rows) ?? []) as Record<string, unknown>[];
  const items: ProposalItem[] = raw.map((r, i) => {
    const evs = (Array.isArray(r.evidence) ? r.evidence : r.evidence ? [r.evidence] : []) as ProposalEvidence[];
    const evidence = evs.filter((e) => e && (e.quote || e.docName));
    const checks = evidence.map((e) => verifySource(findDoc(p, e.docName, opts.docId), e.quote, toLoc(e)));
    let basis = basisOf(r.basis);
    const warnings: string[] = [];
    if (basis === 'SOURCE DATA' && !evidence.some((e) => e.quote)) {
      basis = 'AI INFERENCE';
      warnings.push('Kaynak gösterilmeden SOURCE DATA denmiş; AI INFERENCE olarak işaretlendi.');
    }
    for (const c of checks) if (!verifiedOk(c)) warnings.push(`${c.verdict}: ${c.note}`);
    let confidence = conf(r.confidence);
    if (checks.some((c) => c.verdict === 'SOURCE NOT VERIFIED')) confidence = 'Low';
    const row: Record<string, unknown> = { origin: 'ai', approval: 'AI Proposed', confidence };
    const quoteAll = evidence.map((e) => e.quote).join(' ');
    const src = evidence.map((e) => [e.docName, locText(toLoc(e))].filter(Boolean).join(' / ')).filter(Boolean).join('; ');
    if (kind === 'requirements') {
      Object.assign(row, {
        text: s(r.text), reqType: s(r.reqType), characteristic: s(r.characteristic), unit: s(r.unit), tolerance: s(r.tolerance),
        acceptance: s(r.acceptance), verification: s(r.verification), source: src || opts.docId || '',
        sourceDocId: opts.docId ?? '', sourcePage: evidence[0]?.page ?? '', sourceSection: evidence[0]?.section ?? '', sourceCell: evidence[0]?.cell ?? '', balloon: evidence[0]?.balloon ?? '',
        evidenceText: evidence[0]?.quote ?? '',
      });
      // Kaynakta doğrulanamayan sayısal değer üretilmez (§14)
      for (const k of ['nominal', 'lsl', 'usl'] as const) {
        const v = r[k];
        if (typeof v !== 'number') row[k] = null;
        else if (evidence.length && checks.some(verifiedOk) && numberInText(v, quoteAll)) row[k] = v;
        else {
          row[k] = null;
          warnings.push(`${k.toUpperCase()}=${v} kaynak alıntısında doğrulanamadı → VERİ YOK.`);
        }
      }
      if (/VERİ YOK|DOĞRULAMA GEREKLİ/.test(s(r.acceptance)) || !s(r.acceptance)) row.acceptance = s(r.acceptance) || 'VERİ YOK';
      if (r.lowConfidenceReason) warnings.push(`LOW CONFIDENCE: ${s(r.lowConfidenceReason)}`);
    } else {
      const common = {
        failureMode: s(r.failureMode), effect: s(r.effect), cause: s(r.cause), prevention: s(r.prevention), detection: s(r.detection),
        s: score(r.s), o: score(r.o), d: score(r.d), recommendedAction: s(r.recommendedAction), basis,
        sReason: s((r.sWhy as Record<string, unknown>)?.reason), sConf: conf((r.sWhy as Record<string, unknown>)?.confidence),
        oReason: s((r.oWhy as Record<string, unknown>)?.reason), oConf: conf((r.oWhy as Record<string, unknown>)?.confidence),
        dReason: s((r.dWhy as Record<string, unknown>)?.reason), dConf: conf((r.dWhy as Record<string, unknown>)?.confidence),
        source: src || 'AI önerisi',
      };
      Object.assign(row, common);
      if (kind === 'dfmea') {
        const fn = p.structure.find((x) => x.id === r.functionId);
        Object.assign(row, {
          functionId: fn ? fn.id : '', function: fn?.function ?? '',
          reqIds: ((r.reqIds as string[]) ?? []).filter((x) => p.requirements.some((q) => q.id === x)),
          localEffect: s(r.localEffect), higherEffect: s(r.higherEffect), verification: s(r.verification),
        });
        if (r.functionId && !fn) warnings.push(`Fonksiyon ${s(r.functionId)} projede yok; bağlantı boş bırakıldı.`);
      } else {
        const st = p.processSteps.find((x) => x.id === r.stepId);
        const why = ((r.why as string[]) ?? []).slice(0, 5);
        Object.assign(row, {
          stepId: st ? st.id : '', processFunction: s(r.processFunction), requirement: s(r.requirement), processElement: s(r.processElement),
          dfIds: ((r.dfIds as string[]) ?? []).filter((x) => p.dfmea.some((q) => q.id === x)),
          cause4M: s(r.cause4M), why1: why[0] ?? '', why2: why[1] ?? '', why3: why[2] ?? '', why4: why[3] ?? '', why5: why[4] ?? '',
          rootCause: s(r.rootCause), errorProofing: s(r.errorProofing), measurement: s(r.measurement), reactionPlan: s(r.reactionPlan),
        });
        if (r.stepId && !st) warnings.push(`Proses adımı ${s(r.stepId)} projede yok; bağlantı boş bırakıldı.`);
      }
    }
    row.dataStatus = dataStatusFor(basis, checks, meta.mode);
    if (confidence === 'Low') warnings.push('Engineer verification required');
    const critical =
      kind === 'requirements'
        ? ['Safety', 'Regulatory'].includes(s(r.reqType))
        : (score(r.s) ?? 0) >= 9 || /safety|emniyet|regülasyon|regulat/i.test(s(r.effect));
    return { key: `${kind}-${i}`, table: kind, row, evidence, checks, confidence, basis, critical, warnings, decision: 'pending', rejectReason: '' };
  });
  const issues = ((data.issues ?? []) as Record<string, unknown>[]).map((x) => ({
    description: s(x.description), priority: s(x.priority), source: s(x.source), risk: s(x.risk), recommendedAction: s(x.recommendedAction), decision: 'pending' as Decision,
  }));
  return { kind, items, issues, params: ((data.params ?? []) as Record<string, unknown>[]), meta, note: opts.note, docId: opts.docId, inputs: opts.inputs };
}

/** Toplu kabul: kritik olmayan bekleyen öğeler. Kritikler tek tek onaylanmalıdır. */
export function bulkAccept(set: ProposalSet): ProposalSet {
  return { ...set, items: set.items.map((it) => (it.decision === 'pending' && !it.critical ? { ...it, decision: 'accepted' } : it)) };
}

export interface AddEdit {
  kind: 'add';
  table: TableKey;
  row: AnyRow;
}

/** Kabul edilen öğeler için satır + kanıt + AI çalıştırma kaydı ekleme düzenlemeleri. */
export function proposalEdits(p: Project, set: ProposalSet): { edits: AddEdit[]; runId: string; accepted: number; rejected: number } {
  let work = p;
  const edits: AddEdit[] = [];
  const add = (table: TableKey, data: Record<string, unknown>) => {
    const id = nextId(work, table);
    const row = { ...blankRow(table, id), ...data, id } as AnyRow;
    work = { ...work, [table]: [...(work[table] as AnyRow[]), row] };
    edits.push({ kind: 'add', table, row });
    return id;
  };
  const runId = nextId(work, 'aiRuns');
  work = { ...work, aiRuns: [...work.aiRuns, { id: runId } as AiRunRow] };
  const accepted = set.items.filter((i) => i.decision === 'accepted');
  const rejected = set.items.filter((i) => i.decision === 'rejected');
  for (const it of accepted) {
    const rowId = add(it.table, it.row);
    const evIds: string[] = [];
    it.evidence.forEach((e, k) => {
      const c = it.checks[k];
      const ev: Partial<EvidenceRow> = {
        docId: set.docId && p.docIndex[set.docId]?.fileName === e.docName ? set.docId : (p.documents.find((d) => d.name === e.docName || d.filePath.endsWith(e.docName))?.id ?? set.docId ?? ''),
        page: e.page, section: e.section, sheet: e.sheet, cell: e.cell, balloon: e.balloon, quote: e.quote, evidenceType: e.evidenceType,
        basis: it.basis, confidence: it.confidence, verification: (c?.verdict ?? 'SOURCE NOT VERIFIED') as Verification,
        verifiedLocation: c?.foundAt ? locText(c.foundAt) : '', linkedIds: [rowId], aiRunId: runId, origin: 'ai',
      };
      evIds.push(add('evidence', ev as Record<string, unknown>));
    });
    if (evIds.length) {
      const last = edits.find((x) => x.row.id === rowId)!;
      (last.row as AnyRow).evidenceIds = evIds;
    }
  }
  for (const iss of set.issues.filter((x) => x.decision === 'accepted'))
    add('issues', { description: iss.description, priority: iss.priority, source: iss.source, risk: iss.risk, recommendedAction: iss.recommendedAction, status: 'Open', origin: 'ai' });
  const run: Partial<AiRunRow> = {
    role: set.meta.role, provider: set.meta.provider, model: set.meta.model, at: set.meta.at, inputs: set.inputs, mode: set.meta.mode, status: 'ok',
    items: set.items.length, accepted: accepted.length, rejected: rejected.length, tokensIn: set.meta.tokensIn, tokensOut: set.meta.tokensOut, cached: set.meta.cached,
    message: [set.note, ...rejected.map((r) => `Reddedildi: ${s(r.row.text || r.row.failureMode).slice(0, 80)} – ${r.rejectReason || 'neden yok'}`)].filter(Boolean).join(' | '),
  };
  edits.push({ kind: 'add', table: 'aiRuns', row: { ...blankRow('aiRuns', runId), ...run, id: runId } as AnyRow });
  return { edits, runId, accepted: accepted.length, rejected: rejected.length };
}

/** Hatalı AI çalıştırması da kayda geçer (sessiz hata yok, §65). */
export function failedRunEdit(p: Project, role: string, inputs: string, kind: string, message: string, meta?: Partial<AiRunMeta>): AddEdit {
  const id = nextId(p, 'aiRuns');
  return {
    kind: 'add',
    table: 'aiRuns',
    row: { ...blankRow('aiRuns', id), role, inputs, status: 'error', errorKind: kind, message, at: new Date().toISOString(), provider: meta?.provider ?? '', model: meta?.model ?? '', mode: meta?.mode ?? '', id } as AnyRow,
  };
}
