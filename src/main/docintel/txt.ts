// TXT / MD: boş satırla ayrılmış paragraflar; loc.line = başlangıç satırı. Numaralı ve Markdown başlıkları.
import { BlockList, decodeText, numberedHeading, result, splitParagraphs, type Parser } from './util';

export const parseTxt: Parser = async (_name, data) => {
  const bl = new BlockList();
  let section: string | undefined;
  for (const p of splitParagraphs(decodeText(data))) {
    const lines = p.text.split('\n');
    const first = lines[0];
    const md = /^(#{1,6})\s+(.+?)\s*#*$/.exec(first);
    const nh = md ? null : numberedHeading(first);
    if (md || nh) {
      const title = md ? md[2] : first;
      section = nh?.num ?? /^((?:\d{1,2}\.)*\d{1,2})\.?\s/.exec(title)?.[1] ?? title.slice(0, 80);
      bl.add('heading', title, { line: p.line, section }, md ? md[1].length : nh!.level);
      if (lines.length > 1) bl.add('paragraph', lines.slice(1).join('\n'), { line: p.line + 1, section });
    } else bl.add('paragraph', p.text, { line: p.line, section });
  }
  return result(bl.blocks);
};
