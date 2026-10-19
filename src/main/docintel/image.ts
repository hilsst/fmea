// Görsel: yerel OCR yok; yalnızca boyut bilgisi (PNG / JPEG başlığından).
import { result, type Parser } from './util';

export const IMAGE_MSG =
  'Görsel dosyada yerel metin çıkarımı (OCR) desteklenmiyor. AI görsel analizi kullanılabilir; sonuçlar MANUAL VERIFICATION REQUIRED olarak işaretlenir.';

export function imageSize(b: Buffer): { width: number; height: number; format: string } | null {
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504e47 && b.toString('latin1', 12, 16) === 'IHDR')
    return { width: b.readUInt32BE(16), height: b.readUInt32BE(20), format: 'PNG' };
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return null;
      const m = b[i + 1];
      if (m === 0xd9 || m === 0xda) break;
      const len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc)
        return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5), format: 'JPEG' };
      i += 2 + len;
    }
    return null;
  }
  if (b.length > 8 && (b.toString('latin1', 0, 4) === 'II*\0' || b.toString('latin1', 0, 4) === 'MM\0*')) return { width: 0, height: 0, format: 'TIFF' };
  return null;
}

export const parseImage: Parser = async (_name, data) => {
  const meta: Record<string, string> = {};
  const s = imageSize(data);
  if (s) {
    meta.format = s.format;
    if (s.width && s.height) {
      meta.width = String(s.width);
      meta.height = String(s.height);
    }
  }
  return result([], { status: 'partial', meta, messages: [{ level: 'warning', text: IMAGE_MSG }] });
};
