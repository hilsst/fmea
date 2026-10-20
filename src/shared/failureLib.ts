// Hazır DFMEA / PFMEA hata kütüphaneleri (ENGINEERING KNOWLEDGE).
// Sayısal limit içermez; limitler gereksinimden / kaynak dokümandan gelir.
// S/O/D değerleri kütüphane başlangıç önerisidir: satırlar "AI VARSAYIMI" ve güven "Low" ile eklenir,
// mühendis kriter tablosuna göre doğrulayıp onaylar (AI hiçbir şeyi onaylamaz).

export interface FailureTemplate {
  /** {x} → karakteristik / eleman adı */
  failureMode: string;
  effect: string;
  cause: string;
  prevention: string;
  detection: string;
  s: number;
  o: number;
  d: number;
  // yalnız PFMEA
  cause4M?: string;
  rootCause?: string;
  errorProofing?: string;
}

const T = (failureMode: string, effect: string, cause: string, prevention: string, detection: string, s: number, o: number, d: number, extra: Partial<FailureTemplate> = {}): FailureTemplate => ({ failureMode, effect, cause, prevention, detection, s, o, d, ...extra });

// ───────────────────────── DFMEA (tasarım) ─────────────────────────

export const DFMEA_LIB: Record<string, FailureTemplate[]> = {
  Dimensional: [
    T('{x} üst limitin üzerinde tasarlanmış / toleranslandırılmış', 'Montaj uyumsuzluğu, arayüz boşluğu veya girişimi; fonksiyon kaybı riski', 'Tolerans yığılması (stack-up) analizi yapılmamış veya tolerans yanlış atanmış', 'Tolerans yığılması analizi, GD&T tasarım incelemesi', 'Tasarım incelemesi + ilk parça muayenesi (FAI)', 6, 4, 5),
    T('{x} alt limitin altında tasarlanmış / toleranslandırılmış', 'Yetersiz malzeme / et kalınlığı, dayanım kaybı veya montaj uyumsuzluğu', 'Nominal ve tolerans tanımı gereksinimle uyumsuz', 'Gereksinim–çizim izlenebilirlik kontrolü, tolerans analizi', 'Tasarım incelemesi + ilk parça muayenesi (FAI)', 6, 4, 5),
  ],
  Material: [
    T('{x} için seçilen malzeme gereksinimi karşılamıyor', 'Dayanım, rijitlik veya çevresel dayanım kaybı', 'Malzeme seçim kriterleri tam tanımlanmamış; tasarım değerleri (allowable) doğrulanmamış', 'Malzeme spesifikasyonu, onaylı malzeme listesi, allowable veritabanı', 'Malzeme kalifikasyon / kupon testleri', 7, 3, 4),
    T('{x} malzeme özelliği servis koşulunda bozuluyor', 'Erken bozulma, performans düşüşü', 'Servis sıcaklığı / nem etkisi (ör. Tg marjı) değerlendirilmemiş', 'Malzeme servis sıcaklığı marj analizi', 'Şartlandırılmış (nem/ısı) kupon testleri', 7, 3, 5),
  ],
  Performance: [
    T('{x} performans gereksinimini karşılamıyor', 'Ürün fonksiyonu kısmen veya tamamen kaybolur', 'Performans analizi / modeli eksik veya doğrulanmamış', 'Performans analizi, benzer tasarım verisi, tasarım kuralları', 'Performans / kalifikasyon testi', 8, 3, 4),
    T('{x} performansı zamanla düşüyor (degrade)', 'Servis sırasında performans kaybı', 'Yaşlanma / çevresel etkiler performans analizinde dikkate alınmamış', 'Yaşlanma ve çevresel faktör analizi', 'Çevresel şartlandırma sonrası performans testi', 7, 3, 5),
  ],
  Structural: [
    T('{x} yük altında yetersiz dayanım (kalıcı deformasyon / kırılma)', 'Yapısal hasar; emniyet riski olabilir', 'Yük durumları eksik tanımlı veya emniyet faktörü yetersiz', 'Yapısal analiz (FEA), tasarım kuralları ve emniyet faktörleri', 'Statik test, analiz–test korelasyonu', 8, 3, 4),
    T('{x} yorulma ömrü yetersiz', 'Öngörülen ömürden önce çatlak / kopma', 'Yük spektrumu ve yorulma analizi eksik', 'Yorulma / hasar toleransı analizi', 'Yorulma testi', 8, 3, 5),
  ],
  Environmental: [
    T('{x} çevresel koşulda özellik kaybı (sıcaklık / nem / UV)', 'Performans düşüşü, erken bozulma', 'Çevresel ortam profili tasarıma tam yansıtılmamış', 'Çevresel gereksinim analizi, malzeme sıcaklık marjı', 'Çevresel test (termal çevrim, nem, tuz sisi – şartnameye göre)', 7, 3, 5),
  ],
  Reliability: [
    T('{x} öngörülen ömürden önce bozuluyor (aşınma / yorulma)', 'Erken arıza, bakım maliyeti, fonksiyon kaybı', 'Ömür / güvenilirlik analizi eksik', 'Güvenilirlik analizi, benzer ürün saha verisi', 'Ömür / dayanıklılık testi', 7, 3, 5),
  ],
  Interface: [
    T('{x} arayüzde uyumsuzluk (montaj yapılamıyor / boşluk)', 'Montajda duruş, rework, fonksiyon kaybı', 'Arayüz kontrol dokümanı (ICD) eksik veya güncel değil', 'ICD, dijital montaj (DMU) kontrolü', 'Montaj denemesi (fit check)', 5, 4, 4),
  ],
  Safety: [
    T('{x} emniyet fonksiyonunu yerine getirmiyor', 'Emniyet riski – kullanıcı / uçuş emniyeti etkilenebilir', 'Emniyet gereksinimi tasarım çözümüne tam yansıtılmamış', 'Emniyet analizi (FHA / FTA), bağımsız tasarım incelemesi', 'Emniyet kalifikasyon testi', 10, 2, 4),
  ],
  Regulatory: [
    T('{x} regülasyon gereksinimine uygun değil', 'Sertifikasyon / yasal uygunsuzluk', 'Uygulanabilir regülasyon tasarım girdilerine eklenmemiş', 'Uygunluk matrisi (compliance checklist)', 'Uygunluk gösterimi (analiz / test)', 9, 2, 4),
  ],
  Manufacturing: [
    T('{x} üretim kabiliyeti dışında tasarlanmış', 'Yüksek hurda / rework, teslimat gecikmesi', 'DFM incelemesi yapılmamış; tolerans proses kabiliyetine göre atanmamış', 'DFM/DFA incelemesi, proses kabiliyet verisiyle tolerans ataması', 'Prototip / pilot üretim ve ölçüm', 5, 4, 5),
  ],
  Inspection: [
    T('{x} muayene edilemiyor (erişim / yöntem yok)', 'Uygunsuz ürün tespit edilemeden sevk edilebilir', 'Muayene edilebilirlik tasarım incelemesinde değerlendirilmemiş', 'Muayene edilebilirlik incelemesi (DFI)', 'Muayene yöntemi doğrulaması (POD / referans standart)', 7, 3, 5),
  ],
  Functional: [
    T('{x} fonksiyonu yerine getirmiyor', 'Ürün fonksiyonu kaybolur', 'Fonksiyon gereksinimi tasarım çözümüne tam yansıtılmamış', 'Gereksinim izlenebilirlik matrisi, tasarım incelemesi', 'Fonksiyon testi', 7, 3, 5),
    T('{x} fonksiyonu kısmen / aralıklı yerine getiriyor', 'Performans düşüşü, kullanıcı şikâyeti', 'Tasarım marjı yetersiz', 'Tasarım marjı analizi', 'Fonksiyon testi (sınır koşullarında)', 6, 3, 5),
  ],
};
DFMEA_LIB.Process = DFMEA_LIB.Manufacturing;
DFMEA_LIB['Customer-specific'] = DFMEA_LIB.Functional;

// ───────────────────────── PFMEA (proses) ─────────────────────────

const P = (failureMode: string, effect: string, cause: string, cause4M: string, rootCause: string, prevention: string, detection: string, s: number, o: number, d: number, errorProofing = ''): FailureTemplate =>
  T(failureMode, effect, cause, prevention, detection, s, o, d, { cause4M, rootCause, errorProofing });

export const PFMEA_LIB: Record<string, FailureTemplate[]> = {
  Material: [
    P('Raf ömrü / out-time aşılmış malzeme kullanılıyor', 'Kür ve bağlanma özellikleri bozulur; mekanik özellik kaybı', 'Out-time kaydı tutulmuyor veya kontrol edilmiyor', 'Method', 'Out-time takibi manuel ve doğrulanmıyor', 'Out-time kayıt sistemi, FIFO', 'Kullanım öncesi lot / out-time kontrolü', 8, 4, 5, 'Barcode'),
    P('Yanlış malzeme / lot kullanılıyor', 'Tasarım gereksinimi karşılanmaz', 'Malzeme etiketi doğrulanmıyor; benzer malzemeler aynı yerde', 'Material', 'Malzeme tanımlama ve ayırma prosedürü yetersiz', 'Lot etiketleme, ayrı depolama', 'Barkodla malzeme doğrulama', 8, 3, 4, 'Barcode'),
    P('Malzeme nem alıyor (çözdürme hatası)', 'Porozite, bağlanma zayıflığı', 'Torba çözdürme tamamlanmadan açılıyor', 'Man', 'Çözdürme süresi takip edilmiyor', 'Çözdürme süresi etiketi, torba açılmaz kuralı', 'Çözdürme kaydı kontrolü', 7, 4, 6),
  ],
  'Lay-up': [
    P('Eksik / fazla ply', 'Kalınlık ve dayanım gereksinimi karşılanmaz', 'Ply sayımı yapılmıyor', 'Man', 'Ply kitleme ve numaralandırma yok', 'Ply kitleme ve numaralandırma, dijital iş talimatı', 'Ply sayım kontrol formu', 8, 4, 5, 'Template'),
    P('Yanlış ply oryantasyonu', 'Rijitlik / dayanım kaybı', 'Oryantasyon referansı belirsiz', 'Method', 'Lazer projeksiyon / şablon kullanılmıyor', 'Lazer projeksiyon, oryantasyon şablonu', 'Ara muayene (oryantasyon kontrolü)', 8, 3, 5, 'Template'),
    P('Yabancı madde (FOD) laminata giriyor', 'Delaminasyon, bağlanma hatası', 'Temiz oda koşulları ve FOD kontrolü yetersiz', 'Environment', 'Temiz oda disiplini izlenmiyor', 'Temiz oda (FOD) kontrolü, ayırıcı film kontrolü', 'NDT (UT)', 8, 3, 4),
  ],
  'Vacuum Bagging': [
    P('Vakum kaçağı', 'Porozite, yetersiz konsolidasyon', 'Sızdırmazlık bandı / torba hatalı uygulanmış', 'Method', 'Torbalama talimatı ve kontrol listesi yok', 'Torbalama talimatı + kontrol listesi', 'Vakum sızdırmazlık (drop) testi', 7, 4, 3),
    P('Breather süreksiz / vakum yolu tıkalı', 'Lokal porozite, reçine birikmesi', 'Breather yerleşimi kontrol edilmiyor', 'Man', 'Port yerleşim çizimi yok', 'Port yerleşim çizimi, pleat kontrol listesi', 'Kür boyunca vakum kaydı', 7, 3, 5),
  ],
  Cure: [
    P('Kür sıcaklığı / süresi spesifikasyon dışında', 'Eksik kür; mekanik özellik ve Tg düşer', 'Yanlış kür programı seçilmiş', 'Machine', 'Reçete seçimi manuel ve kilitli değil', 'Reçete kilidi (software parameter lock), periyodik TUS ve kalibrasyon', 'Kür grafiği inceleme + tanık numune testi', 9, 3, 4, 'Software parameter lock'),
    P('Isıtma / soğutma hızı limit dışında', 'İç gerilme, çarpılma, mikro çatlak', 'Isıl kütle (yük konfigürasyonu) değerlendirilmemiş', 'Method', 'Yük konfigürasyonu kalifiye edilmemiş', 'Yük konfigürasyonu kalifikasyonu, lag termokupl izleme', 'Kür grafiği inceleme', 7, 4, 4),
    P('Termokupl arızası / yanlış yerleşim', 'Parça gerçek sıcaklığı bilinmez; eksik / aşırı kür', 'Termokupl yerleşim planı yok veya uygulanmıyor', 'Measurement', 'Termokupl kalibrasyonu / yerleşimi doğrulanmıyor', 'Termokupl yerleşim planı, kalibrasyon', 'Kür öncesi termokupl kontrolü', 8, 3, 5),
  ],
  Bonding: [
    P('Yüzey kontaminasyonu (yağ, silikon, eldiven izi)', 'Yapışma zayıflığı / ayrılma (disbond)', 'Silikonsuz alan kuralı uygulanmıyor', 'Environment', 'Kontaminasyon kaynakları kontrol altında değil', 'Silikonsuz alan kuralı, eldiven kullanımı', 'Water break testi + tanık numune', 9, 3, 5),
    P('Karışım oranı hatalı / pot life aşılmış', 'Yapıştırıcı tam kürlenmez; dayanım düşer', 'Manuel tartım / karışım', 'Man', 'Karışım süresi ve oranı kaydedilmiyor', 'Otomatik karışım / dozaj, pot life zamanlayıcı', 'Tanık numune çekme / kesme testi', 9, 3, 5, 'Recipe management'),
    P('Bondline kalınlığı limit dışında', 'Yapışma dayanımı düşer', 'Aralayıcı / fikstür kullanılmıyor', 'Method', 'Bondline kontrol aracı tanımlı değil', 'Bondline aralayıcı / fikstür', 'Bondline kalınlık ölçümü / NDT', 8, 4, 5, 'Fixture'),
  ],
  Machining: [
    P('Delik / kenar delaminasyonu', 'Yapısal dayanım kaybı, hurda', 'Takım aşınmış; destek (backing) yok', 'Machine', 'Takım ömrü takibi yok', 'Takım ömrü sayacı, backing plate', 'Delik kenarı görsel muayene + NDT', 7, 4, 5),
    P('Delik çapı / konumu tolerans dışında', 'Montaj uyumsuzluğu', 'Fikstür bağlama hatası veya CNC program hatası', 'Method', 'Fikstür ve program doğrulaması yapılmıyor', 'CNC program kilidi, fikstür doğrulama', 'CMM / tapa mastar', 6, 4, 4, 'Fixture'),
  ],
  Painting: [
    P('Kaplama kalınlığı limit dışında', 'Koruma / görünüm / elektriksel performans etkilenir', 'Kat sayısı ve tabanca ayarı kontrol edilmiyor', 'Man', 'Kat kalınlığı süreç içinde ölçülmüyor', 'Reçete / karışım kaydı, operatör yeterliliği', 'Kuru film kalınlığı ölçümü', 6, 4, 4),
    P('Zayıf yapışma (kaplama kalkması)', 'Kaplama kalkar; erozyon / korozyon riski', 'Yüzey temizliği yetersiz veya kat arası süre aşılmış', 'Method', 'Yüzey hazırlığı ve süre takibi yok', 'Kabin ortam kontrolü, süre takibi', 'Yapışma testi (cross-cut / tape)', 7, 3, 5),
  ],
  'Surface Treatment': [
    P('Yetersiz / aşırı zımparalama (lif hasarı)', 'Yapışma zayıflığı veya yapısal hasar', 'Zımpara numarası / yöntem tanımsız', 'Method', 'Prosedür ve numune parça yok', 'Prosedür + numune parça', 'Görsel muayene + water break testi', 7, 4, 5),
    P('Hazırlık sonrası süre limiti aşılıyor', 'Yüzey yeniden kirlenir; yapışma zayıflar', 'Süre takibi yapılmıyor', 'Method', 'Süre takip etiketi kullanılmıyor', 'Süre takip etiketi', 'Kayıt kontrolü', 7, 4, 6),
  ],
  NDT: [
    P('Hata tespit edilemiyor (yanlış kabul)', 'Uygunsuz parça müşteriye gider', 'Personel yeterliliği / tarama planı eksik', 'Man', 'NDT personeli sertifikasız veya tarama planı yok', 'Seviye 2/3 personel, onaylı NDT tekniği, tarama haritası', 'Seviye 3 gözden geçirme, referans standartla günlük kontrol', 9, 3, 6),
    P('Yanlış kabul kriteri uygulanıyor', 'Uygunsuz parça kabul edilir veya iyi parça reddedilir', 'Kabul kriteri iş talimatına doğru aktarılmamış', 'Method', 'Kabul kriteri kaynağı doğrulanmıyor', 'Kabul kriteri – şartname izlenebilirliği', 'Seviye 3 gözden geçirme', 8, 3, 5),
  ],
  Inspection: [
    P('Ölçüm hatası (uygunsuz parça kabul ediliyor)', 'Uygunsuz parça müşteriye gider', 'Ölçüm sistemi yeterliliği (MSA) yok', 'Measurement', 'Kalibrasyon / MSA yapılmamış', 'Kalibrasyon programı, MSA (Gage R&R)', 'Bağımsız ikinci kontrol', 8, 3, 6),
    P('Muayene adımı atlanıyor', 'Uygunsuz parça sonraki operasyona geçer', 'İş akışında muayene onayı zorunlu değil', 'Method', 'Rota (router) adımı imza zorunluluğu yok', 'Rota imza / sistem kilidi', 'Son kontrol rota incelemesi', 8, 3, 5, 'Software parameter lock'),
  ],
  Assembly: [
    P('Yanlış / eksik bağlantı elemanı', 'Montaj bütünlüğü bozulur; yapısal risk', 'Benzer parçalar karışıyor', 'Material', 'Kitleme yapılmıyor', 'Kitleme, poka-yoke kutular', 'Montaj sonrası görsel kontrol', 8, 3, 5, 'Poka-yoke'),
    P('Tork değeri limit dışında', 'Gevşeme veya parça hasarı', 'Tork aleti kalibrasyonsuz / ayarı yanlış', 'Machine', 'Tork aleti kalibrasyonu izlenmiyor', 'Kalibre tork aleti, ayar kilidi', 'Tork kaydı / işaretleme', 7, 3, 4),
  ],
  Demolding: [
    P('Kalıptan çıkarmada parça hasarı', 'Delaminasyon, yüzey hasarı, hurda', 'Yanlış çıkarma yöntemi / aracı', 'Method', 'Çıkarma talimatı ve uygun araç yok', 'Çıkarma talimatı, yumuşak takımlar', 'Görsel muayene + NDT', 7, 3, 5),
  ],
  Packaging: [
    P('Taşımada parça hasarı', 'Müşteride hasarlı parça', 'Ambalaj parçayı korumuyor', 'Method', 'Ambalaj tasarımı doğrulanmamış', 'Onaylı ambalaj talimatı', 'Sevk öncesi ambalaj kontrolü', 6, 3, 6),
  ],
  Generic: [
    P('Operasyon gereksinimi karşılanmıyor', 'Ürün karakteristiği uygunsuz', 'İş talimatı eksik / belirsiz', 'Method', 'İş talimatı doğrulanmamış', 'Onaylı iş talimatı, operatör eğitimi', 'Operasyon sonu kontrol', 6, 4, 6),
  ],
};
PFMEA_LIB.Autoclave = PFMEA_LIB.Cure;

/** Proses adımı adından kütüphane alanı. */
export function pfmeaAreaOf(name: string): string {
  const n = name.toLowerCase();
  const map: [RegExp, string][] = [
    [/incoming|storage|material|malzeme|thaw|çözdür|depo|kabul/, 'Material'],
    [/lay-?up|laminasyon|serim|kitting|cutting|kesim|debulk/, 'Lay-up'],
    [/bag|torba/, 'Vacuum Bagging'],
    [/cure|kür|autoclave|otoklav|oven|fırın/, 'Cure'],
    [/bond|yapıştır|insert/, 'Bonding'],
    [/demold|kalıptan/, 'Demolding'],
    [/machin|trim|drill|delme|işleme|frez|kenar/, 'Machining'],
    [/paint|boya|coat|kaplama|finishing|astar/, 'Painting'],
    [/surface|yüzey/, 'Surface Treatment'],
    [/ndt|ultrason|x-ray|tap test|tahribatsız/, 'NDT'],
    [/inspect|muayene|kontrol|ölçüm/, 'Inspection'],
    [/assembl|montaj/, 'Assembly'],
    [/pack|ambalaj|sevk/, 'Packaging'],
  ];
  return map.find(([re]) => re.test(n))?.[1] ?? 'Generic';
}

/** Özel proses parametresi için hata satırları (parametre limit dışı). */
export function paramTemplates(param: string, productChar: string, prevention: string, monitoring: string): FailureTemplate[] {
  const eff = productChar ? `${productChar} uygunsuz olur` : 'Ürün karakteristiği uygunsuz olur';
  return [
    P(`${param} alt limitin altında`, eff, `${param} kontrol / ayar hatası`, 'Machine', 'Ekipman kontrol döngüsü veya reçete doğrulanmamış', prevention || 'Reçete kilidi, ekipman kalibrasyonu', monitoring || 'Sürekli parametre kaydı + alarm', 8, 3, 4, 'Software parameter lock'),
    P(`${param} üst limitin üzerinde`, eff, `${param} kontrol / ayar hatası`, 'Machine', 'Ekipman kontrol döngüsü veya reçete doğrulanmamış', prevention || 'Reçete kilidi, ekipman kalibrasyonu', monitoring || 'Sürekli parametre kaydı + alarm', 8, 3, 4, 'Software parameter lock'),
  ];
}
