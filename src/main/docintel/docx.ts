// DOCX: word/document.xml sıralı gezinme; başlık/bölüm takibi, tablolar, başlık/altbilgi, dipnotlar.
import JSZip from 'jszip';
import type { DocBlock, DocLoc } from '../../shared/docmodel';
import { BlockList, attr, child, findAll, kids, leadingNumber, parseOrdered, parsePlain, result, tagOf, textOf, type Parser, type XNode } from './util';

export const DOCX_PAGE_MSG = 'Sayfa numaraları DOCX içindeki sayfa sonlarına göre yaklaşıktır.';

interface StyleInfo {
  name: string;
  outline?: number;
  numbered: boolean;
  basedOn?: string;
}

interface ParaInfo {
  text: string;
  styleId?: string;
  numbered: boolean;
  outline?: number;
  page: number;
}

type PageMode = 'rendered' | 'explicit';

class DocxWalker {
  page = 1;
  section?: string;
  tableNo = 0;
  counters = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  constructor(
    private styles: Map<string, StyleInfo>,
    private mode: PageMode,
    private bl: BlockList,
    private trackPages: boolean,
  ) {}

  style(id?: string): StyleInfo | undefined {
    return id ? this.styles.get(id) : undefined;
  }

  /** Başlık düzeyi: stil adı (Heading N / Title), stil veya paragraf outlineLvl. */
  headingLevel(p: ParaInfo): number | undefined {
    let id = p.styleId;
    if (p.outline != null && p.outline < 9) return p.outline + 1;
    for (let guard = 0; id && guard < 10; guard++) {
      const s = this.styles.get(id);
      const nm = (s?.name ?? id).toLowerCase().replace(/\s+/g, ' ');
      const m = /^(?:heading|başlık) ?(\d)$/.exec(nm) ?? /^heading(\d)$/.exec(id.toLowerCase());
      if (m) return Number(m[1]);
      if (nm === 'title' || nm === 'konu başlığı') return 0;
      if (s?.outline != null && s.outline < 9) return s.outline + 1;
      id = s?.basedOn;
    }
    return undefined;
  }

  isCaption(p: ParaInfo): boolean {
    const s = this.style(p.styleId);
    return /^(caption|resim yazısı)$/i.test(s?.name ?? p.styleId ?? '');
  }

  isNumbered(p: ParaInfo): boolean {
    let id = p.styleId;
    if (p.numbered) return true;
    for (let guard = 0; id && guard < 10; guard++) {
      const s = this.styles.get(id);
      if (s?.numbered) return true;
      id = s?.basedOn;
    }
    return false;
  }

  /** Paragraf metnini toplar; sayfa sonlarını sayar. */
  readPara(p: XNode): ParaInfo {
    const info: ParaInfo = { text: '', numbered: false, page: this.page };
    let sawText = false;
    let sectBreak = false;
    const pPr = child(p, 'w:pPr');
    if (pPr) {
      info.styleId = attr(child(pPr, 'w:pStyle') ?? {}, 'w:val');
      const np = child(pPr, 'w:numPr');
      if (np && attr(child(np, 'w:numId') ?? {}, 'w:val') !== '0') info.numbered = true;
      const ol = child(pPr, 'w:outlineLvl');
      if (ol) info.outline = Number(attr(ol, 'w:val'));
      if (this.trackPages && this.mode === 'explicit' && child(pPr, 'w:pageBreakBefore') && attr(child(pPr, 'w:pageBreakBefore')!, 'w:val') !== '0') this.page++;
      const sp = child(pPr, 'w:sectPr');
      if (sp) sectBreak = attr(child(sp, 'w:type') ?? {}, 'w:val') !== 'continuous';
    }
    const parts: string[] = [];
    const walk = (nodes: XNode[]) => {
      for (const n of nodes) {
        const t = tagOf(n);
        switch (t) {
          case 'w:pPr':
          case 'w:rPr':
          case 'w:delText':
          case 'w:instrText':
          case 'w:del':
          case 'mc:Fallback':
          case 'w:footnoteReference':
          case 'w:endnoteReference':
            break;
          case 'w:t':
            for (const k of kids(n)) {
              const s = textOf(k);
              if (s) {
                if (!sawText) info.page = this.page;
                sawText = true;
                parts.push(s);
              }
            }
            break;
          case 'w:tab':
            parts.push('\t');
            break;
          case 'w:cr':
            parts.push('\n');
            break;
          case 'w:br':
            if (attr(n, 'w:type') === 'page') {
              if (this.trackPages && this.mode === 'explicit') this.page++;
            } else parts.push('\n');
            break;
          case 'w:lastRenderedPageBreak':
            if (this.trackPages && this.mode === 'rendered') this.page++;
            break;
          case 'w:p':
            parts.push('\n');
            walk(kids(n));
            break;
          default:
            walk(kids(n));
        }
      }
    };
    walk(kids(p));
    if (!sawText) info.page = this.page;
    if (sectBreak && this.trackPages && this.mode === 'explicit') this.page++;
    info.text = parts.join('').replace(/\t/g, ' ');
    return info;
  }

  loc(page: number, extra: DocLoc = {}): DocLoc {
    return this.trackPages ? { page, section: this.section, ...extra } : { section: this.section, ...extra };
  }

  para(p: XNode, kindOverride?: DocBlock['kind'], part?: string) {
    const info = this.readPara(p);
    if (!info.text.trim()) return;
    if (kindOverride) {
      this.bl.add(kindOverride, info.text, { part });
      return;
    }
    const level = this.headingLevel(info);
    if (level != null) {
      let num = leadingNumber(info.text);
      if (!num && level >= 1 && this.isNumbered(info)) num = this.nextNumber(level);
      else if (num) this.syncCounters(num);
      this.section = num ?? info.text.trim().slice(0, 80);
      this.bl.add('heading', info.text, this.loc(info.page), level);
    } else if (this.isCaption(info)) {
      this.bl.add('caption', info.text, this.loc(info.page, { part: 'caption' }));
    } else {
      this.bl.add('paragraph', info.text, this.loc(info.page));
    }
  }

  nextNumber(level: number): string {
    const i = Math.min(level, 9) - 1;
    this.counters[i]++;
    for (let j = i + 1; j < 9; j++) this.counters[j] = 0;
    return this.counters.slice(0, i + 1).map((c) => c || 1).join('.');
  }

  syncCounters(num: string) {
    const p = num.split('.').map(Number);
    for (let j = 0; j < 9; j++) this.counters[j] = p[j] ?? 0;
  }

  table(tbl: XNode, kindOverride?: DocBlock['kind'], part?: string) {
    const tNo = kindOverride ? 0 : ++this.tableNo;
    let r = 0;
    for (const tr of kids(tbl).filter((k) => tagOf(k) === 'w:tr')) {
      r++;
      let rowPage: number | undefined;
      const cells: string[] = [];
      for (const tc of kids(tr).filter((k) => tagOf(k) === 'w:tc')) {
        const texts = findAll(kids(tc), 'w:p').map((p) => {
          const i = this.readPara(p);
          if (i.text.trim() && rowPage == null) rowPage = i.page;
          return i.text.replace(/\s+/g, ' ').trim();
        });
        cells.push(texts.filter(Boolean).join(' '));
      }
      if (!cells.some((c) => c)) continue;
      const text = cells.join(' | ');
      if (kindOverride) this.bl.add(kindOverride, text, { part });
      else this.bl.add('table-row', text, this.loc(rowPage ?? this.page, { cell: `T${tNo} R${r}`, part: 'table' }));
    }
  }

  body(nodes: XNode[], kindOverride?: DocBlock['kind'], part?: string) {
    for (const n of nodes) {
      const t = tagOf(n);
      if (t === 'w:p') this.para(n, kindOverride, part);
      else if (t === 'w:tbl') this.table(n, kindOverride, part);
      else if (t === 'w:sdt') this.body(kids(child(n, 'w:sdtContent') ?? {}), kindOverride, part);
      else if (t === 'w:customXml' || t === 'w:ins' || t === 'w:smartTag') this.body(kids(n), kindOverride, part);
    }
  }
}

function readStyles(xml: string | undefined): Map<string, StyleInfo> {
  const map = new Map<string, StyleInfo>();
  if (!xml) return map;
  for (const s of findAll(parseOrdered(xml), 'w:style')) {
    const id = attr(s, 'w:styleId');
    if (!id) continue;
    const pPr = child(s, 'w:pPr');
    const ol = pPr && child(pPr, 'w:outlineLvl');
    map.set(id, {
      name: attr(child(s, 'w:name') ?? {}, 'w:val') ?? id,
      outline: ol ? Number(attr(ol, 'w:val')) : undefined,
      numbered: !!(pPr && child(pPr, 'w:numPr')),
      basedOn: attr(child(s, 'w:basedOn') ?? {}, 'w:val'),
    });
  }
  return map;
}

function numSort(a: string, b: string) {
  return Number(/(\d+)\.xml$/.exec(a)?.[1] ?? 0) - Number(/(\d+)\.xml$/.exec(b)?.[1] ?? 0);
}

export const parseDocx: Parser = async (_name, data) => {
  const zip = await JSZip.loadAsync(data);
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new Error('word/document.xml bulunamadı (geçerli bir DOCX değil).');
  const styles = readStyles(await zip.file('word/styles.xml')?.async('string'));
  const mode: PageMode = docXml.includes('w:lastRenderedPageBreak') ? 'rendered' : 'explicit';
  const bl = new BlockList();
  const root = parseOrdered(docXml);
  const body = findAll(root, 'w:body')[0];
  const w = new DocxWalker(styles, mode, bl, true);
  if (body) w.body(kids(body));

  // Başlık / altbilgi: aynı metin birden çok bölümde tekrarlanabilir → tekilleştir
  const hfBl = new BlockList('hf');
  const seen = new Set<string>();
  const hfFiles = Object.keys(zip.files).filter((f) => /^word\/(header|footer)\d*\.xml$/.test(f)).sort(numSort);
  for (const f of hfFiles) {
    const kind = f.includes('header') ? 'header' : 'footer';
    const xml = await zip.file(f)!.async('string');
    const tmp = new BlockList('tmp');
    const hw = new DocxWalker(styles, mode, tmp, false);
    const rootEl = parseOrdered(xml).find((n) => tagOf(n) === (kind === 'header' ? 'w:hdr' : 'w:ftr'));
    if (rootEl) hw.body(kids(rootEl), kind, kind);
    for (const b of tmp.blocks) {
      const key = `${kind}|${b.text}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hfBl.add(kind, b.text, { part: kind });
    }
  }

  // Dipnot / sonnotlar
  const noteBl = new BlockList('n');
  for (const [f, tag, part] of [['word/footnotes.xml', 'w:footnote', 'footnote'], ['word/endnotes.xml', 'w:endnote', 'endnote']] as const) {
    const xml = await zip.file(f)?.async('string');
    if (!xml) continue;
    for (const fn of findAll(parseOrdered(xml), tag)) {
      if (attr(fn, 'w:type')) continue; // ayırıcılar
      const tmp = new BlockList('tmp');
      new DocxWalker(styles, mode, tmp, false).body(kids(fn), 'note', part);
      for (const b of tmp.blocks) noteBl.add('note', b.text, { part: `${part} ${attr(fn, 'w:id') ?? ''}`.trim() });
    }
  }

  const meta: Record<string, string> = {};
  const core = await zip.file('docProps/core.xml')?.async('string');
  if (core) {
    const cp = (parsePlain(core).coreProperties ?? {}) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'object' && v && '#text' in v ? String((v as Record<string, unknown>)['#text']) : v != null ? String(v) : '');
    for (const [k, key] of [['title', 'title'], ['creator', 'author'], ['subject', 'subject'], ['lastModifiedBy', 'lastModifiedBy'], ['revision', 'revision'], ['modified', 'modified']] as const) {
      const v = str(cp[k]).trim();
      if (v) meta[key] = v;
    }
  }
  meta.pagesApprox = String(w.page);
  return result([...hfBl.blocks.filter((b) => b.kind === 'header'), ...bl.blocks, ...noteBl.blocks, ...hfBl.blocks.filter((b) => b.kind === 'footer')], {
    meta,
    messages: [{ level: 'info', text: DOCX_PAGE_MSG }],
  });
};
