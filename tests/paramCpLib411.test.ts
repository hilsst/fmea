// 4.11.0: proses parametresi ve kontrol planı kütüphanesi (AI'sız); perçinleme / sızdırmazlık PFMEA alanları.
import { describe, expect, it } from 'vitest';
import { generate } from '../src/shared/autogen';
import { GAUGE_LIB, cpEditsFromParams, cpFillEdits, gaugeFor, paramEdits } from '../src/shared/cpLib';
import { planEdits } from '../src/shared/engine';
import type { Edit } from '../src/shared/engine';
import { PFMEA_LIB, pfmeaAreaOf } from '../src/shared/failureLib';
import { FLOW_TEMPLATES, STEP_IO } from '../src/shared/flowLib';
import { LISTS, blankRow, newProject } from '../src/shared/model';
import { msaStudyFor } from '../src/shared/msa';
import { PARAM_LIB, paramFillValues, paramTemplate } from '../src/shared/paramLib';
import { RISK_LISTS } from '../src/shared/risk';
import type { ControlPlanRow, ProcessParamRow, Project } from '../src/shared/types';

const apply = (p: Project, edits: unknown[]) => planEdits(p, edits as Edit[], true).project;
const addStep = (p: Project, id: string, name: string) => apply(p, [{ kind: 'add', table: 'processSteps', row: { ...blankRow('processSteps', id), id, opNo: id.slice(-2), name } }]);
const DIGIT = /\d/;

describe('proses parametresi kütüphanesi', () => {
  it('adım kütüphanesindeki her parametre tanınır; kategori listede, birim / önleme / izleme / reaksiyon / limit kaynağı dolu', () => {
    for (const [area, io] of Object.entries(STEP_IO)) for (const name of io.params) expect(paramTemplate(name), `${area}: ${name}`).toBeDefined();
    expect(new Set(PARAM_LIB.map((t) => t.key)).size).toBe(PARAM_LIB.length);
    for (const t of PARAM_LIB) {
      expect(LISTS.paramCategory, t.key).toContain(t.category);
      for (const f of ['productCharacteristic', 'prevention', 'monitoring', 'reaction', 'validation', 'limitSource', 'gauge', 'record'] as const) expect(t[f].trim(), `${t.key}.${f}`).not.toBe('');
    }
  });
  it('kütüphane sayısal limit içermez', () => {
    for (const t of PARAM_LIB)
      expect(DIGIT.test([t.productCharacteristic, t.prevention, t.monitoring, t.reaction, t.validation, t.limitSource, t.gauge, t.record].join(' ').replace(/\b3B\b/g, '')), t.key).toBe(false);
    for (const g of GAUGE_LIB) expect(DIGIT.test(`${g.gauge} ${g.record}`.replace(/3B|AS9102/g, '')), g.key).toBe(false);
  });
  it('özel ad genel addan önce eşleşir', () => {
    expect(paramTemplate('Kür sıcaklığı')?.key).toBe('cureTemp');
    expect(paramTemplate('Ortam nemi')?.key).toBe('humidity');
    expect(paramTemplate('Soğutma hızı / ortamı')?.key).toBe('quench');
    expect(paramTemplate('Soğutma hızı')?.key).toBe('rampRate');
    expect(paramTemplate('Reçine banyosu sıcaklığı')?.key).toBe('resinTemp');
    expect(paramTemplate('Banyo sıcaklığı')?.key).toBe('bathTemp');
    expect(paramTemplate('Tork değeri')?.key).toBe('torque');
    expect(paramTemplate('Bilinmeyen parametre')).toBeUndefined();
  });
  it('yeni adımın parametreleri dolu gelir; nominal / limit boş, not limit kaynağını söyler', () => {
    const p = addStep(newProject(), 'OP-001', 'Otoklav kürü');
    const cure = (p.processParams as ProcessParamRow[]).find((x) => x.parameter === 'Kür sıcaklığı')!;
    expect(cure).toMatchObject({ category: 'Temperature', unit: '°C', nominal: null, lsl: null, usl: null });
    expect(cure.monitoring).toMatch(/termokupl/i);
    expect(cure.notes).toMatch(/^VERİ YOK.*Limit kaynağı:/);
    expect((p.processParams as ProcessParamRow[]).every((x) => x.prevention && x.reaction && x.nominal == null && x.lsl == null && x.usl == null)).toBe(true);
  });
  it('dolu alan ve girilmiş limit korunur; eksik parametre eklenir', () => {
    let p = addStep(newProject(), 'OP-001', 'Otoklav kürü');
    const cure = (p.processParams as ProcessParamRow[]).find((x) => x.parameter === 'Kür sıcaklığı')!;
    expect(paramFillValues({ ...cure, unit: '°F', prevention: '', nominal: 180, notes: 'Şartname 5.2' })).toEqual({ prevention: cure.prevention });
    p = apply(p, [{ kind: 'delete', table: 'processParams', id: cure.id }]);
    const edits = paramEdits(p);
    expect(edits.filter((e) => e.kind === 'add').map((e) => (e as { row: ProcessParamRow }).row.parameter)).toEqual(['Kür sıcaklığı']);
    expect(paramEdits(apply(p, edits)).length).toBe(0);
  });
});

describe('kontrol planı kütüphanesi', () => {
  it('ölçüm yönteminden cihaz / kayıt / kontrol tipi; kontrol tipi listede; MSA çalışma önerisiyle uyumlu', () => {
    for (const g of GAUGE_LIB) expect(RISK_LISTS.controlKind, g.key).toContain(g.controlKind);
    expect(gaugeFor('CMM ile ölçüsel kontrol')?.key).toBe('cmm');
    expect(gaugeFor('Ultrasonik muayene (C-scan)')?.key).toBe('ut');
    expect(gaugeFor('Görsel muayene')?.key).toBe('visual');
    expect(gaugeFor('VERİ YOK – doğrulanmalı')).toBeUndefined();
    expect(msaStudyFor(gaugeFor('Kumpas ile ölçüm')!.gauge).study).toBe('Gage R&R');
    expect(msaStudyFor(gaugeFor('Görsel muayene')!.gauge).study).toBe('Attribute Agreement Analysis');
    expect(msaStudyFor(paramTemplate('Kür sıcaklığı')!.gauge).study).toBe('Calibration');
  });
  it('parametrelerden satır: parametreye bağlı, örnek / sıklık VERİ YOK, limit yoksa spesifikasyon VERİ YOK + kaynak', () => {
    let p = addStep(newProject(), 'OP-001', 'Otoklav kürü');
    const n = p.processParams.length;
    const edits = cpEditsFromParams(p);
    expect(edits.length).toBe(n);
    p = apply(p, edits);
    const cps = p.controlPlan as ControlPlanRow[];
    expect(cps.every((c) => c.ppId && c.charType === 'Process Parameter' && /^VERİ YOK/.test(c.sampleSize) && /^VERİ YOK/.test(c.frequency) && c.gauge && c.record && c.reactionPlan)).toBe(true);
    expect(cps.every((c) => /^VERİ YOK.*Limit kaynağı:/.test(c.specification))).toBe(true);
    expect(cpEditsFromParams(p).length).toBe(0);
    // limit girilince bağlı satırın spesifikasyonu motor tarafından güncellenir
    const cure = (p.processParams as ProcessParamRow[]).find((x) => x.parameter === 'Kür sıcaklığı')!;
    p = apply(p, [{ kind: 'set', table: 'processParams', id: cure.id, field: 'lsl', value: 175 }, { kind: 'set', table: 'processParams', id: cure.id, field: 'usl', value: 185 }]);
    expect((p.controlPlan as ControlPlanRow[]).find((c) => c.ppId === cure.id)!.specification).toBe('175–185 °C');
  });
  it('boş alanlar dolar, dolu alan korunur; PFMEA üzerinden tek aday parametre bağlanır', () => {
    let p = addStep(newProject(), 'OP-001', 'Montaj (bağlantı elemanı / tork)');
    p = apply(p, generate(p, ['pfmea']).edits);
    const tork = (p.processParams as ProcessParamRow[]).find((x) => x.parameter === 'Tork değeri')!;
    expect(tork.pfIds.length).toBeGreaterThan(0);
    const mk = (id: string, data: Partial<ControlPlanRow>) => ({ kind: 'add', table: 'controlPlan', row: { ...blankRow('controlPlan', id), id, stepId: 'OP-001', ...data } });
    p = apply(p, [mk('CP-901', { pfId: tork.pfIds[0], method: 'Tork kaydı kontrolü', processChar: 'Tork' }), mk('CP-902', { method: 'Görsel muayene', productChar: 'Tork işareti', gauge: 'Büyüteç' })]);
    const edits = cpFillEdits(p);
    p = apply(p, edits);
    const a = (p.controlPlan as ControlPlanRow[]).find((c) => c.id === 'CP-901')!;
    const b = (p.controlPlan as ControlPlanRow[]).find((c) => c.id === 'CP-902')!;
    expect(a).toMatchObject({ ppId: tork.id, charType: 'Process Parameter', gauge: 'Kalibre tork anahtarı', record: 'Tork kayıt formu' });
    expect(a.specification).toMatch(/^VERİ YOK.*Limit kaynağı:/);
    expect(b).toMatchObject({ gauge: 'Büyüteç', charType: 'Product Characteristic', controlKind: 'Inspection', record: 'Muayene kayıt formu' });
    expect(edits.some((e) => e.field === 'sampleSize' || e.field === 'frequency')).toBe(false);
    expect(cpFillEdits(p).length).toBe(0);
  });
});

describe('perçinleme ve sızdırmazlık PFMEA alanları', () => {
  it('adımlar kendi alanına gider; her alanda en az 5 hata modu; montaj genişledi', () => {
    for (const fam of ['', 'metal'] as const) {
      expect(pfmeaAreaOf('Perçinleme', fam)).toBe('Riveting');
      expect(pfmeaAreaOf('Ara yüzey sealant uygulama', fam)).toBe('Sealing');
      expect(pfmeaAreaOf('Montaj (bağlantı elemanı / tork)', fam)).toBe('Assembly');
    }
    expect(PFMEA_LIB.Riveting.length).toBeGreaterThanOrEqual(5);
    expect(PFMEA_LIB.Sealing.length).toBeGreaterThanOrEqual(5);
    expect(PFMEA_LIB.Assembly.length).toBeGreaterThanOrEqual(8);
    expect(FLOW_TEMPLATES.find((t) => t.key === 'riveting')!.steps.map((s) => pfmeaAreaOf(s.name, 'metal'))).not.toContain('Generic');
  });
});
