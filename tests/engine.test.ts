import { describe, expect, it } from 'vitest';
import { crossScreenEffects, planEdits, summarizeChanges, type Edit } from '../src/shared/engine';
import { blankRow, newProject } from '../src/shared/model';
import { actionPriority, capability, rpn } from '../src/shared/scoring';
import { completenessScore, qualityChecks } from '../src/shared/checks';
import type { DfmeaRow, PfmeaRow, Project } from '../src/shared/types';

function seed(): Project {
  const p = newProject();
  p.documents.push({ ...(blankRow('documents', 'DOC-001') as any), name: 'Teknik resim', docNumber: 'DRW-001', revision: 'A' });
  p.requirements.push({ ...(blankRow('requirements', 'REQ-001') as any), text: 'Delik çapı Ø6.0 +0.10/0', acceptance: 'Ø6.00–6.10', source: 'DRW-001 / Dim. 4' });
  p.structure.push({ ...(blankRow('structure', 'FN-001') as any), level: 'Feature', element: 'Montaj deliği', function: 'Cıvata geçişini sağlar', reqIds: ['REQ-001'] });
  p.dfmea.push({ ...(blankRow('dfmea', 'DF-001') as DfmeaRow), functionId: 'FN-001', function: 'Cıvata geçişini sağlar', reqIds: ['REQ-001'], requirement: 'REQ-001: Delik çapı Ø6.0 +0.10/0', failureMode: 'Delik küçük', s: 7, o: 4, d: 5, source: 'REQ-001' });
  p.processSteps.push({ ...(blankRow('processSteps', 'OP-001') as any), opNo: '60', name: 'Machining', machine: 'CNC-1' });
  p.pfmea.push({ ...(blankRow('pfmea', 'PF-001') as PfmeaRow), stepId: 'OP-001', opNo: '60', stepName: 'Machining', dfIds: ['DF-001'], failureMode: 'Hole undersize', s: 7, o: 3, d: 4, prevention: 'Takım ömrü takibi', detection: 'Tapa mastar', source: 'DF-001' });
  return p;
}

const apply = (p: Project, edits: Edit[]) => planEdits(p, edits);

describe('scoring', () => {
  it('AP follows AIAG-VDA table', () => {
    expect(actionPriority(10, 2, 2)).toBe('L');
    expect(actionPriority(10, 2, 7)).toBe('H');
    expect(actionPriority(9, 4, 1)).toBe('M');
    expect(actionPriority(8, 6, 1)).toBe('M');
    expect(actionPriority(8, 6, 2)).toBe('H');
    expect(actionPriority(5, 8, 1)).toBe('M');
    expect(actionPriority(1, 10, 10)).toBe('L');
    expect(actionPriority(null, 1, 1)).toBe('');
    expect(rpn(10, 2, 2)).toBe(40);
  });
  it('capability needs data', () => {
    expect(capability([], 1, 2, null).message).toMatch(/production data required/);
    const r = capability([6.02, 6.04, 6.03, 6.05, 6.04, 6.03], 6.0, 6.1, null);
    expect(r.cpk).toBeCloseTo(0.94, 2);
    expect(r.cp).toBeCloseTo(1.343, 2);
  });
});

describe('propagation', () => {
  it('DFMEA severity change flows to PFMEA and creates KC candidate', () => {
    const p = seed();
    const edits: Edit[] = [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }];
    const plan = apply(p, edits);
    expect(plan.project.pfmea[0].s).toBe(9);
    const kcs = plan.project.kcs;
    expect(kcs.map((k) => k.sourceId).sort()).toEqual(['DF-001', 'PF-001']);
    expect(kcs.every((k) => k.status === 'AI Proposed')).toBe(true);
    const cross = crossScreenEffects(plan, edits);
    expect(cross.some((e) => e.table === 'pfmea' && e.field === 's')).toBe(true);
    expect(cross.some((e) => e.table === 'kcs' && e.kind === 'Added')).toBe(true);
    // original untouched
    expect(p.pfmea[0].s).toBe(7);
  });

  it('lowering severity removes unapproved auto KC', () => {
    let p = apply(seed(), [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }]).project;
    p = apply(p, [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 6 }]).project;
    expect(p.kcs.length).toBe(0);
    expect(p.pfmea[0].s).toBe(6);
  });

  it('approving KC creates control plan, MSA and capability rows', () => {
    let p = apply(seed(), [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }]).project;
    const kc = p.kcs.find((k) => k.sourceId === 'DF-001')!;
    p = apply(p, [{ kind: 'set', table: 'kcs', id: kc.id, field: 'status', value: 'Approved' }]).project;
    const cp = p.controlPlan.find((c) => c.kcId === kc.id)!;
    expect(cp).toBeTruthy();
    expect(cp.opNo).toBe('60');
    expect(cp.method).toBe('Tapa mastar');
    expect(cp.specification).toContain('Ø6.00–6.10');
    expect(p.msa.some((m) => m.cpId === cp.id)).toBe(true);
    expect(p.capability.some((m) => m.kcId === kc.id)).toBe(true);
    // rejecting removes auto rows
    p = apply(p, [{ kind: 'set', table: 'kcs', id: kc.id, field: 'status', value: 'Rejected' }]).project;
    expect(p.controlPlan.some((c) => c.kcId === kc.id)).toBe(false);
    expect(p.msa.length).toBe(0);
  });

  it('requirement acceptance change updates DFMEA, KC, control plan and flags reassessment', () => {
    let p = apply(seed(), [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }]).project;
    const kc = p.kcs.find((k) => k.sourceId === 'DF-001')!;
    p = apply(p, [{ kind: 'set', table: 'kcs', id: kc.id, field: 'status', value: 'Approved' }]).project;
    p = apply(p, [{ kind: 'set', table: 'requirements', id: 'REQ-001', field: 'acceptance', value: 'Ø6.00–6.05' }]).project;
    expect(p.kcs.find((k) => k.id === kc.id)!.specification).toContain('6.05');
    expect(p.controlPlan.find((c) => c.kcId === kc.id)!.specification).toContain('6.05');
    expect(p.dfmea[0].reassess).toMatch(/Reassessment Required/);
  });

  it('process step rename flows to PFMEA and control plan; machine change flags PFMEA', () => {
    const p = apply(seed(), [
      { kind: 'set', table: 'processSteps', id: 'OP-001', field: 'name', value: 'CNC Delme' },
      { kind: 'set', table: 'processSteps', id: 'OP-001', field: 'machine', value: 'CNC-2' },
    ]).project;
    expect(p.pfmea[0].stepName).toBe('CNC Delme');
    expect(p.pfmea[0].reassess).toMatch(/makine/);
  });

  it('document revision flags rows citing it', () => {
    const p = apply(seed(), [{ kind: 'set', table: 'documents', id: 'DOC-001', field: 'revision', value: 'B' }]).project;
    expect(p.requirements[0].reassess).toMatch(/DRW-001/);
  });

  it('recommended action creates and syncs action log both ways', () => {
    let p = apply(seed(), [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'recommendedAction', value: 'Delik için go/no-go fikstürü' }]).project;
    const act = p.actions[0];
    expect(act.sourceId).toBe('PF-001');
    expect(p.pfmea[0].actionId).toBe(act.id);
    p = apply(p, [{ kind: 'set', table: 'actions', id: act.id, field: 'status', value: 'Completed' }]).project;
    expect(p.pfmea[0].actionStatus).toBe('Completed');
    expect(p.actions[0].completionDate).not.toBe('');
    p = apply(p, [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'owner', value: 'Ayşe' }]).project;
    expect(p.actions[0].owner).toBe('Ayşe');
  });

  it('deleting DFMEA row unlinks PFMEA and removes its KC', () => {
    let p = apply(seed(), [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }]).project;
    const edits: Edit[] = [{ kind: 'delete', table: 'dfmea', id: 'DF-001' }];
    const plan = apply(p, edits);
    p = plan.project;
    expect(p.pfmea[0].dfIds).toEqual([]);
    expect(p.kcs.some((k) => k.sourceId === 'DF-001')).toBe(false);
    expect(crossScreenEffects(plan, edits).length).toBeGreaterThan(0);
  });

  it('KC threshold change re-evaluates candidates', () => {
    const p = planEdits(seed(), [{ kind: 'settings', field: 'kcSeverityThreshold', value: 7 }]).project;
    expect(p.kcs.length).toBe(2);
  });

  it('propagate=false applies only the primary edit', () => {
    const p = planEdits(seed(), [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }], false).project;
    expect(p.pfmea[0].s).toBe(7);
    expect(p.kcs.length).toBe(0);
  });

  it('change summary lists ids', () => {
    const p = apply(seed(), [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }]).project;
    const s = summarizeChanges(p);
    expect(s.modified).toContain('DF-001');
    expect(s.added).toContain('KC-001');
  });

  it('quality checks produce a score', () => {
    const checks = qualityChecks(seed());
    const score = completenessScore(checks);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});
