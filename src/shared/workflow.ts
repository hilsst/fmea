// Engineering Approval Workflow (§36). AI hiçbir adımı onaylayamaz; her karar kullanıcı adıyla kaydedilir.
import type { ApprovalRecord, Project, WorkflowStep } from './types';
import { prrGateError } from './apqp'; // v4-apqp

export function enabledSteps(p: Project): { step: WorkflowStep; role: string }[] {
  return p.settings.workflow.filter((w) => w.enabled);
}

/** Güncel revizyonda son "Returned/Rejected" sonrası onaylanmış adımlar. */
export function approvedSteps(p: Project): Set<WorkflowStep> {
  const rev = p.meta.fmeaRevision;
  const recs = p.approvals.filter((a) => a.revision === rev);
  let start = 0;
  recs.forEach((a, i) => {
    if (a.decision !== 'Approved') start = i + 1;
  });
  return new Set(recs.slice(start).filter((a) => a.decision === 'Approved').map((a) => a.step));
}

/** Sıradaki adım. 'AI Draft' insan onayı gerektirmez; taslak durumunu ifade eder. */
export function currentStep(p: Project): WorkflowStep | null {
  const done = approvedSteps(p);
  for (const s of enabledSteps(p)) if (s.step !== 'AI Draft' && !done.has(s.step)) return s.step;
  return null;
}

export interface DecisionInput {
  step: WorkflowStep;
  decision: ApprovalRecord['decision'];
  user: string;
  role: string;
  comment: string;
}

export function decisionError(p: Project, d: DecisionInput, openCritical: number): string {
  if (!d.user.trim()) return 'Onay için Ayarlar’da kullanıcı adı girilmelidir.';
  if (d.step !== currentStep(p)) return `Sıradaki adım ${currentStep(p) ?? '—'}; ${d.step} şu an karar verilemez.`;
  const need = p.settings.workflow.find((w) => w.step === d.step)?.role;
  if (need && d.role && need !== d.role && d.role !== 'Approver') return `${d.step} adımı ${need} rolü içindir (sizin rolünüz: ${d.role}).`;
  if (d.decision !== 'Approved' && !d.comment.trim()) return 'Ret / iade için yorum zorunludur.';
  if (d.decision === 'Approved' && (d.step === 'Final Approval' || d.step === 'Baseline') && openCritical > 0)
    return `${openCritical} kritik/emniyet/regülasyon kaydı hâlâ “AI Proposed” durumunda; önce tek tek değerlendirilmelidir.`;
  // v4-apqp: PRR kapısı – APQP projesinde açık FMEA aksiyonları kapatılmadan/azaltılmadan final onay ve baseline yok (SCMH 7.2.3 s.78)
  if (d.decision === 'Approved' && (d.step === 'Final Approval' || d.step === 'Baseline')) {
    const gate = prrGateError(p);
    if (gate) return gate;
  }
  return '';
}

export function recordDecision(p: Project, d: DecisionInput, at = new Date().toISOString()): Project {
  const rec: ApprovalRecord = { id: `APR-${String(p.approvals.length + 1).padStart(3, '0')}`, ...d, at, revision: p.meta.fmeaRevision };
  return { ...p, approvals: [...p.approvals, rec] };
}

/** Final onay öncesi tek tek değerlendirilmesi gereken AI kayıtları (§70). */
export function openCriticalAi(p: Project): string[] {
  const crit = (s: number | null, sc: string) => (s ?? 0) >= 9 || sc === 'Safety' || sc === 'Regulatory';
  return [
    ...p.dfmea.filter((r) => r.approval === 'AI Proposed' && crit(r.s, r.specialChar)).map((r) => r.id),
    ...p.pfmea.filter((r) => r.approval === 'AI Proposed' && crit(r.s, r.specialChar)).map((r) => r.id),
    ...p.kcs.filter((k) => k.status === 'AI Proposed' && ['Critical', 'Safety Characteristic', 'Regulatory Characteristic'].includes(k.category)).map((k) => k.id),
    ...p.requirements.filter((r) => r.approval === 'AI Proposed' && (r.reqType === 'Safety' || r.reqType === 'Regulatory')).map((r) => r.id),
  ];
}
