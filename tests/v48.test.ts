import { describe, expect, it } from 'vitest';
import { secondCheck } from '../src/shared/aiSecondCheck';
import { generate } from '../src/shared/autogen';
import { CAPABILITIES, controlCatalogue, costContext, measureOf, rankMeasures, PREVENTION_4M } from '../src/shared/controlCost';
import { coverageGaps } from '../src/shared/coverage';
import { planEdits, type Edit } from '../src/shared/engine';
import { PFMEA_ALT_CAUSES, PFMEA_LIB, PFMEA_STEP_COMMON } from '../src/shared/failureLib';
import { blankRow, newProject } from '../src/shared/model';
import { SCREENS, visibleScreens } from '../src/shared/nav';
import { buildProposals } from '../src/shared/proposals';
import type { DfmeaRow, PfmeaRow, Project } from '../src/shared/types';

const apply = (p: Project, edits: unknown[]) => planEdits(p, edits as Edit[], true).project;
const step = (id: string, name: string) => ({ kind: 'add', table: 'processSteps', row: { ...blankRow('processSteps', id), id, opNo: '10', name } });

describe('4.8.0 hata modu başına birden fazla neden (4M)', () => {
  it('ek neden tablosundaki her anahtar kütüphanede gerçek bir hata modudur', () => {
    const modes = new Set([...Object.values(PFMEA_LIB).flat(), ...PFMEA_STEP_COMMON].map((t) => t.failureMode));
    for (const k of Object.keys(PFMEA_ALT_CAUSES)) expect(modes.has(k), k).toBe(true);
    for (const alts of Object.values(PFMEA_ALT_CAUSES)) for (const a of alts) expect(['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment']).toContain(a.cause4M);
  });

  it('bir hata modu birden çok 4M nedeniyle ayrı satırlar olarak gelir; tekrar çalıştırma çoğaltmaz', () => {
    let p = newProject();
    p.settings.productType = 'Metal';
    p = apply(p, [step('OP-001', 'Lazer kesim')]);
    p = apply(p, generate(p, ['pfmea']).edits);
    const rows = p.pfmea.filter((r) => r.stepId === 'OP-001' && r.failureMode === 'Kesim kenarında çapak / cüruf');
    expect(rows.length).toBeGreaterThanOrEqual(3);
    expect(new Set(rows.map((r) => r.cause)).size).toBe(rows.length); // her satır farklı neden
    expect(new Set(rows.map((r) => r.cause4M)).size).toBeGreaterThanOrEqual(2);
    expect(rows.every((r) => r.effect && r.detection && r.prevention && r.s && r.o && r.d && r.approval === 'AI Proposed')).toBe(true);
    expect(generate(p, ['pfmea']).edits).toHaveLength(0);
  });
});

describe('4.8.0 firma imkânları ve geçmişten öğrenme', () => {
  it('işaretli imkânla yapılabilen yöntem Düşük sayılır ve öne geçer', () => {
    const base = rankMeasures(PREVENTION_4M.Material, { severity: 5 });
    expect(base[base.length - 1].text).toMatch(/Barkod/);
    const withCap = rankMeasures(PREVENTION_4M.Material, { severity: 5, ctx: { capabilities: ['barcode'] } });
    const bc = withCap.find((m) => /Barkod/.test(m.text))!;
    expect(bc.cost).toBe(1);
    expect(bc.note).toMatch(/firma imkânı/);
    expect(CAPABILITIES.find((c) => c.id === 'barcode')!.re.test('barkodla malzeme doğrulama')).toBe(true);
  });

  it('onaylı satırlardaki yöntemler kataloğa girer ve bir sınıf ucuzlar; onaysız satır saymaz', () => {
    const p = newProject();
    p.pfmea.push({ ...(blankRow('pfmea', 'PF-001') as PfmeaRow), approval: 'Approved', prevention: 'Parametre izleme + alarm / interlock; İş talimatı', errorProofing: 'Poka-yoke', detection: 'CMM ölçümü' });
    p.pfmea.push({ ...(blankRow('pfmea', 'PF-002') as PfmeaRow), approval: 'AI Proposed', prevention: 'Lazer projeksiyon' });
    const cat = controlCatalogue(p);
    expect(cat.find((e) => e.kind === 'Önleme' && /interlock/.test(e.text))!.count).toBe(1);
    expect(cat.some((e) => /Lazer/.test(e.text))).toBe(false);
    expect(cat.some((e) => e.kind === 'Tespit')).toBe(true);
    const ctx = costContext(p);
    const m = rankMeasures([measureOf('Parametre izleme + alarm / interlock')], { ctx })[0];
    expect(m.cost).toBe(2); // Yüksek(3) → Orta(2)
    expect(m.note).toMatch(/onaylı satırlarda/);
  });

  it('aksiyon metni imkâna göre sıralanır ve beklenen etkiyi tahmin olarak belirtir', () => {
    const mk = (caps: string[]) => {
      const p = newProject();
      p.settings.companyCapabilities = caps;
      p.processSteps.push({ ...(blankRow('processSteps', 'OP-001') as Project['processSteps'][number]), opNo: '10', name: 'Montaj' });
      p.pfmea.push({ ...(blankRow('pfmea', 'PF-001') as PfmeaRow), stepId: 'OP-001', failureMode: 'Yanlış / eksik bağlantı elemanı', cause: 'Benzer parçalar karışıyor', cause4M: 'Material', prevention: 'Kitleme', detection: 'Görsel', s: 6, o: 6, d: 3 });
      return planEdits(p, [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 's', value: 7 }]).project.pfmea[0].recommendedAction;
    };
    const none = mk([]);
    const withBarcode = mk(['barcode']);
    expect(none).toMatch(/Beklenen etki: oluşumun \(O\) iyileşmesi hedeflenir; yeni puanı .* mühendis girer/);
    expect(none).not.toMatch(/O 6→|RPN \d+→/); // türetilmiş sayı yazılmaz
    expect(withBarcode).toMatch(/firma imkânı: Barkod/);
    expect(none).not.toMatch(/firma imkânı/);
  });
});

describe('4.8.0 DFMEA önleme seçenekleri hata moduna özel', () => {
  it('yorulma modu için kütüphanedeki yorulma önlemi aday olur', () => {
    const p = newProject();
    p.dfmea.push({ ...(blankRow('dfmea', 'DF-001') as DfmeaRow), failureMode: 'Braket yorulma ömrü yetersiz', cause: 'Yük spektrumu ve yorulma analizi eksik', prevention: '', detection: 'Yorulma testi', s: 8, o: 6, d: 3 });
    const r = planEdits(p, [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }]).project.dfmea[0];
    expect(r.recommendedAction).toMatch(/benzer ürün saha verisi|benzer tasarım verisi|Güvenilirlik analizi/); // yorulma / ömür kütüphane önlemleri, genel listeden önce
    expect(r.recommendedAction).not.toMatch(/Tasarım kontrol listesi/);
  });
});

describe('4.8.0 AI satırlarının otomatik ikinci kontrolü', () => {
  it('mantık, kontrol gücü ve puan tutarsızlıklarını yakalar', () => {
    const w = secondCheck({ failureMode: 'Delik büyük', effect: 'Delik büyük', cause: 'operatör hatası', prevention: 'Operatör dikkat', detection: '', s: 9, o: 2, d: 2 }, 'pfmea').join('\n');
    expect(w).toMatch(/etki, hata moduyla aynı/);
    expect(w).toMatch(/operatör hatası/);
    expect(w).toMatch(/4M kategorisi/);
    expect(w).toMatch(/tespit kontrolü yok/);
    expect(w).toMatch(/belirsiz/);
    expect(w).toMatch(/O ve D çok düşük/);
    expect(w).toMatch(/yalnız idari/);
  });
  it('temiz satırda uyarı yok; proposals içine eklenir', () => {
    const ok = { failureMode: 'Ölçü dışı', effect: 'Montaj uyumsuzluğu', cause: 'Takım aşınması', cause4M: 'Machine', prevention: 'Takım ömrü sayacı', errorProofing: 'Software parameter lock', detection: 'CMM', s: 6, o: 4, d: 4 };
    expect(secondCheck(ok, 'pfmea')).toEqual([]);
    const set = buildProposals(newProject(), 'pfmea', { rows: [{ ...ok, cause: '', evidence: [], confidence: 'Medium', basis: 'ENGINEERING KNOWLEDGE' }] }, { mode: 'strict' } as never, { inputs: '' });
    expect(set.items[0].warnings.some((x) => /2\. kontrol: neden boş/.test(x))).toBe(true);
  });
});

describe('4.8.0 kapsam denetimi', () => {
  it('eksik hata tipleri ve 4M kategorileri listelenir; kütüphane önerisi sonrası azalır', () => {
    let p = newProject();
    p = apply(p, [step('OP-001', 'Çapak alma'), step('OP-002', 'Montaj'),
      { kind: 'add', table: 'pfmea', row: { ...blankRow('pfmea', 'PF-001'), id: 'PF-001', stepId: 'OP-001', failureMode: 'Çapak kalıyor', cause4M: 'Man' } }]);
    const g0 = coverageGaps(p);
    expect(g0.find((g) => g.id === 'OP-002')!.missing).toContain('hiç PFMEA satırı yok');
    expect(g0.find((g) => g.id === 'OP-001')!.missing.join()).toMatch(/atlandı/);
    const n0 = g0.reduce((a, g) => a + g.missing.length, 0);
    p = apply(p, generate(p, ['pfmea']).edits);
    const g1 = coverageGaps(p);
    expect(g1.reduce((a, g) => a + g.missing.length, 0)).toBeLessThan(n0);
    expect(g1.find((g) => g.id === 'OP-002')).toBeUndefined();
  });
});

describe('4.8.0 menü görünümü', () => {
  it('varsayılanda hepsi görünür; sade menü gelişmiş ekranları, hiddenScreens seçilenleri gizler; açık ekran kalır', () => {
    expect(visibleScreens({}, 'dashboard')).toHaveLength(SCREENS.length);
    const simple = visibleScreens({ simpleMenu: true }, 'dashboard').map((s) => s.key);
    for (const k of ['apqp', 'ppap', 'msa', 'capability', 'lessons', 'impact', 'baseline', 'approval']) expect(simple).not.toContain(k);
    for (const k of ['dashboard', 'requirements', 'dfmea', 'pfmea', 'controlPlan', 'actions', 'settings']) expect(simple).toContain(k);
    expect(visibleScreens({ simpleMenu: true }, 'ppap').map((s) => s.key)).toContain('ppap');
    expect(visibleScreens({ hiddenScreens: ['kcs'] }, 'dashboard').map((s) => s.key)).not.toContain('kcs');
    expect(newProject().settings.simpleMenu).toBe(true);
  });
});

describe('4.8.0 denetim düzeltmeleri', () => {
  it('4.7.0 projesinde (yalnız ana satırlar) ek nedenler sonradan tamamlanır, tekrar çalıştırma çoğaltmaz', () => {
    let p = newProject();
    p.settings.productType = 'Metal';
    p = apply(p, [step('OP-001', 'Lazer kesim')]);
    p = apply(p, generate(p, ['pfmea']).edits);
    // 4.7.0 durumu: yalnız ana nedenli satırları bırak
    const main = new Set(Object.values(PFMEA_ALT_CAUSES).flat().map((a) => a.cause));
    p.pfmea = p.pfmea.filter((r) => !main.has(r.cause));
    const before = p.pfmea.length;
    const g = generate(p, ['pfmea']);
    expect(g.edits.length).toBeGreaterThan(0);
    p = apply(p, g.edits);
    expect(p.pfmea.length).toBeGreaterThan(before);
    expect(generate(p, ['pfmea']).edits).toHaveLength(0);
  });

  it('imkân desenleri dar: interlock, otomatik ölçüm ve kalibrasyon programı yanlış sayılmaz', () => {
    const caps = (cap: string, text: string) => rankMeasures([measureOf(text)], { ctx: { capabilities: [cap] } })[0];
    expect(caps('recipe', 'Sensörlü varlık / sayım kontrolü (interlock)').cost).toBe(3);
    expect(caps('gauge', 'Otomatik ölçüm').cost).toBe(4);
    expect(caps('recipe', 'Kalibrasyon programı ve ölçüm talimatı').cost).toBe(2); // recipe imkânı kalibrasyonu ucuzlatmaz
    expect(caps('recipe', 'Reçete / parametre kilidi (yazılım)').cost).toBe(1);
    expect(caps('recipe', 'Reçete kilidi (software parameter lock)').cost).toBe(1);
    expect(caps('gauge', 'Go/No-go mastar').cost).toBe(1);
  });

  it('settings ve dashboard gizlenemez; dizi olmayan imkân listesi hata vermez', () => {
    expect(() => costContext({ settings: { companyCapabilities: 'fixture' as never } })).not.toThrow();
    const keys = visibleScreens({ hiddenScreens: ['settings', 'dashboard'] }, 'pfmea').map((s) => s.key);
    expect(keys).toContain('settings');
    expect(keys).toContain('dashboard');
    expect(() => rankMeasures([measureOf('Fikstür')], { ctx: { capabilities: 'fixture' as never } })).not.toThrow();
  });

  it('büyük projede aksiyon metni üretimi hızlı (katalog satır başına yeniden kurulmaz)', () => {
    const p = newProject();
    p.processSteps.push({ ...(blankRow('processSteps', 'OP-001') as Project['processSteps'][number]), opNo: '10', name: 'Montaj' });
    for (let i = 0; i < 700; i++)
      p.pfmea.push({ ...(blankRow('pfmea', `PF-${i}`) as PfmeaRow), stepId: 'OP-001', failureMode: `Mod ${i}`, cause: `Neden ${i}`, cause4M: 'Method', approval: 'Approved', prevention: `Önleme ${i}; Fikstür ${i % 20}`, detection: 'Görsel', s: 7, o: 6, d: 5 });
    const t0 = Date.now();
    const q = planEdits(p, [{ kind: 'settings', field: 'rpnThreshold', value: 50 }]).project;
    expect(q.pfmea.filter((r) => r.recommendedAction).length).toBe(700);
    expect(Date.now() - t0).toBeLessThan(2500);
  });
});
