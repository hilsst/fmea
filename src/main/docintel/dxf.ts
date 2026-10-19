// DXF (ASCII): dxf-parser. Yalnızca metin, ölçü yazıları, katmanlar ve varlık sayıları; geometri yorumlanmaz.
import DxfParserMod from 'dxf-parser';
import { CAD_PARTIAL_MSG, type CadInfo } from '../../shared/docmodel';
import { BlockList, decodeText, interop, result, titleBlockMeta, type Parser } from './util';

type Ent = { type: string; layer?: string; text?: string; actualMeasurement?: number; dimensionType?: number; tag?: string };
type Dxf = { header?: Record<string, unknown>; entities?: Ent[]; blocks?: Record<string, { name?: string; entities?: Ent[] }>; tables?: { layer?: { layers?: Record<string, unknown> } } };

const INSUNITS: Record<number, string> = {
  0: 'unitless', 1: 'in', 2: 'ft', 3: 'mi', 4: 'mm', 5: 'cm', 6: 'm', 7: 'km', 8: 'µin', 9: 'mil', 10: 'yd', 11: 'Å', 12: 'nm', 13: 'µm', 14: 'dm',
};

/** %%c, %%d, %%p özel kodları ve \U+XXXX kaçışları. */
export function dxfSpecial(s: string): string {
  return s
    .replace(/\\U\+([0-9a-f]{4})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)))
    .replace(/%%[cC]/g, 'Ø')
    .replace(/%%[dD]/g, '°')
    .replace(/%%[pP]/g, '±')
    .replace(/%%[uUoOkK]/g, '')
    .replace(/%%(\d{3})/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/%%%/g, '%');
}

/** MTEXT biçim kodlarını temizler (\P, {\f...;}, \A1;, \S1^2; ...). */
export function stripMtext(s: string): string {
  return dxfSpecial(
    s
      .replace(/\\\\/g, '\u0001')
      .replace(/\\[Pp]/g, '\n')
      .replace(/\\~/g, ' ')
      .replace(/\\S([^;]*?)[\^#/]([^;]*?);/g, '$1/$2')
      .replace(/\\[fFHhWwQqTtAaCcp][^;]*;/g, '')
      .replace(/\\[LlOoKkNn]/g, '')
      .replace(/\\([{}])/g, '\u0002$1')
      .replace(/[{}]/g, '')
      .replace(/\u0002/g, '')
      .replace(/\u0001/g, '\\'),
  );
}

const fmtNum = (n: number) => String(Number(n.toFixed(4)));

function dimText(e: Ent): string {
  const meas = typeof e.actualMeasurement === 'number' && Number.isFinite(e.actualMeasurement) ? e.actualMeasurement : undefined;
  const t = (e.dimensionType ?? 0) & 7;
  const prefix = t === 3 ? 'Ø' : t === 4 ? 'R' : '';
  const suffix = t === 2 || t === 5 ? '°' : '';
  const measured = meas != null ? `${prefix}${fmtNum(meas)}${suffix}` : '';
  const raw = (e.text ?? '').trim();
  if (!raw) return measured;
  if (raw === ' ') return ''; // bastırılmış yazı
  return stripMtext(raw.replace(/<>/g, measured)).trim();
}

export const parseDxf: Parser = async (_name, data) => {
  const head = data.subarray(0, 22).toString('latin1');
  if (head.startsWith('AutoCAD Binary DXF')) throw new Error('İkili (binary) DXF desteklenmiyor; ASCII DXF olarak kaydedin.');
  const DxfParser = interop<new () => { parseSync(s: string): Dxf | null }>(DxfParserMod);
  const dxf = new DxfParser().parseSync(decodeText(data));
  if (!dxf) throw new Error('DXF okunamadı.');
  const bl = new BlockList();
  const counts: Record<string, number> = {};
  const layers = new Set<string>(Object.keys(dxf.tables?.layer?.layers ?? {}));
  let dimNoText = 0;

  const visit = (ents: Ent[], part?: string) => {
    for (const e of ents) {
      if (!part) counts[e.type] = (counts[e.type] ?? 0) + 1;
      if (e.layer) layers.add(e.layer);
      const loc = { layer: e.layer, part };
      if (e.type === 'TEXT') bl.add('text', dxfSpecial(e.text ?? ''), loc);
      else if (e.type === 'MTEXT') bl.add('text', stripMtext(e.text ?? ''), loc);
      else if (e.type === 'ATTDEF' && e.text) bl.add('text', `${e.tag ? e.tag + ': ' : ''}${dxfSpecial(e.text)}`, loc);
      else if (e.type === 'DIMENSION') {
        const t = dimText(e);
        if (t) bl.add('dimension', t, loc);
        else dimNoText++;
      }
    }
  };
  visit(dxf.entities ?? []);
  // Blok tanımlarındaki yazılar (antet vb.); ölçü (*D) ve model/kağıt alanı blokları hariç
  for (const [name, b] of Object.entries(dxf.blocks ?? {})) {
    if (/^\*(D|Model_Space|Paper_Space)/i.test(name)) continue;
    visit((b.entities ?? []).filter((e) => e.type === 'TEXT' || e.type === 'MTEXT' || e.type === 'ATTDEF'), `block ${name}`);
  }

  const u = dxf.header?.['$INSUNITS'];
  const cad: CadInfo = {
    format: 'DXF',
    units: typeof u === 'number' ? (INSUNITS[u] ?? String(u)) : undefined,
    layers: [...layers].sort(),
    entityCounts: counts,
  };
  const acad = dxf.header?.['$ACADVER'];
  const meta: Record<string, string> = { ...titleBlockMeta(bl.blocks.map((b) => b.text).join('\n')) };
  if (typeof acad === 'string') meta.acadVersion = acad;
  const countText = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}: ${v}`).join(', ');
  const messages = [
    { level: 'warning' as const, text: CAD_PARTIAL_MSG },
    { level: 'info' as const, text: `DXF varlık sayıları – ${countText || 'yok'}; ${layers.size} katman.` },
  ];
  if (dimNoText) messages.push({ level: 'warning' as const, text: `${dimNoText} ölçü varlığında yazı / ölçülen değer bulunamadı; elle kontrol edin (MANUAL VERIFICATION REQUIRED).` });
  return result(bl.blocks, { status: 'partial', cad, meta, messages });
};
