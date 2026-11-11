// 4.10.0: Yapı & Fonksiyon kütüphanesi ve elemana özel DFMEA kütüphanesi (AI'sız).
import { describe, expect, it } from 'vitest';
import { generate } from '../src/shared/autogen';
import { ELEMENT_KINDS, elementKind } from '../src/shared/elementLib';
import { planEdits } from '../src/shared/engine';
import type { Edit } from '../src/shared/engine';
import { LISTS, blankRow, newProject } from '../src/shared/model';
import { STRUCTURE_TEMPLATES, defaultElements, planStructure, suggestStructureTemplate } from '../src/shared/structureLib';
import type { Project } from '../src/shared/types';

const apply = (p: Project, edits: unknown[]) => planEdits(p, edits as Edit[], true).project;
function project(partName: string, reqs: [string, string][] = []): Project {
  let p = newProject();
  p.meta.partName = partName;
  reqs.forEach(([text, reqType], i) => {
    const id = `REQ-${String(i + 1).padStart(3, '0')}`;
    p = apply(p, [{ kind: 'add', table: 'requirements', row: { ...blankRow('requirements', id), id, text, reqType } }]);
  });
  return p;
}
const DIGIT = /\d/;

describe('yapı kütüphanesi içeriği', () => {
  it('şablonlar tutarlı: benzersiz anahtar, geçerli üst eleman ve fonksiyon tipi, sayısal değer yok', () => {
    expect(new Set(STRUCTURE_TEMPLATES.map((t) => t.key)).size).toBe(STRUCTURE_TEMPLATES.length);
    for (const t of STRUCTURE_TEMPLATES) {
      const keys = t.elements.map((e) => e.key);
      expect(new Set(keys).size, t.key).toBe(keys.length);
      expect(t.rootFns.length, t.key).toBeGreaterThan(0);
      for (const e of t.elements) {
        if (e.parent) expect(keys.indexOf(e.parent), `${t.key}/${e.key}`).toBeGreaterThanOrEqual(0);
        if (e.parent) expect(keys.indexOf(e.parent), `${t.key}/${e.key} üst eleman önce gelmeli`).toBeLessThan(keys.indexOf(e.key));
        expect(e.fns.length, `${t.key}/${e.key}`).toBeGreaterThan(0);
      }
      for (const f of [...t.rootFns, ...t.elements.flatMap((e) => e.fns)]) {
        expect(LISTS.functionType, f.text).toContain(f.type);
        expect(DIGIT.test(`${f.text} ${f.constraint ?? ''} ${f.iface ?? ''}`), f.text).toBe(false);
      }
    }
  });
  it('eleman DFMEA kütüphanesi: her türde en az 2 hata modu, sayısal limit yok, S/O/D 1–10', () => {
    for (const k of ELEMENT_KINDS) {
      expect(k.templates.length, k.key).toBeGreaterThanOrEqual(2);
      for (const t of k.templates) {
        expect(t.failureMode).toContain('{x}');
        expect(DIGIT.test([t.failureMode, t.effect, t.cause, t.prevention, t.detection].join(' ').replace(/\b3B\b/g, '')), t.failureMode).toBe(false);
        for (const v of [t.s, t.o, t.d]) expect(v >= 1 && v <= 10).toBe(true);
        if (t.ft) expect(LISTS.functionType).toContain(t.ft);
      }
    }
  });
  it('eleman türü addan tanınır (özel tür genel türden önce)', () => {
    expect(elementKind('Yüzey–çekirdek yapıştırma hattı')?.key).toBe('bondline');
    expect(elementKind('Radom duvarı (EM pencere)')?.key).toBe('emWall');
    expect(elementKind('Liner (iç astar)')?.key).toBe('liner');
    expect(elementKind('Dişli delik (diş / helicoil)')?.key).toBe('thread');
    expect(elementKind('Kaynak dikişleri')?.key).toBe('weld');
    expect(elementKind('Mil ucu dişi')?.key).toBe('thread');
    expect(elementKind('Ø6 delik')?.key).toBe('hole');
    expect(elementKind('Perçinler')?.key).toBe('fastener');
    expect(elementKind('Perçin delikleri')?.key).toBe('hole');
    expect(elementKind('Dış sac (panel)')?.key).toBe('metalBody');
    expect(elementKind('Takviye profili (kiriş / stringer)')?.key).toBe('metalBody');
    expect(elementKind('Bilinmeyen şey')).toBeUndefined();
  });
  it('ürün tipinden şablon önerilir', () => {
    expect(suggestStructureTemplate({ meta: { partName: 'SVS Radom' } })).toBe('radome');
    expect(suggestStructureTemplate({ settings: { productType: 'Sandwich Panel' } })).toBe('sandwich');
    expect(suggestStructureTemplate({ settings: { productType: 'Metallic Part' } })).toBe('machined');
    expect(suggestStructureTemplate({ meta: { partName: 'Kaynaklı şase' } })).toBe('weldment');
    expect(suggestStructureTemplate({ meta: { partName: 'Perçinli panel montajı' } })).toBe('riveted');
    expect(suggestStructureTemplate({})).toBe('');
  });
});

describe('kütüphaneden yapı kurma', () => {
  const reqs: [string, string][] = [
    ['4X Ø6.0 +0.10/-0 bağlantı deliği', 'Dimensional'],
    ['Çekirdek bal peteği olmalıdır', 'Material'],
    ['Panel yüzeyi astar ve son kat boya ile korunmalıdır', 'Environmental'],
    ['Otoklav kür çevrimi kaydedilmelidir', 'Process'],
    ['Teslimat ile birlikte uygunluk belgesi verilmelidir', 'Customer-specific'],
  ];
  it('sandviç panel: ağaç, fonksiyonlar, gereksinim bağlantıları; hepsi AI Proposed ve şablon kaynaklı', () => {
    const p0 = project('Sandviç Panel', reqs);
    const plan = planStructure(p0, 'sandwich');
    const p = apply(p0, plan.edits);
    expect(p.structure.length).toBe(plan.rows);
    expect(p.structure.every((s) => s.approval === 'AI Proposed' && s.origin === 'template' && s.function && /Yapı kütüphanesi/.test(s.source))).toBe(true);
    const root = p.structure.find((s) => !s.parentId)!;
    expect(root.element).toBe('Sandviç Panel');
    // isteğe bağlı elemanlar (yıldırım koruma, işaretleme) varsayılan seçimde yok
    expect(p.structure.some((s) => /Yıldırım|İşaretleme/.test(s.element))).toBe(false);
    const core = p.structure.find((s) => s.element.startsWith('Çekirdek'))!;
    const bond = p.structure.find((s) => s.element.includes('yapıştırma hattı'))!;
    expect(core.parentId).toBe(root.id);
    expect(bond.parentId).toBe(core.id);
    // gereksinim bağlama: çekirdek → çekirdek, boya → yüzey koruma; delik elemanı sandviç şablonunda yok; proses gereksinimi bağlanmaz
    expect(core.reqIds).toContain('REQ-002');
    expect(p.structure.find((s) => s.element.startsWith('Yüzey koruma'))!.reqIds).toContain('REQ-003');
    expect(p.structure.flatMap((s) => s.reqIds)).not.toContain('REQ-004');
    expect(plan.unmatched).toContain('REQ-005');
    expect(plan.unmatched).not.toContain('REQ-004');
    expect(plan.linked).toBe(p.structure.flatMap((s) => s.reqIds).length);
  });
  it('tekrar çalıştırma aynı elemanı ikinci kez eklemez; mevcut kök kullanılır', () => {
    const p0 = project('Braket');
    const p1 = apply(p0, planStructure(p0, 'machined').edits);
    expect(planStructure(p1, 'machined').edits.length).toBe(0);
    const more = planStructure(p1, 'machined', [...defaultElements(STRUCTURE_TEMPLATES.find((t) => t.key === 'machined')!), 'thr']);
    const p2 = apply(p1, more.edits);
    expect(p2.structure.filter((s) => !s.parentId).map((s) => s.element)).toEqual([...new Set(p1.structure.filter((s) => !s.parentId).map((s) => s.element))].flatMap((e) => p1.structure.filter((s) => !s.parentId && s.element === e).map((s) => s.element)));
    const thr = p2.structure.filter((s) => s.element.startsWith('Dişli delik'));
    expect(thr.length).toBe(1);
    expect(p2.structure.find((s) => s.id === thr[0].parentId)!.element).toBe('Gövde');
  });
  it('DFMEA: elemana özel hata modları eleman başına bir kez, tipine uyan fonksiyon satırına eklenir', () => {
    const p0 = project('Sandviç Panel');
    const p1 = apply(p0, planStructure(p0, 'sandwich').edits);
    const p = apply(p1, generate(p1, ['dfmea']).edits);
    const coreRows = p.structure.filter((s) => s.element.startsWith('Çekirdek'));
    expect(coreRows.length).toBe(2);
    const coreDf = p.dfmea.filter((d) => coreRows.some((s) => s.id === d.functionId) && /eleman: Çekirdek/.test(d.source));
    expect(coreDf.length).toBe(ELEMENT_KINDS.find((k) => k.key === 'core')!.templates.length);
    expect(new Set(coreDf.map((d) => d.failureMode)).size).toBe(coreDf.length);
    expect(coreDf.some((d) => /nem \/ sıvı giriyor/.test(d.failureMode))).toBe(true);
    const bondDf = p.dfmea.filter((d) => /eleman: Yapıştırma hattı/.test(d.source));
    expect(bondDf.some((d) => /ayrılıyor/.test(d.failureMode))).toBe(true);
    expect(p.dfmea.every((d) => d.approval === 'AI Proposed' && d.confidence === 'Low' && d.origin === 'template')).toBe(true);
    // ikinci çalıştırmada yeni satır yok
    expect(generate(p, ['dfmea']).edits.filter((e) => e.kind === 'add').length).toBe(0);
  });
});
