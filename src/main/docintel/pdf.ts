// PDF: sayfa bazında metin katmanı (unpdf / PDF.js). OCR yok.
import { BlockList, numberedHeading, result, titleBlockMeta, type Parser } from './util';

export const PDF_SCANNED_MSG =
  'PDF metin katmanı içermiyor (taranmış olabilir); yerel OCR desteklenmiyor – AI görsel analizi veya MANUAL VERIFICATION REQUIRED.';

export const parsePdf: Parser = async (_name, data) => {
  // unpdf yalnızca ESM; CJS paketlemede de çalışsın diye dinamik import
  const { extractText, getDocumentProxy, getMeta } = await import('unpdf');
  const pdf = await getDocumentProxy(new Uint8Array(data));
  const meta: Record<string, string> = {};
  try {
    const { text: pages, totalPages } = await extractText(pdf, { mergePages: false });
    meta.pages = String(totalPages);
    try {
      const { info } = await getMeta(pdf);
      const i = (info ?? {}) as Record<string, unknown>;
      for (const [k, key] of [['Title', 'title'], ['Author', 'author'], ['Subject', 'subject'], ['Creator', 'creatorTool']] as const)
        if (typeof i[k] === 'string' && (i[k] as string).trim()) meta[key] = (i[k] as string).trim();
    } catch {
      /* meta isteğe bağlı */
    }
    const bl = new BlockList();
    let section: string | undefined;
    pages.forEach((pageText, idx) => {
      const page = idx + 1;
      let cur: string[] = [];
      const flush = () => {
        if (cur.length) bl.add('paragraph', cur.join(' '), { page, section });
        cur = [];
      };
      const lines = pageText.split('\n');
      lines.forEach((raw, i) => {
        const line = raw.trim();
        if (!line) return flush();
        const h = numberedHeading(line);
        if (h) {
          flush();
          section = h.num;
          bl.add('heading', line, { page, section }, h.level);
          return;
        }
        if (/^([•▪●\-–*]|\(?[a-z0-9]\))\s/.test(line)) flush();
        cur.push(line);
        const next = lines[i + 1]?.trim() ?? '';
        if (/[.!?;:]$/.test(line) && /^[A-ZÇĞİÖŞÜ0-9•▪●\-–(]/.test(next)) flush();
      });
      flush();
    });
    const all = pages.join('\n');
    Object.assign(meta, titleBlockMeta(all));
    if (!all.trim())
      return result([], { status: 'partial', meta, messages: [{ level: 'warning', text: PDF_SCANNED_MSG }] });
    const empty = pages.map((p, i) => (p.trim() ? 0 : i + 1)).filter(Boolean);
    const messages = empty.length
      ? [{ level: 'warning' as const, text: `Metin katmanı olmayan sayfalar: ${empty.join(', ')} (taranmış olabilir; MANUAL VERIFICATION REQUIRED).` }]
      : [];
    return result(bl.blocks, { meta, messages, status: empty.length ? 'partial' : 'ok' });
  } finally {
    await pdf.loadingTask.destroy().catch(() => undefined);
  }
};
