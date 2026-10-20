// Gereksinim satırından kabul kriteri, doğrulama yöntemi ve ölçü alanlarının otomatik doldurulması.
// Kural: kaynakta olmayan değer uydurulmaz. Limitler metinden/alanlardan gelir; yoksa VERİ YOK.
// Doğrulama yöntemi gereksinim tipinden önerilir ve "AI ÖNERİSİ" olarak işaretlenir (onay mühendiste).
import { classifyRequirement, parseValueSpec } from './docmodel';
import type { RequirementRow } from './types';

export const NO_DATA = 'VERİ YOK – doğrulanmalı';
export const SUGGESTION = 'AI ÖNERİSİ – onay gerekli';

/** Otomatik doldurulan alanlar; mühendis elle değiştirince otomatik güncelleme o alanda durur. */
export const REQ_AUTO_FIELDS = ['reqType', 'acceptance', 'verification', 'characteristic', 'nominal', 'lsl', 'usl', 'unit', 'tolerance'] as const;
/** Bu alanlar değişince otomatik alanlar yeniden hesaplanır. */
export const REQ_AUTO_INPUTS = ['text', 'reqType', 'characteristic', 'nominal', 'lsl', 'usl', 'unit', 'tolerance'];

const CHAR_WORDS: [RegExp, string][] = [
  [/(Ø|⌀|çap|diameter|delik|hole)/i, 'Çap'],
  [/(kalınlık|thickness|bondline)/i, 'Kalınlık'],
  [/(düzlemsellik|flatness)/i, 'Düzlemsellik'],
  [/(pozisyon|position)/i, 'Pozisyon'],
  [/(uzunluk|length)/i, 'Uzunluk'],
  [/(genişlik|width)/i, 'Genişlik'],
  [/(pürüzlülük|roughness|\bRa\b)/i, 'Pürüzlülük'],
  [/(sıcaklık|temperature|°C)/i, 'Sıcaklık'],
  [/(basınç|pressure|bar\b|psi)/i, 'Basınç'],
  [/(vakum|vacuum)/i, 'Vakum'],
  [/(tork|torque)/i, 'Tork'],
  [/(ağırlık|weight|kütle|mass)/i, 'Ağırlık'],
  [/(dayanım|strength|mukavemet)/i, 'Dayanım'],
  [/(gözeneklilik|porosity|void)/i, 'Gözeneklilik'],
  [/(süre|time|dk\b|min\b)/i, 'Süre'],
];

/** Yalnızca metinde geçen kelimeden karakteristik adı; yoksa boş. */
export function characteristicOf(text: string): string {
  for (const [re, name] of CHAR_WORDS) if (re.test(text)) return name;
  return '';
}

const fmt = (v: number) => String(v);

/** Limitlerden kabul kriteri metni. Limit yoksa NO_DATA; tek nominal varsa toleransın eksik olduğu yazılır. */
export function acceptanceOf(r: Pick<RequirementRow, 'nominal' | 'lsl' | 'usl' | 'unit' | 'tolerance'>): string {
  const u = r.unit ? ` ${r.unit}` : '';
  if (r.lsl != null && r.usl != null) return `${fmt(r.lsl)}–${fmt(r.usl)}${u}${r.nominal != null ? ` (nominal ${fmt(r.nominal)}${r.tolerance ? `, ${r.tolerance}` : ''})` : ''}`;
  if (r.lsl != null) return `≥ ${fmt(r.lsl)}${u}`;
  if (r.usl != null) return `≤ ${fmt(r.usl)}${u}`;
  if (r.nominal != null) return `${fmt(r.nominal)}${u} – tolerans ${NO_DATA}`;
  return NO_DATA;
}

const VERIFY: [RegExp, string][] = [
  [/(Ø|⌀|çap|delik|hole)/i, 'Tapa mastar / CMM'],
  [/(düzlemsellik|flatness|pozisyon|position|profil|profile)/i, 'CMM ölçümü'],
  [/(kalınlık|thickness)/i, 'Kalınlık ölçümü (mikrometre / ultrasonik kalınlık)'],
  [/(pürüzlülük|roughness|\bRa\b)/i, 'Yüzey pürüzlülük ölçümü (profilometre)'],
  [/(kür|cure|otoklav|autoclave)/i, 'Kür kaydı (otoklav/fırın çıktısı, termokupl verisi)'],
  [/(vakum|vacuum)/i, 'Vakum kaçak testi / proses kaydı'],
  [/(tork|torque)/i, 'Tork anahtarı ile kontrol / tork kaydı'],
  [/(gözeneklilik|porosity|void|delaminasyon|disbond|ndt|ultrason)/i, 'NDT (yöntem ve kabul seviyesi kaynakta belirtilmeli)'],
];

const VERIFY_BY_TYPE: Record<string, string> = {
  Dimensional: 'Boyutsal ölçüm (CMM / kumpas / mastar)',
  Material: 'Malzeme sertifikası (CoC) + giriş kontrol testi',
  Manufacturing: 'Proses kaydı / parametre izleme',
  Process: 'Proses kaydı / parametre izleme',
  Inspection: 'Muayene (yöntem kaynakta belirtilmeli)',
  Environmental: `Çevresel test (test standardı ${NO_DATA})`,
  Performance: `Performans testi (test yöntemi ${NO_DATA})`,
  Structural: `Yapısal analiz + test (test yöntemi ${NO_DATA})`,
  Reliability: `Ömür / yorulma testi (test yöntemi ${NO_DATA})`,
  Safety: 'Analiz + test (sertifikasyon/doğrulama planına göre)',
  Regulatory: 'Uygunluk gösterimi (sertifikasyon planına göre)',
  Interface: 'Montaj / uyum kontrolü',
  Functional: 'Fonksiyon testi',
  'Customer-specific': `Müşteri gereksinimine göre (${NO_DATA})`,
};

/** Gereksinim metni ve tipinden doğrulama yöntemi önerisi; tip de yoksa NO_DATA. */
export function verificationOf(r: Pick<RequirementRow, 'text' | 'reqType' | 'characteristic'>): string {
  const t = `${r.characteristic} ${r.text}`;
  const hit = VERIFY.find(([re]) => re.test(t))?.[1] ?? VERIFY_BY_TYPE[r.reqType];
  return hit ? `${hit} (${SUGGESTION})` : NO_DATA;
}

/** Satır için otomatik değerler. Ölçü alanları yalnızca metinde çözülebilen değerden gelir. */
export function reqAutoValues(r: RequirementRow): Partial<Record<(typeof REQ_AUTO_FIELDS)[number], unknown>> {
  const auto = new Set(r.autoFields ?? []);
  const free = (f: string) => auto.has(f) || isEmpty((r as unknown as Record<string, unknown>)[f]);
  const out: Record<string, unknown> = {};
  const spec = parseValueSpec(r.text ?? '');
  if (spec) {
    for (const f of ['nominal', 'lsl', 'usl', 'unit', 'tolerance'] as const) if (free(f) && !isEmpty(spec[f])) out[f] = spec[f];
  }
  if (free('reqType') && r.text?.trim()) out.reqType = classifyRequirement(r.text);
  if (free('characteristic')) {
    const c = characteristicOf(r.text ?? '');
    if (c) out.characteristic = c;
  }
  const merged = { ...r, ...out } as RequirementRow;
  if (free('acceptance')) out.acceptance = acceptanceOf(merged);
  if (free('verification')) out.verification = verificationOf(merged);
  return out;
}

function isEmpty(v: unknown) {
  return v == null || v === '';
}
