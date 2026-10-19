// Lessons Learned benzerlik araması (§33) ve "Similar FMEA" (§50).
// Eşleşme yalnızca öneridir: "Similar engineering pattern found". Kopyalama kullanıcı onayıyla yapılır.
import type { DfmeaRow, LessonRow, PfmeaRow, Project } from './types';

const STOP = new Set(['ve', 'ile', 'için', 'bir', 'the', 'and', 'of', 'to', 'in', 'is', 'on', 'or', 'a', 'an', 'da', 'de', 'veya']);
export const tokens = (s: string) =>
  new Set(
    s.toLocaleLowerCase('tr').normalize('NFKD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter((w) => w.length > 2 && !STOP.has(w)),
  );

export function similarity(a: string, b: string): number {
  const x = tokens(a), y = tokens(b);
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / Math.sqrt(x.size * y.size);
}

export interface Match<T> {
  item: T;
  score: number;
}

export function similarLessons(p: Project, row: DfmeaRow | PfmeaRow, min = 0.3): Match<LessonRow>[] {
  const q = [row.failureMode, row.cause, 'stepName' in row ? row.stepName : row.function].join(' ');
  return p.lessons
    .map((l) => ({ item: l, score: similarity(q, [l.failureMode, l.description, l.rootCause, l.process].join(' ')) }))
    .filter((m) => m.score >= min && !m.item.linkedFmeaIds.includes(row.id))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}

export function searchLessons(p: Project, query: string, min = 0.2): Match<LessonRow>[] {
  return p.lessons
    .map((l) => ({ item: l, score: similarity(query, [l.failureMode, l.description, l.rootCause, l.lesson, l.process, l.product, l.reference].join(' ')) }))
    .filter((m) => m.score >= min)
    .sort((a, b) => b.score - a.score);
}

export const SIMILAR_LABEL = 'Similar engineering pattern found';

/** Referans projede (önceki FMEA) benzer hata modu desenleri. */
export function similarPatterns(ref: Project, row: { failureMode: string; function?: string; stepName?: string }, min = 0.35) {
  const q = [row.failureMode, row.function ?? '', row.stepName ?? ''].join(' ');
  const pool: (DfmeaRow | PfmeaRow)[] = [...ref.dfmea, ...ref.pfmea];
  return pool
    .map((r) => ({ item: r, score: similarity(q, [r.failureMode, 'function' in r ? r.function : r.stepName].join(' ')) }))
    .filter((m) => m.score >= min)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
}
