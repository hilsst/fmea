// v4-risk: SCMH risk mantığı, FMEA yöntemi kuralları ve SCMH çıktı ekleri.
// IAQG şablonları depoda yoktur; SCMH çıktı testleri exceljs ile üretilen küçük sentetik şablon kullanır.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { planEdits, type Edit } from '../src/shared/engine';
import { blankRow, newProject, normalizeProject } from '../src/shared/model';
import { qualityChecks, traceability } from '../src/shared/checks';
import { qualityReport, whatDidIMiss } from '../src/shared/quality';
import { semanticFindings } from '../src/shared/semantic';
import { buildScmhPackage, SCMH_HEADER, SCMH_LAYOUT, VY, type ScmhKind } from '../src/shared/scmh';
import { ScmhBook } from '../src/shared/scmhfill';
import { scmhOccDetection, scmhPriority, scmhSeverityDetection, scmhSortBy } from '../src/shared/scmhScoring';
import { cpCoverageGap, effectiveBasis, needLabel, needsAction, reactionMissing, riskApprovalBlockers, riskLevelOf } from '../src/shared/risk';
import { renumberLines } from '../src/shared/riskModel';
import { riskLevel } from '../src/shared/scoring';
import { decisionError } from '../src/shared/workflow';
import { COLUMNS } from '../src/shared/columns';
import type { ActionRow, AnyRow, ControlPlanRow, DfmeaRow, KcRow, PfdItemRow, PfmeaRow, ProcessStepRow, Project, RequirementRow, TableKey } from '../src/shared/types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function row<T = any>(table: TableKey, id: string, data: Partial<NoInfer<T>>): NoInfer<T> {
  return { ...(blankRow(table, id) as object), ...data, id } as T;
}
const apply = (p: Project, edits: Edit[]) => planEdits(p, edits).project;
const set = (table: TableKey, id: string, field: string, value: unknown): Edit => ({ kind: 'set', table, id, field, value });
const codes = (p: Project, id?: string) => semanticFindings(p).filter((f) => !id || f.id === id).map((f) => f.code);
const check = (p: Project, key: string) => qualityChecks(p).find((c) => c.key === key)!;

function base(): Project {
  const p = newProject(); // SCMH
  p.requirements = [row<RequirementRow>('requirements', 'REQ-001', { text: 'Hole Ø6.0', balloon: '12' })];
  p.dfmea = [
    row<DfmeaRow>('dfmea', 'DF-001', { reqIds: ['REQ-001'], requirement: 'REQ-001: Hole Ø6.0', failureMode: 'Hole too small', effect: 'No assembly', cause: 'Tolerance error', prevention: 'Design standard', detection: 'Analysis', s: 9, o: 3, d: 4 }),
    row<DfmeaRow>('dfmea', 'DF-002', { failureMode: 'Rib too thin', effect: 'Crack', cause: 'Calc error', prevention: 'FEA', detection: 'Test', s: 6, o: 5, d: 6 }),
  ];
  p.processSteps = [
    row<ProcessStepRow>('processSteps', 'OP-001', { opNo: '10', name: 'Incoming Material' }),
    row<ProcessStepRow>('processSteps', 'OP-002', { opNo: '20', name: 'Machining', stepType: ['Operation'] }),
    row<ProcessStepRow>('processSteps', 'OP-003', { opNo: '30', name: 'Final Inspection', stepType: ['Inspect/Test'] }),
    row<ProcessStepRow>('processSteps', 'OP-004', { opNo: '40', name: 'Packaging' }),
  ];
  p.pfmea = [
    row<PfmeaRow>('pfmea', 'PF-001', { stepId: 'OP-002', opNo: '20', dfIds: ['DF-001'], failureMode: 'Hole undersize', effect: 'Scrap', cause: 'Tool wear', prevention: 'Tool life', detection: 'Plug gauge', s: 9, o: 4, d: 4 }),
  ];
  return p;
}

// ------------------------------------------------------------------ sentetik SCMH şablonu
async function fixture(kind: ScmhKind): Promise<Uint8Array> {
  const L = SCMH_LAYOUT[kind];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(L.sheet);
  for (const ref of Object.values(SCMH_HEADER[kind])) {
    const m = /^([A-Z]+)(\d+)$/.exec(ref!)!;
    ws.getCell(`${m[1]}${Number(m[2]) - 1}`).value = 'Label:';
  }
  for (let i = 0; i < 5; i++) {
    ws.getCell(`B${L.first + i}`).value = i + 1;
    for (const c of ['C', 'O', 'P', 'Z', 'AA']) ws.getCell(`${c}${L.first + i}`).border = { bottom: { style: 'thin' } };
  }
  ws.getCell(`B${L.first + 5}`).value = '© synthetic';
  const rev = wb.addWorksheet(L.revSheet);
  rev.getCell('A10').value = '© synthetic';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}
async function pkg(p: Project, opts = {}) {
  const t = { pfd: await fixture('pfd'), dfmea: await fixture('dfmea'), pfmea: await fixture('pfmea'), cp: await fixture('cp') };
  const out = await buildScmhPackage(p, t, opts);
  return { df: await ScmhBook.open(out.dfmea), pf: await ScmhBook.open(out.pfmea), cp: await ScmhBook.open(out.cp), pfd: await ScmhBook.open(out.pfd) };
}

// ------------------------------------------------------------------ M01 / M02
describe('SCMH prioritiser and the single needs-action predicate', () => {
  it('computes S×D and O×D and sorts by the chosen measure (S 9–10 first)', () => {
    expect(scmhSeverityDetection(8, 7)).toBe(56);
    expect(scmhOccDetection(3, 7)).toBe(21);
    expect(scmhSeverityDetection(null, 7)).toBeNull();
    const pr = scmhPriority({ s: 6, o: 2, d: 9 });
    expect([pr.rpn, pr.so, pr.sd, pr.od]).toEqual([108, 12, 54, 18]);
    const rows = [{ id: 'A', s: 6, o: 2, d: 9 }, { id: 'B', s: 7, o: 5, d: 2 }, { id: 'C', s: 9, o: 1, d: 1 }];
    expect(scmhSortBy(rows, 'sd').map((r) => r.id)).toEqual(['C', 'A', 'B']);
    expect(scmhSortBy(rows, 'so').map((r) => r.id)).toEqual(['C', 'B', 'A']);
  });

  it('SCMH: S≥9, KC link and team Top-N; AIAG-VDA: AP=H', () => {
    const p = base();
    expect(needsAction(p, p.dfmea[0]).reasons).toEqual(['S≥9']);
    expect(needsAction(p, p.dfmea[1]).need).toBe(false); // RPN 180 alone does not trigger (no threshold)
    p.settings.scmhReviewTopN = 1;
    const p2 = structuredClone(p);
    expect(needsAction(p2, p2.dfmea[1]).need).toBe(false); // top-1 per measure is an S=9 row
    p2.settings.scmhReviewTopN = 3;
    expect(needsAction(p2, p2.dfmea[1]).reasons).toEqual(expect.arrayContaining(['Top-RPN', 'Top-S×O', 'Top-S×D']));
    p.kcs = [row<KcRow>('kcs', 'KC-001', { sourceId: 'DF-002', status: 'Approved' })];
    p.settings.scmhReviewTopN = null;
    expect(needLabel(p, p.dfmea[1])).toBe('SCMH: KC/CI');
    expect(needsAction(p, p.pfmea[0]).reasons).toContain('S≥9');
    p.settings.scoringStandard = 'AIAG-VDA';
    expect(needsAction(p, { ...p.dfmea[1], s: 9, o: 8, d: 8 }).reasons).toEqual(['AP=H']);
  });

  it('risk level in SCMH mode does not use AP', () => {
    const p = base();
    const r = { ...p.dfmea[1], s: 7, o: 8, d: 8 }; // AIAG AP = H
    expect(riskLevelOf(p, r)).toBe('LOW');
    expect(riskLevel(r, p.settings)).toBe('LOW'); // settings-only fallback also skips AP in SCMH
    p.settings.scoringStandard = 'AIAG-VDA';
    expect(riskLevelOf(p, r)).toBe('HIGH');
  });

  it('quality check, “what did I miss” and Quality Score use the predicate', () => {
    const p = base();
    expect(check(p, 'ap-high').ids).toEqual(['DF-001', 'PF-001']);
    expect(check(p, 'ap-high').question).toMatch(/SCMH/);
    expect(whatDidIMiss(p).find((m) => m.area === 'Aksiyon')!.ids).toEqual(['DF-001', 'PF-001']);
    expect(qualityReport(p).dimensions.find((d) => d.key === 'action')!.detail).toMatch(/^0\/2 SCMH/);
    p.dfmea[0].riskDecision = 'No action – ALARP';
    p.dfmea[0].riskDecisionReason = 'Team agreed ALARP';
    expect(check(p, 'ap-high').ids).toEqual(['PF-001']);
  });

  it('adds S×O / S×D / need columns to DFMEA and PFMEA', () => {
    for (const t of ['dfmea', 'pfmea'] as const) expect(COLUMNS[t].map((c) => c.key)).toEqual(expect.arrayContaining(['so', 'sd', 'need', 'riskDecision', 'sDisposition', 'lineNo']));
    const p = base();
    expect(COLUMNS.dfmea.find((c) => c.key === 'sd')!.compute!(p.dfmea[0] as AnyRow, p)).toBe(36);
  });
});

// ------------------------------------------------------------------ M03
describe('S 9–10 severity disposition', () => {
  it('is required in SCMH mode and blocks final approval', () => {
    const p = base();
    expect(check(p, 's-high-no-disposition').ids).toEqual(['DF-001', 'PF-001']);
    expect(riskApprovalBlockers(p)).toEqual(['DF-001', 'PF-001']);
    p.settings.workflow = p.settings.workflow.map((w) => ({ ...w, enabled: w.step === 'Final Approval' }));
    const d = { step: 'Final Approval' as const, decision: 'Approved' as const, user: 'QE', role: 'Approver', comment: '' };
    expect(decisionError(p, d, 0)).toMatch(/severity kararı/);
    p.dfmea[0].sDisposition = 'Accepted with rationale';
    expect(riskApprovalBlockers(p)).toContain('DF-001'); // reason missing
    p.dfmea[0].sDispositionReason = 'Hazard analysis HA-12';
    p.pfmea[0].sDisposition = 'Process KC assigned';
    expect(riskApprovalBlockers(p)).toEqual(['PF-001']); // no KC linked
    p.kcs = [row<KcRow>('kcs', 'KC-001', { sourceId: 'PF-001', status: 'Approved' })];
    expect(riskApprovalBlockers(p)).toEqual([]);
    expect(decisionError(p, d, 0)).toBe('');
  });
});

// ------------------------------------------------------------------ M10 / F-6
describe('re-ranking needs a completed action with effectiveness evidence', () => {
  it('projected results are allowed, actual results need evidence', () => {
    const p = base();
    p.dfmea[1].newO = 2;
    expect(codes(p, 'DF-002')).toContain('rerank-no-action');
    p.dfmea[1].recommendedAction = 'Add rib';
    p.dfmea[1].actionId = 'ACT-001';
    p.actions = [row<ActionRow>('actions', 'ACT-001', { sourceId: 'DF-002', status: 'In Progress' })];
    expect(effectiveBasis(p, p.dfmea[1])).toBe('Projected');
    expect(codes(p, 'DF-002')).not.toContain('rerank-no-evidence');
    p.actions[0].status = 'Completed';
    p.actions[0].completionDate = '2026-10-01';
    expect(effectiveBasis(p, p.dfmea[1])).toBe('Actual');
    expect(codes(p, 'DF-002')).toContain('rerank-no-evidence');
    expect(check(p, 'rerank-evidence').ids).toEqual(['DF-002']);
    p.actions[0].verification = 'Test report TR-7: no crack';
    p.actions[0].evidenceIds = ['EV-001'];
    expect(codes(p, 'DF-002')).not.toContain('rerank-no-evidence');
    p.dfmea[1].resultBasis = 'Projected';
    expect(codes(p, 'DF-002')).toContain('projected-completed');
  });
});

// ------------------------------------------------------------------ F-5 / F-6 / F-7 / F-11 / F-12 / F-13 export
describe('SCMH export additions', () => {
  it('ALARP decision, projected marker, stable line numbers, product/process requirement split', async () => {
    let p = base();
    p.dfmea[1].riskDecision = 'No action – ALARP';
    p.dfmea[1].riskDecisionReason = 'ALARP';
    p.dfmea[0].recommendedAction = 'Increase hole';
    p.dfmea[0].actionTaken = 'Drawing change in work';
    p.dfmea[0].newO = 2;
    p.pfmea[0].requirement = 'Ø6.0';
    p.processParams = [row('processParams', 'PP-001', { pfIds: ['PF-001'] })];
    p = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(p.pfmea[0].processRequirement).toBe('Ø6.0'); // migrated with the V3 heuristic
    expect(p.dfmea.map((d) => d.lineNo)).toEqual([1, 2]);
    // delete DF-001, add DF-003: number 1 is not reused
    p = apply(p, [{ kind: 'delete', table: 'dfmea', id: 'DF-001' }, { kind: 'add', table: 'dfmea', row: row('dfmea', 'DF-003', { failureMode: 'New' }) }]);
    expect(p.dfmea.map((d) => [d.id, d.lineNo])).toEqual([['DF-002', 2], ['DF-003', 3]]);
    p.pfmea[0].productRequirement = 'Hole Ø6.0';
    const { df, pf } = await pkg(p);
    expect(df.get('DFMEA', 'B18')).toBe(2);
    expect(df.get('DFMEA', 'B19')).toBe(3);
    expect(df.get('DFMEA', 'Q18')).toBe('None (deemed ALARP)');
    for (const c of ['R', 'S', 'T', 'U']) expect(df.get('DFMEA', `${c}18`)).toBe('N/A');
    expect([df.get('DFMEA', 'V18'), df.get('DFMEA', 'W18'), df.get('DFMEA', 'X18')]).toEqual([6, 5, 6]);
    expect(pf.get('PFMEA', 'E17')).toBe('Hole Ø6.0');
    expect(pf.get('PFMEA', 'F17')).toBe('Ø6.0');
    renumberLines(p, 'dfmea');
    expect(p.dfmea.map((d) => d.lineNo)).toEqual([1, 2]);
  });

  it('projected marker, inline ranks and comments column', async () => {
    const p = base();
    p.dfmea[0].recommendedAction = 'Increase hole';
    p.dfmea[0].actionTaken = 'Drawing change in work';
    p.dfmea[0].newO = 2;
    p.dfmea[0].localEffect = 'Loose fit';
    p.dfmea[0].localEffectS = 5;
    p.dfmea[0].oReason = 'Standard partly applicable';
    p.dfmea[1].prevention = 'FEA (3)';
    const { df } = await pkg(p, { inlineRanks: true, commentsColumn: true });
    expect(df.get('DFMEA', 'T18')).toBe('[Projected] Drawing change in work');
    expect(df.get('DFMEA', 'J18')).toBe('Design standard (3)');
    expect(df.get('DFMEA', 'L18')).toBe('Analysis (4)');
    expect(df.get('DFMEA', 'J19')).toBe('FEA (3)'); // already ranked
    expect(df.get('DFMEA', 'G18')).toBe('(L) Loose fit (5)\n(E) No assembly (9)');
    expect(df.get('DFMEA', 'AA17')).toBe('Comments');
    expect(String(df.get('DFMEA', 'AA18'))).toMatch(/O: Standard partly applicable[\s\S]*öngörülen/);
    const plain = await pkg(p);
    expect(plain.df.get('DFMEA', 'J18')).toBe('Design standard');
    expect(plain.df.get('DFMEA', 'AA18')).toBe(null);
  });

  it('CP: reaction plan with responsible person, characteristic ID fallback; PFD: inputs/outputs and external steps', async () => {
    const p = base();
    p.controlPlan = [row<ControlPlanRow>('controlPlan', 'CP-001', { stepId: 'OP-002', pfId: 'PF-001', productChar: 'Hole', reactionPlan: 'Quarantine', responsible: 'Shift lead', charId: '12' })];
    p.pfdItems = [
      row<PfdItemRow>('pfdItems', 'IO-001', { stepId: 'OP-002', kind: 'Output', text: 'Hole Ø6.0', charId: '12', kcId: 'KC-009' }),
      row<PfdItemRow>('pfdItems', 'IO-002', { stepId: 'OP-002', kind: 'Input', text: 'Spindle speed', sourceOfVariation: true }),
    ];
    p.processSteps[3].external = true;
    p.processSteps[3].externalSupplier = 'PackCo';
    const { cp, pfd } = await pkg(p);
    expect(cp.get('Control Plan', 'O19')).toBe('Quarantine\nSorumlu: Shift lead');
    expect(cp.get('Control Plan', 'F19')).toBe('12');
    expect(pfd.get('PFD', 'O16')).toBe('12: Hole Ø6.0');
    expect(pfd.get('PFD', 'P16')).toBe('Spindle speed');
    expect(pfd.get('PFD', 'N16')).toContain('KC-009');
    expect(pfd.get('PFD', 'K18')).toBe('External – PackCo');
    p.controlPlan[0].responsible = '';
    expect((await pkg(p)).cp.get('Control Plan', 'O19')).toBe(`Quarantine\nSorumlu: ${VY}`);
  });
});

// ------------------------------------------------------------------ M13 / M14 / M16 / M17 / W21
describe('DFMEA method rules', () => {
  it('multi-level chaining: lower failure mode becomes the cause; changes flag the parent', () => {
    let p = base();
    p.dfmea[0].cause = '';
    p = apply(p, [set('dfmea', 'DF-001', 'causeFromIds', ['DF-002'])]);
    expect(p.dfmea[0].cause).toBe('DF-002: Rib too thin');
    p = apply(p, [set('dfmea', 'DF-002', 'failureMode', 'Rib missing')]);
    expect(p.dfmea[0].reassess).toMatch(/alt seviye DF-002/);
    expect(traceability(p).find((m) => m.key === 'df-chain')!.links).toEqual([{ from: 'DF-002', to: 'DF-001' }]);
    expect(COLUMNS.dfmea.find((c) => c.key === 'chainUp')!.compute!(p.dfmea[1] as AnyRow, p)).toBe('DF-001 S=9');
  });

  it('coverage prompts for 9145 risk categories, noise factors and environment', () => {
    const p = base();
    const msgs = whatDidIMiss(p).map((m) => m.message).join('\n');
    expect(msgs).toMatch(/9145 risk kategorilerinde.*Durability/);
    expect(msgs).toMatch(/gürültü faktörleri/);
    expect(msgs).toMatch(/Çevresel riskler/);
    p.dfmea[0].riskCategory = ['Performance', 'Durability', 'Service life', 'Reliability', 'Manufacturability', 'Maintainability', 'Cost'];
    p.dfmea[0].noiseFactor = ['Piece-to-piece', 'Other systems', 'Customer usage', 'Deterioration', 'Environment'];
    const after = whatDidIMiss(p).map((m) => m.message).join('\n');
    expect(after).not.toMatch(/9145 risk kategorilerinde|gürültü faktörleri|Çevresel riskler|Üretilebilirlik/);
  });

  it('flags DFMEA reliance on process controls', () => {
    const p = base();
    p.dfmea[1].detection = '100% CMM inspection';
    expect(codes(p, 'DF-002')).toContain('df-control-is-process');
  });

  it('PFMEA changes prompt DFMEA review; S sync from DFMEA does not; design request opens an issue', () => {
    let p = base();
    p = apply(p, [set('dfmea', 'DF-001', 's', 10)]);
    expect(p.pfmea[0].s).toBe(10);
    expect(p.dfmea[0].reassess ?? '').toBe('');
    p = apply(p, [set('pfmea', 'PF-001', 'cause', 'Wrong drill')]);
    expect(p.dfmea[0].reassess).toMatch(/PFMEA PF-001 değişti/);
    p = apply(p, [set('pfmea', 'PF-001', 'designActionRequest', true)]);
    expect(p.issues).toHaveLength(1);
    expect(p.issues[0].relatedFmea).toBe('DF-001');
    p = apply(p, [set('pfmea', 'PF-001', 'designActionRequest', false), set('pfmea', 'PF-001', 'designActionRequest', true)]);
    expect(p.issues).toHaveLength(1); // still open, not duplicated
  });

  it('DFMEA link proposes the PFMEA effect and product requirement; split fields keep the legacy requirement', () => {
    let p = base();
    p.pfmea.push(row<PfmeaRow>('pfmea', 'PF-002', { stepId: 'OP-002', failureMode: 'Burr' }));
    p = apply(p, [set('pfmea', 'PF-002', 'dfIds', ['DF-001'])]);
    const r = p.pfmea[1];
    expect(r.effect).toBe('Hole too small (DF-001)');
    expect(r.dataStatus).toBe('AI SUGGESTION');
    expect(r.productRequirement).toBe('REQ-001: Hole Ø6.0');
    p = apply(p, [set('pfmea', 'PF-002', 'processRequirement', '3000 rpm')]);
    expect(p.pfmea[1].requirement).toBe('REQ-001: Hole Ø6.0 / 3000 rpm');
  });
});

// ------------------------------------------------------------------ W3 / W4 / W10 / W12 / W13 / W15 / W23 / M21
describe('control plan rules', () => {
  it('significant PFMEA risks (S 9–10 without KC) must be in the CP or excluded with a reason', () => {
    const p = base();
    expect(p.kcs).toHaveLength(0);
    expect(cpCoverageGap(p, p.pfmea[0])).toBe(true);
    expect(check(p, 'cp-coverage').ids).toEqual(['PF-001']);
    p.pfmea[0].cpDecision = 'Not required';
    expect(cpCoverageGap(p, p.pfmea[0])).toBe(true);
    p.pfmea[0].cpExclusionReason = 'Controlled by supplier CP';
    expect(cpCoverageGap(p, p.pfmea[0])).toBe(false);
  });

  it('reaction plan MUST elements and owner on every CP row', () => {
    const p = base();
    const c = row<ControlPlanRow>('controlPlan', 'CP-001', { stepId: 'OP-002', pfId: 'PF-001', reactionPlan: 'Quarantine + NCR' });
    p.controlPlan = [c];
    expect(reactionMissing(c)).toEqual(['düzeltme yöntemi', 'amire (supervisor) bildirim']);
    expect(semanticFindings(p).find((f) => f.code === 'cp-reaction-must')!.message).toMatch(/Q24/);
    expect(check(p, 'cp-reaction-owner').ids).toEqual(['CP-001']);
    c.reactionCorrection = 'Replace tool, re-check last 5 parts';
    c.reactionContact = 'Supervisor';
    c.responsible = 'Shift lead';
    expect(reactionMissing(c)).toEqual([]);
    expect(check(p, 'cp-reaction-owner').ok).toBe(true);
    // default text: correction method left as VERİ YOK → still missing
    const d = apply(base(), [{ kind: 'add', table: 'kcs', row: row('kcs', 'KC-001', { sourceId: 'PF-001', status: 'Approved' }) }]);
    expect(reactionMissing(d.controlPlan[0])).toEqual(['düzeltme yöntemi']);
  });

  it('error-proofing on a significant risk proposes a monitored CP row', () => {
    let p = base();
    p = apply(p, [set('pfmea', 'PF-001', 'errorProofing', 'Poka-yoke')]);
    const ep = p.controlPlan.find((c) => c.controlKind === 'Error proofing')!;
    expect(ep.pfId).toBe('PF-001');
    expect(ep.frequency).toBe(VY);
    expect(check(p, 'ep-cp').ok).toBe(true);
    expect(codes(p, ep.id)).toContain('ep-no-verification');
  });

  it('characteristic ID defaults from the drawing balloon; pairing and WI rules', () => {
    let p = base();
    p.documents = [row('documents', 'DOC-001', { name: 'WI-20' })];
    p.kcs = [row<KcRow>('kcs', 'KC-001', { sourceId: 'DF-001', status: 'Approved' })];
    p.controlPlan = [row<ControlPlanRow>('controlPlan', 'CP-001', { stepId: 'OP-002', productChar: 'Hole', charType: 'Product Characteristic', method: 'Plug gauge', wiDocId: 'DOC-001' })];
    p = apply(p, [set('controlPlan', 'CP-001', 'kcId', 'KC-001')]);
    expect(p.controlPlan[0].charId).toBe('12');
    expect(codes(p, 'CP-001')).toContain('cp-pair-missing');
    p = apply(p, [{ kind: 'add', table: 'controlPlan', row: row('controlPlan', 'CP-002', { stepId: 'OP-002', processChar: 'Spindle speed', charType: 'Process Characteristic', specification: '3000 rpm', controlsCpIds: ['CP-001'] }) }]);
    expect(codes(p, 'CP-001')).not.toContain('cp-pair-missing');
    p = apply(p, [set('controlPlan', 'CP-002', 'specification', '3200 rpm')]);
    expect(p.controlPlan[0].reassess).toMatch(/CP-002/);
    p = apply(p, [set('controlPlan', 'CP-001', 'frequency', '1/shift')]);
    expect(p.documents[0].reassess).toMatch(/Talimat güncellemesi/);
    p.controlPlan[0].wiDocId = '';
    expect(codes(p, 'CP-001')).toContain('cp-no-wi');
  });

  it('prevention-first: KC checked only at final inspection while created upstream', () => {
    const p = base();
    p.kcs = [row<KcRow>('kcs', 'KC-001', { sourceId: 'PF-001', status: 'Approved' })];
    p.controlPlan = [row<ControlPlanRow>('controlPlan', 'CP-001', { stepId: 'OP-003', kcId: 'KC-001', productChar: 'Hole' })];
    expect(codes(p, 'KC-001')).toContain('prevention-first');
    p.controlPlan.push(row<ControlPlanRow>('controlPlan', 'CP-002', { stepId: 'OP-002', kcId: 'KC-001', processChar: 'Tool life' }));
    expect(codes(p, 'KC-001')).not.toContain('prevention-first');
  });
});

// ------------------------------------------------------------------ W5 / W14
describe('PFD inputs/outputs and completeness', () => {
  it('an output proposes failure-mode drafts linked to it; causes should reference inputs', () => {
    let p = base();
    p = apply(p, [{ kind: 'add', table: 'pfdItems', row: row('pfdItems', 'IO-001', { stepId: 'OP-002', kind: 'Output', text: 'Hole Ø6.0' }) }]);
    const drafts = p.pfmea.filter((x) => x.outputId === 'IO-001');
    expect(drafts).toHaveLength(4);
    expect(drafts.every((d) => d.approval === 'AI Proposed' && d.dataStatus === 'AI SUGGESTION')).toBe(true);
    expect(check(p, 'pfd-output-fm').ok).toBe(true);
    p = apply(p, [{ kind: 'add', table: 'pfdItems', row: row('pfdItems', 'IO-002', { stepId: 'OP-002', kind: 'Input', text: 'Drill', cat4M: 'Machine' }) }]);
    expect(codes(p, 'PF-001')).toContain('pf-cause-no-input');
    p = apply(p, [set('pfmea', 'PF-001', 'causeInputIds', ['IO-002'])]);
    expect(p.pfmea[0].cause4M).toBe('Machine');
    p = apply(p, [set('pfdItems', 'IO-001', 'text', 'Hole Ø6.1')]);
    expect(drafts.length && p.pfmea.find((x) => x.id === drafts[0].id)!.reassess).toMatch(/IO-001/);
    p = apply(p, [{ kind: 'delete', table: 'pfdItems', id: 'IO-002' }]);
    expect(p.pfmea[0].causeInputIds).toEqual([]);
  });

  it('checks receipt → shipment, external moves and rework return', () => {
    const p = base();
    expect(check(p, 'pfd-complete').ok).toBe(true);
    p.processSteps[1].external = true;
    p.processSteps.push(row<ProcessStepRow>('processSteps', 'OP-005', { opNo: '35', name: 'Rework hole', stepType: ['Rework'] }));
    const ids = check(p, 'pfd-complete').ids;
    expect(ids).toEqual(expect.arrayContaining(['OP-002', 'OP-005']));
    p.processSteps[0].name = 'Cutting';
    expect(check(p, 'pfd-complete').ids).toContain('OP-001');
  });
});

// ------------------------------------------------------------------ migration
describe('V3 file without v4-risk fields', () => {
  it('opens with defaults', () => {
    const v3 = JSON.parse(JSON.stringify(base()));
    delete v3.pfdItems;
    delete v3.lineCounters;
    delete v3.settings.scmhReviewTopN;
    delete v3.settings.scmhInlineRanks;
    delete v3.settings.scmhCommentsColumn;
    for (const t of ['dfmea', 'pfmea', 'processSteps']) for (const r of v3[t]) for (const k of Object.keys(r)) if (!(k in blankRow('documents', 'x')) && ['riskDecision', 'resultBasis', 'sDisposition', 'causeFromIds', 'riskCategory', 'noiseFactor', 'productRequirement', 'processRequirement', 'cpDecision', 'significantRisk', 'outputId', 'causeInputIds', 'external', 'alternateOf', 'returnTo', 'localEffectS'].includes(k)) delete r[k];
    v3.pfmea[0].requirement = 'Ø6.0';
    const p = normalizeProject(v3);
    expect(p.pfdItems).toEqual([]);
    expect(p.settings.scmhReviewTopN).toBeNull();
    expect(p.settings.scmhInlineRanks).toBe(false);
    expect(p.dfmea[0].riskDecision).toBe('');
    expect(p.dfmea[0].causeFromIds).toEqual([]);
    expect(p.dfmea[0].localEffectS).toBeNull();
    expect(p.pfmea[0].productRequirement).toBe('Ø6.0');
    expect(p.pfmea[0].causeInputIds).toEqual([]);
    expect(p.processSteps[0].external).toBe(false);
    expect(p.processSteps.map((s) => s.lineNo)).toEqual([1, 2, 3, 4]);
    expect(p.lineCounters).toEqual({ dfmea: 2, pfmea: 1, controlPlan: 0, processSteps: 4 });
    expect(normalizeProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
  });
});
