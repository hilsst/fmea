// Revision / Baseline (§35): baseline bir anlık görüntüdür; SHA-256 ile mühürlenir ve değiştirilemez.
import { ID_PREFIX, TABLE_LABEL } from './model';
import { sha256 } from './sha256';
import type { AnyRow, Baseline, Project, TableKey } from './types';

/** Snapshot içeriği: baseline listesi, denetim izi ve doküman indeksi hariç proje. */
export function snapshotOf(p: Project): string {
  const { baselines: _b, auditLog: _a, docIndex: _d, ...rest } = p;
  return JSON.stringify(rest);
}

export interface BaselineInput {
  revision: string;
  author: string;
  approver: string;
  approvalComment: string;
  changeReason: string;
}

export function createBaseline(p: Project, input: BaselineInput, at = new Date().toISOString()): Baseline {
  const snapshot = snapshotOf(p);
  const id = `BL-${String(p.baselines.length + 1).padStart(3, '0')}`;
  const body = sealBody({ id, ...input, date: at, snapshot });
  return { ...body, hash: sha256(JSON.stringify(body)) };
}

/** Mühür doğrulama: snapshot veya üst bilgiler değiştirilmişse false. */
export function verifyBaseline(b: Baseline): boolean {
  return sha256(JSON.stringify(sealBody(b))) === b.hash;
}

/** Mühürlenen alanlar sabit sırayla. */
function sealBody(b: Omit<Baseline, 'hash'>) {
  return { id: b.id, revision: b.revision, author: b.author, approver: b.approver, approvalComment: b.approvalComment, changeReason: b.changeReason, date: b.date, snapshot: b.snapshot };
}

/** Baseline listesine yalnızca ekleme yapılır; mevcut kayıtlar korunur (yeni projede de aynı nesneler). */
export function appendBaseline(p: Project, b: Baseline): Project {
  return { ...p, baselines: [...p.baselines, b] };
}

export interface RowDiff {
  table: TableKey;
  id: string;
  kind: 'Added' | 'Modified' | 'Deleted';
  fields: { field: string; from: unknown; to: unknown }[];
}

const DIFF_TABLES = (Object.keys(ID_PREFIX) as TableKey[]).filter((t) => t !== 'aiRuns' && t !== 'history');

/** İki proje durumu arasındaki fark (baseline ↔ güncel veya baseline ↔ baseline). */
export function diffProjects(a: Pick<Project, TableKey>, b: Pick<Project, TableKey>): RowDiff[] {
  const out: RowDiff[] = [];
  for (const t of DIFF_TABLES) {
    const ra = new Map(((a[t] ?? []) as AnyRow[]).map((r) => [r.id, r] as [string, AnyRow]));
    const rb = new Map(((b[t] ?? []) as AnyRow[]).map((r) => [r.id, r] as [string, AnyRow]));
    for (const [id, r] of rb) {
      const old = ra.get(id);
      if (!old) {
        out.push({ table: t, id, kind: 'Added', fields: [] });
        continue;
      }
      const fields: RowDiff['fields'] = [];
      const o = old as unknown as Record<string, unknown>, n = r as unknown as Record<string, unknown>;
      for (const k of new Set([...Object.keys(o), ...Object.keys(n)]))
        if (JSON.stringify(o[k] ?? null) !== JSON.stringify(n[k] ?? null) && !(o[k] === undefined && (n[k] === '' || (Array.isArray(n[k]) && !(n[k] as unknown[]).length))))
          fields.push({ field: k, from: o[k], to: n[k] });
      if (fields.length) out.push({ table: t, id, kind: 'Modified', fields });
    }
    for (const id of ra.keys()) if (!rb.has(id)) out.push({ table: t, id, kind: 'Deleted', fields: [] });
  }
  return out;
}

export function baselineProject(b: Baseline): Pick<Project, TableKey> {
  return JSON.parse(b.snapshot);
}

export function diffSummary(d: RowDiff[]): string {
  const by = (k: RowDiff['kind']) => d.filter((x) => x.kind === k);
  const fmt = (xs: RowDiff[]) => {
    const g = new Map<string, string[]>();
    for (const x of xs) g.set(TABLE_LABEL[x.table], [...(g.get(TABLE_LABEL[x.table]) ?? []), x.id]);
    return [...g].map(([t, ids]) => `${t}: ${ids.length}`).join(', ') || '—';
  };
  return `Eklenen ${by('Added').length} (${fmt(by('Added'))}) · Değişen ${by('Modified').length} (${fmt(by('Modified'))}) · Silinen ${by('Deleted').length} (${fmt(by('Deleted'))})`;
}
