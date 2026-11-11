import { describe, expect, it } from 'vitest';
import { FLOW_TEMPLATES } from '../src/shared/flowLib';
import { PFMEA_LIB, pfmeaAreaOf } from '../src/shared/failureLib';

describe('4.9.7 PFMEA kütüphane boşlukları', () => {
  it('kalıp hazırlığı kendi alanına gider ve en az 4 hata modu vardır', () => {
    expect(pfmeaAreaOf('Kalıp hazırlığı (ayırıcı uygulama)', 'composite')).toBe('Mold Prep');
    expect(PFMEA_LIB['Mold Prep'].length).toBeGreaterThanOrEqual(4);
  });
  it('kompozit şablonlarındaki hiçbir adım Generic alana düşmez ve her alanda en az 3 hata modu vardır', () => {
    for (const t of FLOW_TEMPLATES.filter((x) => ['composite', 'handLayup', 'infusion', 'rtm', 'winding', 'press'].includes(x.key)))
      for (const s of t.steps) {
        const a = pfmeaAreaOf(`${s.name} ${(s as { description?: string }).description ?? ''}`, 'composite');
        expect(a, `${t.key}/${s.name}`).not.toBe('Generic');
        expect(PFMEA_LIB[a].length, `${t.key}/${s.name}/${a}`).toBeGreaterThanOrEqual(3);
      }
  });
});
