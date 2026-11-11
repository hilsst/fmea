import { describe, expect, it } from 'vitest';
import { approvedExamples, exampleProposalData } from '../src/shared/expert';
import { blankRow, newProject } from '../src/shared/model';
import { buildProposals } from '../src/shared/proposals';
import type { Project } from '../src/shared/types';

type Step = Project['processSteps'][number];
function source(): Project {
  const p = newProject();
  p.meta.partNumber = 'ESKI-001';
  p.requirements = [{ ...blankRow('requirements', 'REQ-001'), text: 'Malzeme 6061-T6 alüminyum levha' } as Project['requirements'][number]];
  p.processSteps = [
    { ...blankRow('processSteps', 'OP-001'), opNo: '10', name: 'Delik delme' } as Step,
    { ...blankRow('processSteps', 'OP-002'), opNo: '20', name: 'Lazer kesim' } as Step,
  ];
  p.pfmea = [
    { ...blankRow('pfmea', 'PF-001'), stepId: 'OP-001', processFunction: 'Delik del', failureMode: 'Delik çapı küçük', cause: 'Matkap aşınması', rootCause: 'Takım ömrü tanımsız', prevention: 'Takım ömrü sayacı', detection: 'Go/no-go mastar', s: 6, o: 4, d: 3, approval: 'Approved' },
    { ...blankRow('pfmea', 'PF-002'), stepId: 'OP-002', processFunction: 'Kontur kes', failureMode: 'Kontur ölçü dışı', cause: 'Yanlış NC programı', prevention: 'Program revizyon kontrolü', detection: 'İlk parça ölçümü', s: 5, o: 3, d: 4, approval: 'Engineer Reviewed' },
    { ...blankRow('pfmea', 'PF-003'), stepId: 'OP-001', failureMode: 'Onaysız taslak', approval: 'AI Proposed' },
  ] as Project['pfmea'];
  return p;
}

function target(): Project {
  const p = newProject();
  p.meta.partNumber = 'YENI-002';
  p.requirements = [{ ...blankRow('requirements', 'REQ-001'), text: 'Malzeme 5052 alüminyum sac' } as Project['requirements'][number]];
  p.processSteps = [{ ...blankRow('processSteps', 'OP-001'), opNo: '30', name: 'Delik delme Ø8' } as Step];
  return p;
}

describe('4.6.0 onaylı örneklerden öneri (AI yok)', () => {
  const pool = approvedExamples(source());

  it('yalnız onaylı ve aynı adım alanındaki örnekler önerilir', () => {
    const d = exampleProposalData(target(), 'pfmea', pool);
    expect(d.rows).toHaveLength(1);
    expect(d.rows[0]).toMatchObject({ stepId: 'OP-001', failureMode: 'Delik çapı küçük', rootCause: 'Takım ömrü tanımsız', s: 6, basis: 'ENGINEERING KNOWLEDGE' });
    expect(String((d.rows[0].sWhy as { reason: string }).reason)).toContain('doğrulanmalı');
  });

  it('hedefte aynı hata modu varsa tekrar önerilmez; kompozit parçaya metal örneği gitmez', () => {
    const t = target();
    t.pfmea = [{ ...blankRow('pfmea', 'PF-001'), stepId: 'OP-001', failureMode: 'Delik çapı küçük' }] as Project['pfmea'];
    expect(exampleProposalData(t, 'pfmea', pool).rows).toHaveLength(0);
    const c = target();
    c.settings.productType = 'Composite';
    c.requirements = [];
    expect(exampleProposalData(c, 'pfmea', pool).rows).toHaveLength(0);
  });

  it('inceleme ekranı verisine dönüşür (AI Proposed, adım bağlı)', () => {
    const t = target();
    const set = buildProposals(t, 'pfmea', exampleProposalData(t, 'pfmea', pool), { role: 'Örnek kütüphanesi', provider: 'local', model: '', at: '', mode: 'strict', tokensIn: 0, tokensOut: 0, cached: false, retries: 0 }, { inputs: 'test' });
    expect(set.items).toHaveLength(1);
    expect(set.items[0].row).toMatchObject({ stepId: 'OP-001', approval: 'AI Proposed', failureMode: 'Delik çapı küçük' });
  });
});
