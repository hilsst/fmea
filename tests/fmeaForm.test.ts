import { describe, expect, it } from 'vitest';
import { cellText, COLUMNS, FORM_GROUPS } from '../src/shared/columns';
import { formHeader } from '../src/shared/fmeaForm';
import { blankRow, newProject } from '../src/shared/model';
import type { AnyRow, DfmeaRow } from '../src/shared/types';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

describe('F33.03 / F05.04 form düzeni', () => {
  for (const t of ['dfmea', 'pfmea'] as const) {
    it(`${t}: A–Z form kolonları başta, sırayla ve görünür`, () => {
      const form = COLUMNS[t].filter((c) => c.formCol);
      expect(COLUMNS[t].slice(0, form.length)).toEqual(form);
      expect([...new Set(form.map((c) => c.formCol))]).toEqual(LETTERS);
      expect(form.every((c) => !c.secondary)).toBe(true);
      expect(form.filter((c) => c.formLabel === 'Severity').map((c) => c.key)).toEqual(['s', 'predS', 'newS']);
      expect(form.find((c) => c.formCol === 'O')!.group).toBe(FORM_GROUPS.pred);
      expect(form.find((c) => c.formCol === 'Z')!.group).toBe(FORM_GROUPS.achieved);
      // onay ve izlenebilirlik kolonları korunur, form dışı grupta
      const approval = COLUMNS[t].find((c) => c.key === 'approval')!;
      expect(approval.group).toBe(FORM_GROUPS.app);
      expect(approval.secondary).toBeFalsy();
      expect(COLUMNS[t].every((c) => c.group)).toBe(true);
      // Excel / içe aktarma etiketleri benzersiz kalır
      const labels = COLUMNS[t].map((c) => c.label);
      expect(new Set(labels).size).toBe(labels.length);
    });
  }

  it('tahmini / gerçekleşen RPN ve başlıktaki en büyük RPN', () => {
    const p = newProject();
    const a = { ...blankRow('dfmea', 'DF-001'), s: 8, o: 5, d: 3, predS: 8, predO: 2, predD: 3, newS: 8, newO: 2, newD: 2 } as DfmeaRow;
    const b = { ...blankRow('dfmea', 'DF-002'), s: 6, o: 3, d: 4 } as DfmeaRow;
    p.dfmea = [a, b];
    const col = (k: string) => COLUMNS.dfmea.find((c) => c.key === k)!;
    expect(cellText(col('rpn'), a as AnyRow, p)).toBe('120');
    expect(cellText(col('predRpn'), a as AnyRow, p)).toBe('48');
    expect(cellText(col('newRpn'), a as AnyRow, p)).toBe('32');
    expect(cellText(col('predRpn'), b as AnyRow, p)).toBe('');
    p.meta.partNumber = 'PO-1193';
    const h = formHeader(p, 'dfmea');
    expect(h.docNo).toBe('F33.03');
    expect(h.largestRpn).toBe(120);
    expect(h.fields.find((f) => f.label === 'Part #')!.value).toBe('PO-1193');
    expect(formHeader(p, 'pfmea')).toMatchObject({ docNo: 'F05.04', largestRpn: null });
  });
});
