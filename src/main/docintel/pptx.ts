// PPTX: slaytlar sunum sırasıyla; şekil metinleri, tablolar ve konuşmacı notları.
import JSZip from 'jszip';
import { posix } from 'node:path';
import { BlockList, attr, child, findAll, findFirst, kids, parseOrdered, result, tagOf, textOf, type Parser, type XNode } from './util';

function relsMap(xml: string | undefined): Map<string, { target: string; type: string }> {
  const m = new Map<string, { target: string; type: string }>();
  if (!xml) return m;
  for (const r of findAll(parseOrdered(xml), 'Relationship')) {
    const id = attr(r, 'Id');
    if (id) m.set(id, { target: attr(r, 'Target') ?? '', type: attr(r, 'Type') ?? '' });
  }
  return m;
}

const resolve = (base: string, target: string) => (target.startsWith('/') ? target.slice(1) : posix.normalize(posix.join(posix.dirname(base), target)));

/** a:p paragraflarının metni; satır sonları korunur. */
function paraText(nodes: XNode[]): string {
  return findAll(nodes, 'a:p')
    .map((p) => {
      const parts: string[] = [];
      const walk = (ns: XNode[]) => {
        for (const n of ns) {
          const t = tagOf(n);
          if (t === 'a:t') parts.push(kids(n).map(textOf).join(''));
          else if (t === 'a:br') parts.push('\n');
          else if (t !== 'a:rPr' && t !== 'a:pPr') walk(kids(n));
        }
      };
      walk(kids(p));
      return parts.join('');
    })
    .filter((s) => s.trim())
    .join('\n');
}

function phType(sp: XNode): string | undefined {
  const nv = child(sp, 'p:nvSpPr');
  const ph = nv && findFirst(kids(nv), 'p:ph');
  return ph ? (attr(ph, 'type') ?? 'body') : undefined;
}

/** Şekil ağacını gezer: p:sp → metin bloğu, a:tbl → satır blokları, p:grpSp → içine in. */
function walkShapes(nodes: XNode[], bl: BlockList, slide: number, part: string | undefined, notes: boolean) {
  for (const n of nodes) {
    const t = tagOf(n);
    if (t === 'p:sp') {
      const ph = phType(n);
      if (notes && (ph === 'sldImg' || ph === 'sldNum' || ph === 'hdr' || ph === 'ftr' || ph === 'dt')) continue;
      if (!notes && (ph === 'sldNum' || ph === 'dt')) continue;
      const tb = child(n, 'p:txBody');
      if (!tb) continue;
      const text = paraText(kids(tb));
      const kind = notes ? 'note' : ph === 'title' || ph === 'ctrTitle' ? 'heading' : ph === 'ftr' ? 'footer' : 'paragraph';
      bl.add(kind, text, { slide, part }, kind === 'heading' ? (ph === 'ctrTitle' ? 0 : 1) : undefined);
    } else if (t === 'p:graphicFrame') {
      const tbl = findFirst(kids(n), 'a:tbl');
      if (!tbl) continue;
      let r = 0;
      for (const tr of kids(tbl).filter((k) => tagOf(k) === 'a:tr')) {
        r++;
        const cells = kids(tr)
          .filter((k) => tagOf(k) === 'a:tc')
          .map((tc) => paraText(kids(tc)).replace(/\s+/g, ' ').trim());
        if (cells.some(Boolean)) bl.add('table-row', cells.join(' | '), { slide, part: part ?? 'table', cell: `R${r}` });
      }
    } else if (t === 'p:grpSp' || t === 'p:spTree' || t === 'mc:AlternateContent' || t === 'mc:Choice') {
      walkShapes(kids(n), bl, slide, part, notes);
    }
  }
}

export const parsePptx: Parser = async (_name, data) => {
  const zip = await JSZip.loadAsync(data);
  const presXml = await zip.file('ppt/presentation.xml')?.async('string');
  if (!presXml) throw new Error('ppt/presentation.xml bulunamadı (geçerli bir PPTX değil).');
  // Sunum sırası: sldIdLst → rels; yoksa dosya numarası
  const presRels = relsMap(await zip.file('ppt/_rels/presentation.xml.rels')?.async('string'));
  let slides = findAll(parseOrdered(presXml), 'p:sldId')
    .map((s) => presRels.get(attr(s, 'r:id') ?? '')?.target)
    .filter((t): t is string => !!t)
    .map((t) => resolve('ppt/presentation.xml', t))
    .filter((p) => zip.file(p));
  if (!slides.length)
    slides = Object.keys(zip.files)
      .filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))
      .sort((a, b) => Number(/(\d+)\.xml/.exec(a)![1]) - Number(/(\d+)\.xml/.exec(b)![1]));

  const bl = new BlockList();
  let noteCount = 0;
  for (let i = 0; i < slides.length; i++) {
    const path = slides[i];
    const slide = i + 1;
    const xml = await zip.file(path)!.async('string');
    const tree = findFirst(parseOrdered(xml), 'p:spTree');
    if (tree) walkShapes(kids(tree), bl, slide, undefined, false);
    const rels = relsMap(await zip.file(posix.join(posix.dirname(path), '_rels', posix.basename(path) + '.rels'))?.async('string'));
    for (const r of rels.values()) {
      if (!r.type.endsWith('/notesSlide')) continue;
      const np = resolve(path, r.target);
      const nx = await zip.file(np)?.async('string');
      const nt = nx && findFirst(parseOrdered(nx), 'p:spTree');
      if (nt) {
        const before = bl.blocks.length;
        walkShapes(kids(nt), bl, slide, 'notes', true);
        noteCount += bl.blocks.length - before;
      }
    }
  }
  const meta: Record<string, string> = { slides: String(slides.length) };
  if (noteCount) meta.noteBlocks = String(noteCount);
  return result(bl.blocks, { meta });
};
