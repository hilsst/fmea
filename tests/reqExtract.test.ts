import { describe, expect, it } from 'vitest';
import { extractDocument } from '../src/main/docintel/index';
import { findRequirementCandidates } from '../src/shared/docmodel';

const SPEC = `# 3. GEOMETRİK GEREKLİLİKLER

| Özellik | Nominal | Tolerans |
|---|---:|---:|
| Kalınlık | 5.00 mm | ±0.15 mm |
| Merkezi delik | Ø10 mm | +0.10 / 0.00 mm |
| Delik ekseninin yüzeye dikliği | 90° | ≤0.5° |

# 5. KÖŞE RADYÜSLERİ

Dört dış köşe:

**R10.00 ±0.50 mm**

Köşe radyüslerinde:

- çatlak,
- reçine birikimi,

bulunmamalıdır.

# 8. LAMİNASYON KURALLARI

Laminat:

- Simetrik olmalıdır.
- Dengeli olmalıdır.

# 10. PREPREG DEPOLAMA

Tipik olarak:

**≤ -18 °C**

depolama tercih edilir.

# 20. POROZİTE

Önerilen başlangıç kabul kriteri:

**Void content ≤ %2**
`;

describe('şartname metninden gereksinim çıkarma', () => {
  it('tablo satırı, madde listesi, bağlam ve değer biçimleri', async () => {
    const c = findRequirementCandidates(await extractDocument('spec.txt', Buffer.from(SPEC, 'utf8')));
    const by = (s: string) => c.find((x) => x.text.includes(s))!;
    expect(c.some((x) => x.text.includes('|') || x.text.includes('**'))).toBe(false);
    expect(by('Kalınlık:')).toMatchObject({ characteristic: 'Kalınlık', nominal: 5, lsl: 4.85, usl: 5.15, unit: 'mm' });
    expect(by('Merkezi delik:')).toMatchObject({ nominal: 10, lsl: 10, usl: 10.1, unit: 'mm' });
    expect(by('dikliği')).toMatchObject({ usl: 0.5, unit: '°' });
    expect(by('R10.00').text).toBe('KÖŞE RADYÜSLERİ – Dört dış köşe: R10.00 ±0.50 mm');
    expect(by('çatlak').text).toBe('Köşe radyüslerinde: çatlak, reçine birikimi bulunmamalıdır.');
    expect(c.filter((x) => x.text.startsWith('LAMİNASYON KURALLARI – Laminat:')).map((x) => x.text.split(': ')[1])).toEqual(['Simetrik olmalıdır.', 'Dengeli olmalıdır.']);
    expect(by('-18').text).toBe('PREPREG DEPOLAMA – Tipik olarak: ≤ -18 °C depolama tercih edilir.');
    expect(by('Void')).toMatchObject({ usl: 2, unit: '%' });
  });
});
