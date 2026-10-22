import { describe, expect, it } from 'vitest';
import { planEdits, type Edit } from '../src/shared/engine';
import { generate } from '../src/shared/autogen';
import { pfmeaAreaOf } from '../src/shared/failureLib';
import { FLOW_TEMPLATES, planFlow, suggestFlowTemplates } from '../src/shared/flowLib';
import { blankRow, newProject, normalizeProject } from '../src/shared/model';
import { needsAction } from '../src/shared/risk';
import { AI_REC, OWNER_NO_DATA, rpnActionText } from '../src/shared/rpnAction';
import type { AnyRow, DfmeaRow, PfmeaRow, Project } from '../src/shared/types';

const addSteps = (p: Project, keys: string[]) => {
  let cur = p;
  const edits: Edit[] = planFlow(keys, p.processSteps).map((st, i) => {
    const id = `OP-${String(cur.processSteps.length + i + 1).padStart(3, '0')}`;
    return { kind: 'add', table: 'processSteps', row: { ...blankRow('processSteps', id), id, opNo: st.opNo, name: st.name, description: st.description, stepType: st.stepType, origin: 'template' } as AnyRow };
  });
  cur = planEdits(p, edits).project;
  return cur;
};

describe('4.4.0 proses akışı şablonları', () => {
  it('malzemeye göre şablon önerir ve çoklu seçimi sıralı tek akışa çevirir', () => {
    expect(suggestFlowTemplates('Metal – alüminyum', '')).toEqual(['machining']);
    expect(suggestFlowTemplates('Karma (metal + kompozit)', '')).toEqual(['composite', 'machining', 'assembly']);
    expect(suggestFlowTemplates('', 'Radome')).toEqual(['composite']);
    const flow = planFlow(['assembly', 'machining', 'welding'], []);
    const names = flow.map((s) => s.name);
    expect(names[0]).toBe('Malzeme kabul');
    expect(names.at(-1)).toBe('Ambalaj ve sevkiyat');
    expect(names.indexOf('CNC tornalama')).toBeLessThan(names.indexOf('Kaynak'));
    expect(names.indexOf('Kaynak')).toBeLessThan(names.indexOf('Montaj (bağlantı elemanı / tork)'));
    expect(new Set(names).size).toBe(names.length);
    expect(flow.map((s) => s.opNo).slice(0, 3)).toEqual(['10', '20', '30']);
    // mevcut adımlar atlanır, numara devam eder
    const more = planFlow(['machining'], [{ name: 'Malzeme kabul', opNo: '10' }, { name: 'CNC tornalama', opNo: '50' }]);
    expect(more.some((s) => s.name === 'CNC tornalama' || s.name === 'Malzeme kabul')).toBe(false);
    expect(more[0].opNo).toBe('60');
  });

  it('şablon adımları beklenen kütüphane alanlarına düşer', () => {
    const area = (n: string) => pfmeaAreaOf(n);
    expect(area('Kaynak')).toBe('Welding');
    expect(area('Kaynak muayenesi (görsel / NDT)')).toBe('NDT');
    expect(area('Isıl işlem')).toBe('Heat Treatment');
    expect(area('CNC tornalama')).toBe('Metal Machining');
    expect(area('Büküm / şekillendirme')).toBe('Forming');
    expect(area('Ply kitleme')).toBe('Lay-up');
    expect(area('Machining')).toBe('Machining'); // kompozit kenar işleme değişmedi
    for (const t of FLOW_TEMPLATES) expect(t.steps.length).toBeGreaterThan(0);
  });

  it('yeni adıma PFD girdi/çıktı ve parametre adları eklenir; limit VERİ YOK, PFMEA taslağı üretilmez', () => {
    const p = addSteps(newProject(), ['welding']);
    const weld = p.processSteps.find((s) => s.name === 'Kaynak')!;
    const io = p.pfdItems.filter((x) => x.stepId === weld.id);
    expect(io.some((x) => x.kind === 'Output')).toBe(true);
    expect(io.filter((x) => x.kind === 'Input').every((x) => x.cat4M && x.sourceOfVariation)).toBe(true);
    const prm = p.processParams.filter((x) => x.stepId === weld.id);
    expect(prm.map((x) => x.parameter)).toContain('Kaynak akımı');
    expect(prm.every((x) => x.lsl == null && x.usl == null && /VERİ YOK/.test(x.notes))).toBe(true);
    expect(p.pfmea).toHaveLength(0);
    // ikinci kez çalışmaz (adımda zaten girdi/çıktı var)
    const again = planEdits(p, [{ kind: 'set', table: 'processSteps', id: weld.id, field: 'description', value: 'x' }]).project;
    expect(again.pfdItems.length).toBe(p.pfdItems.length);
  });

  it('kütüphane PFMEA satırları adımın PFD çıktısına ve aynı 4M girdilerine bağlanır', () => {
    const p = addSteps(newProject(), ['heat']);
    const g = generate(p, ['pfmea']);
    const q = planEdits(p, g.edits).project;
    const ht = q.processSteps.find((s) => s.name === 'Isıl işlem')!;
    const rows = q.pfmea.filter((r) => r.stepId === ht.id);
    expect(rows.length).toBeGreaterThan(0);
    const out = q.pfdItems.find((x) => x.stepId === ht.id && x.kind === 'Output')!;
    expect(rows.every((r) => r.outputId === out.id)).toBe(true);
    const machine = rows.find((r) => r.cause4M === 'Machine')!;
    expect(machine.causeInputIds.length).toBeGreaterThan(0);
  });
});

describe('4.4.0 RPN eşiği ve otomatik önerilen aksiyon', () => {
  const seed = () => {
    const p = newProject();
    p.processSteps.push({ ...(blankRow('processSteps', 'OP-001') as Project['processSteps'][number]), opNo: '10', name: 'CNC tornalama' });
    p.pfmea.push({ ...(blankRow('pfmea', 'PF-001') as PfmeaRow), stepId: 'OP-001', stepName: 'CNC tornalama', failureMode: 'Ölçü / tolerans dışı (çap, boy, konum)', cause: 'Takım aşınması', prevention: 'Takım değişim talimatı', detection: 'Görsel', s: 6, o: 3, d: 3 });
    p.dfmea.push({ ...(blankRow('dfmea', 'DF-001') as DfmeaRow), failureMode: 'Et kalınlığı yetersiz', cause: 'Tolerans hatası', prevention: '', detection: 'Analiz', s: 7, o: 3, d: 3 });
    return p;
  };

  it('yeni projede eşik 100; eski boş eşik 100’e taşınır, açık değer korunur', () => {
    expect(newProject().settings.rpnThreshold).toBe(100);
    const old = newProject() as Partial<Project>;
    old.settings = { ...old.settings!, rpnThreshold: null };
    delete (old.settings as Partial<Project['settings']>).rpnAutoAction;
    expect(normalizeProject(structuredClone(old)).settings.rpnThreshold).toBe(100);
    old.settings.rpnThreshold = 150;
    expect(normalizeProject(structuredClone(old)).settings.rpnThreshold).toBe(150);
    const cur = newProject();
    cur.settings.rpnThreshold = null; // 4.4 dosyasında bilinçli olarak kapatılmış
    expect(normalizeProject(structuredClone(cur)).settings.rpnThreshold).toBeNull();
  });

  it('eşik aşılınca boş aksiyon satır bilgisinden dolar, aksiyon kaydı açılır', () => {
    const plan = planEdits(seed(), [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'd', value: 7 }]);
    const r = plan.project.pfmea[0];
    expect(r.recommendedAction).toMatch(/^\[RPN 126 ≥ 100\]/);
    expect(r.recommendedAction).toContain('mevcut tespit “Görsel” yetersiz (D=7)');
    expect(r.recommendedAction).toContain(AI_REC);
    expect(r.recommendedAction).toMatch(/kütüphane:/); // aynı alan (Metal Machining) kontrol adları
    expect(r.owner).toBe(OWNER_NO_DATA);
    expect(r.dueDate).toBe('');
    expect(r.predS ?? null).toBeNull();
    expect(plan.project.actions.some((a) => a.sourceId === 'PF-001')).toBe(true);
    expect(needsAction(plan.project, r).reasons).toContain('RPN≥100');
  });

  it('DFMEA: oluşum baskınsa neden ve önleme üzerinden öneri', () => {
    const r = planEdits(seed(), [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 'o', value: 6 }]).project.dfmea[0];
    expect(r.recommendedAction).toContain('“Tolerans hatası” nedenine karşı önleme kontrolü tanımlı değil (O=6)');
    expect(r.recommendedAction).not.toMatch(/Tespiti iyileştir/);
  });

  it('dolu aksiyon, ALARP kararı, eşik altı ve kapalı ayar değiştirilmez', () => {
    const a = seed();
    a.pfmea[0].recommendedAction = 'Mühendis aksiyonu';
    expect(planEdits(a, [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'd', value: 7 }]).project.pfmea[0].recommendedAction).toBe('Mühendis aksiyonu');
    const b = seed();
    b.pfmea[0].riskDecision = 'No action – ALARP';
    expect(planEdits(b, [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'd', value: 7 }]).project.pfmea[0].recommendedAction).toBe('');
    expect(planEdits(seed(), [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'd', value: 5 }]).project.pfmea[0].recommendedAction).toBe(''); // 90
    const c = seed();
    c.settings.rpnAutoAction = false;
    expect(planEdits(c, [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'd', value: 7 }]).project.pfmea[0].recommendedAction).toBe('');
  });

  it('eşik düşürülünce mevcut satırlar değerlendirilir; S≥9 tasarım değişikliği notu eklenir', () => {
    const p = seed();
    p.pfmea[0].s = 9;
    const q = planEdits(p, [{ kind: 'settings', field: 'rpnThreshold', value: 50 }]).project;
    expect(q.pfmea[0].recommendedAction).toMatch(/^\[RPN 81 ≥ 50\] S=9/);
    expect(q.dfmea[0].recommendedAction).toMatch(/^\[RPN 63 ≥ 50\]/);
    expect(rpnActionText(q, { ...q.dfmea[0], cause: '' }, false)).toMatch(/5 Neden/);
  });
});
