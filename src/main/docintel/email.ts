// EML ve MSG için ortak: alıntı ayrımı, HTML → metin, ek dosyaların özyinelemeli ayrıştırılması.
import { parserFor, type EmailInfo, type ExtractMessage } from '../../shared/docmodel';
import { BlockList, result, type ParseContext, type ParseResult } from './util';

export interface MailAttachment {
  name: string;
  mime: string;
  size: number;
  data?: Buffer;
}

export interface MailInput {
  from: string;
  to: string[];
  cc: string[];
  subject: string;
  date: string;
  text?: string;
  html?: string;
  attachments: MailAttachment[];
  meta?: Record<string, string>;
  messages?: ExtractMessage[];
}

const QUOTE_MARK = '\u0000QUOTE\u0000';

const MARKERS: RegExp[] = [
  /^-{2,}\s*(original message|özgün ileti|orijinal ileti|asıl ileti|forwarded message|iletilen ileti|ursprüngliche nachricht)\s*-{2,}/i,
  /^(on|am|le)\s.+(wrote|schrieb|a écrit)\s*:\s*$/i,
  /yazdı\s*:\s*$/i,
  /^\*?(from|kimden|gönderen|von)\s*:\*?\s+\S/i,
  /^_{10,}\s*$/,
];

/** Gövde satırlarını alıntı / asıl metin olarak işaretler. İlk alıntı işaretinden sonrası tamamen alıntıdır. */
export function markQuoted(text: string): { line: string; quoted: boolean }[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const out: { line: string; quoted: boolean }[] = [];
  let rest = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const t = l.trim();
    if (t === QUOTE_MARK) {
      rest = true;
      continue;
    }
    if (!rest) {
      const twoLineOn = /^(on|am|le)\s/i.test(t) && /(wrote|schrieb|a écrit)\s*:\s*$/i.test(lines[i + 1]?.trim() ?? '') && t.length < 120;
      if (twoLineOn || MARKERS.some((re) => re.test(t))) rest = true;
    }
    if (rest) out.push({ line: l.replace(/^(\s*>)+\s?/, ''), quoted: true });
    else if (/^\s*>/.test(l)) out.push({ line: l.replace(/^(\s*>)+\s?/, ''), quoted: true });
    else out.push({ line: l, quoted: false });
  }
  return out;
}

/** Paragraflar: boş satır veya alıntı durumu değişince bölünür. */
export function quotedParagraphs(text: string): { text: string; quoted: boolean }[] {
  const out: { text: string; quoted: boolean }[] = [];
  let cur: string[] = [];
  let q = false;
  const flush = () => {
    if (cur.length) out.push({ text: cur.join('\n'), quoted: q });
    cur = [];
  };
  for (const { line, quoted } of markQuoted(text)) {
    if (!line.trim()) {
      flush();
      continue;
    }
    if (cur.length && quoted !== q) flush();
    q = quoted;
    cur.push(line.trim());
  }
  flush();
  return out;
}

const ENT: Record<string, string> = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", ndash: '–', mdash: '—', plusmn: '±', deg: '°', micro: 'µ', oslash: 'ø', Oslash: 'Ø' };

export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<blockquote[^>]*>/gi, `\n${QUOTE_MARK}\n`)
    .replace(/<div[^>]*(divRplyFwdMsg|gmail_quote|OutlookMessageHeader)[^>]*>/gi, `\n${QUOTE_MARK}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<(td|th)[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) =>
      e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENT[e] ?? m),
    )
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

function isoDate(d: string): string {
  const t = Date.parse(d);
  return d && !Number.isNaN(t) ? new Date(t).toISOString() : d;
}

export async function buildEmailResult(m: MailInput, ctx: ParseContext): Promise<ParseResult> {
  const bl = new BlockList();
  const messages: ExtractMessage[] = [...(m.messages ?? [])];
  const date = isoDate(m.date);
  const hdr: [string, string][] = [
    ['From', m.from],
    ['To', m.to.join(', ')],
    ['Cc', m.cc.join(', ')],
    ['Subject', m.subject],
    ['Date', date],
  ];
  for (const [k, v] of hdr) if (v) bl.add('email-header', `${k}: ${v}`, { part: 'header' });

  let body = m.text ?? '';
  if (!body.trim() && m.html) {
    body = htmlToText(m.html);
    messages.push({ level: 'info', text: 'E-postada düz metin gövde yok; HTML gövde metne dönüştürüldü.' });
  }
  for (const p of quotedParagraphs(body)) bl.add(p.quoted ? 'quoted' : 'paragraph', p.text, { part: p.quoted ? 'quoted' : 'body' });

  const extra = [];
  let ai = 0;
  for (const a of m.attachments) {
    ai++;
    bl.add('attachment', `Ek: ${a.name} (${a.mime || 'bilinmeyen tür'}, ${a.size} bayt)`, { part: a.name });
    if (!a.data || parserFor(a.name) === 'unsupported') continue;
    const sub = await ctx.extract(a.name, a.data, ctx.depth + 1);
    for (const b of sub.blocks) extra.push({ ...b, id: `a${ai}-${b.id}`, loc: { ...b.loc, part: a.name } });
    if (sub.status === 'ok') messages.push({ level: 'info', text: `Ek "${a.name}" ayrıştırıldı (${sub.blocks.length} blok).` });
    else {
      const why = sub.messages.find((x) => x.level !== 'info')?.text ?? sub.status;
      messages.push({ level: 'warning', text: `Ek "${a.name}" tam ayrıştırılamadı (${sub.status}): ${why}` });
    }
  }

  const email: EmailInfo = {
    from: m.from,
    to: m.to,
    cc: m.cc,
    subject: m.subject,
    date,
    attachments: m.attachments.map((a) => ({ name: a.name, size: a.size, mime: a.mime })),
  };
  return result([...bl.blocks, ...extra], { email, messages, meta: { ...(m.meta ?? {}), ...(m.subject ? { title: m.subject } : {}) } });
}
