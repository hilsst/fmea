import { describe, expect, it } from 'vitest';
import { planEdits } from '../src/shared/engine';
import { blankRow, newProject } from '../src/shared/model';
import { NO_DATA, acceptanceOf, verificationOf } from '../src/shared/reqAutofill';
import type { Project, RequirementRow } from '../src/shared/types';

const add = (p: Project, text: string, extra: Partial<RequirementRow> = {}) =>
  planEdits(p, [{ kind: 'add', table: 'requirements', row: { ...blankRow('requirements', 'REQ-001'), id: 'REQ-001', text, ...extra } as never }], true).project;
const set = (p: Project, field: string, value: unknown) => planEdits(p, [{ kind: 'set', table: 'requirements', id: 'REQ-001', field, value }], true).project;
const req = (p: Project) => p.requirements[0];

describe('gereksinim otomatik doldurma', () => {
  it('metindeki toleranstan limit, kabul kriteri ve doğrulama yöntemi', () => {
    const r = req(add(newProject(), '4X Ø6.0 +0.10/-0 delik', { reqType: 'Dimensional' }));
    expect([r.nominal, r.lsl, r.usl]).toEqual([6, 6, 6.1]);
    expect(r.acceptance).toBe('6–6.1 (nominal 6, +0.10/-0)');
    expect(r.verification).toMatch(/^Tapa mastar \/ CMM \(AI ÖNERİSİ/);
    expect(r.characteristic).toBe('Çap');
  });
  it('limit yoksa uydurmaz: VERİ YOK', () => {
    const r = req(add(newProject(), 'Panel yük altında fonksiyonunu korumalıdır'));
    expect(r.acceptance).toBe(NO_DATA);
    expect(r.verification).toBe(NO_DATA);
    expect(acceptanceOf({ nominal: 5, lsl: null, usl: null, unit: 'mm', tolerance: '' })).toBe(`5 mm – tolerans ${NO_DATA}`);
    expect(verificationOf({ text: '', reqType: 'Material', characteristic: '' })).toMatch(/CoC/);
  });
  it('metin değişince otomatik alanlar güncellenir; elle girilen değer korunur', () => {
    let p = add(newProject(), 'Kalınlık 25.6–26.4 mm');
    expect(req(p).acceptance).toBe('25.6–26.4 mm');
    p = set(p, 'text', 'Kalınlık 25.0–26.0 mm');
    expect(req(p).acceptance).toBe('25–26 mm');
    p = set(p, 'acceptance', 'Müşteri çizimi Rev C’ye göre');
    expect(req(p).autoFields).not.toContain('acceptance');
    p = set(p, 'text', 'Kalınlık 24–26 mm');
    expect(req(p).acceptance).toBe('Müşteri çizimi Rev C’ye göre');
    expect(req(p).lsl).toBe(24);
  });
  it('dolu alanlara dokunmaz (eski projeler)', () => {
    const r = req(add(newProject(), 'Kalınlık 1–2 mm', { acceptance: 'Elle', verification: 'Elle' }));
    expect([r.acceptance, r.verification]).toEqual(['Elle', 'Elle']);
  });
});
