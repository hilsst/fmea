// Satır sırası (yukarı/aşağı taşıma, sürükle-bırak) ve tablo onayı yardımcıları.
import type { AnyRow, Project, TableApproval, TableKey } from './types';

/**
 * Görünür satırlar arasında seçili satırları bir adım yukarı (-1) veya aşağı (+1) taşır.
 * Filtreyle gizli satırlar yerinde kalır; yalnızca görünür satırların kapladığı konumlar yeniden dağıtılır.
 * Sıra değişmezse null döner.
 */
export function moveRows<T extends AnyRow>(rows: T[], visibleIds: string[], selected: string[], dir: -1 | 1): T[] | null {
  const sel = new Set(selected);
  const order = [...visibleIds];
  const idx = order.map((_, i) => i);
  for (const i of dir === -1 ? idx : idx.reverse()) {
    const j = i + dir;
    if (j < 0 || j >= order.length || !sel.has(order[i]) || sel.has(order[j])) continue;
    [order[i], order[j]] = [order[j], order[i]];
  }
  return applyVisibleOrder(rows, visibleIds, order);
}

/** Sürükle-bırak: `moving` satırlarını görünür listede `targetId` satırının yerine (önüne/arkasına) koyar. */
export function moveRowsTo<T extends AnyRow>(rows: T[], visibleIds: string[], moving: string[], targetId: string): T[] | null {
  if (moving.includes(targetId)) return null;
  const mv = new Set(moving);
  const from = visibleIds.findIndex((id) => mv.has(id));
  const to = visibleIds.indexOf(targetId);
  if (from < 0 || to < 0) return null;
  const rest = visibleIds.filter((id) => !mv.has(id));
  const at = rest.indexOf(targetId) + (from < to ? 1 : 0); // aşağı sürüklenince hedefin arkasına
  const order = [...rest.slice(0, at), ...visibleIds.filter((id) => mv.has(id)), ...rest.slice(at)];
  return applyVisibleOrder(rows, visibleIds, order);
}

function applyVisibleOrder<T extends AnyRow>(rows: T[], visibleIds: string[], order: string[]): T[] | null {
  if (order.every((id, i) => id === visibleIds[i])) return null;
  const vis = new Set(visibleIds);
  const byId = new Map(rows.map((r) => [r.id, r]));
  let k = 0;
  return rows.map((r) => (vis.has(r.id) ? byId.get(order[k++])! : r));
}

export const TABLE_APPROVE_LABEL: Partial<Record<TableKey, string>> = {
  dfmea: "DFMEA'yı onayla",
  pfmea: "PFMEA'yı onayla",
  controlPlan: 'Kontrol Planını onayla',
};

/** Onaydan sonra bu tabloda yapılan değişiklik sayısı (denetim izinden). */
export function changesSinceApproval(p: Project, table: TableKey, a: TableApproval | undefined): number {
  if (!a) return 0;
  return p.auditLog.filter((e) => e.table === table && e.at > a.at && e.kind !== 'Approval').length;
}
