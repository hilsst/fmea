// AI görevleri: yerel çıkarım → parçalama → ilgili bölüm seçimi → AI → şema doğrulama (+1 yeniden deneme) → önbellek (§55, §61).
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  DFMEA_SCHEMA, PFMEA_SCHEMA, REQUIREMENTS_SCHEMA, REVIEW_SCHEMA, parseJson, validate,
  type AiResult, type AiRunMeta, type Json,
} from '../../shared/aischema';
import { chunkDoc, estimateTokens, locText, retrieve, type ExtractedDoc, type RequirementCandidate } from '../../shared/docmodel';
import { sha256 } from '../../shared/sha256';
import { AiError, makeProvider, type AiProvider, type ContentBlock } from './provider';
import { systemPrompt, type AiMode, type AiRole } from './roles';

export interface AiEnv {
  apiKey: string;
  provider: string;
  cacheDir: string;
  online: () => boolean;
}

const DOC_TOKEN_BUDGET = 60000;

async function run(env: AiEnv, role: AiRole, mode: AiMode, content: ContentBlock[], schema: Json): Promise<AiResult> {
  const meta: AiRunMeta = { role, provider: env.provider || 'anthropic', model: '', at: new Date().toISOString(), mode, tokensIn: 0, tokensOut: 0, cached: false, retries: 0 };
  try {
    if (!env.online()) throw new AiError('OFFLINE', 'AI analysis requires internet connection.');
    const provider: AiProvider = makeProvider(env.provider, env.apiKey);
    if (provider.id === 'anthropic' && !env.apiKey && !process.env.ANTHROPIC_API_KEY) throw new AiError('NO_KEY', 'AI API anahtarı tanımlı değil. Ayarlar → AI bölümünden girin.');
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

/** Dokümanı AI'ye gidecek içeriğe çevirir: metin varsa konum etiketli parçalar, yoksa (taranmış/görsel) dosyanın kendisi. */
async function docContent(doc: ExtractedDoc | null, filePath: string | undefined, focus: string): Promise<{ blocks: ContentBlock[]; note: string; role: AiRole }> {
  if (doc?.status === 'unsupported') throw new AiError('UNSUPPORTED_DOCUMENT', 'Bu dosya formatı analiz için desteklenmiyor.');
  if (doc && doc.blocks.length) {
    const chunks = chunkDoc(doc);
    const total = chunks.reduce((a, c) => a + c.tokens, 0);
    let use = chunks;
    let note = '';
    if (total > DOC_TOKEN_BUDGET) {
      use = [];
      let tok = 0;
      for (const c of retrieve(chunks, focus, chunks.length)) {
        if (tok + c.tokens > DOC_TOKEN_BUDGET) break;
        use.push(c);
        tok += c.tokens;
      }
      note = `Doküman büyük (${total} token); ilgili ${use.length}/${chunks.length} bölüm analiz edildi. Kalan bölümler için kapsam daraltılarak tekrar çalıştırın.`;
    }
    const drawing = /drawing|resim|dwg|dxf|step|iges/i.test(`${doc.fileName} ${doc.parser} ${Object.keys(doc.meta).join(' ')}`) || doc.parser === 'dxf';
    const head = `DOKÜMAN: ${doc.fileName} (ayrıştırıcı: ${doc.parser}, durum: ${doc.status})${doc.messages.length ? '\nNOTLAR: ' + doc.messages.map((m) => m.text).join(' | ') : ''}\nHer satırın başındaki [konum] etiketini evidence alanlarına aktar.`;
    return { blocks: [{ type: 'text', text: `${head}\n\n${use.map((c) => c.text).join('\n')}` }], note, role: drawing ? 'Drawing Analyst' : 'Requirement Analyst' };
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

export async function extractRequirements(
  env: AiEnv,
  a: { doc: ExtractedDoc | null; filePath?: string; docId: string; docLabel: string; existing: string[]; candidates: RequirementCandidate[]; mode: AiMode },
): Promise<AiResult & { note?: string }> {
  let prepared;
  try {
    prepared = await docContent(a.doc, a.filePath, 'shall must required tolerance olmalıdır gereklidir minimum maximum ± mm °C MPa material coating inspection');
  } catch (err) {
    const e = err as AiError;
    return { ok: false, error: { kind: e.kind ?? 'PARSER_ERROR', message: e.message } };
  }
  const local = a.candidates.slice(0, 300).map((c, i) => `${i + 1}. [${locText(c.loc)}] ${c.text}`).join('\n');
  const task = `GÖREV: ${a.docId} (${a.docLabel}) dokümanındaki gereksinimleri çıkar.
- Yerel ayrıştırıcının bulduğu aday cümleler aşağıda (eksik veya fazla olabilir; doğrula, birleştirme, kaçanları ekle):
${local || '(aday yok)'}
- reqType: Functional, Performance, Dimensional, Material, Process, Environmental, Reliability, Safety, Regulatory, Interface, Manufacturing, Inspection, Customer-specific.
- Teknik resimse drawing alanını doldur (yalnızca resimde yazanlar), değilse boş metin.
- Projede zaten olan gereksinimleri tekrar etme:\n${a.existing.slice(0, 200).join('\n') || '(yok)'}`;
  const r = await run(env, prepared.role, a.mode, [...prepared.blocks, { type: 'text', text: task }], REQUIREMENTS_SCHEMA);
  return { ...r, note: prepared.note };
}

export function suggestDfmea(env: AiEnv, a: { context: string; target: string; mode: AiMode }) {
  return run(env, 'FMEA Generator', a.mode, [
    { type: 'text', text: a.context },
    { type: 'text', text: `GÖREV: Aşağıdaki fonksiyon(lar) için DFMEA satırları öner. functionId ve reqIds yukarıdaki ID’lerden seçilir. Her S/O/D için sWhy/oWhy/dWhy gerekçesi ver (puanlama kriter tablosuna atıf). Mevcut hata modlarını tekrarlama. Bir fonksiyon için tam kayıp, kısmi, aralıklı, istenmeyen fonksiyon hata modlarını değerlendir.\n${a.target}` },
  ], DFMEA_SCHEMA);
}

export function suggestPfmea(env: AiEnv, a: { context: string; target: string; composite: string; mode: AiMode }) {
  return run(env, 'Process Analyst', a.mode, [
    { type: 'text', text: a.context },
    { type: 'text', text: `GÖREV: Aşağıdaki proses adım(lar)ı için PFMEA satırları öner. dfIds ilgili DFMEA ID’leri. cause4M zorunlu; why dizisi 5 Neden (en fazla 5), rootCause sistem zafiyeti olmalı. Özel proseslerde params listesine izlenmesi gereken parametreleri ekle (limit yazma).\nKompozit bilgi tabanı (ENGINEERING KNOWLEDGE):\n${a.composite}\nMevcut hata modlarını tekrarlama.\n${a.target}` },
  ], PFMEA_SCHEMA);
}

export function review(env: AiEnv, a: { context: string; local: string; mode: AiMode }) {
  return run(env, 'FMEA Reviewer', a.mode, [
    { type: 'text', text: a.context },
    { type: 'text', text: `YEREL KALİTE KONTROL BULGULARI (tekrarlama; bunların ötesine bak):\n${a.local}\n\nGÖREV: Bağımsız AI Review yap. Kategoriler: Coverage, Logic, Risk, Controls, KC, Control Plan, Traceability, Completeness. "missed" listesinde "WHAT DID I MISS?" sorusunu cevapla: değerlendirilmemiş fonksiyon, hata modu, neden, proses adımı, özel proses parametresi, KC, kontrol. summary: en fazla 8 cümle.` },
  ], REVIEW_SCHEMA);
}

export const docTokens = (doc: ExtractedDoc) => doc.blocks.reduce((a, b) => a + estimateTokens(b.text), 0);
