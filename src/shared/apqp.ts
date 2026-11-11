// v4-apqp: APQP / PPAP kuralları – uygulanabilirlik (7.2.15), eleman durumu ve Red/Yellow/Green (SCMH 7.2.3 §6.1),
// teslimat onayları, PRR kapısı, PPAP hazırlığı, ekip kapsaması, kriter anlaşması, DFMEA zamanlaması,
// FMEA güncelleme tetikleyicileri ve aile/yeniden kullanım. Hiçbir kural onay vermez veya cevap seçmez:
// kontrol listesi önerileri yalnızca gösterilir, kararları kullanıcı adıyla mühendis verir.
import { capabilityAnalysis } from './capability';
import { isPpapCapabilityEvidence } from './capBand';
import type { CheckResult } from './checks';
import { blankRow, nextId } from './model';
import { parseData } from './scoring';
import {
  CATALOG_BY_KEY, MATRIX_ORDER, UPDATE_TRIGGER_SOURCES,
  type ApqpCatalogItem, type ApqpData, type ApqpElement, type Applicability, type Deliverable, type DeliverableApproval, type PpapSubmission, type Ryg,
} from './apqpModel';
import type { AnyRow, ChangeRequestRow, ControlPlanRow, DfmeaRow, LessonRow, PfmeaRow, Project, RequirementRow, TableKey } from './types';

export * from './apqpModel';

const has = (s: string | null | undefined) => !!s && s.trim() !== '' && !/^VERİ YOK/.test(s.trim());
const today = () => new Date().toISOString().slice(0, 10);
const apqpOf = (p: Project): ApqpData => p.apqp;

/** APQP modülü bu projede kullanılıyor mu (proje tipi seçilmiş)? Eski projeler etkilenmez. */
export const apqpActive = (p: Project) => !!p.apqp?.projectType;

// ------------------------------------------------------------------ uygulanabilirlik
export function applicabilityOf(item: ApqpCatalogItem, type: ApqpData['projectType']): Applicability {
  if (!item.marks || !type) return '';
  const m = item.marks[MATRIX_ORDER.indexOf(type)];
  return m === 'X' ? 'Mandatory' : m === 'O' ? 'Recommended' : 'As needed';
}

export const elementOf = (p: Project, key: string): ApqpElement | undefined => apqpOf(p).elements.find((e) => e.key === key);

// ------------------------------------------------------------------ teslimat onayları
/** Güncel revizyonda son ret/iade sonrası onaylanmış adımlar (workflow.approvedSteps ile aynı mantık). */
export function deliverableApprovedSteps(p: Project, d: Deliverable): Set<string> {
  const recs = apqpOf(p).deliverableApprovals.filter((a) => a.deliverable === d && a.revision === p.meta.fmeaRevision);
  let start = 0;
  recs.forEach((a, i) => {
    if (a.decision !== 'Approved') start = i + 1;
  });
  return new Set(recs.slice(start).filter((a) => a.decision === 'Approved').map((a) => a.step));
}

export function deliverableSteps(p: Project, d: Deliverable): string[] {
  const c = apqpOf(p).deliverableConfig.find((x) => x.deliverable === d);
  return c ? [...c.steps, ...(c.customerRequired ? ['Customer'] : [])] : [];
}

export function deliverableNextStep(p: Project, d: Deliverable): string | null {
  const done = deliverableApprovedSteps(p, d);
  return deliverableSteps(p, d).find((s) => !done.has(s)) ?? null;
}

export const deliverableApproved = (p: Project, d: Deliverable) => deliverableSteps(p, d).length > 0 && deliverableNextStep(p, d) === null;

/** Son onay zamanı (tüm adımlar onaylıysa son kaydın tarihi). */
export function deliverableApprovedAt(p: Project, d: Deliverable): string {
  if (!deliverableApproved(p, d)) return '';
  const recs = apqpOf(p).deliverableApprovals.filter((a) => a.deliverable === d && a.revision === p.meta.fmeaRevision && a.decision === 'Approved');
  return recs.length ? recs[recs.length - 1].at : '';
}

export interface DeliverableDecision {
  deliverable: Deliverable;
  step: string;
  decision: DeliverableApproval['decision'];
  user: string;
  role: string;
  comment: string;
  customerName?: string;
  customerRef?: string;
}

/** Teslimat onayı kuralları. AI onay veremez: kullanıcı adı zorunlu, sıra korunur, müşteri adımı belge ister. */
export function deliverableDecisionError(p: Project, d: DeliverableDecision): string {
  if (!d.user.trim()) return 'Onay için Ayarlar’da kullanıcı adı girilmelidir.';
  const next = deliverableNextStep(p, d.deliverable);
  if (!next) return `${d.deliverable} için tüm onay adımları tamamlandı.`;
  if (d.step !== next) return `${d.deliverable}: sıradaki adım ${next}.`;
  if (d.decision !== 'Approved' && !d.comment.trim()) return 'Ret / iade için yorum zorunludur.';
  if (d.step === 'Customer' && d.decision === 'Approved' && (!d.customerName?.trim() || !d.customerRef?.trim()))
    return 'Müşteri onayı için müşteri tarafında onaylayan kişi ve yazılı onay referansı girilmelidir.';
  if (d.decision === 'Approved' && !deliverableHasContent(p, d.deliverable)) return `${d.deliverable} içeriği boş; boş teslimat onaylanamaz.`;
  return '';
}

export function deliverableHasContent(p: Project, d: Deliverable): boolean {
  switch (d) {
    case 'DFMEA': return p.dfmea.length > 0;
    case 'PFMEA': return p.pfmea.length > 0;
    case 'PFD': return p.processSteps.length > 0;
    case 'CP': return p.controlPlan.length > 0;
    case 'KC list': return p.kcs.length > 0;
  }
}

export function recordDeliverableDecision(p: Project, d: DeliverableDecision, at = new Date().toISOString()): DeliverableApproval {
  const list = apqpOf(p).deliverableApprovals;
  return { id: `DAP-${String(list.length + 1).padStart(3, '0')}`, ...d, at, revision: p.meta.fmeaRevision };
}

// ------------------------------------------------------------------ PRR kapısı (SCMH 7.2.3 s.78)
export const isOpenAction = (s: string) => s !== 'Completed' && s !== 'Cancelled';

/** "All outstanding actions are satisfactorily closed or mitigated": açık ve onaylı azaltma planı olmayan FMEA aksiyonları. */
export function prrBlockers(p: Project): string[] {
  const mit = new Map(apqpOf(p).actionMitigations.map((m) => [m.actionId, m]));
  return p.actions
    .filter((a) => /^(DF|PF)-/.test(a.sourceId) && isOpenAction(a.status))
    .filter((a) => {
      const m = mit.get(a.id);
      return !(m && has(m.note) && has(m.approvedBy));
    })
    .map((a) => a.id);
}

/** Açık ama azaltma planı onaylı aksiyonlar (PPAP Interim gerekçesi önerisi). */
export function mitigatedOpenActions(p: Project): string[] {
  const blockers = new Set(prrBlockers(p));
  return p.actions.filter((a) => /^(DF|PF)-/.test(a.sourceId) && isOpenAction(a.status) && !blockers.has(a.id)).map((a) => a.id);
}

/** Final onay / baseline / PRR kararı için engel metni ('' = engel yok). Yalnızca APQP projesinde uygulanır. */
export function prrGateError(p: Project): string {
  if (!apqpActive(p)) return '';
  const b = prrBlockers(p);
  return b.length
    ? `PRR kapısı: ${b.length} açık FMEA aksiyonu kapatılmamış veya onaylı azaltma planı yok (${b.slice(0, 10).join(', ')}${b.length > 10 ? ' …' : ''}). SCMH 7.2.3: önemli üretim koşusundan önce tüm açık aksiyonlar kapatılmalı veya azaltılmalıdır.`
    : '';
}

export function prrDecisionError(p: Project, decision: 'Passed' | 'Failed', user: string, comment: string): string {
  if (!user.trim()) return 'PRR kararı için Ayarlar’da kullanıcı adı girilmelidir.';
  if (decision === 'Failed' && !comment.trim()) return 'Başarısız PRR için yorum zorunludur.';
  if (decision === 'Passed') {
    const b = prrBlockers(p);
    if (b.length) return `PRR geçilemez: ${b.length} açık FMEA aksiyonu kapatılmamış veya onaylı azaltma planı yok (${b.slice(0, 10).join(', ')}).`;
  }
  return '';
}

// ------------------------------------------------------------------ eleman kanıtı (öneriler)
export interface Suggestion {
  answer: 'Y' | 'N' | '';
  detail: string;
}

const pfSteps = (p: Project) => p.processSteps.filter((s) => !p.pfmea.some((x) => x.stepId === s.id)).map((s) => s.id);
const highNoAction = (rows: (DfmeaRow | PfmeaRow)[]) => rows.filter((r) => (r.s ?? 0) >= 9 && !has(r.recommendedAction)).map((r) => r.id);
const capValid = (p: Project) =>
  p.capability.filter((c) => c.kcId).map((c) => ({ c, a: capabilityAnalysis(parseData(c.data), c.lsl, c.usl, c.target, p.settings, c.subgroupSize, c.distribution) }));
const cpRowsIn = (p: Project, phase: string) => p.controlPlan.filter((c) => (c.phases ?? []).includes(phase as never));

/** Kontrol sorusu için proje verisinden öneri. Cevap değildir. */
export function suggest(p: Project, auto: string): Suggestion {
  const yn = (ok: boolean, detail: string): Suggestion => ({ answer: ok ? 'Y' : 'N', detail });
  switch (auto) {
    case 'kc-any': return yn(p.kcs.length > 0, `${p.kcs.length} KC kaydı`);
    case 'pfd-rows': return yn(p.processSteps.length > 0, `${p.processSteps.length} proses adımı`);
    case 'df-rows': return yn(p.dfmea.length > 0 || apqpOf(p).draMethods.length > 0, `${p.dfmea.length} DFMEA satırı, ${apqpOf(p).draMethods.length} DRA yöntem kaydı`);
    case 'df-high': { const b = highNoAction(p.dfmea); return yn(p.dfmea.length > 0 && b.length === 0, b.length ? `Aksiyonsuz S≥9: ${b.join(', ')}` : 'Aksiyonsuz S≥9 yok'); }
    case 'pf-high': { const b = highNoAction(p.pfmea); return yn(p.pfmea.length > 0 && b.length === 0, b.length ? `Aksiyonsuz S≥9: ${b.join(', ')}` : 'Aksiyonsuz S≥9 yok'); }
    case 'df-approved': return yn(deliverableApproved(p, 'DFMEA'), deliverableApproved(p, 'DFMEA') ? 'DFMEA onaylı' : `Sıradaki onay: ${deliverableNextStep(p, 'DFMEA') ?? '—'}`);
    case 'pf-approved': return yn(deliverableApproved(p, 'PFMEA'), deliverableApproved(p, 'PFMEA') ? 'PFMEA onaylı' : `Sıradaki onay: ${deliverableNextStep(p, 'PFMEA') ?? '—'}`);
    case 'pfd-approved': return yn(deliverableApproved(p, 'PFD'), deliverableApproved(p, 'PFD') ? 'PFD onaylı' : `Sıradaki onay: ${deliverableNextStep(p, 'PFD') ?? '—'}`);
    case 'cp-approved': return yn(deliverableApproved(p, 'CP'), deliverableApproved(p, 'CP') ? 'Kontrol planı onaylı' : `Sıradaki onay: ${deliverableNextStep(p, 'CP') ?? '—'}`);
    case 'kc-approved': return yn(deliverableApproved(p, 'KC list'), deliverableApproved(p, 'KC list') ? 'KC listesi onaylı' : `Sıradaki onay: ${deliverableNextStep(p, 'KC list') ?? '—'}`);
    case 'kc-reviewed': { const w = p.kcs.filter((k) => k.status === 'AI Proposed' || k.status === '').map((k) => k.id); return yn(p.kcs.length > 0 && !w.length, w.length ? `Değerlendirilmemiş: ${w.join(', ')}` : `${p.kcs.length} KC değerlendirildi`); }
    case 'kc-process': { const n = p.kcs.filter((k) => k.kcClass === 'KC-3 Process KC' || k.sourceId.startsWith('PF-')).length; return yn(n > 0, `${n} proses KC`); }
    case 'kc-cp': { const b = p.kcs.filter((k) => k.status === 'Approved' && !p.controlPlan.some((c) => c.kcId === k.id)).map((k) => k.id); return yn(!b.length && p.kcs.some((k) => k.status === 'Approved'), b.length ? `KP’de olmayan: ${b.join(', ')}` : 'Onaylı KC’ler KP’de'); }
    case 'pfd-types': { const b = p.processSteps.filter((s) => !s.stepType?.length).map((s) => s.id); return yn(p.processSteps.length > 0 && !b.length, b.length ? `Tipi yok: ${b.join(', ')}` : 'Tüm adımların tipi var'); }
    case 'pf-steps': { const b = pfSteps(p); return yn(p.processSteps.length > 0 && !b.length, b.length ? `PFMEA’sız adım: ${b.join(', ')}` : 'Her adımda PFMEA var'); }
    case 'pf-released': { const b = p.pfmea.filter((x) => x.stage === 'Preliminary').map((x) => x.id); return yn(p.pfmea.length > 0 && !b.length, b.length ? `Ön PFMEA: ${b.join(', ')}` : 'Ön PFMEA satırı yok'); }
    case 'cp-prelaunch': { const n = cpRowsIn(p, 'Pre-launch').length; return yn(n > 0, `${n} Pre-launch satırı`); }
    case 'cp-production': { const n = cpRowsIn(p, 'Production').length; return yn(n > 0, `${n} Production satırı`); }
    case 'msa-plan': { const b = p.controlPlan.filter((c) => c.kcId && !p.msa.some((m) => m.cpId === c.id || m.kcId === c.kcId)).map((c) => c.id); return yn(p.msa.length > 0 && !b.length, b.length ? `MSA’sız KC satırı: ${b.join(', ')}` : `${p.msa.length} MSA kaydı`); }
    case 'msa-ok': { const b = p.msa.filter((m) => m.status !== 'Acceptable').map((m) => m.id); return yn(p.msa.length > 0 && !b.length, b.length ? `Kabul edilmemiş: ${b.join(', ')}` : 'Tüm MSA kabul'); }
    case 'cap-valid': { const r = capValid(p); const b = r.filter((x) => x.a.verdict !== 'VALID').map((x) => x.c.id); return yn(r.length > 0 && !b.length, b.length ? `Geçerli değil: ${b.join(', ')}` : `${r.length} çalışma VALID`); }
    case 'pack-approved': return yn(packagingApproved(p), packagingApproved(p) ? 'Müşteri onayı kayıtlı' : packagingIssues(p).join('; ') || 'Onay yok');
    case 'prr-actions': { const b = prrBlockers(p); return yn(!b.length, b.length ? `Açık: ${b.join(', ')}` : 'Açık aksiyon yok veya azaltma planı onaylı'); }
    case 'ppap-full': { const s = latestSubmission(p); return yn(s?.disposition === 'Full', s ? `Son karar: ${s.disposition || '—'}` : 'PPAP sunumu yok'); }
    case 'lessons': return yn(p.lessons.length > 0, `${p.lessons.length} ders`);
    case 'baseline-after-lessons': {
      const last = p.lessons.map((l) => l.date).filter(Boolean).sort().pop() ?? '';
      const b = p.baselines.some((x) => !last || x.date.slice(0, 10) >= last);
      return yn(p.baselines.length > 0 && b, b ? 'Derslerden sonra baseline var' : 'Son dersten sonra baseline yok');
    }
    default: return { answer: '', detail: '' };
  }
}

// ------------------------------------------------------------------ Red / Yellow / Green (SCMH 7.2.3 §6.1)
export interface RygResult {
  ryg: Ryg;
  why: string;
}

/**
 * Red: soru net "evet" değil ve kurtarma aksiyonu yok ya da teslim takvimine etki var.
 * Yellow: cevap "hayır" ama sağlam kurtarma planı var (takvime etki yok).
 * Green: tüm sorular "evet" ve plan dahilinde. Cevaplanmamış soru → değerlendirilmedi ('').
 * Zamanlama: hedef tarih geçmiş ve tamamlanmamış → kurtarma aksiyonu varsa Yellow, yoksa Red.
 */
export function elementRyg(el: ApqpElement, now = today()): RygResult {
  if (el.required !== 'Y') return { ryg: '', why: el.required === 'N' ? 'Gerekli değil' : 'Gereklilik kararı verilmedi' };
  if (el.scheduleImpact) return { ryg: 'Red', why: 'Teslim takvimine etki var' };
  const no = el.checklist.filter((c) => c.answer === 'N');
  if (no.some((c) => !has(c.action) && !has(el.recoveryAction))) return { ryg: 'Red', why: `Kurtarma aksiyonu olmayan “Hayır”: ${no.filter((c) => !has(c.action)).map((c) => c.q).join(' / ')}` };
  const late = !!el.targetDate && el.targetDate < now && el.status !== 'Complete';
  if (late && !has(el.recoveryAction)) return { ryg: 'Red', why: `Hedef tarih (${el.targetDate}) geçti, kurtarma aksiyonu yok` };
  if (no.length) return { ryg: 'Yellow', why: `${no.length} “Hayır” cevabı, kurtarma planı var` };
  if (late) return { ryg: 'Yellow', why: `Hedef tarih geçti, kurtarma aksiyonu var` };
  const open = el.checklist.filter((c) => !c.answer);
  if (open.length || (!el.checklist.length && el.status !== 'Complete' && el.status !== 'In work')) return { ryg: '', why: open.length ? `${open.length} soru cevaplanmadı` : 'Kontrol sorusu yok; durum girilmedi' };
  return { ryg: 'Green', why: el.checklist.length ? 'Tüm sorular evet / NA' : `Durum: ${el.status}` };
}

const RYG_RANK: Record<Ryg, number> = { '': 0, Green: 1, Yellow: 2, Red: 3 };
export function worstRyg(list: Ryg[]): Ryg {
  return list.reduce<Ryg>((w, r) => (RYG_RANK[r] > RYG_RANK[w] ? r : w), '');
}

export function phaseRyg(p: Project, phase: number, now = today()): Ryg {
  return worstRyg(apqpOf(p).elements.filter((e) => CATALOG_BY_KEY[e.key]?.phase === phase).map((e) => elementRyg(e, now).ryg));
}

export function milestoneStatus(p: Project, key: string, now = today()): Ryg {
  const m = apqpOf(p).milestones.find((x) => x.key === key);
  if (!m || !m.planned) return '';
  if (m.actual) return 'Green';
  return m.planned < now ? 'Red' : '';
}

// ------------------------------------------------------------------ ambalaj (7.2.20)
export function packagingIssues(p: Project): string[] {
  const k = apqpOf(p).packaging;
  const out: string[] = [];
  if (!k.basis) out.push('Ambalaj gereksinim temeli seçilmedi');
  if (k.basis === 'Customer unique' && !has(k.customerSpec)) out.push('Müşteriye özel ambalaj spesifikasyonu yok');
  const open = k.items.filter((i) => !i.custom && !i.answer);
  if (open.length) out.push(`${open.length} madde cevaplanmadı`);
  const no = k.items.filter((i) => i.answer === 'No');
  if (no.length) out.push(`“Hayır” cevaplı madde: ${no.map((i) => i.label).join(', ')}`);
  return out;
}

export const packagingApproved = (p: Project) => {
  const k = apqpOf(p).packaging;
  return has(k.customerApprover) && !!k.approvalDate && packagingIssues(p).length === 0;
};

export function packagingApprovalError(p: Project): string {
  const i = packagingIssues(p);
  return i.length ? `Müşteri onayı kaydedilemez: ${i.join('; ')}.` : '';
}

/** "Hayır" cevaplı maddeler için paketleme adımına PFMEA taslak önerileri (ENGINEERING SUGGESTION; S/O/D boş). */
const PACK_FM: Record<string, string> = {
  unique: 'Müşteriye özel ambalaj gereksinimi karşılanmıyor',
  cleanliness: 'Ambalajlama sırasında kirlenme (contamination)',
  preservation: 'Yetersiz koruma (korozyon / bozulma)',
  cushioning: 'Yetersiz yastıklama – taşıma hasarı',
  unit: 'Birim ambalaj uygunsuz',
  intermediate: 'Ara ambalaj uygunsuz',
  unitization: 'Birimleştirme uygunsuz – taşıma hasarı',
  labeling: 'Yanlış / eksik ambalaj etiketi',
  esd: 'ESD hasarı',
  msd: 'Nem alma (neme duyarlı parça)',
  desiccant: 'Kurutucu eksik / etkisiz – nem alma',
  environment: 'Çevresel etkiye (ışık vb.) maruz kalma',
};
export function packagingPfmeaDrafts(p: Project): Partial<PfmeaRow>[] {
  const step = p.processSteps.find((s) => /packag|ambalaj/i.test(s.name));
  return apqpOf(p).packaging.items
    .filter((i) => i.answer === 'No' && PACK_FM[i.key])
    .filter((i) => !p.pfmea.some((x) => x.failureMode === PACK_FM[i.key]))
    .map((i) => ({
      stepId: step?.id ?? '',
      failureMode: PACK_FM[i.key],
      source: 'SCMH 7.2.20 ambalaj onay formu',
      dataStatus: 'ENGINEERING SUGGESTION – VERIFY',
      origin: 'template',
      notes: `7.2.20 “${i.label}” = Hayır. S/O/D mühendis tarafından puanlanmalı.`,
    }));
}

// ------------------------------------------------------------------ PPAP
export const latestSubmission = (p: Project): PpapSubmission | undefined => apqpOf(p).ppap.submissions[apqpOf(p).ppap.submissions.length - 1];
/** Son geçerli onay (Full / Interim) tarihi. */
export function ppapApprovedDate(p: Project): string {
  const s = [...apqpOf(p).ppap.submissions].reverse().find((x) => x.disposition === 'Full' || x.disposition === 'Interim');
  return s?.date ?? '';
}

export function submissionError(s: PpapSubmission): string {
  if (!s.recordedBy.trim()) return 'Kaydeden kullanıcı adı zorunludur (Ayarlar).';
  if (!s.disposition) return 'Karar (Full / Interim / Rejected) seçilmelidir.';
  if (!s.date) return 'Karar tarihi zorunludur.';
  if (!has(s.customerApprover)) return 'Müşteri tarafında kararı veren kişi zorunludur.';
  if (s.disposition !== 'Rejected' && !has(s.writtenApprovalRef)) return 'Yazılı onay referansı zorunludur (yazılı onay olmadan sevkiyat yapılmaz).';
  if (s.disposition === 'Interim' && (!has(s.interimUntil) || !has(s.reasons))) return 'Interim onay için süre/miktar sınırı ve gerekçe zorunludur.';
  if (s.disposition === 'Rejected' && !has(s.reasons)) return 'Ret gerekçesi zorunludur.';
  return '';
}

/** Değişiklik talepleri PPAP yeniden sunumu gerektiriyor mu (etkilenen tablolar). */
const PPAP_TABLES: TableKey[] = ['documents', 'requirements', 'structure', 'dfmea', 'processSteps', 'pfmea', 'kcs', 'controlPlan', 'processParams', 'msa', 'capability'];
export function crTouchesPpap(cr: ChangeRequestRow): boolean {
  return cr.impactedIds.some((id) => PPAP_TABLES.some((t) => id.startsWith(`${({ documents: 'DOC', requirements: 'REQ', structure: 'FN', dfmea: 'DF', processSteps: 'OP', pfmea: 'PF', kcs: 'KC', controlPlan: 'CP', processParams: 'PP', msa: 'MSA', capability: 'CAP' } as Record<string, string>)[t]}-`)));
}

export interface Resubmission {
  required: boolean;
  reasons: string[];
}
/** Yeniden sunum: son karar Interim / Rejected, veya PPAP onayından sonra uygulanan ürün/proses değişikliği (webinar s.38). */
export function ppapResubmission(p: Project): Resubmission {
  const reasons: string[] = [];
  const s = latestSubmission(p);
  if (s?.disposition === 'Interim') reasons.push(`Son karar Interim (${s.interimUntil || 'sınır yok'})`);
  if (s?.disposition === 'Rejected') reasons.push('Son karar Rejected');
  const flagged = p.changeRequests.filter((c) => c.ppapResubmission && c.status === 'Implemented');
  if (flagged.length) reasons.push(`PPAP sonrası uygulanan değişiklik: ${flagged.map((c) => c.id).join(', ')}`);
  return { required: reasons.length > 0, reasons };
}

/** Sevkiyat için yazılı ve geçerli PPAP onayı var mı (webinar s.15, s.37). */
export function shipmentAllowed(p: Project): { ok: boolean; why: string } {
  const s = latestSubmission(p);
  if (!s) return { ok: false, why: 'PPAP sunumu/kararı yok' };
  if (s.disposition === 'Full' && has(s.writtenApprovalRef)) return { ok: true, why: `Full onay (${s.date})` };
  if (s.disposition === 'Interim' && has(s.writtenApprovalRef)) return { ok: true, why: `Interim onay – sınır: ${s.interimUntil}` };
  return { ok: false, why: `Son karar: ${s.disposition || '—'}` };
}

export interface Readiness {
  no: number;
  ok: boolean;
  detail: string;
  ids: string[];
}

/** Gereksinimin kontrol planındaki karşılığı: DF.reqIds → KC → KP, PF.dfIds → DF.reqIds, veya referans/karakteristik metni. */
export function requirementInCp(p: Project, r: RequirementRow): boolean {
  const dfs = new Set(p.dfmea.filter((d) => d.reqIds.includes(r.id)).map((d) => d.id));
  const pfs = new Set(p.pfmea.filter((x) => x.dfIds.some((d) => dfs.has(d))).map((x) => x.id));
  const kcs = new Set(p.kcs.filter((k) => dfs.has(k.sourceId) || pfs.has(k.sourceId)).map((k) => k.id));
  return p.controlPlan.some((c: ControlPlanRow) =>
    kcs.has(c.kcId) || pfs.has(c.pfId) || (has(c.reference) && (c.reference.includes(r.id) || (!!r.balloon && c.reference.includes(r.balloon)))));
}

/** PPAP elemanı için hazırlık kontrolü (öneri). */
export function ppapReadiness(p: Project): Readiness[] {
  const out: Readiness[] = [];
  const st = (no: number) => apqpOf(p).ppap.elements.find((e) => e.no === no);
  const r = (no: number, ok: boolean, detail: string, ids: string[] = []) => out.push({ no, ok, detail, ids });
  const reqs = p.requirements.filter((x) => x.lsl != null || x.usl != null);
  const notInCp = reqs.filter((x) => !requirementInCp(p, x)).map((x) => x.id);
  r(1, p.requirements.length > 0 && notInCp.length === 0,
    notInCp.length ? `LSL/USL’li ${notInCp.length} gereksinim kontrol planında yok (“tüm karakteristikler” – ret nedeni)` : `${p.requirements.length} gereksinim; toleranslıların hepsi KP’de`, notInCp);
  const dfh = highNoAction(p.dfmea);
  r(2, p.dfmea.length > 0 && deliverableApproved(p, 'DFMEA') && !dfh.length, [deliverableApproved(p, 'DFMEA') ? 'DFMEA onaylı' : 'DFMEA onayı eksik', dfh.length ? `aksiyonsuz S≥9: ${dfh.join(', ')}` : ''].filter(Boolean).join('; '), dfh);
  const noType = p.processSteps.filter((s) => !s.stepType?.length).map((s) => s.id);
  r(3, p.processSteps.length > 0 && !noType.length && deliverableApproved(p, 'PFD'), [deliverableApproved(p, 'PFD') ? 'PFD onaylı' : 'PFD onayı eksik', noType.length ? `adım tipi yok: ${noType.join(', ')}` : ''].filter(Boolean).join('; '), noType);
  const pfh = [...highNoAction(p.pfmea), ...pfSteps(p), ...p.pfmea.filter((x) => x.stage === 'Preliminary').map((x) => x.id)];
  r(4, p.pfmea.length > 0 && deliverableApproved(p, 'PFMEA') && !pfh.length, [deliverableApproved(p, 'PFMEA') ? 'PFMEA onaylı' : 'PFMEA onayı eksik', pfh.length ? `eksik: ${pfh.join(', ')}` : ''].filter(Boolean).join('; '), pfh);
  const usesPhases = p.controlPlan.some((c) => c.phases?.length);
  const prod = usesPhases ? cpRowsIn(p, 'Production').length : p.controlPlan.length;
  const kcMiss = p.kcs.filter((k) => k.status === 'Approved' && !p.controlPlan.some((c) => c.kcId === k.id)).map((k) => k.id);
  r(5, prod > 0 && deliverableApproved(p, 'CP') && !kcMiss.length, [`${prod} üretim KP satırı`, deliverableApproved(p, 'CP') ? 'KP onaylı' : 'KP onayı eksik', kcMiss.length ? `KP’de olmayan KC: ${kcMiss.join(', ')}` : ''].filter(Boolean).join('; '), kcMiss);
  const msaBad = p.msa.filter((m) => m.status !== 'Acceptable' || !/\d/.test(m.result)).map((m) => m.id);
  r(6, p.msa.length > 0 && !msaBad.length, msaBad.length ? `Kabul/sayısal sonuç eksik: ${msaBad.join(', ')} (“değişken veri sayısal sonuçla verilmeli”)` : `${p.msa.length} MSA kabul, sayısal sonuçlu`, msaBad);
  // Eleman 7: üretim koşusu verisi + VALID (cap akışının kuralı; PPAP webinar s.26)
  const caps = p.capability.filter((c) => c.kcId);
  const capBad = caps.filter((c) => !isPpapCapabilityEvidence(c, p.settings)).map((c) => c.id);
  r(7, caps.length > 0 && !capBad.length, capBad.length ? `PPAP kanıtı olmayan (üretim koşusu + VALID değil): ${capBad.join(', ')} (kabul bandı Capability ekranında)` : `${caps.length} çalışma üretim koşusu verisiyle VALID`, capBad);
  r(8, packagingApproved(p), packagingApproved(p) ? '7.2.20 müşteri onayı kayıtlı' : packagingIssues(p).join('; ') || 'Müşteri onayı yok');
  r(9, has(st(9)?.ref), has(st(9)?.ref) ? `FAIR: ${st(9)!.ref}` : 'FAIR (AS9102) referansı girilmedi (dış kayıt)');
  r(10, has(st(10)?.ref), has(st(10)?.ref) ? `CSR: ${st(10)!.ref}` : 'Müşteriye özel gereksinim kaydı referansı yok');
  const s = latestSubmission(p);
  r(11, s?.disposition === 'Full', s ? `Son karar: ${s.disposition}` : 'Karar kaydı yok');
  return out;
}

/** Açık FMEA aksiyonu varsa Interim gerekçesi önerisi (webinar s.35). Öneridir; kararı müşteri verir. */
export function interimReasonSuggestion(p: Project): string {
  const m = mitigatedOpenActions(p);
  return m.length ? `Open actions from PFMEA with approved mitigation plan: ${m.join(', ')} (ENGINEERING SUGGESTION)` : '';
}

// ------------------------------------------------------------------ ekip ve kriterler
/**
 * Fonksiyon kapsaması. PFMEA: "manufacturing and quality engineers, operations personnel" (7.2.3 s.60) ve
 * tasarım mühendisi (Q&A s.2 Q11). DFMEA: tasarım + üretim uzmanı (Q11) + kalite (gap-manuals G11 önerisi).
 */
export const REQUIRED_FUNCTIONS: Record<'DFMEA' | 'PFMEA', string[]> = {
  DFMEA: ['Design', 'Manufacturing', 'Quality'],
  PFMEA: ['Manufacturing', 'Quality', 'Operations', 'Design'],
};
export function teamGaps(p: Project): { fmea: 'DFMEA' | 'PFMEA'; missing: string[] }[] {
  const t = apqpOf(p).team;
  return (['DFMEA', 'PFMEA'] as const)
    .filter((f) => (f === 'DFMEA' ? p.dfmea.length : p.pfmea.length) > 0)
    .map((f) => ({ fmea: f, missing: REQUIRED_FUNCTIONS[f].filter((fn) => !t.some((m) => m.function === fn && (m.fmea.length === 0 || m.fmea.includes(f)))) }))
    .filter((g) => g.missing.length);
}
/** SCMH başlığındaki "Cross Functional Team Members & Function" metni (DRA webinar s.40 örneği). */
export const teamText = (p: Project) => apqpOf(p).team.filter((m) => has(m.name)).map((m) => `${m.name} (${m.function || '—'})`).join(', ');

export const criteriaAgreed = (p: Project) => {
  const c = apqpOf(p).criteriaAgreement;
  return !!c.date && has(c.members) && !!c.source;
};

// ------------------------------------------------------------------ DFMEA zamanlaması (DRA webinar s.38)
export function dfmeaTiming(p: Project, now = today()): { ok: boolean; detail: string } {
  const a = apqpOf(p);
  if (!a.designReleaseDate) return { ok: true, detail: 'Tasarım serbest bırakma tarihi girilmedi' };
  const at = deliverableApprovedAt(p, 'DFMEA').slice(0, 10);
  if (at && at <= a.designReleaseDate) return { ok: true, detail: `DFMEA ${at} tarihinde onaylandı (design release ${a.designReleaseDate})` };
  if (at) return { ok: false, detail: `DFMEA design release (${a.designReleaseDate}) sonrasında onaylandı (${at})` };
  return a.designReleaseDate <= now
    ? { ok: false, detail: `Design release (${a.designReleaseDate}) geçti, DFMEA onayı yok` }
    : { ok: true, detail: `Design release ${a.designReleaseDate}; DFMEA onayı bekleniyor` };
}

// ------------------------------------------------------------------ FMEA güncelleme tetikleyicileri (engine kuralı)
export const isUpdateTrigger = (l: Pick<LessonRow, 'sourceType'>) => UPDATE_TRIGGER_SOURCES.includes(l.sourceType);
export function lessonReassessText(l: LessonRow): string {
  return `FMEA Reassessment Required – ${l.id} (${l.sourceType}${l.reference ? ' ' + l.reference : ''}): O/D gözlenen oluşum ve tespitle uyumlu mu?`;
}

// ------------------------------------------------------------------ CP fazları ve SCMH dışa aktarma
/** Satırlar faz atanmışsa her faz için ayrı bir KP projesi. Fazsız satırlar her fazda yer alır. */
export function cpPhaseVariants(p: Project): { phase: string; project: Project }[] {
  const used = [...new Set(p.controlPlan.flatMap((c) => c.phases ?? []))];
  const order = ['Prototype', 'Pre-launch', 'Production'];
  return order.filter((ph) => used.includes(ph as never)).map((phase) => ({
    phase,
    project: {
      ...p,
      // SCMH 7.2.13 şablonunda yalnızca Pre-Production / Production kutusu var; Prototype → Pre-Production.
      meta: { ...p.meta, scmhPhase: phase === 'Production' ? 'Production' : 'Pre-Production' },
      controlPlan: p.controlPlan.filter((c) => !c.phases?.length || c.phases.includes(phase as never)),
    },
  }));
}

/** "Pre-launch → Production" yükseltme farkı: yalnızca ön üretimde olan satırlar. */
export function cpPromotionCandidates(p: Project): string[] {
  return p.controlPlan.filter((c) => c.phases?.includes('Pre-launch') && !c.phases.includes('Production')).map((c) => c.id);
}

// ------------------------------------------------------------------ aile / yeniden kullanım (7.2.3 s.32, DRA webinar s.38, PPAP s.8)
/**
 * Mevcut bir .fmea projesinden yapı, fonksiyon, hata modu, neden ve proses akışı/KP iskeletini kopyalar.
 * S/O/D kopyalanmaz (yeniden puanlanır); kaynak "template" ve veri durumu VERİ YOK olur. ID'ler yeniden verilir.
 */
export function reuseRows(target: Project, src: Project, opts: { dfmea: boolean; process: boolean }): { table: TableKey; row: AnyRow }[] {
  const out: { table: TableKey; row: AnyRow }[] = [];
  const draft = structuredClone(target);
  const map = new Map<string, string>();
  const put = (table: TableKey, oldId: string, data: Record<string, unknown>) => {
    const id = nextId(draft, table);
    map.set(oldId, id);
    const row = { ...blankRow(table, id), ...data, id, origin: 'template' } as AnyRow;
    (draft[table] as AnyRow[]).push(row);
    out.push({ table, row });
  };
  const ref = (id: string) => map.get(id) ?? '';
  const note = `Yeniden kullanım: ${src.meta.partNumber || src.meta.name || 'kaynak FMEA'} – S/O/D yeniden puanlanmalı`;
  if (opts.dfmea) {
    for (const s of src.structure) put('structure', s.id, { level: s.level, element: s.element, function: s.function, functionType: s.functionType, performanceReq: s.performanceReq, constraint: s.constraint, interface: s.interface, notes: note });
    for (const s of out.filter((o) => o.table === 'structure')) {
      const old = src.structure.find((x) => map.get(x.id) === s.row.id);
      if (old?.parentId) (s.row as unknown as { parentId: string }).parentId = ref(old.parentId);
    }
    for (const d of src.dfmea)
      put('dfmea', d.id, { system: d.system, subsystem: d.subsystem, component: d.component, functionId: ref(d.functionId), function: d.function, failureMode: d.failureMode, effect: d.effect, localEffect: d.localEffect, higherEffect: d.higherEffect, cause: d.cause, prevention: d.prevention, detection: d.detection, dataStatus: 'VERİ YOK – doğrulanmalı', notes: note });
  }
  if (opts.process) {
    for (const s of src.processSteps) put('processSteps', s.id, { opNo: s.opNo, name: s.name, description: s.description, machine: s.machine, tool: s.tool, specialProcess: s.specialProcess, stepType: [...(s.stepType ?? [])], stepTypeOther: s.stepTypeOther, notes: note });
    for (const x of src.pfmea)
      put('pfmea', x.id, { stepId: ref(x.stepId), opNo: x.opNo, stepName: x.stepName, processFunction: x.processFunction, productRequirement: x.productRequirement, processRequirement: x.processRequirement, failureMode: x.failureMode, effect: x.effect, cause: x.cause, cause4M: x.cause4M, prevention: x.prevention, detection: x.detection, errorProofing: x.errorProofing, measurement: x.measurement, dfIds: x.dfIds.map(ref).filter(Boolean), stage: 'Preliminary', dataStatus: 'VERİ YOK – doğrulanmalı', notes: note });
    for (const c of src.controlPlan)
      put('controlPlan', c.id, { stepId: ref(c.stepId), pfId: ref(c.pfId), productChar: c.productChar, processChar: c.processChar, charType: c.charType, method: c.method, gauge: c.gauge, sampleSize: c.sampleSize || 'VERİ YOK – doğrulanmalı', frequency: c.frequency || 'VERİ YOK – doğrulanmalı', controlMethod: c.controlMethod, reactionPlan: c.reactionPlan, specification: 'VERİ YOK – doğrulanmalı', phases: [], notes: note });
  }
  return out;
}

// ------------------------------------------------------------------ olgunluk matrisi kanıtı (7.2.14 Data!J31–J37)
export function maturityEvidence(p: Project): { item: string; text: string }[] {
  const pct = (a: number, b: number) => (b ? `%${Math.round((a / b) * 100)}` : 'veri yok');
  const dfLinked = p.dfmea.filter((d) => p.pfmea.some((x) => x.dfIds.includes(d.id))).length;
  const pfCp = p.pfmea.filter((x) => p.controlPlan.some((c) => c.pfId === x.id)).length;
  const stepPf = p.processSteps.filter((s) => p.pfmea.some((x) => x.stepId === s.id)).length;
  const llRows = new Set(p.lessons.flatMap((l) => l.linkedFmeaIds)).size;
  const trig = p.lessons.filter((l) => isUpdateTrigger(l) && l.linkedFmeaIds.length).length;
  const appr = p.kcs.filter((k) => k.status === 'Approved');
  const kcCp = appr.filter((k) => p.controlPlan.some((c) => c.kcId === k.id)).length;
  const kcPf = appr.filter((k) => k.sourceId.startsWith('PF-') || p.pfmea.some((x) => x.dfIds.includes(k.sourceId))).length;
  const kcCap = appr.filter((k) => p.capability.some((c) => c.kcId === k.id)).length;
  const caps = capValid(p);
  const msaOk = p.msa.filter((m) => m.status === 'Acceptable').length;
  const ppKc = p.processParams.filter((pp) => p.controlPlan.some((c) => c.ppId === pp.id && c.kcId)).length;
  const src = 'FMEA Studio proje verisi (puan değerlendiricinin)';
  return [
    { item: '4.1', text: `DFMEA→PFMEA bağlantı ${pct(dfLinked, p.dfmea.length)}, PFD adımı→PFMEA ${pct(stepPf, p.processSteps.length)}, PFMEA→KP ${pct(pfCp, p.pfmea.length)}; derslere bağlı FMEA satırı ${llRows}; NCR/üretim kaynaklı güncelleme tetikleyicisi ${trig}. ${src}` },
    { item: '4.2', text: `${p.processSteps.length} PFD adımı; tipi tanımlı ${pct(p.processSteps.filter((s) => s.stepType?.length).length, p.processSteps.length)}; PFD onayı ${deliverableApproved(p, 'PFD') ? 'var' : 'yok'}. ${src}` },
    { item: '4.3', text: `${p.controlPlan.length} KP satırı; KC’li ${p.controlPlan.filter((c) => c.kcId).length}; fazlar: ${[...new Set(p.controlPlan.flatMap((c) => c.phases ?? []))].join(', ') || 'atanmadı'}; KP onayı ${deliverableApproved(p, 'CP') ? 'var' : 'yok'}. ${src}` },
    { item: '4.4', text: `${p.msa.length} MSA kaydı; kabul edilen ${msaOk}. ${src}` },
    { item: '4.5', text: `Onaylı KC ${appr.length}: KP’de ${pct(kcCp, appr.length)}, PFMEA’da ${pct(kcPf, appr.length)}, capability kaydı ${pct(kcCap, appr.length)}. ${src}` },
    { item: '4.6', text: `KC’ye bağlı proses parametresi ${ppKc}/${p.processParams.length}; proses KC ${p.kcs.filter((k) => k.kcClass === 'KC-3 Process KC').length}. ${src}` },
    { item: '4.7', text: `Capability çalışması ${caps.length}; VALID (normallik + kararlılık + örnek) ${caps.filter((c) => c.a.verdict === 'VALID').length}. ${src}` },
  ];
}

// ------------------------------------------------------------------ kalite kontrolleri (checks.ts'e eklenir)
export function apqpChecks(p: Project): CheckResult[] {
  const out: CheckResult[] = [];
  const a = apqpOf(p);
  if (!a) return out;
  const add = (key: string, question: string, weight: number, bad: string[], okDetail: string, badDetail: (n: number) => string) =>
    out.push({ key, question, weight, ok: bad.length === 0, ids: bad, detail: bad.length ? badDetail(bad.length) : okDetail });
  const teamUsed = apqpActive(p) || a.team.length > 0;
  if (teamUsed) {
    const g = teamGaps(p);
    add('team-coverage', 'FMEA ekibi gerekli fonksiyonları kapsıyor mu?', 5, g.map((x) => `${x.fmea}: ${x.missing.join(', ')}`), 'Ekip fonksiyon kapsaması tamam', () => `Eksik fonksiyon: ${g.map((x) => `${x.fmea} → ${x.missing.join(', ')}`).join('; ')}`);
    const scored = [...p.dfmea, ...p.pfmea].some((r) => r.s != null || r.o != null || r.d != null);
    if (scored) add('criteria-agreed', 'S/O/D kriterleri puanlamadan önce ekipçe kabul edildi mi?', 4, criteriaAgreed(p) ? [] : ['criteriaAgreement'], `Kriter anlaşması ${a.criteriaAgreement.date}`, () => 'Puanlama var ama kriter anlaşması kaydı yok (DRA Q&A Q6)');
  }
  if (!apqpActive(p)) return out;
  const mand = a.elements.filter((e) => applicabilityOf(CATALOG_BY_KEY[e.key] ?? ({} as ApqpCatalogItem), a.projectType) === 'Mandatory');
  add('apqp-mandatory-n', 'Zorunlu APQP teslimatları gerekçesiz “gerekli değil” işaretlenmiş mi?', 8,
    mand.filter((e) => e.required === 'N' && !has(e.reason)).map((e) => e.key), 'Zorunlu teslimat gerekçesiz kapatılmamış', (n) => `${n} zorunlu teslimat gerekçesiz “N”`);
  add('apqp-undecided', 'Zorunlu APQP teslimatları için gereklilik kararı verilmiş mi?', 4,
    mand.filter((e) => !e.required).map((e) => e.key), 'Tüm zorunlu teslimatlar kararlı', (n) => `${n} zorunlu teslimat için Y/N kararı yok`);
  add('apqp-owner', 'Gerekli APQP elemanlarının sorumlusu ve hedef tarihi var mı?', 4,
    a.elements.filter((e) => e.required === 'Y' && (!has(e.assignedTo) || !e.targetDate)).map((e) => e.key), 'Sorumlu ve tarih tamam', (n) => `${n} gerekli elemanın sorumlusu/tarihi yok`);
  add('apqp-red', 'Kırmızı (Red) APQP elemanı var mı?', 5,
    a.elements.filter((e) => elementRyg(e).ryg === 'Red').map((e) => e.key), 'Red eleman yok', (n) => `${n} eleman Red`);
  const dl = (['DFMEA', 'PFMEA', 'PFD', 'CP'] as Deliverable[]).filter((d) => deliverableHasContent(p, d) && !deliverableApproved(p, d));
  add('deliverable-approval', 'DFMEA / PFMEA / PFD / KP teslimat onayları tamamlandı mı?', 4, dl, 'Tüm içerikli teslimatlar onaylı', () => `Onayı eksik: ${dl.join(', ')}`);
  const t = dfmeaTiming(p);
  add('dfmea-timing', 'DFMEA tasarım serbest bırakılmadan önce tamamlandı mı?', 4, t.ok ? [] : ['DFMEA'], t.detail, () => t.detail);
  const prelim = p.pfmea.filter((x) => x.stage === 'Preliminary').map((x) => x.id);
  if (a.prr.decision === 'Passed' || deliverableApproved(p, 'PFMEA'))
    add('pfmea-preliminary', 'PRR / PFMEA onayı sonrası ön (Preliminary) PFMEA satırı kaldı mı?', 3, prelim, 'Ön PFMEA satırı yok', (n) => `${n} satır hâlâ Preliminary`);
  const b = prrBlockers(p);
  add('prr-open-actions', 'Açık FMEA aksiyonları kapatıldı veya onaylı azaltma planına bağlandı mı (PRR)?', 6, b, 'PRR kapısı açık', (n) => `${n} açık aksiyon PRR’yi engelliyor`);
  const rs = ppapResubmission(p);
  if (a.ppap.submissions.length) add('ppap-resubmission', 'PPAP yeniden sunumu gerekiyor mu?', 5, rs.required ? ['PPAP'] : [], 'Yeniden sunum gerekmiyor', () => rs.reasons.join('; '));
  const pk = elementOf(p, '3.11');
  if (pk?.required === 'Y') add('packaging-approval', '7.2.20 ambalaj/koruma/etiketleme onayı alındı mı?', 4, packagingApproved(p) ? [] : ['3.11'], 'Müşteri onayı kayıtlı', () => packagingIssues(p).join('; ') || 'Müşteri onayı yok');
  const lo = p.lessons.filter((l) => isUpdateTrigger(l) && !l.linkedFmeaIds.length).map((l) => l.id);
  add('update-triggers', 'NCR / üretim koşusu / iyileştirme kayıtları FMEA satırlarına bağlandı mı?', 3, lo, 'Tüm tetikleyici kayıtlar FMEA’ya bağlı', (n) => `${n} tetikleyici ders FMEA satırına bağlı değil`);
  return out;
}

export const APQP_SOURCE_NOTE = 'Kontrol soruları uygulama tarafından yazılmıştır; SCMH 7.2.5–7.2.7 kontrol listesi soru metinlerinin yerine geçmez.';
