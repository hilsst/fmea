// v4-risk: model yardımcıları (model.ts'ten çağrılır; burada model.ts içe aktarılmaz).
//  - PFMEA ürün / proses gereksinimi ayrımı (SCMH 7.2.11 Rev A, Revision History C4: "split the Requirements
//    column into two columns – Product Requirements and Process Requirements").
//  - Sabit satır numaraları (SCMH "Doc (Line) #"): 7.2.19 Fire Ex B18:B46 sıralı değildir; numara bir kez
//    atanır, silinen satırın numarası yeniden kullanılmaz.
import type { AnyRow, ControlPlanRow, PfmeaRow, Project } from './types';

const t = (v: unknown) => (v == null ? '' : String(v).trim());
const opNum = (op: string) => {
  const n = parseFloat(String(op).replace(',', '.'));
  return Number.isFinite(n) ? n : Number.MAX_SAFE_INTEGER;
};

/** V3 sezgisi: PFMEA gereksinimi proses gereksinimi mi? (Proses parametresi veya yalnızca proses KP satırı bağlıysa.) */
export function isProcessRequirement(p: Pick<Project, 'processParams' | 'controlPlan'>, row: Pick<PfmeaRow, 'id'>): boolean {
  if (p.processParams.some((pp) => pp.pfIds.includes(row.id))) return true;
  const cps = p.controlPlan.filter((c) => c.pfId === row.id);
  return cps.length > 0 && cps.every((c) => c.charType === 'Process Characteristic' || c.charType === 'Process Parameter' || (!c.productChar && !!c.processChar));
}

/** Ürün / proses gereksinimi. Ayrık alanlar boşsa eski tek `requirement` alanı sezgiyle yerleştirilir. */
export function splitRequirement(p: Pick<Project, 'processParams' | 'controlPlan'>, row: PfmeaRow): { product: string; process: string } {
  const product = t(row.productRequirement);
  const process = t(row.processRequirement);
  if (product || process) return { product, process };
  const req = t(row.requirement);
  if (!req) return { product: '', process: '' };
  return isProcessRequirement(p, row) ? { product: '', process: req } : { product: req, process: '' };
}

/** Sabit satır numarası taşıyan tablolar (SCMH formlarının B sütunu). */
export const LINE_TABLES = ['dfmea', 'pfmea', 'controlPlan', 'processSteps'] as const;
export type LineTable = (typeof LINE_TABLES)[number];

/** SCMH çıktısındaki satır sırası (V3 ile aynı): DFMEA girildiği sırada, diğerleri operasyon numarasına göre. */
export function exportOrder<T extends AnyRow>(p: Project, table: LineTable): T[] {
  const step = new Map(p.processSteps.map((x) => [x.id, x]));
  if (table === 'dfmea') return [...p.dfmea] as unknown as T[];
  if (table === 'processSteps')
    return [...p.processSteps].sort((a, c) => opNum(a.opNo) - opNum(c.opNo) || t(a.opNo).localeCompare(t(c.opNo)) || a.id.localeCompare(c.id)) as unknown as T[];
  const rows = (table === 'pfmea' ? p.pfmea : p.controlPlan) as (PfmeaRow | ControlPlanRow)[];
  const op = (r: PfmeaRow | ControlPlanRow) => t(step.get(r.stepId)?.opNo) || t(r.opNo);
  // Aynı operasyonda tablodaki satır sırası korunur (sort kararlıdır; mühendis satırları taşıyabilir).
  return [...rows].sort((a, b) => opNum(op(a)) - opNum(op(b)) || op(a).localeCompare(op(b))) as unknown as T[];
}

/** Numarası olmayan satırlara (çıktı sırasıyla) yeni numara verir; mevcut numaralar değişmez. Değişen satır sayısını döndürür. */
export function ensureLineNumbers(p: Project): number {
  if (!p.lineCounters) p.lineCounters = {};
  let n = 0;
  for (const table of LINE_TABLES) {
    const rows = (p[table] ?? []) as AnyRow[];
    let max = p.lineCounters[table] ?? 0;
    for (const r of rows) if (typeof r.lineNo === 'number' && r.lineNo > max) max = r.lineNo;
    for (const r of exportOrder(p, table))
      if (typeof r.lineNo !== 'number') {
        r.lineNo = ++max;
        n++;
      }
    p.lineCounters[table] = max;
  }
  return n;
}

/** "Baseline öncesi yeniden numaralandır": çıktı sırasıyla 1…n (mühendis kararıyla; denetim izine yazılır). */
export function renumberLines(p: Project, table: LineTable): void {
  if (!p.lineCounters) p.lineCounters = {};
  let i = 0;
  for (const r of exportOrder(p, table)) r.lineNo = ++i;
  p.lineCounters[table] = i;
}

/** normalizeProject sonunda çağrılır: eksik alanlar blankRow ile zaten tamamlanmıştır. */
export function normalizeRisk(p: Project): void {
  if (!p.lineCounters) p.lineCounters = {};
  if (!Array.isArray(p.pfdItems)) p.pfdItems = [];
  for (const r of p.pfmea ?? []) {
    if (!t(r.productRequirement) && !t(r.processRequirement) && t(r.requirement)) {
      const sp = splitRequirement(p, r);
      r.productRequirement = sp.product;
      r.processRequirement = sp.process;
    }
  }
  ensureLineNumbers(p);
}
