// 4.7.0: önleyici / tespit kontrolleri için göreli maliyet sınıfı ve maliyet-etkin sıralama.
// Fiyat verisi YOKTUR: sınıflar (Düşük / Orta / Yüksek / Çok yüksek) kontrol tipinden türetilen göreli bir
// mühendislik varsayımıdır (AI VARSAYIMI). Gerçek maliyet ve fizibilite mühendis tarafından doğrulanır.
// Sıralama: önce düşük maliyet, eşitlikte daha güçlü kontrol (hata önleme > proses kontrolü > idari).
// Yüksek severity'de yalnız idari kontrol (talimat, eğitim) tek başına önerilmez; en ucuz hata önleme seçeneği eklenir.

export type CostTier = 1 | 2 | 3 | 4;
/** 3 = hata önleme (nedeni ortadan kaldırır / hatayı imkânsız kılar), 2 = proses kontrolü, 1 = idari. */
export type Strength = 1 | 2 | 3;

export const COST_LABEL: Record<CostTier, string> = { 1: 'Düşük', 2: 'Orta', 3: 'Yüksek', 4: 'Çok yüksek' };
export const STRENGTH_LABEL: Record<Strength, string> = { 1: 'idari', 2: 'proses kontrolü', 3: 'hata önleme' };
export const COST_NOTE = 'maliyet sınıfı göreli tahmindir – fiyat verisi yok, AI VARSAYIMI';

export interface Measure {
  text: string;
  cost: CostTier;
  strength: Strength;
}

// Sıra önemlidir: ilk eşleşen kural geçerlidir (pahalıdan ucuza doğru denenir).
const COST_RULES: [RegExp, CostTier][] = [
  [/tasarım değişikli|tasarım marjının artır|yeni ekipman|yatırım|otomasyon|robot|otomatik (karışım|dozaj|ölçüm|muayene|tespit)|kamera|görüntü işleme|vision|yedekli tasarım|fail-safe/, 4],
  [/sensör|interlock|alarm|sürekli parametre|parametre izleme|ortam izleme|barkod|barcode|lazer projeksiyon|kalifikasyon|ömür testi|yorulma|statik test|çevresel test|titreşim testi|ndt|\bfea\b|yapısal analiz|modal analiz|hata önleme \(asimetrik|tek yönlü geometri|temiz oda|kabin ortam/, 3],
  [/fikstür|fixture|şablon|template|mastar|poka-yoke|kilid|kilit|lock|recipe|reçete|kalibrasyon|kalibre|\bmsa\b|gage|\btus\b|\bsat\b|sayaç|takım ömrü|ilk parça|tolerans (yığılması|analizi)|stack-up|dfm|dfa|dfi|kitleme|aparat|analiz|aralayıcı|backing|zamanlayıcı|pah takımı|termokupl|kalifiye|wps|allowable|dmu|dijital montaj|bakım planı/, 2],
  [/./, 1],
];

const STRONG = /poka-yoke|fikstür|fixture|şablon|template|kilid|kilit|lock|interlock|barkod|barcode|otomatik|tasarım değişikli|tasarımda hata önleme|asimetrik|tek yönlü|go\/no-go|aralayıcı|recipe|fail-safe|yedekli|sistem rota onayı|zorunlu (adım )?onay|aparat|pah takımı|maskeleme şablonu/;
const ADMIN = /talimat|prosedür|eğitim|kontrol listesi|checklist|dikkat|etiket|inceleme|kayıt|kural|numune|yeterlili|standart iş|5s|matris|listesi|\bicd\b|izlenebilirli/;

const lc = (s: string) => s.toLocaleLowerCase('tr');

export function costTierOf(text: string): CostTier {
  const t = lc(text);
  return COST_RULES.find(([re]) => re.test(t))![1];
}

export function strengthOf(text: string): Strength {
  const t = lc(text);
  return STRONG.test(t) ? 3 : ADMIN.test(t) ? 1 : 2;
}

export const measureOf = (text: string): Measure => ({ text: text.trim(), cost: costTierOf(text), strength: strengthOf(text) });

const M = (text: string, cost: CostTier, strength: Strength): Measure => ({ text, cost, strength });

/** PFMEA: neden kategorisine (4M) göre genel önleyici yöntemler. */
export const PREVENTION_4M: Record<string, Measure[]> = {
  Man: [
    M('Görsel iş talimatı + limit / referans numune', 1, 1),
    M('Kontrol listesi ile adım onayı', 1, 1),
    M('Şablon / fikstür ile yanlış yerleştirmenin engellenmesi', 2, 3),
    M('Poka-yoke (geometrik engel, sayım kutusu)', 2, 3),
    M('Sensörlü varlık / sayım kontrolü (interlock)', 3, 3),
  ],
  Machine: [
    M('Vardiya başı ayar doğrulaması + ilk parça onayı', 1, 2),
    M('Önleyici bakım planı', 1, 2),
    M('Reçete / parametre kilidi (yazılım)', 2, 3),
    M('Takım ömrü sayacı', 2, 2),
    M('Parametre izleme + alarm / interlock', 3, 3),
  ],
  Method: [
    M('İş talimatının netleştirilmesi + görsel standart', 1, 1),
    M('İş emrinde zorunlu adım onayı (rota imzası)', 1, 2),
    M('Fikstür / şablon ile yöntemin sabitlenmesi', 2, 3),
    M('Program / reçete revizyon kilidi', 2, 3),
  ],
  Material: [
    M('Etiketleme, ayrı depolama ve FIFO', 1, 2),
    M('Giriş kontrolünde sertifika – iş emri eşleştirmesi', 1, 2),
    M('Barkodla malzeme – iş emri doğrulaması', 3, 3),
  ],
  Measurement: [
    M('Kalibrasyon programı ve ölçüm talimatı', 1, 2),
    M('Go/No-go mastar', 2, 3),
    M('MSA (Gage R&R) ile ölçüm sisteminin doğrulanması', 2, 2),
    M('Otomatik ölçüm', 4, 3),
  ],
  Environment: [
    M('Alan düzeni (5S) ve FOD kontrol listesi', 1, 1),
    M('Ortam koşulu kaydı (sıcaklık / nem) – vardiya başı', 1, 2),
    M('Ortam izleme + alarm', 3, 2),
  ],
};

/** DFMEA: tasarım önleme yöntemleri (ucuzdan pahalıya). */
export const PREVENTION_DESIGN: Measure[] = [
  M('Tasarım kontrol listesi / tasarım kuralı uygulaması', 1, 1),
  M('Benzer tasarım ve lessons learned incelemesi', 1, 2),
  M('Onaylı malzeme / standart parça listesinden seçim', 1, 2),
  M('Tolerans yığılması / mühendislik analizi', 2, 2),
  M('Tasarımda hata önleme (asimetrik / tek yönlü geometri)', 3, 3),
  M('Tasarım marjının artırılması (tasarım değişikliği)', 4, 3),
];

/**
 * Adayları maliyet-etkinliğe göre sıralar ve en fazla `max` seçenek döndürür.
 * - Mevcut kontrol metninde (current) zaten geçenler çıkarılır.
 * - severity ≥ 9 ise idari kontroller aday olmaz; severity ≥ 8 ise listede hata önleme yoksa en ucuzu eklenir.
 */
export function rankMeasures(cands: Measure[], opts: { severity?: number | null; current?: string; max?: number } = {}): Measure[] {
  const cur = lc(opts.current ?? '');
  const s = opts.severity ?? 0;
  const seen = new Set<string>();
  const pool = cands.filter((m) => {
    const k = lc(m.text);
    if (!k || seen.has(k) || cur.includes(k)) return false;
    seen.add(k);
    return true;
  });
  const sorted = [...pool].sort((a, b) => a.cost - b.cost || b.strength - a.strength);
  const eligible = s >= 9 ? sorted.filter((m) => m.strength >= 2) : sorted;
  const max = opts.max ?? 3;
  const out = eligible.slice(0, max);
  if (s >= 8 && !out.some((m) => m.strength === 3)) {
    const ep = eligible.find((m) => m.strength === 3);
    if (ep) out.splice(Math.min(out.length, max - 1), out.length >= max ? 1 : 0, ep);
  }
  return out.sort((a, b) => a.cost - b.cost || b.strength - a.strength);
}

export function measureText(m: Measure): string {
  return `${m.text} [maliyet: ${COST_LABEL[m.cost]} · ${STRENGTH_LABEL[m.strength]}]`;
}

/** "1) … 2) …" biçiminde, ucuzdan pahalıya. */
export function measureList(ms: Measure[]): string {
  return ms.map((m, i) => `${i + 1}) ${measureText(m)}`).join(' ');
}
