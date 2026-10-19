// IGES (sabit 80 sütun): S/G bölümleri, D bölümü varlık sayıları, 212 genel not ve ölçü yazıları. Geometri yorumlanmaz.
import { CAD_PARTIAL_MSG, type CadInfo } from '../../shared/docmodel';
import { BlockList, result, type Parser } from './util';

export const IGES_ENTITY: Record<number, string> = {
  100: 'Circular Arc', 102: 'Composite Curve', 104: 'Conic Arc', 106: 'Copious Data', 108: 'Plane', 110: 'Line',
  112: 'Parametric Spline Curve', 114: 'Parametric Spline Surface', 116: 'Point', 118: 'Ruled Surface', 120: 'Surface of Revolution',
  122: 'Tabulated Cylinder', 124: 'Transformation Matrix', 126: 'Rational B-Spline Curve', 128: 'Rational B-Spline Surface',
  130: 'Offset Curve', 140: 'Offset Surface', 141: 'Boundary', 142: 'Curve on Parametric Surface', 143: 'Bounded Surface',
  144: 'Trimmed Surface', 186: 'Manifold Solid B-Rep Object', 202: 'Angular Dimension', 206: 'Diameter Dimension',
  210: 'General Label', 212: 'General Note', 214: 'Leader (Arrow)', 216: 'Linear Dimension', 218: 'Ordinate Dimension',
  220: 'Point Dimension', 222: 'Radius Dimension', 230: 'Sectioned Area', 304: 'Line Font Definition', 308: 'Subfigure Definition',
  314: 'Color Definition', 402: 'Associativity Instance', 404: 'Drawing', 406: 'Property', 408: 'Singular Subfigure Instance',
  410: 'View', 502: 'Vertex', 504: 'Edge', 508: 'Loop', 510: 'Face', 514: 'Shell',
};

const UNIT_FLAG: Record<number, string> = { 1: 'in', 2: 'mm', 4: 'ft', 5: 'mi', 6: 'm', 7: 'km', 8: 'mil', 9: 'µm', 10: 'cm', 11: 'µin' };
const DIM_TYPES = new Set([202, 206, 216, 218, 220, 222]);

/** Hollerith (nH...) dizelerini çözen parametre ayrıştırıcı; kayıt ayracında durur. */
export function igesParams(s: string, pd = ',', rd = ';'): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < s.length) {
    while (s[i] === ' ') i++;
    const h = /^(\d+)H/.exec(s.slice(i, i + 12));
    let val = '';
    if (h) {
      const n = Number(h[1]);
      val = s.substr(i + h[0].length, n);
      i += h[0].length + n;
      while (i < s.length && s[i] !== pd && s[i] !== rd) i++;
    } else {
      while (i < s.length && s[i] !== pd && s[i] !== rd) val += s[i++];
      val = val.trim();
    }
    out.push(val);
    if (i >= s.length || s[i] === rd) break;
    i++;
  }
  return out;
}

export const parseIges: Parser = async (_name, data) => {
  const lines = data.toString('latin1').split(/\r?\n/).filter((l) => l.length >= 73);
  const sec = (c: string) => lines.filter((l) => l[72] === c);
  if (lines.some((l) => l[72] === 'C')) throw new Error('Sıkıştırılmış IGES biçimi desteklenmiyor.');
  const D = sec('D');
  if (!sec('G').length || !D.length) throw new Error('Geçerli bir IGES dosyası değil (G / D bölümü yok).');

  const startText = sec('S').map((l) => l.slice(0, 72).trimEnd()).join('\n').trim();
  let g = sec('G').map((l) => l.slice(0, 72)).join('');
  let pd = ',', rd = ';';
  // İlk iki parametre ayraçları tanımlar (boşsa varsayılan , ;)
  let pos = 0;
  if (g.startsWith('1H')) [pd, pos] = [g[2], 3];
  pos++; // parametre ayracı
  if (g.slice(pos, pos + 2) === '1H') rd = g[pos + 2];
  g = g.trimEnd();
  const G = igesParams(g, pd, rd);
  const gp = (n: number) => (G[n - 1] ?? '').trim();

  // D bölümü: her varlık 2 satır; tür no sütun 1-8, katman (level) sütun 33-40
  const counts: Record<string, number> = {};
  const ents = new Map<number, { type: number; level: number }>();
  for (let i = 0; i + 1 < D.length; i += 2) {
    const type = Number(D[i].slice(0, 8));
    const de = Number(D[i].slice(73, 80));
    if (!Number.isFinite(type)) continue;
    const key = IGES_ENTITY[type] ? `${type} ${IGES_ENTITY[type]}` : String(type);
    counts[key] = (counts[key] ?? 0) + 1;
    ents.set(de, { type, level: Number(D[i].slice(32, 40)) || 0 });
  }

  // P bölümü: sütun 66-72 DE işaretçisi
  const pdata = new Map<number, string>();
  for (const l of sec('P')) {
    const de = Number(l.slice(64, 72));
    pdata.set(de, (pdata.get(de) ?? '') + l.slice(0, 64));
  }
  const noteText = (de: number): string => {
    const p = igesParams(pdata.get(de) ?? '', pd, rd);
    if (Number(p[0]) !== 212) return '';
    const ns = Number(p[1]) || 0;
    const parts: string[] = [];
    for (let i = 0; i < ns; i++) {
      const t = p[2 + 12 * i + 11];
      if (t) parts.push(t.trim());
    }
    return parts.join(' ');
  };

  const bl = new BlockList();
  if (startText) bl.add('note', startText, { part: 'start' });
  const used = new Set<number>();
  const layerOf = (e: { level: number }) => (e.level ? `level ${e.level}` : undefined);
  for (const [de, e] of ents) {
    if (!DIM_TYPES.has(e.type)) continue;
    const p = igesParams(pdata.get(de) ?? '', pd, rd);
    const noteDe = Number(p[1]);
    const t = noteDe ? noteText(noteDe) : '';
    if (t) {
      used.add(noteDe);
      bl.add('dimension', t, { layer: layerOf(e), part: IGES_ENTITY[e.type] });
    }
  }
  for (const [de, e] of ents) {
    if (e.type !== 212 || used.has(de)) continue;
    bl.add('note', noteText(de), { layer: layerOf(e), part: 'general note' });
  }

  const unitFlag = Number(gp(14));
  const units = UNIT_FLAG[unitFlag] ?? (gp(15) || undefined);
  const header: Record<string, string> = {};
  const gmap: [number, string][] = [[3, 'productId'], [4, 'fileName'], [5, 'nativeSystem'], [6, 'preprocessorVersion'], [15, 'unitsName'], [18, 'date'], [21, 'author'], [22, 'organization'], [23, 'igesVersion'], [24, 'draftingStandard']];
  for (const [n, k] of gmap) if (gp(n)) header[k] = gp(n);
  if (gp(14)) header.unitsFlag = gp(14);

  const cad: CadInfo = { format: 'IGES', units, entityCounts: counts, header };
  const meta: Record<string, string> = {};
  if (header.fileName) meta.title = header.fileName;
  if (header.author) meta.author = header.author;
  if (header.organization) meta.organization = header.organization;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(', ');
  return result(bl.blocks, {
    status: 'partial',
    cad,
    meta,
    messages: [
      { level: 'warning', text: CAD_PARTIAL_MSG },
      { level: 'info', text: `IGES varlık sayısı: ${total}${top ? ` (${top})` : ''}.` },
    ],
  });
};
