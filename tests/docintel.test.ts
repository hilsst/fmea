import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { extractDocument, extractDocumentFile } from '../src/main/docintel/index';
import { CAD_PARTIAL_MSG, UNSUPPORTED_MSG, findRequirementCandidates, type ExtractedDoc } from '../src/shared/docmodel';
import { PDF_SCANNED_MSG } from '../src/main/docintel/pdf';
import { IMAGE_MSG } from '../src/main/docintel/image';
import { stripMtext } from '../src/main/docintel/dxf';
import { quotedParagraphs } from '../src/main/docintel/email';

const FIX = join(__dirname, 'fixtures', 'docs');
const fx = (n: string) => readFileSync(join(FIX, n));
const texts = (d: ExtractedDoc) => d.blocks.map((b) => b.text);

// ───────── Fikstür üreticileri ─────────

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const para = (text: string, style?: string, extra = '') =>
  `<w:p>${style || extra ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;

async function makeDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    'word/styles.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:styles ${W}>
      <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
      <w:style w:type="paragraph" w:styleId="Balk2"><w:name w:val="heading 2"/></w:style>
      <w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="caption"/></w:style>
      <w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/></w:style></w:styles>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>
      ${para('Bracket Specification', 'Title')}
      ${para('Scope', 'Heading1', '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>')}
      ${para('This document covers the bracket &amp; its fasteners.')}
      <w:p><w:r><w:br w:type="page"/></w:r></w:p>
      ${para('3 Requirements', 'Heading1')}
      ${para('3.2 Thickness', 'Balk2')}
      <w:p><w:r><w:t xml:space="preserve">The part shall be </w:t></w:r><w:r><w:t>2.00 ± 0.10 mm thick.</w:t></w:r><w:del><w:r><w:delText>DELETED</w:delText></w:r></w:del></w:p>
      <w:tbl>
        <w:tr><w:tc><w:p><w:r><w:t>Characteristic</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Value</w:t></w:r></w:p></w:tc></w:tr>
        <w:tr><w:tc><w:p><w:r><w:t>Hole diameter</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Ø6.00 ±0.05</w:t></w:r></w:p></w:tc></w:tr>
      </w:tbl>
      ${para('Table 1 – Key characteristics', 'Caption')}
      <w:sectPr/></w:body></w:document>`,
  );
  zip.file('word/header1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:hdr ${W}>${para('ACME Aero – CONFIDENTIAL')}</w:hdr>`);
  zip.file('word/footer1.xml', `<?xml version="1.0" encoding="UTF-8"?><w:ftr ${W}>${para('DOC-123 Rev B')}</w:ftr>`);
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Bracket Spec</dc:title><dc:creator>Kemal</dc:creator></cp:coreProperties>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const P = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const sp = (text: string, ph?: string) =>
  `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr>${ph ? `<p:ph type="${ph}"/>` : ''}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${text
    .split('\n')
    .map((t) => `<a:p><a:r><a:t>${t}</a:t></a:r></a:p>`)
    .join('')}</p:txBody></p:sp>`;
const slideXml = (inner: string, root = 'p:sld') => `<?xml version="1.0" encoding="UTF-8"?><${root} ${P}><p:cSld><p:spTree>${inner}</p:spTree></p:cSld></${root}>`;

async function makePptx(): Promise<Buffer> {
  const zip = new JSZip();
  // Sunum sırası dosya numarasından farklı: önce slide2
  zip.file('ppt/presentation.xml', `<?xml version="1.0" encoding="UTF-8"?><p:presentation ${P}><p:sldIdLst><p:sldId id="256" r:id="rId3"/><p:sldId id="257" r:id="rId2"/></p:sldIdLst></p:presentation>`);
  zip.file(
    'ppt/_rels/presentation.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide1.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide2.xml"/></Relationships>`,
  );
  zip.file('ppt/slides/slide2.xml', slideXml(sp('Design Review', 'ctrTitle') + sp('Program kickoff')));
  zip.file(
    'ppt/slides/slide1.xml',
    slideXml(
      sp('Cure cycle', 'title') +
        `<p:grpSp>${sp('Autoclave temperature shall be 180 ± 5 °C\nHold 120 min')}</p:grpSp>` +
        `<p:graphicFrame><a:graphic><a:graphicData><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Ramp</a:t></a:r></a:p></a:txBody></a:tc><a:tc><a:txBody><a:p><a:r><a:t>2 °C/min</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl></a:graphicData></a:graphic></p:graphicFrame>`,
    ),
  );
  zip.file(
    'ppt/slides/_rels/slide1.xml.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide1.xml"/></Relationships>`,
  );
  zip.file('ppt/notesSlides/notesSlide1.xml', slideXml(sp('', 'sldImg') + sp('Speaker: verify vacuum level', 'body') + sp('1', 'sldNum'), 'p:notes'));
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function makeXlsx(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Spec');
  ws.addRow(['Characteristic', 'Nominal', 'Tolerance', 'Unit']);
  ws.addRow(['Thickness', 2, '2.00 ± 0.10 mm', 'mm']);
  ws.addRow(['Double', { formula: 'B2*2', result: 4 }]);
  ws.getCell('A5').value = 'Surface roughness shall not exceed Ra 1.6';
  const ws2 = wb.addWorksheet('Notes');
  ws2.getCell('C3').value = 'Inspect 100%';
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Elle kurulmuş tek sayfalık PDF (Helvetica, WinAnsi); xref ofsetleri hesaplanır. */
function makePdf(lines: string[]): Buffer {
  const content = lines.length
    ? `BT /F1 12 Tf 72 720 Td 14 TL ${lines.map((l) => `(${l.replace(/[()\\]/g, '\\$&')}) Tj T*`).join(' ')} ET`
    : '';
  const contentBuf = Buffer.from(content, 'latin1');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${contentBuf.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
  ];
  let out = '%PDF-1.4\n';
  const offs: number[] = [];
  objs.forEach((o, i) => {
    offs.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

// ───────── Testler ─────────

describe('extractDocument – zarf ve hata yönetimi', () => {
  it('desteklenmeyen uzantı → unsupported + UNSUPPORTED_MSG', async () => {
    const d = await extractDocument('model.xyz', Buffer.from('hello'));
    expect(d.status).toBe('unsupported');
    expect(d.parser).toBe('unsupported');
    expect(d.messages).toEqual([{ level: 'error', text: UNSUPPORTED_MSG }]);
    expect(d.blocks).toEqual([]);
    expect(d.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(d.size).toBe(5);
    expect(d.ext).toBe('xyz');
    expect(() => new Date(d.extractedAt).toISOString()).not.toThrow();
  });

  it('bozuk DOCX / XLSX / PPTX / PDF / MSG / STEP / IGES / EML → error, fırlatmaz', async () => {
    const junk = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37) % 256));
    for (const n of ['bad.docx', 'bad.xlsx', 'bad.pptx', 'bad.pdf', 'bad.msg', 'bad.step', 'bad.igs']) {
      const d = await extractDocument(n, junk);
      expect(d.status, n).toBe('error');
      expect(d.blocks).toEqual([]);
      expect(d.messages[0].level).toBe('error');
      expect(d.messages[0].text).toMatch(/^Ayrıştırma hatası: /);
    }
  });

  it('OLE (şifreli Office) DOCX için açıklayıcı ileti', async () => {
    const ole = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(100)]);
    const d = await extractDocument('secret.docx', ole);
    expect(d.status).toBe('error');
    expect(d.messages[0].text).toContain('parola korumalı');
  });

  it('extractDocumentFile dosyayı okur; yoksa error döner', async () => {
    const d = await extractDocumentFile(join(FIX, 'part.step'));
    expect(d.fileName).toBe('part.step');
    expect(d.parser).toBe('step');
    const missing = await extractDocumentFile(join(FIX, 'yok.pdf'));
    expect(missing.status).toBe('error');
  });
});

describe('DOCX', () => {
  it('başlıklar, bölüm, tablo, başlık/altbilgi, sayfa, meta', async () => {
    const d = await extractDocument('spec.docx', await makeDocx());
    expect(d.status).toBe('ok');
    expect(d.parser).toBe('docx');
    expect(d.meta.title).toBe('Bracket Spec');
    expect(d.meta.author).toBe('Kemal');
    expect(d.messages).toContainEqual({ level: 'info', text: 'Sayfa numaraları DOCX içindeki sayfa sonlarına göre yaklaşıktır.' });

    const h = d.blocks.filter((b) => b.kind === 'heading');
    expect(h.map((b) => [b.text, b.level, b.loc.section])).toEqual([
      ['Bracket Specification', 0, 'Bracket Specification'],
      ['Scope', 1, '1'],
      ['3 Requirements', 1, '3'],
      ['3.2 Thickness', 2, '3.2'],
    ]);
    const req = d.blocks.find((b) => b.text.startsWith('The part shall'))!;
    expect(req.text).toBe('The part shall be 2.00 ± 0.10 mm thick.');
    expect(req.loc).toEqual({ page: 2, section: '3.2' });
    expect(texts(d).join(' ')).not.toContain('DELETED');
    expect(d.blocks.find((b) => b.text.startsWith('This document'))!.loc.page).toBe(1);

    const rows = d.blocks.filter((b) => b.kind === 'table-row');
    expect(rows.map((r) => [r.text, r.loc.cell])).toEqual([
      ['Characteristic | Value', 'T1 R1'],
      ['Hole diameter | Ø6.00 ±0.05', 'T1 R2'],
    ]);
    expect(d.blocks.find((b) => b.kind === 'caption')?.text).toBe('Table 1 – Key characteristics');
    expect(d.blocks[0]).toMatchObject({ kind: 'header', text: 'ACME Aero – CONFIDENTIAL', loc: { part: 'header' } });
    expect(d.blocks.at(-1)).toMatchObject({ kind: 'footer', text: 'DOC-123 Rev B', loc: { part: 'footer' } });
    expect(new Set(d.blocks.map((b) => b.id)).size).toBe(d.blocks.length);
  });

  it('findRequirementCandidates: shall cümlesi, bölüm ve tolerans', async () => {
    const d = await extractDocument('spec.docx', await makeDocx());
    const c = findRequirementCandidates(d).find((x) => x.text.includes('shall be 2.00'))!;
    expect(c).toBeDefined();
    expect(c.loc.section).toBe('3.2');
    expect(c.nominal).toBe(2);
    expect(c.lsl).toBe(1.9);
    expect(c.usl).toBe(2.1);
    expect(c.unit).toBe('mm');
    expect(c.confidence).toBe('High');
  });
});

describe('PPTX', () => {
  it('sunum sırası, başlık, grup, tablo, notlar', async () => {
    const d = await extractDocument('review.pptx', await makePptx());
    expect(d.status).toBe('ok');
    expect(d.blocks.filter((b) => b.loc.slide === 1).map((b) => b.text)).toEqual(['Design Review', 'Program kickoff']);
    const s2 = d.blocks.filter((b) => b.loc.slide === 2);
    expect(s2.map((b) => [b.kind, b.text])).toEqual([
      ['heading', 'Cure cycle'],
      ['paragraph', 'Autoclave temperature shall be 180 ± 5 °C\nHold 120 min'],
      ['table-row', 'Ramp | 2 °C/min'],
      ['note', 'Speaker: verify vacuum level'],
    ]);
    expect(s2[3].loc.part).toBe('notes');
  });
});

describe('XLSX', () => {
  it('satır ve hücre blokları, başlık satırı, formül sonucu', async () => {
    const d = await extractDocument('spec.xlsx', await makeXlsx());
    expect(d.status).toBe('ok');
    const rows = d.blocks.filter((b) => b.kind === 'table-row');
    expect(rows[0]).toMatchObject({ text: 'Characteristic | Nominal | Tolerance | Unit', loc: { sheet: 'Spec', cell: 'A1:D1', part: 'table-header' } });
    expect(rows[1]).toMatchObject({ text: 'Characteristic: Thickness | Nominal: 2 | Tolerance: 2.00 ± 0.10 mm | Unit: mm', loc: { sheet: 'Spec', cell: 'A2:D2' } });
    expect(rows[2].text).toBe('Characteristic: Double | Nominal: 4');
    const cells = d.blocks.filter((b) => b.kind === 'cell');
    expect(cells.map((c) => [c.text, c.loc.cell])).toEqual([
      ['2.00 ± 0.10 mm', 'C2'],
      ['Surface roughness shall not exceed Ra 1.6', 'A5'],
      ['Inspect 100%', 'C3'],
    ]);
    expect(cells[2].loc.sheet).toBe('Notes');
  });
});

describe('CSV / TXT', () => {
  it('CSV: tırnaklar, noktalı virgül, R{n}', async () => {
    const csv = 'Char;Value;Note\r\nThickness;"2,00 ± 0,10";"multi\nline; quoted ""x"""\r\n\r\nLength;10;\r\n';
    const d = await extractDocument('data.csv', Buffer.from(csv));
    expect(d.meta.delimiter).toBe(';');
    expect(d.blocks.map((b) => [b.text, b.loc.cell, b.loc.sheet])).toEqual([
      ['Char | Value | Note', 'R1', 'data.csv'],
      ['Char: Thickness | Value: 2,00 ± 0,10 | Note: multi line; quoted "x"', 'R2', 'data.csv'],
      ['Char: Length | Value: 10', 'R5', 'data.csv'],
    ]);
  });

  it('TXT: paragraflar ve satır numaraları, Windows-1254 yedeği', async () => {
    const txt = '1 Scope\nThis spec covers X.\n\n2.1 Cure\nCure temperature shall be 120 °C.\nSecond line.\n\n\nTail';
    const d = await extractDocument('notes.txt', Buffer.from(txt));
    expect(d.blocks.map((b) => [b.kind, b.loc.line, b.loc.section])).toEqual([
      ['heading', 1, '1'],
      ['paragraph', 2, '1'],
      ['heading', 4, '2.1'],
      ['paragraph', 5, '2.1'],
      ['paragraph', 9, '2.1'],
    ]);
    const tr = await extractDocument('tr.txt', Buffer.from([0x53, 0x49, 0x43, 0x41, 0x4b, 0x4c, 0x49, 0x4b, 0x20, 0xfe, 0xfd, 0xf0]));
    expect(tr.blocks[0].text).toBe('SICAKLIK şığ');
  });
});

describe('PDF', () => {
  it('metin katmanı, başlık, bölüm, sayfa', async () => {
    const pdf = makePdf(['DRAWING NO: BRK-001  REV: C', '3.2 Thickness', 'The part shall be 2.00 \xb1 0.10 mm thick.']);
    const d = await extractDocument('drawing.pdf', pdf);
    expect(d.status, JSON.stringify(d.messages)).toBe('ok');
    expect(d.meta.pages).toBe('1');
    expect(d.meta.drawingNo).toBe('BRK-001');
    expect(d.meta.revision).toBe('C');
    const h = d.blocks.find((b) => b.kind === 'heading')!;
    expect(h).toMatchObject({ text: '3.2 Thickness', level: 2, loc: { page: 1, section: '3.2' } });
    const p = d.blocks.find((b) => b.text.includes('shall'))!;
    expect(p.text).toBe('The part shall be 2.00 ± 0.10 mm thick.');
    expect(p.loc).toEqual({ page: 1, section: '3.2' });
    const c = findRequirementCandidates(d)[0];
    expect([c.nominal, c.lsl, c.usl]).toEqual([2, 1.9, 2.1]);
  });

  it('metinsiz (taranmış) PDF → partial + uyarı', async () => {
    const d = await extractDocument('scan.pdf', makePdf([]));
    expect(d.status).toBe('partial');
    expect(d.blocks).toEqual([]);
    expect(d.messages).toContainEqual({ level: 'warning', text: PDF_SCANNED_MSG });
  });
});

describe('E-posta', () => {
  it('EML: başlıklar, gövde, alıntı, ekler (özyinelemeli)', async () => {
    const d = await extractDocument('mail.eml', fx('mail.eml'));
    expect(d.status).toBe('ok');
    expect(d.email).toMatchObject({
      from: 'Ayse Yilmaz <ayse@supplier.example>',
      to: ['Kemal <kemal@oem.example>', 'qa@oem.example'],
      cc: ['Team <team@oem.example>'],
      subject: 'Bracket spec update',
      date: '2026-10-12T06:30:00.000Z',
    });
    expect(d.email!.attachments.map((a) => a.name)).toEqual(['spec.txt', 'notes.xyz']);
    expect(d.blocks.filter((b) => b.kind === 'email-header').map((b) => b.text.split(':')[0])).toEqual(['From', 'To', 'Cc', 'Subject', 'Date']);
    const body = d.blocks.find((b) => b.text.includes('3.00 ± 0.15'))!;
    expect(body).toMatchObject({ kind: 'paragraph', loc: { part: 'body' } });
    const quoted = d.blocks.filter((b) => b.kind === 'quoted');
    expect(quoted.length).toBeGreaterThan(0);
    expect(quoted.some((b) => b.text.includes('must be 2.50 mm'))).toBe(true);
    expect(quoted.every((b) => b.loc.part === 'quoted')).toBe(true);
    expect(d.blocks.filter((b) => b.kind === 'attachment').length).toBe(2);
    const att = d.blocks.find((b) => b.text.includes('coating thickness'))!;
    expect(att).toMatchObject({ kind: 'paragraph', loc: { part: 'spec.txt', line: 1 } });
    expect(att.id).toMatch(/^a1-/);
    const cands = findRequirementCandidates(d);
    expect(cands.find((c) => c.text.includes('2.50'))?.confidence).toBe('Low');
    expect(cands.find((c) => c.text.includes('3.00'))?.confidence).toBe('High');
  });

  it('alıntı ayrımı: Outlook / Türkçe işaretleri', () => {
    const q = quotedParagraphs('Tamam.\n\nKimden: Ali\nGönderildi: Pazartesi\nKonu: X\n\nEski metin');
    expect(q).toEqual([
      { text: 'Tamam.', quoted: false },
      { text: 'Kimden: Ali\nGönderildi: Pazartesi\nKonu: X', quoted: true },
      { text: 'Eski metin', quoted: true },
    ]);
  });

  it('MSG: geçersiz içerik → error, fırlatmaz', async () => {
    const d = await extractDocument('mail.msg', Buffer.from('not an outlook message at all'.repeat(40)));
    expect(d.status).toBe('error');
    expect(d.parser).toBe('msg');
  });
});

describe('Görsel', () => {
  it('PNG → partial, OCR uyarısı, boyutlar', async () => {
    const png = Buffer.alloc(33);
    png.writeUInt32BE(0x89504e47, 0);
    png.writeUInt32BE(0x0d0a1a0a, 4);
    png.writeUInt32BE(13, 8);
    png.write('IHDR', 12, 'latin1');
    png.writeUInt32BE(640, 16);
    png.writeUInt32BE(480, 20);
    const d = await extractDocument('photo.png', png);
    expect(d.status).toBe('partial');
    expect(d.blocks).toEqual([]);
    expect(d.meta).toMatchObject({ format: 'PNG', width: '640', height: '480' });
    expect(d.messages).toEqual([{ level: 'warning', text: IMAGE_MSG }]);
  });
});

describe('CAD', () => {
  it('DXF: TEXT, MTEXT, DIMENSION, katmanlar, birim', async () => {
    const d = await extractDocument('drawing.dxf', fx('drawing.dxf'));
    expect(d.status).toBe('partial');
    expect(d.messages[0]).toEqual({ level: 'warning', text: CAD_PARTIAL_MSG });
    expect(d.cad).toMatchObject({ format: 'DXF', units: 'mm', entityCounts: { TEXT: 1, MTEXT: 1, DIMENSION: 2, LINE: 1 } });
    expect(d.cad!.layers).toEqual(expect.arrayContaining(['0', 'DIMS', 'NOTES']));
    expect(d.blocks.map((b) => [b.kind, b.text, b.loc.layer])).toEqual([
      ['text', 'DWG NO: FS-1001 REV B', 'NOTES'],
      ['text', 'MATERIAL: AL 7075-T6\nHOLE Ø6.00 ±0.05 SHALL BE REAMED', 'NOTES'],
      ['dimension', '25.4 ±0.10', 'DIMS'],
      ['dimension', 'Ø6', 'DIMS'],
    ]);
    expect(d.meta).toMatchObject({ drawingNo: 'FS-1001', revision: 'B', material: 'AL 7075-T6' });
    expect(stripMtext('{\\H2.5x;\\C1;A\\S1^2;}\\~B\\\\C')).toBe('A1/2 B\\C');
  });

  it('STEP: başlık, varlık sayıları, PRODUCT, birim', async () => {
    const d = await extractDocument('part.step', fx('part.step'));
    expect(d.status).toBe('partial');
    expect(d.messages[0].text).toBe(CAD_PARTIAL_MSG);
    expect(d.cad!.format).toBe('STEP');
    expect(d.cad!.units).toBe('mm');
    expect(d.cad!.header).toMatchObject({
      FILE_NAME: 'bracket.step',
      FILE_SCHEMA: 'AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }',
      FILE_DESCRIPTION: 'FMEA test part; Bracket',
      author: 'Kemal',
      organization: 'ACME Aero',
      originatingSystem: 'SolidWorks 2024',
    });
    expect(d.cad!.entityCounts).toEqual({
      APPLICATION_CONTEXT: 1, PRODUCT_CONTEXT: 1, PRODUCT: 2, CARTESIAN_POINT: 2, DIRECTION: 1, COMPLEX_ENTITY: 1, GEOMETRIC_TOLERANCE: 1,
    });
    const prods = d.blocks.filter((b) => b.kind === 'entity').map((b) => b.text);
    expect(prods).toEqual(["PRODUCT: BRK-001 – Bracket Çelik – Main bracket, don't paint", 'PRODUCT: SCR-M6 – Screw M6']);
    expect(d.messages.some((m) => m.text.includes('PMI'))).toBe(true);
  });

  it('IGES: S/G bölümleri, varlık sayıları, genel not ve ölçü', async () => {
    const d = await extractDocument('part.igs', fx('part.igs'));
    expect(d.status).toBe('partial');
    expect(d.parser).toBe('iges');
    expect(d.messages[0].text).toBe(CAD_PARTIAL_MSG);
    expect(d.cad).toMatchObject({
      format: 'IGES',
      units: 'mm',
      entityCounts: { '110 Line': 1, '212 General Note': 2, '216 Linear Dimension': 1 },
      header: { fileName: 'part.igs', author: 'Kemal', organization: 'ACME Aero', nativeSystem: 'SolidWork' },
    });
    expect(d.blocks.map((b) => [b.kind, b.text])).toEqual([
      ['note', 'FMEA Studio IGES test fixture\nBracket drawing with notes'],
      ['dimension', '6.00+/-0.05'],
      ['note', 'MATERIAL: AL 7075-T6'],
    ]);
    expect(d.blocks[1].loc.layer).toBe('level 5');
  });
});
