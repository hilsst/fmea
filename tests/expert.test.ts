import { describe, expect, it } from 'vitest';
import { approvedExamples, expertBrief, formatExamples, mergeExamples, pickExamples } from '../src/shared/expert';
import { blankRow, newProject } from '../src/shared/model';
import type { Project } from '../src/shared/types';

function proj(): Project {
  const p = newProject();
  p.meta.partNumber = 'EGT-BRK-001';
  p.requirements = [{ ...blankRow('requirements', 'REQ-001'), text: 'Malzeme 6061-T6 alüminyum levha' } as Project['requirements'][number]];
  p.processSteps = [{ ...blankRow('processSteps', 'OP-001'), opNo: '30', name: 'Delik delme' } as Project['processSteps'][number]];
  p.pfmea = [
    { ...blankRow('pfmea', 'PF-001'), stepId: 'OP-001', processFunction: 'Ø6.6 delik del', failureMode: 'Delik çapı küçük', cause: 'Matkap aşınması', prevention: 'Takım ömrü sayacı', detection: 'Go/no-go mastar', s: 6, o: 4, d: 3, approval: 'Approved' },
    { ...blankRow('pfmea', 'PF-002'), stepId: 'OP-001', failureMode: 'Taslak satır', approval: 'AI Proposed' },
  ] as Project['pfmea'];
  return p;
}

describe('4.5.0 uzman modu ve örnekle besleme', () => {
  it('yalnızca onaylı satırlar örnek olur; metal ailesi ve adım alanı taşınır', () => {
    const ex = approvedExamples(proj(), '2026-10-22T00:00:00Z');
    expect(ex).toHaveLength(1);
    expect(ex[0]).toMatchObject({ key: 'EGT-BRK-001|pfmea|PF-001', family: 'metal', failureMode: 'Delik çapı küçük' });
    expect(ex[0].context).toContain('[Metal Machining]');
  });

  it('kütüphane aynı anahtarı günceller; seçim tür ve malzeme ailesine göre süzer', () => {
    const a = approvedExamples(proj(), '2026-10-01T00:00:00Z');
    const b = approvedExamples(proj(), '2026-10-22T00:00:00Z');
    const lib = mergeExamples(a, b);
    expect(lib).toHaveLength(1);
    expect(lib[0].at).toBe('2026-10-22T00:00:00Z');
    expect(pickExamples(lib, 'pfmea', 'metal', 'OP-005 Delik delme Ø8 delik')).toHaveLength(1);
    expect(pickExamples(lib, 'pfmea', 'composite', 'Delik delme')).toHaveLength(0);
    expect(pickExamples(lib, 'dfmea', 'metal', 'Delik delme')).toHaveLength(0);
    expect(formatExamples(lib)).toContain('KOPYALAMA');
  });

  it('uzman talimatı metal parçada kompozit terimleri yasaklar ve adım alanını verir', () => {
    const b = expertBrief(proj(), 'pfmea');
    expect(b).toContain('MALZEME AİLESİ: metal');
    expect(b).toContain('YAZMA');
    expect(b).toContain('OP-001 Delik delme → alan: Metal Machining');
    expect(expertBrief(proj(), 'dfmea')).toContain('UZMAN DFMEA');
  });
});
