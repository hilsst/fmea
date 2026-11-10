import { describe, expect, it } from 'vitest';
import { STRUCTURE_SCHEMA, validate } from '../src/shared/aischema';
import { blankRow, newProject } from '../src/shared/model';
import { buildProposals, proposalEdits } from '../src/shared/proposals';
import type { Project } from '../src/shared/types';

const meta = { role: 'Structure Analyst', provider: 'local', model: '', at: '', mode: 'strict', tokensIn: 0, tokensOut: 0, cached: false, retries: 0 };
const ev = { docName: 'spec.docx', page: '', section: '', sheet: '', cell: '', balloon: '', quote: '', evidenceType: 'Doküman metni' };
const row = (x: Record<string, unknown>) => ({ ref: '', parentRef: '', level: 'Part', element: '', function: '', functionType: '', performanceReq: '', interface: '', constraint: '', reqIds: [], confidence: 'Medium', basis: 'AI INFERENCE', evidence: [ev], ...x });

function project(): Project {
  const p = newProject();
  p.requirements = [{ ...blankRow('requirements', 'REQ-001'), text: 'Braket 500 N yükü taşımalıdır', approval: 'AI Proposed' } as Project['requirements'][number]];
  p.structure = [{ ...blankRow('structure', 'FN-001'), level: 'System', element: 'Gövde' } as Project['structure'][number]];
  return p;
}

describe('4.9.0 dokümandan yapı & fonksiyon (AI)', () => {
  const data = {
    rows: [
      row({ ref: 'E1', parentRef: 'FN-001', level: 'Product', element: 'Braket montajı', function: 'Yükü gövdeye aktarır', reqIds: ['REQ-001', 'REQ-999'], performanceReq: '500 N' }),
      row({ ref: 'E2', parentRef: 'E1', level: 'Part', element: 'Braket', function: 'Cıvatayı konumlar' }),
      row({ ref: 'E2', parentRef: 'E1', level: 'Part', element: 'Braket', function: 'Titreşimi sönümler' }),
      row({ ref: 'E3', parentRef: 'E9', level: 'Feature', element: 'Delik', function: 'Cıvata geçişi sağlar' }),
    ],
    issues: [],
  };

  it('şema örnek yanıtı kabul eder', () => {
    expect(validate(STRUCTURE_SCHEMA, data)).toEqual([]);
  });

  it('bilinmeyen REQ çıkarılır, kaynakta olmayan sayı yazılmaz', () => {
    const set = buildProposals(project(), 'structure', data, meta, { inputs: 't' });
    const r0 = set.items[0];
    expect(r0.row.reqIds).toEqual(['REQ-001']);
    expect(r0.row.performanceReq).toBe('');
    expect(r0.warnings.join(' ')).toContain('REQ-999');
    expect(r0.row.approval).toBe('AI Proposed');
    expect(set.items.every((i) => !i.critical)).toBe(true);
  });

  it('kabulde ref → FN ID, mevcut FN üst eleman olur, bilinmeyen üst kök kalır', () => {
    const p = project();
    const set = buildProposals(p, 'structure', data, meta, { inputs: 't' });
    set.items.forEach((i) => (i.decision = 'accepted'));
    const { edits } = proposalEdits(p, set);
    const fns = edits.filter((e) => e.table === 'structure').map((e) => e.row as Project['structure'][number]);
    expect(fns.map((f) => [f.id, f.parentId])).toEqual([['FN-002', 'FN-001'], ['FN-003', 'FN-002'], ['FN-004', 'FN-002'], ['FN-005', '']]);
    expect(fns.every((f) => !('_ref' in f) && !('_parentRef' in f))).toBe(true);
  });
});
