// Composite Knowledge Base (§22), Special Process Engine şablonu (§23), ürün tipleri (§68) ve
// kompozit proses şablonu (§69). İçerik ENGINEERING KNOWLEDGE'dır: sayısal limit içermez;
// limitler kaynak dokümandan gelmelidir, yoksa VERİ YOK kalır.
import { COMPOSITE_CHECKLIST } from './model';

export interface KbEntry {
  area: string;
  failureModes: string[];
  causes: string[];
  prevention: string[];
  detection: string[];
  parameters: string[];
}

export const COMPOSITE_KB: KbEntry[] = [
  {
    area: 'Material',
    failureModes: COMPOSITE_CHECKLIST.Material,
    causes: ['Raf ömrü / out-time takibi yok', 'Dondurucu sıcaklık kaydı yok', 'Lot karışması', 'Yanlış çözdürme süresi', 'Nemli ortamda açma'],
    prevention: ['Out-time kayıt sistemi', 'FIFO + lot etiketleme', 'Barkodla malzeme doğrulama', 'Çözdürme sırasında torba açılmaz kuralı'],
    detection: ['Giriş kontrol sertifika incelemesi', 'Lot/etiket doğrulama', 'Malzeme kabul testleri (spesifikasyona göre)'],
    parameters: ['Dondurucu sıcaklığı', 'Out-time', 'Çözdürme süresi', 'Ortam nemi'],
  },
  {
    area: 'Lay-up',
    failureModes: COMPOSITE_CHECKLIST['Lay-up'],
    causes: ['Ply book / lazer projeksiyon yok', 'Ply sayım kontrolü yok', 'Temiz oda koşulları sağlanmıyor', 'Şablon yanlış'],
    prevention: ['Lazer projeksiyon', 'Ply kitleme ve numaralandırma', 'Dijital iş talimatı', 'Temiz oda (FOD) kontrolü'],
    detection: ['Ply sayım kontrol formu', 'Oryantasyon şablonu', 'Ara muayene (in-process inspection)'],
    parameters: ['Ortam sıcaklığı / nem', 'Debulk vakum seviyesi', 'Debulk süresi'],
  },
  {
    area: 'Vacuum Bagging',
    failureModes: COMPOSITE_CHECKLIST['Vacuum Bagging'],
    causes: ['Sızdırmazlık bandı hatalı', 'Torba katlanması (pleat) yetersiz', 'Vakum portu yanlış yerde', 'Breather süreksiz'],
    prevention: ['Torbalama talimatı + şablon', 'Port yerleşim çizimi', 'Pleat kontrol listesi'],
    detection: ['Vakum sızdırmazlık (drop) testi', 'Kür boyunca vakum kaydı'],
    parameters: ['Vakum seviyesi', 'Sızdırmazlık testi düşüşü (süre başına)'],
  },
  {
    area: 'Autoclave',
    failureModes: COMPOSITE_CHECKLIST.Cure,
    causes: ['Yanlış kür programı seçimi', 'Termokupl yerleşimi hatalı', 'Lag termokupl izlenmiyor', 'Yük dağılımı (ısıl kütle) değerlendirilmemiş', 'Kalibrasyonu geçmiş sensör'],
    prevention: ['Reçete kilidi (software parameter lock)', 'Termokupl yerleşim planı', 'Yük konfigürasyonu kalifikasyonu', 'Periyodik ekipman kalibrasyonu ve TUS'],
    detection: ['Kür grafiği inceleme (sıcaklık / basınç / vakum)', 'Tanık numune (witness coupon) testleri', 'NDT', 'Tg / kür derecesi testi (spesifikasyona göre)'],
    parameters: ['Kür sıcaklığı', 'Isıtma hızı', 'Bekleme süresi', 'Soğutma hızı', 'Otoklav basıncı', 'Torba vakumu', 'Lag / lead termokupl farkı'],
  },
  {
    area: 'Bonding',
    failureModes: COMPOSITE_CHECKLIST.Bonding,
    causes: ['Yüzey hazırlığı ile yapıştırma arası süre aşımı', 'Kontaminasyon (silikon, yağ, eldiven)', 'Karışım oranı hatası', 'Pot life aşımı', 'Bondline kontrol aracı yok'],
    prevention: ['Yüzey hazırlığı süre takibi', 'Silikonsuz alan kuralı', 'Otomatik karışım/dozaj', 'Bondline aralayıcı / fikstür', 'Tanık numune'],
    detection: ['Water break testi', 'Tanık numune çekme/kesme testi', 'NDT (tap test / UT)', 'Bondline kalınlık ölçümü'],
    parameters: ['Karışım oranı', 'Pot life', 'Uygulama ortam sıcaklığı / nem', 'Basınç', 'Kür sıcaklığı / süresi', 'Yüzey hazırlığı – yapıştırma arası süre'],
  },
  {
    area: 'Machining',
    failureModes: COMPOSITE_CHECKLIST.Machining,
    causes: ['Takım aşınması', 'Yanlış devir / ilerleme', 'Destek (backing) yok', 'Fikstür bağlama hatası', 'Soğutma / toz emme yetersiz'],
    prevention: ['Takım ömrü sayacı', 'CNC program kilidi', 'Backing plate', 'Fikstür doğrulama'],
    detection: ['CMM / mastar', 'Delik kenarı görsel muayene', 'NDT (kenar delaminasyonu)'],
    parameters: ['Devir', 'İlerleme', 'Takım ömrü (delik sayısı)'],
  },
  {
    area: 'Painting',
    failureModes: COMPOSITE_CHECKLIST.Finishing,
    causes: ['Yüzey temizliği yetersiz', 'Karışım / inceltme oranı hatası', 'Ortam koşulları kontrol dışı', 'Kat arası bekleme süresi uyulmadı', 'Yanlış maskeleme'],
    prevention: ['Boya kabini ortam kontrolü', 'Reçete / karışım kaydı', 'Maskeleme şablonu'],
    detection: ['Kuru film kalınlığı ölçümü', 'Yapışma testi (cross-cut / tape)', 'Görsel muayene + limit numune', 'Parlaklık / renk ölçümü (spesifikasyona göre)'],
    parameters: ['Ortam sıcaklığı / nem', 'Kat kalınlığı', 'Kat arası süre', 'Kür sıcaklığı / süresi'],
  },
  {
    area: 'Surface Treatment',
    failureModes: ['incorrect surface preparation', 'contamination', 'over-abrasion / fiber damage', 'insufficient abrasion', 'peel ply residue', 'time limit exceeded'],
    causes: ['Zımpara numarası yanlış', 'Peel ply yanlış tip', 'Temizleme solventi kontaminasyonu', 'Hazırlık sonrası süre takibi yok'],
    prevention: ['Prosedür + numune parça', 'Malzeme kontrollü peel ply', 'Süre takip etiketi'],
    detection: ['Water break testi', 'Görsel muayene', 'Yüzey enerjisi ölçümü (spesifikasyona göre)'],
    parameters: ['Hazırlık – sonraki işlem arası süre', 'Ortam koşulları'],
  },
  {
    area: 'NDT',
    failureModes: ['missed defect (false accept)', 'false reject', 'wrong acceptance criteria applied', 'incomplete coverage', 'reference standard mismatch'],
    causes: ['Personel yeterliliği / sertifikası yok', 'Referans standart parça uygun değil', 'Tarama planı eksik', 'Ekipman kalibrasyonu yok'],
    prevention: ['Seviye 2/3 personel (NAS 410 / EN 4179 vb.)', 'Onaylı NDT tekniği', 'Tarama haritası', 'Referans standart doğrulaması'],
    detection: ['Seviye 3 gözden geçirme', 'Referans standartla günlük kontrol', 'Attribute Agreement Analysis'],
    parameters: ['Kazanç / frekans ayarı', 'Tarama hızı', 'Kapsama oranı'],
  },
];

export const KB_AREAS = COMPOSITE_KB.map((k) => k.area);

/** Proses adımı adından ilgili bilgi tabanı alanını bulur. */
export function kbForStep(name: string): KbEntry | undefined {
  const n = name.toLowerCase();
  const map: [RegExp, string][] = [
    [/incoming|storage|material|malzeme|thaw|çözdür|depo/, 'Material'],
    [/lay-?up|laminasyon|kitting|cutting|kesim|debulk/, 'Lay-up'],
    [/bag|torba/, 'Vacuum Bagging'],
    [/cure|kür|autoclave|otoklav|oven|fırın/, 'Autoclave'],
    [/bond|yapıştır/, 'Bonding'],
    [/machin|trim|drill|del|işleme|frez/, 'Machining'],
    [/paint|boya|coat|kaplama|finishing/, 'Painting'],
    [/surface|yüzey/, 'Surface Treatment'],
    [/ndt|ultrason|x-ray|tap test|tahribatsız/, 'NDT'],
  ];
  const hit = map.find(([re]) => re.test(n));
  return hit ? COMPOSITE_KB.find((k) => k.area === hit[1]) : undefined;
}

export const PRODUCT_TYPES = ['Composite Part', 'Composite Assembly', 'Bonded Assembly', 'Radome', 'Sandwich Panel', 'Metallic Part', 'General'] as const;
export const isComposite = (t: string) => /composite|bonded|radome|sandwich/i.test(t);

export interface TemplateStep {
  opNo: string;
  name: string;
  description: string;
  specialProcess: boolean;
  /** Parametre adları; limit değerleri VERİ YOK olarak eklenir. */
  params: string[];
}

/** §69 kompozit proses şablonu – kullanıcı onayıyla eklenir, mevcut adımlar silinmez. */
export const COMPOSITE_TEMPLATE: TemplateStep[] = [
  { opNo: '10', name: 'Incoming Material', description: 'Malzeme kabul, sertifika ve lot kontrolü', specialProcess: false, params: [] },
  { opNo: '20', name: 'Storage', description: 'Dondurucuda depolama, out-time takibi', specialProcess: false, params: ['Dondurucu sıcaklığı', 'Out-time'] },
  { opNo: '30', name: 'Material Preparation', description: 'Çözdürme ve hazırlık', specialProcess: false, params: ['Çözdürme süresi'] },
  { opNo: '40', name: 'Cutting', description: 'Ply kesimi (CNC kesim / şablon)', specialProcess: false, params: [] },
  { opNo: '50', name: 'Kitting', description: 'Ply kitleme ve etiketleme', specialProcess: false, params: [] },
  { opNo: '60', name: 'Lay-up', description: 'Kalıba serim, oryantasyon ve sıra', specialProcess: false, params: ['Ortam sıcaklığı', 'Ortam nemi'] },
  { opNo: '70', name: 'Debulk', description: 'Ara vakumlama', specialProcess: false, params: ['Debulk vakumu', 'Debulk süresi'] },
  { opNo: '80', name: 'Vacuum Bagging', description: 'Torbalama ve sızdırmazlık testi', specialProcess: false, params: ['Vakum seviyesi', 'Sızdırmazlık testi düşüşü'] },
  { opNo: '90', name: 'Cure', description: 'Otoklav / fırın kürü', specialProcess: true, params: ['Kür sıcaklığı', 'Isıtma hızı', 'Bekleme süresi', 'Soğutma hızı', 'Otoklav basıncı', 'Torba vakumu'] },
  { opNo: '100', name: 'Demolding', description: 'Kalıptan çıkarma', specialProcess: false, params: [] },
  { opNo: '110', name: 'Machining', description: 'Kenar kesme ve delme', specialProcess: false, params: ['Devir', 'İlerleme', 'Takım ömrü'] },
  { opNo: '120', name: 'Inspection', description: 'NDT ve boyutsal kontrol', specialProcess: true, params: [] },
  { opNo: '130', name: 'Bonding', description: 'Yapıştırma / insert montajı', specialProcess: true, params: ['Karışım oranı', 'Pot life', 'Kür sıcaklığı', 'Kür süresi', 'Basınç'] },
  { opNo: '140', name: 'Surface Treatment', description: 'Boya öncesi yüzey hazırlığı', specialProcess: true, params: ['Hazırlık – boya arası süre'] },
  { opNo: '150', name: 'Painting', description: 'Astar ve boya', specialProcess: true, params: ['Ortam sıcaklığı', 'Ortam nemi', 'Kat kalınlığı', 'Kür süresi'] },
  { opNo: '160', name: 'Final Inspection', description: 'Son kontrol', specialProcess: false, params: [] },
  { opNo: '170', name: 'Packaging', description: 'Ambalaj ve sevkiyat', specialProcess: false, params: [] },
];

/** Radom için ek değerlendirme alanları (yalnızca hatırlatma; değer içermez). */
export const PRODUCT_TYPE_HINTS: Record<string, string[]> = {
  Radome: ['Elektromanyetik performans (transmission loss, boresight) – kaynak spesifikasyondan', 'Yağmur erozyonu / kaplama', 'Yıldırım koruması (diverter strip)', 'Statik deşarj kaplaması', 'Duvar kalınlığı toleransı'],
  'Sandwich Panel': ['Core-skin yapışması', 'Core ezilmesi', 'Nem girişi', 'Insert çekme dayanımı'],
  'Bonded Assembly': ['Bondline kalınlığı', 'Yüzey hazırlığı', 'Tanık numune', 'NDT kapsaması'],
  'Composite Part': ['Ply oryantasyonu', 'Porozite', 'Kür derecesi', 'Kenar delaminasyonu'],
  'Composite Assembly': ['Montaj gerilmesi / shim', 'Bağlantı elemanı delikleri', 'Galvanik korozyon (karbon–alüminyum)'],
  'Metallic Part': ['Isıl işlem', 'Yüzey işlem (anodize / kaplama)', 'Çapak', 'Korozyon'],
  General: [],
};
