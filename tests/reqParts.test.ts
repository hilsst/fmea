import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { extractRequirements, groupChunks, mergeRequirementParts } from '../src/main/ai/index';
import type { Chunk, ExtractedDoc } from '../src/shared/docmodel';

const ch = (n: number, tokens: number): Chunk => ({ id: `abc-${n}`, docName: 'd', text: `t${n}`, locs: [], tokens });

describe('4.6.1 gereksinim çıkarımı parçalama', () => {
  it('tüm parçaları sırayla sınır altındaki gruplara toplar', () => {
    const g = groupChunks([ch(1, 3000), ch(2, 3000), ch(3, 3000), ch(4, 9000), ch(5, 100)], 8000);
    expect(g.map((x) => x.map((c) => c.id.split('-')[1]))).toEqual([['1', '2'], ['3'], ['4'], ['5']]);
  });

  it('sonuçları birleştirip tekrarları atar', () => {
    const m = mergeRequirementParts([
      { requirements: [{ text: 'Kalınlık 5 mm olmalıdır.' }], drawing: { drawingNumber: '', notes: [] }, issues: [{ description: 'a' }] },
      { requirements: [{ text: 'kalınlık  5 mm olmalıdır' }, { text: 'Delik Ø10' }], drawing: { drawingNumber: 'DW-1', notes: ['n'] }, issues: [] },
    ]);
    expect((m.requirements as unknown[]).length).toBe(2);
    expect((m.drawing as { drawingNumber: string }).drawingNumber).toBe('DW-1');
    expect((m.issues as unknown[]).length).toBe(1);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('büyük dokümanı parçalara böler, kesilen parçayı ikiye ayırıp yeniden dener', async () => {
    const blocks = Array.from({ length: 40 }, (_, i) => ({ id: `p${i + 1}`, kind: 'paragraph' as const, text: `Madde ${i + 1}: ${'parça kalınlığı ölçülmelidir. '.repeat(35)}`, loc: { line: i + 1 } }));
    const doc: ExtractedDoc = { fileName: 'sartname.txt', ext: 'txt', hash: 'abcdef0123', size: 1, parser: 'txt', status: 'ok', messages: [], meta: {}, blocks, extractedAt: '' };
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string);
      const docText: string = body.messages[1].content[0].text;
      n++;
      // ~6000 token üstü doküman metni "kesilir"
      const choice = docText.length > 21000
        ? { finish_reason: 'length', message: { content: '{' } }
        : { finish_reason: 'stop', message: { content: JSON.stringify({ requirements: [{ text: `REQ ${n}`, reqType: 'Dimensional', characteristic: '', nominal: null, lsl: null, usl: null, unit: '', tolerance: '', acceptance: '', verification: '', confidence: 'High', basis: 'SOURCE DATA', lowConfidenceReason: '', evidence: { docName: '', page: '', section: '', sheet: '', cell: '', balloon: '', quote: '', evidenceType: '' } }], drawing: { drawingNumber: '', revision: '', partNumber: '', material: '', generalTolerance: '', notes: [] }, issues: [] }) } };
      return new Response(JSON.stringify({ model: 'gpt-x', choices: [choice], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
    }));
    const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'req-'));
    const r = await extractRequirements(
      { apiKey: 'sk', provider: 'openai', cacheDir, online: () => true },
      { doc, docId: 'DOC-1', docLabel: 'Şartname', existing: [], candidates: [], mode: 'Standard' as never },
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const reqs = r.data.requirements as { text: string }[];
    expect(reqs.length).toBeGreaterThanOrEqual(3);
    expect(n).toBe(reqs.length + 1); // ilk parça bir kez kesildi, sonra ikiye bölündü
    expect(r.note).toMatch(/parça/);
  });
});
