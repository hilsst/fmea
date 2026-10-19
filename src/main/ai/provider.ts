// AIProvider soyutlaması (§53). Anthropic bağlı; OpenAI ve yerel model arayüzü hazır, bağlantısı NOT SUPPORTED.
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

export class AnthropicProvider implements AiProvider {
  id = 'anthropic' as const;
  label = 'Anthropic Claude';
  model = MODEL;
  constructor(private apiKey: string) {}

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
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
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

class NotSupportedProvider implements AiProvider {
  constructor(public id: 'openai' | 'local', public label: string, public model = '') {}
  async complete(): Promise<CompleteResult> {
    throw new AiError('NOT_SUPPORTED', `${this.label}: NOT SUPPORTED – bu sağlayıcının bağlantısı bu sürümde yok. Arayüz hazırdır; Anthropic Claude kullanın.`);
  }
}

export const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic Claude', supported: true },
  { id: 'openai', label: 'OpenAI (NOT SUPPORTED)', supported: false },
  { id: 'local', label: 'Yerel model (NOT SUPPORTED)', supported: false },
] as const;

export function makeProvider(id: string, apiKey: string): AiProvider {
  if (id === 'openai') return new NotSupportedProvider('openai', 'OpenAI');
  if (id === 'local') return new NotSupportedProvider('local', 'Yerel model');
  return new AnthropicProvider(apiKey);
}
