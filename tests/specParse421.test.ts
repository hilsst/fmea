import { describe, expect, it } from 'vitest';
import { extractDocument } from '../src/main/docintel/index';
import { findRequirementCandidates, parseValueSpec } from '../src/shared/docmodel';
import { elementName } from '../src/shared/autogen';

// 4.2.1: EGT-BRK-001 eğitim şartnamesinde görülen ayrıştırma hataları
describe('4.2.1 şartname ayrıştırma düzeltmeleri', () => {
  it('"-melidir" / "-ecektir" ile biten cümleler gereksinim sayılır', async () => {
    const txt = [
      'Yüzeyde çapak bulunmamalı ve kenarlar keskin kenar göstermemelidir.',
      'Delik çapları her partide ölçülmelidir.',
      'Parça müşteriye etiketli teslim edilecektir.',
      'Bu bölüm bilgi amaçlıdır.',
    ].join('\n\n');
    const c = findRequirementCandidates(await extractDocument('spec.txt', Buffer.from(txt, 'utf8')));
    const texts = c.map((x) => x.text).join(' | ');
    expect(texts).toContain('göstermemelidir');
    expect(texts).toContain('ölçülmelidir');
    expect(texts).toContain('edilecektir');
    expect(texts).not.toContain('bilgi amaçlıdır');
  });

  it('Türkçe karakterli kelimelerin içindeki "s" birim sanılıp silinmez', () => {
    expect(elementName('Büküm açısı 90 ± 1 ° olmalıdır.')).toBe('Büküm açısı');
    expect(elementName('Delik çapları her partide ölçülmelidir.')).toBe('Delik çapları her partide');
    expect(elementName('Çevrim süresi 30 s olmalıdır')).toBe('Çevrim süresi');
  });

  it('negatif/pozitif sıcaklık aralığı tek değer olarak okunmaz', () => {
    for (const t of ['Çalışma sıcaklığı -40 … +85 °C aralığında olmalıdır', 'Çalışma sıcaklığı -40 ile +85 °C olmalıdır', 'Çalışma sıcaklığı -40 °C ile +85 °C olmalıdır', 'Sıcaklık -40...+85 °C']) {
      expect(parseValueSpec(t), t).toMatchObject({ nominal: null, lsl: -40, usl: 85, unit: '°C' });
    }
    expect(elementName('Çalışma sıcaklığı -40 … +85 °C aralığında olmalıdır')).toBe('Çalışma sıcaklığı');
    // farklı birimler aralık sayılmaz
    expect(parseValueSpec('5 mm ile 10 °C')?.lsl).not.toBe(5);
  });
});
