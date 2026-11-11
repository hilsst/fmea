// 4.12.0: Firma kütüphanesi dosyası (ortak klasörde fmea-kutuphane.json) – okuma ve güvenli yazma.
// Electron'a bağımlı değildir (testlenebilir). Asla çökmez: klasör erişilemezse / dosya bozuksa hata değeri döner.
// Yazma: kilit al → dosyayı YENİDEN oku → işlemleri güncel dosya üzerine uygula (rev + 1) → geçici dosyaya yaz → yeniden adlandır.
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIB_FILE, LIB_SCHEMA, applyOps, emptyCompanyLib, validateCompanyLib, type CompanyLib, type LibOps } from '../shared/companyLib';

export type LibReadStatus = 'ok' | 'missing' | 'unreachable' | 'corrupt';
export interface LibReadResult {
  status: LibReadStatus;
  lib: CompanyLib;
  warnings: string[];
  error?: string;
}

const file = (dir: string) => path.join(dir, LIB_FILE);
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function readLibFile(dir: string): Promise<LibReadResult> {
  if (!dir) return { status: 'unreachable', lib: emptyCompanyLib(), warnings: [], error: 'Firma kütüphanesi klasörü seçilmedi.' };
  try {
    await fs.access(dir);
  } catch (e) {
    return { status: 'unreachable', lib: emptyCompanyLib(), warnings: [], error: `Klasöre erişilemiyor: ${msg(e)}` };
  }
  let text: string;
  try {
    text = await fs.readFile(file(dir), 'utf8');
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { status: 'missing', lib: emptyCompanyLib(), warnings: [] };
    return { status: 'unreachable', lib: emptyCompanyLib(), warnings: [], error: `Dosya okunamadı: ${msg(e)}` };
  }
  if (!text.trim()) return { status: 'corrupt', lib: emptyCompanyLib(), warnings: ['Kütüphane dosyası boş.'], error: 'Kütüphane dosyası boş.' };
  try {
    const { lib, warnings } = validateCompanyLib(JSON.parse(text));
    return { status: 'ok', lib, warnings };
  } catch (e) {
    return { status: 'corrupt', lib: emptyCompanyLib(), warnings: [], error: `Kütüphane dosyası bozuk (JSON okunamadı): ${msg(e)}` };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Basit dosya kilidi (aynı anda iki yazıcıyı sıraya sokar). Eski kilit (>15 sn) çöpe sayılır.
 *  Kilit dosyasına sahiplik belirteci yazılır; çıkışta yalnız kendi kilidimiz silinir (bayat sayılıp başkasına geçmişse dokunulmaz). */
async function withLock<T>(dir: string, fn: () => Promise<T>): Promise<T> {
  const lock = path.join(dir, `${LIB_FILE}.lock`);
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  let held = false;
  for (let i = 0; i < 60 && !held; i++) {
    try {
      const h = await fs.open(lock, 'wx');
      try {
        await h.writeFile(token, 'utf8');
      } finally {
        await h.close();
      }
      held = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (Date.now() - (await fs.stat(lock)).mtimeMs > 15000) await fs.rm(lock, { force: true });
      } catch {
        /* başkası kaldırdı */
      }
      await sleep(50 + Math.random() * 100);
    }
  }
  if (!held) throw new Error('Kütüphane dosyası başka bir kullanıcı tarafından kullanılıyor; biraz sonra tekrar deneyin.');
  try {
    return await fn();
  } finally {
    const owner = await fs.readFile(lock, 'utf8').catch(() => '');
    if (owner === token) await fs.rm(lock, { force: true }).catch(() => undefined);
  }
}

/** Windows / ağ paylaşımında hedef dosya o an başka biri tarafından okunuyorsa rename geçici olarak EPERM / EBUSY verebilir. */
async function renameRetry(from: string, to: string): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await fs.rename(from, to);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 9 || !['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '')) throw e;
      await sleep(100 + i * 100);
    }
  }
}

export type LibWriteResult =
  | { ok: true; lib: CompanyLib; /** Dosya, siz okuduktan sonra başkası tarafından değişmişti; işlemler güncel dosyayla birleştirildi. */ merged: boolean; applied: number; rejected: string[]; warnings: string[] }
  | { ok: false; error: string };

/**
 * İşlemleri diskteki son hale uygular. baseRev: arayüzün en son okuduğu rev; diskteki rev farklıysa merged = true döner
 * (kayıtlar id bazında birleşir, aynı id'de son yazan kazanır).
 */
export async function writeLibFile(dir: string, ops: LibOps, baseRev: number, by: string): Promise<LibWriteResult> {
  if (!dir) return { ok: false, error: 'Firma kütüphanesi klasörü seçilmedi.' };
  try {
    return await withLock(dir, async () => {
      const cur = await readLibFile(dir);
      if (cur.status === 'unreachable') return { ok: false as const, error: cur.error ?? 'Klasöre erişilemiyor.' };
      const warnings = [...cur.warnings];
      if (cur.status === 'corrupt' || (cur.status === 'ok' && cur.warnings.length)) {
        // Bozuk dosya veya okunurken atlanan kayıt var: üzerine yazmadan önce yedekle. Yedek alınamazsa YAZMA (veri kaybı olmasın).
        const bak = path.join(dir, `fmea-kutuphane.bozuk-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        try {
          await fs.copyFile(file(dir), bak);
        } catch (e) {
          return { ok: false as const, error: `Kütüphane dosyası sorunlu ve yedeği alınamadı; veri kaybını önlemek için yazılmadı: ${msg(e)}` };
        }
        warnings.push(`${cur.status === 'corrupt' ? 'Bozuk kütüphane dosyası' : 'Geçersiz kayıt içeren kütüphane dosyası'} yedeklendi: ${path.basename(bak)}`);
      }
      if (cur.status === 'ok') {
        const raw = JSON.parse(await fs.readFile(file(dir), 'utf8')) as { schema?: number };
        if ((raw.schema ?? 1) > LIB_SCHEMA) return { ok: false as const, error: 'Kütüphane dosyası bu uygulamadan daha yeni bir sürümle yazılmış; uygulamayı güncelleyin.' };
      }
      const merged = cur.status === 'ok' && cur.lib.rev !== baseRev;
      const { lib, applied, rejected } = applyOps(cur.lib, ops, { by });
      const tmp = path.join(dir, `${LIB_FILE}.${process.pid}-${Math.random().toString(36).slice(2, 8)}.tmp`);
      try {
        await fs.writeFile(tmp, JSON.stringify(lib, null, 2), 'utf8');
        await renameRetry(tmp, file(dir));
      } catch (e) {
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw e;
      }
      return { ok: true as const, lib, merged, applied, rejected, warnings };
    });
  } catch (e) {
    return { ok: false, error: `Kütüphane yazılamadı: ${msg(e)}` };
  }
}
