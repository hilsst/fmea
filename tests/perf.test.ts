import { describe, expect, it } from 'vitest';
import { buildWorkbookV2 } from '../src/shared/excel2';
import { impactOf } from '../src/shared/impact';
import { blankRow } from '../src/shared/model';
import { qualityReport } from '../src/shared/quality';
import { sampleProject } from '../src/shared/sample';
import type { AnyRow, PfmeaRow } from '../src/shared/types';

// §63: 500+ satırlık projelerde çekirdek hesaplar etkileşimli kalmalı.
describe('performans (600 PFMEA satırı)', () => {
  const p = sampleProject();
  for (let i = 0; i < 600; i++) {
    const id = `PF-${String(i + 100).padStart(3, '0')}`;
    p.pfmea.push({ ...(blankRow('pfmea', id) as PfmeaRow), stepId: p.processSteps[i % p.processSteps.length].id, dfIds: [p.dfmea[i % p.dfmea.length].id], failureMode: `Hata modu ${i}`, effect: `Etki ${i}`, cause: `Neden ${i}`, prevention: 'Önleme', detection: 'Muayene', s: (i % 10) + 1, o: (i % 7) + 1, d: (i % 5) + 1 } as AnyRow as PfmeaRow);
  }
  it('kalite raporu < 1 s', () => {
    const t = performance.now();
    const q = qualityReport(p);
    expect(q.score).toBeGreaterThanOrEqual(0);
    expect(performance.now() - t).toBeLessThan(1000);
  });
  it('etki analizi < 500 ms', () => {
    const t = performance.now();
    const imp = impactOf(p, [p.dfmea[0].id]);
    expect(imp.ids.length).toBeGreaterThan(50);
    expect(performance.now() - t).toBeLessThan(500);
  });
  it('14 sayfalık Excel < 5 s', async () => {
    const t = performance.now();
    const buf = await buildWorkbookV2(p);
    expect(buf.length).toBeGreaterThan(10000);
    expect(performance.now() - t).toBeLessThan(5000);
  });
});
