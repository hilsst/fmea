// v4-kc: SCMH / AS9145 KC–CI modeli, numaralandırma, yaşam döngüsü, akış, kontroller ve 7.2.16 formu.
// IAQG şablonları © IAQG olduğundan testler sentetik şablon kullanır.
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { planEdits, type Edit } from '../src/shared/engine';
import { qualityChecks } from '../src/shared/checks';
import { blankRow, newProject, nextId, normalizeProject } from '../src/shared/model';
import { buildKcForm, kcFormFileName, kcFormRows, KC_FORM_LAYOUT } from '../src/shared/kcForm';
import { formatKcNo, hasKcControl, issueKcNo, scmhKcDecision } from '../src/shared/kcScmh';
import { kcCandidates, kcTriggers, processKcCandidates } from '../src/shared/kcTriggers';
import { kcChecks, kcListCustomerApproval } from '../src/shared/kcChecks';
import { cpClassification, rowClassification, stepClassification } from '../src/shared/kcTrace';
import { buildScmhPackage, SCMH_LAYOUT, type ScmhKind } from '../src/shared/scmh';
import { ScmhBook } from '../src/shared/scmhfill';
import { COLUMNS } from '../src/shared/columns';
import type { ControlPlanRow, DfmeaRow, KcRow, PfmeaRow, ProcessParamRow, ProcessStepRow, Project, RequirementRow } from '../src/shared/types';

function row<T>(table: Parameters<typeof blankRow>[0], id: string, data: Partial<T>): T {
  return { ...(blankRow(table, id) as object), ...data, id } as T;
}

function seed(): Project {
  const p = newProject();
  p.meta.partNumber = 'ABC123';
  p.meta.partName = 'Spacer';
  p.meta.drawingRevision = 'A';
  p.requirements = [row<RequirementRow>('requirements', 'REQ-001', { text: 'Radial fit Ø1.000 min', acceptance: '1.000 Diameter Min.', balloon: '12', sourcePage: '1', sourceDocId: 'DOC-001' })];
  p.documents = [row('documents', 'DOC-001', { name: 'Drawing', docNumber: 'DRW-1', revision: 'A' } as never)];
  p.dfmea = [
    row<DfmeaRow>('dfmea', 'DF-001', { reqIds: ['REQ-001'], failureMode: 'Fit too loose', effect: 'Vibration', s: 9, o: 4, d: 6 }),
    row<DfmeaRow>('dfmea', 'DF-002', { failureMode: 'Finish rough', effect: 'Appearance', s: 4, o: 3, d: 3 }),
  ];
  p.processSteps = [row<ProcessStepRow>('processSteps', 'OP-001', { opNo: '20', name: 'Machining' })];
  p.pfmea = [
    row<PfmeaRow>('pfmea', 'PF-001', { stepId: 'OP-001', dfIds: ['DF-001'], failureMode: 'Bore oversize', effect: 'Loose fit', s: 9, o: 5, d: 7 }),
    row<PfmeaRow>('pfmea', 'PF-002', { stepId: 'OP-001', failureMode: 'Burn', effect: 'Rework', s: 5, o: 3, d: 8 }),
  ];
  p.processParams = [row<ProcessParamRow>('processParams', 'PP-001', { stepId: 'OP-001', parameter: 'Spindle speed', pfIds: ['PF-001'] })];
  return p;
}

const apply = (p: Project, edits: Edit[]) => planEdits(p, edits).project;
const addKc = (p: Project, data: Partial<KcRow>) => apply(p, [{ kind: 'add', table: 'kcs', row: row<KcRow>('kcs', nextId(p, 'kcs'), data) }]);

describe('v4-kc migration', () => {
  it('a 3.0 project without KC/CI fields opens with defaults', () => {
    const v3 = JSON.parse(JSON.stringify(seed())) as Record<string, unknown> & Project;
    delete (v3 as Partial<Project>).kcRegistry;
    for (const k of ['kcNumbering', 'ciNumbering']) delete (v3.settings as unknown as Record<string, unknown>)[k];
    for (const k of ['kcFormRevision', 'kcFormDate', 'kcContacts', 'kcListAgreedBy', 'kcListAgreedDate', 'kcListAgreementRef']) delete (v3.meta as unknown as Record<string, unknown>)[k];
    v3.kcs = [{ id: 'KC-001', sourceId: 'DF-001', characteristic: 'Fit', status: 'Approved' } as KcRow];
    delete (v3.pfmea[0] as Partial<PfmeaRow>).designActionFeasible;
    delete (v3.requirements[0] as Partial<RequirementRow>).specialRequirement;
    const p = normalizeProject(v3);
    expect(p.kcRegistry).toEqual({ kc: 0, ci: 0 });
    expect(p.settings.kcNumbering).toBe('{PN}-KC-{nnn}');
    expect(p.meta.kcFormRevision).toBe('');
    expect(p.kcs[0]).toMatchObject({ lifecycle: '', kcNo: '', itemType: '', linkedIds: [], impact: [], customerAgreed: false, characteristic: 'Fit', status: 'Approved' });
    expect(p.pfmea[0].designActionFeasible).toBe('');
    expect(p.requirements[0].specialRequirement).toBe(false);
    // 3.0'da onaylı KC kesinleşmiş sayılır; Classification numarasız iç ID ile yazılır
    expect(rowClassification(p, 'DF-001')).toBe('KC-001');
  });
});

describe('KC numbering (7.2.17 §1.2.1)', () => {
  it('formats PN-KC-XXX and drops PN when missing', () => {
    expect(formatKcNo('{PN}-KC-{nnn}', 'ABC 123', 7)).toBe('ABC123-KC-007');
    expect(formatKcNo('{PN}-KC-{nnn}', '', 7)).toBe('KC-007');
    expect(formatKcNo('{PN}-CI-{nnnn}', 'X', 12)).toBe('X-CI-0012');
  });
  it('assigns a number when the KC enters the list, never reuses it', () => {
    let p = addKc(seed(), { sourceId: 'DF-001', status: 'AI Proposed', autoCreated: true });
    expect(p.kcs[0].kcNo).toBe('');
    p = apply(p, [{ kind: 'set', table: 'kcs', id: 'KC-001', field: 'lifecycle', value: 'Preliminary' }]);
    expect(p.kcs[0].kcNo).toBe('ABC123-KC-001');
    p = addKc(p, { sourceId: 'PF-001', lifecycle: 'Potential' });
    expect(p.kcs[1].kcNo).toBe('ABC123-KC-002');
    p = addKc(p, { itemType: 'CI', lifecycle: 'Preliminary', characteristic: 'Bracket' });
    expect(p.kcs[2].kcNo).toBe('ABC123-CI-001');
    // sayaç azalmaz: numara alanı boşaltılsa bile sonraki numara ilerler
    const q = structuredClone(p);
    q.kcs[1].kcNo = '';
    expect(issueKcNo(q, 'KC')).toBe('ABC123-KC-003');
  });
  it('numbered KC cannot be deleted; deleted unnumbered internal ID is not reused', () => {
    let p = addKc(seed(), { sourceId: 'DF-001', lifecycle: 'Confirmed', status: 'Approved' });
    p = apply(p, [{ kind: 'delete', table: 'kcs', id: 'KC-001' }]);
    expect(p.kcs).toHaveLength(1);
    expect(p.kcs[0].reassess).toMatch(/silinemez/);
    // kaynak DFMEA satırı silinince numaralı KC kayıtta kalır
    p = apply(p, [{ kind: 'delete', table: 'dfmea', id: 'DF-001' }]);
    expect(p.kcs[0].id).toBe('KC-001');
    expect(p.kcs[0].reassess).toMatch(/Reassessment/);
    // numarasız KC silinir ve iç ID'si tekrar verilmez
    let r = addKc(seed(), { sourceId: 'DF-002' });
    r = apply(r, [{ kind: 'delete', table: 'kcs', id: 'KC-001' }]);
    expect(r.kcs).toHaveLength(0);
    r.auditLog.push({ at: '2026-10-20', user: 'u', kind: 'Deleted', table: 'kcs', id: 'KC-001', revision: 'A' });
    expect(nextId(r, 'kcs')).toBe('KC-002');
  });
  it('elimination keeps the record, sets the date and drops it from Classification', () => {
    let p = addKc(seed(), { sourceId: 'DF-001', lifecycle: 'Confirmed', status: 'Approved' });
    expect(rowClassification(p, 'PF-001')).toBe('ABC123-KC-001');
    p = apply(p, [{ kind: 'set', table: 'kcs', id: 'KC-001', field: 'lifecycle', value: 'Eliminated' }]);
    expect(p.kcs[0].eliminatedDate).toMatch(/^\d{4}-/);
    expect(rowClassification(p, 'PF-001')).toBe('');
    expect(kcChecks(p).find((c) => c.key === 'kc-elim-note')!.ids).toEqual(['KC-001']);
  });
});

describe('SCMH KC decision flow (CAP p54)', () => {
  const d = (a: Partial<KcRow>) => scmhKcDecision({ qSafetyCritical: '', qCriticalOther: '', qUnsafe: '', qAffectsOther: '', qVariation: '', ...a });
  it('walks the branches', () => {
    expect(d({}).next).toBe('qSafetyCritical');
    expect(d({ qSafetyCritical: 'No', qCriticalOther: 'No' })).toMatchObject({ ci: false, outcome: 'Not a Critical Item', complete: true });
    expect(d({ qSafetyCritical: 'Yes' })).toMatchObject({ ci: true, next: 'qUnsafe' });
    expect(d({ qSafetyCritical: 'Yes', qUnsafe: 'Yes', qVariation: 'Yes' }).outcome).toBe('Safety-related KC');
    expect(d({ qSafetyCritical: 'Yes', qUnsafe: 'Yes', qVariation: 'No' }).outcome).toMatch(/Frozen Process/);
    expect(d({ qSafetyCritical: 'Yes', qUnsafe: 'No', qAffectsOther: 'Yes', qVariation: 'Yes' }).outcome).toBe('Non-safety-related KC');
    expect(d({ qSafetyCritical: 'No', qCriticalOther: 'Yes', qAffectsOther: 'No' }).outcome).toBe('Not a KC');
    expect(d({ qSafetyCritical: 'No', qCriticalOther: 'Yes', qAffectsOther: 'Yes', qVariation: 'No' }).outcome).toBe('Not a KC');
  });
  it('a confirmed KC needs a complete, consistent decision (severity alone is not a decision)', () => {
    let p = addKc(seed(), { sourceId: 'DF-001', lifecycle: 'Confirmed', status: 'Approved' });
    expect(kcChecks(p).find((c) => c.key === 'kc-decision')!.ids).toEqual(['KC-001']);
    p = apply(p, ([['qSafetyCritical', 'No'], ['qCriticalOther', 'Yes'], ['qAffectsOther', 'Yes'], ['qVariation', 'Yes']] as const).map(([f, v]) => ({ kind: 'set' as const, table: 'kcs' as const, id: 'KC-001', field: f, value: v })));
    expect(kcChecks(p).find((c) => c.key === 'kc-decision')!.ok).toBe(true);
  });
});

describe('KC triggers beyond severity', () => {
  it('S×O / S×D / O×D / RPN trigger only via the team Top-N review list; safety, customer and SR always', () => {
    const p = seed();
    const t = (id: string) => Object.fromEntries(kcTriggers(p, [...p.dfmea, ...p.pfmea].find((r) => r.id === id)!).map((x) => [x.key, x.on]));
    expect(t('PF-002')).toMatchObject({ S: false, SO: false, SD: false, RPN: false });
    expect(kcTriggers(p, p.pfmea[1]).find((x) => x.key === 'SD')!.reason).toMatch(/Top-N tanımlı değil/);
    p.settings.scmhReviewTopN = 1;
    expect(t('PF-002')).toMatchObject({ SD: false, OD: false }); // S×D 5×8=40 < PF-001 9×7=63
    expect(t('PF-001')).toMatchObject({ SD: true, OD: true, RPN: true, SO: true });
    p.settings.scmhReviewTopN = null;
    p.requirements[0].specialRequirement = true;
    p.requirements[0].reqType = 'Customer-specific';
    expect(t('DF-001')).toMatchObject({ S: true, SR: true, Customer: true });
    p.dfmea[1].effect = 'Operator injury hazard';
    expect(t('DF-002').Safety).toBe(true);
    expect(kcCandidates(p).map((c) => c.row.id)).toEqual(['DF-001', 'DF-002', 'PF-001']);
    expect(kcChecks(p).find((c) => c.key === 'kc-trigger')!.ids).toHaveLength(3);
  });
  it('process KC rule (7.2.3 p63): high-risk PFMEA row not reducible by design', () => {
    const p = seed();
    let c = processKcCandidates(p);
    expect(c.map((x) => x.row.id)).toEqual(['PF-001']);
    expect(c[0]).toMatchObject({ needsAnswer: true, ppIds: ['PP-001'], characteristic: 'Spindle speed' });
    p.pfmea[0].designActionFeasible = 'No';
    expect(processKcCandidates(p)[0].needsAnswer).toBe(false);
    p.pfmea[0].designActionFeasible = 'Yes';
    expect(processKcCandidates(p)).toHaveLength(0);
    p.pfmea[0].designActionFeasible = 'No';
    p.kcs.push(row<KcRow>('kcs', 'KC-001', { sourceId: 'PF-001', kcType: 'Process' }));
    c = processKcCandidates(p);
    expect(c).toHaveLength(0);
  });
});

describe('flow-down and checks', () => {
  function withKcs(): Project {
    let p = seed();
    p = addKc(p, { sourceId: 'DF-001', characteristic: 'Radial fit', specification: '1.000 Diameter Min.', severity: 9, lifecycle: 'Confirmed', status: 'Approved', impact: ['Assembly', 'Product Performance'] });
    p = addKc(p, { sourceId: 'PF-001', kcType: 'Process', characteristic: 'Spindle speed', lifecycle: 'Potential', ppIds: ['PP-001'], relatedKcIds: ['KC-001'] });
    return p;
  }
  it('DFMEA KC reaches PFMEA, PFD and CP through dfIds / links', () => {
    const p = withKcs();
    expect(rowClassification(p, 'DF-001')).toBe('ABC123-KC-001');
    expect(rowClassification(p, 'PF-001')).toBe('ABC123-KC-001; Potential: ABC123-KC-002');
    expect(stepClassification(p, p.processSteps[0])).toBe('ABC123-KC-001; Potential: ABC123-KC-002');
    const cp = row<ControlPlanRow>('controlPlan', 'CP-101', { stepId: 'OP-001', ppId: 'PP-001', processChar: 'Spindle speed' });
    p.controlPlan.push(cp);
    // proses KC'nin kontrol ettiği ürün KC'si de yazılır (G-16)
    expect(cpClassification(p, cp)).toBe('Potential: ABC123-KC-002; ABC123-KC-001');
    expect(cpClassification(p, p.controlPlan[0])).toBe('ABC123-KC-001');
  });
  it('customer KC from a requirement flows via DFMEA reqIds; kc-in-pfmea flags orphans', () => {
    let p = seed();
    p = addKc(p, { sourceId: 'REQ-001', designatedBy: 'Customer', lifecycle: 'Preliminary' });
    expect(rowClassification(p, 'PF-001')).toBe('Potential: ABC123-KC-001');
    p = addKc(p, { characteristic: 'Customer KC without FMEA', designatedBy: 'Customer', lifecycle: 'Preliminary' });
    expect(kcChecks(p).find((c) => c.key === 'kc-in-pfmea')!.ids).toEqual(['KC-002']);
    p = apply(p, [{ kind: 'set', table: 'kcs', id: 'KC-002', field: 'linkedIds', value: ['PF-002'] }]);
    expect(kcChecks(p).find((c) => c.key === 'kc-in-pfmea')!.ok).toBe(true);
  });
  it('process KC needs 100% or SPC in the control plan', () => {
    const p = withKcs();
    // KC-001 onaylandığında motor CP-001'i önerdi; proses KC satırı ayrıca eklenir
    expect(p.controlPlan.map((c) => c.kcId)).toEqual(['KC-001']);
    p.controlPlan.push(row<ControlPlanRow>('controlPlan', 'CP-101', { stepId: 'OP-001', ppId: 'PP-001', sampleSize: '5', frequency: 'Shift', controlMethod: 'Setup check' }));
    expect(kcChecks(p).find((c) => c.key === 'kc-process-control')!.ids).toEqual(['CP-101']);
    p.controlPlan[1].controlMethod = 'SPC X̄-R';
    expect(kcChecks(p).find((c) => c.key === 'kc-process-control')!.ok).toBe(true);
    expect(hasKcControl({ sampleSize: '100%', controlMethod: '', method: '', frequency: '' })).toBe(true);
    expect(hasKcControl({ sampleSize: '1000', controlMethod: '', method: '', frequency: '' })).toBe(false);
  });
  it('design record, customer agreement (reset on change) and re-introduction', () => {
    let p = withKcs();
    expect(kcChecks(p).find((c) => c.key === 'kc-design-record')!.ids).toEqual(['KC-001']);
    p = apply(p, [{ kind: 'set', table: 'kcs', id: 'KC-001', field: 'onDrawing', value: true }]);
    expect(kcChecks(p).find((c) => c.key === 'kc-design-record')!.ok).toBe(true); // referans gereksinimden türetilir
    p = apply(p, ['KC-001', 'KC-002'].map((id) => ({ kind: 'set' as const, table: 'kcs' as const, id, field: 'customerAgreed', value: true })));
    expect(kcChecks(p).find((c) => c.key === 'kc-customer')!.ok).toBe(true);
    p = apply(p, [{ kind: 'set', table: 'kcs', id: 'KC-001', field: 'specification', value: '1.001 min' }]);
    expect(p.kcs[0].customerAgreed).toBe(false);
    p = apply(p, [{ kind: 'set', table: 'kcs', id: 'KC-002', field: 'lifecycle', value: 'Eliminated' }]);
    p = addKc(p, { sourceId: 'PF-002', characteristic: 'Spindle  speed', lifecycle: 'Potential' });
    expect(kcChecks(p).find((c) => c.key === 'kc-reintro')!.ids).toEqual(['KC-003↔KC-002']);
  });
  it('list-level customer agreement comes from the APQP KC-list Customer approval when present', () => {
    const p = withKcs();
    expect(kcListCustomerApproval(p)).toBeNull();
    p.meta.kcListAgreedBy = 'Cust A';
    p.meta.kcListAgreedDate = '2026-10-01';
    expect(kcListCustomerApproval(p)).toMatchObject({ by: 'Cust A', source: 'KC' });
    p.apqp.deliverableApprovals.push({ id: 'DA-1', deliverable: 'KC list', step: 'Customer', user: 'u', role: '', at: '2026-10-15T10:00:00Z', decision: 'Approved', comment: '', revision: p.meta.fmeaRevision, customerName: 'Cust B', customerRef: 'MAIL-7' });
    expect(kcListCustomerApproval(p)).toEqual({ by: 'Cust B', date: '2026-10-15', ref: 'MAIL-7', source: 'APQP' });
  });
  it('KC checks run only for SCMH projects; columns follow the standard', () => {
    const p = withKcs();
    expect(qualityChecks(p).some((c) => c.key === 'kc-in-pfmea')).toBe(true);
    p.settings.scoringStandard = 'AIAG-VDA';
    expect(qualityChecks(p).some((c) => c.key === 'kc-in-pfmea')).toBe(false);
    expect(COLUMNS.kcs[0].key).toBe('kcNo');
    expect(COLUMNS.kcs.find((c) => c.key === 'category')!.mode).toBe('AIAG-VDA');
    expect(COLUMNS.kcs.find((c) => c.key === 'itemType')!.mode).toBe('SCMH');
  });
});

// ------------------------------------------------------------------ 7.2.16 formu ve SCMH paketi
async function kcFormFixture(): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('KC Traceability Form');
  ws.getCell('C1').value = '7.2.16 (synthetic)';
  ws.getCell('C6').value = 'Part Name:';
  ws.getCell('G6').value = 'Date Completed:';
  ws.getCell('B9').value = 'KC No.';
  for (let r = 10; r <= 14; r++) ws.getCell(`B${r}`).border = { bottom: { style: 'thin' } };
  ws.getCell('B15').value = 'Comments';
  ws.mergeCells('C15:I15');
  ws.getCell('B16').value = '© 20XX IAQG synthetic footer';
  ws.mergeCells('B16:I16');
  wb.addWorksheet('KC Traceability Form Example').getCell('B10').value = 'ABC123-KC-001';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('7.2.16 KC Traceability Form export', () => {
  function formProject(n: number): Project {
    let p = seed();
    p.meta.kcFormRevision = '3';
    p.meta.kcContacts = 'J. Doe (Eng)';
    for (let i = 0; i < n; i++) p = addKc(p, { sourceId: 'DF-001', characteristic: `Char ${i + 1}`, specification: i === 0 ? '1.000 Diameter Min.' : '', severity: 9, lifecycle: 'Confirmed', status: 'Approved', impact: ['Assembly', 'Durability'] });
    p = apply(p, [{ kind: 'set', table: 'kcs', id: 'KC-002', field: 'eliminationNote', value: 'Design change removed the slot' }, { kind: 'set', table: 'kcs', id: 'KC-002', field: 'eliminatedBy', value: 'Design change' }, { kind: 'set', table: 'kcs', id: 'KC-002', field: 'lifecycle', value: 'Eliminated' }]);
    p.kcs.push(row<KcRow>('kcs', 'KC-099', { characteristic: 'AI candidate', status: 'AI Proposed' }));
    return p;
  }
  it('rows: eliminated stays with N/A, missing values are VERİ YOK, candidates are not listed', () => {
    const rows = kcFormRows(formProject(2));
    expect(rows.map((r) => r.B)).toEqual(['ABC123-KC-001', 'ABC123-KC-002']);
    expect(rows[0]).toMatchObject({ C: 'Char 1', D: '1.000 Diameter Min.', E: 'DRW-1 Sayfa 1 Balon 12', F: '>Assembly\n>Durability', G: 9, H: '>DFMEA' });
    expect(rows[1]).toMatchObject({ D: 'VERİ YOK – doğrulanmalı', E: 'N/A', F: 'N/A', G: 'N/A' });
    expect(rows[1].I).toMatch(/Eliminated \(Design change\).*Design change removed the slot/);
  });
  it('fills the template, inserts rows above Comments, leaves the example sheet', async () => {
    const p = formProject(7);
    const buf = await buildKcForm(p, await kcFormFixture());
    const b = await ScmhBook.open(buf);
    const S = KC_FORM_LAYOUT.sheet;
    expect(b.get(S, 'E6')).toBe('Spacer');
    expect(b.get(S, 'E7')).toBe('ABC123');
    expect(b.get(S, 'I7')).toBe('3');
    expect(b.get(S, 'I6')).toBe('VERİ YOK – doğrulanmalı');
    expect(b.get(S, 'B10')).toBe('ABC123-KC-001');
    expect(b.get(S, 'G10')).toBe(9);
    expect(b.get(S, 'B16')).toBe('ABC123-KC-007');
    expect(b.get(S, 'B17')).toBe('Comments');
    expect(String(b.get(S, 'B18'))).toMatch(/^©/);
    expect(b.get('KC Traceability Form Example', 'B10')).toBe('ABC123-KC-001');
    expect(kcFormFileName(p)).toBe('SCMH-7.2.16_KC-Traceability_ABC123_3.xlsx');
  });
});

async function pkgFixture(kind: ScmhKind): Promise<Uint8Array> {
  const L = SCMH_LAYOUT[kind];
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(L.sheet);
  for (let i = 0; i < 5; i++) ws.getCell(`B${L.first + i}`).value = i + 1;
  ws.getCell(`B${L.first + 5}`).value = '© synthetic';
  wb.addWorksheet(L.revSheet).getCell('A10').value = '© synthetic';
  return new Uint8Array(await wb.xlsx.writeBuffer());
}

describe('SCMH package Classification columns', () => {
  it('DFMEA KC number appears in DFMEA P, PFMEA Q, PFD N and CP I', async () => {
    let p = seed();
    p = addKc(p, { sourceId: 'DF-001', lifecycle: 'Confirmed', status: 'Approved' });
    expect(p.controlPlan.map((c) => c.kcId)).toEqual(['KC-001']); // onayla motor tarafından önerildi
    const t = { pfd: await pkgFixture('pfd'), dfmea: await pkgFixture('dfmea'), pfmea: await pkgFixture('pfmea'), cp: await pkgFixture('cp') };
    const pkg = await buildScmhPackage(p, t);
    const get = async (k: ScmhKind, ref: string) => (await ScmhBook.open(pkg[k])).get(SCMH_LAYOUT[k].sheet, ref);
    expect(await get('dfmea', 'P18')).toBe('ABC123-KC-001');
    expect(await get('pfmea', 'Q17')).toBe('ABC123-KC-001');
    expect(await get('pfd', 'N15')).toBe('ABC123-KC-001');
    expect(await get('cp', 'I19')).toBe('ABC123-KC-001');
  });
});
