// 4.5.0 AI uzman modu ve örnekle besleme.
// Uzman modu: AI'a projenin malzeme ailesini, adım alanlarının kütüphane bilgisini ve uzman FMEA kontrol listesini verir.
// Örnekle besleme: mühendisin onayladığı satırlar (bu proje + yerel örnek kütüphanesi) AI'a "şirket tarzı" örneği olarak gider.
// Örnekler kopyalanmaz; yalnızca ayrıntı düzeyi ve dil için referanstır. AI yine hiçbir şeyi onaylamaz.
import { PFMEA_LIB, materialFamily, stepArea, type MaterialFamily } from './failureLib';
import { similarity } from './similarity';
import type { DfmeaRow, PfmeaRow, Project } from './types';

export type ExampleKind = 'dfmea' | 'pfmea';

/** Örnek kütüphanesi satırı (proje dosyasından bağımsız, kompakt). */
export interface ExampleRow {
  key: string;
  kind: ExampleKind;
  family: MaterialFamily;
  project: string;
  /** PFMEA: adım alanı + adı; DFMEA: eleman + fonksiyon */
  context: string;
  requirement: string;
  failureMode: string;
  effect: string;
  cause: string;
  rootCause: string;
  prevention: string;
  detection: string;
  errorProofing: string;
  s: number | null;
  o: number | null;
  d: number | null;
  reasons: string;
  at: string;
}

export const EXAMPLE_LIMIT = 3000;
const APPROVED = new Set(['Approved', 'Engineer Reviewed']);
const txt = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim();

/** Projedeki mühendis onaylı (Approved / Engineer Reviewed) FMEA satırlarını örnek satırına çevirir. */
export function approvedExamples(p: Project, at = new Date().toISOString()): ExampleRow[] {
  const family = materialFamily(p);
  const project = txt(p.meta.partNumber || p.meta.name) || 'proje';
  const out: ExampleRow[] = [];
  const base = (kind: ExampleKind, r: DfmeaRow | PfmeaRow, context: string, requirement: string): ExampleRow => ({
    key: `${project}|${kind}|${r.id}`, kind, family, project, context: txt(context), requirement: txt(requirement),
    failureMode: txt(r.failureMode), effect: txt(r.effect), cause: txt(r.cause), rootCause: txt((r as PfmeaRow).rootCause), prevention: txt(r.prevention),
    detection: txt(r.detection), errorProofing: txt((r as PfmeaRow).errorProofing), s: r.s, o: r.o, d: r.d,
    reasons: [r.sReason && `S: ${txt(r.sReason)}`, r.oReason && `O: ${txt(r.oReason)}`, r.dReason && `D: ${txt(r.dReason)}`].filter(Boolean).join(' · '),
    at,
  });
  for (const r of p.dfmea) {
    if (!APPROVED.has(r.approval) || !r.failureMode.trim()) continue;
    const fn = p.structure.find((s) => s.id === r.functionId);
    out.push(base('dfmea', r, `${fn?.element ?? ''} → ${fn?.function ?? r.function}`, r.requirement));
  }
  for (const r of p.pfmea) {
    if (!APPROVED.has(r.approval) || !r.failureMode.trim()) continue;
    const st = p.processSteps.find((s) => s.id === r.stepId);
    out.push(base('pfmea', r, `[${stepArea(p, st, r.stepName)}] ${st?.name ?? r.stepName} → ${r.processFunction}`, r.requirement));
  }
  return out;
}

/** Kütüphaneye ekler / günceller (aynı proje + satır ID'si üzerine yazar); en yeni EXAMPLE_LIMIT satır tutulur. */
export function mergeExamples(lib: ExampleRow[], rows: ExampleRow[]): ExampleRow[] {
  const map = new Map(lib.map((x) => [x.key, x]));
  for (const r of rows) map.set(r.key, r);
  return [...map.values()].sort((a, b) => b.at.localeCompare(a.at)).slice(0, EXAMPLE_LIMIT);
}

/** Hedefe en benzer örnekler: aynı tür, uyumlu malzeme ailesi, metin benzerliği; aynı projeden olanlar önce. */
export function pickExamples(pool: ExampleRow[], kind: ExampleKind, family: MaterialFamily, query: string, n = 8): ExampleRow[] {
  return pool
    .filter((x) => x.kind === kind && (!family || !x.family || x.family === family))
    .map((x) => ({ x, score: similarity(query, `${x.context} ${x.requirement} ${x.failureMode} ${x.cause}`) }))
    .filter((m) => m.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((m) => m.x);
}

export function formatExamples(rows: ExampleRow[]): string {
  if (!rows.length) return '';
  return [
    'MÜHENDİS ONAYLI ÖRNEKLER (şirket tarzı; ayrıntı düzeyi, dil ve muhakeme için referans – KOPYALAMA, hedef parçaya özgü yaz; sayısal değerleri buradan alma):',
    ...rows.map((x, i) =>
      `Örnek ${i + 1} [${x.project}] ${x.context}${x.requirement ? ` | Gereksinim: ${x.requirement}` : ''} | FM: ${x.failureMode} | Etki: ${x.effect} | Neden: ${x.cause}${x.rootCause ? ` | Kök: ${x.rootCause}` : ''} | Önleme: ${x.prevention}${x.errorProofing ? ` | Hata önleme: ${x.errorProofing}` : ''} | Tespit: ${x.detection} | S${x.s ?? '-'} O${x.o ?? '-'} D${x.d ?? '-'}${x.reasons ? ` | Gerekçe: ${x.reasons}` : ''}`,
    ),
  ].join('\n');
}

const FAMILY_TEXT: Record<string, string> = {
  metal: 'METAL parça. Kompozit üretimine özgü hata modu, neden veya kontrol (ply, prepreg, lay-up, vakum torbalama, kür, otoklav, delaminasyon, reçine, kalıptan çıkarma) YAZMA.',
  composite: 'KOMPOZİT parça. Malzeme out-time, ply sırası/oryantasyonu, porozite, delaminasyon, kür çevrimi gibi kompozit mekanizmalarını değerlendir.',
  '': 'Malzeme ailesi belirsiz: hata modlarını gereksinimlerdeki malzeme bilgisine dayandır; belirsizse issues listesine "ürün tipi / malzeme belirtilmeli" yaz.',
};

const CHECKLIST: Record<ExampleKind, string> = {
  dfmea: `UZMAN DFMEA KONTROL LİSTESİ (her satır için):
- Hata modu = fonksiyonun yerine getirilememe biçimi; her fonksiyon için tam kayıp, kısmi / bozulmuş, aralıklı ve istenmeyen fonksiyonu ayrı ayrı değerlendir (anlamsız olanı yazma).
- Etki zinciri: localEffect (parçada) → higherEffect (montaj / sistem) → effect (son kullanıcı / emniyet / regülasyon). S son etkiden ve kriter tablosundan gelir.
- Neden = TASARIM mekanizması (tolerans zinciri, malzeme / temper seçimi, geometri, arayüz, çevre yükü, yorulma); üretim hatası DFMEA nedeni değildir.
- Önleme = tasarım yöntemi (analiz, FEA, tolerans analizi, tasarım standardı, malzeme verisi); Tespit = DV testi / analiz doğrulaması, ne zaman yapıldığı ile.
- Kaynakta tanımsız test yöntemi, yük profili veya kabul kriteri varsa satıra VERİ YOK yaz ve issues listesine ekle.
- S 9–10 (emniyet) satırlarında recommendedAction zorunlu (tasarım değişikliği veya doğrulama).`,
  pfmea: `UZMAN PFMEA KONTROL LİSTESİ (her satır için):
- Proses fonksiyonu adımın yaptığı iş; requirement adımın ürettiği ürün karakteristiği + proses gereksinimi (gereksinim ID ile).
- Hata modu bu adımda oluşan uygunsuzluk (ürün karakteristiği üzerinden); "adım yapılmadı / yanlış yapıldı / eksik / fazla" türlerini değerlendir.
- Etki: bağlı DFMEA satırının hata modu ve son etkisi (dfIds doldur); S bağlı DFMEA S değerinden düşük olamaz.
- Neden: 4M kategorisiyle somut mekanizma; why dizisi 5 Neden ile sistem zafiyetine (rootCause) iner. "Operatör hatası" kök neden değildir.
- Önleme nedeni ortadan kaldırmalı (parametre kilidi, fikstür, takım ömrü, kodlu kalıp, barkod); S ≥ 9 veya özel proseste errorProofing öner.
- Tespit somut: ölçüm aleti, numune, sıklık, hangi adımda (measurement); reactionPlan: ayır, düzelt, bildir.
- Özel proseslerde params listesine izlenecek parametreleri ekle (limit yazma).
- Aynı nedeni / kontrolü kelimesi kelimesine tekrarlayan genel satır üretme; her satır bu parçaya özgü olmalı.`,
};

/** Hedef adımların kütüphane alanı ve tipik hata bilgisi (fikir kaynağı; ENGINEERING KNOWLEDGE). */
export function stepHints(p: Project, stepIds: string[]): string {
  const steps = p.processSteps.filter((s) => !stepIds.length || stepIds.includes(s.id));
  const lines = steps.map((s) => {
    const area = stepArea(p, s);
    const lib = PFMEA_LIB[area] ?? [];
    return `${s.id} ${s.name} → alan: ${area}${lib.length ? ` | tipik hata modları: ${lib.map((t) => t.failureMode).join('; ')} | tipik nedenler: ${lib.map((t) => t.cause).join('; ')}` : ''}`;
  });
  return lines.length ? `ADIM ALANLARI VE TİPİK HATALAR (ENGINEERING KNOWLEDGE – parçaya uyarlayarak kullan, uygun olmayanı atla):\n${lines.join('\n')}` : '';
}

/** Uzman modu talimatı: malzeme ailesi + kontrol listesi (+ PFMEA'da adım alanları). */
export function expertBrief(p: Project, kind: ExampleKind, stepIds: string[] = []): string {
  const family = materialFamily(p);
  return [`MALZEME AİLESİ: ${family || 'belirsiz'} (ürün tipi: ${p.settings.productType || 'seçilmedi'}). ${FAMILY_TEXT[family]}`, CHECKLIST[kind], kind === 'pfmea' ? stepHints(p, stepIds) : '']
    .filter(Boolean)
    .join('\n\n');
}

// ───────────────────────── 4.6.0 AI'sız örnek önerisi ─────────────────────────

/** Öneri başına benzerlik eşiği ve hedef başına en fazla öneri. */
export const EXAMPLE_MIN_SCORE = 0.2;
const PER_TARGET = 3;

const areaOf = (context: string) => /^\[([^\]]+)\]/.exec(context)?.[1] ?? '';
const fnOf = (context: string) => context.split('→').slice(1).join('→').trim();
const norm = (s: string) => txt(s).toLocaleLowerCase('tr');

/**
 * Kütüphanedeki onaylı örneklerden, AI kullanmadan DFMEA / PFMEA öneri verisi üretir (AI şemasıyla aynı biçim;
 * buildProposals ile inceleme ekranına gider). Hedef fonksiyon / adım için en benzer örnekler alınır; PFMEA'da
 * adım alanı (Kesim, Büküm…) eşleşmesi zorunludur. Aynı hata modu hedefte zaten varsa önerilmez.
 * Puanlar örnekten taşınır ve "bu parça için doğrulanmalı" gerekçesiyle düşük / orta güvenle işaretlenir.
 */
export function exampleProposalData(p: Project, kind: ExampleKind, pool: ExampleRow[], targetIds: string[] = []): { rows: Record<string, unknown>[]; issues: never[] } {
  const family = materialFamily(p);
  const own = new Set(approvedExamples(p).map((x) => x.key));
  const cands = pool.filter((x) => x.kind === kind && x.failureMode && !own.has(x.key) && (!family || !x.family || x.family === family));
  const rows: Record<string, unknown>[] = [];
  const pick = (query: string, existing: string[], ok: (x: ExampleRow) => boolean) => {
    const have = new Set(existing.map(norm));
    const seen = new Set<string>();
    return cands
      .filter(ok)
      .map((x) => ({ x, score: similarity(query, `${x.context} ${x.requirement}`) }))
      .filter((m) => m.score >= EXAMPLE_MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .filter((m) => {
        const k = norm(m.x.failureMode);
        if (have.has(k) || seen.has(k)) return false;
        seen.add(k);
        return true;
      })
      .slice(0, PER_TARGET);
  };
  const common = (x: ExampleRow, score: number) => {
    const confidence = score >= 0.5 ? 'Medium' : 'Low';
    const why = (l: string) => ({ reason: `Örnek kütüphanesinden (${x.project}, benzerlik %${Math.round(score * 100)}); bu parça için ${l} doğrulanmalı.${x.reasons ? ` Örnek gerekçesi: ${x.reasons}` : ''}`, confidence: 'Low' });
    return {
      failureMode: x.failureMode, effect: x.effect, cause: x.cause, prevention: x.prevention, detection: x.detection,
      s: x.s, o: x.o, d: x.d, sWhy: why('şiddet'), oWhy: why('oluşma'), dWhy: why('tespit'),
      recommendedAction: '', confidence, basis: 'ENGINEERING KNOWLEDGE', evidence: [], exampleSource: `${x.project} · ${x.context}`,
    };
  };
  if (kind === 'dfmea') {
    const fns = p.structure.filter((s) => s.function && (!targetIds.length || targetIds.includes(s.id)));
    for (const fn of fns) {
      const reqs = p.requirements.filter((r) => fn.reqIds.includes(r.id)).map((r) => r.text).join(' ');
      const existing = p.dfmea.filter((d) => d.functionId === fn.id).map((d) => d.failureMode);
      for (const { x, score } of pick(`${fn.element} ${fn.function} ${reqs}`, existing, () => true))
        rows.push({ functionId: fn.id, reqIds: fn.reqIds, localEffect: '', higherEffect: '', verification: '', ...common(x, score) });
    }
  } else {
    const steps = p.processSteps.filter((s) => !targetIds.length || targetIds.includes(s.id));
    for (const st of steps) {
      const area = stepArea(p, st);
      const existing = p.pfmea.filter((r) => r.stepId === st.id).map((r) => r.failureMode);
      // Adım alanı bilinmiyorsa (Generic) yalnızca metin benzerliği; biliniyorsa aynı alandaki örnekler
      const sameArea = (x: ExampleRow) => area === 'Generic' || areaOf(x.context) === area;
      for (const { x, score } of pick(`${area} ${st.name} ${st.description}`, existing, sameArea))
        rows.push({
          stepId: st.id, processFunction: fnOf(x.context), requirement: '', dfIds: [], processElement: '', cause4M: '', why: [],
          rootCause: x.rootCause, errorProofing: x.errorProofing, measurement: '', reactionPlan: '', ...common(x, score),
        });
    }
  }
  return { rows, issues: [] };
}
