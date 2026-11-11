// 4.4.0: RPN eşiği aşıldığında "Önerilen Aksiyon" (Recommended Action) önerisi.
// Öneri satırın kendi bilgisinden türetilir (neden, önleme / tespit kontrolü, hata önleme, S/O/D) ve aynı
// proses alanındaki hata kütüphanesinden kontrol adları eklenir. Sayısal hedef, sorumlu veya tarih uydurulmaz.
// Öneri "AI RECOMMENDATION" etiketlidir; mühendis kabul eder, düzenler veya siler. Dolu aksiyon alanı değişmez.
// RPN tek başına karar ölçütü değildir: needsAction (SCMH S≥9 / Top-N / KC veya AP=H) ayrıca çalışır.
import { COST_NOTE, PREVENTION_4M, PREVENTION_DESIGN, costContext, measureList, measureOf, rankMeasures, type CostContext, type Measure } from './controlCost';
import { DFMEA_FUNCTION_TYPES, DFMEA_LIB, PFMEA_LIB, PFMEA_STEP_COMMON, stepArea } from './failureLib';
import { similarity } from './similarity';
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

/**
 * Satır için otomatik öneri yazılmalı mı? (aksiyon alanı boş, "aksiyon yok" kararı verilmemiş ve
 * RPN eşiği aşıldı VEYA 4.7.0: başka bir yüksek risk nedeni var – S≥9, AP=H, KC/CI, Top-N; `reasons` risk.needsAction'dan gelir.)
 */
export function wantsRpnAction(p: Pick<Project, 'settings'>, r: Fmea, reasons: string[] = []): boolean {
  if (p.settings.rpnAutoAction === false) return false;
  if (has(r.recommendedAction)) return false;
  if (r.riskDecision && r.riskDecision.startsWith('No action')) return false;
  return rpnOver(p, r) || (reasons.length > 0 && rowRpn(r) != null);
}

/** Satırın adımıyla aynı alandaki kütüphane kontrolleri (satırda zaten olanlar hariç). */
function libControls(p: Pick<Project, 'processSteps'> & Partial<Pick<Project, 'settings' | 'requirements' | 'meta'>>, r: PfmeaRow, ctx?: CostContext): { prevention: string[]; detection: string[]; ep: string[]; ranked: Measure[] } {
  const step = p.processSteps.find((s) => s.id === r.stepId);
  const area = stepArea(p, step, r.stepName ?? '');
  const lib = [...(PFMEA_LIB[area] ?? []), ...PFMEA_STEP_COMMON];
  const cause = (r.cause ?? '').toLocaleLowerCase('tr');
  const fm = (r.failureMode ?? '').toLocaleLowerCase('tr');
  // Önce aynı hata modu / neden; yoksa alanın tüm kayıtları.
  const hit = lib.filter((t) => (fm && t.failureMode.toLocaleLowerCase('tr') === fm) || (cause && t.cause.toLocaleLowerCase('tr') === cause));
  const src = hit.length ? hit : lib;
  const cur = `${r.prevention} ${r.detection} ${r.errorProofing}`.toLocaleLowerCase('tr');
  const all = (xs: string[]) => [...new Set(xs.flatMap((x) => x.split(/,\s*/)).map((x) => x.trim()).filter((x) => x && !/^none/i.test(x) && !cur.includes(x.toLocaleLowerCase('tr'))))];
  const pick = (xs: string[]) => all(xs).slice(0, 3);
  // 4.7.0: önleme adayları (kütüphane önleme + hata önleme + nedenin 4M kategorisine göre genel yöntemler) maliyet-etkinliğe göre sıralanır.
  // Eşleşen şablon yoksa alanın yalnız aynı 4M nedenli kayıtları aday olur (ilgisiz kontrol önerilmesin).
  const rel = hit.length ? hit : lib.filter((t) => r.cause4M && t.cause4M === r.cause4M);
  const cands = [...all(rel.map((t) => t.prevention)).map(measureOf), ...all(rel.map((t) => t.errorProofing ?? '')).map(measureOf), ...(PREVENTION_4M[r.cause4M] ?? [])];
  return {
    prevention: pick(src.map((t) => t.prevention)),
    detection: all(src.map((t) => t.detection)).map(measureOf).sort((a, b) => a.cost - b.cost).slice(0, 3).map((m) => m.text),
    ep: pick(src.map((t) => t.errorProofing ?? '')),
    ranked: rankMeasures(cands, { severity: r.s, current: cur, ctx }),
  };
}

/**
 * 4.8.0: DFMEA satırı için hata moduna özel önleme adayları: kütüphanede benzer hata modunun önleme kontrolleri
 * (gereksinim tipinden bağımsız taranır) + genel tasarım yöntemleri.
 */
function dfmeaCandidates(r: DfmeaRow): Measure[] {
  const fm = (r.failureMode ?? '').replace(/\{x\}/g, '');
  const pool = [...Object.values(DFMEA_LIB).flat(), ...DFMEA_FUNCTION_TYPES];
  const scored = pool
    .map((t) => ({ t, sc: Math.max(similarity(t.failureMode.replace(/\{x\}/g, ''), fm), t.cause && r.cause ? similarity(t.cause, r.cause) * 0.8 : 0) }))
    .filter((x) => x.sc >= 0.3)
    .sort((a, b) => b.sc - a.sc)
    .slice(0, 4);
  const specific = scored.flatMap(({ t }) => t.prevention.split(/,\s*/)).map((x) => measureOf(x));
  return [...specific, ...PREVENTION_DESIGN];
}

/** Satırın neden / kontrol bilgisinden önerilen aksiyon metni. */
export function rpnActionText(p: Pick<Project, 'settings' | 'processSteps'>, r: Fmea, pf: boolean, reasons: string[] = []): string {
  const s = r.s as number, o = r.o as number, d = r.d as number;
  const parts: string[] = [];
  const cause = has(r.cause) ? `“${r.cause.trim()}”` : 'neden tanımlı değil (önce 5 Neden ile kök neden belirlenmeli)';
  const ctx = costContext(p as Partial<Project>);
  const lib = pf ? libControls(p, r as PfmeaRow, ctx) : { prevention: [], detection: [], ep: [], ranked: rankMeasures(dfmeaCandidates(r as DfmeaRow), { severity: r.s, current: `${r.prevention}`.toLocaleLowerCase('tr'), ctx }) };
  // 4.7.0: önleyici seçenekler göreli maliyete göre ucuzdan pahalıya; fiyat verisi yoktur.
  const options = lib.ranked.length ? `önleyici seçenekler (ucuzdan pahalıya – ${COST_NOTE}): ${measureList(lib.ranked)}` : '';
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
      const epText = has(ep) && !/^none/i.test(ep) ? `hata önleme “${ep.trim()}” uygulanmalı / doğrulanmalı` : 'hata önleme (poka-yoke, reçete / parametre kilidi, fikstür) değerlendirilmeli';
      parts.push(`Oluşumu azalt: ${cause} nedenine karşı ${prev}; ${epText}${options && `; ${options}`}`);
    } else {
      parts.push(`Oluşumu azalt: ${cause} nedenine karşı ${prev}; tasarım önleme kontrolü (analiz, tasarım standardı, malzeme / tolerans seçimi) güçlendirilmeli${options && `; ${options}`}`);
    }
  } else if (options) {
    // Tespit baskın olsa da en ucuz önleyici seçenekler gösterilir: önleme, tespitten önce gelir.
    parts.push(`Ö${options.slice(1)}`);
  }
  if (focusD) {
    const det = has(r.detection) ? `mevcut tespit “${r.detection.trim()}” yetersiz (D=${d})` : `tespit kontrolü tanımlı değil (D=${d})`;
    parts.push(pf
      ? `Tespiti iyileştir: ${det}; ölçümlü / otomatik tespit veya hatayı kaynağında yakalayan kontrol eklenmeli, ölçüm sistemi için MSA yapılmalı${lib.detection.length ? `; kütüphane: ${lib.detection.join(', ')}` : ''}`
      : `Tespiti iyileştir: ${det}; tasarım doğrulamasını öne alan test / analiz planlanmalı (DVP&R)`);
  }
  // 4.8.0: beklenen etki yalnız niteliksel yazılır. Aksiyon sonrası O/D değeri kanıta dayanır (etkinlik doğrulaması);
  // kuraldan türetilmiş sayı yazılmaz. Puan alanlarına (Tahmini S/O/D) dokunulmaz.
  const top = lib.ranked[0];
  if (top && (focusO || focusD))
    parts.push(`Beklenen etki: ${focusO ? 'oluşumun (O)' : 'tespitin (D)'} iyileşmesi hedeflenir; yeni puanı aksiyon tamamlanıp etkinliği doğrulandıktan sonra mühendis girer (AI VARSAYIMI: puan tahmini yazılmadı)`);
  const other = reasons.filter((x) => !x.startsWith('RPN'));
  const head = rpnOver(p, r) ? `[RPN ${s * o * d} ≥ ${p.settings.rpnThreshold}] ` : other.length ? `[${other.join(' / ')} · RPN ${s * o * d}] ` : '';
  return `${head}${parts.join(' | ')} (${AI_REC})`;
}

/** Eşik aşımında doldurulacak alanlar: önerilen aksiyon + boşsa sorumlu yer tutucusu. Tarih ve tahmini puan uydurulmaz. */
export function rpnActionValues(p: Pick<Project, 'settings' | 'processSteps'>, r: Fmea, pf: boolean, reasons: string[] = []): Record<string, string> {
  if (!wantsRpnAction(p, r, reasons)) return {};
  const out: Record<string, string> = { recommendedAction: rpnActionText(p, r, pf, reasons) };
  if (!has(r.owner) && !(r.owner ?? '').startsWith('VERİ YOK')) out.owner = OWNER_NO_DATA;
  return out;
}
