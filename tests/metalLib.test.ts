import { describe, expect, it } from 'vitest';
import { generate } from '../src/shared/autogen';
import { planEdits, type Edit } from '../src/shared/engine';
import { materialFamily, pfmeaAreaOf } from '../src/shared/failureLib';
import { blankRow, newProject } from '../src/shared/model';
import type { AnyRow, Project } from '../src/shared/types';

const COMPOSITE = /ply|prepreg|laminat|delaminasyon|torba|vakum|kür|otoklav|kalıba|kalıptan|reçine|out-time|FOD/i;

/** EGT-BRK-001: 6061-T6 alüminyum sac braket, ürün tipi seçilmemiş (gereksinimden çıkarılır). */
function braket(productType = ''): Project {
  const p0 = newProject();
  p0.settings.productType = productType;
  p0.meta = { ...p0.meta, partNumber: 'EGT-BRK-001', partName: 'Alüminyum L braket' };
  const reqs: [string, string, string][] = [
    ['REQ-001', 'Braket malzemesi EN AW-6061-T6 alüminyum levha olmalıdır', 'Material'],
    ['REQ-002', 'Levha kalınlığı 3.0 ± 0.1 mm olmalıdır', 'Material'],
    ['REQ-004', 'Büküm açısı 90 ± 1 ° olmalıdır', 'Dimensional'],
    ['REQ-006', 'Montaj delikleri 2X Ø6.6 +0.1/0 mm olmalıdır', 'Interface'],
    ['REQ-008', 'Kesim kenarlarında çapak yüksekliği en fazla 0.1 mm olmalıdır', 'Dimensional'],
    ['REQ-013', 'Anodize kaplama kalınlığı 10–20 µm olmalıdır', 'Process'],
  ];
  const steps: [string, string, string][] = [['OP-001', '10', 'Lazer kesim'], ['OP-002', '20', 'Büküm'], ['OP-003', '30', 'Delik delme'], ['OP-004', '40', 'Çapak alma'], ['OP-005', '50', 'Anodize'], ['OP-006', '60', 'Final muayene']];
  const E: Edit[] = [
    ...reqs.map(([id, text, reqType]) => ({ kind: 'add' as const, table: 'requirements' as const, row: { ...blankRow('requirements', id), id, text, reqType } as AnyRow })),
    ...steps.map(([id, opNo, name]) => ({ kind: 'add' as const, table: 'processSteps' as const, row: { ...blankRow('processSteps', id), id, opNo, name } as AnyRow })),
  ];
  const p = planEdits(p0, E).project;
  return planEdits(p, generate(p, ['pfmea']).edits as Edit[]).project;
}

describe('4.5.0 metal parça PFMEA kütüphanesi', () => {
  it('malzeme ailesi ürün tipinden, yoksa gereksinim metninden çıkarılır', () => {
    const p = newProject();
    expect(materialFamily(p)).toBe('');
    p.requirements = [{ ...blankRow('requirements', 'REQ-001'), text: 'Malzeme 6061-T6 alüminyum' } as Project['requirements'][number]];
    expect(materialFamily(p)).toBe('metal');
    p.settings.productType = 'Sandwich Panel';
    expect(materialFamily(p)).toBe('composite');
  });

  it('metal ailede adımlar metal alanlarına gider; kompozitte eski eşleme korunur', () => {
    expect(['Lazer kesim', 'Büküm', 'Delik delme', 'Çapak alma', 'Anodize', 'Final muayene'].map((n) => pfmeaAreaOf(n, 'metal')))
      .toEqual(['Cutting', 'Forming', 'Metal Machining', 'Deburring', 'Metal Finishing', 'Inspection']);
    expect(pfmeaAreaOf('Ply kesim')).toBe('Lay-up');
    expect(pfmeaAreaOf('Anodize')).toBe('Metal Finishing');
  });

  it.each(['', 'Metallic Part'])('braket PFMEA önerilerinde kompozit terim yok (ürün tipi "%s")', (pt) => {
    const p = braket(pt);
    expect(p.pfmea.length).toBeGreaterThan(10);
    for (const r of p.pfmea) {
      const txt = [r.processFunction, r.failureMode, r.effect, r.cause, r.prevention, r.detection, r.productRequirement].join(' | ');
      expect(txt, r.id).not.toMatch(COMPOSITE);
    }
  });

  it('gereksinimler doğru adıma bağlanır; anodize özel proses olur', () => {
    const p = braket();
    const reqsOf = (stepId: string) => new Set(p.pfmea.filter((r) => r.stepId === stepId).flatMap((r) => r.reqIds ?? []));
    expect([...reqsOf('OP-001')]).toContain('REQ-008');
    expect([...reqsOf('OP-001')]).not.toContain('REQ-013');
    expect([...reqsOf('OP-003')]).toContain('REQ-006');
    expect([...reqsOf('OP-004')]).toEqual(['REQ-008']);
    expect([...reqsOf('OP-005')]).toContain('REQ-013');
    expect(p.processSteps.find((s) => s.id === 'OP-005')?.specialProcess).toBe(true);
  });
});
