// 4.9.0: "AI ile tümünü kur" zincirinin saf yardımcıları.
// Zincir onaylı gereksinimlerden yapı → DFMEA → proses akışı → PFMEA → aksiyon → kontrol planı kurar; her satır
// "AI Proposed" eklenir, hiçbiri onaylanmaz. Mühendis sonunda inceler, düzeltir ve onaylar.
import { approvedReqIds } from './dfmeaInput';
import type { ProposalSet } from './proposals';
import type { ControlPlanRow, PfmeaRow, Project } from './types';

export const NO_DATA = 'VERİ YOK – doğrulanmalı';

export function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** Zincirde öneriler tek tek sorulmaz: hepsi "AI Proposed" eklenir (onay değildir); yapı satırları yalnız onaylı gereksinime bağlanır. */
export function acceptAll(p: Project, set: ProposalSet): ProposalSet {
  const ok = approvedReqIds(p);
  return {
    ...set,
    items: set.items.map((it) => ({
      ...it,
      decision: 'accepted',
      row: it.table === 'structure' ? { ...it.row, reqIds: ((it.row.reqIds as string[]) ?? []).filter((id) => ok.has(id)) } : it.row,
    })),
    issues: set.issues.map((x) => ({ ...x, decision: 'accepted' })),
  };
}

const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
const rpn = (r: PfmeaRow) => (r.s ?? 0) * (r.o ?? 0) * (r.d ?? 0);

/**
 * PFMEA'dan kontrol planı satırları: aynı adımda aynı tespit yöntemini paylaşan hata modları tek kontrol planı satırı olur
 * (her hata modu için ayrı satır açılmaz). En yüksek riskli satır (S, sonra RPN) temsilci olarak bağlanır.
 * Numune büyüklüğü ve sıklık kaynakta olmadığı için VERİ YOK gelir.
 */
export function cpRowsFromPfmea(p: Project, pfIds?: string[]): Partial<ControlPlanRow>[] {
  const covered = new Set(p.controlPlan.map((c) => c.pfId).filter(Boolean));
  const groups = new Map<string, PfmeaRow[]>();
  for (const r of p.pfmea) {
    if (!r.failureMode?.trim() || covered.has(r.id) || (pfIds && !pfIds.includes(r.id))) continue;
    const k = `${r.stepId}|${norm(r.measurement || r.detection || r.failureMode)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const out: Partial<ControlPlanRow>[] = [];
  for (const rows of groups.values()) {
    const r = [...rows].sort((a, b) => (b.s ?? 0) - (a.s ?? 0) || rpn(b) - rpn(a))[0];
    const kc = p.kcs.find((k) => rows.some((x) => k.sourceId === x.id) && k.status === 'Approved');
    out.push({
      pfId: r.id,
      stepId: r.stepId,
      kcId: kc?.id ?? '',
      productChar: r.productRequirement && !r.productRequirement.startsWith('VERİ YOK') ? r.productRequirement : '',
      processChar: r.requirement || r.processFunction,
      controlMethod: r.prevention,
      method: r.measurement || r.detection || NO_DATA,
      reactionPlan: r.reactionPlan || 'Uygunsuz ürün karantina + NCR (AI RECOMMENDATION)',
      sampleSize: NO_DATA,
      frequency: NO_DATA,
      notes: rows.length > 1 ? `AI ile tümünü kur: ${rows.map((x) => x.id).join(', ')} hata modlarını kapsar` : 'AI ile tümünü kur',
    });
  }
  return out;
}

/** Zincir sonunda inceleme özeti için: bu çalıştırmada eklenen satırlar (önceki ID'ler hariç). */
export function addedSince(before: Project, after: Project, table: 'structure' | 'dfmea' | 'processSteps' | 'pfmea' | 'actions' | 'controlPlan' | 'kcs' | 'issues'): number {
  const had = new Set((before[table] as { id: string }[]).map((r) => r.id));
  return (after[table] as { id: string }[]).filter((r) => !had.has(r.id)).length;
}
