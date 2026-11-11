// 4.9.4: Word/Excel dosyası bağlanıp “Analiz et” yapılmadan “AI: Gereksinim çıkar” denince PARSER_ERROR alınıyordu.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { extractRequirements } from '../src/main/ai/index';
import { extractDocument, extractDocumentFile } from '../src/main/docintel/index';
import { parserFor } from '../src/shared/docmodel';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"';
const p = (t: string) => `<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`;

async function docx(body: string, part = 'word/document.xml'): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>');
  zip.file('_rels/.rels', `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="/${part}"/></Relationships>`);
  zip.file(part, `<?xml version="1.0"?><w:document ${W}><w:body>${body}</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const REQ = { text: 'R', reqType: 'Dimensional', characteristic: '', nominal: null, lsl: null, usl: null, unit: '', tolerance: '', acceptance: '', verification: '', confidence: 'High', basis: 'SOURCE DATA', lowConfidenceReason: '', evidence: { docName: '', page: '', section: '', sheet: '', cell: '', balloon: '', quote: '', evidenceType: '' } };
const sent: string[] = [];
function stubAi() {
  sent.length = 0;
  vi.stubGlobal('fetch', vi.fn(async (_u: string, init: RequestInit) => {
    sent.push(JSON.parse(init.body as string).messages[1].content[0].text);
    const content = JSON.stringify({ requirements: [REQ], drawing: { drawingNumber: '', revision: '', partNumber: '', material: '', generalTolerance: '', notes: [] }, issues: [] });
    return new Response(JSON.stringify({ model: 'gpt-x', choices: [{ finish_reason: 'stop', message: { content } }], usage: { prompt_tokens: 1, completion_tokens: 1 } }), { status: 200 });
  }));
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'w494-'));
const env = () => ({ apiKey: 'sk', provider: 'openai' as const, cacheDir: tmp(), online: () => true });
const args = (filePath: string) => ({ doc: null, filePath, docId: 'DOC-1', docLabel: 'Şartname', existing: [], candidates: [], mode: 'Standard' as never });

afterEach(() => vi.unstubAllGlobals());

describe('4.9.4 Word/Excel gereksinim çıkarımı', () => {
  it('analiz edilmemiş .docx: yerelde ayrıştırılıp AI\'ye metin olarak gider (PARSER_ERROR yok)', async () => {
    stubAi();
    const f = path.join(tmp(), 'sartname.docx');
    fs.writeFileSync(f, await docx(`${p('Braket 6061-T6 alüminyumdan imal edilmelidir.')}<w:tbl><w:tr><w:tc>${p('Kalınlık')}</w:tc><w:tc>${p('5 ± 0,1 mm olmalıdır')}</w:tc></w:tr></w:tbl>`));
    const r = await extractRequirements(env(), args(f), extractDocumentFile);
    expect(r.ok).toBe(true);
    expect(sent[0]).toContain('Braket 6061-T6');
    expect(sent[0]).toContain('Kalınlık | 5 ± 0,1 mm olmalıdır');
  });

  it('analiz edilmemiş .xlsx: aynı şekilde çalışır', async () => {
    stubAi();
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Gereksinimler').addRows([['No', 'Gereksinim'], [1, 'Yüzey pürüzlülüğü Ra 3,2 µm olmalıdır.']]);
    const f = path.join(tmp(), 'liste.xlsx');
    await wb.xlsx.writeFile(f);
    const r = await extractRequirements(env(), args(f), extractDocumentFile);
    expect(r.ok).toBe(true);
    expect(sent[0]).toContain('Ra 3,2 µm');
  });

  it('.doc / .xls: genel hata yerine “.docx/.xlsx olarak kaydedin” iletisi', async () => {
    const dir = tmp();
    for (const [n, word] of [['eski.doc', '.docx'], ['eski.xls', '.xlsx']] as const) {
      const f = path.join(dir, n);
      fs.writeFileSync(f, Buffer.from([0xd0, 0xcf, 0x11, 0xe0]));
      const r = await extractRequirements(env(), args(f), extractDocumentFile);
      expect(r.ok).toBe(false);
      if (r.ok) continue;
      expect(r.error.kind).toBe('UNSUPPORTED_DOCUMENT');
      expect(r.error.message).toContain(word);
    }
  });

  it('.docm/.dotx/.xltx ayrıştırıcıya bağlı', () => {
    expect(['a.docm', 'a.dotx', 'a.dotm', 'a.xltx', 'a.xltm'].map(parserFor)).toEqual(['docx', 'docx', 'docx', 'xlsx', 'xlsx']);
  });

  it('DOCX: ana bölüm _rels üzerinden (document2.xml) ve gövde düzeyinde mc:AlternateContent', async () => {
    const d = await extractDocument('a.docx', await docx(`${p('Bir')}<mc:AlternateContent><mc:Choice Requires="w14">${p('İki')}</mc:Choice><mc:Fallback>${p('İki-yedek')}</mc:Fallback></mc:AlternateContent>`, 'word/document2.xml'));
    expect(d.blocks.map((b) => b.text)).toEqual(['Bir', 'İki']);
  });
});
