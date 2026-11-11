// v4-kc: KC / CI izlenebilirliği (AS9145 / SCMH 7.2.16 B4: "product and process KCs be traceable from the
// originating document through the Process Flow, PFMEA, and Control Plan … same KC identifiers in all documents").
// DFMEA'da tanımlı KC, PFMEA satırının dfIds bağlantısı üzerinden PFMEA ve PFD Classification sütunlarına akar.
import { hasKcControl, isCi, isConfirmed, isInactive, kcDisplayNo, kcTypeOf } from './kcScmh';
import type { ControlPlanRow, DfmeaRow, KcRow, PfmeaRow, ProcessStepRow, Project } from './types';

type P = Pick<Project, 'kcs'> & Partial<Project>;

/** KC'nin doğrudan bağlı olduğu DFMEA satırları: kaynak, ek bağlantı veya kaynak gereksinimi (REQ-) taşıyan satırlar. */
export function dfRowsOfKc(p: P, k: KcRow): DfmeaRow[] {
  const links = k.linkedIds ?? [];
  return (p.dfmea ?? []).filter((d) => d.id === k.sourceId || links.includes(d.id) || (k.sourceId?.startsWith('REQ-') && d.reqIds.includes(k.sourceId)));
}

/** KC'nin aktığı PFMEA satırları: kaynak, ek bağlantı veya dfIds üzerinden bağlı DFMEA satırı. */
export function pfRowsOfKc(p: P, k: KcRow): PfmeaRow[] {
  const links = k.linkedIds ?? [];
  const df = new Set(dfRowsOfKc(p, k).map((d) => d.id));
  return (p.pfmea ?? []).filter((x) => x.id === k.sourceId || links.includes(x.id) || x.dfIds.some((id) => df.has(id)));
}

/** KC'nin kontrol planı satırları: kcId, ek bağlantı veya proses KC'nin proses parametresi (ppId). */
export function cpRowsOfKc(p: P, k: KcRow): ControlPlanRow[] {
  const links = k.linkedIds ?? [];
  const pps = new Set(k.ppIds ?? []);
  return (p.controlPlan ?? []).filter((c) => c.kcId === k.id || links.includes(c.id) || (!!c.ppId && pps.has(c.ppId)));
}

export function stepsOfKc(p: P, k: KcRow): ProcessStepRow[] {
  const ids = new Set([
    ...pfRowsOfKc(p, k).map((x) => x.stepId),
    ...cpRowsOfKc(p, k).map((c) => c.stepId),
    ...(p.pfdItems ?? []).filter((x) => x.kcId === k.id).map((x) => x.stepId), // PFD girdi/çıktısına bağlı KC
    ...(k.linkedIds ?? []),
  ]);
  return (p.processSteps ?? []).filter((s) => ids.has(s.id));
}

/** Classification hücresindeki etiket: kesinleşmiş KC numarası; ön liste/potansiyel/aday ise "Potential: …". */
export function kcClassLabel(k: KcRow): string {
  return isConfirmed(k) ? kcDisplayNo(k) : `Potential: ${kcDisplayNo(k)}`;
}

const active = (p: P) => p.kcs.filter((k) => !isInactive(k));
const join = (ks: KcRow[]) => [...new Set(ks.map(kcClassLabel))].join('; ');

/** Bir DFMEA / PFMEA satırının Classification metni (akış dahil). */
export function rowClassification(p: P, rowId: string): string {
  const df = (p.dfmea ?? []).some((d) => d.id === rowId);
  const pf = (p.pfmea ?? []).some((x) => x.id === rowId);
  return join(active(p).filter((k) => {
    if (df) return dfRowsOfKc(p, k).some((d) => d.id === rowId);
    if (pf) return pfRowsOfKc(p, k).some((x) => x.id === rowId);
    return k.sourceId === rowId || (k.linkedIds ?? []).includes(rowId);
  }));
}

/** Kontrol planı satırının Classification metni (SCMH CP sütun I). Proses KC'nin kontrol ettiği ürün KC'leri de yazılır. */
export function cpClassification(p: P, c: ControlPlanRow): string {
  const ks = active(p).filter((k) => cpRowsOfKc(p, k).some((x) => x.id === c.id));
  const related = ks.flatMap((k) => (kcTypeOf(k) === 'Process' ? k.relatedKcIds ?? [] : []));
  const extra = active(p).filter((k) => related.includes(k.id));
  // Bağlı KC kaydı silinmiş/bulunamıyorsa eski davranış: ham kcId
  if (!ks.length && c.kcId && !p.kcs.some((k) => k.id === c.kcId)) return c.kcId;
  return join([...ks, ...extra]);
}

/** PFD adımının Classification metni (adımın PFMEA ve kontrol planı satırlarının birleşimi). */
export function stepClassification(p: P, st: ProcessStepRow): string {
  const known = join(active(p).filter((k) => stepsOfKc(p, k).some((s) => s.id === st.id)));
  // Projede kaydı olmayan (ör. müşteriden gelen, henüz eklenmemiş) KC referansları olduğu gibi yazılır
  const raw = [...(p.pfdItems ?? []).filter((x) => x.stepId === st.id).map((x) => x.kcId), ...(p.controlPlan ?? []).filter((c) => c.stepId === st.id).map((c) => c.kcId)]
    .filter((id) => id && !p.kcs.some((k) => k.id === id));
  return [...new Set([...(known ? known.split('; ') : []), ...raw])].join('; ');
}

// ------------------------------------------------------------------ türetilmiş form alanları

/** 7.2.16 REFERENCE: açık tasarım kaydı referansı; yoksa bağlı gereksinimin kaynak konumu. */
export function kcReference(p: Project, k: KcRow): string {
  const doc = p.documents.find((d) => d.id === k.designRecordDocId);
  const docLabel = doc ? [doc.docNumber || doc.name, doc.revision && `Rev ${doc.revision}`].filter(Boolean).join(' ') : '';
  const explicit = [docLabel, k.designRecordRef].filter(Boolean).join(' ');
  if (explicit) return explicit;
  const reqIds = k.sourceId?.startsWith('REQ-') ? [k.sourceId] : dfRowsOfKc(p, k).flatMap((d) => d.reqIds);
  const refs = reqIds
    .map((id) => p.requirements.find((r) => r.id === id))
    .filter(Boolean)
    .map((r) => {
      const d = p.documents.find((x) => x.id === r!.sourceDocId);
      return [d ? d.docNumber || d.name : '', r!.sourcePage && `Sayfa ${r!.sourcePage}`, r!.sourceSection, r!.balloon && `Balon ${r!.balloon}`].filter(Boolean).join(' ');
    })
    .filter(Boolean);
  return [...new Set(refs)].join('; ');
}

/** 7.2.16 Originating Document: açık değer, yoksa kaynak satır tipinden ve ders kayıtlarından türetilir. */
export function kcOrigins(p: Project, k: KcRow): string[] {
  if (k.originatingDoc?.length) return k.originatingDoc;
  const o: string[] = [];
  if (k.sourceId?.startsWith('DF-') || dfRowsOfKc(p, k).length) o.push('DFMEA');
  if (k.sourceId?.startsWith('PF-')) o.push('PFMEA');
  if (k.sourceId?.startsWith('REQ-')) o.push('Design record');
  if (k.designatedBy === 'Customer') o.push('Customer');
  if (p.lessons.some((l) => l.linkedFmeaIds.includes(k.sourceId))) o.push('Historical data');
  return [...new Set(o)];
}

/** KC ekranı izlenebilirlik satırı. */
export interface KcTraceRow {
  kc: KcRow;
  no: string;
  df: string[];
  pf: string[];
  steps: string[];
  cp: string[];
  cpWithoutControl: string[];
  gaps: string[];
}

export function kcTraceRows(p: Project): KcTraceRow[] {
  return p.kcs.filter((k) => k.status !== 'Rejected').map((k) => {
    const df = dfRowsOfKc(p, k).map((d) => d.id);
    const pf = pfRowsOfKc(p, k).map((x) => x.id);
    const steps = stepsOfKc(p, k).map((s) => s.opNo || s.id);
    const cps = cpRowsOfKc(p, k);
    const cpWithoutControl = !isCi(k) && kcTypeOf(k) === 'Process' ? cps.filter((c) => !hasKcControl(c)).map((c) => c.id) : [];
    const gaps: string[] = [];
    if (k.lifecycle !== 'Eliminated') {
      if (!pf.length && (isCi(k) || kcTypeOf(k) === 'Product')) gaps.push('PFMEA yok');
      if (!isCi(k) && !steps.length) gaps.push('PFD yok');
      if (!isCi(k) && !cps.length) gaps.push('Kontrol planı yok');
      if (cpWithoutControl.length) gaps.push('%100 / SPC yok');
    }
    return { kc: k, no: kcDisplayNo(k), df, pf, steps, cp: cps.map((c) => c.id), cpWithoutControl, gaps };
  });
}

