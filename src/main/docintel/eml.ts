// EML (RFC 822 / MIME): postal-mime.
import PostalMimeMod from 'postal-mime';
import { interop, type Parser } from './util';
import { buildEmailResult, type MailAttachment } from './email';

type Addr = { name: string; address?: string; group?: { name: string; address: string }[] };
type PM = { parse(buf: ArrayBuffer | Uint8Array | string): Promise<Record<string, unknown>> };

export function fmtAddr(a: { name?: string; address?: string }): string {
  const name = (a.name ?? '').trim(), addr = (a.address ?? '').trim();
  return name && addr && name !== addr ? `${name} <${addr}>` : addr || name;
}

const flat = (list: unknown): string[] =>
  ((list as Addr[] | undefined) ?? []).flatMap((a) => (a.group ? a.group.map(fmtAddr) : [fmtAddr(a)])).filter(Boolean);

const extOf = (mime: string) => ({ 'application/pdf': 'pdf', 'text/plain': 'txt', 'text/csv': 'csv', 'image/png': 'png', 'image/jpeg': 'jpg', 'message/rfc822': 'eml' })[mime] ?? 'bin';

export const parseEml: Parser = async (_name, data, ctx) => {
  const PostalMime = interop<PM>(PostalMimeMod);
  const mail = await PostalMime.parse(new Uint8Array(data));
  if (!mail.headers || !(mail.headers as unknown[]).length) throw new Error('E-posta başlıkları bulunamadı (geçerli bir EML değil).');
  const atts = ((mail.attachments ?? []) as { filename: string | null; mimeType: string; disposition: string | null; related?: boolean; content: ArrayBuffer | Uint8Array | string }[])
    // gövdeye gömülü (cid) görseller ek sayılmaz
    .filter((a) => !(a.related && a.mimeType.startsWith('image/') && !a.filename))
    .map((a, i): MailAttachment => {
      const buf = typeof a.content === 'string' ? Buffer.from(a.content, 'utf8') : Buffer.from(a.content instanceof ArrayBuffer ? new Uint8Array(a.content) : a.content);
      return { name: a.filename || `ek-${i + 1}.${extOf(a.mimeType)}`, mime: a.mimeType, size: buf.length, data: buf };
    });
  const from = (mail.from as Addr | undefined) ?? (mail.sender as Addr | undefined);
  const meta: Record<string, string> = {};
  if (typeof mail.messageId === 'string') meta.messageId = mail.messageId;
  if (typeof mail.inReplyTo === 'string') meta.inReplyTo = mail.inReplyTo;
  return buildEmailResult(
    {
      from: from ? flat([from]).join(', ') : '',
      to: flat(mail.to),
      cc: flat(mail.cc),
      subject: (mail.subject as string | undefined) ?? '',
      date: (mail.date as string | undefined) ?? '',
      text: mail.text as string | undefined,
      html: mail.html as string | undefined,
      attachments: atts,
      meta,
    },
    ctx,
  );
};
