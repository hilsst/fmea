import { describe, expect, it } from 'vitest';
import { dfmeaTargets, dfmeaTargetText } from '../src/shared/dfmeaInput';
import { blankRow, newProject } from '../src/shared/model';
import { buildProposals } from '../src/shared/proposals';
import type { Approval, Project } from '../src/shared/types';

type Req = Project['requirements'][number];
type Fn = Project['structure'][number];
const req = (id: string, approval: Approval) => ({ ...blankRow('requirements', id), text: `${id} metni`, approval }) as Req;

function project(): Project {
  const p = newProject();
  p.requirements = [req('REQ-001', 'Approved'), req('REQ-002', 'AI Proposed'), req('REQ-003', 'Engineer Reviewed')];
  p.structure = [
    { ...blankRow('structure', 'FN-001'), element: 'Braket', function: 'Yükü taşır', reqIds: ['REQ-001', 'REQ-002'] } as Fn,
    { ...blankRow('structure', 'FN-002'), element: 'Delik', function: 'Cıvatayı konumlar', reqIds: ['REQ-002', 'REQ-003'] } as Fn,
  ];
  return p;
}

describe('4.6.3 DFMEA önerisi yalnızca onaylı gereksinimlerden', () => {
  it('onaysız gereksinimleri hedeften çıkarır, onaylısı olmayan fonksiyonu atlar', () => {
    const { ready, skipped } = dfmeaTargets(project());
    expect(ready.map((t) => [t.fn.id, t.reqIds])).toEqual([['FN-001', ['REQ-001']]]);
    expect(skipped.map((f) => f.id)).toEqual(['FN-002']);
    expect(dfmeaTargetText(ready)).toContain('FN-001: Braket → Yükü taşır (REQ: REQ-001)');
    expect(dfmeaTargetText(ready)).not.toContain('REQ-002');
  });

  it('AI satırındaki onaysız REQ bağlantısını çıkarır ve uyarır', () => {
    const p = project();
    const set = buildProposals(p, 'dfmea', { rows: [{ functionId: 'FN-001', reqIds: ['REQ-001', 'REQ-002'], failureMode: 'Kırılma', basis: 'ENGINEERING KNOWLEDGE', confidence: 'Medium', evidence: [] }], issues: [] }, { role: 'FMEA Generator', provider: 'local', model: '', at: '', mode: 'strict', tokensIn: 0, tokensOut: 0, cached: false, retries: 0 }, { inputs: 'test' });
    const it0 = set.items[0];
    expect(it0.row.reqIds).toEqual(['REQ-001']);
    expect(it0.warnings.join(' ')).toContain('REQ-002');
  });
});
