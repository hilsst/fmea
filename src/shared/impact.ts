// İzlenebilirlik grafiği (§34, §47, §48): Değişiklik Etkisi, izlenebilirlik grafiği ve
// "Bu kayıt neden burada?" paneli aynı bağlantı grafiğini kullanır.
import { tableOfId } from './model';
import type { Project, TableKey } from './types';

export interface Edge {
  from: string;
  to: string;
  /** Bağlantının anlamı, örn. "gereksinim → DFMEA (reqIds)" */
  via: string;
}

export interface Graph {
  down: Map<string, Edge[]>;
  up: Map<string, Edge[]>;
  edges: Edge[];
}

const cache = new WeakMap<Project, Graph>();

export function buildGraph(p: Project): Graph {
  const hit = cache.get(p);
  if (hit) return hit;
  const edges: Edge[] = [];
  const e = (from: string, to: string, via: string) => from && to && from !== to && edges.push({ from, to, via });

  const docByNumber = p.documents.filter((d) => d.docNumber.trim());
  for (const r of p.requirements) {
    if (r.sourceDocId) e(r.sourceDocId, r.id, 'doküman → gereksinim');
    else for (const d of docByNumber) if (r.source.includes(d.docNumber)) e(d.id, r.id, 'doküman → gereksinim (kaynak no)');
  }
  for (const s of p.structure) {
    for (const id of s.reqIds) e(id, s.id, 'gereksinim → fonksiyon');
    if (s.parentId) e(s.parentId, s.id, 'üst yapı → alt yapı');
  }
  for (const d of p.dfmea) {
    for (const id of d.reqIds) e(id, d.id, 'gereksinim → DFMEA');
    if (d.functionId) e(d.functionId, d.id, 'fonksiyon → DFMEA');
  }
  for (const s of p.processSteps) for (const d of docByNumber) if (s.source.includes(d.docNumber)) e(d.id, s.id, 'doküman → proses adımı');
  for (const r of p.pfmea) {
    for (const id of r.dfIds) e(id, r.id, 'DFMEA → PFMEA');
    if (r.stepId) e(r.stepId, r.id, 'proses adımı → PFMEA');
  }
  for (const pp of p.processParams) {
    if (pp.stepId) e(pp.stepId, pp.id, 'proses adımı → parametre');
    for (const id of pp.pfIds) e(pp.id, id, 'parametre → PFMEA hata modu');
  }
  for (const k of p.kcs) if (k.sourceId) e(k.sourceId, k.id, 'FMEA → KC');
  for (const c of p.controlPlan) {
    if (c.stepId) e(c.stepId, c.id, 'proses adımı → kontrol planı');
    if (c.pfId) e(c.pfId, c.id, 'PFMEA → kontrol planı');
    if (c.kcId) e(c.kcId, c.id, 'KC → kontrol planı');
    if (c.ppId) e(c.ppId, c.id, 'parametre → kontrol planı');
  }
  for (const m of p.msa) {
    if (m.cpId) e(m.cpId, m.id, 'kontrol planı → MSA');
    else if (m.kcId) e(m.kcId, m.id, 'KC → MSA');
  }
  for (const c of p.capability) if (c.kcId) e(c.kcId, c.id, 'KC → capability');
  for (const a of p.actions) if (a.sourceId) e(a.sourceId, a.id, 'FMEA → aksiyon');
  for (const l of p.lessons) for (const id of l.linkedFmeaIds) e(l.id, id, 'ders (geçmiş hata) → FMEA');
  for (const ev of p.evidence) {
    if (ev.docId) e(ev.docId, ev.id, 'doküman → kanıt');
    for (const id of ev.linkedIds) e(ev.id, id, 'kanıt → kayıt');
  }
  // Kanıtı doğrudan BaseRow.evidenceIds ile gösteren kayıtlar
  for (const t of ['requirements', 'dfmea', 'pfmea', 'kcs', 'controlPlan', 'processParams'] as TableKey[])
    for (const r of p[t] as { id: string; evidenceIds?: string[] }[])
      for (const id of r.evidenceIds ?? []) if (!edges.some((x) => x.from === id && x.to === r.id)) e(id, r.id, 'kanıt → kayıt');

  const down = new Map<string, Edge[]>();
  const up = new Map<string, Edge[]>();
  for (const x of edges) {
    (down.get(x.from) ?? down.set(x.from, []).get(x.from)!).push(x);
    (up.get(x.to) ?? up.set(x.to, []).get(x.to)!).push(x);
  }
  const g = { down, up, edges };
  cache.set(p, g);
  return g;
}

export interface Impact {
  /** Başlangıç kayıtları hariç, etkilenen tüm kayıtlar (BFS sırasıyla). */
  ids: string[];
  edges: Edge[];
  byTable: Partial<Record<TableKey, string[]>>;
  depth: Record<string, number>;
}

/** Aşağı yönde etki analizi (§34): "Bu değişiklik N mühendislik kaydını etkiliyor". */
export function impactOf(p: Project, start: string[], maxDepth = 12): Impact {
  const g = buildGraph(p);
  const seen = new Set(start);
  const depth: Record<string, number> = Object.fromEntries(start.map((s) => [s, 0]));
  const out: string[] = [];
  const used: Edge[] = [];
  let frontier = [...start];
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const x of g.down.get(id) ?? []) {
        // Ders ve kanıt düğümleri aşağı yönde yalnızca başlangıç ise yayılır (geçmiş kaydı değişmez).
        if (seen.has(x.to)) continue;
        seen.add(x.to);
        depth[x.to] = d;
        out.push(x.to);
        used.push(x);
        next.push(x.to);
      }
    frontier = next;
  }
  const byTable: Impact['byTable'] = {};
  for (const id of out) {
    const t = tableOfId(id);
    if (t) (byTable[t] ??= []).push(id);
  }
  return { ids: out, edges: used, byTable, depth };
}

export interface WhyStep {
  id: string;
  via: string;
  depth: number;
}

/** Yukarı yönde köken zinciri (§48 "Bu kayıt neden burada?"). */
export function originOf(p: Project, id: string, maxDepth = 10): WhyStep[] {
  const g = buildGraph(p);
  const out: WhyStep[] = [];
  const seen = new Set([id]);
  let frontier = [id];
  for (let d = 1; d <= maxDepth && frontier.length; d++) {
    const next: string[] = [];
    for (const cur of frontier)
      for (const x of g.up.get(cur) ?? []) {
        if (seen.has(x.from)) continue;
        seen.add(x.from);
        out.push({ id: x.from, via: x.via, depth: d });
        next.push(x.from);
      }
    frontier = next;
  }
  return out;
}
