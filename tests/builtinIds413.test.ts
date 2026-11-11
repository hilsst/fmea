// 4.13.0: Yerleşik kayıt kimlikleri kararlı kalmalı (aksi halde firma kütüphanesindeki "devre dışı" işaretleri düşer).
// Bir kaydın metnini değiştirdiyseniz: şablona `id: '<eski kimlik>'` ekleyin. Kasıtlı kayıt silme / ekleme sonrası: UPDATE_IDS=1 npx vitest run builtinIds
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { builtinIndex } from '../src/shared/companyLib';

const FILE = 'tests/fixtures/builtin-ids.json';
const ix = builtinIndex();
const ids = [...ix.dfmea, ...ix.functionTypes, ...ix.element, ...ix.pfmea, ...ix.pfmeaCommon, ...ix.alt, ...ix.params, ...ix.gauges, ...ix.structures].map((x) => x.id).sort();

describe('yerleşik kimlik kararlılığı', () => {
  it('kayıtlı kimliklerin hiçbiri kaybolmaz', () => {
    if (process.env.UPDATE_IDS || !fs.existsSync(FILE)) fs.writeFileSync(FILE, JSON.stringify(ids, null, 0) + '\n');
    const saved: string[] = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    const now = new Set(ids);
    expect(saved.filter((i) => !now.has(i)), 'kaybolan kimlikler: metni değiştirilen kaydın şablonuna eski kimliği id olarak yazın').toEqual([]);
  });
});
