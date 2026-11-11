// 4.12.0: firma kütüphanesi – şema, birleştirme, devre dışı bırakma, rev çakışması, bozuk dosya, motorlar, onaylı satırdan kayıt, Excel.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setActiveLib } from '../src/shared/activeLib';
import { generate } from '../src/shared/autogen';
import {
  LIB_FILE, applyOps, builtinIndex, cleanRecord, emptyCompanyLib, libView, mergeLibs, recordsFromApproved, recordsFromExamples, scrubText, searchRows, validateCompanyLib,
  type CompanyLib, type CoDfmea, type CoPfmea,
} from '../src/shared/companyLib';
import { buildLibWorkbook, parseLibWorkbook } from '../src/shared/companyLibExcel';
import { gaugeFor } from '../src/shared/cpLib';
import { elementKind } from '../src/shared/elementLib';
import { planEdits } from '../src/shared/engine';
import type { Edit } from '../src/shared/engine';
import { DFMEA_LIB, PFMEA_LIB } from '../src/shared/failureLib';
import { blankRow, newProject } from '../src/shared/model';
import { paramFillValues, paramTemplate } from '../src/shared/paramLib';
import { planStructure } from '../src/shared/structureLib';
import type { DfmeaRow, PfmeaRow, Project } from '../src/shared/types';
import { readLibFile, writeLibFile } from '../src/main/companyLibFile';

const apply = (p: Project, edits: unknown[]) => planEdits(p, edits as Edit[], true).project;
const BY = 'Test Kullanıcı';

/** Bir gereksinimi (tip: Dimensional) olan fonksiyon satırlı proje. */
function dfmeaProject(element = 'Braket', reqType = 'Dimensional'): Project {
  let p = newProject();
  p.meta.partName = element;
  p = apply(p, [{ kind: 'add', table: 'requirements', row: { ...blankRow('requirements', 'REQ-001'), id: 'REQ-001', text: 'Delik çapı 12,5 mm ±0,1', reqType, characteristic: 'Delik çapı' } }]);
  p = apply(p, [{ kind: 'add', table: 'structure', row: { ...blankRow('structure', 'FN-001'), id: 'FN-001', level: 'Component', element, function: 'Montaj arayüzünü sağlar', functionType: 'Geometrik uyum', reqIds: ['REQ-001'], approval: 'Approved' } }]);
  return p;
}
function pfmeaProject(stepName = 'CNC frezeleme'): Project {
  return apply(newProject(), [{ kind: 'add', table: 'processSteps', row: { ...blankRow('processSteps', 'OP-001'), id: 'OP-001', opNo: '10', name: stepName } }]);
}
const rec = (over: Partial<CoDfmea> = {}): CoDfmea => ({ id: 'c:df:test1', addedBy: BY, addedAt: '2026-11-11T00:00:00Z', scopeKind: 'reqType', scope: 'Dimensional', failureMode: 'Firma özel: {x} montaj şablonuna uymuyor', effect: 'Montaj durur', cause: 'Şablon revizyonu eski', prevention: 'Şablon revizyon kontrolü', detection: 'Montaj şablonu ile geçme kontrolü', s: 6, o: 4, d: 5, ...over });
const prec = (over: Partial<CoPfmea> = {}): CoPfmea => ({ id: 'c:pf:test1', addedBy: BY, addedAt: '2026-11-11T00:00:00Z', area: 'Metal Machining', cause4M: 'Method', rootCause: 'Program doğrulanmamış', errorProofing: '', failureMode: 'Firma özel: program yanlış revizyon', effect: 'Hurda', cause: 'Eski program çağrıldı', prevention: 'Program revizyon kilidi', detection: 'İlk parça muayenesi', s: 7, o: 3, d: 4, ...over });
const withOps = (ops: Parameters<typeof applyOps>[1], base: CompanyLib = emptyCompanyLib()) => applyOps(base, ops, { by: BY, at: '2026-11-11T00:00:00Z' }).lib;

afterEach(() => setActiveLib(undefined));

describe('birleşik kütüphane', () => {
  it('firma verisi yokken yerleşikle aynıdır; takma adlar aynı dizi kalır', () => {
    const m = mergeLibs();
    expect(Object.keys(m.dfmea)).toEqual(Object.keys(DFMEA_LIB));
    for (const k of Object.keys(DFMEA_LIB)) expect(m.dfmea[k].length, k).toBe(DFMEA_LIB[k].length);
    for (const k of Object.keys(PFMEA_LIB)) expect(m.pfmea[k].length, k).toBe(PFMEA_LIB[k].length);
    expect(m.dfmea.Process).toBe(m.dfmea.Manufacturing);
    expect(m.pfmea.Autoclave).toBe(m.pfmea.Cure);
    const p = dfmeaProject();
    expect(generate(p, ['dfmea'], { lib: m }).edits.length).toBe(generate(p, ['dfmea']).edits.length);
    const q = pfmeaProject();
    expect(generate(q, ['pfmea'], { lib: m }).edits.length).toBe(generate(q, ['pfmea']).edits.length);
  });
  it('yerleşik kayıt kimlikleri benzersizdir', () => {
    const ix = builtinIndex();
    const ids = [...ix.dfmea, ...ix.functionTypes, ...ix.element, ...ix.pfmea, ...ix.pfmeaCommon, ...ix.alt, ...ix.params, ...ix.gauges, ...ix.structures].map((x) => x.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('görünüm: yerleşik + firma, kaynak rozeti, devre dışı işareti ve arama', () => {
    const co = withOps({ upsert: [{ coll: 'dfmea', rec: rec() }], disable: [builtinIndex().params[0].id] });
    const rows = libView(co, 'dfmea');
    expect(rows.filter((r) => r.source === 'Firma')).toHaveLength(1);
    expect(rows.filter((r) => r.source === 'Yerleşik').length).toBeGreaterThan(20);
    expect(libView(co, 'params')[0].disabled).toBe(true);
    expect(searchRows(rows, 'şablonuna uymuyor').map((r) => r.source)).toEqual(['Firma']);
    for (const t of ['structures', 'elements', 'dfmea', 'pfmea', 'params', 'gauges'] as const) expect(libView(co, t).length, t).toBeGreaterThan(0);
  });
});

describe('motorlar firma kaydını kullanır', () => {
  it('DFMEA: firma kaydı gelir; AI Proposed, güven Low, kaynak "Firma kütüphanesi"', () => {
    const lib = mergeLibs(withOps({ upsert: [{ coll: 'dfmea', rec: rec() }] }));
    const g = generate(dfmeaProject(), ['dfmea'], { lib });
    const row = g.p.dfmea.find((r) => r.failureMode.startsWith('Firma özel'))!;
    expect(row).toBeDefined();
    expect(row.failureMode).toContain('Delik çapı');
    expect(row).toMatchObject({ approval: 'AI Proposed', confidence: 'Low', origin: 'template', s: 6, o: 4, d: 5 });
    expect(row.source).toMatch(/Firma kütüphanesi/);
    expect(generate(dfmeaProject(), ['dfmea']).p.dfmea.some((r) => r.failureMode.startsWith('Firma özel'))).toBe(false);
  });
  it('etkin kütüphane ayarlandıysa lib verilmese de kullanılır; varsayılan yerleşiktir', () => {
    const lib = mergeLibs(withOps({ upsert: [{ coll: 'dfmea', rec: rec() }] }));
    setActiveLib(lib);
    expect(generate(dfmeaProject(), ['dfmea']).p.dfmea.some((r) => r.failureMode.startsWith('Firma özel'))).toBe(true);
    setActiveLib(undefined);
    expect(generate(dfmeaProject(), ['dfmea']).p.dfmea.some((r) => r.failureMode.startsWith('Firma özel'))).toBe(false);
  });
  it('DFMEA: eleman türü ve fonksiyon hata tipleri kapsamı', () => {
    const el = rec({ id: 'c:df:el', scopeKind: 'element', scope: 'bracket', failureMode: 'Firma özel eleman modu' });
    const kindKey = elementKind('Braket')!.key;
    const lib = mergeLibs(withOps({ upsert: [{ coll: 'dfmea', rec: { ...el, scope: kindKey } }, { coll: 'dfmea', rec: rec({ id: 'c:df:fn', scope: 'Functional', failureMode: 'Firma özel fonksiyon tipi' }) }] }));
    const g = generate(dfmeaProject(), ['dfmea'], { lib });
    expect(g.p.dfmea.some((r) => r.failureMode === 'Firma özel eleman modu')).toBe(true);
    expect(g.p.dfmea.some((r) => r.failureMode === 'Firma özel fonksiyon tipi')).toBe(true);
  });
  it('devre dışı bırakılan yerleşik kayıt üretilmez, geri açılınca döner', () => {
    const first = DFMEA_LIB.Dimensional[0];
    const id = builtinIndex().dfmea.find((x) => x.t === first)!.id;
    const fm = first.failureMode.replace('{x}', 'Delik çapı');
    expect(generate(dfmeaProject(), ['dfmea']).p.dfmea.some((r) => r.failureMode === fm)).toBe(true);
    const off = withOps({ disable: [id] });
    expect(generate(dfmeaProject(), ['dfmea'], { lib: mergeLibs(off) }).p.dfmea.some((r) => r.failureMode === fm)).toBe(false);
    expect(mergeLibs(off).dfmea.Dimensional).not.toContain(first);
    const on = withOps({ enable: [id] }, off);
    expect(on.disabled).toEqual([]);
    expect(generate(dfmeaProject(), ['dfmea'], { lib: mergeLibs(on) }).p.dfmea.some((r) => r.failureMode === fm)).toBe(true);
  });
  it('PFMEA: alan ve genel (Common) firma kaydı', () => {
    const lib = mergeLibs(withOps({ upsert: [{ coll: 'pfmea', rec: prec() }, { coll: 'pfmea', rec: prec({ id: 'c:pf:common', area: 'Common', failureMode: 'Firma özel genel adım modu' }) }] }));
    const g = generate(pfmeaProject(), ['pfmea'], { lib });
    const a = g.p.pfmea.find((r) => r.failureMode.startsWith('Firma özel: program'))!;
    expect(a).toMatchObject({ approval: 'AI Proposed', confidence: 'Low', origin: 'template' });
    expect(a.source).toMatch(/Firma kütüphanesi/);
    expect(g.p.pfmea.some((r) => r.failureMode === 'Firma özel genel adım modu')).toBe(true);
    expect(generate(pfmeaProject(), ['pfmea']).p.pfmea.some((r) => r.failureMode.startsWith('Firma özel'))).toBe(false);
  });
  it('parametre, ölçüm cihazı ve yapı şablonu', () => {
    const co = withOps({
      upsert: [
        { coll: 'params', rec: { name: 'Özel fırın hızı', match: 'özel fırın', category: 'Speed', unit: 'm/dk', prevention: 'Firma önleme', limitSource: 'Firma prosedürü' } },
        { coll: 'gauges', rec: { name: 'Firma mastar', match: 'firma mastar', gauge: 'Firma geçer-geçmez mastarı', record: 'Mastar formu', controlKind: 'Inspection' } },
        { coll: 'structures', rec: { template: { key: 'firma-x', label: 'Firma ürünü', group: 'Montaj', family: '', hint: '', rootLevel: 'Product', rootFns: [{ text: 'Ürün işlevi', type: 'Diğer' }], elements: [{ key: 'a', name: 'Firma elemanı', level: 'Component', fns: [{ text: 'Eleman işlevi', type: 'Yük aktarma' }] }] } } },
      ],
    });
    const lib = mergeLibs(co);
    expect(paramTemplate('Özel fırın hızı', lib.params)?.prevention).toBe('Firma önleme');
    expect(paramTemplate('Kür sıcaklığı', lib.params)?.key).toBe('cureTemp');
    const v = paramFillValues({ parameter: 'Özel fırın hızı', category: '', unit: '', productCharacteristic: '', prevention: '', monitoring: '', reaction: '', validation: '', notes: '', nominal: null, lsl: null, usl: null }, lib.params);
    expect(v).toMatchObject({ unit: 'm/dk', prevention: 'Firma önleme' });
    expect(v.notes).toMatch(/Firma prosedürü/);
    expect(gaugeFor('firma mastar ile kontrol', lib.gauges)?.gauge).toBe('Firma geçer-geçmez mastarı');
    expect(gaugeFor('firma mastar ile kontrol')?.gauge).not.toBe('Firma geçer-geçmez mastarı');
    const plan = planStructure(newProject(), 'firma-x', undefined, lib);
    expect(plan.rows).toBeGreaterThan(1);
    const g = generate(newProject(), [], { lib });
    expect(g.edits).toEqual([]);
  });
  it('S 9–10 satırlar toplu onaylanamaz kuralı gevşemez: firma satırı yine AI Proposed gelir', () => {
    const lib = mergeLibs(withOps({ upsert: [{ coll: 'dfmea', rec: rec({ s: 10 }) }] }));
    const row = generate(dfmeaProject(), ['dfmea'], { lib }).p.dfmea.find((r) => r.failureMode.startsWith('Firma özel'))!;
    expect(row.s).toBe(10);
    expect(row.approval).toBe('AI Proposed');
  });
});

describe('işlemler ve doğrulama', () => {
  it('upsert / remove / rev; aynı id\'de son yazan kazanır; ekleyen korunur', () => {
    const a = applyOps(emptyCompanyLib(), { upsert: [{ coll: 'dfmea', rec: rec() }] }, { by: 'A', at: '2026-01-01T00:00:00Z' });
    expect(a.lib.rev).toBe(1);
    expect(a.lib.updatedBy).toBe('A');
    const b = applyOps(a.lib, { upsert: [{ coll: 'dfmea', rec: rec({ failureMode: 'Güncel', addedBy: 'B' }) }] }, { by: 'B' });
    expect(b.lib.dfmea).toHaveLength(1);
    expect(b.lib.dfmea[0].failureMode).toBe('Güncel');
    expect(b.lib.dfmea[0].addedBy).toBe(BY);
    expect(b.lib.rev).toBe(2);
    expect(applyOps(b.lib, { remove: [{ coll: 'dfmea', id: 'c:df:test1' }] }, { by: 'B' }).lib.dfmea).toHaveLength(0);
  });
  it('geçersiz kayıtlar reddedilir: S/O/D aralığı, boş hata modu, anahtar benzeri metin, bozuk ifade', () => {
    const r = applyOps(
      emptyCompanyLib(),
      {
        upsert: [
          { coll: 'dfmea', rec: rec({ s: 11 }) },
          { coll: 'dfmea', rec: rec({ id: 'c:x', failureMode: '' }) },
          { coll: 'dfmea', rec: rec({ id: 'c:y', cause: 'api_key = sk-ant-abcdefghijklmnopqrstuvwxyz' }) },
          { coll: 'params', rec: { name: 'P', match: '([' } },
          { coll: 'dfmea', rec: rec({ id: 'c:ok' }) },
        ],
      },
      { by: BY },
    );
    expect(r.lib.dfmea.map((x) => x.id)).toEqual(['c:ok']);
    expect(r.rejected).toHaveLength(4);
  });
  it('bozuk veya eksik dosya içeriği çökmez', () => {
    for (const raw of [null, undefined, 'metin', 42, [], {}, { dfmea: 'x' }, { dfmea: [null, 5, {}], pfmea: [{}], rev: 'abc' }]) {
      const { lib } = validateCompanyLib(raw);
      expect(lib.schema).toBe(1);
      expect(lib.dfmea).toEqual([]);
      expect(lib.rev).toBe(0);
    }
    const w = validateCompanyLib({ schema: 9, rev: 3, dfmea: [rec(), { junk: true }] });
    expect(w.lib.dfmea).toHaveLength(1);
    expect(w.lib.rev).toBe(3);
    expect(w.warnings.join(' ')).toMatch(/daha yeni|geçersiz/);
    expect('error' in cleanRecord('dfmea', 'x')).toBe(true);
  });
  it('dosyaya yalnız bilinen alanlar yazılır (fazladan alan düşer)', () => {
    const lib = withOps({ upsert: [{ coll: 'dfmea', rec: { ...rec(), apiKey: 'gizli', email: 'a@b.c' } }] });
    expect(JSON.stringify(lib)).not.toMatch(/gizli|a@b\.c/);
  });
});

describe('dosya: okuma, yazma, rev çakışması', () => {
  let dir = '';
  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fmea-lib-'));
  });
  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });
  const ops = (id: string, fm = id) => ({ upsert: [{ coll: 'dfmea' as const, rec: rec({ id, failureMode: fm }) }] });

  it('dosya yok → missing + boş kütüphane; klasör yok / seçilmemiş → unreachable (çökmez)', async () => {
    expect((await readLibFile(dir)).status).toBe('missing');
    expect((await readLibFile(path.join(dir, 'yok', 'klasor'))).status).toBe('unreachable');
    expect((await readLibFile('')).status).toBe('unreachable');
    const w = await writeLibFile(path.join(dir, 'yok'), ops('c:1'), 0, BY);
    expect(w.ok).toBe(false);
  });
  it('yazma → okuma; geçici dosya kalmaz; rev artar', async () => {
    const w = await writeLibFile(dir, ops('c:1'), 0, BY);
    expect(w.ok && w.lib.rev).toBe(1);
    expect(w.ok && w.merged).toBe(false);
    const r = await readLibFile(dir);
    expect(r.status).toBe('ok');
    expect(r.lib.dfmea.map((x) => x.id)).toEqual(['c:1']);
    expect((await fs.readdir(dir)).sort()).toEqual([LIB_FILE]);
  });
  it('rev çakışması: ikinci yazıcı eski rev ile yazar → kayıtlar birleşir, merged = true', async () => {
    await writeLibFile(dir, ops('c:1'), 0, 'A');
    const b = await writeLibFile(dir, ops('c:2'), 0, 'B'); // B rev 0'ı okumuştu, dosya artık rev 1
    expect(b.ok && b.merged).toBe(true);
    expect((await readLibFile(dir)).lib.dfmea.map((x) => x.id).sort()).toEqual(['c:1', 'c:2']);
    const c = await writeLibFile(dir, ops('c:2', 'B yeniden'), 2, 'B'); // güncel rev ile
    expect(c.ok && c.merged).toBe(false);
    expect((await readLibFile(dir)).lib.dfmea.find((x) => x.id === 'c:2')!.failureMode).toBe('B yeniden');
  });
  it('aynı anda 8 yazıcı: hiçbir kayıt kaybolmaz', async () => {
    const res = await Promise.all(Array.from({ length: 8 }, (_, i) => writeLibFile(dir, ops(`c:${i}`), 0, `U${i}`)));
    expect(res.every((x) => x.ok)).toBe(true);
    const lib = (await readLibFile(dir)).lib;
    expect(lib.dfmea).toHaveLength(8);
    expect(lib.rev).toBe(8);
    expect((await fs.readdir(dir)).sort()).toEqual([LIB_FILE]);
  });
  it('bozuk dosya: okuma corrupt döner; yazma bozuk dosyayı yedekleyip devam eder', async () => {
    await fs.writeFile(path.join(dir, LIB_FILE), '{ bozuk json', 'utf8');
    const r = await readLibFile(dir);
    expect(r.status).toBe('corrupt');
    expect(r.lib.dfmea).toEqual([]);
    const w = await writeLibFile(dir, ops('c:1'), 0, BY);
    expect(w.ok).toBe(true);
    const files = await fs.readdir(dir);
    expect(files.some((f) => f.startsWith('fmea-kutuphane.bozuk-'))).toBe(true);
    expect((await readLibFile(dir)).status).toBe('ok');
  });
  it('daha yeni şemalı dosyanın üzerine yazılmaz', async () => {
    await fs.writeFile(path.join(dir, LIB_FILE), JSON.stringify({ schema: 99, rev: 5 }), 'utf8');
    const w = await writeLibFile(dir, ops('c:1'), 5, BY);
    expect(w.ok).toBe(false);
    expect(JSON.parse(await fs.readFile(path.join(dir, LIB_FILE), 'utf8')).schema).toBe(99);
  });
  it('devre dışı bırakma dosyada saklanır', async () => {
    const id = builtinIndex().gauges[0].id;
    await writeLibFile(dir, { disable: [id] }, 0, BY);
    expect((await readLibFile(dir)).lib.disabled).toEqual([id]);
  });
});

describe('onaylı satırdan kayıt', () => {
  function approvedProject(): Project {
    let p = dfmeaProject();
    p = apply(p, [{ kind: 'add', table: 'dfmea', row: { ...blankRow('dfmea', 'DF-001'), id: 'DF-001', functionId: 'FN-001', reqIds: ['REQ-001'], failureMode: 'Delik çapı 12,5 mm ±0,1 üst limitin üzerinde (REQ-001)', effect: 'Montaj uyumsuz, 0,3 mm boşluk', cause: 'Matkap aşınması', prevention: 'Takım ömrü takibi', detection: 'Çap kontrolü, FAI AS9102', s: 7, o: 4, d: 5, approval: 'Approved' } }]);
    p = apply(p, [{ kind: 'add', table: 'dfmea', row: { ...blankRow('dfmea', 'DF-002'), id: 'DF-002', functionId: 'FN-001', reqIds: ['REQ-001'], failureMode: 'Taslak mod', s: 5, o: 5, d: 5, approval: 'AI Proposed' } }]);
    p.meta.partNumber = 'PRJ-123';
    return p;
  }
  it('proje özel sayılar ve ID\'ler ayıklanır; kodlardaki rakamlar kalır; kaynak proje yazılır', () => {
    const r = recordsFromApproved(approvedProject(), 'dfmea', ['DF-001', 'DF-002'], { by: BY });
    expect(r.records).toHaveLength(1);
    expect(r.skipped).toEqual([{ id: 'DF-002', reason: expect.stringMatching(/onaylı değil/) }]);
    const c = r.records[0].rec as CoDfmea;
    expect(c.failureMode).toBe('{x} üst limitin üzerinde');
    expect(c.effect).toBe('Montaj uyumsuz, boşluk');
    expect(c.detection).toContain('AS9102');
    expect(c.sourceProject).toBe('PRJ-123');
    expect(c).toMatchObject({ scopeKind: 'element', s: 7, o: 4, d: 5, addedBy: BY });
    expect(/REQ-|12,5|±/.test(JSON.stringify(c))).toBe(false);
  });
  it('kütüphaneye eklenince motor kullanır; ikinci kez eklenirse "zaten var" olarak atlanır', () => {
    const p = approvedProject();
    const first = recordsFromApproved(p, 'dfmea', ['DF-001']);
    const co = withOps({ upsert: first.records.map((x) => ({ coll: x.coll, rec: x.rec })) });
    const again = recordsFromApproved(p, 'dfmea', ['DF-001'], { existing: co });
    expect(again.records).toHaveLength(0);
    expect(again.skipped[0].reason).toMatch(/zaten var/);
    const g = generate(dfmeaProject('Braket'), ['dfmea'], { lib: mergeLibs(co) });
    expect(g.p.dfmea.some((r) => /üst limitin üzerinde/.test(r.failureMode) && /Firma kütüphanesi/.test(r.source))).toBe(true);
  });
  it('PFMEA satırı: alan çıkarılır, sayılar ayıklanır, onaysızlar eklenmez', () => {
    let p = pfmeaProject('CNC frezeleme');
    p = apply(p, [{ kind: 'add', table: 'pfmea', row: { ...blankRow('pfmea', 'PF-001'), id: 'PF-001', stepId: 'OP-001', failureMode: 'Çap 25,4 mm toleransı dışında', effect: 'Hurda', cause: 'Takım aşınması', cause4M: 'Machine', prevention: 'Takım ömrü sayacı', detection: 'Mikrometre', s: 6, o: 3, d: 4, approval: 'Engineer Reviewed' } }]);
    p = apply(p, [{ kind: 'add', table: 'pfmea', row: { ...blankRow('pfmea', 'PF-002'), id: 'PF-002', stepId: 'OP-001', failureMode: 'Başka', s: 5, o: 5, d: 5, approval: 'AI Proposed' } }]);
    const r = recordsFromApproved(p, 'pfmea', ['PF-001', 'PF-002']);
    expect(r.records).toHaveLength(1);
    const c = r.records[0].rec as CoPfmea;
    expect(c.area).toBe('Metal Machining');
    expect(c.failureMode).toBe('Çap toleransı dışında');
    expect(c.cause4M).toBe('Machine');
    expect(r.skipped.map((x) => x.id)).toEqual(['PF-002']);
    expect((p.pfmea.find((x) => x.id === 'PF-001') as PfmeaRow).approval).toBe('Engineer Reviewed');
  });
  it('scrubText', () => {
    expect(scrubText('Çap 25,4 mm ±0,05 dışında')).toBe('Çap dışında');
    expect(scrubText('Sıcaklık 120 °C altında (FN-003)')).toBe('Sıcaklık altında');
    expect(scrubText('M8 cıvata, 6061-T6, AS9102, 3B tarama')).toBe('M8 cıvata, 6061-T6, AS9102, 3B tarama');
    expect(scrubText('Delik çapı üst limit', ['Delik çapı'])).toBe('{x} üst limit');
  });
  it('eski örnek kütüphanesi satırları firma kaydına taşınır', () => {
    const rows = [
      { kind: 'pfmea' as const, project: 'P1', context: '[Machining] CNC → Frezeler', failureMode: 'Ölçü 10 mm dışı', effect: 'Hurda', cause: 'Takım', rootCause: '', prevention: 'Ömür', detection: 'Ölçüm', errorProofing: '', s: 5, o: 3, d: 4 },
      { kind: 'dfmea' as const, project: 'P1', context: 'Braket → Yük taşır', failureMode: 'Kırılma', effect: 'Kayıp', cause: 'Yorulma', rootCause: '', prevention: 'FEA', detection: 'Test', errorProofing: '', s: 9, o: 3, d: 4 },
      { kind: 'dfmea' as const, project: 'P1', context: 'x', failureMode: '', effect: '', cause: '', rootCause: '', prevention: '', detection: '', errorProofing: '', s: 1, o: 1, d: 1 },
    ];
    const out = recordsFromExamples(rows, BY);
    expect(out.map((x) => x.coll)).toEqual(['pfmea', 'dfmea']);
    expect((out[0].rec as CoPfmea).area).toBe('Machining');
    expect((out[0].rec as CoPfmea).failureMode).toBe('Ölçü dışı');
  });
});

describe('Excel içe / dışa aktarma', () => {
  it('sekme başına bir sayfa; dışa aktar → içe al aynı firma kayıtlarını verir', async () => {
    const co = withOps({
      upsert: [
        { coll: 'dfmea', rec: rec() },
        { coll: 'dfmea', rec: rec({ id: 'c:df:el', scopeKind: 'element', scope: elementKind('Braket')!.key, failureMode: 'Eleman modu' }) },
        { coll: 'pfmea', rec: prec() },
        { coll: 'params', rec: { id: 'c:pr:1', name: 'Özel hız', match: 'özel hız', unit: 'm/dk', limitSource: 'Firma prosedürü' } },
        { coll: 'gauges', rec: { id: 'c:gg:1', name: 'Mastar', match: 'mastar', gauge: 'Mastar', record: 'Form', controlKind: 'Inspection' } },
        { coll: 'structures', rec: { id: 'c:st:1', template: { key: 'fx', label: 'Firma ürünü', group: 'Montaj', family: 'metal', hint: 'ipucu', rootLevel: 'Product', rootFns: [{ text: 'Ürün işlevi', type: 'Diğer' }], elements: [{ key: 'a', name: 'Eleman A', level: 'Component', fns: [{ text: 'İşlev 1', type: 'Yük aktarma' }, { text: 'İşlev 2', type: 'Bağlantı' }], match: 'eleman a' }] } } },
      ],
      disable: [builtinIndex().gauges[0].id],
    });
    const wb = buildLibWorkbook(co);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Yapı şablonları', 'Eleman DFMEA', 'DFMEA gereksinim tipi', 'PFMEA alanları', 'Parametreler', 'Ölçüm - Kontrol Planı']);
    // gerçek dosya gibi: belleğe yazıp yeniden oku
    const buf = await wb.xlsx.writeBuffer();
    const ExcelJS = (await import('exceljs')).default;
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(buf as ArrayBuffer);
    const imp = parseLibWorkbook(wb2);
    expect(imp.warnings).toEqual([]);
    expect(imp.ops.disable).toEqual([builtinIndex().gauges[0].id]);
    const back = applyOps(emptyCompanyLib(), imp.ops, { by: BY }).lib;
    expect(back.dfmea.map((x) => x.id).sort()).toEqual(['c:df:el', 'c:df:test1']);
    expect(back.dfmea.find((x) => x.id === 'c:df:test1')).toMatchObject({ failureMode: rec().failureMode, s: 6, o: 4, d: 5, scopeKind: 'reqType', scope: 'Dimensional' });
    expect(back.pfmea[0]).toMatchObject({ id: 'c:pf:test1', area: 'Metal Machining', cause4M: 'Method' });
    expect(back.params[0]).toMatchObject({ name: 'Özel hız', unit: 'm/dk', limitSource: 'Firma prosedürü' });
    expect(back.gauges[0]).toMatchObject({ gauge: 'Mastar', controlKind: 'Inspection' });
    const st = back.structures[0].template;
    expect(st).toMatchObject({ key: 'fx', label: 'Firma ürünü', family: 'metal' });
    expect(st.rootFns).toHaveLength(1);
    expect(st.elements[0].fns).toHaveLength(2);
    expect(st.elements[0].match).toBe('eleman a');
    expect(imp.counts).toMatchObject({ dfmea: 1, elements: 1, pfmea: 1, params: 1, gauges: 1, structures: 1 });
  });
  it('Excel\'de yeni satır eklemek (ID boş) yeni kayıt yaratır; yerleşik satırın metni değiştirilse bile kayıt olmaz', async () => {
    const wb = buildLibWorkbook(emptyCompanyLib());
    const ws = wb.getWorksheet('Parametreler')!;
    ws.addRow(['Firma', 'Etkin', '', 'Yeni parametre', 'yeni parametre', 'Time', 'dk']);
    ws.getRow(2).getCell(5).value = 'DEĞİŞTİRİLDİ'; // yerleşik satır
    const imp = parseLibWorkbook(wb);
    const co = applyOps(emptyCompanyLib(), imp.ops, { by: BY }).lib;
    expect(co.params).toHaveLength(1);
    expect(co.params[0]).toMatchObject({ name: 'Yeni parametre', unit: 'dk' });
    expect(co.params[0].id).toMatch(/^c:/);
  });
  it('eksik sütunlu sayfa uyarı verir, çökmez', async () => {
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Parametreler').addRow(['Alakasız']);
    const imp = parseLibWorkbook(wb);
    expect(imp.warnings.join(' ')).toMatch(/sütun eksik/);
    expect(imp.ops.upsert).toEqual([]);
  });
});
