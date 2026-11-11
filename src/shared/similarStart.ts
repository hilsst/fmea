// 4.13.0: Benzer projeden başla. Benzer projenin yalnız ONAYLI (Approved / Engineer Reviewed) DFMEA / PFMEA satırları,
// proje özel sayı ve kimlikleri ayıklanarak geçici kayıt olarak mevcut kütüphaneye eklenir; kurulum zinciri bu birleşik kütüphaneyle çalışır.
// Hiçbir şey firma kütüphanesi dosyasına yazılmaz; satırlar yine AI Proposed gelir ve kaynağı "Firma kütüphanesi (kaynak proje: …)" olur.
import { emptyCompanyLib, mergeLibs, recordsFromApproved, type CoDfmea, type CoPfmea, type CompanyLib, type MergedLib } from './companyLib';
import type { Project } from './types';

export interface SimilarPlan {
  lib: MergedLib;
  dfmea: number;
  pfmea: number;
  /** Onaylı satır yoksa / kaynağa girmeyenler. */
  skipped: number;
  project: string;
}

export function withSimilarProject(co: CompanyLib | undefined, other: Project): SimilarPlan {
  const base = co ?? emptyCompanyLib();
  const merged = mergeLibs(base);
  const ids = (t: 'dfmea' | 'pfmea') => other[t].map((r) => r.id);
  const d = recordsFromApproved(other, 'dfmea', ids('dfmea'), { lib: merged, existing: base });
  const f = recordsFromApproved(other, 'pfmea', ids('pfmea'), { lib: merged, existing: base });
  const lib = mergeLibs({ ...base, dfmea: [...base.dfmea, ...d.records.map((x) => x.rec as CoDfmea)], pfmea: [...base.pfmea, ...f.records.map((x) => x.rec as CoPfmea)] });
  return { lib, dfmea: d.records.length, pfmea: f.records.length, skipped: d.skipped.length + f.skipped.length, project: (other.meta.partNumber || other.meta.name || '').trim() };
}
