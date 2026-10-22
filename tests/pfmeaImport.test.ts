import { describe, expect, it } from 'vitest';
import { blankRow, newProject } from '../src/shared/model';
import { dfmeaTransferReason, pfmeaFromRequirement, requirementInPfmea, requirementTransferReason } from '../src/shared/pfmeaImport';
import type { DfmeaRow, PfmeaRow, RequirementRow } from '../src/shared/types';

const req = (id: string, reqType: string, extra: Partial<RequirementRow> = {}) => ({ ...blankRow('requirements', id), text: `metin ${id}`, reqType, ...extra }) as RequirementRow;
const df = (id: string, extra: Partial<DfmeaRow>) => ({ ...blankRow('dfmea', id), failureMode: 'fm', ...extra }) as DfmeaRow;

describe('4.4.1 PFMEA aktarım önerileri', () => {
  it('DFMEA: yalnızca yüksek S, KC adayı veya üretilebilirlik satırları ve henüz bağlı olmayanlar önerilir', () => {
    const p = newProject();
    p.dfmea = [df('DF-001', { s: 9 }), df('DF-002', { s: 4 }), df('DF-003', { s: 3, riskCategory: ['Manufacturability'] }), df('DF-004', { s: 10 })];
    p.pfmea = [{ ...blankRow('pfmea', 'PF-001'), dfIds: ['DF-004'] } as PfmeaRow];
    expect(dfmeaTransferReason(p, p.dfmea[0])).toContain('S≥');
    expect(dfmeaTransferReason(p, p.dfmea[1])).toBe('');
    expect(dfmeaTransferReason(p, p.dfmea[2])).toBe('Üretilebilirlik');
    expect(dfmeaTransferReason(p, p.dfmea[3])).toBe('');
  });

  it('Gereksinim: proses/boyutsal/SR önerilir, PFMEA’da (doğrudan veya DFMEA üzerinden) olan önerilmez', () => {
    const p = newProject();
    p.requirements = [req('REQ-001', 'Manufacturing'), req('REQ-002', 'Functional'), req('REQ-003', 'Dimensional'), req('REQ-004', 'Inspection'), req('REQ-005', 'Functional', { specialRequirement: true })];
    p.dfmea = [df('DF-001', { reqIds: ['REQ-004'] })];
    p.pfmea = [{ ...blankRow('pfmea', 'PF-001'), dfIds: ['DF-001'] } as PfmeaRow];
    expect(requirementInPfmea(p, 'REQ-004')).toEqual(['PF-001']);
    expect(p.requirements.map((r) => requirementTransferReason(p, r) !== '')).toEqual([true, false, true, false, true]);
  });

  it('Gereksinimden taslak satır hata modu uydurmaz, gereksinimi tipine göre yerleştirir', () => {
    const proc = pfmeaFromRequirement(req('REQ-001', 'Manufacturing'), 'OP-010');
    expect(proc).toMatchObject({ stepId: 'OP-010', reqIds: ['REQ-001'], processRequirement: 'REQ-001: metin REQ-001', productRequirement: '', approval: 'AI Proposed' });
    expect(proc.failureMode).toBeUndefined();
    expect(pfmeaFromRequirement(req('REQ-002', 'Dimensional'), '').productRequirement).toBe('REQ-002: metin REQ-002');
  });
});
