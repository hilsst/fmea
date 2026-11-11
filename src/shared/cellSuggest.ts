// 4.13.0: Hücre içi kütüphane önerileri. DFMEA / PFMEA satırının bağlamına (fonksiyon / eleman türü / gereksinim tipi,
// proses adımı alanı) uyan kütüphane metinlerini listeler. Saf fonksiyon; yazma işini arayüz yapar.
// Öneri yalnız METİN içindir (S/O/D önerilmez). Kütüphanede sayısal limit yoktur; firma metni sayı içerebilir ve onay bekler.
import { getActiveLib } from './activeLib';
import { covered, fill } from './autogen';
import type { MergedLib } from './companyLib';
import { elementKind } from './elementLib';
import { DFMEA_FUNCTION_TYPES, DFMEA_LIB, PFMEA_ALT_CAUSES, PFMEA_LIB, PFMEA_STEP_COMMON, stepArea, type FailureTemplate } from './failureLib';
import { similarity } from './similarity';
import type { DfmeaRow, PfmeaRow, Project, RequirementRow } from './types';

export type SuggestTable = 'dfmea' | 'pfmea';
/** Önerisi olan hücreler. */
export const SUGGEST_FIELDS: Record<SuggestTable, string[]> = {
  dfmea: ['failureMode', 'effect', 'cause', 'prevention', 'detection'],
  pfmea: ['failureMode', 'effect', 'cause', 'rootCause', 'prevention', 'detection', 'errorProofing'],
};
export const canSuggest = (table: string, field: string) => (SUGGEST_FIELDS[table as SuggestTable] ?? []).includes(field);

export interface CellSuggestion {
  text: string;
  /** Kapsam / kaynak (ör. "eleman: Bağlantı elemanı", "PFMEA · Machining · ek neden"). */
  scope: string;
  company: boolean;
}

const norm = (s: string) => (s ?? '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();
const MAX = 40;

interface Cand {
  t: FailureTemplate;
  scope: string;
  fm: string;
  /** PFMEA ek nedenleri (hata modu anahtarına göre). */
  alts: { cause: string; rootCause?: string; prevention: string; errorProofing?: string }[];
}

function dfmeaCands(p: Project, row: DfmeaRow, lib?: MergedLib): Cand[] {
  const fn = p.structure.find((s) => s.id === row.functionId);
  const dlib = lib?.dfmea ?? DFMEA_LIB;
  const reqs = (fn?.reqIds ?? row.reqIds ?? []).map((id) => p.requirements.find((r) => r.id === id)).filter(Boolean) as RequirementRow[];
  const types = [...new Set(reqs.map((r) => r.reqType).filter((t) => dlib[t] && dlib[t] !== dlib.Functional))];
  const xOf = (type: string) => reqs.find((r) => r.reqType === type)?.characteristic || reqs[0]?.characteristic || fn?.element || '';
  const out: Cand[] = [];
  const kind = fn ? elementKind(fn.element, lib?.elementKinds) : undefined;
  for (const t of kind?.templates ?? []) out.push({ t, scope: `eleman: ${kind!.label}`, fm: fill(t.failureMode, fn!.element), alts: [] });
  for (const type of types) for (const t of dlib[type]) out.push({ t, scope: `gereksinim tipi: ${type}`, fm: fill(t.failureMode, xOf(type)), alts: [] });
  for (const t of lib?.functionTypes ?? DFMEA_FUNCTION_TYPES) out.push({ t, scope: 'fonksiyon hata tipleri', fm: fill(t.failureMode, xOf('')), alts: [] });
  return out;
}

function pfmeaCands(p: Project, row: PfmeaRow, lib?: MergedLib): Cand[] {
  const step = p.processSteps.find((s) => s.id === row.stepId);
  const area = stepArea(p, step, row.stepName);
  const plib = lib?.pfmea ?? PFMEA_LIB;
  const alts = lib?.altCauses ?? PFMEA_ALT_CAUSES;
  const mk = (t: FailureTemplate, scope: string): Cand => ({ t, scope, fm: t.failureMode, alts: alts[t.failureMode] ?? [] });
  return [...(plib[area] ?? plib.Generic).map((t) => mk(t, `PFMEA alanı: ${area}`)), ...(lib?.pfmeaCommon ?? PFMEA_STEP_COMMON).map((t) => mk(t, 'PFMEA · genel adım modları'))];
}

/** Bir hücre için kütüphane önerileri. Hücrede zaten olan metin ve (hata modunda) aynı fonksiyon / adımda var olan modlar çıkarılır. */
export function cellSuggestions(p: Project, table: SuggestTable, row: DfmeaRow | PfmeaRow, field: string, lib: MergedLib | undefined = getActiveLib()): CellSuggestion[] {
  if (!canSuggest(table, field)) return [];
  const cands = table === 'dfmea' ? dfmeaCands(p, row as DfmeaRow, lib) : pfmeaCands(p, row as PfmeaRow, lib);
  const cur = norm(String((row as unknown as Record<string, unknown>)[field] ?? ''));
  const out: CellSuggestion[] = [];
  const seen = new Set<string>(cur ? [cur] : []);
  const push = (text: string, scope: string, company: boolean) => {
    const k = norm(text);
    if (!k || seen.has(k) || out.length >= MAX) return;
    seen.add(k);
    out.push({ text, scope, company });
  };
  if (field === 'failureMode') {
    const same = table === 'dfmea' ? p.dfmea.filter((d) => d.functionId === (row as DfmeaRow).functionId) : p.pfmea.filter((x) => x.stepId === (row as PfmeaRow).stepId);
    const have = same.filter((r) => r.id !== row.id).map((r) => r.failureMode);
    for (const c of cands) if (!covered(have, c.fm, c.t.skipIf)) push(c.fm, c.scope, !!c.t.company);
    return out;
  }
  const mode = row.failureMode;
  if (!mode.trim()) return []; // önce hata modu seçilmeli; öneriler o moda göre gelir
  const matched = cands.filter((c) => norm(c.fm) === norm(mode) || similarity(c.fm, mode) >= 0.6);
  for (const c of matched) {
    const x = c.t as unknown as Record<string, string | undefined>;
    if (x[field]) push(fill(x[field]!, ''), c.scope, !!c.t.company);
    if (table === 'pfmea')
      for (const a of c.alts) {
        const v = (a as Record<string, string | undefined>)[field];
        if (v) push(v, `${c.scope} · ek neden`, false);
      }
  }
  return out;
}
