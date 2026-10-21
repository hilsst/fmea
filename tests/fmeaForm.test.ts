import { describe, expect, it } from 'vitest';
import { cellText, COLUMNS, FORM_GROUPS, tableColumns } from '../src/shared/columns';
import { planEdits } from '../src/shared/engine';
import { formHeader } from '../src/shared/fmeaForm';
import { pfmeaFillValues } from '../src/shared/fmeaFill';
import { pfmeaAreaOf } from '../src/shared/failureLib';
import { blankRow, newProject } from '../src/shared/model';
import type { AnyRow, DfmeaRow } from '../src/shared/types';

const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

describe('F33.03 / F05.04 form düzeni', () => {
  for (const t of ['dfmea', 'pfmea'] as const) {
    it(`${t}: A–Z form kolonları başta, sırayla ve görünür`, () => {
      const form = COLUMNS[t].filter((c) => c.formCol);
      const lastForm = Math.max(...form.map((c) => COLUMNS[t].indexOf(c)));
      expect(COLUMNS[t].slice(0, lastForm + 1).every((c) => c.formCol || c.key === 'reqIds')).toBe(true);
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
    expect(formHeader(p, 'dfmea').docNo).toBe('SCMH 7.2.10');
    expect(formHeader(p, 'dfmea').largestRpn).toBeUndefined();
    p.settings.tableFormat = 'F33';
    const h = formHeader(p, 'dfmea');
    expect(h.docNo).toBe('F33.03');
    expect(h.largestRpn).toBe(120);
    expect(h.fields.find((f) => f.label === 'Part #')!.value).toBe('PO-1193');
    expect(formHeader(p, 'pfmea')).toMatchObject({ docNo: 'F05.04', largestRpn: null });
  });
});

describe('PFMEA gereksinimleri otomatik dolar', () => {
  const setup = () => {
    const p = newProject();
    p.processSteps = [{ ...blankRow('processSteps', 'PS-001'), opNo: '10', name: 'Kalıp Hazırlığı' } as never];
    p.dfmea = [{ ...blankRow('dfmea', 'DF-001'), requirement: 'REQ-001: RF kaybı ≤ 1.5 dB' } as DfmeaRow];
    return p;
  };
  it('eşleşen gereksinim yoksa bağlı DFMEA gereksinimi, o da yoksa VERİ YOK', () => {
    const p = setup();
    const linked = { ...blankRow('pfmea', 'PF-001'), stepId: 'PS-001', dfIds: ['DF-001'] } as never;
    const v = pfmeaFillValues(p, linked);
    expect(v.productRequirement).toBe('REQ-001: RF kaybı ≤ 1.5 dB');
    expect(String(v.processRequirement)).toMatch(/^VERİ YOK/);
    const bare = pfmeaFillValues(p, { ...blankRow('pfmea', 'PF-002'), stepId: 'PS-001' } as never);
    expect(String(bare.productRequirement)).toMatch(/^VERİ YOK/);
  });
  it('VERİ YOK yer tutucusu gerçek veri gelince değişir, elle yazılan değişmez', () => {
    const p = setup();
    const ph = { ...blankRow('pfmea', 'PF-001'), stepId: 'PS-001', dfIds: ['DF-001'], productRequirement: 'VERİ YOK – doğrulanmalı (x)' } as never;
    expect(pfmeaFillValues(p, ph).productRequirement).toBe('REQ-001: RF kaybı ≤ 1.5 dB');
    const manual = { ...blankRow('pfmea', 'PF-002'), stepId: 'PS-001', dfIds: ['DF-001'], productRequirement: 'Elle' } as never;
    expect(pfmeaFillValues(p, manual).productRequirement).toBeUndefined();
  });
  it('Vakum Poşetleme adımı vakum alanına düşer', () => {
    expect(pfmeaAreaOf('Vakum Poşetleme')).toBe('Vacuum Bagging');
  });
});

describe('SCMH 7.2.10 / 7.2.11 düzeni (varsayılan)', () => {
  it('kolonlar SCMH sırasında; F33 kolonları kaybolmaz', () => {
    const letters = (t: 'dfmea' | 'pfmea') => tableColumns(t, undefined).filter((c) => c.formCol).map((c) => `${c.formCol}:${c.formLabel}`);
    expect(letters('dfmea').slice(0, 5)).toEqual(['B:Doc (Line) #', 'C:Item', 'D:Function', 'E:Requirement', 'F:Potential Failure Mode']);
    expect(letters('dfmea')).toContain('N:SEV * OCC');
    expect(letters('dfmea').at(-1)).toBe('Y:Action Results RPN');
    expect(letters('pfmea').slice(0, 6)).toEqual(['B:Doc (Line) #', 'C:Process Step', 'D:Process Description', 'E:Product Requirements', 'F:Process Requirements', 'G:Potential Failure Mode']);
    expect(letters('pfmea').at(-1)).toBe('Z:Action Result RPN');
    for (const t of ['dfmea', 'pfmea'] as const) {
      const keys = tableColumns(t, 'SCMH').map((c) => c.key);
      for (const k of COLUMNS[t].map((c) => c.key)) expect(keys).toContain(k);
      expect(tableColumns(t, 'SCMH').find((c) => c.key === 'predS')!.secondary).toBe(true);
      expect(tableColumns(t, 'F33')).toBe(COLUMNS[t]);
    }
  });
});

describe('PFMEA gereksinim seçimi', () => {
  it('Gereksinim ID seçilince ürün / proses gereksinimi yazılır', () => {
    const p = newProject();
    p.requirements = [
      { ...blankRow('requirements', 'REQ-001'), text: 'Kalınlık 5.00 ±0.15 mm', reqType: 'Dimensional' },
      { ...blankRow('requirements', 'REQ-002'), text: 'Kür 120 ±5 °C', reqType: 'Process' },
    ] as never;
    p.pfmea = [{ ...blankRow('pfmea', 'PF-001') } as never];
    const out = planEdits(p, [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'reqIds', value: ['REQ-001', 'REQ-002'] }]).project.pfmea[0];
    expect(out.productRequirement).toBe('REQ-001: Kalınlık 5.00 ±0.15 mm');
    expect(out.processRequirement).toBe('REQ-002: Kür 120 ±5 °C');
  });
});
