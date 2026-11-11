// 4.13.0: Ürün tipine göre eksik gereksinim kontrol listesi. Kontrol listesi yalnız KONU hatırlatır (sayısal değer içermez);
// şartnamede varsa mühendis girer. Eksik konu "AI Proposed" yer tutucu gereksinim olarak eklenebilir (onay mühendistedir).
import { NO_DATA } from './reqAutofill';
import type { Project, RequirementRow } from './types';

export interface ChecklistItem {
  key: string;
  label: string;
  reqType: string;
  /** Mevcut gereksinim metni / karakteristiğinde konunun geçtiğini gösteren desen. */
  re: RegExp;
  /** Neden sorulur (kısa). */
  why: string;
}
const I = (key: string, label: string, reqType: string, re: RegExp, why: string): ChecklistItem => ({ key, label, reqType, re, why });

export const COMMON_ITEMS: ChecklistItem[] = [
  I('dim', 'Boyut ve toleranslar', 'Dimensional', /boyut|ölçü|tolerans|dimension|çap|kalınl|uzunluk|genişlik|Ø|⌀/i, 'Çizimdeki fonksiyonel boyutlar DFMEA / kontrol planının temelidir.'),
  I('mat', 'Malzeme ve proses spesifikasyonu', 'Material', /malzeme|material|spesifikasyon|specification|alaşım|reçine|resin|elyaf|fiber|prepreg/i, 'Malzeme kabulü ve eşdeğerlik kuralı.'),
  I('mass', 'Ağırlık / kütle', 'Performance', /ağırlık|kütle|weight|mass/i, 'Ağırlık limiti varsa performans gereksinimidir.'),
  I('surf', 'Yüzey kalitesi ve görünüm', 'Dimensional', /yüzey|surface|görünüm|appearance|pürüzlül|roughness|kusur|defect/i, 'Kabul edilemez yüzey kusurları.'),
  I('trace', 'İzlenebilirlik ve işaretleme', 'Customer-specific', /izlenebil|traceab|işaretle|marking|seri no|lot|parti/i, 'Havacılıkta parti / seri izlenebilirliği.'),
  I('clean', 'Temizlik, FOD ve ambalaj / koruma', 'Customer-specific', /temizl|clean|fod|ambalaj|packag|koruma|saklama|storage/i, 'Teslimat öncesi koruma ve yabancı madde.'),
  I('env', 'Çevresel dayanım', 'Environmental', /çevresel|environment|nem|humid|sıcaklık|temperature|korozyon|corrosion|uv|yakıt|fluid|sıvı/i, 'Kullanım ortamı koşulları.'),
  I('inspect', 'Muayene ve kabul yöntemi', 'Inspection', /muayene|inspection|nde|ndt|kabul|acceptance|test|numune|sample/i, 'Kabul yöntemi ve kapsamı.'),
  I('doc', 'Dokümantasyon / sertifika / uygunluk', 'Regulatory', /sertifika|certificate|uygunluk|conformance|coc|fai|ilk parça|first article|kayıt|record/i, 'Teslimatla beklenen belgeler.'),
  I('safety', 'Emniyet / regülasyon gereksinimi', 'Safety', /emniyet|safety|regülasyon|regulat|kritik|critical|yanıcı|flammab|yangın|fire/i, 'Emniyet kritik özellikler yüksek şiddet derecesi gerektirebilir.'),
];

const COMPOSITE: ChecklistItem[] = [
  I('ply', 'Katman dizilimi ve elyaf yönü', 'Structural', /katman|ply|layup|dizilim|oryantasyon|orientation|elyaf yön/i, 'Dizilim hatası mukavemeti doğrudan etkiler.'),
  I('vf', 'Elyaf hacim oranı / reçine içeriği', 'Material', /hacim oran|fiber volume|reçine içer|resin content|vf\b/i, 'Kür sonrası laminat kalitesi.'),
  I('void', 'Gözeneklilik / boşluk (void)', 'Structural', /gözenek|porosity|void|boşluk/i, 'Gözeneklilik sınırı kabul kriteridir.'),
  I('delam', 'Delaminasyon / iç kusur (NDI)', 'Inspection', /delamin|ndi|ndt|c-scan|ultrason|ultrasonic|iç kusur/i, 'NDI yöntemi ve kabul kriteri.'),
  I('cure', 'Kür çevrimi ve cam geçiş sıcaklığı (Tg)', 'Manufacturing', /kür|cure|tg\b|cam geçiş|glass transition|otoklav|autoclave/i, 'Kür çevrimi proses gereksinimidir.'),
  I('life', 'Malzeme raf ömrü ve oda sıcaklığı süresi', 'Material', /raf ömrü|shelf life|out.?time|oda sıcaklığı|freezer|derin dondur/i, 'Süresi geçen prepreg kullanımı yaygın hatadır.'),
  I('moist', 'Nem alma / koşullandırma', 'Environmental', /nem al|moisture|koşullan|condition/i, 'Nemli laminat performansı.'),
];
const BONDED: ChecklistItem[] = [
  I('bl', 'Yapıştırma hattı kalınlığı', 'Dimensional', /bağ hattı|bondline|bond line|yapıştırma hattı/i, 'Bağ hattı kalınlığı dayanımı etkiler.'),
  I('prep', 'Yüzey hazırlığı (temizlik / aşındırma / primer)', 'Manufacturing', /yüzey hazırl|surface prep|aşındır|abrad|primer|plazma|plasma|soyma plies|peel ply/i, 'Yüzey hazırlığı bağ kalitesinin ana nedenidir.'),
  I('shear', 'Bağ dayanımı (kayma / soyulma)', 'Structural', /kayma|shear|soyulma|peel|bağ dayan|bond strength|lap/i, 'Bağ dayanımı doğrulama yöntemi.'),
  I('adhlife', 'Yapıştırıcı raf ömrü ve çalışma süresi', 'Material', /pot life|çalışma süresi|raf ömrü|shelf life|açık süre|open time/i, 'Yapıştırıcı kullanım süresi.'),
  I('bcure', 'Yapıştırıcı kür koşulları', 'Manufacturing', /kür|cure/i, 'Kür koşulları proses gereksinimidir.'),
];
const RADOME: ChecklistItem[] = [
  I('rf', 'RF geçirgenlik / iletim kaybı / dielektrik özellik', 'Performance', /rf|dielektrik|dielectric|iletim|transmission|geçirgenlik|radyo|anten|antenna|elektromanyetik/i, 'Radom için birincil fonksiyondur.'),
  I('boresight', 'Hüzme sapması / yönlenme hatası', 'Performance', /boresight|hüzme|sapma|bore|yönlen/i, 'Duvar kalınlığı ve homojenlik etkisi.'),
  I('rain', 'Yağmur / kum erozyonu ve kaplama', 'Environmental', /erozyon|erosion|kaplama|coating|boya|paint|yağmur|rain/i, 'Dış kaplama dayanımı.'),
  I('light', 'Yıldırım / statik koruma', 'Safety', /yıldırım|lightning|statik|static|iletken|conductive|diverter/i, 'Koruma sistemi gereksinimi.'),
  I('seal', 'Sızdırmazlık / su alımı', 'Environmental', /sızdırmaz|seal|su al|water|nem geç|leak/i, 'Su girişi RF performansını bozar.'),
  I('wall', 'Duvar kalınlığı homojenliği', 'Dimensional', /duvar|wall|kalınlık homojen|thickness/i, 'RF performansına doğrudan etki.'),
];
const SANDWICH: ChecklistItem[] = [
  I('core', 'Çekirdek malzeme ve yüzey bağı', 'Structural', /çekirdek|core|petek|honeycomb|köpük|foam|yüzey bağı|skin/i, 'Çekirdek-yüzey bağı ana arıza modudur.'),
  I('crush', 'Çekirdek ezilmesi / basma dayanımı', 'Structural', /ezil|crush|basma|compress/i, 'Kür basıncında çekirdek ezilmesi.'),
  I('water', 'Su alımı ve kenar kapatma', 'Environmental', /su al|water|kenar kapat|edge|sızdırmaz|seal/i, 'Çekirdeğe su girişi.'),
  I('potting', 'Ek elemanlar / dolgu (insert, potting)', 'Structural', /insert|potting|dolgu|ek eleman|gömme/i, 'Bağlantı noktalarında yük aktarımı.'),
];
const METALLIC: ChecklistItem[] = [
  I('heat', 'Isıl işlem / sertlik', 'Material', /ısıl işlem|heat treat|sertlik|hardness|temper/i, 'Mekanik özellik ısıl işleme bağlıdır.'),
  I('coat', 'Yüzey işlemi / kaplama / anodizasyon', 'Material', /kaplama|coating|anodi|boya|paint|pasivasyon|passiv|yüzey işlem|plating/i, 'Korozyon koruması.'),
  I('rough', 'Yüzey pürüzlülüğü', 'Dimensional', /pürüzlül|roughness|\bRa\b/i, 'Fonksiyonel yüzeyler için.'),
  I('crack', 'Çatlak / iç kusur muayenesi (NDT)', 'Inspection', /çatlak|crack|ndt|nde|penetrant|manyetik|magnetic|radyograf|x.?ray/i, 'Kritik parçalarda NDT.'),
  I('burr', 'Çapak / kenar kırma', 'Dimensional', /çapak|burr|kenar kır|edge break|chamfer|pah/i, 'Elleçleme ve montaj güvenliği.'),
  I('corr', 'Korozyon dayanımı / galvanik uyumluluk', 'Environmental', /korozyon|corrosion|galvanik|galvanic/i, 'Farklı metal temasları.'),
];

export const CHECKLIST_TYPES = ['General', 'Composite Part', 'Composite Assembly', 'Bonded Assembly', 'Radome', 'Sandwich Panel', 'Metallic Part'] as const;

/** Ürün tipine özel kalemler (genel kalemler her zaman eklenir). */
export function itemsFor(productType: string): ChecklistItem[] {
  const t = productType;
  const extra: ChecklistItem[] = [];
  if (/composite|radome|sandwich|bonded/i.test(t)) extra.push(...COMPOSITE);
  if (/bonded|assembly|radome|sandwich/i.test(t)) extra.push(...BONDED);
  if (/radome/i.test(t)) extra.push(...RADOME);
  if (/sandwich|radome/i.test(t)) extra.push(...SANDWICH);
  if (/metal/i.test(t)) extra.push(...METALLIC);
  const seen = new Set<string>();
  return [...COMMON_ITEMS, ...extra].filter((i) => (seen.has(i.key) ? false : (seen.add(i.key), true)));
}

export interface ChecklistResult {
  item: ChecklistItem;
  /** Konuyu karşılayan mevcut gereksinim kimlikleri. */
  found: string[];
}

/** Reddedilmemiş gereksinimlerin metin + karakteristik + tip alanlarına bakar; sezgiseldir, eşleşme yoksa "eksik olabilir" der. */
export function checkRequirements(p: Pick<Project, 'requirements'>, productType: string): ChecklistResult[] {
  const live = p.requirements.filter((r) => r.approval !== 'Rejected');
  return itemsFor(productType).map((item) => ({ item, found: live.filter((r) => item.re.test(`${r.text} ${r.characteristic} ${r.acceptance}`)).map((r) => r.id) }));
}

export const CHECKLIST_SOURCE = 'Eksik gereksinim kontrol listesi – ENGINEERING SUGGESTION – VERIFY';

/** Eksik konu için yer tutucu gereksinim (metin yalnız konuyu söyler; değer uydurmaz). */
export function placeholderReq(item: ChecklistItem, productType: string): Partial<RequirementRow> {
  return {
    text: `[Kontrol listesi] ${item.label}: şartnamede ilgili gereksinim var mı? Varsa metni ve değerleri girin, yoksa satırı silin.`,
    reqType: item.reqType,
    acceptance: NO_DATA,
    verification: NO_DATA,
    source: `${CHECKLIST_SOURCE} (${productType || 'General'}): ${item.why}`,
    dataStatus: NO_DATA,
    approval: 'AI Proposed',
    confidence: 'Low',
  };
}
