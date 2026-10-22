// VERİ YOK içeren gereksinimler için otomatik açık konu (Open Engineering Issue).
// Eksik bilgi uydurulmaz; kaynaktan / müşteriden istenmek üzere açık konu olarak izlenir.
import { blankRow, nextId } from './model';
import { NO_DATA } from './reqAutofill';
import type { AnyRow, DfmeaRow, IssueRow, Project, RequirementRow } from './types';

const MARK = 'VERİ YOK';
export const REQ_ISSUE_FIELDS: [keyof RequirementRow, string][] = [
  ['acceptance', 'kabul kriteri'],
  ['verification', 'doğrulama yöntemi'],
  ['tolerance', 'tolerans'],
  ['dataStatus', 'veri durumu'],
];
export const REQ_ISSUE_TRIGGERS = ['text', 'reqType', 'approval', 'source', ...REQ_ISSUE_FIELDS.map(([f]) => f as string)];
const AUTO_CLOSE = 'Gereksinimde VERİ YOK alanı kalmadı (otomatik kapatıldı) – mühendis doğrulamalı';

/** Gereksinimin VERİ YOK içeren alanlarının adları. Reddedilen gereksinim için boş. */
export function reqMissing(r: RequirementRow): string[] {
  if (r.approval === 'Rejected') return [];
  return REQ_ISSUE_FIELDS.filter(([f]) => String(r[f] ?? '').includes(MARK)).map(([, l]) => l);
}

export function reqIssueOf(issues: IssueRow[], reqId: string): IssueRow | undefined {
  return issues.find((i) => i.autoReqId === reqId);
}

export function reqIssueData(r: RequirementRow, missing: string[], dfmea: DfmeaRow[]): Partial<IssueRow> {
  const critical = r.reqType === 'Safety' || r.reqType === 'Regulatory';
  return {
    description: `${r.id}: ${missing.join(', ')} ${NO_DATA}. Gereksinim: “${r.text.trim()}”`,
    priority: critical ? 'Critical' : 'Important',
    source: r.source || r.id,
    risk: 'Eksik bilgiyle kabul kriteri, FMEA puanı ve kontrol planı kesinleştirilemez.',
    relatedReq: r.id,
    relatedFmea: dfmea.filter((d) => d.reqIds.includes(r.id)).map((d) => d.id).join(', '),
    recommendedAction: 'Eksik bilgiyi kaynaktan / müşteriden isteyin; gelince gereksinimi güncelleyin.',
    status: 'Open',
    origin: 'ai',
    autoReqId: r.id,
  };
}

interface Ops {
  p: Project;
  add(table: 'issues', row: Partial<AnyRow>, reason: string): string;
  set(table: 'issues', id: string, field: string, value: unknown, reason: string): void;
  del(table: 'issues', id: string, reason: string): void;
}

const closed = (i: IssueRow) => i.status === 'Resolved' || i.status === 'Closed';

/** Gereksinim değişince otomatik açık konuyu açar, günceller, kapatır veya yeniden açar. */
export function syncReqIssue(c: Ops, reqId: string) {
  const r = c.p.requirements.find((x) => x.id === reqId);
  const ex = reqIssueOf(c.p.issues, reqId);
  if (!r) {
    // Gereksinim silindi: dokunulmamış otomatik konu kaldırılır, üzerinde çalışılmışsa kalır.
    if (ex && !closed(ex) && !ex.answer.trim() && !ex.responsible.trim()) c.del('issues', ex.id, `${reqId} silindi; otomatik açık konu kaldırıldı`);
    return;
  }
  const missing = reqMissing(r);
  if (missing.length) {
    const data = reqIssueData(r, missing, c.p.dfmea);
    if (!ex) {
      c.add('issues', data as Partial<AnyRow>, `${reqId} içinde ${NO_DATA} → açık konu açıldı`);
      return;
    }
    if (closed(ex) && ex.answer === AUTO_CLOSE) {
      c.set('issues', ex.id, 'status', 'Open', `${reqId} yeniden ${MARK} içeriyor`);
      c.set('issues', ex.id, 'answer', '', `${reqId} yeniden ${MARK} içeriyor`);
    }
    if (!closed(c.p.issues.find((i) => i.id === ex.id)!)) c.set('issues', ex.id, 'description', data.description, `${reqId} eksik alanları değişti`);
    return;
  }
  if (ex && !closed(ex)) {
    c.set('issues', ex.id, 'status', 'Resolved', `${reqId} içinde ${MARK} kalmadı`);
    if (!ex.answer.trim()) c.set('issues', ex.id, 'answer', AUTO_CLOSE, `${reqId} içinde ${MARK} kalmadı`);
  }
}

/** Mevcut projeler için: açık konusu olmayan VERİ YOK gereksinimlerine konu satırı ekleme düzenlemeleri. */
export function missingReqIssueRows(p: Project): IssueRow[] {
  let q = p;
  const out: IssueRow[] = [];
  for (const r of p.requirements) {
    const missing = reqMissing(r);
    if (!missing.length || reqIssueOf(p.issues, r.id)) continue;
    const id = nextId(q, 'issues');
    const row = { ...blankRow('issues', id), ...reqIssueData(r, missing, p.dfmea), id } as IssueRow;
    q = { ...q, issues: [...q.issues, row] };
    out.push(row);
  }
  return out;
}
