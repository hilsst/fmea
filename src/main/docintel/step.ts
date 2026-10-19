// STEP (ISO 10303-21): HEADER alanları, DATA varlık sayıları, PRODUCT adları. Geometri / PMI yorumlanmaz.
import { CAD_PARTIAL_MSG, type CadInfo } from '../../shared/docmodel';
import { BlockList, result, type Parser } from './util';

type Arg = string | Arg[];

/** STEP dize kaçışları: '' , \X2\..\X0\, \X\hh, \S\c */
export function stepString(s: string): string {
  return s
    .replace(/''/g, "'")
    .replace(/\\X2\\([0-9A-F]+)\\X0\\/gi, (_, h: string) => (h.match(/.{4}/g) ?? []).map((x) => String.fromCharCode(parseInt(x, 16))).join(''))
    .replace(/\\X4\\([0-9A-F]+)\\X0\\/gi, (_, h: string) => (h.match(/.{8}/g) ?? []).map((x) => String.fromCodePoint(parseInt(x, 16))).join(''))
    .replace(/\\X\\([0-9A-F]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\S\\(.)/g, (_, c: string) => String.fromCharCode(c.charCodeAt(0) + 128))
    .replace(/\\\\/g, '\\');
}

/** pos konumundaki '(' ile başlayan parametre listesini ayrıştırır. Dizeler çözülmüş, diğer atomlar ham döner. */
export function parseArgsAt(text: string, pos: number): [Arg[], number] {
  const stack: Arg[][] = [];
  let cur: Arg[] = [];
  let atom = '';
  const pushAtom = () => {
    if (atom.trim()) cur.push(atom.trim());
    atom = '';
  };
  for (let i = pos; i < text.length; i++) {
    const ch = text[i];
    if (ch === "'") {
      let j = i + 1, s = '';
      for (; j < text.length; j++) {
        if (text[j] === "'") {
          if (text[j + 1] === "'") { s += "''"; j++; continue; }
          break;
        }
        s += text[j];
      }
      cur.push(stepString(s));
      i = j;
    } else if (ch === '(') {
      pushAtom();
      stack.push(cur);
      cur = [];
    } else if (ch === ')') {
      pushAtom();
      const done = cur;
      cur = stack.pop() ?? [];
      cur.push(done);
      if (!stack.length) return [done, i + 1];
    } else if (ch === ',') pushAtom();
    else atom += ch;
  }
  return [cur, text.length];
}

const flatStr = (a: Arg | undefined): string =>
  a == null ? '' : Array.isArray(a) ? a.map(flatStr).filter((s) => s && s !== '$').join('; ') : a === '$' ? '' : a;

function headerCall(header: string, name: string): Arg[] | undefined {
  const m = new RegExp(`\\b${name}\\s*\\(`).exec(header);
  if (!m) return undefined;
  return parseArgsAt(header, m.index + m[0].length - 1)[0];
}

export const parseStep: Parser = async (_name, data) => {
  const raw = data.toString('latin1');
  if (!/ISO-10303-21\s*;/.test(raw.slice(0, 2000))) throw new Error('Geçerli bir STEP (ISO-10303-21) dosyası değil.');
  const text = raw.replace(/\/\*[\s\S]*?\*\//g, '');
  const hs = /\bHEADER\s*;([\s\S]*?)\bENDSEC\s*;/.exec(text);
  const headerTxt = hs?.[1] ?? '';
  const header: Record<string, string> = {};
  const fd = headerCall(headerTxt, 'FILE_DESCRIPTION');
  if (fd) {
    header.FILE_DESCRIPTION = flatStr(fd[0]);
    header.implementationLevel = flatStr(fd[1]);
  }
  const fn = headerCall(headerTxt, 'FILE_NAME');
  if (fn) {
    const keys = ['FILE_NAME', 'timeStamp', 'author', 'organization', 'preprocessorVersion', 'originatingSystem', 'authorization'];
    keys.forEach((k, i) => (header[k] = flatStr(fn[i])));
  }
  const fs = headerCall(headerTxt, 'FILE_SCHEMA');
  if (fs) header.FILE_SCHEMA = flatStr(fs);
  for (const k of Object.keys(header)) if (!header[k]) delete header[k];

  const ds = /\bDATA\s*;([\s\S]*?)\bENDSEC\s*;/.exec(text.slice(hs ? hs.index + hs[0].length : 0));
  const dataTxt = ds?.[1] ?? '';
  const counts: Record<string, number> = {};
  for (const m of dataTxt.matchAll(/#\d+\s*=\s*(?:([A-Z][A-Z0-9_]*)\s*\(|(\())/gi)) {
    const k = m[1] ? m[1].toUpperCase() : 'COMPLEX_ENTITY';
    counts[k] = (counts[k] ?? 0) + 1;
  }

  const bl = new BlockList();
  const label: [string, string][] = [
    ['FILE_NAME', 'Dosya adı'], ['FILE_DESCRIPTION', 'Açıklama'], ['FILE_SCHEMA', 'Şema'], ['author', 'Yazar'],
    ['organization', 'Kuruluş'], ['originatingSystem', 'Kaynak sistem'], ['timeStamp', 'Tarih'],
  ];
  for (const [k, l] of label) if (header[k]) bl.add('note', `${l}: ${header[k]}`, { part: 'header' });
  for (const m of dataTxt.matchAll(/#(\d+)\s*=\s*PRODUCT\s*\(/gi)) {
    const [args] = parseArgsAt(dataTxt, m.index! + m[0].length - 1);
    const [id, name, desc] = [flatStr(args[0]), flatStr(args[1]), flatStr(args[2])];
    const parts = [id, name && name !== id ? name : '', desc && desc !== name ? desc : ''].filter(Boolean);
    if (parts.length) bl.add('entity', `PRODUCT: ${parts.join(' – ')}`, { part: `#${m[1]}` });
  }

  const u = /SI_UNIT\s*\(\s*(\.[A-Z]+\.|\$)\s*,\s*\.METRE\.\s*\)|CONVERSION_BASED_UNIT\s*\(\s*'(INCH|FOOT|IN|FT)'/i.exec(dataTxt);
  const units = u
    ? u[2]
      ? /^in/i.test(u[2]) ? 'in' : 'ft'
      : ({ '.MILLI.': 'mm', '.CENTI.': 'cm', '.MICRO.': 'µm', '.KILO.': 'km', '.DECI.': 'dm', $: 'm' } as Record<string, string>)[u[1].toUpperCase()] ?? u[1]
    : undefined;

  const cad: CadInfo = { format: 'STEP', units, entityCounts: counts, header };
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${k}: ${v}`).join(', ');
  const messages = [
    { level: 'warning' as const, text: CAD_PARTIAL_MSG },
    { level: 'info' as const, text: `STEP varlık sayısı: ${total}${top ? ` (${top})` : ''}.` },
  ];
  const pmi = Object.entries(counts).filter(([k]) => /TOLERANCE|DATUM|DIMENSIONAL_(SIZE|LOCATION)|ANNOTATION|DRAUGHTING_CALLOUT/.test(k)).reduce((a, [, v]) => a + v, 0);
  if (pmi) messages.push({ level: 'warning' as const, text: `${pmi} PMI / GD&T varlığı mevcut ancak otomatik yorumlanmadı (MANUAL VERIFICATION REQUIRED).` });
  const meta: Record<string, string> = {};
  if (header.FILE_NAME) meta.title = header.FILE_NAME;
  if (header.author) meta.author = header.author;
  return result(bl.blocks, { status: 'partial', cad, meta, messages });
};
