// CadInfo → okunabilir DocBlock'lar (Geometri / Montaj / Malzeme / PMI bölümleri).
// Ölçü blokları gereksinim adayına dönüşür: geometri = nominal (tolerans yok), PMI = modeldeki tolerans.
import type { CadBBox, CadInfo, DocBlock } from '../../../shared/docmodel';
import type { BlockList } from '../util';
import { fmt } from './geom';

export const NO_TOL = 'tolerans modelde yok – resimden doğrulanmalı';

const FACE_LABEL: Record<string, string> = {
  PLANE: 'düzlem', CYLINDRICAL_SURFACE: 'silindir', CONICAL_SURFACE: 'koni', SPHERICAL_SURFACE: 'küre', TOROIDAL_SURFACE: 'torus',
  B_SPLINE_SURFACE: 'B-spline', SURFACE_OF_REVOLUTION: 'dönel yüzey', SURFACE_OF_LINEAR_EXTRUSION: 'ekstrüzyon yüzeyi',
  OFFSET_SURFACE: 'ofset yüzey', TABULATED_CYLINDER: 'tablolu silindir', RULED_SURFACE: 'regle yüzey',
};
const AXES = ['X', 'Y', 'Z'];

const SOURCE_NOTE: Record<CadBBox['source'], string> = {
  brep: 'B-rep köşe noktalarından',
  vertices: 'köşe (VERTEX_POINT) noktalarından',
  tessellation: 'üçgen ağ (tessellation) noktalarından',
  'all-points': 'tüm noktalardan – güvenilir değil',
  'iges-geometry': 'IGES geometri varlıklarından',
};

function tag(b: DocBlock | undefined, src: DocBlock['cadSource']) {
  if (b) b.cadSource = src;
}

/** Değeri mm ve (farklıysa) dosya biriminde yazar. */
function both(mm: number, fileVal: number, unit: string | undefined): string {
  return unit && unit !== 'mm' ? `${fmt(mm)} mm (${fmt(fileVal, unit)} ${unit})` : `${fmt(mm)} mm`;
}

export function cadBlocks(bl: BlockList, cad: CadInfo, opts: { reliable: boolean; partLimit?: number }) {
  const G = { section: 'Geometri' };
  const u = cad.units;
  const scale = cad.unitScaleToMm ?? 1;
  tag(bl.add('note', `Birim: ${u ?? 'bilinmiyor (mm kabul edildi)'}${u && u !== 'mm' ? ` (1 ${u} = ${+scale.toPrecision(10)} mm)` : ''}`, G), 'geometry');

  const fc = cad.faces ?? {};
  const totalFaces = Object.values(fc).reduce((a, b) => a + b, 0);
  const summary: string[] = [];
  if (cad.solids != null) summary.push(`${cad.solids} katı`);
  if (cad.shells) summary.push(`${cad.shells} kabuk`);
  if (totalFaces)
    summary.push(
      `${totalFaces} yüz (${Object.entries(fc)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${FACE_LABEL[k] ?? k}: ${v}`)
        .join(', ')})`,
    );
  if (summary.length) tag(bl.add('note', `Geometri özeti: ${summary.join(', ')}`, G), 'geometry');

  const b = cad.bbox;
  if (b) {
    const dims = b.sizeMm.map((v) => fmt(v)).join(' × ');
    const fileDims = u && u !== 'mm' ? ` (${b.size.map((v) => fmt(v, u)).join(' × ')} ${u})` : '';
    tag(
      bl.add(
        'note',
        `Genel boyutlar: ${dims} mm${fileDims} (X × Y × Z sınırlayıcı kutu, ${SOURCE_NOTE[b.source]}; nominal geometri, tolerans içermez)`,
        G,
      ),
      'geometry',
    );
    tag(
      bl.add('note', `Sınırlayıcı kutu köşeleri (${u ?? 'birim'}): (${b.min.map((v) => fmt(v, u)).join('; ')}) / (${b.max.map((v) => fmt(v, u)).join('; ')})`, G),
      'geometry',
    );
    if (opts.reliable)
      b.sizeMm.forEach((mm, i) => {
        if (mm <= 1e-9) return;
        tag(
          bl.add('dimension', `Genel boyut ${AXES[i]}: ${both(mm, b.size[i], u)} – sınırlayıcı kutu, nominal model geometrisi; ${NO_TOL}`, G),
          'geometry',
        );
      });
    const flat = b.sizeMm.filter((v) => v <= 1e-9).length;
    if (flat) tag(bl.add('note', `Geometri ${flat === 1 ? 'tek bir düzlemde (2B)' : 'dejenere'}: ${AXES.filter((_, i) => b.sizeMm[i] <= 1e-9).join(', ')} yönünde boyut sıfır.`, G), 'geometry');
  }

  // Parça boyutları (montajda)
  const parts = (cad.parts ?? []).filter((p) => p.bbox);
  if (parts.length > 1 || (parts.length === 1 && !b)) {
    const lim = opts.partLimit ?? 30;
    for (const p of parts.slice(0, lim)) {
      const pb = p.bbox!;
      const label = p.name && p.name !== p.id ? `${p.id} (${p.name})` : p.id;
      tag(
        bl.add(
          'note',
          `Parça ${label} genel boyutları: ${pb.sizeMm.map((v) => fmt(v)).join(' × ')} mm (X × Y × Z, parçanın kendi koordinatlarında sınırlayıcı kutu) – nominal model geometrisi; ${NO_TOL}`,
          { ...G, part: p.id },
        ),
        'geometry',
      );
    }
    if (parts.length > lim) tag(bl.add('note', `… ${parts.length - lim} parçanın boyutu daha listelenmedi.`, G), 'geometry');
  }

  for (const h of cad.holes ?? []) {
    const what =
      h.kind === 'hole'
        ? 'Delik (iç silindirik yüzey)'
        : h.kind === 'boss'
          ? 'Silindirik çıkıntı / pim (dış silindirik yüzey)'
          : 'Silindirik özellik';
    const pre = h.part ? `[${h.part}] ` : '';
    const extra = h.kind === 'hole' ? ' (geçiş / kör ayrımı yapılmadı)' : '';
    tag(
      bl.add(
        'dimension',
        `${pre}${what}: Ø${both(h.diameterMm, h.diameter, u)} × ${h.count} adet${extra}, ${h.faces} yüz – nominal model geometrisi; ${NO_TOL}`,
        { ...G, ...(h.part ? { part: h.part } : {}) },
      ),
      'geometry',
    );
  }
  const circ = cad.circles ?? [];
  if (circ.length) {
    const top = circ.slice(0, 20).map((c) => `Ø${fmt(c.diameterMm)} mm × ${c.count}${c.full && c.arcs ? ` (${c.full} tam, ${c.arcs} yay)` : c.full ? ' (tam daire)' : ' (yay)'}`);
    tag(bl.add('note', `Dairesel kenarlar: ${top.join(', ')}${circ.length > 20 ? ` … (+${circ.length - 20} çap)` : ''}`, G), 'geometry');
  }
  for (const t of cad.thickness ?? []) {
    const pre = t.part ? `[${t.part}] ` : '';
    tag(
      bl.add(
        'dimension',
        `${pre}Kalınlık adayı (sezgisel): ${both(t.valueMm, t.value, u)} – zıt yönlü iki geniş paralel düzlem arası mesafe, nominal model geometrisi; ${NO_TOL}`,
        { ...G, ...(t.part ? { part: t.part } : {}) },
      ),
      'heuristic',
    );
  }

  // Montaj
  const M = { section: 'Montaj' };
  const links = cad.assembly ?? [];
  if (links.length) {
    const children = new Set(links.map((l) => l.child));
    const roots = [...new Set(links.map((l) => l.parent))].filter((p) => !children.has(p));
    tag(bl.add('note', `Montaj yapısı: ${roots.length ? roots.join(', ') : links[0].parent} kök; ${links.length} ebeveyn–çocuk ilişkisi`, M), 'geometry');
    for (const l of links.slice(0, 200)) tag(bl.add('note', `Montaj: ${l.parent} → ${l.child} × ${+l.quantity.toPrecision(6)} adet`, M), 'geometry');
    if (links.length > 200) tag(bl.add('note', `… ${links.length - 200} montaj ilişkisi daha listelenmedi.`, M), 'geometry');
  }

  // Malzeme
  for (const m of cad.materials ?? [])
    tag(
      bl.add('note', `Malzeme${m.part ? ` (${m.part})` : ''}: ${m.name}${m.density ? `; yoğunluk ${m.density} (birim modelde)` : ''} – kaynak ${m.source}`, { section: 'Malzeme' }),
      'geometry',
    );

  // PMI
  for (const p of cad.pmi ?? []) {
    if (p.kind === 'DATUM') tag(bl.add('note', p.text, { section: 'PMI' }), 'pmi');
    else tag(bl.add('dimension', p.text, { section: 'PMI' }), 'pmi');
  }
}
