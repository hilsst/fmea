// 4.12.0: Firma kütüphanesinin arayüz tarafı durumu. Dosya ortak klasördedir (ana süreç okur / yazar);
// burada birleşik kütüphane hesaplanır ve motorlara "etkin kütüphane" olarak verilir (activeLib).
import { useSyncExternalStore } from 'react';
import { setActiveLib } from '../shared/activeLib';
import { emptyCompanyLib, mergeLibs, type CompanyLib, type LibOps, type MergedLib } from '../shared/companyLib';
import { api, isDesktop } from './api';

export type LibStatus = 'loading' | 'nodir' | 'ok' | 'missing' | 'unreachable' | 'corrupt';
export interface LibState {
  dir: string;
  status: LibStatus;
  co: CompanyLib;
  merged: MergedLib;
  error?: string;
  warnings: string[];
}

const initial = (): LibState => ({ dir: '', status: isDesktop ? 'loading' : 'nodir', co: emptyCompanyLib(), merged: mergeLibs(), warnings: [] });
let state: LibState = initial();
const listeners = new Set<() => void>();
const set = (s: LibState) => {
  state = s;
  // Firma verisi / devre dışı kayıt yoksa motorlar doğrudan yerleşiği kullanır.
  setActiveLib(s.co.disabled.length || COLLS_NONEMPTY(s.co) ? s.merged : undefined);
  listeners.forEach((l) => l());
};
const COLLS_NONEMPTY = (c: CompanyLib) => c.dfmea.length + c.pfmea.length + c.params.length + c.gauges.length + c.structures.length > 0;

export const useCompanyLib = (): LibState => useSyncExternalStore((cb) => (listeners.add(cb), () => listeners.delete(cb)), () => state);
export const getLibState = () => state;

/** Klasörden okur. Klasör yoksa / erişilemezse yerleşik kütüphaneyle çalışılır (çökmez). */
export async function reloadLib(): Promise<LibState> {
  if (!isDesktop) {
    set(initial());
    return state;
  }
  try {
    const r = await api.libRead();
    const status: LibStatus = !r.dir ? 'nodir' : r.status;
    set({ dir: r.dir, status, co: r.lib, merged: mergeLibs(r.lib), error: r.error, warnings: r.warnings });
  } catch (e) {
    set({ ...initial(), status: 'unreachable', error: e instanceof Error ? e.message : String(e) });
  }
  return state;
}

export type LibWriteOutcome = { ok: true; applied: number; rejected: string[]; merged: boolean; warnings: string[] } | { ok: false; error: string };

/** İşlemleri dosyaya yazar (diskteki son hale uygulanır); başarıda durum güncellenir. */
export async function writeLib(ops: LibOps, by: string): Promise<LibWriteOutcome> {
  if (!isDesktop) return { ok: false, error: 'Firma kütüphanesi yalnızca masaüstü uygulamasında kullanılabilir.' };
  if (!state.dir) return { ok: false, error: 'Önce Ayarlar veya Kütüphane ekranından firma kütüphanesi klasörünü seçin.' };
  const r = await api.libWrite({ ops, baseRev: state.co.rev, by });
  if (!r.ok) return r;
  set({ ...state, status: 'ok', co: r.lib, merged: mergeLibs(r.lib), error: undefined, warnings: r.warnings });
  return { ok: true, applied: r.applied, rejected: r.rejected, merged: r.merged, warnings: r.warnings };
}

export async function pickLibDir(): Promise<boolean> {
  const dir = await api.libPickDir();
  if (!dir) return false;
  await reloadLib();
  return true;
}
