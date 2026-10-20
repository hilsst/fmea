// v4-kc: KC / CI izlenebilirliği (AS9145 / SCMH 7.2.16 B4: "product and process KCs be traceable from the
// originating document through the Process Flow, PFMEA, and Control Plan … same KC identifiers in all documents").
// DFMEA'da tanımlı KC, PFMEA satırının dfIds bağlantısı üzerinden PFMEA ve PFD Classification sütunlarına akar.
import type { CheckResult } from './checks';
import {
  DECISION_QUESTIONS,
  hasKcControl,
  isCi,
  isConfirmed,
  isInactive,
  isListed,
  kcCandidates,
  kcDisplayNo,
  kcTypeOf,
  processKcCandidates,
  scmhKcDecision,
} from './kcScmh';
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
  const ids = new Set([...pfRowsOfKc(p, k).map((x) => x.stepId), ...cpRowsOfKc(p, k).map((c) => c.stepId), ...(k.linkedIds ?? [])]);
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
  return join(active(p).filter((k) => stepsOfKc(p, k).some((s) => s.id === st.id)));
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

// ------------------------------------------------------------------ kalite kontrolleri (yalnızca SCMH)

const nonEmpty = (s: string | undefined | null) => !!s && s.trim() !== '';

export function kcChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const add = (key: string, question: string, weight: number, bad: string[], okDetail: string, badDetail: (n: number) => string, applicable: boolean) =>
    out.push({ key, question, weight, ok: applicable && bad.length === 0, ids: bad, detail: !applicable ? 'Değerlendirilecek veri yok' : bad.length ? badDetail(bad.length) : okDetail });
  const listed = p.kcs.filter((k) => isListed(k) && !isInactive(k));
  const product = listed.filter((k) => isCi(k) || kcTypeOf(k) === 'Product');

  add('kc-in-pfmea', 'Ürün KC’leri ve CI’lar PFMEA’da değerlendirilmiş mi? (7.2.3 p59)', 8,
    product.filter((k) => pfRowsOfKc(p, k).length === 0).map((k) => k.id),
    'Tüm ürün KC/CI’ları en az bir PFMEA satırına akıyor', (n) => `${n} ürün KC/CI PFMEA’da yok (dfIds veya ek bağlantı kurun)`, product.length > 0);

  const notInPfd = listed.filter((k) => !isCi(k)).filter((k) => {
    const no = kcDisplayNo(k);
    return stepsOfKc(p, k).length === 0 && !p.processSteps.some((s) => s.classification.includes(no));
  });
  add('kc-in-pfd', 'KC numaraları proses akışında (PFD Classification) görünüyor mu? (7.2.16)', 6,
    notInPfd.map((k) => k.id), 'Tüm KC’ler PFD’de', (n) => `${n} KC proses akışında görünmüyor`, listed.some((k) => !isCi(k)));

  const kcsOnly = listed.filter((k) => !isCi(k));
  add('kc-in-cp', 'KC’ler kontrol planında aynı numarayla var mı? (7.2.16)', 8,
    kcsOnly.filter((k) => cpRowsOfKc(p, k).length === 0).map((k) => k.id), 'Tüm KC’ler kontrol planında', (n) => `${n} KC kontrol planında yok`, kcsOnly.length > 0);

  const procKc = kcsOnly.filter((k) => kcTypeOf(k) === 'Process');
  const badCp = procKc.flatMap((k) => cpRowsOfKc(p, k).filter((c) => !hasKcControl(c)).map((c) => c.id));
  add('kc-process-control', 'Proses KC’leri %100 kontrol veya SPC ile izleniyor mu? (7.2.3 p63)', 8,
    [...new Set(badCp)], 'Proses KC kontrol satırlarının hepsinde %100 veya SPC var', (n) => `${n} proses KC kontrol planı satırında %100 / SPC yok`, procKc.some((k) => cpRowsOfKc(p, k).length > 0));

  const elim = p.kcs.filter((k) => k.lifecycle === 'Eliminated');
  add('kc-elim-note', 'Elenen KC’lerin eleme gerekçesi yazılmış mı? (7.2.17 §1.2.8)', 6,
    elim.filter((k) => !nonEmpty(k.eliminationNote) || !nonEmpty(k.eliminatedBy)).map((k) => k.id), 'Tüm elenen KC’lerde gerekçe var', (n) => `${n} elenen KC’de gerekçe / eleme yolu yok`, elim.length > 0);

  const norm = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
  const elimChars = new Map(elim.filter((k) => nonEmpty(k.characteristic)).map((k) => [norm(k.characteristic), k.id]));
  add('kc-reintro', 'Daha önce elenen bir KC yeniden mi ekleniyor? (7.2.17 Overview)', 4,
    p.kcs.filter((k) => k.lifecycle !== 'Eliminated' && k.status !== 'Rejected' && elimChars.has(norm(k.characteristic))).map((k) => `${k.id}↔${elimChars.get(norm(k.characteristic))}`),
    'Elenen KC tekrar eklenmemiş', (n) => `${n} KC daha önce elenmiş bir KC ile aynı karakteristik – yeniden değerlendirin`, elim.length > 0);

  const cands = kcCandidates(p).filter((c) => c.kcs.length === 0);
  add('kc-trigger', 'KC aday tetikleyicisi olan satırlar değerlendirilmiş mi? (CPQA Q10, DRA Q&A Q21)', 6,
    cands.map((c) => c.row.id), 'Tüm aday satırların KC değerlendirmesi var', (n) => `${n} satırda KC tetikleyicisi var ama KC kaydı yok`, p.dfmea.length + p.pfmea.length > 0);

  const proc = processKcCandidates(p);
  add('kc-process-rule', 'Tasarımla azaltılamayan yüksek PFMEA riskleri için proses KC düşünülmüş mü? (7.2.3 p63)', 6,
    proc.map((c) => c.row.id), 'Proses KC kuralına göre açık satır yok', (n) => `${n} PFMEA satırı: tasarım aksiyonu sorusu veya proses KC bekliyor`, p.pfmea.length > 0);

  const confirmed = p.kcs.filter((k) => isConfirmed(k) && !isInactive(k));
  add('kc-decision', 'Kesinleşmiş KC/CI’lar SCMH karar akışıyla gerekçelendirilmiş mi? (CAP p54)', 6,
    confirmed.filter((k) => {
      const d = scmhKcDecision(k);
      if (!d.complete) return true;
      if (isCi(k)) return d.ci === false;
      return d.outcome === 'Not a KC' || d.outcome === 'Not a Critical Item';
    }).map((k) => k.id),
    'Kesinleşmiş KC/CI’ların karar akışı tamam ve tutarlı', (n) => `${n} kesinleşmiş KC/CI’da karar akışı eksik veya “KC değil” sonucu veriyor (severity tek başına KC kararı değildir)`, confirmed.length > 0);

  const prodConfirmed = confirmed.filter((k) => !isCi(k) && kcTypeOf(k) === 'Product');
  add('kc-design-record', 'Ürün KC’leri tasarım kaydında (resim/şartname) gösterilmiş mi? (7.2.3 p40)', 6,
    prodConfirmed.filter((k) => !k.onDrawing || !kcReference(p, k)).map((k) => k.id), 'Kesinleşmiş ürün KC’lerinin tasarım kaydı referansı var', (n) => `${n} ürün KC tasarım kaydında işaretli değil / referans yok`, prodConfirmed.length > 0);

  add('kc-customer', 'KC/CI listesi müşteriyle mutabık kalınmış mı? (7.2.3 p22)', 4,
    listed.filter((k) => !k.customerAgreed).map((k) => k.id), `Liste müşteriyle mutabık${p.meta.kcListAgreedBy ? ` (${p.meta.kcListAgreedBy} ${p.meta.kcListAgreedDate})` : ''}`, (n) => `${n} KC/CI müşteri mutabakatı bekliyor`, listed.length > 0);

  return out;
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

export { DECISION_QUESTIONS };
