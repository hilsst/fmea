// Yerel Document Intelligence: dosya türüne göre ayrıştırıcı seçer, ExtractedDoc üretir. Asla hata fırlatmaz.
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { UNSUPPORTED_MSG, parserFor, type ExtractedDoc, type ParserId } from '../../shared/docmodel';
import { errMsg, type ParseContext, type Parser, type ParseResult } from './util';
import { parsePdf } from './pdf';
import { parseDocx } from './docx';
import { parsePptx } from './pptx';
import { parseXlsx } from './xlsx';
import { parseCsv } from './csv';
import { parseTxt } from './txt';
import { parseEml } from './eml';
import { parseMsg } from './msg';
import { parseImage } from './image';
import { parseDxf } from './dxf';
import { parseStep } from './step';
import { parseIges } from './iges';

const PARSERS: Record<Exclude<ParserId, 'unsupported'>, Parser> = {
  pdf: parsePdf,
  docx: parseDocx,
  pptx: parsePptx,
  xlsx: parseXlsx,
  csv: parseCsv,
  txt: parseTxt,
  eml: parseEml,
  msg: parseMsg,
  image: parseImage,
  dxf: parseDxf,
  step: parseStep,
  iges: parseIges,
};

/** E-posta ekleri için iç içe ayrıştırma sınırı. */
const MAX_DEPTH = 3;

export async function extractDocument(fileName: string, data: Buffer): Promise<ExtractedDoc> {
  return extractAt(fileName, data, 0);
}

export async function extractDocumentFile(path: string): Promise<ExtractedDoc> {
  let data: Buffer;
  try {
    data = await readFile(path);
  } catch (e) {
    return envelope(basename(path), Buffer.alloc(0), 'unsupported', {
      status: 'error',
      messages: [{ level: 'error', text: `Dosya okunamadı: ${errMsg(e)}` }],
      meta: {},
      blocks: [],
    });
  }
  return extractDocument(basename(path), data);
}

async function extractAt(fileName: string, data: Buffer, depth: number): Promise<ExtractedDoc> {
  const parser = parserFor(fileName);
  if (parser === 'unsupported')
    return envelope(fileName, data, parser, { status: 'unsupported', messages: [{ level: 'error', text: UNSUPPORTED_MSG }], meta: {}, blocks: [] });
  const ctx: ParseContext = {
    depth,
    extract: (n, d, dep) =>
      dep > MAX_DEPTH
        ? Promise.resolve(
            envelope(n, d, parserFor(n), { status: 'unsupported', messages: [{ level: 'warning', text: 'İç içe ek sınırı aşıldı; ek ayrıştırılmadı.' }], meta: {}, blocks: [] }),
          )
        : extractAt(n, d, dep),
  };
  let res: ParseResult;
  try {
    res = await PARSERS[parser](fileName, data, ctx);
    if (res.status === 'ok' && !res.blocks.length) {
      res.status = 'partial';
      res.messages.push({ level: 'warning', text: 'Dokümandan metin çıkarılamadı (boş içerik).' });
    }
  } catch (e) {
    res = { status: 'error', messages: [{ level: 'error', text: `Ayrıştırma hatası: ${errorHint(parser, data) ?? errMsg(e)}` }], meta: {}, blocks: [] };
  }
  return envelope(fileName, data, parser, res);
}

/** Bilinen bozuk / korumalı dosya durumları için açıklayıcı ileti. */
function errorHint(parser: ParserId, data: Buffer): string | undefined {
  const ole = data.length > 8 && data.readUInt32BE(0) === 0xd0cf11e0;
  if ((parser === 'docx' || parser === 'xlsx' || parser === 'pptx') && ole)
    return 'Dosya parola korumalı veya eski Office (OLE) biçiminde; açılamadı.';
  if (!data.length) return 'Dosya boş.';
  return undefined;
}

function envelope(fileName: string, data: Buffer, parser: ParserId, r: ParseResult): ExtractedDoc {
  const doc: ExtractedDoc = {
    fileName,
    ext: fileName.includes('.') ? (fileName.toLowerCase().split('.').pop() ?? '') : '',
    hash: createHash('sha256').update(data).digest('hex'),
    size: data.length,
    parser,
    status: r.status,
    messages: r.messages,
    meta: r.meta,
    blocks: r.blocks,
    extractedAt: new Date().toISOString(),
  };
  if (r.email) doc.email = r.email;
  if (r.cad) doc.cad = r.cad;
  return doc;
}
