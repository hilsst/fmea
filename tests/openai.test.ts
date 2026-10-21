import { afterEach, describe, expect, it, vi } from 'vitest';
import { AiError, makeProvider, OpenAiProvider } from '../src/main/ai/provider';

const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('OpenAI sağlayıcısı', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makeProvider openai → OpenAiProvider (NOT SUPPORTED değil)', () => {
    const p = makeProvider('openai', 'sk-test', 'gpt-x');
    expect(p).toBeInstanceOf(OpenAiProvider);
    expect(p.model).toBe('gpt-x');
  });

  it('PDF/görsel bloklarını ve json_schema biçimini gönderir, metni döndürür', async () => {
    const f = reply(200, { model: 'gpt-x', choices: [{ finish_reason: 'stop', message: { content: '{"a":1}' } }], usage: { prompt_tokens: 10, completion_tokens: 3 } });
    vi.stubGlobal('fetch', f);
    const r = await new OpenAiProvider('sk-test', 'gpt-x').complete({
      system: 'sys',
      schema: { type: 'object' },
      content: [{ type: 'pdf', data: 'QUJD', title: 'cizim.pdf' }, { type: 'image', data: 'QUJD', mediaType: 'image/png' }, { type: 'text', text: 'soru' }],
    });
    expect(r).toEqual({ text: '{"a":1}', model: 'gpt-x', tokensIn: 10, tokensOut: 3 });
    const [, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body as string);
    expect(body.response_format.type).toBe('json_schema');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(body.messages[1].content[0]).toEqual({ type: 'file', file: { filename: 'cizim.pdf', file_data: 'data:application/pdf;base64,QUJD' } });
    expect(body.messages[1].content[1].image_url.url).toBe('data:image/png;base64,QUJD');
  });

  it('hata türlerini eşler (401, kesilme, ret)', async () => {
    const p = new OpenAiProvider('sk-test');
    const args = { system: 's', schema: {}, content: [{ type: 'text' as const, text: 'x' }] };
    const kind = async () => p.complete(args).then(() => '', (e: AiError) => e.kind);
    vi.stubGlobal('fetch', reply(401, { error: { message: 'bad key' } }));
    expect(await kind()).toBe('NO_KEY');
    vi.stubGlobal('fetch', reply(200, { choices: [{ finish_reason: 'length', message: { content: '{' } }] }));
    expect(await kind()).toBe('TRUNCATED');
    vi.stubGlobal('fetch', reply(200, { choices: [{ finish_reason: 'stop', message: { content: null, refusal: 'no' } }] }));
    expect(await kind()).toBe('REFUSAL');
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    expect(await kind()).toBe('OFFLINE');
  });
});
