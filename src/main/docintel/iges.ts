// IGES (sabit 80 sütun): S/G bölümleri, D bölümü varlık sayıları, 212 genel not ve ölçü yazıları ve geometri
// analizi (124 dönüşümleri uygulanmış sınırlayıcı kutu, daire / silindir çap grupları, yüz türleri, katılar).
// Geometri değerleri nominal model geometrisidir; tolerans içermez.
import { CAD_NOMINAL_MSG, CAD_PARTIAL_MSG, type CadInfo, type ExtractMessage } from '../../shared/docmodel';
import { BlockList, errMsg, result, type Parser } from './util';
import { analyzeIges, type IgesEnt, type IgesGeometry } from './cad/iges-analyze';
import { cadBlocks } from './cad/report';

export const IGES_ENTITY: Record<number, string> = {
  100: 'Circular Arc', 102: 'Composite Curve', 104: 'Conic Arc', 106: 'Copious Data', 108: 'Plane', 110: 'Line',
  112: 'Parametric Spline Curve', 114: 'Parametric Spline Surface', 116: 'Point', 118: 'Ruled Surface', 120: 'Surface of Revolution',
  122: 'Tabulated Cylinder', 124: 'Transformation Matrix', 126: 'Rational B-Spline Curve', 128: 'Rational B-Spline Surface',
  123: 'Direction', 130: 'Offset Curve', 140: 'Offset Surface', 141: 'Boundary', 142: 'Curve on Parametric Surface', 143: 'Bounded Surface',
  144: 'Trimmed Surface', 190: 'Plane Surface', 192: 'Right Circular Cylindrical Surface', 194: 'Right Circular Conical Surface',
  196: 'Spherical Surface', 198: 'Toroidal Surface', 186: 'Manifold Solid B-Rep Object', 202: 'Angular Dimension', 206: 'Diameter Dimension',
  210: 'General Label', 212: 'General Note', 214: 'Leader (Arrow)', 216: 'Linear Dimension', 218: 'Ordinate Dimension',
  220: 'Point Dimension', 222: 'Radius Dimension', 230: 'Sectioned Area', 304: 'Line Font Definition', 308: 'Subfigure Definition',
  314: 'Color Definition', 402: 'Associativity Instance', 404: 'Drawing', 406: 'Property', 408: 'Singular Subfigure Instance',
  410: 'View', 502: 'Vertex', 504: 'Edge', 508: 'Loop', 510: 'Face', 514: 'Shell',
};

const UNIT_FLAG: Record<number, string> = { 1: 'in', 2: 'mm', 4: 'ft', 5: 'mi', 6: 'm', 7: 'km', 8: 'mil', 9: 'µm', 10: 'cm', 11: 'µin' };
const UNIT_MM: Record<string, number> = { in: 25.4, mm: 1, ft: 304.8, mi: 1609344, m: 1000, km: 1e6, mil: 0.0254, 'µm': 0.001, cm: 10, 'µin': 2.54e-5 };
const UNIT_NAME: Record<string, string> = { IN: 'in', INCH: 'in', MM: 'mm', FT: 'ft', MI: 'mi', M: 'm', KM: 'km', MIL: 'mil', UM: 'µm', MICRON: 'µm', CM: 'cm', UIN: 'µin' };
const fnum = (s: string | undefined) => (s == null || s.trim() === '' ? NaN : Number(s.trim().replace(/[dD]/, 'E')));
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
  const ents = new Map<number, IgesEnt>();
  const fld = (l: string, k: number) => Number(l.slice(8 * k, 8 * k + 8).trim() || '0');
  for (let i = 0; i + 1 < D.length; i += 2) {
    const type = Number(D[i].slice(0, 8));
    const de = Number(D[i].slice(73, 80));
    if (!Number.isFinite(type) || !type) continue;
    const key = IGES_ENTITY[type] ? `${type} ${IGES_ENTITY[type]}` : String(type);
    counts[key] = (counts[key] ?? 0) + 1;
    const st = D[i].slice(64, 72).replace(/ /g, '0').padStart(8, '0');
    ents.set(de, {
      de, type, form: fld(D[i + 1], 4) || 0, level: fld(D[i], 4) || 0, xform: Math.max(0, fld(D[i], 6) || 0),
      blank: Number(st.slice(0, 2)) || 0, sub: Number(st.slice(2, 4)) || 0, use: Number(st.slice(4, 6)) || 0,
    });
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
  const unitName = UNIT_NAME[gp(15).toUpperCase().replace(/[^A-Z]/g, '')];
  const units = UNIT_FLAG[unitFlag] ?? unitName ?? (gp(15) || undefined);
  const scaleKnown = units != null && UNIT_MM[units] != null;
  const unitScaleToMm = scaleKnown ? UNIT_MM[units!] : 1;
  const header: Record<string, string> = {};
  const gmap: [number, string][] = [[3, 'productId'], [4, 'fileName'], [5, 'nativeSystem'], [6, 'preprocessorVersion'], [15, 'unitsName'], [18, 'date'], [21, 'author'], [22, 'organization'], [23, 'igesVersion'], [24, 'draftingStandard']];
  for (const [n, k] of gmap) if (gp(n)) header[k] = gp(n);
  if (gp(14)) header.unitsFlag = gp(14);
  const gextra: [number, string][] = [[13, 'modelSpaceScale'], [19, 'minResolution'], [20, 'maxCoordinate'], [25, 'modelDate'], [26, 'applicationProtocol']];
  for (const [n, k] of gextra) if (gp(n)) header[k] = gp(n);

  const warnings: string[] = [];
  if (!scaleKnown) warnings.push(`IGES birimi tanınamadı (bayrak ${gp(14) || '-'}, ad ${gp(15) || '-'}); değerler mm kabul edildi (doğrulanmalı).`);
  const mss = fnum(gp(13));
  if (Number.isFinite(mss) && mss > 0 && Math.abs(mss - 1) > 1e-9)
    warnings.push(`Model uzayı ölçeği ${gp(13)} (1 değil): koordinatlar ölçeklenmemiş model değerleridir; gerçek boyut = model / ${gp(13)} olabilir – doğrulanmalı.`);

  // Parametreleri sayıya çevir (önbellekli)
  const pcache = new Map<number, number[]>();
  const P = (de: number): number[] => {
    let v = pcache.get(de);
    if (!v) pcache.set(de, (v = igesParams(pdata.get(ents.get(de) ? de : -1) ?? '', pd, rd).map(fnum)));
    return v;
  };
  let geo: IgesGeometry | undefined;
  try {
    geo = analyzeIges(ents, P, unitScaleToMm);
    warnings.push(...geo.warnings);
  } catch (e) {
    warnings.push(`Geometri analizi tamamlanamadı: ${errMsg(e)}`);
  }

  const cad: CadInfo = { format: 'IGES', units, entityCounts: counts, header, unitScaleToMm };
  if (!cad.units) delete cad.units;
  const understood = !!geo && !geo.box.empty;
  if (geo) {
    const bb = geo.box.toBBox(unitScaleToMm, 'iges-geometry');
    if (bb) cad.bbox = bb;
    cad.solids = geo.solids;
    if (geo.shells) cad.shells = geo.shells;
    if (Object.keys(geo.faces).length) cad.faces = geo.faces;
    if (geo.cylinders.length) cad.holes = geo.cylinders;
    if (geo.circles.length) cad.circles = geo.circles;
  }
  if (warnings.length) cad.warnings = warnings;
  if (geo) cadBlocks(bl, cad, { reliable: understood });

  const meta: Record<string, string> = {};
  if (header.fileName) meta.title = header.fileName;
  if (header.author) meta.author = header.author;
  if (header.organization) meta.organization = header.organization;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(', ');
  const messages: ExtractMessage[] = [
    understood ? { level: 'warning', text: CAD_NOMINAL_MSG } : { level: 'warning', text: CAD_PARTIAL_MSG },
    { level: 'info', text: `IGES varlık sayısı: ${total}${top ? ` (${top})` : ''}.` },
  ];
  for (const w of warnings) messages.push({ level: 'warning', text: w });
  if (geo?.transformed) messages.push({ level: 'info', text: `${geo.transformed} varlığa 124 dönüşüm matrisi uygulandı (sınırlayıcı kutu dönüştürülmüş koordinatlarla).` });
  messages.push({
    level: 'info',
    text: 'Desteklenmeyen: hacim / kütle, delik / çıkıntı ayrımı (IGES yüzey yönü yorumlanmaz), alt şekil (408) yerleşimi, PMI / tolerans (yalnızca 212 not metinleri okunur).',
  });
  return result(bl.blocks, { status: understood ? 'ok' : 'partial', cad, meta, messages });
};
