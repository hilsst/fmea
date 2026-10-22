import { describe, expect, it, vi } from 'vitest';

const calls: Record<string, unknown>[] = [];
vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const real = (await importOriginal()) as { default: { BadRequestError: new (...a: unknown[]) => Error } };
  const Real = real.default;
  class Fake {
    beta = {
      messages: {
        stream: (body: Record<string, unknown>) => {
          calls.push(body);
          return {
            finalMessage: async () => {
              if ((body.output_config as { format?: unknown }).format)
                throw new Real.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'The compiled grammar is too large' } }, 'The compiled grammar is too large, which would cause performance issues.', new Headers());
              return { stop_reason: 'end_turn', model: body.model, content: [{ type: 'text', text: '{"rows":[]}' }], usage: { input_tokens: 1, output_tokens: 1 } };
            },
          };
        },
      },
    };
  }
  for (const k of ['BadRequestError', 'APIConnectionTimeoutError', 'APIConnectionError', 'AuthenticationError', 'APIError'] as const)
    Object.defineProperty(Fake, k, { value: (Real as unknown as Record<string, unknown>)[k] });
  return { ...real, default: Fake };
});

describe('Anthropic dilbilgisi sınırı', () => {
  it('"grammar is too large" 400 → şema talimata konup biçimsiz yeniden denenir, sonra hep biçimsiz', async () => {
    const { AnthropicProvider } = await import('../src/main/ai/provider');
    const p = new AnthropicProvider('k', 'claude-haiku-5-5');
    const schema = { type: 'object', properties: { rows: { type: 'array' } } };
    const r = await p.complete({ system: 'sys', content: [{ type: 'text', text: 'x' }], schema });
    expect(r.text).toBe('{"rows":[]}');
    expect(calls).toHaveLength(2);
    expect(String(calls[1].system)).toContain('YANIT BİÇİMİ');
    await p.complete({ system: 'sys', content: [{ type: 'text', text: 'y' }], schema });
    expect(calls).toHaveLength(3);
    expect((calls[2].output_config as { format?: unknown }).format).toBeUndefined();
  });
});
