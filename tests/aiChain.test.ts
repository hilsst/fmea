import { describe, expect, it } from 'vitest';
import { acceptAll, cpRowsFromPfmea } from '../src/shared/aiChain';
import { blankRow, newProject } from '../src/shared/model';
import { buildProposals } from '../src/shared/proposals';
import type { Project } from '../src/shared/types';

type Pf = Project['pfmea'][number];
const pf = (id: string, stepId: string, detection: string, s: number) => ({ ...blankRow('pfmea', id), stepId, failureMode: `FM ${id}`, detection, s, o: 3, d: 4 }) as Pf;
const meta = { role: 'x', provider: 'local', model: '', at: '', mode: 'strict', tokensIn: 0, tokensOut: 0, cached: false, retries: 0 };

describe('4.9.0 AI ile tümünü kur', () => {
  it('kontrol planı: aynı adım + aynı tespit yöntemi tek satır, en yüksek S temsilci, numune/sıklık VERİ YOK', () => {
    const p = newProject();
    p.pfmea = [pf('PF-001', 'OP-001', 'CMM ölçümü', 6), pf('PF-002', 'OP-001', 'CMM  ölçümü', 9), pf('PF-003', 'OP-001', 'Görsel', 5), pf('PF-004', 'OP-002', 'CMM ölçümü', 7)];
    const rows = cpRowsFromPfmea(p);
    expect(rows).toHaveLength(3);
    expect(rows[0].pfId).toBe('PF-002');
    expect(rows[0].notes).toContain('PF-001');
    expect(rows.every((r) => r.sampleSize?.startsWith('VERİ YOK') && r.frequency?.startsWith('VERİ YOK'))).toBe(true);
    p.controlPlan = [{ ...blankRow('controlPlan', 'CP-001'), pfId: 'PF-003' } as Project['controlPlan'][number]];
    expect(cpRowsFromPfmea(p).map((r) => r.pfId)).not.toContain('PF-003');
  });

  it('zincirde öneriler kabul edilir (AI Proposed kalır), yapı yalnız onaylı gereksinime bağlanır', () => {
    const p = newProject();
    p.requirements = [{ ...blankRow('requirements', 'REQ-001'), text: 'a', approval: 'Approved' }, { ...blankRow('requirements', 'REQ-002'), text: 'b', approval: 'AI Proposed' }] as Project['requirements'];
    const set = acceptAll(p, buildProposals(p, 'structure', { rows: [{ ref: 'E1', parentRef: '', level: 'Part', element: 'Braket', function: 'Yük taşır', functionType: '', performanceReq: '', interface: '', constraint: '', reqIds: ['REQ-001', 'REQ-002'], confidence: 'Medium', basis: 'AI INFERENCE', evidence: [] }], issues: [] }, meta, { inputs: 't' }));
    expect(set.items[0].decision).toBe('accepted');
    expect(set.items[0].row.reqIds).toEqual(['REQ-001']);
    expect(set.items[0].row.approval).toBe('AI Proposed');
  });
});
