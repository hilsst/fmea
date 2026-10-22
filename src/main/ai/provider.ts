// AIProvider soyutlaması (§53). Anthropic ve OpenAI bağlı; yerel model arayüzü hazır, bağlantısı NOT SUPPORTED.
import Anthropic from '@anthropic-ai/sdk';
import type { AiErrorKind, Json } from '../../shared/aischema';

export class AiError extends Error {
  constructor(public kind: AiErrorKind, message: string) {
    super(message);
  }
}

export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'pdf'; data: string; title: string }
  | { type: 'image'; data: string; mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' };

export interface CompleteArgs {
  system: string;
  content: ContentBlock[];
  schema: Json;
  /** Doğrulama hatasından sonra yeniden deneme için önceki yanıt ve hata listesi. */
  repair?: { previous: string; errors: string[] };
}

export interface CompleteResult {
  text: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

export interface AiProvider {
  id: 'anthropic' | 'openai' | 'local';
  label: string;
  model: string;
  complete(args: CompleteArgs): Promise<CompleteResult>;
}

export const MODEL = 'claude-opus-5-5';

/** 4.5.1: seçilebilir Claude modelleri (fiyat: girdi / çıktı, 1M token başına USD). */
export const ANTHROPIC_MODELS = [
  { id: 'claude-opus-5-5', label: 'Opus 5.5 – en iyi kalite ($4 / $20)' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5 – dengeli ($2 / $10)' },
  { id: 'claude-haiku-5-5', label: 'Haiku 5.5 – en ucuz ($0.10 / $0.50)' },
] as const;

export class AnthropicProvider implements AiProvider {
  id = 'anthropic' as const;
  label = 'Anthropic Claude';
  constructor(private apiKey: string, public model = MODEL) {}

  async complete({ system, content, schema, repair }: CompleteArgs): Promise<CompleteResult> {
    const client = new Anthropic(this.apiKey ? { apiKey: this.apiKey } : {});
    const blocks: Anthropic.Beta.BetaContentBlockParam[] = content.map((b) =>
      b.type === 'text'
        ? { type: 'text', text: b.text }
        : b.type === 'pdf'
          ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b.data }, title: b.title }
          : { type: 'image', source: { type: 'base64', media_type: b.mediaType, data: b.data } },
    );
    // Uzun doküman içeriği önbelleğe alınır (tekrarlanan analizlerde maliyet düşer)
    const last = blocks[blocks.length - 1];
    if (last && blocks.length > 1) (blocks[blocks.length - 2] as { cache_control?: unknown }).cache_control = { type: 'ephemeral' };
    const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: blocks }];
    if (repair) {
      messages.push({ role: 'assistant', content: repair.previous });
      messages.push({ role: 'user', content: `Önceki yanıt şemaya uymadı:\n${repair.errors.join('\n')}\nAynı içeriği şemaya tam uyan JSON olarak yeniden ver.` });
    }
    let res: Anthropic.Beta.BetaMessage;
    try {
      const stream = client.beta.messages.stream(
        {
          model: this.model,
          max_tokens: 32000,
          system,
          // Sunucu taraflı yedek model yalnızca Opus için; Haiku 5.5'te yok.
          ...(this.model.startsWith('claude-opus') ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
          output_config: { effort: 'high', format: { type: 'json_schema', schema } },
          messages,
        },
        { timeout: 15 * 60 * 1000 },
      );
      res = await stream.finalMessage();
    } catch (err) {
      if (err instanceof Anthropic.APIConnectionTimeoutError) throw new AiError('TIMEOUT', 'AI isteği zaman aşımına uğradı.');
      if (err instanceof Anthropic.APIConnectionError) throw new AiError('OFFLINE', 'AI analysis requires internet connection.');
      if (err instanceof Anthropic.AuthenticationError) throw new AiError('NO_KEY', 'API anahtarı geçersiz (401).');
      if (err instanceof Anthropic.APIError) throw new AiError('API_ERROR', `AI servisi hata döndürdü (${err.status ?? '?'}): ${err.message}`);
      throw new AiError('API_ERROR', err instanceof Error ? err.message : String(err));
    }
    if (res.stop_reason === 'refusal') throw new AiError('REFUSAL', 'AI bu isteği yanıtlamadı (refusal). İçeriği gözden geçirip tekrar deneyin.');
    if (res.stop_reason === 'max_tokens') throw new AiError('TRUNCATED', 'Yanıt uzunluk sınırında kesildi. Daha küçük bir doküman veya daha dar kapsamla deneyin.');
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text, model: res.model, tokensIn: res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0) + (res.usage.cache_creation_input_tokens ?? 0), tokensOut: res.usage.output_tokens };
  }
}

export const OPENAI_MODEL = 'gpt-5';
const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';

type OpenAiPart =
  | { type: 'text'; text: string }
  | { type: 'file'; file: { filename: string; file_data: string } }
  | { type: 'image_url'; image_url: { url: string } };

interface OpenAiResponse {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
}

/** OpenAI Chat Completions (SDK'sız, fetch). Şema doğrulama + yeniden deneme ve önbellek ortak katmanda (index.ts). */
export class OpenAiProvider implements AiProvider {
  id = 'openai' as const;
  label = 'OpenAI';
  constructor(private apiKey: string, public model = OPENAI_MODEL) {}

  async complete({ system, content, schema, repair }: CompleteArgs): Promise<CompleteResult> {
    const key = this.apiKey || process.env.OPENAI_API_KEY || '';
    if (!key) throw new AiError('NO_KEY', 'OpenAI API anahtarı tanımlı değil. Ayarlar → AI bölümünden girin.');
    const parts: OpenAiPart[] = content.map((b) =>
      b.type === 'text'
        ? { type: 'text', text: b.text }
        : b.type === 'pdf'
          ? { type: 'file', file: { filename: `${b.title || 'dokuman'}.pdf`.replace(/(\.pdf)+$/i, '.pdf'), file_data: `data:application/pdf;base64,${b.data}` } }
          : { type: 'image_url', image_url: { url: `data:${b.mediaType};base64,${b.data}` } },
    );
    const messages: unknown[] = [
      { role: 'system', content: system },
      { role: 'user', content: parts },
    ];
    if (repair) {
      messages.push({ role: 'assistant', content: repair.previous });
      messages.push({ role: 'user', content: `Önceki yanıt şemaya uymadı:\n${repair.errors.join('\n')}\nAynı içeriği şemaya tam uyan JSON olarak yeniden ver.` });
    }
    const body = {
      model: this.model,
      max_completion_tokens: 32000,
      messages,
      // strict:false – uygulama şemaları OpenAI strict kısıtlarına (tüm alanlar zorunlu vb.) uymayabilir; doğrulama yine yerelde yapılır.
      response_format: { type: 'json_schema', json_schema: { name: 'fmea_studio_output', schema, strict: false } },
    };
    let resp: Response;
    try {
      resp = await fetch(OPENAI_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15 * 60 * 1000),
      });
    } catch (err) {
      if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) throw new AiError('TIMEOUT', 'AI isteği zaman aşımına uğradı.');
      throw new AiError('OFFLINE', 'AI analysis requires internet connection.');
    }
    let res: OpenAiResponse;
    try {
      res = (await resp.json()) as OpenAiResponse;
    } catch {
      res = {};
    }
    if (resp.status === 401) throw new AiError('NO_KEY', 'OpenAI API anahtarı geçersiz (401).');
    if (!resp.ok) throw new AiError('API_ERROR', `AI servisi hata döndürdü (${resp.status}): ${res.error?.message ?? resp.statusText}`);
    const choice = res.choices?.[0];
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter') throw new AiError('REFUSAL', 'AI bu isteği yanıtlamadı (refusal). İçeriği gözden geçirip tekrar deneyin.');
    if (choice?.finish_reason === 'length') throw new AiError('TRUNCATED', 'Yanıt uzunluk sınırında kesildi. Daha küçük bir doküman veya daha dar kapsamla deneyin.');
    return { text: choice?.message?.content ?? '', model: res.model ?? this.model, tokensIn: res.usage?.prompt_tokens ?? 0, tokensOut: res.usage?.completion_tokens ?? 0 };
  }
}

class NotSupportedProvider implements AiProvider {
  constructor(public id: 'local', public label: string, public model = '') {}
  async complete(): Promise<CompleteResult> {
    throw new AiError('NOT_SUPPORTED', `${this.label}: NOT SUPPORTED – bu sağlayıcının bağlantısı bu sürümde yok. Arayüz hazırdır; Anthropic Claude veya OpenAI kullanın.`);
  }
}

export const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic Claude', supported: true },
  { id: 'openai', label: 'OpenAI', supported: true },
  { id: 'local', label: 'Yerel model (NOT SUPPORTED)', supported: false },
] as const;

/** Sağlayıcının ortam değişkeni (anahtar uygulamada kayıtlı değilse kullanılır). */
export const ENV_KEY: Record<string, string> = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY' };

export function makeProvider(id: string, apiKey: string, model?: string): AiProvider {
  if (id === 'openai') return new OpenAiProvider(apiKey, model || OPENAI_MODEL);
  if (id === 'local') return new NotSupportedProvider('local', 'Yerel model');
  return new AnthropicProvider(apiKey, ANTHROPIC_MODELS.some((m) => m.id === model) ? model : MODEL);
}
