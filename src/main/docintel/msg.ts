// Outlook MSG: @kenjiuno/msgreader. Yapı EML ile aynı (ortak email.ts).
import MsgReaderMod from '@kenjiuno/msgreader';
import type { FieldsData } from '@kenjiuno/msgreader/lib/MsgReader';
import { decodeText, interop, type Parser } from './util';
import { buildEmailResult, type MailAttachment } from './email';
import { fmtAddr } from './eml';
import type { ExtractMessage } from '../../shared/docmodel';

type MR = new (ab: ArrayBuffer) => { getFileData(): FieldsData; getAttachment(a: FieldsData): { fileName: string; content: Uint8Array } };

export const parseMsg: Parser = async (_name, data, ctx) => {
  const MsgReader = interop<MR>(MsgReaderMod);
  const ab = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  const reader = new MsgReader(ab);
  const f = reader.getFileData();
  if (f.error) throw new Error(`Geçerli bir Outlook MSG dosyası değil (${f.error}).`);
  const messages: ExtractMessage[] = [];
  const recips = f.recipients ?? [];
  const addr = (r: FieldsData) => fmtAddr({ name: r.name, address: r.smtpAddress || r.email });
  const atts: MailAttachment[] = [];
  for (const a of f.attachments ?? []) {
    if (a.attachmentHidden) continue;
    let name = a.fileName || a.fileNameShort || a.name || `ek-${atts.length + 1}`;
    if (a.innerMsgContent && !/\.msg$/i.test(name)) name += '.msg';
    try {
      const got = reader.getAttachment(a);
      const buf = Buffer.from(got.content);
      atts.push({ name, mime: a.attachMimeTag ?? '', size: buf.length, data: buf });
    } catch (e) {
      atts.push({ name, mime: a.attachMimeTag ?? '', size: a.contentLength ?? 0 });
      messages.push({ level: 'warning', text: `Ek "${name}" okunamadı: ${e instanceof Error ? e.message : String(e)}` });
    }
  }
  const html = f.bodyHtml ?? (f.html ? decodeText(Buffer.from(f.html)) : undefined);
  const meta: Record<string, string> = {};
  if (f.messageId) meta.messageId = f.messageId;
  return buildEmailResult(
    {
      from: fmtAddr({ name: f.senderName, address: f.senderSmtpAddress || f.senderEmail }),
      to: recips.filter((r) => (r.recipType ?? 'to') === 'to').map(addr).filter(Boolean),
      cc: recips.filter((r) => r.recipType === 'cc').map(addr).filter(Boolean),
      subject: f.subject ?? '',
      date: f.clientSubmitTime ?? f.messageDeliveryTime ?? f.creationTime ?? '',
      text: f.body,
      html,
      attachments: atts,
      meta,
      messages,
    },
    ctx,
  );
};
