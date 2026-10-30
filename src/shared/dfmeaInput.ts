// 4.6.3: "AI: DFMEA öner" yalnızca onaylı (Approved) gereksinimlerden çalışır. Onaysız gereksinimler
// (AI Proposed / Engineer Reviewed / Rejected) AI'ya gönderilmez; onaylı gereksinimi olmayan fonksiyon atlanır.
import type { Project, StructureRow } from './types';

export const approvedReqIds = (p: Project) => new Set(p.requirements.filter((r) => r.approval === 'Approved').map((r) => r.id));

export interface DfmeaTarget {
  fn: StructureRow;
  /** Fonksiyonun onaylı gereksinimleri (onaysızlar çıkarılmış). */
  reqIds: string[];
}

/** Hedef fonksiyonları onaylı gereksinime bağlı olanlar (ready) ve olmayanlar (skipped) diye ayırır. */
export function dfmeaTargets(p: Project, fnIds: string[] = []) {
  const ok = approvedReqIds(p);
  const ready: DfmeaTarget[] = [];
  const skipped: StructureRow[] = [];
  for (const fn of p.structure.filter((s) => s.function && (!fnIds.length || fnIds.includes(s.id)))) {
    const reqIds = fn.reqIds.filter((id) => ok.has(id));
    if (reqIds.length) ready.push({ fn, reqIds });
    else skipped.push(fn);
  }
  return { ready, skipped };
}

export const dfmeaTargetText = (ready: DfmeaTarget[]) =>
  'Hedef fonksiyonlar (yalnızca onaylı gereksinimleriyle):\n' + ready.map(({ fn, reqIds }) => `${fn.id}: ${fn.element} → ${fn.function} (REQ: ${reqIds.join(', ')})`).join('\n');
