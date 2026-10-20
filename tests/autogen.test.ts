import { describe, expect, it } from 'vitest';
import { elementName, generate } from '../src/shared/autogen';
import { fillBlanksEdits } from '../src/shared/fmeaFill';
import { planEdits } from '../src/shared/engine';
import { blankRow, newProject } from '../src/shared/model';
import type { Edit } from '../src/shared/engine';
import type { Project } from '../src/shared/types';

function withReqs(): Project {
  let p = newProject();
  p.meta.partName = 'Sandviç Panel';
  p.meta.partNumber = 'P-100';
  const add = (id: string, text: string, reqType: string) =>
    (p = planEdits(p, [{ kind: 'add', table: 'requirements', row: { ...blankRow('requirements', id), id, text, reqType } as never }], true).project);
  add('REQ-001', '4X Ø6.0 +0.10/-0 delik', 'Dimensional');
  add('REQ-002', 'Panel 500 N yükü taşımalıdır', 'Structural');
  add('REQ-003', 'Çalışma sıcaklığı -40 / +80 °C', 'Environmental');
  return p;
}
const apply = (p: Project, edits: unknown[]) => planEdits(p, edits as Edit[], true).project;

describe('otomatik öneri motoru', () => {
  it('eleman adı ölçüleri atar', () => {
    expect(elementName('4X Ø6.0 +0.10/-0 delik')).toBe('Delik');
    expect(elementName('Toplam panel kalınlığı 25.6–26.4 mm olmalıdır')).toBe('Toplam panel kalınlığı');
  });
  it('gereksinim → yapı → DFMEA zinciri, hepsi AI Proposed ve izlenebilir', () => {
    const p0 = withReqs();
    const g = generate(p0, ['structure', 'dfmea']);
    const p = apply(p0, g.edits);
    const root = p.structure.find((s) => s.level === 'Product')!;
    expect(root.element).toBe('Sandviç Panel');
    expect(root.reqIds).toContain('REQ-002');
    const hole = p.structure.find((s) => s.level === 'Feature')!;
    expect(hole.element).toBe('Delik');
    expect(hole.parentId).toBe(p.structure.find((s) => s.level === 'Part')!.id);
    expect(hole.function).toMatch(/6–6\.1/);
    expect(p.structure.every((s) => s.approval === 'AI Proposed')).toBe(true);
    // her fonksiyon için en az bir DFMEA satırı, gereksinim ve fonksiyon bağlı
    for (const fn of p.structure.filter((s) => s.function)) expect(p.dfmea.some((d) => d.functionId === fn.id)).toBe(true);
    const d = p.dfmea.find((x) => x.functionId === hole.id)!;
    expect(d.reqIds).toEqual(['REQ-001']);
    expect(d.requirement).toMatch(/delik/);
    expect([d.approval, d.confidence, d.basis]).toEqual(['AI Proposed', 'Low', 'ENGINEERING KNOWLEDGE']);
    expect(d.s).toBeGreaterThan(0);
    expect(d.detection).toMatch(/Tapa mastar/);
    expect(d.system).toBe('Sandviç Panel');
    expect(d.component).toBe('Delik');
    expect(d.localEffect && d.higherEffect && d.verification).toBeTruthy();
    expect(d.riskCategory).toEqual(['Manufacturability']);
    expect(d.noiseFactor).toEqual(['Piece-to-piece']);
    // ikinci çalıştırma tekrar üretmez
    expect(generate(p, ['structure', 'dfmea']).edits).toHaveLength(0);
  });
  it('mevcut satırların boş alanları doldurulur, dolu alanlar korunur', () => {
    let p = withReqs();
    p = apply(p, generate(p, ['structure']).edits);
    p = apply(p, [{ kind: 'add', table: 'dfmea', row: { ...blankRow('dfmea', 'DF-001'), id: 'DF-001', functionId: p.structure.find((s) => s.level === 'Feature')!.id, reqIds: ['REQ-001'], failureMode: 'Delik büyük', localEffect: 'Elle' } }]);
    const e = fillBlanksEdits(p, 'dfmea');
    expect(e.some((x) => x.field === 'localEffect')).toBe(false);
    expect(e.some((x) => x.field === 'component')).toBe(true);
  });
  it('PFMEA: adım kütüphanesi + özel proses parametresi bağlantısı', () => {
    let p = newProject();
    p = apply(p, [
      { kind: 'add', table: 'processSteps', row: { ...blankRow('processSteps', 'OP-001'), id: 'OP-001', opNo: '90', name: 'Cure', specialProcess: true } },
      { kind: 'add', table: 'processParams', row: { ...blankRow('processParams', 'PP-001'), id: 'PP-001', stepId: 'OP-001', parameter: 'Kür sıcaklığı', productCharacteristic: 'Tg' } },
    ]);
    const g = generate(p, ['pfmea']);
    p = apply(p, g.edits);
    const rows = p.pfmea.filter((r) => r.stepId === 'OP-001');
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expect(rows.every((r) => r.failureMode && r.effect && r.cause && r.rootCause && r.prevention && r.detection && r.s && r.o && r.d)).toBe(true);
    expect(p.processParams[0].pfIds.length).toBe(2);
    for (const r of rows) {
      expect(r.processFunction).toMatch(/kür/i);
      expect(r.measurement && r.reactionPlan && r.processElement).toBeTruthy();
      expect(r.specialChar).toBe('Process');
    }
    const prmRow = rows.find((r) => r.failureMode === 'Kür sıcaklığı alt limitin altında')!;
    expect(prmRow.processRequirement).toMatch(/Kür sıcaklığı: VERİ YOK/);
    const s9 = rows.find((r) => (r.s ?? 0) >= 9)!;
    expect(s9.sDisposition).toBeTruthy();
    expect(s9.recommendedAction).toMatch(/AI ÖNERİSİ/);
    // tekrar doldurma dolu alanlara dokunmaz
    expect(fillBlanksEdits(p, 'pfmea').filter((e) => e.field !== 'dfIds')).toHaveLength(0);
    expect(rows.find((r) => r.failureMode === 'Kür sıcaklığı alt limitin altında')!.source).toMatch(/limit VERİ YOK/);
  });
});
