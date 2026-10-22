// 4.4.0: RPN eşiği aşıldığında "Önerilen Aksiyon" (Recommended Action) önerisi.
// Öneri satırın kendi bilgisinden türetilir (neden, önleme / tespit kontrolü, hata önleme, S/O/D) ve aynı
// proses alanındaki hata kütüphanesinden kontrol adları eklenir. Sayısal hedef, sorumlu veya tarih uydurulmaz.
// Öneri "AI RECOMMENDATION" etiketlidir; mühendis kabul eder, düzenler veya siler. Dolu aksiyon alanı değişmez.
// RPN tek başına karar ölçütü değildir: needsAction (SCMH S≥9 / Top-N / KC veya AP=H) ayrıca çalışır.
import { PFMEA_LIB, pfmeaAreaOf } from './failureLib';
import type { DfmeaRow, PfmeaRow, Project } from './types';

export const AI_REC = 'AI RECOMMENDATION – mühendis onayı gerekli';
export const OWNER_NO_DATA = 'VERİ YOK – doğrulanmalı (sorumlu atanmalı)';

type Fmea = DfmeaRow | PfmeaRow;
const ok = (n: unknown): n is number => typeof n === 'number' && n >= 1 && n <= 10;
const has = (s: unknown) => typeof s === 'string' && s.trim() !== '' && !s.startsWith('VERİ YOK');

export function rowRpn(r: Pick<Fmea, 's' | 'o' | 'd'>): number | null {
  return ok(r.s) && ok(r.o) && ok(r.d) ? r.s * r.o * r.d : null;
}

/** RPN eşiği tanımlı ve satırın RPN'i eşiğe eşit veya üstünde mi? */
export function rpnOver(p: Pick<Project, 'settings'>, r: Pick<Fmea, 's' | 'o' | 'd'>): boolean {
  const th = p.settings.rpnThreshold;
  const v = rowRpn(r);
  return th != null && v != null && v >= th;
}

/** Satır için otomatik öneri yazılmalı mı? (eşik aşıldı, aksiyon alanı boş, "aksiyon yok" kararı verilmemiş) */
export function wantsRpnAction(p: Pick<Project, 'settings'>, r: Fmea): boolean {
  if (p.settings.rpnAutoAction === false) return false;
  if (has(r.recommendedAction)) return false;
  if (r.riskDecision && r.riskDecision.startsWith('No action')) return false;
  return rpnOver(p, r);
}

/** Satırın adımıyla aynı alandaki kütüphane kontrolleri (satırda zaten olanlar hariç). */
function libControls(p: Pick<Project, 'processSteps'>, r: PfmeaRow): { prevention: string[]; detection: string[]; ep: string[] } {
  const step = p.processSteps.find((s) => s.id === r.stepId);
  const area = pfmeaAreaOf(`${step?.name ?? r.stepName ?? ''} ${step?.description ?? ''}`);
  const lib = PFMEA_LIB[area] ?? [];
  const cause = (r.cause ?? '').toLocaleLowerCase('tr');
  const fm = (r.failureMode ?? '').toLocaleLowerCase('tr');
  // Önce aynı hata modu / neden; yoksa alanın tüm kayıtları.
  const hit = lib.filter((t) => (fm && t.failureMode.toLocaleLowerCase('tr') === fm) || (cause && t.cause.toLocaleLowerCase('tr') === cause));
  const src = hit.length ? hit : lib;
  const cur = `${r.prevention} ${r.detection} ${r.errorProofing}`.toLocaleLowerCase('tr');
  const pick = (xs: string[]) => [...new Set(xs.flatMap((x) => x.split(/,\s*/)).map((x) => x.trim()).filter((x) => x && !cur.includes(x.toLocaleLowerCase('tr'))))].slice(0, 3);
  return { prevention: pick(src.map((t) => t.prevention)), detection: pick(src.map((t) => t.detection)), ep: pick(src.map((t) => t.errorProofing ?? '')) };
}

/** Satırın neden / kontrol bilgisinden önerilen aksiyon metni. */
export function rpnActionText(p: Pick<Project, 'settings' | 'processSteps'>, r: Fmea, pf: boolean): string {
  const s = r.s as number, o = r.o as number, d = r.d as number;
  const parts: string[] = [];
  const cause = has(r.cause) ? `“${r.cause.trim()}”` : 'neden tanımlı değil (önce 5 Neden ile kök neden belirlenmeli)';
  const lib = pf ? libControls(p, r as PfmeaRow) : { prevention: [], detection: [], ep: [] };
  if (s >= 9)
    parts.push(pf
      ? `S=${s}: severity yalnız tasarım değişikliğiyle düşer; bağlı DFMEA’da tasarım değişikliği veya hata önleme (S 9–10 kararı) değerlendirilmeli`
      : `S=${s}: severity’yi düşürmek için tasarım değişikliği değerlendirilmeli`);
  const focusO = o >= d;
  const focusD = d >= o;
  if (focusO) {
    const prev = has(r.prevention) ? `mevcut önleme “${r.prevention.trim()}” yetersiz (O=${o})` : `önleme kontrolü tanımlı değil (O=${o})`;
    if (pf) {
      const ep = (r as PfmeaRow).errorProofing;
      const epText = has(ep) && !/^none/i.test(ep) ? `hata önleme “${ep.trim()}” uygulanmalı / doğrulanmalı` : `hata önleme (poka-yoke, reçete / parametre kilidi, fikstür) değerlendirilmeli${lib.ep.length ? ` – kütüphane: ${lib.ep.join(', ')}` : ''}`;
      parts.push(`Oluşumu azalt: ${cause} nedenine karşı ${prev}; ${epText}${lib.prevention.length ? `; ek önleme (kütüphane): ${lib.prevention.join(', ')}` : ''}`);
    } else {
      parts.push(`Oluşumu azalt: ${cause} nedenine karşı ${prev}; tasarım önleme kontrolü (analiz, tasarım standardı, malzeme / tolerans seçimi) güçlendirilmeli`);
    }
  }
  if (focusD) {
    const det = has(r.detection) ? `mevcut tespit “${r.detection.trim()}” yetersiz (D=${d})` : `tespit kontrolü tanımlı değil (D=${d})`;
    parts.push(pf
      ? `Tespiti iyileştir: ${det}; ölçümlü / otomatik tespit veya hatayı kaynağında yakalayan kontrol eklenmeli, ölçüm sistemi için MSA yapılmalı${lib.detection.length ? `; kütüphane: ${lib.detection.join(', ')}` : ''}`
      : `Tespiti iyileştir: ${det}; tasarım doğrulamasını öne alan test / analiz planlanmalı (DVP&R)`);
  }
  const head = rpnOver(p, r) ? `[RPN ${s * o * d} ≥ ${p.settings.rpnThreshold}] ` : '';
  return `${head}${parts.join(' | ')} (${AI_REC})`;
}

/** Eşik aşımında doldurulacak alanlar: önerilen aksiyon + boşsa sorumlu yer tutucusu. Tarih ve tahmini puan uydurulmaz. */
export function rpnActionValues(p: Pick<Project, 'settings' | 'processSteps'>, r: Fmea, pf: boolean): Record<string, string> {
  if (!wantsRpnAction(p, r)) return {};
  const out: Record<string, string> = { recommendedAction: rpnActionText(p, r, pf) };
  if (!has(r.owner) && !(r.owner ?? '').startsWith('VERİ YOK')) out.owner = OWNER_NO_DATA;
  return out;
}
