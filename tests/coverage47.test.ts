import { describe, expect, it } from 'vitest';
import { generate } from '../src/shared/autogen';
import { costTierOf, rankMeasures, measureOf, PREVENTION_4M, strengthOf } from '../src/shared/controlCost';
import { planEdits, type Edit } from '../src/shared/engine';
import { DFMEA_LIB, PFMEA_LIB } from '../src/shared/failureLib';
import { blankRow, newProject } from '../src/shared/model';
import { needsAction } from '../src/shared/risk';
import { AI_REC } from '../src/shared/rpnAction';
import type { DfmeaRow, PfmeaRow, Project } from '../src/shared/types';

const apply = (p: Project, edits: unknown[]) => planEdits(p, edits as Edit[], true).project;
const step = (id: string, name: string) => ({ kind: 'add', table: 'processSteps', row: { ...blankRow('processSteps', id), id, opNo: '10', name } });

describe('4.7.0 adım / fonksiyon başına tüm hata modları', () => {
  it('her kütüphane alanında birden fazla hata modu vardır', () => {
    for (const [k, v] of Object.entries({ ...DFMEA_LIB, ...PFMEA_LIB })) expect(v.length, k).toBeGreaterThan(1);
  });

  it('PFMEA: adımda tek satır olsa da eksik modlar ve genel adım modları eklenir; tekrar çalıştırma yeni satır üretmez', () => {
    let p = newProject();
    p.settings.productType = 'Metal';
    p = apply(p, [step('OP-001', 'Lazer kesim'), step('OP-002', 'Çapak alma'),
      { kind: 'add', table: 'pfmea', row: { ...blankRow('pfmea', 'PF-001'), id: 'PF-001', stepId: 'OP-001', failureMode: 'Kesim ölçüsü / kontur tolerans dışı', cause: 'Elle girildi' } }]);
    p = apply(p, generate(p, ['pfmea']).edits);
    const cut = p.pfmea.filter((r) => r.stepId === 'OP-001').map((r) => r.failureMode);
    expect(cut.filter((m) => m === 'Kesim ölçüsü / kontur tolerans dışı')).toHaveLength(1); // mevcut satır tekrarlanmadı
    expect(p.pfmea.find((r) => r.id === 'PF-001')!.cause).toBe('Elle girildi'); // ve değişmedi
    for (const m of ['Kesim kenarında çapak / cüruf', 'Yanlış malzeme / kalınlıkta levha kesiliyor', 'Isıdan etkilenen bölge / kenar sertleşmesi'])
      expect(cut).toContain(m);
    expect(cut.some((m) => /Operasyon atlanıyor/.test(m))).toBe(true);
    expect(cut.some((m) => /Yanlış parça/.test(m))).toBe(true);
    expect(cut.some((m) => /Elleçleme/.test(m))).toBe(true);
    // alt / üst limit modları ayrı satırlardır
    expect(cut.filter((m) => /alt limitin altında/.test(m)).length).toBe(cut.filter((m) => /üst limitin üzerinde/.test(m)).length);
    // Çapak alma: "adım atlanıyor" kütüphanede var → genel "Operasyon atlanıyor" eklenmez
    const deb = p.pfmea.filter((r) => r.stepId === 'OP-002').map((r) => r.failureMode);
    expect(deb.filter((m) => /atlan/.test(m))).toHaveLength(1);
    expect(generate(p, ['pfmea']).edits).toHaveLength(0);
  });

  it('DFMEA: bağlı her gereksinim tipi + fonksiyon hata tipleri; mevcut satırı olan fonksiyona eksikler eklenir', () => {
    let p = newProject();
    p.meta.partName = 'Braket';
    const req = (id: string, text: string, reqType: string) => ({ kind: 'add', table: 'requirements', row: { ...blankRow('requirements', id), id, text, reqType } });
    p = apply(p, [req('REQ-001', 'Braket 500 N yükü taşımalıdır', 'Structural'), req('REQ-002', 'Çalışma sıcaklığı -40 / +80 °C', 'Environmental'),
      { kind: 'add', table: 'structure', row: { ...blankRow('structure', 'FN-001'), id: 'FN-001', level: 'Product', element: 'Braket', function: 'Yükü taşır', reqIds: ['REQ-001', 'REQ-002'] } },
      { kind: 'add', table: 'dfmea', row: { ...blankRow('dfmea', 'DF-001'), id: 'DF-001', functionId: 'FN-001', failureMode: 'Braket yorulma ömrü yetersiz' } }]);
    p = apply(p, generate(p, ['dfmea']).edits);
    const fm = p.dfmea.filter((d) => d.functionId === 'FN-001').map((d) => d.failureMode);
    expect(fm.filter((m) => /yorulma ömrü/.test(m))).toHaveLength(1);
    expect(fm.some((m) => /yük altında yetersiz dayanım/.test(m))).toBe(true); // Structural
    expect(fm.some((m) => /korozyon/.test(m))).toBe(true); // Environmental (ikinci gereksinim tipi)
    for (const t of [/fonksiyon yok/, /kısmen/, /zamanla azalıyor/, /aralıklı/, /istenmeyen/]) expect(fm.some((m) => t.test(m)), String(t)).toBe(true);
    expect(p.dfmea.filter((d) => d.id !== 'DF-001').every((d) => d.approval === 'AI Proposed' && d.confidence === 'Low')).toBe(true);
    expect(generate(p, ['dfmea']).edits).toHaveLength(0);
  });
});

describe('4.7.0 yüksek risk aksiyonu ve maliyet-etkin önleme', () => {
  const seed = () => {
    const p = newProject();
    p.processSteps.push({ ...(blankRow('processSteps', 'OP-001') as Project['processSteps'][number]), opNo: '10', name: 'CNC tornalama' });
    p.pfmea.push({ ...(blankRow('pfmea', 'PF-001') as PfmeaRow), stepId: 'OP-001', stepName: 'CNC tornalama', failureMode: 'Ölçü / tolerans dışı (çap, boy, konum)', cause: 'Takım aşınması', cause4M: 'Machine', prevention: 'Takım değişim talimatı', detection: 'Görsel', s: 6, o: 2, d: 2 });
    p.dfmea.push({ ...(blankRow('dfmea', 'DF-001') as DfmeaRow), failureMode: 'Et kalınlığı yetersiz', cause: 'Tolerans hatası', detection: 'Analiz', s: 7, o: 2, d: 2 });
    return p;
  };

  it('S≥9 satır RPN eşiğin altında olsa da öneri alır (RPN tek başına ölçüt değildir)', () => {
    const q = planEdits(seed(), [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 's', value: 10 }]).project; // RPN 40
    const r = q.pfmea[0];
    expect(needsAction(q, r).reasons).toContain('S≥9');
    expect(r.recommendedAction).toMatch(/^\[S≥9[^\]]* · RPN 40\] S=10/);
    expect(r.recommendedAction).toContain(AI_REC);
    expect(q.actions.some((a) => a.sourceId === 'PF-001')).toBe(true);
    const d = planEdits(seed(), [{ kind: 'set', table: 'dfmea', id: 'DF-001', field: 's', value: 9 }]).project.dfmea[0];
    expect(d.recommendedAction).toMatch(/^\[S≥9[^\]]* · RPN 36\]/);
    // düşük risk: öneri yok
    expect(planEdits(seed(), [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 's', value: 8 }]).project.pfmea[0].recommendedAction).toBe('');
  });

  it('AIAG-VDA: AP=H satır RPN eşiğinin altında öneri alır', () => {
    const p = seed();
    p.settings.scoringStandard = 'AIAG-VDA';
    p.settings.rpnThreshold = 500;
    const q = planEdits(p, [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 's', value: 9 }, { kind: 'set', table: 'pfmea', id: 'PF-001', field: 'o', value: 6 }]).project;
    expect(needsAction(q, q.pfmea[0]).reasons).toContain('AP=H');
    expect(q.pfmea[0].recommendedAction).toMatch(/^\[AP=H · RPN/);
  });

  it('önleyici seçenekler ucuzdan pahalıya sıralanır; maliyet sınıfı varsayım olarak etiketlenir, fiyat yazılmaz', () => {
    const r = planEdits(seed(), [{ kind: 'set', table: 'pfmea', id: 'PF-001', field: 'o', value: 6 }, { kind: 'set', table: 'pfmea', id: 'PF-001', field: 'd', value: 3 }]).project.pfmea[0]; // 108
    const txt = r.recommendedAction;
    expect(txt).toMatch(/önleyici seçenekler \(ucuzdan pahalıya – maliyet sınıfı göreli tahmindir – fiyat verisi yok, AI VARSAYIMI\)/);
    const tiers = [...txt.matchAll(/\[maliyet: (Düşük|Orta|Yüksek|Çok yüksek)/g)].map((m) => ['Düşük', 'Orta', 'Yüksek', 'Çok yüksek'].indexOf(m[1]));
    expect(tiers.length).toBeGreaterThanOrEqual(2);
    expect(tiers).toEqual([...tiers].sort((a, b) => a - b));
    expect(tiers[0]).toBe(0);
    expect(txt).not.toMatch(/\d+\s*(TL|₺|\$|€|USD|EUR)/);
  });

  it('rankMeasures: S≥9’da idari kontrol önerilmez ve en ucuz hata önleme seçeneği listede olur', () => {
    const low = rankMeasures(PREVENTION_4M.Man, { severity: 5 });
    expect(low.map((m) => m.cost)).toEqual([1, 1, 2]);
    const high = rankMeasures(PREVENTION_4M.Man, { severity: 10 });
    expect(high.every((m) => m.strength >= 2)).toBe(true);
    expect(high[0].strength).toBe(3);
    const s8 = rankMeasures(PREVENTION_4M.Method, { severity: 8, max: 2 });
    expect(s8.some((m) => m.strength === 3)).toBe(true);
    // satırda zaten bulunan kontrol tekrar önerilmez
    expect(rankMeasures(PREVENTION_4M.Machine, { current: 'önleyici bakım planı' }).some((m) => /bakım planı/.test(m.text))).toBe(false);
  });

  it('kontrol metninden maliyet sınıfı ve güç', () => {
    expect(costTierOf('Onaylı iş talimatı')).toBe(1);
    expect(costTierOf('Fikstür doğrulama')).toBe(2);
    expect(costTierOf('Barkodla malzeme doğrulama')).toBe(3);
    expect(costTierOf('Otomatik karışım / dozaj')).toBe(4);
    expect(strengthOf('Operatör eğitimi')).toBe(1);
    expect(strengthOf('Reçete kilidi (software parameter lock)')).toBe(3);
    expect(measureOf(' Poka-yoke kutular ')).toEqual({ text: 'Poka-yoke kutular', cost: 2, strength: 3 });
  });
});
