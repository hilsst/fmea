// 4.4.1: PFMEA'ya aktarma pencereleri ("DFMEA'dan aktar", "Gereksinimlerden aktar") için saf yardımcılar.
// Varsayılan seçimler yalnızca öneridir; satırlar "AI Proposed" eklenir, proses adımını mühendis seçer.
import type { DfmeaRow, PfmeaRow, Project, RequirementRow } from './types';
import { isKcCandidate } from './scoring';

const PROCESS_REQ_TYPES = new Set(['Manufacturing', 'Process', 'Inspection']);

/** DFMEA satırı PFMEA'ya aktarım için önerilsin mi? Gerekçe döner; boş = öneri yok. */
export function dfmeaTransferReason(p: Project, d: DfmeaRow): string {
  if (p.pfmea.some((x) => x.dfIds.includes(d.id))) return '';
  const why: string[] = [];
  if ((d.s ?? 0) >= p.settings.highSeverityThreshold) why.push(`S≥${p.settings.highSeverityThreshold}`);
  if (isKcCandidate(d, p.settings)) why.push('KC adayı');
  if ((d.riskCategory ?? []).includes('Manufacturability')) why.push('Üretilebilirlik');
  return why.join(' · ');
}

/** Gereksinim PFMEA'da (doğrudan veya bağlı DFMEA üzerinden) zaten karşılanmış mı? */
export function requirementInPfmea(p: Project, reqId: string): string[] {
  const dfs = new Set(p.dfmea.filter((d) => d.reqIds.includes(reqId)).map((d) => d.id));
  return p.pfmea.filter((x) => x.reqIds?.includes(reqId) || x.dfIds.some((id) => dfs.has(id))).map((x) => x.id);
}

/** Gereksinim PFMEA'ya aktarım için önerilsin mi? Üretim/proses/muayene, boyutsal veya 9145 SR ve PFMEA'da yoksa. */
export function requirementTransferReason(p: Project, r: RequirementRow): string {
  if (requirementInPfmea(p, r.id).length) return '';
  if (PROCESS_REQ_TYPES.has(r.reqType)) return `Proses gereksinimi (${r.reqType})`;
  if (r.reqType === 'Dimensional') return 'Boyutsal karakteristik';
  if (r.specialRequirement) return '9145 SR';
  return '';
}

/** Gereksinimden PFMEA taslak satırı. Hata modu, etki ve neden uydurulmaz: boş kalır, mühendis girer. */
export function pfmeaFromRequirement(r: RequirementRow, stepId: string): Partial<PfmeaRow> {
  const text = `${r.id}: ${r.text}`;
  const proc = PROCESS_REQ_TYPES.has(r.reqType);
  return {
    stepId,
    reqIds: [r.id],
    requirement: text,
    productRequirement: proc ? '' : text,
    processRequirement: proc ? text : '',
    source: r.id,
    approval: 'AI Proposed',
    dataStatus: 'VERİ YOK – doğrulanmalı',
    notes: 'Gereksinimden aktarıldı: hata modu, etki ve neden mühendis tarafından girilmeli.',
  };
}
