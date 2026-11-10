// AI görevleri: yerel çıkarım → parçalama → ilgili bölüm seçimi → AI → şema doğrulama (+1 yeniden deneme) → önbellek (§55, §61).
import fs from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument } from 'pdf-lib';
import {
  DFMEA_SCHEMA, PFMEA_SCHEMA, REQUIREMENTS_SCHEMA, REVIEW_SCHEMA, STRUCTURE_SCHEMA, parseJson, validate,
  type AiResult, type AiRunMeta, type Json,
} from '../../shared/aischema';
import { chunkDoc, estimateTokens, locText, retrieve, type Chunk, type ExtractedDoc, type RequirementCandidate } from '../../shared/docmodel';
import { sha256 } from '../../shared/sha256';
import { AiError, ENV_KEY, makeProvider, type AiProvider, type ContentBlock } from './provider';
import { systemPrompt, type AiMode, type AiRole } from './roles';

export interface AiEnv {
  apiKey: string;
  provider: string;
  /** Sağlayıcıya özel model (yalnızca OpenAI için; boşsa varsayılan). */
  model?: string;
  cacheDir: string;
  online: () => boolean;
}

const DOC_TOKEN_BUDGET = 60000;

async function run(env: AiEnv, role: AiRole, mode: AiMode, content: ContentBlock[], schema: Json): Promise<AiResult> {
  const meta: AiRunMeta = { role, provider: env.provider || 'anthropic', model: '', at: new Date().toISOString(), mode, tokensIn: 0, tokensOut: 0, cached: false, retries: 0 };
  try {
    if (!env.online()) throw new AiError('OFFLINE', 'AI analysis requires internet connection.');
    const provider: AiProvider = makeProvider(env.provider, env.apiKey, env.model);
    const envVar = ENV_KEY[provider.id];
    if (envVar && !env.apiKey && !process.env[envVar]) throw new AiError('NO_KEY', 'AI API anahtarı tanımlı değil. Ayarlar → AI bölümünden girin.');
    meta.model = provider.model;
    const system = systemPrompt(role, mode);
    const key = sha256(JSON.stringify([provider.id, provider.model, system, content, schema]));
    const cacheFile = path.join(env.cacheDir, `${key}.json`);
    try {
      const hit = JSON.parse(await fs.readFile(cacheFile, 'utf8')) as { data: Json; model: string };
      return { ok: true, data: hit.data, meta: { ...meta, model: hit.model, cached: true } };
    } catch {
      /* önbellekte yok */
    }
    let res = await provider.complete({ system, content, schema });
    meta.model = res.model;
    meta.tokensIn += res.tokensIn;
    meta.tokensOut += res.tokensOut;
    let data: unknown;
    let errors: string[] = [];
    try {
      data = parseJson(res.text);
      errors = validate(schema, data);
    } catch (e) {
      errors = [`JSON çözümlenemedi: ${(e as Error).message}`];
    }
    if (errors.length) {
      meta.retries = 1;
      res = await provider.complete({ system, content, schema, repair: { previous: res.text, errors } });
      meta.tokensIn += res.tokensIn;
      meta.tokensOut += res.tokensOut;
      try {
        data = parseJson(res.text);
        errors = validate(schema, data);
      } catch (e) {
        errors = [`JSON çözümlenemedi: ${(e as Error).message}`];
      }
      if (errors.length) throw new AiError('INVALID_RESPONSE', `AI yanıtı şemaya uymadı (yeniden denendi): ${errors.slice(0, 5).join('; ')}`);
    }
    await fs.mkdir(env.cacheDir, { recursive: true });
    await fs.writeFile(cacheFile, JSON.stringify({ data, model: res.model, at: meta.at }), 'utf8').catch(() => undefined);
    return { ok: true, data: data as Json, meta };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError('API_ERROR', err instanceof Error ? err.message : String(err));
    return { ok: false, error: { kind: e.kind, message: e.message }, meta };
  }
}

const docHead = (doc: ExtractedDoc, part?: string) =>
  `DOKÜMAN: ${doc.fileName}${part ? ` – ${part}` : ''} (ayrıştırıcı: ${doc.parser}, durum: ${doc.status})${doc.messages.length ? '\nNOTLAR: ' + doc.messages.map((m) => m.text).join(' | ') : ''}\nHer satırın başındaki [konum] etiketini evidence alanlarına aktar.`;

const isDrawing = (doc: ExtractedDoc) =>
  /drawing|resim|dwg|dxf|step|iges/i.test(`${doc.fileName} ${doc.parser} ${Object.keys(doc.meta).join(' ')}`) || doc.parser === 'dxf';

/** Dokümanı AI'ye gidecek içeriğe çevirir: metin varsa konum etiketli parçalar, yoksa (taranmış/görsel) dosyanın kendisi. */
async function docContent(doc: ExtractedDoc | null, filePath: string | undefined, focus: string, budget = DOC_TOKEN_BUDGET): Promise<{ blocks: ContentBlock[]; note: string; role: AiRole }> {
  if (doc?.status === 'unsupported') throw new AiError('UNSUPPORTED_DOCUMENT', 'Bu dosya formatı analiz için desteklenmiyor.');
  if (doc && doc.blocks.length) {
    const chunks = chunkDoc(doc);
    const total = chunks.reduce((a, c) => a + c.tokens, 0);
    let use = chunks;
    let note = '';
    if (total > budget) {
      use = [];
      let tok = 0;
      for (const c of retrieve(chunks, focus, chunks.length)) {
        if (tok + c.tokens > budget) break;
        use.push(c);
        tok += c.tokens;
      }
      note = `Doküman büyük (${total} token); ilgili ${use.length}/${chunks.length} bölüm analiz edildi. Kalan bölümler için kapsam daraltılarak tekrar çalıştırın.`;
    }
    return { blocks: [{ type: 'text', text: `${docHead(doc)}\n\n${use.map((c) => c.text).join('\n')}` }], note, role: isDrawing(doc) ? 'Drawing Analyst' : 'Requirement Analyst' };
  }
  if (!filePath) throw new AiError('SOURCE_NOT_FOUND', 'Kaynak dosya bulunamadı; dokümanı yeniden ekleyin.');
  const ext = path.extname(filePath).toLowerCase();
  let data: string;
  try {
    data = (await fs.readFile(filePath)).toString('base64');
  } catch {
    throw new AiError('SOURCE_NOT_FOUND', `Dosya okunamadı: ${filePath}`);
  }
  const name = path.basename(filePath);
  if (ext === '.pdf') return { blocks: [{ type: 'pdf', data, title: name }], note: 'PDF metin katmanı yok; AI görsel analizi kullanıldı. Tüm sonuçlar MANUAL VERIFICATION REQUIRED.', role: 'Drawing Analyst' };
  const media = ({ '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' } as const)[ext as '.png'];
  if (media) return { blocks: [{ type: 'image', data, mediaType: media }, { type: 'text', text: `Görsel dosya: ${name}` }], note: 'Görselden AI analizi; yerel OCR yok. Tüm sonuçlar MANUAL VERIFICATION REQUIRED.', role: 'Drawing Analyst' };
  if (ext === '.tif' || ext === '.tiff') throw new AiError('UNSUPPORTED_DOCUMENT', 'TIFF görseli AI görsel analizine gönderilemiyor (NOT SUPPORTED). PNG veya PDF olarak kaydedip tekrar deneyin.');
  throw new AiError('PARSER_ERROR', 'Dokümandan metin çıkarılamadı; analiz yapılamaz.');
}

/** 4.6.1: gereksinim çıkarımında bir AI çağrısına giden doküman metni (token). Çıktı sınırına (32k) takılmamak için küçük tutulur. */
export const REQ_PART_TOKENS = 8000;

/** Parçaları sırayla en fazla `max` token'lık gruplara toplar (tüm doküman kapsanır, hiçbir bölüm atlanmaz). */
export function groupChunks(chunks: Chunk[], max = REQ_PART_TOKENS): Chunk[][] {
  const out: Chunk[][] = [];
  let cur: Chunk[] = [];
  let tok = 0;
  for (const c of chunks) {
    if (tok + c.tokens > max && cur.length) {
      out.push(cur);
      cur = [];
      tok = 0;
    }
    cur.push(c);
    tok += c.tokens;
  }
  if (cur.length) out.push(cur);
  return out;
}

const normReq = (s: string) => s.toLocaleLowerCase('tr').replace(/\s+/g, ' ').replace(/[.;:,]+$/, '').trim();

/** Parça sonuçlarını birleştirir: gereksinimler metne göre tekilleştirilir, resim bilgisi ilk dolu değerle doldurulur. */
export function mergeRequirementParts(parts: Json[]): Json {
  const reqs: Json[] = [];
  const seen = new Set<string>();
  const issues: Json[] = [];
  const drawing: Record<string, unknown> = { drawingNumber: '', revision: '', partNumber: '', material: '', generalTolerance: '', notes: [] as string[] };
  for (const p of parts) {
    for (const r of (p.requirements as Json[] | undefined) ?? []) {
      const k = normReq(String(r.text ?? ''));
      if (!k || seen.has(k)) continue;
      seen.add(k);
      reqs.push(r);
    }
    issues.push(...(((p.issues as Json[] | undefined) ?? [])));
    const d = (p.drawing ?? {}) as Record<string, unknown>;
    for (const f of ['drawingNumber', 'revision', 'partNumber', 'material', 'generalTolerance']) if (!drawing[f] && d[f]) drawing[f] = d[f];
    for (const n of (d.notes as string[] | undefined) ?? []) if (!(drawing.notes as string[]).includes(n)) (drawing.notes as string[]).push(n);
  }
  return { requirements: reqs, drawing, issues } as Json;
}

/** 4.6.2: taranmış PDF'te bir AI çağrısına giden sayfa sayısı. */
export const PDF_PAGES_PER_PART = 4;

/** [başlangıç, bitiş] (0 tabanlı, dahil) sayfa aralıklarına böler. */
export function pageRanges(count: number, per = PDF_PAGES_PER_PART): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < count; i += per) out.push([i, Math.min(count, i + per) - 1]);
  return out;
}

/**
 * Metin katmanı olmayan PDF'i sayfa gruplarına ayırıp her grubu ayrı PDF olarak AI görsel analizine gönderir.
 * Kesilen grup ikiye bölünür. Tek parçaya sığan (≤ PDF_PAGES_PER_PART sayfa) PDF'te null döner (eski yol kullanılır).
 */
async function extractScannedPdf(env: AiEnv, filePath: string, mode: AiMode, taskFor: (found: string[]) => string): Promise<(AiResult & { note?: string }) | null> {
  let src: PDFDocument;
  try {
    src = await PDFDocument.load(await fs.readFile(filePath), { ignoreEncryption: true });
  } catch {
    return null;
  }
  const count = src.getPageCount();
  if (count <= PDF_PAGES_PER_PART) return null;
  const name = path.basename(filePath);
  const queue = pageRanges(count);
  const results: Json[] = [];
  const found: string[] = [];
  const meta: AiRunMeta = { role: 'Drawing Analyst', provider: env.provider || 'anthropic', model: '', at: new Date().toISOString(), mode, tokensIn: 0, tokensOut: 0, cached: true, retries: 0 };
  while (queue.length) {
    const [from, to] = queue.shift()!;
    const part = await PDFDocument.create();
    for (const pg of await part.copyPages(src, Array.from({ length: to - from + 1 }, (_, i) => from + i))) part.addPage(pg);
    const data = Buffer.from(await part.save()).toString('base64');
    const pages = from === to ? `s.${from + 1}` : `s.${from + 1}–${to + 1}`;
    const r = await run(env, 'Drawing Analyst', mode, [
      { type: 'pdf', data, title: `${name} (${pages})` },
      { type: 'text', text: `Bu PDF, ${count} sayfalık "${name}" dokümanının ${pages} sayfalarıdır (taranmış, metin katmanı yok). evidence.page alanına orijinal sayfa numarasını yaz (bu parçanın 1. sayfası = s.${from + 1}).` },
      { type: 'text', text: taskFor(found) },
    ], REQUIREMENTS_SCHEMA);
    if (!r.ok) {
      if (r.error.kind === 'TRUNCATED' && to > from) {
        const mid = from + Math.floor((to - from) / 2);
        queue.unshift([from, mid], [mid + 1, to]);
        continue;
      }
      const msg = r.error.kind === 'TRUNCATED' ? `${pages} tek başına çıktı sınırını aşıyor (çok yoğun sayfa). Bu sayfayı daha düşük kapsamla ayrı yükleyin.` : r.error.message;
      return { ok: false, error: { kind: r.error.kind, message: results.length ? `${msg} (${results.length} parça tamamlanmıştı; tekrar denemede yeniden ücretlendirilmez.)` : msg }, meta: r.meta };
    }
    results.push(r.data);
    for (const q of (r.data.requirements as Json[] | undefined) ?? []) found.push(`(bu dokümandan) ${String(q.text ?? '')}`);
    meta.model = r.meta.model;
    meta.tokensIn += r.meta.tokensIn;
    meta.tokensOut += r.meta.tokensOut;
    meta.retries += r.meta.retries;
    meta.cached &&= r.meta.cached;
  }
  return { ok: true, data: mergeRequirementParts(results), meta, note: `Taranmış PDF (${count} sayfa) ${results.length} parça hâlinde AI görsel analiziyle işlendi; yerel OCR yok. Tüm sonuçlar MANUAL VERIFICATION REQUIRED.` };
}

export async function extractRequirements(
  env: AiEnv,
  a: { doc: ExtractedDoc | null; filePath?: string; docId: string; docLabel: string; existing: string[]; candidates: RequirementCandidate[]; mode: AiMode },
): Promise<AiResult & { note?: string }> {
  const task = (cands: RequirementCandidate[], existing: string[]) => `GÖREV: ${a.docId} (${a.docLabel}) dokümanındaki gereksinimleri çıkar.
- Yerel ayrıştırıcının bulduğu aday cümleler aşağıda (eksik veya fazla olabilir; doğrula, birleştirme, kaçanları ekle):
${cands.slice(0, 300).map((c, i) => `${i + 1}. [${locText(c.loc)}] ${c.text}`).join('\n') || '(aday yok)'}
- reqType: Functional, Performance, Dimensional, Material, Process, Environmental, Reliability, Safety, Regulatory, Interface, Manufacturing, Inspection, Customer-specific.
- Teknik resimse drawing alanını doldur (yalnızca resimde yazanlar), değilse boş metin.
- Projede zaten olan gereksinimleri tekrar etme:\n${existing.slice(0, 200).join('\n') || '(yok)'}`;

  // 4.6.1: metin katmanı olan dokümanlar parça parça işlenir; tek çağrının yanıtı çıktı sınırını aşmaz (TRUNCATED) ve
  // büyük dokümanlarda hiçbir bölüm atlanmaz. Kesilen parça ikiye bölünüp yeniden denenir.
  const doc = a.doc;
  if (doc && doc.status !== 'unsupported' && doc.blocks.length) {
    const role: AiRole = isDrawing(doc) ? 'Drawing Analyst' : 'Requirement Analyst';
    const queue = groupChunks(chunkDoc(doc));
    const results: Json[] = [];
    const found: string[] = [];
    const meta: AiRunMeta = { role, provider: env.provider || 'anthropic', model: '', at: new Date().toISOString(), mode: a.mode, tokensIn: 0, tokensOut: 0, cached: true, retries: 0 };
    let calls = 0;
    const totalParts = queue.length;
    while (queue.length) {
      const part = queue.shift()!;
      const text = part.map((c) => c.text).join('\n');
      const cands = a.candidates.filter((c) => text.includes(c.text.slice(0, 80)));
      const label = totalParts > 1 || calls > 0 ? `bölüm ${part[0].id.split('-').pop()}–${part[part.length - 1].id.split('-').pop()}` : undefined;
      const r = await run(env, role, a.mode, [{ type: 'text', text: `${docHead(doc, label)}\n\n${text}` }, { type: 'text', text: task(cands, [...a.existing, ...found]) }], REQUIREMENTS_SCHEMA);
      calls++;
      if (!r.ok) {
        if (r.error.kind === 'TRUNCATED' && part.length > 1) {
          const mid = Math.ceil(part.length / 2);
          queue.unshift(part.slice(0, mid), part.slice(mid));
          continue;
        }
        const msg = r.error.kind === 'TRUNCATED' ? 'Dokümanın bir bölümü tek başına çıktı sınırını aşıyor (çok yoğun tablo/liste). Bölümü ayrı bir metin olarak yapıştırıp tekrar deneyin.' : r.error.message;
        return { ok: false, error: { kind: r.error.kind, message: results.length ? `${msg} (${results.length} bölüm tamamlanmıştı; tamamlanan bölümler önbellekte, tekrar denemede yeniden ücretlendirilmez.)` : msg }, meta: r.meta };
      }
      results.push(r.data);
      for (const q of (r.data.requirements as Json[] | undefined) ?? []) found.push(`(bu dokümandan) ${String(q.text ?? '')}`);
      meta.model = r.meta.model;
      meta.tokensIn += r.meta.tokensIn;
      meta.tokensOut += r.meta.tokensOut;
      meta.retries += r.meta.retries;
      meta.cached &&= r.meta.cached;
    }
    const note = results.length > 1 ? `Doküman ${results.length} parça hâlinde analiz edildi (tüm bölümler kapsandı).` : '';
    return { ok: true, data: mergeRequirementParts(results), meta, note };
  }

  // 4.6.2: metin katmanı olmayan (taranmış) PDF sayfa gruplarına bölünüp görsel olarak parça parça analiz edilir.
  if (a.filePath && path.extname(a.filePath).toLowerCase() === '.pdf' && doc?.status !== 'unsupported') {
    const r = await extractScannedPdf(env, a.filePath, a.mode, (ex) => task(a.candidates, [...a.existing, ...ex]));
    if (r) return r;
  }

  let prepared;
  try {
    prepared = await docContent(a.doc, a.filePath, 'shall must required tolerance olmalıdır gereklidir minimum maximum ± mm °C MPa material coating inspection');
  } catch (err) {
    const e = err as AiError;
    return { ok: false, error: { kind: e.kind ?? 'PARSER_ERROR', message: e.message } };
  }
  const r = await run(env, prepared.role, a.mode, [...prepared.blocks, { type: 'text', text: task(a.candidates, a.existing) }], REQUIREMENTS_SCHEMA);
  if (!r.ok && r.error.kind === 'TRUNCATED')
    return { ...r, error: { kind: 'TRUNCATED', message: 'Yanıt uzunluk sınırında kesildi. Bu görsel/sayfa tek başına çok yoğun; dosyayı metinli PDF/Word olarak kaydedin veya daha küçük parçalara bölüp yükleyin.' } };
  return { ...r, note: prepared.note };
}

/** 4.5.0: uzman modu talimatı ve onaylı örnekler (expert.ts); boşsa eklenmez. */
const extra = (a: { expert?: string; examples?: string }): ContentBlock[] =>
  [a.expert, a.examples].filter((t): t is string => !!t?.trim()).map((text) => ({ type: 'text', text }));

export function suggestDfmea(env: AiEnv, a: { context: string; target: string; mode: AiMode; expert?: string; examples?: string }) {
  return run(env, 'FMEA Generator', a.mode, [
    { type: 'text', text: a.context },
    ...extra(a),
    { type: 'text', text: `GÖREV: Aşağıdaki fonksiyon(lar) için DFMEA satırları öner. Yalnızca yukarıdaki ONAYLI gereksinimlere dayan; yüklenen dokümanlardan veya onaysız gereksinimlerden yeni gereksinim türetme. functionId yukarıdaki fonksiyonlardan, reqIds yalnızca hedef fonksiyonun onaylı REQ listesinden seçilir. Her S/O/D için sWhy/oWhy/dWhy gerekçesi ver (puanlama kriter tablosuna atıf). Mevcut hata modlarını tekrarlama. Her fonksiyon için tek bir hata modu yazma: tam kayıp, kısmi, zamanla azalan, aralıklı ve istenmeyen fonksiyon tiplerinin her birini değerlendir ve uygulanabilir olan TÜM hata modlarını ayrı satır olarak ver; bir hata modunun birden fazla olası nedeni varsa her neden ayrı satırdır. prevention alanında önleme yöntemlerini maliyet-etkinliğe göre, en düşük maliyetli etkili yöntem başta olacak şekilde sırala (ör. tasarım kuralı / benzer tasarım incelemesi → analiz → tasarımda hata önleme → tasarım değişikliği); fiyat veya tutar yazma.\n${a.target}` },
  ], DFMEA_SCHEMA);
}

export function suggestPfmea(env: AiEnv, a: { context: string; target: string; composite: string; mode: AiMode; expert?: string; examples?: string }) {
  return run(env, 'Process Analyst', a.mode, [
    { type: 'text', text: a.context },
    ...extra(a),
    { type: 'text', text: `GÖREV: Aşağıdaki proses adım(lar)ı için PFMEA satırları öner. Kaynaklar: (1) yukarıdaki DFMEA satırları – özellikle S≥8, KC adayı veya üretilebilirlik riski olanlar; bu tasarım hata modlarına / karakteristiklere bu adımda yol açabilecek proses hata modlarını yaz ve dfIds ile bağla; (2) proses, muayene, boyutsal ve özel (SR) gereksinimler – bu adımda karşılanmazsa oluşacak proses hata modlarını yaz ve reqIds ile bağla; (3) adımın türüne özgü proses bilgisi. dfIds ve reqIds yalnızca yukarıdaki listelerde olan ID’lerdir; ilişki yoksa boş dizi. cause4M zorunlu; why dizisi 5 Neden (en fazla 5), rootCause sistem zafiyeti olmalı. Özel proseslerde params listesine izlenmesi gereken parametreleri ekle (limit yazma).${a.composite ? `\nKompozit bilgi tabanı (ENGINEERING KNOWLEDGE):\n${a.composite}` : ''}\nMevcut hata modlarını tekrarlama.\nHer adım için tek bir hata modu yazma: adımın her çıktısı / gereksinimi için yapılmadı (atlandı), kısmi / eksik, fazla / aşırı, yanlış (yanlış parça, ayar, malzeme), aralıklı ve elleçleme hasarı tiplerini değerlendir ve uygulanabilir olan TÜM hata modlarını ayrı satır olarak ver. Bir hata modunun 4M (Man, Machine, Method, Material, Measurement, Environment) kategorilerindeki her olası nedeni ayrı satırdır.\nprevention ve errorProofing alanlarında yöntemleri maliyet-etkinliğe göre, en düşük maliyetli etkili yöntem başta olacak şekilde sırala (ör. rota onayı / ilk parça onayı → fikstür, şablon, parametre kilidi → sensör, barkod → otomasyon); S 9–10 satırlarda yalnız idari kontrol (talimat, eğitim) yeterli değildir. Fiyat veya tutar yazma.\n${a.target}` },
  ], PFMEA_SCHEMA);
}

/**
 * 4.9.2: Yapı & Fonksiyon, mühendisin ONAYLADIĞI gereksinim listesinden önerilir; doküman yeniden okunmaz
 * (gereksinim listesi sistemin tek kaynağıdır, her gereksinim kendi kanıt alıntısını ve kaynağını taşır).
 * Büyük listeler 40'ar gereksinimlik gruplara bölünür; önceki gruplarda bulunan elemanlar sonrakine bildirilir.
 */
export const STRUCTURE_REQS_PER_CALL = 40;

const sNorm = (x: unknown) => String(x ?? '').toLocaleLowerCase('tr').replace(/\s+/g, ' ').trim();

export async function suggestStructure(env: AiEnv, a: { context: string; reqs: { id: string; text: string; reqType: string; acceptance: string; source: string; docName: string; page: string; section: string; evidence: string }[]; mode: AiMode }) {
  if (!a.reqs.length) return { ok: false as const, error: { kind: 'SOURCE_NOT_FOUND' as const, message: 'Onaylı gereksinim yok; önce gereksinimleri onaylayın.' } };
  const groups: (typeof a.reqs)[] = [];
  for (let i = 0; i < a.reqs.length; i += STRUCTURE_REQS_PER_CALL) groups.push(a.reqs.slice(i, i + STRUCTURE_REQS_PER_CALL));
  const reqBlock = (g: typeof a.reqs) =>
    `── BU ÇAĞRIDA YAPIYA DÖNÜŞTÜRÜLECEK ONAYLI GEREKSİNİMLER ──\n` +
    g.map((r) => `${r.id} [${r.reqType}] ${r.text}${r.acceptance ? ` | Kabul: ${r.acceptance}` : ''}\n   Kaynak: ${r.docName || r.source}${r.page ? ` s.${r.page}` : ''}${r.section ? ` §${r.section}` : ''}${r.evidence ? `\n   Kanıt alıntısı: "${r.evidence}"` : ''}`).join('\n');

  const task = (found: { ref: string; element: string; level: string }[]) => `GÖREV: Yukarıdaki onaylı gereksinim listesine göre DFMEA yapı ağacını ve fonksiyonlarını oluştur. Doküman yeniden okunmaz: gereksinim listesi tek kaynaktır.
- Her satır bir (eleman, fonksiyon) çiftidir. Aynı elemanın birden çok fonksiyonu varsa her fonksiyon ayrı satırdır ve aynı ref'i kullanır.
- ref: kısa benzersiz eleman kodu. parentRef: üst elemanın ref'i; üst eleman projede zaten varsa onun FN-xxx ID'si; kök eleman için boş.
- Üst elemanlar alt elemanlardan önce gelir. Kök genellikle ürünün kendisidir (Product veya System).
- Elemanlar yalnızca gereksinimlerde ve proje bilgisinde adı geçen ürün, montaj, parça ve özelliklerdir. Listede olmayan parça uydurma; emin olmadığın yapıyı issues listesine soru olarak yaz.
- function: elemanın ne yaptığı, fiil + nesne. Gereksinim cümlesini aynen fonksiyon yapma. Fonksiyonu olmayan ara montaj satırında function boş kalabilir.
- functionType şunlardan biri: Taşıma, Yük aktarma, Sızdırmazlık, Elektromanyetik performans, Termal dayanım, Geometrik uyum, Bağlantı, Yüzey koruması, Aerodinamik / akış performansı, Titreşim dayanımı, Çevresel dayanım, Diğer.
- performanceReq / constraint / interface: yalnızca gereksinimde yazan değerler; yoksa boş bırak (sayı uydurma).
- reqIds: bu fonksiyonu karşılayan gereksinim ID'leri (yalnızca yukarıdaki listeden). Her gereksinim en az bir fonksiyona bağlanmalı; proses / muayene gereksinimleri (Manufacturing, Process, Inspection) yapıya değil PFMEA'ya aittir, atla.
- Projede zaten olan yapı ve fonksiyonları tekrar önerme; eksikleri ekle.
- evidence: gereksinimin "Kanıt alıntısı"nı birebir kopyala; docName olarak gereksinimin Kaynak dokümanının adını yaz, page / section'ı kaynaktan aktar.${found.length ? `\n- Önceki gruplarda zaten bulunan elemanlar (tekrar yazma; üst eleman olarak ref'iyle kullanabilirsin, yeni ref'leri bunlarla çakışmayacak şekilde ver):\n${found.map((x) => `  ${x.ref}: ${x.element} (${x.level})`).join('\n')}` : ''}`;

  const rows: Json[] = [];
  const issues: Json[] = [];
  const seen = new Set<string>();
  const refOwner = new Map<string, string>();
  const found: { ref: string; element: string; level: string }[] = [];
  const notes: string[] = [];
  let meta: AiRunMeta | undefined;
  let part = 0;
  for (const g of groups) {
    const r = await run(env, 'Structure Analyst', a.mode, [{ type: 'text', text: a.context }, { type: 'text', text: reqBlock(g) }, { type: 'text', text: task(found) }], STRUCTURE_SCHEMA);
    if (!r.ok) {
      const why = `${g[0].id}…${g[g.length - 1].id}: ${r.error.kind} – ${r.error.message}`;
      if (!rows.length && part === 0 && groups.length === 1) return { ok: false as const, error: { kind: r.error.kind, message: why }, meta: r.meta };
      notes.push(`${why} (bu grup atlandı)`);
      part++;
      continue;
    }
    part++;
    // Aynı ref başka bir elemana verilmişse (gruplar arası çakışma) bu grupta yeniden adlandırılır.
    const remap = new Map<string, string>();
    for (const row of (r.data.rows as Json[]) ?? []) {
      const ref = String(row.ref ?? '');
      if (ref && refOwner.has(ref) && refOwner.get(ref) !== sNorm(row.element) && !remap.has(ref)) remap.set(ref, `${ref}_${part}`);
    }
    for (const row of (r.data.rows as Json[]) ?? []) {
      const ref0 = String(row.ref ?? '');
      const ref = remap.get(ref0) ?? ref0;
      const parent0 = String(row.parentRef ?? '');
      const key = `${sNorm(row.element)}|${sNorm(row.function)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (ref && !refOwner.has(ref)) {
        refOwner.set(ref, sNorm(row.element));
        found.push({ ref, element: String(row.element ?? ''), level: String(row.level ?? '') });
      }
      rows.push({ ...row, ref, parentRef: remap.get(parent0) ?? parent0 });
    }
    issues.push(...(((r.data.issues as Json[] | undefined) ?? [])));
    meta = meta ? { ...meta, tokensIn: meta.tokensIn + r.meta.tokensIn, tokensOut: meta.tokensOut + r.meta.tokensOut, cached: meta.cached && r.meta.cached, retries: meta.retries + r.meta.retries } : r.meta;
  }
  if (!meta) return { ok: false as const, error: { kind: 'API_ERROR' as const, message: notes.join(' | ') || 'AI yanıt vermedi' } };
  return { ok: true as const, data: { rows, issues } as Json, meta, note: notes.length ? notes.join(' | ') : undefined };
}

export function review(env: AiEnv, a: { context: string; local: string; mode: AiMode }) {
  return run(env, 'FMEA Reviewer', a.mode, [
    { type: 'text', text: a.context },
    { type: 'text', text: `YEREL KALİTE KONTROL BULGULARI (tekrarlama; bunların ötesine bak):\n${a.local}\n\nGÖREV: Bağımsız AI Review yap. Kategoriler: Coverage, Logic, Risk, Controls, KC, Control Plan, Traceability, Completeness. "missed" listesinde "WHAT DID I MISS?" sorusunu cevapla: değerlendirilmemiş fonksiyon, hata modu, neden, proses adımı, özel proses parametresi, KC, kontrol. summary: en fazla 8 cümle.` },
  ], REVIEW_SCHEMA);
}

export const docTokens = (doc: ExtractedDoc) => doc.blocks.reduce((a, b) => a + estimateTokens(b.text), 0);
