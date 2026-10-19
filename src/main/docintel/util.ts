// Ayrıştırıcıların ortak yardımcıları: blok üretimi, metin çözme, XML gezinme, başlık sezgisi.
import { XMLParser } from 'fast-xml-parser';
import type { CadInfo, DocBlock, DocLoc, EmailInfo, ExtractedDoc, ExtractMessage, ExtractStatus } from '../../shared/docmodel';

/** Ayrıştırıcının ürettiği içerik; zarf alanlarını (hash, size, ...) index.ts doldurur. */
export interface ParseResult {
  status: ExtractStatus;
  messages: ExtractMessage[];
  meta: Record<string, string>;
  blocks: DocBlock[];
  email?: EmailInfo;
  cad?: CadInfo;
}

export interface ParseContext {
  /** E-posta eklerini özyinelemeli ayrıştırmak için (döngüsel import olmasın diye enjekte edilir). */
  extract: (fileName: string, data: Buffer, depth: number) => Promise<ExtractedDoc>;
  depth: number;
}

export type Parser = (fileName: string, data: Buffer, ctx: ParseContext) => Promise<ParseResult>;

export class BlockList {
  readonly blocks: DocBlock[] = [];
  constructor(private prefix = 'b') {}
  add(kind: DocBlock['kind'], text: string, loc: DocLoc, level?: number): DocBlock | undefined {
    const t = text.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();
    if (!t) return undefined;
    const b: DocBlock = { id: `${this.prefix}${this.blocks.length + 1}`, kind, text: t, loc: cleanLoc(loc) };
    if (level != null) b.level = level;
    this.blocks.push(b);
    return b;
  }
}

function cleanLoc(loc: DocLoc): DocLoc {
  const o: DocLoc = {};
  for (const [k, v] of Object.entries(loc)) if (v !== undefined && v !== '') (o as Record<string, unknown>)[k] = v;
  return o;
}

export function result(blocks: DocBlock[], extra: Partial<ParseResult> = {}): ParseResult {
  return { status: 'ok', messages: [], meta: {}, blocks, ...extra };
}

/** Metin kodlaması: BOM → UTF-8 (katı) → Windows-1254 (Türkçe) → latin1. */
export function decodeText(buf: Buffer): string {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) return buf.subarray(3).toString('utf8');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    try {
      return new TextDecoder('windows-1254').decode(buf);
    } catch {
      return buf.toString('latin1');
    }
  }
}

export interface Para {
  text: string;
  line: number;
}

/** Satırları boş satırlarla ayrılmış paragraflara gruplar; line = 1 tabanlı başlangıç satırı. */
export function splitParagraphs(text: string, joiner = '\n'): Para[] {
  const out: Para[] = [];
  let cur: string[] = [];
  let start = 0;
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  lines.forEach((l, i) => {
    if (!l.trim()) {
      if (cur.length) out.push({ text: cur.join(joiner), line: start });
      cur = [];
      return;
    }
    if (!cur.length) start = i + 1;
    cur.push(l.trim());
  });
  if (cur.length) out.push({ text: cur.join(joiner), line: start });
  return out;
}

const HEADING_RE = /^((?:\d{1,2}\.)*\d{1,2})\.?\s+([A-ZÇĞİÖŞÜ][^\n]{0,90})$/;

/** "3.2 Thickness" gibi kısa numaralı başlık satırı mı? */
export function numberedHeading(line: string): { num: string; title: string; level: number } | null {
  const t = line.trim();
  if (t.length > 100) return null;
  const m = HEADING_RE.exec(t);
  if (!m) return null;
  const title = m[2].trim();
  if (/[.;:,]$/.test(title) || /\b(shall|must|should|olmalı)/i.test(title)) return null;
  // Ölçü / değer satırlarını başlık sanma
  if (/\d\s*(mm|µm|°|%|MPa|N)\b/.test(title) || /[±=<>]/.test(title)) return null;
  return { num: m[1], title, level: m[1].split('.').length };
}

/** Başlık metninin başındaki numara (varsa). */
export function leadingNumber(text: string): string | undefined {
  return /^((?:\d{1,2}\.)*\d{1,2})\.?\s+\S/.exec(text.trim())?.[1];
}

/** Teknik resim antet bilgileri – yalnızca metinde birebir geçiyorsa. */
export function titleBlockMeta(text: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const id = String.raw`([A-Z0-9][A-Z0-9\-_./]{1,40})`;
  const pick = (key: string, re: RegExp) => {
    const m = re.exec(text);
    if (m && !meta[key]) meta[key] = m[1].trim();
  };
  pick('drawingNo', new RegExp(String.raw`\b(?:DWG|DRAWING|ÇİZİM|RESİM)\s*(?:NO|NUMBER|NUM|#|N°)\.?\s*[:\-]?\s*${id}`, 'i'));
  pick('revision', /\bREV(?:ISION|IZYON|İZYON)?\.?\s*(?:NO\.?)?\s*[:\-]?\s*([A-Z]{1,2}\d?|\d{1,3})\b(?![a-z])/i);
  pick('partNo', new RegExp(String.raw`\b(?:PART|PARÇA)\s*(?:NO|NUMBER|NUM|#|N°)\.?\s*[:\-]?\s*${id}`, 'i'));
  pick('material', /\b(?:MATERIAL|MALZEME)\s*[:\-]\s*([^\n|]{2,60})/i);
  return meta;
}

// ───────── XML (fast-xml-parser preserveOrder) ─────────

export type XNode = Record<string, unknown>;

const orderedParser = new XMLParser({
  preserveOrder: true,
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: false,
  parseTagValue: false,
  parseAttributeValue: false,
});
const plainParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false, removeNSPrefix: true });

export const parseOrdered = (xml: string): XNode[] => orderedParser.parse(xml) as XNode[];
export const parsePlain = (xml: string): Record<string, unknown> => plainParser.parse(xml) as Record<string, unknown>;

export function tagOf(n: XNode): string {
  for (const k of Object.keys(n)) if (k !== ':@') return k;
  return '';
}
export function kids(n: XNode): XNode[] {
  const v = n[tagOf(n)];
  return Array.isArray(v) ? (v as XNode[]) : [];
}
export function attr(n: XNode, name: string): string | undefined {
  const a = n[':@'] as Record<string, string> | undefined;
  return a?.[`@_${name}`];
}
export function child(n: XNode, tag: string): XNode | undefined {
  return kids(n).find((k) => tagOf(k) === tag);
}
/** Ağaçta ilk eşleşen düğüm (derinlik öncelikli). */
export function findFirst(nodes: XNode[], tag: string): XNode | undefined {
  for (const n of nodes) {
    if (tagOf(n) === tag) return n;
    const f = findFirst(kids(n), tag);
    if (f) return f;
  }
  return undefined;
}
export function findAll(nodes: XNode[], tag: string, out: XNode[] = []): XNode[] {
  for (const n of nodes) {
    if (tagOf(n) === tag) out.push(n);
    else findAll(kids(n), tag, out);
  }
  return out;
}
export function textOf(n: XNode): string {
  const v = n['#text'];
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/** CJS/ESM varsayılan dışa aktarım uyumu. */
export function interop<T>(mod: unknown): T {
  let m = mod as { default?: unknown };
  while (m && typeof m === 'object' && 'default' in m && m.default) m = m.default as { default?: unknown };
  return m as T;
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
