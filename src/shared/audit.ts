// Audit Trail (§37): her onaylanan değişiklik kullanıcı, zaman, eski/yeni değer, neden ve revizyonla kaydedilir.
import type { Effect } from './engine';
import type { AuditEntry, Project } from './types';

export interface AuditMeta {
  user: string;
  reason?: string;
  comment?: string;
  kind?: AuditEntry['kind'];
  at?: string;
}

/** Denetim izinin büyümesini sınırlamak için uzun değerler kısaltılır. */
const clip = (v: unknown) => (typeof v === 'string' && v.length > 500 ? v.slice(0, 500) + '…' : v);

export function auditEntries(p: Project, effects: Effect[], meta: AuditMeta): AuditEntry[] {
  const at = meta.at ?? new Date().toISOString();
  return effects.map((e) => ({
    at,
    user: meta.user || '(kullanıcı adı girilmemiş)',
    kind: meta.kind ?? e.kind,
    table: e.table,
    id: e.id,
    field: e.field,
    from: clip(e.from),
    to: clip(e.to),
    reason: e.primary ? meta.reason || undefined : e.reason,
    comment: meta.comment || undefined,
    revision: p.meta.fmeaRevision,
  }));
}

export function withAudit(p: Project, entries: AuditEntry[]): Project {
  return entries.length ? { ...p, auditLog: [...p.auditLog, ...entries] } : p;
}

/** Değişiklikte neden sorulacak mı (§37 – Ayarlar › neden alanları). */
export function needsReason(p: Project, effects: Effect[]): boolean {
  return effects.some((e) => e.primary && e.kind === 'Modified' && !!e.field && p.settings.reasonFields.includes(e.field));
}
