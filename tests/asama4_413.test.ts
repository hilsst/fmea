// 4.13.0: hücre içi öneriler, eksik gereksinim kontrol listesi, benzer projeden başlama.
import { describe, expect, it } from 'vitest';
import { generate } from '../src/shared/autogen';
import { cellSuggestions, canSuggest } from '../src/shared/cellSuggest';
import { applyOps, emptyCompanyLib, mergeLibs } from '../src/shared/companyLib';
import { planEdits, type Edit } from '../src/shared/engine';
import { blankRow, newProject } from '../src/shared/model';
import { CHECKLIST_TYPES, checkRequirements, itemsFor, placeholderReq } from '../src/shared/reqChecklist';
import { withSimilarProject } from '../src/shared/similarStart';
import type { DfmeaRow, PfmeaRow, Project } from '../src/shared/types';

const apply = (p: Project, edits: unknown[]) => planEdits(p, edits as Edit[], true).project;

function project(): Project {
  let p = newProject();
  p = apply(p, [{ kind: 'add', table: 'requirements', row: { ...blankRow('requirements', 'REQ-001'), id: 'REQ-001', text: 'Delik çapı fonksiyonel', reqType: 'Dimensional', characteristic: 'Delik çapı', approval: 'Approved' } }]);
  p = apply(p, [{ kind: 'add', table: 'structure', row: { ...blankRow('structure', 'FN-001'), id: 'FN-001', level: 'Component', element: 'Braket', function: 'Arayüz sağlar', functionType: 'Geometrik uyum', reqIds: ['REQ-001'], approval: 'Approved' } }]);
  p = apply(p, [{ kind: 'add', table: 'processSteps', row: { ...blankRow('processSteps', 'OP-001'), id: 'OP-001', opNo: '10', name: 'CNC frezeleme' } }]);
  return p;
}

describe('hücre içi öneri', () => {
  it('yalnız tanımlı alanlarda öneri sunar', () => {
    expect(canSuggest('dfmea', 'cause')).toBe(true);
    expect(canSuggest('dfmea', 's')).toBe(false);
    expect(canSuggest('requirements', 'text')).toBe(false);
  });
  it('DFMEA hata modu önerileri bağlama uyar ve mevcut modlar çıkarılır', () => {
    const g = generate(project(), ['dfmea']);
    const p = g.p;
    const row = p.dfmea[0] as DfmeaRow;
    const all = cellSuggestions(p, 'dfmea', { ...row, failureMode: '' }, 'failureMode');
    expect(all.length).toBeGreaterThan(0);
    // satırdaki hata modu kendi başına önerilmez; diğer satırların modları da önerilmez
    expect(all.map((s) => s.text)).not.toContain(p.dfmea[1].failureMode);
  });
  it('neden / önlem önerisi hata moduna göre gelir; hata modu boşsa boş döner', () => {
    const p = generate(project(), ['dfmea']).p;
    const row = p.dfmea[0] as DfmeaRow;
    expect(cellSuggestions(p, 'dfmea', { ...row, failureMode: '' }, 'cause')).toEqual([]);
    const s = cellSuggestions(p, 'dfmea', { ...row, cause: '' }, 'cause');
    expect(s.map((x) => x.text)).toContain(row.cause);
  });
  it('PFMEA: ek nedenler ve firma kaydı işaretlenir', () => {
    const p = generate(project(), ['pfmea']).p;
    const row = p.pfmea.find((r) => r.failureMode)! as PfmeaRow;
    const s = cellSuggestions(p, 'pfmea', { ...row, cause: '' }, 'cause');
    expect(s.length).toBeGreaterThan(0);
    const co = applyOps(emptyCompanyLib(), { upsert: [{ coll: 'pfmea', rec: { id: 'c:pf:x', addedBy: 'T', addedAt: 'x', area: 'Metal Machining', cause4M: 'Method', rootCause: '', errorProofing: '', failureMode: row.failureMode, effect: 'e', cause: 'Firma özel neden metni', prevention: 'p', detection: 'd', s: 5, o: 3, d: 4 } }] } as never, { by: 'T' }).lib;
    const s2 = cellSuggestions(p, 'pfmea', { ...row, cause: '' }, 'cause', mergeLibs(co));
    expect(s2.some((x) => x.text === 'Firma özel neden metni' && x.company)).toBe(true);
  });
  it('yerleşik öneri metinlerinde rakam yoktur (sayısal değer uydurulmaz)', () => {
    const p = generate(project(), ['dfmea', 'pfmea']).p;
    for (const f of ['failureMode', 'effect', 'cause', 'prevention', 'detection']) {
      for (const r of [p.dfmea[0] as DfmeaRow, p.pfmea[0] as unknown as DfmeaRow]) {
        const t = p.dfmea.includes(r) ? 'dfmea' : 'pfmea';
        for (const s of cellSuggestions(p, t, { ...r, [f]: '' } as DfmeaRow, f)) expect(/\d/.test(s.text), s.text).toBe(false);
      }
    }
  });
});

describe('eksik gereksinim kontrol listesi', () => {
  it('ürün tipine göre kalem ekler; yinelenen anahtar yok; metinlerde rakam yok', () => {
    for (const t of CHECKLIST_TYPES) {
      const its = itemsFor(t);
      expect(new Set(its.map((i) => i.key)).size).toBe(its.length);
      for (const i of its) expect(/\d/.test(i.label + i.why), i.label).toBe(false);
    }
    expect(itemsFor('Radome').some((i) => i.key === 'rf')).toBe(true);
    expect(itemsFor('Metallic Part').some((i) => i.key === 'heat')).toBe(true);
    expect(itemsFor('General').length).toBeLessThan(itemsFor('Radome').length);
  });
  it('mevcut gereksinim konuyu karşılar, reddedilen sayılmaz', () => {
    const p = project();
    const r = checkRequirements(p, 'General');
    expect(r.find((x) => x.item.key === 'dim')!.found).toEqual(['REQ-001']);
    expect(r.find((x) => x.item.key === 'mat')!.found).toEqual([]);
    const rej = { ...p, requirements: p.requirements.map((q) => ({ ...q, approval: 'Rejected' as const })) };
    expect(checkRequirements(rej, 'General').find((x) => x.item.key === 'dim')!.found).toEqual([]);
  });
  it('yer tutucu gereksinim AI Proposed, Low ve VERİ YOK taşır', () => {
    const it = itemsFor('General')[0];
    const ph = placeholderReq(it, 'General');
    expect(ph.approval).toBe('AI Proposed');
    expect(ph.confidence).toBe('Low');
    expect(ph.acceptance).toMatch(/VERİ YOK/);
  });
});

describe('benzer projeden başla', () => {
  it('yalnız onaylı satırlar alınır; satırlar firma kaydı + kaynak proje ile AI Proposed gelir', () => {
    // kaynak proje: bir satırı onaylı
    const src = generate(project(), ['dfmea']).p;
    src.meta.partNumber = 'BENZER-1';
    const first = src.dfmea[0];
    const approved = { ...src, dfmea: src.dfmea.map((r) => (r.id === first.id ? { ...r, approval: 'Approved' as const, failureMode: 'Benzer projeye özel hata modu', cause: 'Benzer neden metni' } : r)) };
    const plan = withSimilarProject(undefined, approved);
    expect(plan.dfmea).toBe(1);
    expect(plan.pfmea).toBe(0);
    expect(plan.project).toBe('BENZER-1');
    const target = project();
    const g = generate(target, ['structure', 'dfmea'], { lib: plan.lib });
    const row = g.p.dfmea.find((r) => r.failureMode.includes('Benzer projeye özel'));
    expect(row).toBeTruthy();
    expect(row!.approval).toBe('AI Proposed');
    expect(row!.confidence).toBe('Low');
    expect(row!.source).toContain('Firma kütüphanesi (kaynak proje: BENZER-1)');
  });
  it('onaylı satır yoksa kütüphane yerleşikle aynı kalır', () => {
    const plan = withSimilarProject(undefined, generate(project(), ['dfmea', 'pfmea']).p);
    expect(plan.dfmea + plan.pfmea).toBe(0);
    expect(generate(project(), ['dfmea'], { lib: plan.lib }).edits.length).toBe(generate(project(), ['dfmea']).edits.length);
  });
});
