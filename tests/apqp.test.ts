// v4-apqp: APQP / PPAP kuralları, geçiş ve opsiyonel SCMH şablonları (7.2.12, 7.2.14, 7.2.20).
// IAQG şablonları depoda yoktur: testler aynı sayfa/hücre/paragraf düzeniyle üretilen sentetik şablonlar kullanır.
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import {
  APQP_CATALOG, CATALOG_BY_KEY, PPAP_ELEMENTS, apqpChecks, applicabilityOf, cpPhaseVariants, cpPromotionCandidates, deliverableApproved, deliverableDecisionError,
  deliverableNextStep, dfmeaTiming, elementOf, elementRyg, interimReasonSuggestion, packagingApprovalError, packagingIssues, packagingPfmeaDrafts, ppapReadiness,
  ppapResubmission, prrBlockers, prrDecisionError, recordDeliverableDecision, requirementInCp, reuseRows, shipmentAllowed, submissionError, suggest, teamGaps, teamText,
  type DeliverableDecision, type PpapSubmission,
} from '../src/shared/apqp';
import { fillApqpApplicability, fillMaturityEvidence, fillPackagingForm, findApqpTemplate } from '../src/shared/apqpExport';
import { qualityChecks } from '../src/shared/checks';
import { crossScreenEffects, planEdits } from '../src/shared/engine';
import { LISTS, blankRow, newProject, normalizeProject } from '../src/shared/model';
import type { ActionRow, ChangeRequestRow, ControlPlanRow, DfmeaRow, KcRow, LessonRow, MsaRow, PfmeaRow, ProcessStepRow, Project, RequirementRow, StructureRow } from '../src/shared/types';
import { decisionError } from '../src/shared/workflow';

const row = <T,>(t: Parameters<typeof blankRow>[0], id: string, data: Partial<T>): T => ({ ...(blankRow(t, id) as unknown as T), ...data });

function seed(): Project {
  const p = newProject();
  p.settings.userName = 'Ayşe Mühendis';
  p.meta.name = 'Panel APQP';
  p.meta.partNumber = 'PN-100';
  p.meta.partName = 'Sandviç panel';
  p.meta.drawingRevision = 'B';
  p.requirements.push(row<RequirementRow>('requirements', 'REQ-001', { text: 'Kalınlık', lsl: 9.9, usl: 10.1, unit: 'mm' }));
  p.dfmea.push(row<DfmeaRow>('dfmea', 'DF-001', { failureMode: 'Kalınlık dışı', reqIds: ['REQ-001'], s: 9, o: 3, d: 4, recommendedAction: 'Kalıp değişikliği' }));
  p.processSteps.push(row<ProcessStepRow>('processSteps', 'OP-001', { opNo: '10', name: 'Lay-up', stepType: ['Operation'] }));
  p.pfmea.push(row<PfmeaRow>('pfmea', 'PF-001', { stepId: 'OP-001', dfIds: ['DF-001'], failureMode: 'Eksik kat', s: 9, o: 3, d: 4 }));
  p.kcs.push(row<KcRow>('kcs', 'KC-001', { sourceId: 'DF-001', characteristic: 'Kalınlık', status: 'Approved' }));
  p.controlPlan.push(row<ControlPlanRow>('controlPlan', 'CP-001', { stepId: 'OP-001', kcId: 'KC-001', productChar: 'Kalınlık' }));
  return p;
}

const approveAll = (p: Project, d: DeliverableDecision['deliverable']) => {
  let n = 0;
  while (deliverableNextStep(p, d) && n++ < 10) {
    const dec: DeliverableDecision = { deliverable: d, step: deliverableNextStep(p, d)!, decision: 'Approved', user: 'Ayşe', role: '', comment: '', customerName: 'Müşteri Q', customerRef: 'MAIL-1' };
    expect(deliverableDecisionError(p, dec)).toBe('');
    p.apqp.deliverableApprovals.push(recordDeliverableDecision(p, dec, `2026-01-0${n}T10:00:00Z`));
  }
};

describe('v4-apqp migration', () => {
  it('a V3 project without apqp fields opens with defaults', () => {
    const v3 = JSON.parse(JSON.stringify(seed())) as Record<string, unknown>;
    delete v3.apqp;
    for (const c of v3.controlPlan as Record<string, unknown>[]) delete c.phases;
    for (const c of v3.pfmea as Record<string, unknown>[]) delete c.stage;
    const p = normalizeProject(v3 as Partial<Project>);
    expect(p.apqp.projectType).toBe('');
    expect(p.apqp.elements).toHaveLength(APQP_CATALOG.length);
    expect(p.apqp.milestones.map((m) => m.key)).toEqual(['A', 'B', 'C', 'D', 'E']);
    expect(p.apqp.ppap.elements).toHaveLength(11);
    expect(p.apqp.packaging.items).toHaveLength(12);
    expect(p.apqp.deliverableConfig.find((c) => c.deliverable === 'PFD')!.steps).toEqual(['Engineering', 'Operations', 'Quality']);
    expect(p.controlPlan[0].phases ?? []).toEqual([]);
    expect(p.dfmea[0].failureMode).toBe('Kalınlık dışı');
    // APQP kullanılmayan projede kalite kontrolleri ve onay akışı değişmez
    expect(qualityChecks(p).some((c) => c.key.startsWith('apqp'))).toBe(false);
  });

  it('keeps stored apqp values and merges new defaults', () => {
    const p = normalizeProject({ apqp: { projectType: 'NP', elements: [{ key: '3.04', required: 'Y', assignedTo: 'X' }], packaging: { items: [{ key: 'esd', answer: 'N/A' }] } } } as never);
    expect(p.apqp.projectType).toBe('NP');
    expect(elementOf(p, '3.04')!.assignedTo).toBe('X');
    expect(elementOf(p, '3.04')!.checklist.length).toBeGreaterThan(0);
    expect(p.apqp.packaging.items.find((i) => i.key === 'esd')!.answer).toBe('N/A');
    expect(p.apqp.prr.decision).toBe('');
  });

  it('adds lists for triggers and maintenance / software CP items', () => {
    expect(LISTS.llSource).toContain('Production run');
    expect(LISTS.llSource).toContain('Continuous improvement');
    expect(LISTS.charType).toEqual(expect.arrayContaining(['Maintenance / Equipment', 'Software configuration']));
    expect(LISTS.actionType).toContain('DOE');
  });
});

describe('7.2.15 applicability', () => {
  it('maps the matrix marks per project type', () => {
    const c = CATALOG_BY_KEY;
    for (const t of ['ND', 'DC1', 'NP', 'PC', 'WT', 'NDELV'] as const) {
      expect(applicabilityOf(c['3.04'], t)).toBe('Mandatory');
      expect(applicabilityOf(c['3.06'], t)).toBe('Mandatory');
    }
    expect(applicabilityOf(c['2.01'], 'ND')).toBe('Mandatory');
    expect(applicabilityOf(c['2.01'], 'NP')).toBe('As needed');
    expect(applicabilityOf(c['3.05'], 'DC1')).toBe('Recommended');
    expect(applicabilityOf(c['2.03'], 'DC1')).toBe('As needed');
    expect(applicabilityOf(c['A3.3'], 'ND')).toBe('');
    expect(applicabilityOf(c['3.04'], '')).toBe('');
    expect(APQP_CATALOG.filter((x) => x.type === 'Deliverable').every((x) => !x.marks || x.marks.length === 6)).toBe(true);
  });

  it('flags a mandatory element marked N without reason', () => {
    const p = seed();
    p.apqp.projectType = 'NP';
    elementOf(p, '3.04')!.required = 'N';
    const chk = apqpChecks(p).find((c) => c.key === 'apqp-mandatory-n')!;
    expect(chk.ok).toBe(false);
    expect(chk.ids).toContain('3.04');
    elementOf(p, '3.04')!.reason = 'Müşteri muafiyeti';
    expect(apqpChecks(p).find((c) => c.key === 'apqp-mandatory-n')!.ok).toBe(true);
    expect(qualityChecks(p).some((c) => c.key === 'apqp-undecided')).toBe(true);
  });
});

describe('Red / Yellow / Green', () => {
  const el = () => {
    const p = seed();
    const e = elementOf(p, '3.04')!;
    e.required = 'Y';
    return e;
  };
  it('follows SCMH 7.2.3 §6.1', () => {
    const e = el();
    expect(elementRyg(e).ryg).toBe(''); // cevaplanmamış
    e.checklist.forEach((c) => (c.answer = 'Y'));
    expect(elementRyg(e).ryg).toBe('Green');
    e.checklist[0].answer = 'N';
    expect(elementRyg(e).ryg).toBe('Red');
    e.checklist[0].action = 'Eksik adımlar için PFMEA oturumu';
    expect(elementRyg(e).ryg).toBe('Yellow');
    e.scheduleImpact = true;
    expect(elementRyg(e).ryg).toBe('Red');
  });
  it('treats overdue without recovery as Red', () => {
    const e = el();
    e.checklist.forEach((c) => (c.answer = 'Y'));
    e.targetDate = '2026-01-01';
    expect(elementRyg(e, '2026-02-01').ryg).toBe('Red');
    e.recoveryAction = 'Ek kaynak';
    expect(elementRyg(e, '2026-02-01').ryg).toBe('Yellow');
    e.status = 'Complete';
    expect(elementRyg(e, '2026-02-01').ryg).toBe('Green');
  });
  it('suggestions never answer the checklist', () => {
    const p = seed();
    const e = elementOf(p, '3.04')!;
    expect(suggest(p, 'pf-steps').answer).toBe('Y');
    expect(suggest(p, 'pf-high').answer).toBe('N');
    expect(e.checklist.every((c) => c.answer === '')).toBe(true);
  });
});

describe('deliverable approval', () => {
  it('enforces order, user, content and customer evidence', () => {
    const p = seed();
    const base: DeliverableDecision = { deliverable: 'CP', step: 'Quality', decision: 'Approved', user: '', role: '', comment: '' };
    expect(deliverableDecisionError(p, base)).toMatch(/kullanıcı adı/);
    expect(deliverableDecisionError(p, { ...base, user: 'A', step: 'Production' })).toMatch(/sıradaki adım Quality/);
    expect(deliverableDecisionError(p, { ...base, user: 'A', decision: 'Rejected' })).toMatch(/yorum/);
    p.apqp.deliverableConfig.find((c) => c.deliverable === 'CP')!.customerRequired = true;
    p.apqp.deliverableApprovals.push(recordDeliverableDecision(p, { ...base, user: 'A' }));
    p.apqp.deliverableApprovals.push(recordDeliverableDecision(p, { ...base, user: 'B', step: 'Production' }));
    expect(deliverableNextStep(p, 'CP')).toBe('Customer');
    expect(deliverableDecisionError(p, { ...base, user: 'A', step: 'Customer' })).toMatch(/yazılı onay/);
    p.apqp.deliverableApprovals.push(recordDeliverableDecision(p, { ...base, user: 'A', step: 'Customer', customerName: 'C', customerRef: 'R' }));
    expect(deliverableApproved(p, 'CP')).toBe(true);
    // ret sonrası yeniden başlar
    p.apqp.deliverableApprovals.push(recordDeliverableDecision(p, { ...base, user: 'A', decision: 'Returned', comment: 'Revizyon' }));
    expect(deliverableApproved(p, 'CP')).toBe(false);
    const empty = newProject();
    expect(deliverableDecisionError(empty, { ...base, deliverable: 'DFMEA', step: 'Design', user: 'A' })).toMatch(/boş/);
  });
});

describe('PRR gate', () => {
  it('blocks PRR, final approval and baseline while FMEA actions are open', () => {
    const p = seed();
    p.actions.push(row<ActionRow>('actions', 'ACT-001', { sourceId: 'DF-001', description: 'Kalıp', status: 'Open' }));
    expect(prrBlockers(p)).toEqual(['ACT-001']);
    p.dfmea[0].s = 8; // S 9–10 karar kapısı (risk akışı) bu testin konusu değil
    p.pfmea[0].s = 8;
    p.approvals = [];
    p.settings.workflow = p.settings.workflow.map((w) => ({ ...w, enabled: w.step === 'Final Approval' }));
    const d = { step: 'Final Approval' as const, decision: 'Approved' as const, user: 'A', role: 'Approver', comment: '' };
    expect(decisionError(p, d, 0)).toBe(''); // APQP kullanılmıyor → eski davranış
    p.apqp.projectType = 'ND';
    expect(decisionError(p, d, 0)).toMatch(/PRR kapısı/);
    expect(prrDecisionError(p, 'Passed', 'A', '')).toMatch(/PRR geçilemez/);
    p.apqp.actionMitigations.push({ actionId: 'ACT-001', note: 'Geçici %100 kontrol', approvedBy: 'Kalite Md.', date: '2026-01-01' });
    expect(prrBlockers(p)).toEqual([]);
    expect(decisionError(p, d, 0)).toBe('');
    expect(prrDecisionError(p, 'Passed', 'A', '')).toBe('');
    expect(interimReasonSuggestion(p)).toMatch(/approved mitigation plan: ACT-001/);
    p.actions[0].status = 'Completed';
    expect(interimReasonSuggestion(p)).toBe('');
  });
});

describe('PPAP', () => {
  const sub = (x: Partial<PpapSubmission>): PpapSubmission => ({ id: 'PPAP-001', date: '2026-03-01', level: '', disposition: 'Full', interimUntil: '', reasons: '', restrictions: '', customerApprover: 'Müşteri SQE', writtenApprovalRef: 'PSW-1', recordedBy: 'A', revision: 'Rev A', ...x });
  it('validates dispositions and shipment', () => {
    expect(submissionError(sub({ writtenApprovalRef: '' }))).toMatch(/Yazılı onay/);
    expect(submissionError(sub({ disposition: 'Interim' }))).toMatch(/Interim/);
    expect(submissionError(sub({ disposition: 'Interim', interimUntil: '50 adet', reasons: 'Açık aksiyon' }))).toBe('');
    expect(submissionError(sub({ disposition: 'Rejected', writtenApprovalRef: '' }))).toMatch(/Ret gerekçesi/);
    const p = seed();
    expect(shipmentAllowed(p).ok).toBe(false);
    p.apqp.ppap.submissions.push(sub({}));
    expect(shipmentAllowed(p).ok).toBe(true);
    expect(ppapResubmission(p).required).toBe(false);
    p.apqp.ppap.submissions.push(sub({ id: 'PPAP-002', disposition: 'Rejected', reasons: 'Eksik karakteristik', writtenApprovalRef: '' }));
    expect(shipmentAllowed(p).ok).toBe(false);
    expect(ppapResubmission(p).required).toBe(true);
  });

  it('flags resubmission when a change is implemented after PPAP approval (engine, confirm list)', () => {
    const p = seed();
    p.changeRequests.push(row<ChangeRequestRow>('changeRequests', 'CR-001', { title: 'Kür döngüsü', impactedIds: ['PF-001'], status: 'Assessed' }));
    let plan = planEdits(p, [{ kind: 'set', table: 'changeRequests', id: 'CR-001', field: 'status', value: 'Implemented' }]);
    expect(plan.project.changeRequests[0].ppapResubmission ?? false).toBe(false); // PPAP onayı yok
    p.apqp.ppap.submissions.push(sub({}));
    plan = planEdits(p, [{ kind: 'set', table: 'changeRequests', id: 'CR-001', field: 'status', value: 'Implemented' }]);
    expect(plan.project.changeRequests[0].ppapResubmission).toBe(true);
    expect(ppapResubmission(plan.project).reasons.join()).toMatch(/CR-001/);
    const doc = row<ChangeRequestRow>('changeRequests', 'CR-002', { impactedIds: ['LL-001'], status: 'Assessed' });
    p.changeRequests.push(doc);
    plan = planEdits(p, [{ kind: 'set', table: 'changeRequests', id: 'CR-002', field: 'status', value: 'Implemented' }]);
    expect(plan.project.changeRequests[1].ppapResubmission ?? false).toBe(false);
  });

  it('readiness: every toleranced requirement in the CP, numeric MSA, all 11 elements', () => {
    const p = seed();
    const r = ppapReadiness(p);
    expect(r.map((x) => x.no)).toEqual(PPAP_ELEMENTS.map((e) => e.no));
    expect(r[0].ok).toBe(true); // REQ-001 → DF-001 → KC-001 → CP-001
    expect(requirementInCp(p, p.requirements[0])).toBe(true);
    p.requirements.push(row<RequirementRow>('requirements', 'REQ-002', { text: 'Ağırlık', usl: 2 }));
    expect(ppapReadiness(p)[0]).toMatchObject({ ok: false, ids: ['REQ-002'] });
    p.msa.push(row<MsaRow>('msa', 'MSA-001', { status: 'Acceptable', result: 'iyi' }));
    expect(ppapReadiness(p)[5].ok).toBe(false);
    p.msa[0].result = '%GRR 8.2, ndc 7';
    expect(ppapReadiness(p)[5].ok).toBe(true);
    expect(ppapReadiness(p)[3].ok).toBe(false); // PFMEA onaysız, S≥9 aksiyonsuz
  });
});

describe('FMEA update triggers', () => {
  it('a linked NCR / production run lesson requires reassessment, shown for confirmation', () => {
    const p = seed();
    const l = row<LessonRow>('lessons', 'LL-001', { sourceType: 'Production run', reference: 'Koşu-1', linkedFmeaIds: ['PF-001'] });
    const edits = [{ kind: 'add' as const, table: 'lessons' as const, row: l }];
    const plan = planEdits(p, edits);
    expect(plan.project.pfmea[0].reassess).toMatch(/FMEA Reassessment Required – LL-001 \(Production run Koşu-1\)/);
    expect(crossScreenEffects(plan, edits).some((e) => e.table === 'pfmea' && e.field === 'reassess')).toBe(true);
    const other = planEdits(p, [{ kind: 'add', table: 'lessons', row: { ...l, sourceType: '' } }]);
    expect(other.project.pfmea[0].reassess ?? '').toBe('');
  });
});

describe('team, criteria, timing, preliminary PFMEA', () => {
  it('checks function coverage and criteria agreement', () => {
    const p = seed();
    p.apqp.team = [{ id: 'T1', name: 'Ali', function: 'Design', fmea: [], email: '' }];
    const g = teamGaps(p);
    expect(g.find((x) => x.fmea === 'DFMEA')!.missing).toEqual(['Manufacturing', 'Quality']);
    expect(g.find((x) => x.fmea === 'PFMEA')!.missing).toEqual(['Manufacturing', 'Quality', 'Operations']);
    expect(teamText(p)).toBe('Ali (Design)');
    const c = apqpChecks(p);
    expect(c.find((x) => x.key === 'team-coverage')!.ok).toBe(false);
    expect(c.find((x) => x.key === 'criteria-agreed')!.ok).toBe(false);
    p.apqp.criteriaAgreement = { date: '2026-01-01', members: 'Ali, Veli', source: 'SCMH template', standard: 'SCMH', notes: '', recordedBy: 'A' };
    expect(apqpChecks(p).find((x) => x.key === 'criteria-agreed')!.ok).toBe(true);
  });

  it('tracks DFMEA finalized before design release', () => {
    const p = seed();
    expect(dfmeaTiming(p).ok).toBe(true);
    p.apqp.designReleaseDate = '2026-01-03';
    expect(dfmeaTiming(p, '2026-02-01').ok).toBe(false);
    approveAll(p, 'DFMEA'); // 2026-01-01, 01-02
    expect(dfmeaTiming(p, '2026-02-01').ok).toBe(true);
    p.apqp.designReleaseDate = '2026-01-01';
    expect(dfmeaTiming(p, '2026-02-01').detail).toMatch(/sonrasında/);
  });

  it('warns about preliminary PFMEA rows after PFMEA approval', () => {
    const p = seed();
    p.apqp.projectType = 'NP';
    p.pfmea[0].stage = 'Preliminary';
    expect(apqpChecks(p).some((x) => x.key === 'pfmea-preliminary')).toBe(false);
    approveAll(p, 'PFMEA');
    expect(apqpChecks(p).find((x) => x.key === 'pfmea-preliminary')).toMatchObject({ ok: false, ids: ['PF-001'] });
  });
});

describe('7.2.20 packaging', () => {
  it('requires all answers and basis before customer approval; No → PFMEA drafts', () => {
    const p = seed();
    expect(packagingApprovalError(p)).toMatch(/temeli seçilmedi/);
    const k = p.apqp.packaging;
    k.basis = 'Customer unique';
    expect(packagingIssues(p).join()).toMatch(/spesifikasyon/);
    k.customerSpec = 'PKG-SPEC-7';
    k.items.forEach((i) => (i.answer = 'Yes'));
    k.items.find((i) => i.key === 'labeling')!.answer = 'No';
    expect(packagingApprovalError(p)).toMatch(/Ambalaj etiketi/);
    const d = packagingPfmeaDrafts(p);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ failureMode: 'Yanlış / eksik ambalaj etiketi', dataStatus: 'ENGINEERING SUGGESTION – VERIFY' });
    expect(d[0].s).toBeUndefined();
    k.items.find((i) => i.key === 'labeling')!.answer = 'Yes';
    expect(packagingApprovalError(p)).toBe('');
  });
});

describe('CP phases and reuse', () => {
  it('builds one CP project per phase; Prototype maps to Pre-Production', () => {
    const p = seed();
    expect(cpPhaseVariants(p)).toEqual([]);
    p.controlPlan[0].phases = ['Prototype', 'Pre-launch'];
    p.controlPlan.push(row<ControlPlanRow>('controlPlan', 'CP-002', { phases: ['Production'] }));
    p.controlPlan.push(row<ControlPlanRow>('controlPlan', 'CP-003', {}));
    const v = cpPhaseVariants(p);
    expect(v.map((x) => x.phase)).toEqual(['Prototype', 'Pre-launch', 'Production']);
    expect(v[0].project.meta.scmhPhase).toBe('Pre-Production');
    expect(v[2].project.meta.scmhPhase).toBe('Production');
    expect(v[2].project.controlPlan.map((c) => c.id)).toEqual(['CP-002', 'CP-003']);
    expect(p.meta.scmhPhase).toBe('');
    expect(cpPromotionCandidates(p)).toEqual(['CP-001']);
  });

  it('reuses an existing FMEA without S/O/D, with remapped links', () => {
    const src = seed();
    src.structure.push(row<StructureRow>('structure', 'FN-001', { element: 'Panel', function: 'Taşır' }));
    src.dfmea[0].functionId = 'FN-001';
    const target = newProject();
    target.dfmea.push(row<DfmeaRow>('dfmea', 'DF-001', { failureMode: 'mevcut' }));
    const rows = reuseRows(target, src, { dfmea: true, process: true });
    const df = rows.find((r) => r.table === 'dfmea')!.row as DfmeaRow;
    expect(df.id).toBe('DF-002');
    expect(df.s).toBeNull();
    expect(df.functionId).toBe('FN-001');
    const pf = rows.find((r) => r.table === 'pfmea')!.row as PfmeaRow;
    expect(pf.dfIds).toEqual(['DF-002']);
    expect(pf.stage).toBe('Preliminary');
    expect(pf.s).toBeNull();
    expect((rows.find((r) => r.table === 'controlPlan')!.row as ControlPlanRow).specification).toMatch(/VERİ YOK/);
    const applied = planEdits(target, rows.map((r) => ({ kind: 'add' as const, table: r.table, row: r.row })));
    expect(applied.project.pfmea[0].dfIds).toEqual(['DF-002']);
    expect(applied.project.pfmea[0].s ?? null).toBeNull();
  });
});

// ------------------------------------------------------------------ sentetik şablonlar
async function tpl7212(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Sheet1');
  ws.getCell('A2').value = 'Project Name:';
  ws.getCell('D2').value = 'Project Lead:';
  ['Phase', 'Type', 'Description', 'Required (Y/N)', 'If not required, indicate why', 'Approved by', 'Assigned to', 'Target Completion Date'].forEach((h, i) => (ws.getCell(4, i + 1).value = h));
  const rows: [number, number, string, string][] = [
    [13, 1, 'Delverable', 'Preliminary listing of Critical Items (synthetic)'],
    [21, 2, 'Activity', 'Design risk analysis'],
    [30, 2, 'Deliverable', 'Design risk analysis* (synthetic)'],
    [52, 3, 'Deliverable', 'PFMEA*'],
    [54, 3, 'Deliverable', 'Control plan*'],
    [60, 3, 'Deliverable', 'Production Readiness Review (PRR) results'],
  ];
  for (const [r, ph, t, c] of rows) {
    ws.getCell(`A${r}`).value = ph;
    ws.getCell(`B${r}`).value = t;
    ws.getCell(`C${r}`).value = c;
  }
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

async function tpl7214(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Data');
  ws.getCell('A30').value = 'Item';
  ['4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7', '4.8'].forEach((x, i) => {
    ws.getCell(`A${31 + i}`).value = x;
    ws.getCell(`H${31 + i}`).value = 0.1;
  });
  ws.getCell('J40').value = { formula: 'SUMPRODUCT(I31:I38,H31:H38)/SUM(H31:H38)/5', result: 0 };
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const run = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`;
const box = () => `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Check1"/><w:enabled/><w:checkBox><w:sizeAuto/><w:default w:val="0"/></w:checkBox></w:ffData></w:fldChar></w:r><w:r><w:instrText> FORMCHECKBOX </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`;
async function tpl7220(): Promise<Uint8Array> {
  const para = (inner: string) => `<w:p>${inner}</w:p>`;
  const yn = (label: string) => para(`${run(label)}<w:r><w:tab/></w:r>${run(' Yes')}${box()}${run(' No')}${box()}${run(' N/A')}${box()}`);
  const body = [
    para(run('PART PACKAGING/PRESERVATION/LABELING APPROVAL FORM')),
    para(`${run('Customer Part ')}${run('Number:')}<w:r><w:tab/></w:r>${run('____')}${run('__________')}`),
    para(`${run('Customer Part Description:')}${run('______')}`),
    para(`${run('Customer Part Number Revision:')}${run('______')}`),
    para(`${run('Supplier Part Number (if applicable):')}${run('______')}`),
    para(`${run('Supplier Name:')}${run('______')}`),
    para(`${run('Supplier Code:')}${run('______')}`),
    para(`${run('The applicable standard practice for commercial packaging')}${box()}`),
    para(`${run('Customer unique packaging requirement')}${box()}`),
    para(`${run('(SPECIFICATION): ')}${run('_______')}`),
    yn('Packaging conforms to additional unique requirements listed above'),
    yn('Cleanliness conforms to packaging requirement marked above'),
    yn('Preservation conforms'), yn('Cushioning conforms'), yn('Unit package conforms'), yn('Intermediate package conforms'),
    yn('Unitization conforms'), yn('Package labeling conforms'), yn('For electronic products, ESD Requirements are met'),
    yn('For electronic products, moisture sensitive part control'), yn('For products sensitive to environmental moisture, desiccants or other'),
    yn('For products sensitive to environmental factors such as light,'),
    para(`${run('Approved by ')}${run('(Insert Customer Here)')}${run(': ')}${run('__')}${run('_______')}`),
    para(`${run('Signature ')}${run('______________')}`),
    para(`${run('Date ')}<w:r><w:tab/></w:r>${run('__')}${run('_______')}`),
  ].join('');
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  zip.file('word/media/image4.jpeg', new Uint8Array([255, 216, 1, 2, 3]));
  return zip.generateAsync({ type: 'uint8array' });
}

describe('optional SCMH templates', () => {
  it('finds templates by section prefix', () => {
    const files = ['SCMH-7.2.12-APQP-Element-Applicability-Template.xlsx', 'SCMH-7.2.20-Packaging.docx', 'other.xlsx'];
    expect(findApqpTemplate(files, 'apqp')).toBe(files[0]);
    expect(findApqpTemplate(files, 'packaging')).toBe(files[1]);
    expect(findApqpTemplate(files, 'maturity')).toBeUndefined();
  });

  it('fills 7.2.12 rows matched by text, phase and type', async () => {
    const p = seed();
    p.apqp.projectType = 'ND';
    p.apqp.projectLead = 'Proje Lideri';
    Object.assign(elementOf(p, '3.04')!, { required: 'Y', assignedTo: 'Üretim Müh.', targetDate: '2026-05-01', approvedBy: 'PM' });
    Object.assign(elementOf(p, '2.01')!, { required: 'N', reason: 'Build-to-print' });
    Object.assign(elementOf(p, 'A2.2')!, { required: 'Y' });
    const r = await fillApqpApplicability(p, await tpl7212());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.data as never);
    const ws = wb.getWorksheet('Sheet1')!;
    const v = (ref: string) => { const x = ws.getCell(ref).value as unknown; return x && typeof x === 'object' && 'richText' in (x as object) ? (x as { richText: { text: string }[] }).richText.map((t) => t.text).join('') : x; };
    expect(v('B2')).toBe('Panel APQP');
    expect(v('E2')).toBe('Proje Lideri');
    expect([v('D52'), v('F52'), v('G52'), v('H52')]).toEqual(['Y', 'PM', 'Üretim Müh.', '2026-05-01']);
    expect([v('D30'), v('E30'), v('F30')]).toEqual(['N', 'Build-to-print', 'VERİ YOK – doğrulanmalı']);
    expect(v('D21')).toBe('Y'); // faaliyet satırı teslimattan ayrı eşlenir
    expect(v('D54')).toBe('VERİ YOK – doğrulanmalı'); // zorunlu, karar yok
    expect(v('D60')).toBe('VERİ YOK – doğrulanmalı');
    expect(v('C52')).toBe('PFMEA*');
    expect(r.unmatched).toContain('3.11');
    expect(r.unmatched).not.toContain('3.04');
  });

  it('writes maturity evidence to Data!J only', async () => {
    const r = await fillMaturityEvidence(seed(), await tpl7214());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.data as never);
    const ws = wb.getWorksheet('Data')!;
    const j = (row: number) => String((ws.getCell(`J${row}`).value as unknown) ?? '');
    expect(j(31)).toMatch(/DFMEA→PFMEA bağlantı %100/);
    expect(j(35)).toMatch(/Onaylı KC 1: KP’de %100/);
    expect(ws.getCell('I31').value).toBeNull();
    expect(ws.getCell('J38').value).toBeNull();
    expect((ws.getCell('J40').value as { formula: string }).formula).toMatch(/SUMPRODUCT/);
    expect(r.unmatched).toEqual([]);
  });

  it('fills the 7.2.20 docx: blanks, basis and Yes/No/N/A boxes; signature untouched', async () => {
    const p = seed();
    p.apqp.cpAdmin.supplierCode = 'SUP-42';
    const k = p.apqp.packaging;
    k.basis = 'Customer unique';
    k.customerSpec = 'PKG-SPEC-7';
    k.items.forEach((i) => (i.answer = 'Yes'));
    k.items.find((i) => i.key === 'esd')!.answer = 'N/A';
    k.items.find((i) => i.key === 'labeling')!.answer = 'No';
    const r = await fillPackagingForm(p, await tpl7220());
    expect(r.unmatched).toEqual([]);
    const zip = await JSZip.loadAsync(r.data);
    const x = await zip.file('word/document.xml')!.async('string');
    expect(await zip.file('word/media/image4.jpeg')!.async('uint8array')).toEqual(new Uint8Array([255, 216, 1, 2, 3]));
    const vals = [...x.matchAll(/<w:default w:val="(\d)"\/>/g)].map((m) => m[1]);
    expect(vals).toHaveLength(38);
    expect(vals.slice(0, 2)).toEqual(['0', '1']);
    const item = (n: number) => vals.slice(2 + n * 3, 5 + n * 3).join('');
    expect(item(0)).toBe('100');
    expect(item(7)).toBe('010'); // etiket = No
    expect(item(8)).toBe('001'); // ESD = N/A
    expect((x.match(/<w:checked\/>/g) ?? []).length).toBe(13);
    expect(x).toContain('>PN-100<');
    expect(x).toContain('>Sandviç panel<');
    expect(x).toContain('>B<');
    expect(x).toContain('>SUP-42<');
    expect(x).toContain('>PKG-SPEC-7<');
    expect(x).toContain('Signature </w:t></w:r><w:r><w:t xml:space="preserve">______________');
    // onay kaydı yokken müşteri onay boşlukları korunur
    expect(x).toMatch(/Approved by .*_______/);
  });
});
