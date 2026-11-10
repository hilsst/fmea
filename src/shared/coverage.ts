// 4.8.0: kapsam denetimi – her proses adımı ve fonksiyon için değerlendirilmesi gereken hata modu tipleri ile
// 4M nedenlerinin FMEA'da karşılanıp karşılanmadığını yerelde kontrol eder. Eksikler "kütüphaneden öner" ile tamamlanır.
import { stepArea } from './failureLib';
import type { PfmeaRow, Project } from './types';

export interface CoverageGap {
  table: 'pfmea' | 'dfmea';
  /** Proses adımı / fonksiyon kimliği */
  id: string;
  name: string;
  missing: string[];
}

const PF_TYPES: [string, RegExp][] = [
  ['yapılmadı / atlandı', /atlan|yapılmıyor|yok \(no|hiç/],
  ['kısmi / eksik', /kısm|eksik|yetersiz|alt limit|altında/],
  ['fazla / aşırı', /fazla|aşırı|üst limit|üzerinde/],
  ['yanlış (parça, ayar, malzeme)', /yanlış|hatalı|uygun değil/],
  ['hasar / bozulma', /hasar|çatlak|çizik|delaminasyon|deformasyon|korozyon/],
];
const FOUR_M = ['Man', 'Machine', 'Material', 'Method', 'Measurement', 'Environment'];
const DF_TYPES: [string, RegExp][] = [
  ['fonksiyon yok', /fonksiyon yok|hiç yerine|kayb|yetersiz dayanım|karşılam/],
  ['kısmi', /kısm|gereksinim altında|yetersiz|sınır/],
  ['zamanla azalan', /zamanla|degrad|yaşlan|ömür|yorulma|aşınma/],
  ['aralıklı', /aralıklı|ara sıra|tekrarlan/],
  ['istenmeyen fonksiyon', /istenmeyen|yanlış zaman|beklenmeyen|fazla/],
];

export function coverageGaps(p: Project): CoverageGap[] {
  const out: CoverageGap[] = [];
  for (const st of p.processSteps) {
    if (!st.name?.trim()) continue;
    const rows = p.pfmea.filter((r) => r.stepId === st.id && r.approval !== 'Rejected');
    const text = rows.map((r) => (r.failureMode ?? '').toLocaleLowerCase('tr'));
    const missing: string[] = [];
    if (!rows.length) missing.push('hiç PFMEA satırı yok');
    else {
      for (const [label, re] of PF_TYPES) if (!text.some((t) => re.test(t))) missing.push(`hata tipi: ${label}`);
      const cats = new Set(rows.map((r: PfmeaRow) => r.cause4M).filter(Boolean));
      const area = stepArea(p, st);
      const needM = area === 'Inspection' || area === 'NDT' ? FOUR_M : FOUR_M.filter((m) => m !== 'Environment');
      for (const m of needM) if (!cats.has(m as never)) missing.push(`neden kategorisi (4M): ${m}`);
    }
    if (missing.length) out.push({ table: 'pfmea', id: st.id, name: `${st.opNo ? st.opNo + ' · ' : ''}${st.name}`, missing });
  }
  for (const fn of p.structure) {
    if (!fn.function?.trim() || fn.approval === 'Rejected') continue;
    const rows = p.dfmea.filter((d) => d.functionId === fn.id && d.approval !== 'Rejected');
    const text = rows.map((d) => (d.failureMode ?? '').toLocaleLowerCase('tr'));
    const missing: string[] = [];
    if (!rows.length) missing.push('hiç DFMEA satırı yok');
    else for (const [label, re] of DF_TYPES) if (!text.some((t) => re.test(t))) missing.push(`hata tipi: ${label}`);
    if (missing.length) out.push({ table: 'dfmea', id: fn.id, name: `${fn.element ? fn.element + ' · ' : ''}${fn.function}`.slice(0, 90), missing });
  }
  return out;
}
